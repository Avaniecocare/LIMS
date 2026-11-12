import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, createUser, login, PASSWORD, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';

/** Access control: escalation, re-authentication, sessions, access requests, IDOR and alerts. */
let ctx: Ctx;
let admin: Client, admin2: Client, tech: Client;
const roleId = async (name: string) => (await ctx.prisma.role.findFirstOrThrow({ where: { name } })).id;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  await createUser(ctx, 'admin@sec.example', [ROLE_NAMES.admin], 'Admin One');
  await createUser(ctx, 'admin2@sec.example', [ROLE_NAMES.admin], 'Admin Two');
  await createUser(ctx, 'tech@sec.example', [ROLE_NAMES.tech], 'Tara Tech');
  [admin, admin2, tech] = await Promise.all([login(ctx, 'admin@sec.example'), login(ctx, 'admin2@sec.example'), login(ctx, 'tech@sec.example')]);
});
afterAll(() => ctx.app.close());

describe('no privilege escalation', () => {
  it('someone who manages users can only give roles within their own permissions', async () => {
    const mgr = (await admin.post('/admin/roles', { name: 'User manager', permissions: ['admin.users', 'customers.view'] }).expect(201)).body;
    const viewer = (await admin.post('/admin/roles', { name: 'Customer viewer', permissions: ['customers.view'] }).expect(201)).body;
    await createUser(ctx, 'mgr@sec.example', ['User manager']);
    const m = await login(ctx, 'mgr@sec.example');
    const body = (roleIds: string[], email: string) => ({ email, name: 'New Person', password: PASSWORD, roleIds });
    const refused = await m.post('/admin/users', body([await roleId(ROLE_NAMES.admin)], 'x1@sec.example')).expect(403);
    expect(refused.body.error.message).toContain('Admin');
    await m.post('/admin/users', body([viewer.id], 'x2@sec.example')).expect(201);
    // Nor can they promote themselves.
    const me = (await m.get('/auth/me').expect(200)).body;
    const self = (await m.get(`/admin/users/${me.id}`).expect(200)).body;
    await m.patch(`/admin/users/${me.id}`, { version: self.version, roleIds: [mgr.id, await roleId(ROLE_NAMES.admin)] }).expect(403);
  });

  it('a full administrator can still create technicians, though Admin itself does not work tests', async () => {
    await admin.post('/admin/users', { email: 'newtech@sec.example', name: 'New Technician', password: PASSWORD, roleIds: [await roleId(ROLE_NAMES.tech)] }).expect(201);
    await admin.post('/admin/roles', { name: 'Bench lead', permissions: ['tests.work', 'tests.approve'] }).expect(201);
  });

  it('someone who edits roles cannot add permissions they do not hold', async () => {
    const editor = (await admin.post('/admin/roles', { name: 'Role editor', permissions: ['admin.roles'] }).expect(201)).body;
    await createUser(ctx, 'roles@sec.example', ['Role editor']);
    const r = await login(ctx, 'roles@sec.example');
    await r.patch(`/admin/roles/${editor.id}`, { version: editor.version, permissions: ['admin.roles', 'invoices.edit'] }).expect(403);
    await r.post('/admin/roles', { name: 'Sneaky', permissions: ['admin.users'] }).expect(403);
  });
});

describe('sensitive actions need the password confirmed', () => {
  it('asks again before giving roles or exporting every customer', async () => {
    const fresh = await login(ctx, 'admin@sec.example', PASSWORD, { reauth: false });
    const res = await fresh.post('/admin/users', { email: 'y@sec.example', name: 'Yusuf Khan', password: PASSWORD, roleIds: [await roleId(ROLE_NAMES.sales)] }).expect(403);
    expect(res.body.error.code).toBe('REAUTH_REQUIRED');
    const exp = await fresh.post('/documents', { kind: 'customer-export', params: {} });
    expect(exp.body.error?.code, JSON.stringify(exp.body)).toBe('REAUTH_REQUIRED');
    await fresh.post('/auth/confirm-password', { password: 'wrong' }).expect(403);
    await fresh.post('/auth/confirm-password', { password: PASSWORD }).expect(200);
    await fresh.post('/admin/users', { email: 'y@sec.example', name: 'Yusuf Khan', password: PASSWORD, roleIds: [await roleId(ROLE_NAMES.sales)] }).expect(201);
    await fresh.post('/documents', { kind: 'customer-export', params: {} }).expect(201);
  });
});

describe('sessions', () => {
  it('lists where you are signed in and signs out everywhere else', async () => {
    await createUser(ctx, 'roaming@sec.example', [ROLE_NAMES.tech]);
    const laptop = await login(ctx, 'roaming@sec.example');
    const phone = await login(ctx, 'roaming@sec.example');
    const sessions = (await laptop.get('/auth/sessions').expect(200)).body;
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(JSON.stringify(sessions)).not.toContain(laptop.csrf);
    expect((await laptop.del('/auth/sessions').expect(200)).body.revoked).toBeGreaterThanOrEqual(1);
    await phone.get('/auth/me').expect(401);
    await laptop.get('/auth/me').expect(200);
  });

  it('shows your own sign-in history, failed attempts included', async () => {
    await ctx.http().post('/api/v1/auth/login').send({ email: 'tech@sec.example', password: 'wrong' }).expect(401);
    const t = await login(ctx, 'tech@sec.example');
    const history = (await t.get('/auth/sign-ins').expect(200)).body;
    expect(history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['auth.login', 'auth.login.failed']));
  });
});

describe('access requests', () => {
  it('a person asks, an admin approves with a role, the person is told and gets access', async () => {
    await tech.get('/invoices').expect(403);
    const req = (await tech.post('/access-requests', { page: '/invoices', reason: 'I cover for accounts on Saturdays' }).expect(201)).body;
    await tech.post('/access-requests', { page: '/invoices', reason: 'again' }).expect(422);
    await tech.get('/access-requests').expect(403);
    expect((await admin2.get('/notifications').expect(200)).body.data.some((n: { type: string }) => n.type === 'ACCESS_REQUEST')).toBe(true);
    const listed = (await admin.get('/access-requests?status=PENDING').expect(200)).body;
    expect(listed.data[0]).toMatchObject({ id: req.id, userName: 'Tara Tech', page: '/invoices' });
    await admin.post(`/access-requests/${req.id}/approve`, { roleId: await roleId(ROLE_NAMES.accounts), note: 'Saturdays only' }).expect(201);
    await admin.post(`/access-requests/${req.id}/deny`, { note: 'too late' }).expect(422);
    await tech.get('/invoices').expect(200);
    const notes = (await tech.get('/notifications').expect(200)).body.data;
    expect(notes.find((n: { type: string }) => n.type === 'ACCESS_DECISION').title).toContain('approved');
  });

  it('a declined request says why', async () => {
    const req = (await tech.post('/access-requests', { page: '/admin', reason: 'Curious' }).expect(201)).body;
    const denied = (await admin.post(`/access-requests/${req.id}/deny`, { note: 'Not part of your work' }).expect(201)).body;
    expect(denied).toMatchObject({ status: 'DENIED', decisionNote: 'Not part of your work', decidedByName: 'Admin One' });
  });
});

describe('access review', () => {
  it('flags admin-capable and dormant accounts for admins only', async () => {
    const review = (await admin.get('/admin/access-review').expect(200)).body;
    const a = review.users.find((u: { email: string }) => u.email === 'admin@sec.example');
    expect(a).toMatchObject({ adminCapable: true, dormant: false });
    const never = review.users.find((u: { email: string }) => u.email === 'x2@sec.example');
    expect(never.dormant).toBe(true);
    expect(review.permissions.find((p: { code: string }) => p.code === 'admin.users').holders).toBeGreaterThanOrEqual(2);
    await tech.get('/admin/access-review').expect(403);
  });
});

describe('IDOR and alerts', () => {
  it('a document the system queued cannot be read by anyone through the API', async () => {
    const job = await ctx.prisma.documentJob.create({ data: { kind: 'report-pdf', params: {}, status: 'DONE' } });
    await admin.get(`/documents/${job.id}`).expect(403);
  });

  it('tells admins when someone is refused again and again, and when access widens', async () => {
    for (let i = 0; i < 20; i++) await tech.get('/admin/users').expect(403);
    await new Promise((r) => setTimeout(r, 200));
    const alerts = (await admin2.get('/notifications').expect(200)).body.data.filter((n: { type: string }) => n.type === 'SECURITY_ALERT');
    expect(alerts.some((n: { title: string }) => n.title.includes('refused 20 times'))).toBe(true);
    expect(alerts.some((n: { title: string }) => n.title.includes('gave Tara Tech the role Accounts'))).toBe(true);
  });
});
