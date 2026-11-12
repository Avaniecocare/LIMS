import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMS_KEY, PUBLIC_KEY, SIGNED_IN_KEY } from '../../src/modules/auth/decorators.js';
import { DEFAULT_ROLES } from '../../src/modules/rbac/catalog.js';
import { bootApp, createUser, login, resetDb, type Client, type Ctx } from '../support/harness.js';

/**
 * Every route must declare who may call it: a permission (@Perm), signed-in users with a reason (@SignedIn), or
 * no session at all (@Public). Then, for every permission route and every built-in role, the API must refuse
 * exactly the roles that lack the permission.
 */
interface Route {
  method: string;
  path: string;
  perms: string[] | undefined;
  isPublic: boolean;
  signedIn: string | undefined;
}

let ctx: Ctx;
let routes: Route[];

function collectRoutes(): Route[] {
  const out: Route[] = [];
  for (const mod of ctx.app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as (new (...a: unknown[]) => object) | undefined;
      if (!ctrl) continue;
      const base = ([] as string[]).concat(Reflect.getMetadata('path', ctrl) ?? '')[0];
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        if (name === 'constructor') continue;
        const handler = ctrl.prototype[name as keyof object] as unknown as object;
        const method = Reflect.getMetadata('method', handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const sub = ([] as string[]).concat(Reflect.getMetadata('path', handler) ?? '')[0];
        const meta = <T>(key: string) => (Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, ctrl)) as T | undefined;
        out.push({
          method: RequestMethod[method],
          path: `/api/v1/${[base, sub].filter((x) => x && x !== '/').join('/')}`.replace(/\/+/g, '/'),
          perms: meta<string[]>(PERMS_KEY),
          isPublic: !!meta<boolean>(PUBLIC_KEY),
          signedIn: meta<string>(SIGNED_IN_KEY),
        });
      }
    }
  }
  return out;
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  routes = collectRoutes();
});
afterAll(() => ctx.app.close());

describe('every route declares who may call it', () => {
  it('has a permission, a signed-in reason, or is explicitly public', () => {
    expect(routes.length).toBeGreaterThan(150);
    const missing = routes.filter((r) => !r.isPublic && !r.perms?.length && !r.signedIn).map((r) => `${r.method} ${r.path}`);
    expect(missing).toEqual([]);
  });

  it('uses only permissions that exist', async () => {
    const { PERMISSIONS } = await import('../../src/modules/rbac/catalog.js');
    const unknown = routes.flatMap((r) => (r.perms ?? []).filter((p) => !PERMISSIONS[p]).map((p) => `${r.method} ${r.path}: ${p}`));
    expect(unknown).toEqual([]);
  });
});

describe('role × endpoint matrix', () => {
  it('refuses exactly the roles that hold none of the route permissions', async () => {
    const clients = new Map<string, Client>();
    for (const [i, role] of Object.keys(DEFAULT_ROLES).entries()) {
      await createUser(ctx, `matrix${i}@m.example`, [role]);
      clients.set(role, await login(ctx, `matrix${i}@m.example`));
    }
    // What each role really holds after install and upgrades, as the guard sees it.
    const roles = await ctx.prisma.role.findMany({ where: { name: { in: Object.keys(DEFAULT_ROLES) } }, include: { permissions: true } });
    const granted = new Map(roles.map((r) => [r.name, new Set(r.permissions.map((p) => p.permissionCode))]));
    expect(granted.size).toBe(Object.keys(DEFAULT_ROLES).length);
    const ID = '00000000-0000-7000-8000-000000000000';
    const problems: string[] = [];
    for (const r of routes.filter((x) => x.perms?.length)) {
      const url = r.path.replace('/api/v1', '').replace(/:[A-Za-z]+/g, (m) => (/(seq|revisionNo|no)$/i.test(m) ? '1' : m === ':key' ? 'customers' : m === ':kind' ? 'QUOTATION' : ID));
      for (const [role, held] of granted) {
        const c = clients.get(role)!;
        const call = r.method === 'GET' ? c.get(url) : r.method === 'DELETE' ? c.del(url) : r.method === 'PUT' ? c.put(url, {}) : r.method === 'PATCH' ? c.patch(url, {}) : c.post(url, {});
        const res = await call;
        const allowed = r.perms!.some((p) => held.has(p));
        if (allowed && res.status === 403 && res.body?.error?.code === 'FORBIDDEN') problems.push(`${role} refused ${r.method} ${r.path}`);
        if (!allowed && res.status !== 403) problems.push(`${role} got ${res.status} on ${r.method} ${r.path} (needs ${r.perms!.join(' or ')})`);
      }
    }
    expect(problems).toEqual([]);
  }, 600_000);
});
