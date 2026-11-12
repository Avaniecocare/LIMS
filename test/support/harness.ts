import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { createApp } from '../../src/bootstrap.js';
import { PrismaService } from '../../src/core/prisma.service.js';
import { CompanyService } from '../../src/core/company.service.js';
import { RedisService } from '../../src/core/redis.service.js';
import argon2 from 'argon2';

export const PASSWORD = 'Test-Password-1!';
let cachedHash: string | undefined;

export interface Ctx {
  app: NestFastifyApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
}

export async function bootApp(): Promise<Ctx> {
  const app = await createApp();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, prisma: app.get(PrismaService), http: () => request(app.getHttpServer()) };
}

/** Empties business tables between suites. The audit log is append-only, so it needs the trigger off. */
export async function resetDb(ctx: Ctx) {
  const tables = await ctx.prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'Permission', 'Role', 'RolePermission')`;
  await ctx.prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER USER`);
  await ctx.prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(',')} CASCADE`);
  await ctx.prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER USER`);
  // Roles survive the reset so permissions need not be rebuilt, except those a test invented.
  await ctx.prisma.rolePermission.deleteMany({ where: { role: { isSystem: false } } });
  await ctx.prisma.role.deleteMany({ where: { isSystem: false } });
  await ctx.app.get(RedisService).client.flushdb();
  // The lab profile lives in the database too: start this test file's from its own environment, not one left behind.
  const company = ctx.app.get(CompanyService) as unknown as { seed: () => Promise<void>; reload: () => Promise<void> };
  await company.seed();
  await company.reload();
}

export async function createUser(ctx: Ctx, email: string, roleNames: string[], name = email.split('@')[0]) {
  cachedHash ??= await argon2.hash(PASSWORD);
  const roles = await ctx.prisma.role.findMany({ where: { name: { in: roleNames } } });
  return ctx.prisma.user.create({
    data: {
      email,
      name,
      designation: 'Staff',
      passwordHash: cachedHash,
      passwordChangedAt: new Date(Date.now() - 5000),
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
}

export interface Client {
  get(url: string): request.Test;
  post(url: string, body?: object): request.Test;
  put(url: string, body?: object): request.Test;
  patch(url: string, body?: object): request.Test;
  del(url: string): request.Test;
  csrf: string;
  userId: string;
}

/** Signs in; by default also confirms the password, as a person does before sensitive admin actions. */
export async function login(ctx: Ctx, email: string, password = PASSWORD, options: { reauth?: boolean } = {}): Promise<Client> {
  const res = await ctx.http().post('/api/v1/auth/login').send({ email, password }).expect(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  const cookie = raw[0].split(';')[0];
  const csrf: string = res.body.user.csrfToken;
  const wrap = (t: request.Test) => t.set('Cookie', cookie).set('X-CSRF-Token', csrf);
  const client: Client = {
    csrf,
    userId: res.body.user.id,
    get: (url) => wrap(ctx.http().get(`/api/v1${url}`)),
    post: (url, body) => {
      const t = wrap(ctx.http().post(`/api/v1${url}`));
      return body === undefined ? t : t.send(body);
    },
    put: (url, body) => wrap(ctx.http().put(`/api/v1${url}`)).send(body ?? {}),
    patch: (url, body) => wrap(ctx.http().patch(`/api/v1${url}`)).send(body ?? {}),
    del: (url) => wrap(ctx.http().delete(`/api/v1${url}`)),
  };
  // Users who must change their password first can't confirm it; they only use the auth routes.
  if (options.reauth !== false && !res.body.user.mustChangePassword) await client.post('/auth/confirm-password', { password }).expect(200);
  return client;
}

export const ROLE_NAMES = {
  admin: 'Admin',
  sales: 'Sales / Business Development',
  reception: 'Sample Reception',
  planner: 'Lab Manager / Planner',
  tech: 'Technician / Analyst',
  hod: 'Head of Department',
  reviewer: 'Report Reviewer',
  signatory: 'Authorised Signatory',
  dispatch: 'Dispatch',
  accounts: 'Accounts',
  management: 'Management',
} as const;
