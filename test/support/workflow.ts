import type { Client, Ctx } from './harness.js';

export interface Team {
  reception: Client;
  planner: Client;
  tech: Client;
  hod: Client;
}

/** Books a job and takes the given tests through planning and assignment to the technician. */
export async function plannedTests(
  ctx: Ctx,
  team: Team,
  customerId: string,
  testIds: string[],
  options: { urgent?: boolean; specificationId?: string; dualSpecificationId?: string; samples?: number } = {},
) {
  const samples = Array.from({ length: options.samples ?? 1 }, (_, i) => ({ description: `Sample ${i + 1}` }));
  const job = (await team.reception.post('/jobs', { customerId, noQuotationReason: 'Repeat customer', urgent: options.urgent, samples }).expect(201)).body;
  const plan = (
    await team.planner
      .post('/planning/plans', {
        sampleIds: job.samples.map((s: { id: string }) => s.id),
        specificationId: options.specificationId,
        dualSpecificationId: options.dualSpecificationId,
        tests: testIds.map((testId) => ({ testId })),
      })
      .expect(201)
  ).body;
  await team.planner.post('/planning/assign', { sampleTestIds: plan.sampleTestIds, assignedToId: team.tech.userId }).expect(200);
  return { job, sampleTestIds: plan.sampleTestIds as string[] };
}

/** Enters values by parameter code, completes every stage, submits. */
export async function workTest(team: Team, id: string, valuesByCode: Record<string, string>) {
  let d = (await team.tech.get(`/tests/${id}`).expect(200)).body;
  if (d.status === 'ASSIGNED') d = (await team.tech.post(`/tests/${id}/start`, { version: d.version }).expect(200)).body;
  const values = d.results
    .filter((r: { kind: string }) => r.kind !== 'CALCULATED')
    .map((r: { parameterId: string; code: string }) => ({ parameterId: r.parameterId, value: valuesByCode[r.code] ?? '1' }));
  d = (await team.tech.put(`/tests/${id}/results`, { version: d.version, values }).expect(200)).body;
  for (const s of d.stages) {
    if (!s.completedAt) d = (await team.tech.post(`/tests/${id}/stages/${s.seq}/complete`, { version: d.version }).expect(200)).body;
  }
  return (await team.tech.post(`/tests/${id}/submit`, { version: d.version }).expect(200)).body;
}
