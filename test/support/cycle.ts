import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { PASSWORD, type Client, type Ctx } from './harness.js';
import { plannedTests, workTest, type Team } from './workflow.js';

export interface FullTeam extends Team {
  reviewer: Client;
  signatory: Client;
}

/** Takes a job from booking to an issued report. */
export async function issuedJob(ctx: Ctx, team: FullTeam, customerId: string, testIds: string[], values: Record<string, string> = {}) {
  const { job, sampleTestIds } = await plannedTests(ctx, team, customerId, testIds);
  for (const id of sampleTestIds) {
    const d = await workTest(team, id, values);
    await team.hod.post(`/tests/${id}/approve`, { version: d.version }).expect(200);
  }
  const reportId = (await team.reviewer.get(`/reports?jobId=${job.id}`).expect(200)).body.data[0].id as string;
  let r = (await team.reviewer.get(`/reports/${reportId}`).expect(200)).body;
  r = (await team.reviewer.post(`/reports/${reportId}/submit`, { version: r.revisions[0].version }).expect(200)).body;
  r = (await team.reviewer.post(`/reports/${reportId}/pass-review`, { version: r.revisions[0].version }).expect(200)).body;
  r = (await team.signatory.post(`/reports/${reportId}/approve`, { version: r.revisions[0].version, password: PASSWORD }).expect(200)).body;
  const docs = ctx.app.get(DocumentsService);
  for (const p of await ctx.prisma.documentJob.findMany({ where: { kind: 'report-pdf', status: 'QUEUED' } })) await docs.process(p.id);
  r = (await team.signatory.get(`/reports/${reportId}`).expect(200)).body;
  return { job, sampleTestIds, reportId, version: r.revisions[0].version as number };
}

export async function issue(team: FullTeam, reportId: string, version: number) {
  return (await team.signatory.post(`/reports/${reportId}/issue`, { version }).expect(200)).body;
}
