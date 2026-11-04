import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { billingFixture } from '../support/fixtures.js';
import { bluepeak, greenfield } from '../support/company-env.js';
import { bootApp, createUser, login, PASSWORD, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';
import { plannedTests, workTest, type Team } from '../support/workflow.js';

let ctx: Ctx;
let admin: Client, reviewer: Client, signatory: Client;
let team: Team;
let fx: Awaited<ReturnType<typeof billingFixture>>;

beforeAll(async () => {
  Object.assign(process.env, greenfield); // NABL mode on
  ctx = await bootApp();
  await resetDb(ctx);
  for (const [e, r] of Object.entries({ admin: ROLE_NAMES.admin, reception: ROLE_NAMES.reception, planner: ROLE_NAMES.planner, tech: ROLE_NAMES.tech, hod: ROLE_NAMES.hod, reviewer: ROLE_NAMES.reviewer, signatory: ROLE_NAMES.signatory })) await createUser(ctx, `${e}@n.example`, [r], `${e} person`);
  const c = (n: string) => login(ctx, `${n}@n.example`);
  admin = await c('admin');
  reviewer = await c('reviewer');
  signatory = await c('signatory');
  team = { reception: await c('reception'), planner: await c('planner'), tech: await c('tech'), hod: await c('hod') };
  fx = await billingFixture(admin, ctx);
  const method = (await admin.post('/masters/test-methods', { code: 'M-A', name: 'Accredited method', accredited: true }).expect(201)).body;
  const expired = (await admin.post('/masters/test-methods', { code: 'M-X', name: 'Expired method', accredited: true, accreditedUntil: '2020-01-01' }).expect(201)).body;
  const patch = async (id: string, code: string, name: string, methodId: string, accredited: boolean) => {
    const t = (await admin.get(`/masters/tests/${id}`).expect(200)).body;
    await admin.patch(`/masters/tests/${id}`, { code, name, methodId, accredited, version: t.version }).expect(200);
  };
  await patch(fx.tests.d, 'DEN', 'Density', method.id, true);
  await patch(fx.tests.a, 'APP', 'Appearance', method.id, true);
  await patch(fx.tests.f, 'FP', 'Flash Point', expired.id, true);
  await admin.post('/masters/test-parameters', { testId: fx.tests.d, code: 'IN', name: 'In-scope element', accredited: true, sortOrder: 1 }).expect(201);
  await admin.post('/masters/test-parameters', { testId: fx.tests.d, code: 'OUT', name: 'Out-of-scope element', accredited: false, sortOrder: 2 }).expect(201);
  await admin.post('/masters/test-parameters', { testId: fx.tests.d, code: 'LAPSED', name: 'Lapsed element', accredited: true, accreditedUntil: '2020-01-01', sortOrder: 3 }).expect(201);
  await admin.post('/masters/test-parameters', { testId: fx.tests.f, code: 'FLASH', name: 'Flash result', accredited: true }).expect(201);
  await admin.post('/masters/test-parameters', { testId: fx.tests.k, code: 'VISC', name: 'Viscosity result', accredited: true }).expect(201);
});
afterAll(async () => {
  Object.assign(process.env, bluepeak);
  await ctx.app.close();
});

async function approveAll(testIds: string[]) {
  const { job, sampleTestIds } = await plannedTests(ctx, team, fx.intra.id, testIds);
  for (const id of sampleTestIds) {
    const d = await workTest(team, id, {});
    await team.hod.post(`/tests/${id}/approve`, { version: d.version }).expect(200);
  }
  const reportId = (await reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data[0].id as string;
  let r = (await reviewer.get(`/reports/${reportId}`).expect(200)).body;
  r = (await reviewer.post(`/reports/${reportId}/submit`, { version: r.revisions[0].version }).expect(200)).body;
  r = (await reviewer.post(`/reports/${reportId}/pass-review`, { version: r.revisions[0].version }).expect(200)).body;
  r = (await signatory.post(`/reports/${reportId}/approve`, { version: r.revisions[0].version, password: PASSWORD }).expect(200)).body;
  return { reportId, r };
}

describe('NABL mode', () => {
  it('splits scope on the report, respects validity dates, and generates a ULR from the configured format', async () => {
    const { reportId, r } = await approveAll([fx.tests.d]);
    expect(r.revisions[0].ulrNumber).toMatch(/^TC00000\d\d-\d\d\d{8}F$/);
    const { html } = (await signatory.get(`/reports/${reportId}/preview`).expect(200)).body;
    const inAt = html.indexOf('within the scope');
    const outAt = html.indexOf('outside the scope');
    expect(inAt).toBeGreaterThan(-1);
    expect(outAt).toBeGreaterThan(inAt);
    const inScope = html.slice(inAt, outAt);
    const outScope = html.slice(outAt);
    expect(inScope).toContain('In-scope element');
    expect(outScope).toContain('Out-of-scope element');
    expect(outScope).toContain('Lapsed element'); // validity date passed
    expect(html).toContain('TC-00000');
    expect(html).toContain('ULR:');
  });

  it('gives no ULR when nothing on the report is in scope', async () => {
    const lapsedMethod = await approveAll([fx.tests.f]); // method accreditation expired
    expect(lapsedMethod.r.revisions[0].ulrNumber).toBeNull();
    const noMethod = await approveAll([fx.tests.k]); // no accredited method at all
    expect(noMethod.r.revisions[0].ulrNumber).toBeNull();
  });
});
