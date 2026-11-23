import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { parseTrustProxy } from '../../src/config/infra.config.js';
import { NumberingService } from '../../src/core/numbering.service.js';
import { RedisService } from '../../src/core/redis.service.js';
import { MockIrp, IrpRejection } from '../../src/modules/einvoice/provider.js';
import { issuedJob, type FullTeam } from '../support/cycle.js';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, PASSWORD, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';
import { plannedTests, workTest } from '../support/workflow.js';
import { gstinCheckChar } from '../../src/common/india.js';

/** Findings of the November 2026 audit, each with the failure it caused. */
let ctx: Ctx;
let admin: Client, accounts: Client;
let team: FullTeam;
let fx: Awaited<ReturnType<typeof billingFixture>>;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  const { loadBaseline } = await import('../../src/modules/rbac/baseline.js');
  await ctx.prisma.$transaction(loadBaseline);
  for (const e of ['admin', 'reception', 'planner', 'tech', 'hod', 'reviewer', 'signatory', 'accounts'] as const) await createUser(ctx, `${e}@hard.example`, [ROLE_NAMES[e]], `${e} person`);
  const c = (n: string) => login(ctx, `${n}@hard.example`);
  admin = await c('admin');
  accounts = await c('accounts');
  team = { reception: await c('reception'), planner: await c('planner'), tech: await c('tech'), hod: await c('hod'), reviewer: await c('reviewer'), signatory: await c('signatory') };
  fx = await billingFixture(admin, ctx, 'H');
  for (const id of fx.testIds) await admin.post('/masters/test-parameters', { testId: id, code: 'P', name: 'Result', kind: 'TEXT' }).expect(201);
});
afterAll(() => ctx.app.close());

const setupTotp = async (client: Client) => {
  const { secret } = (await client.post('/auth/totp/setup').expect(200)).body as { secret: string };
  const totp = new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
  await client.post('/auth/totp/enable', { code: totp.generate({ timestamp: Date.now() - 30_000 }) }).expect(200);
  return totp;
};
const signIn = (email: string, password = PASSWORD) => ctx.http().post('/api/v1/auth/login').send({ email, password });

describe('delegated user managers', () => {
  it('cannot take over, switch off or strip someone with more access than they have', async () => {
    await admin.post('/admin/roles', { name: 'Desk manager', permissions: ['admin.users', 'customers.view'] }).expect(201);
    await createUser(ctx, 'desk@hard.example', ['Desk manager']);
    const peer = await createUser(ctx, 'peer@hard.example', ['Desk manager']);
    const target = await createUser(ctx, 'boss@hard.example', [ROLE_NAMES.admin]);
    const desk = await login(ctx, 'desk@hard.example');
    const version = (await desk.get(`/admin/users/${target.id}`).expect(200)).body.version;
    await desk.post(`/admin/users/${target.id}/reset-password`, { newPassword: 'Taken-Over-1!' }).expect(403);
    await desk.post(`/admin/users/${target.id}/reset-2fa`).expect(403);
    await desk.patch(`/admin/users/${target.id}`, { version, isActive: false }).expect(403);
    await desk.patch(`/admin/users/${target.id}`, { version, roleIds: [] }).expect(403);
    await signIn('boss@hard.example').expect(200);
    // Their own level is theirs to manage, and an Admin manages everyone.
    await desk.post(`/admin/users/${peer.id}/reset-password`, { newPassword: 'Peer-Reset-12!' }).expect(200);
    await admin.post(`/admin/users/${target.id}/reset-password`, { newPassword: 'Admin-Reset-1!' }).expect(200);
  });
});

describe('two-factor sign-in', () => {
  it('counts wrong codes toward the lockout, so a known password does not allow unlimited guesses', async () => {
    await createUser(ctx, 'totp1@hard.example', [ROLE_NAMES.accounts]);
    await setupTotp(await login(ctx, 'totp1@hard.example'));
    for (let i = 0; i < 5; i++) {
      const { totpChallenge } = (await signIn('totp1@hard.example').expect(200)).body;
      await ctx.http().post('/api/v1/auth/login/totp').send({ challenge: totpChallenge, code: '000000' }).expect(401);
    }
    await signIn('totp1@hard.example').expect(401);
    expect((await ctx.prisma.user.findFirstOrThrow({ where: { email: 'totp1@hard.example' } })).lockedUntil).not.toBeNull();
    await ctx.app.get(RedisService).client.flushdb();
    admin = await login(ctx, 'admin@hard.example');
    accounts = await login(ctx, 'accounts@hard.example');
    const c = (n: string) => login(ctx, `${n}@hard.example`);
    team = { reception: await c('reception'), planner: await c('planner'), tech: await c('tech'), hod: await c('hod'), reviewer: await c('reviewer'), signatory: await c('signatory') };
  });

  it('accepts each code once', async () => {
    await createUser(ctx, 'totp2@hard.example', [ROLE_NAMES.accounts]);
    const totp = await setupTotp(await login(ctx, 'totp2@hard.example'));
    const code = totp.generate();
    const first = (await signIn('totp2@hard.example').expect(200)).body.totpChallenge;
    await ctx.http().post('/api/v1/auth/login/totp').send({ challenge: first, code }).expect(200);
    const second = (await signIn('totp2@hard.example').expect(200)).body.totpChallenge;
    await ctx.http().post('/api/v1/auth/login/totp').send({ challenge: second, code }).expect(401);
  });

  it('is not switched off by starting set-up again, and an Admin can reset it for a lost phone', async () => {
    const u = await createUser(ctx, 'totp3@hard.example', [ROLE_NAMES.accounts]);
    const client = await login(ctx, 'totp3@hard.example');
    await setupTotp(client);
    await client.post('/auth/totp/setup').expect(200);
    expect((await signIn('totp3@hard.example').expect(200)).body.totpChallenge).toBeTruthy();
    await admin.post(`/admin/users/${u.id}/reset-2fa`).expect(200);
    await client.get('/auth/me').expect(401);
    expect((await signIn('totp3@hard.example').expect(200)).body.user.email).toBe('totp3@hard.example');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'user.totpReset', entityId: u.id } })).toBe(1);
  });

  it('counts wrong passwords that arrive together', async () => {
    const u = await createUser(ctx, 'burst@hard.example', [ROLE_NAMES.tech]);
    await Promise.all(Array.from({ length: 5 }, () => signIn('burst@hard.example', 'wrong')));
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).lockedUntil).not.toBeNull();
  });

  it('limits guessing the password inside a session', async () => {
    await createUser(ctx, 'stolen@hard.example', [ROLE_NAMES.tech]);
    const s = await login(ctx, 'stolen@hard.example');
    for (let i = 0; i < 10; i++) await s.post('/auth/change-password', { currentPassword: 'wrong', newPassword: 'Another-Pass-1!' }).expect(400);
    await s.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Another-Pass-1!' }).expect(429);
  });
});

describe('idle timeout', () => {
  it('is not extended by the notification bell', async () => {
    await createUser(ctx, 'idle@hard.example', [ROLE_NAMES.tech]);
    const redis = ctx.app.get(RedisService).client;
    const before = new Set(await redis.keys('sess:*'));
    const s = await login(ctx, 'idle@hard.example');
    const key = (await redis.keys('sess:*')).find((k) => !before.has(k))!;
    await redis.expire(key, 100);
    await s.get('/notifications').expect(200);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(100);
    await s.get('/auth/me').expect(200);
    expect(await redis.ttl(key)).toBeGreaterThan(100);
  });
});

describe('cancelled work', () => {
  it('cannot be reviewed, signed or issued as a report', async () => {
    const { job, sampleTestIds } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.f]);
    const d = await workTest(team, sampleTestIds[0], { P: 'OK' });
    await team.hod.post(`/tests/${sampleTestIds[0]}/approve`, { version: d.version }).expect(200);
    const reportId = (await team.reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data[0].id as string;
    const set = (status: 'DRAFT' | 'IN_REVIEW' | 'PENDING_APPROVAL') => ctx.prisma.reportRevision.updateMany({ where: { reportId }, data: { status } });
    await ctx.prisma.sample.updateMany({ where: { jobId: job.id }, data: { status: 'CANCELLED' } });
    const v = async () => (await ctx.prisma.reportRevision.findFirstOrThrow({ where: { reportId } })).version;
    for (const [status, call] of [
      ['DRAFT', async () => team.reviewer.post(`/reports/${reportId}/submit`, { version: await v() })],
      ['IN_REVIEW', async () => team.reviewer.post(`/reports/${reportId}/pass-review`, { version: await v() })],
      ['PENDING_APPROVAL', async () => team.signatory.post(`/reports/${reportId}/approve`, { version: await v(), password: PASSWORD })],
    ] as const) {
      await set(status);
      const res = await call();
      expect([res.status, res.body.error?.code]).toEqual([422, 'CANCELLED']);
    }
  }, 90000);
});

describe('customer identity', () => {
  it('stays hidden in job history and emails from people without customers.view', async () => {
    const { job } = await plannedTests(ctx, team, fx.intra.id, [fx.tests.f]);
    const version = (await team.reception.get(`/jobs/${job.id}`).expect(200)).body.version;
    await team.reception.patch(`/jobs/${job.id}`, { version, contactEmail: 'secret@customer.example', kindAttention: 'Secret Person' }).expect(200);
    await ctx.prisma.emailLog.create({ data: { toAddress: 'secret@customer.example', subject: 'For Secret Ltd', template: 'x', entity: 'Job', entityId: job.id, html: '' } });
    for (const path of ['history', 'emails']) {
      const planner = JSON.stringify((await team.planner.get(`/jobs/${job.id}/${path}`).expect(200)).body);
      expect(planner).not.toMatch(/secret/i);
      const reception = JSON.stringify((await team.reception.get(`/jobs/${job.id}/${path}`).expect(200)).body);
      expect(reception).toMatch(/secret@customer\.example/);
    }
  }, 60000);
});

describe('document numbers', () => {
  it('carry on when a format has no year, instead of repeating on 1 April', async () => {
    const numbering = ctx.app.get(NumberingService);
    const next = (at: string) => ctx.prisma.$transaction((tx) => numbering.next(tx, 'ULR', new Date(at), 'T{SEQ:4}'));
    await ctx.prisma.numberSeries.deleteMany({ where: { code: 'ULR' } });
    await ctx.prisma.numberSeries.create({ data: { code: 'ULR', fy: '25-26', nextValue: 8 } });
    expect(await next('2026-03-31T06:00:00Z')).toBe('T0008');
    expect(await next('2026-04-02T06:00:00Z')).toBe('T0009');
  });

  it('refuse unknown tokens in Admin', async () => {
    const formats = ((await admin.get('/admin/settings').expect(200)).body as { key: string; value: Record<string, string>; version: number; sensitive: boolean }[]).find(
      (s) => s.key === 'numbering.formats',
    )!;
    expect(formats.sensitive).toBe(false);
    await admin.put('/admin/settings/numbering.formats', { value: { ...formats.value, INVOICE: 'INV{YYYY}{SEQ:5}' }, version: formats.version }).expect(400);
  });
});

describe('e-invoice answers that never arrive', () => {
  it('stop the invoice being cancelled until the IRN is known', async () => {
    const mods = (await admin.get('/admin/lab/modules').expect(200)).body;
    await admin.put('/admin/lab/modules', { version: mods.version, enabled: { einvoice: true } }).expect(200);
    const s = (await admin.get('/admin/lab/einvoice').expect(200)).body;
    await admin
      .put('/admin/lab/einvoice', {
        seller: { line1: 'Unit 1', line2: '', city: 'Pune', pincode: '411001' },
        autoOnIssue: true,
        sellerVersion: s.sellerVersion,
        autoOnIssueVersion: s.autoOnIssueVersion,
      })
      .expect(200);
    const f = ((await admin.get('/admin/settings').expect(200)).body as { key: string; value: Record<string, string>; version: number }[]).find((x) => x.key === 'numbering.formats')!;
    await admin.put('/admin/settings/numbering.formats', { value: { ...f.value, INVOICE: '{PREFIX}/{FY}/{SEQ:5}', CREDIT_NOTE: '{PREFIX}/CN/{FY}/{SEQ:4}' }, version: f.version }).expect(200);
    const g = '27CCCCC1234C1Z';
    const customer = (
      await admin
        .post('/customers', {
          name: 'Lost Answer Ltd',
          gstin: g + gstinCheckChar(g),
          stateName: 'Maharashtra',
          stateCode: '27',
          addresses: [{ kind: 'BILLING', line1: '7 Road', city: 'Pune', stateName: 'Maharashtra', stateCode: '27', pincode: '411026' }],
          contacts: [{ name: 'Ravi', email: 'ravi@buyer.example', isPrimary: true }],
        })
        .expect(201)
    ).body;
    const issueWith = async (error: Error) => {
      const { job } = await issuedJob(ctx, team, customer.id, [fx.tests.f], { P: 'OK' });
      const draft = (await accounts.post('/invoices', { customerId: customer.id, jobIds: [job.id] }).expect(201)).body;
      const spy = vi.spyOn(MockIrp.prototype, 'generate').mockRejectedValueOnce(error);
      const inv = (await accounts.post(`/invoices/${draft.id}/issue`, { version: draft.version }).expect(200)).body;
      spy.mockRestore();
      expect(inv.einvoice.status).toBe('FAILED');
      return inv;
    };
    const cancel = (inv: { id: string; version: number }) => accounts.post(`/invoices/${inv.id}/cancel`, { version: inv.version, reason: 'Wrong customer', irnCancelReason: '2' });

    const lost = await issueWith(new Error('socket hang up'));
    const refused = await cancel(lost);
    expect([refused.status, refused.body.error?.code]).toEqual([422, 'IRN_UNCERTAIN']);
    await accounts.post(`/invoices/${lost.id}/einvoice`).expect(200);
    const now = (await accounts.get(`/invoices/${lost.id}`).expect(200)).body;
    expect(now.einvoice.status).toBe('GENERATED');
    await cancel(now).expect(200);

    // A clear refusal leaves nothing at the portal, so that invoice can be cancelled straight away.
    await cancel(await issueWith(new IrpRejection('Invalid HSN', ['2176']))).expect(200);
    // A sign-in error says nothing about the document.
    expect((await cancel(await issueWith(new IrpRejection('Invalid token', ['1005'])))).status).toBe(422);
  }, 180000);
});

describe('client address behind a proxy', () => {
  it('reads TRUST_PROXY as a number of proxies, addresses or true/false', () => {
    expect([undefined, 'true', 'false', '1', '10.0.0.0/8, 127.0.0.1'].map((v) => parseTrustProxy(v))).toEqual([false, true, false, 1, '10.0.0.0/8, 127.0.0.1']);
    expect(() => parseTrustProxy('yes')).toThrow(/TRUST_PROXY/);
  });

  it('behind one load balancer, ignores addresses the caller made up', async () => {
    const app = await createApp({ trustProxy: 1 });
    await app.init();
    const fastify = app.getHttpAdapter().getInstance();
    const seen: string[] = [];
    fastify.addHook('preHandler', (req, _reply, done) => {
      seen.push(req.ip);
      done();
    });
    await fastify.ready();
    await fastify.inject({ method: 'GET', url: '/health/live', headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' } });
    expect(seen).toEqual(['203.0.113.9']);
    await app.close();
  });
});
