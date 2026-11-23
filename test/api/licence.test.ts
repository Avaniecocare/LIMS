import { generateKeyPairSync, sign } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LicenceService } from '../../src/modules/licence/licence.service.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import { bootApp, createUser, login, PASSWORD, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';

/** Trials and licences, enforced by the server. */
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
process.env.TEST_LICENCE_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const DAY = 86_400_000;
const issue = (l: object) => {
  const body = `LIMS1.${Buffer.from(
    JSON.stringify({
      id: 'trial-1',
      kind: 'trial',
      customer: 'Acme',
      installation: null,
      issuedAt: new Date().toISOString(),
      days: 7,
      notAfter: new Date(Date.now() + 60 * DAY).toISOString(),
      graceDays: 0,
      ...l,
    }),
  ).toString('base64url')}`;
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString('base64url')}`;
};
let ctx: Ctx;
let admin: Client, sales: Client;
const licence = () =>
  ctx.app.get(LicenceService) as unknown as { cache: unknown; activate(t: string, s?: boolean): Promise<unknown>; infra: { licence: string | null }; onModuleInit(): Promise<void> };
/** A day's work that saves something. */
const save = (name = `Customer ${Math.random()}`) => sales.post('/customers', { name, stateName: 'Maharashtra', stateCode: '27' });
const later = (ms: number) => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ms });
  licence().cache = null;
};

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  await createUser(ctx, 'admin@lic.example', [ROLE_NAMES.admin], 'Admin');
  await createUser(ctx, 'sales@lic.example', [ROLE_NAMES.sales], 'Sales');
  admin = await login(ctx, 'admin@lic.example');
  sales = await login(ctx, 'sales@lic.example');
});
afterEach(async () => {
  vi.useRealTimers();
  licence().cache = null;
});
afterAll(async () => {
  delete process.env.TEST_LICENCE_PUBLIC_KEY;
  await ctx.app.close();
});
const reset = async () => {
  await ctx.prisma.setting.deleteMany({ where: { key: 'licence.state' } });
  await ctx.prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER USER`);
  await ctx.prisma.auditLog.deleteMany({ where: { at: { gt: new Date(Date.now() + 60_000) } } });
  await ctx.prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER USER`);
  licence().cache = null;
};

describe('before a licence', () => {
  it('can be signed in to and looked at, but saves nothing', async () => {
    await reset();
    await sales.get('/customers').expect(200);
    const res = await save().expect(403);
    expect(res.body.error).toMatchObject({ code: 'READ_ONLY', message: expect.stringContaining('no licence yet') });
    // The public way in is closed too.
    expect((await ctx.http().post('/api/v1/public/phone-uploads/x/files')).body.error.code).toBe('READ_ONLY');
    await ctx.http().post('/api/v1/auth/login').send({ email: 'sales@lic.example', password: PASSWORD }).expect(200);
    expect((await sales.get('/licence').expect(200)).body).toMatchObject({ state: 'missing', readOnly: true });
  });

  it('is added only by someone who manages settings, with the password confirmed', async () => {
    await sales.post('/admin/licence', { licence: issue({}) }).expect(403);
    const fresh = await login(ctx, 'admin@lic.example', PASSWORD, { reauth: false });
    expect((await fresh.post('/admin/licence', { licence: issue({}) }).expect(403)).body.error.code).toBe('REAUTH_REQUIRED');
    await admin.post('/admin/licence', { licence: issue({ installation: 'someone-else' }) }).expect(400);
    await admin.post('/admin/licence', { licence: `${issue({})}x` }).expect(400);
  });
});

describe.each([7, 30])('a %i-day trial', (days) => {
  it('works, warns, then goes read-only with everything still readable and exportable, and a new licence restores it', async () => {
    await reset();
    const text = issue({ id: `trial-${days}`, days });
    expect((await admin.post('/admin/licence', { licence: text }).expect(200)).body).toMatchObject({ kind: 'trial', readOnly: false, daysLeft: days });
    const name = `Kept through the ${days}-day trial`;
    await save(name).expect(201);
    const notify = () => ctx.app.get(NotificationsService).licenceCheck();

    later((days - 1) * DAY + 3600_000);
    expect((await sales.get('/licence')).status).toBe(401); // a week later nobody is still signed in
    [admin, sales] = [await login(ctx, 'admin@lic.example'), await login(ctx, 'sales@lic.example')];
    expect((await sales.get('/licence').expect(200)).body).toMatchObject({ state: 'ending', daysLeft: 1, readOnly: false });
    expect(await notify()).toBeGreaterThan(0);
    expect(await notify()).toBe(0); // once

    later(DAY);
    [admin, sales] = [await login(ctx, 'admin@lic.example'), await login(ctx, 'sales@lic.example')];
    expect((await save().expect(403)).body.error).toMatchObject({ code: 'READ_ONLY', message: expect.stringContaining('ended') });
    expect(await notify()).toBeGreaterThan(0);
    const list = (await sales.get(`/customers?q=${encodeURIComponent(name)}`).expect(200)).body;
    expect(list.meta.total).toBe(1);
    await admin.post('/documents', { kind: 'customer-export', params: {} }).expect(201);
    // Entering the same trial again does not start it again.
    expect((await admin.post('/admin/licence', { licence: text }).expect(400)).body.error.message).toMatch(/already ended/);

    await admin.post('/admin/licence', { licence: issue({ id: `full-${days}`, kind: 'full', days: null, notAfter: new Date(Date.now() + 365 * DAY).toISOString() }) }).expect(200);
    await save().expect(201);
  }, 60000);
});

describe('attempts to get more time', () => {
  it('setting the clock back gives nothing back', async () => {
    await reset();
    await admin.post('/admin/licence', { licence: issue({ id: 'clock' }) }).expect(200);
    later(8 * DAY);
    expect(await ctx.app.get(LicenceService).status()).toMatchObject({ readOnly: true });
    vi.useRealTimers();
    licence().cache = null;
    expect(await ctx.app.get(LicenceService).status()).toMatchObject({ readOnly: true });
  });

  it('an audit entry from later on counts as well, if only the saved time is put back', async () => {
    await reset();
    await admin.post('/admin/licence', { licence: issue({ id: 'witness' }) }).expect(200);
    await ctx.prisma.auditLog.create({ data: { action: 'x', entity: 'X', entityId: 'x', at: new Date(Date.now() + 8 * DAY) } });
    licence().cache = null;
    expect(await ctx.app.get(LicenceService).status()).toMatchObject({ readOnly: true });
  });

  it('a server whose clock once jumped years ahead is put right by a new licence, and not by the old one', async () => {
    await reset();
    const old = issue({ id: 'before-jump' });
    await admin.post('/admin/licence', { licence: old }).expect(200);
    await ctx.prisma.auditLog.create({ data: { action: 'x', entity: 'X', entityId: 'x', at: new Date(Date.now() + 4 * 365 * DAY) } });
    await ctx.prisma.$executeRaw`UPDATE "Setting" SET "value" = jsonb_set("value", '{lastSeen}', to_jsonb('2031-01-01T00:00:00.000Z'::text)) WHERE "key" = 'licence.state'`;
    licence().cache = null;
    expect(await ctx.app.get(LicenceService).status()).toMatchObject({ readOnly: true });
    await admin.post('/admin/licence', { licence: old }).expect(400);
    await admin.post('/admin/licence', { licence: issue({ id: 'after-jump' }) }).expect(200);
    licence().cache = null;
    expect(await ctx.app.get(LicenceService).status()).toMatchObject({ state: 'ending', readOnly: false, daysLeft: 7 });
  });

  it('editing the stored licence makes it invalid', async () => {
    await reset();
    await admin.post('/admin/licence', { licence: issue({ id: 'edited' }) }).expect(200);
    const row = await ctx.prisma.setting.findUniqueOrThrow({ where: { key: 'licence.state' } });
    const v = row.value as { licence: string };
    const [p, body, s] = v.licence.split('.');
    const longer = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), days: 3000 })).toString('base64url');
    await ctx.prisma.setting.update({ where: { key: 'licence.state' }, data: { value: { ...v, licence: `${p}.${longer}.${s}` } } });
    licence().cache = null;
    expect(await ctx.app.get(LicenceService).status()).toMatchObject({ state: 'missing', readOnly: true });
  });

  it('the server setting is used once and does not come back over a newer licence', async () => {
    await reset();
    const trial = issue({ id: 'from-env' });
    licence().infra.licence = trial;
    await licence().onModuleInit();
    expect((await ctx.app.get(LicenceService).status()).licence).toMatchObject({ id: 'from-env' });
    await licence().activate(issue({ id: 'newer', kind: 'full', days: null }), true);
    await licence().onModuleInit();
    expect((await ctx.app.get(LicenceService).status()).licence).toMatchObject({ id: 'newer' });
    licence().infra.licence = null;
  });
});

describe('an image built without a vendor’s key', () => {
  it('asks for no licence', async () => {
    const service = ctx.app.get(LicenceService) as unknown as { key: unknown };
    const key = service.key;
    service.key = null;
    try {
      expect((await sales.get('/licence').expect(200)).body).toMatchObject({ state: 'not-required', readOnly: false });
      await save().expect(201);
    } finally {
      service.key = key;
    }
  });
});
