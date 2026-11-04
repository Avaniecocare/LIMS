import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Ctx } from '../support/harness.js';

/** Production runs the app as a role that owns nothing. Everything must still work under it. */
const ROLE = 'lims_app_test';
let ctx: Ctx;
let admin: pg.Client;
const original = process.env.DATABASE_URL!;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: original });
  await admin.connect();
  await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN PASSWORD 'test-password'; END IF; END $$`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
  await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);
  const owner = await bootApp();
  await resetDb(owner);
  await owner.app.close();
  const url = new URL(original);
  url.username = ROLE;
  url.password = 'test-password';
  process.env.DATABASE_URL = url.toString();
  ctx = await bootApp();
});

afterAll(async () => {
  await ctx.app.close();
  process.env.DATABASE_URL = original;
  await admin.end();
});

describe('the restricted application role', () => {
  it('runs the app: login, audit, numbering, workflow writes', async () => {
    await createUser(ctx, 'role-admin@x.example', [ROLE_NAMES.admin]);
    const a = await login(ctx, 'role-admin@x.example');
    const c = (await a.post('/customers', { name: 'Role Co', stateName: 'Maharashtra', stateCode: '27' }).expect(201)).body;
    expect(c.crn).toMatch(/^CRN-/);
    expect((await a.get(`/customers/${c.id}/history`).expect(200)).body).toHaveLength(1);
    const f = await a.post('/masters/formula-console', { expression: 'a + 1', inputs: { a: '1' } }).expect(200);
    expect(f.body.value).toBe('2.00');
  });

  it('cannot change the audit log or its protection', async () => {
    await expect(ctx.prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "action" = 'x'`)).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/append-only/);
    await expect(ctx.prisma.$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow(/permission denied/);
    await expect(ctx.prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER USER`)).rejects.toThrow(/must be owner/);
    await expect(ctx.prisma.$executeRawUnsafe(`DROP TABLE "AuditLog"`)).rejects.toThrow(/must be owner/);
    await expect(ctx.prisma.$executeRawUnsafe(`DROP TRIGGER audit_log_no_change ON "AuditLog"`)).rejects.toThrow(/must be owner/);
  });
});
