import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, createUser, login, PASSWORD, resetDb, ROLE_NAMES, type Ctx } from '../support/harness.js';

let ctx: Ctx;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('public branding', () => {
  it('returns exactly the allowed fields', async () => {
    const res = await ctx.http().get('/api/v1/public/branding').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['accentColor', 'companyName', 'faviconUrl', 'loginImageUrl', 'loginTagline', 'logoUrl', 'navColor', 'poweredBy', 'poweredByName', 'primaryColor', 'privacyContactEmail', 'privacyUrl', 'productName', 'supportEmail', 'supportPhone', 'surfaceColor', 'termsUrl']);
    const text = JSON.stringify(res.body);
    for (const secret of ['000000000000', 'AAAAA0000A', 'EXMP0000001', '27AAAAA0000A1Z2']) expect(text).not.toContain(secret);
  });

  it('serves the logo without a login', async () => {
    const res = await ctx.http().get('/api/v1/public/branding/logo').expect(200);
    expect(res.headers['content-type']).toContain('image/png');
  });
});

describe('first-run setup', () => {
  it('creates the first Admin once, then refuses', async () => {
    expect((await ctx.http().get('/api/v1/public/setup-status').expect(200)).body.setupRequired).toBe(true);
    await ctx.http().post('/api/v1/public/setup').send({ adminEmail: 'first@x.example', adminName: 'First', adminPassword: 'weak' }).expect(400);
    await ctx.http().post('/api/v1/public/setup')
      .send({ adminEmail: 'first@x.example', adminName: 'First Admin', adminPassword: PASSWORD, gstRate: 18, terms: { report: 'Report terms' } })
      .expect(201);
    expect((await ctx.http().get('/api/v1/public/setup-status').expect(200)).body.setupRequired).toBe(false);
    await ctx.http().post('/api/v1/public/setup').send({ adminEmail: 'second@x.example', adminName: 'Second', adminPassword: PASSWORD }).expect(409);
    const admin = await login(ctx, 'first@x.example');
    const me = await admin.get('/auth/me').expect(200);
    expect(me.body.roles).toContain('Admin');
  });
});

describe('auth', () => {
  it('sets a hardened cookie and hides the password hash', async () => {
    await createUser(ctx, 'cookie@x.example', [ROLE_NAMES.sales]);
    const res = await ctx.http().post('/api/v1/auth/login').send({ email: 'cookie@x.example', password: PASSWORD }).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(res.body)).not.toContain('argon2');
  });

  it('uses the standard error format', async () => {
    const res = await ctx.http().post('/api/v1/auth/login').send({ email: 'not-an-email', password: 'x', extra: 1 }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.body.error.fields.map((f: { field: string }) => f.field)).toEqual(expect.arrayContaining(['email', 'extra']));
  });

  it('locks an account after repeated failures', async () => {
    await createUser(ctx, 'lock@x.example', [ROLE_NAMES.sales]);
    for (let i = 0; i < 5; i++) await ctx.http().post('/api/v1/auth/login').send({ email: 'lock@x.example', password: 'wrong' }).expect(401);
    // Even the right password is refused while locked, with the same answer as a wrong one,
    // so a locked account can't be told apart from an unknown email.
    const locked = await ctx.http().post('/api/v1/auth/login').send({ email: 'lock@x.example', password: PASSWORD }).expect(401);
    const unknown = await ctx.http().post('/api/v1/auth/login').send({ email: 'nobody@x.example', password: PASSWORD }).expect(401);
    expect(locked.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: unknown.body.error.message });
    expect(await ctx.prisma.user.findFirst({ where: { email: 'lock@x.example' }, select: { lockedUntil: true } })).toMatchObject({ lockedUntil: expect.any(Date) });
  });

  it('rate limits login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await ctx.http().post('/api/v1/auth/login').send({ email: 'ghost@x.example', password: 'wrong' })).status;
    expect(last).toBe(429);
  });

  it('does not count successful sign-ins toward the limit', async () => {
    await createUser(ctx, 'often@x.example', [ROLE_NAMES.sales]);
    for (let i = 0; i < 13; i++) await ctx.http().post('/api/v1/auth/login').send({ email: 'often@x.example', password: PASSWORD }).expect(200);
  });

  it('requires a session and a CSRF token', async () => {
    await ctx.http().get('/api/v1/auth/me').expect(401);
    await createUser(ctx, 'csrf@x.example', [ROLE_NAMES.admin]);
    const c = await login(ctx, 'csrf@x.example');
    await c.post('/auth/logout').set('X-CSRF-Token', 'wrong').expect(403);
    await c.get('/auth/me').expect(200);
  });

  it('ends other sessions when the password changes', async () => {
    await createUser(ctx, 'change@x.example', [ROLE_NAMES.sales]);
    const a = await login(ctx, 'change@x.example');
    await a.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' }).expect(400);
    await a.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'New-Password-2!' }).expect(200);
    await a.get('/auth/me').expect(401);
    await login(ctx, 'change@x.example', 'New-Password-2!');
  });

  it('forgot-password does not reveal whether an account exists', async () => {
    await ctx.http().post('/api/v1/auth/forgot-password').send({ email: 'nobody@x.example' }).expect(200);
  });

  it('resets a password once with an emailed token', async () => {
    const user = await createUser(ctx, 'reset@x.example', [ROLE_NAMES.sales]);
    await ctx.http().post('/api/v1/auth/forgot-password').send({ email: 'reset@x.example' }).expect(200);
    const mail = await ctx.prisma.emailLog.findFirstOrThrow({ where: { entityId: user.id, template: 'password-reset' } });
    const token = decodeURIComponent(/token=([^"]+)"/.exec(mail.html)![1]);
    await ctx.http().post('/api/v1/auth/reset-password').send({ token, newPassword: 'Reset-Password-3!' }).expect(200);
    await ctx.http().post('/api/v1/auth/reset-password').send({ token, newPassword: 'Reset-Password-4!' }).expect(400);
    await login(ctx, 'reset@x.example', 'Reset-Password-3!');
  });
});

describe('roles and permissions', () => {
  it('blocks users without the permission', async () => {
    await createUser(ctx, 'tech@x.example', [ROLE_NAMES.tech]);
    const t = await login(ctx, 'tech@x.example');
    await t.get('/admin/users').expect(403);
    await t.get('/admin/audit').expect(403);
    await t.get('/admin/company').expect(403);
  });

  it('roles are data: an Admin can create one and give a user several', async () => {
    await createUser(ctx, 'rbac@x.example', [ROLE_NAMES.admin]);
    const a = await login(ctx, 'rbac@x.example');
    const role = await a.post('/admin/roles', { name: 'Combined', permissions: ['admin.audit'] }).expect(201);
    await a.post('/admin/roles', { name: 'Bad', permissions: ['does.not.exist'] }).expect(400);
    const user = await createUser(ctx, 'multi@x.example', [ROLE_NAMES.sales]);
    const salesRole = await ctx.prisma.role.findUniqueOrThrow({ where: { name: ROLE_NAMES.sales } });
    await a.patch(`/admin/users/${user.id}`, { version: 1, roleIds: [salesRole.id, role.body.id] }).expect(200);
    const m = await login(ctx, 'multi@x.example');
    const me = await m.get('/auth/me').expect(200);
    expect(me.body.roles.sort()).toEqual(['Combined', ROLE_NAMES.sales].sort());
    await m.get('/admin/audit').expect(200);
  });

  it('rejects a stale edit (optimistic concurrency)', async () => {
    await createUser(ctx, 'occ@x.example', [ROLE_NAMES.admin]);
    const a = await login(ctx, 'occ@x.example');
    const user = await createUser(ctx, 'occ-target@x.example', [ROLE_NAMES.sales]);
    await a.patch(`/admin/users/${user.id}`, { version: 1, name: 'First Edit' }).expect(200);
    const res = await a.patch(`/admin/users/${user.id}`, { version: 1, name: 'Stale Edit' }).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('settings', () => {
  it('audits a control change and requires a reason', async () => {
    await createUser(ctx, 'settings@x.example', [ROLE_NAMES.admin]);
    const a = await login(ctx, 'settings@x.example');
    await a.put('/admin/settings/controls.allowSelfApproval', { value: true, version: 0 }).expect(400);
    await a.put('/admin/settings/controls.allowSelfApproval', { value: 'yes', version: 0, reason: 'x' }).expect(400);
    await a.put('/admin/settings/controls.allowSelfApproval', { value: true, version: 0, reason: 'Two-person lab' }).expect(200);
    await a.put('/admin/settings/controls.allowSelfApproval', { value: false, version: 1, reason: 'Hired a second person' }).expect(200);
    const log = await a.get('/admin/audit?entity=Setting&entityId=controls.allowSelfApproval').expect(200);
    expect(log.body.data.map((d: { reason: string }) => d.reason)).toEqual(['Hired a second person', 'Two-person lab']);
  });

  it('shows company details read-only to Admin, with the note', async () => {
    await createUser(ctx, 'company@x.example', [ROLE_NAMES.admin]);
    const a = await login(ctx, 'company@x.example');
    const res = await a.get('/admin/company').expect(200);
    expect(res.body.gstin).toBe('27AAAAA0000A1Z2');
    expect(res.body.note).toContain('Admin > Lab profile');
  });
});

describe('audit log', () => {
  it('cannot be changed, even with direct SQL', async () => {
    await expect(ctx.prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "action" = 'x'`)).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow(/append-only/);
  });
});

describe('operations', () => {
  it('exposes liveness and readiness and a request id', async () => {
    const live = await ctx.http().get('/health/live').expect(200);
    expect(live.headers['x-request-id']).toBeTruthy();
    await ctx.http().get('/health/ready').expect(200);
  });

  it('sets secure headers and allows only the configured origin', async () => {
    const res = await ctx.http().get('/api/v1/public/branding').set('Origin', 'http://app.test.example').expect(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://app.test.example');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const evil = await ctx.http().get('/api/v1/public/branding').set('Origin', 'http://evil.example').expect(200);
    expect(evil.headers['access-control-allow-origin']).not.toBe('http://evil.example');
  });
});
