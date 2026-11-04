import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeDemo, seedDemo, DEMO_PASSWORD } from '../../src/seed/demo.js';
import { loadBaseline } from '../../src/modules/rbac/baseline.js';
import { bootApp, login, resetDb, type Ctx } from '../support/harness.js';

let ctx: Ctx;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
});
afterAll(() => ctx.app.close());

describe('demo seed', () => {
  it('loads every required master and one user per role, then removes cleanly', async () => {
    await ctx.prisma.$transaction(loadBaseline);
    const baselineFormulas = await ctx.prisma.formula.count();
    expect(baselineFormulas).toBe(10);
    await seedDemo(ctx.prisma);
    await seedDemo(ctx.prisma); // idempotent

    const tests = await ctx.prisma.testMaster.findMany({ include: { method: true } });
    for (const name of ['Appearance (Visual)', 'Density', 'Flash Point (COC)', 'Kinematic Viscosity at 40°C', 'Qualitative Analysis (GC-MSD)', 'Moisture content']) {
      expect(tests.map((t) => t.name)).toContain(name);
    }
    expect(tests.find((t) => t.code === 'FP')?.method?.standardRef).toBe('IS 1448 (Part 69): 2013');
    expect(tests.find((t) => t.code === 'KV40')?.method?.standardRef).toBe('IS 1448 (Part 25): 1976 (RA 2007)');
    expect(tests.find((t) => t.code === 'MOIST')?.method?.standardRef).toBe('ISO 15512: 2019');

    // every built-in formula is used by a metallurgy demo test
    const used = await ctx.prisma.testParameter.findMany({ where: { formulaId: { not: null } }, include: { formula: true } });
    const codes = new Set(used.map((u) => u.formula!.code));
    for (const c of ['AVERAGE3', 'REMAINDER', 'CE_IIW', 'PREN', 'AREA_RECT', 'UTS', 'ROA', 'ELONGATION', 'PROOF']) expect(codes).toContain(c);

    const roles = await ctx.prisma.role.findMany({ include: { users: true } });
    for (const r of roles) expect(r.users.length, r.name).toBeGreaterThan(0);
    const admin = await login(ctx, 'admin@demo.example', DEMO_PASSWORD);
    await admin.get('/auth/me').expect(200);

    await removeDemo(ctx.prisma);
    expect(await ctx.prisma.user.count({ where: { isDemo: true } })).toBe(0);
    expect(await ctx.prisma.customer.count({ where: { isDemo: true } })).toBe(0);
    expect(await ctx.prisma.testMaster.count()).toBe(0);
    expect(await ctx.prisma.formula.count()).toBe(baselineFormulas); // baseline stays
    expect((await ctx.http().get('/api/v1/public/setup-status').expect(200)).body.setupRequired).toBe(true);
  });
});
