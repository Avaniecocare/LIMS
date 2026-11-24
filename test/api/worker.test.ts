import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registry } from '../../src/common/metrics.js';
import { QueueService } from '../../src/core/queue.service.js';
import { StatusService } from '../../src/modules/operations/status.service.js';
import { startWorker, type WorkerHandle } from '../../src/worker/worker.js';
import { bootApp, resetDb, type Ctx } from '../support/harness.js';

/** The worker as a running process: it takes jobs, says how it is, and stops cleanly. */
let ctx: Ctx;
let worker: WorkerHandle;
beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  worker = await startWorker();
});
afterAll(async () => {
  await worker.stop();
  await ctx.app.close();
});

describe('the worker', () => {
  it('is alive and ready, sends a queued email, and counts it', async () => {
    expect(worker.live()).toBe(true);
    await worker.ready();
    const log = await ctx.prisma.emailLog.create({ data: { toAddress: 'a@b.example', subject: 'x', template: 'x', html: 'x' } });
    await ctx.app.get(QueueService).email.add('send', { emailLogId: log.id });
    await expect.poll(async () => (await ctx.prisma.emailLog.findUniqueOrThrow({ where: { id: log.id } })).status, { timeout: 15_000 }).toBe('SENT');
    await expect.poll(async () => await registry.metrics(), { timeout: 5_000 }).toContain('lims_jobs_total{queue="email",result="completed"} 1');
  }, 30_000);

  it('makes a data export, and is seen by the status page', async () => {
    const row = await ctx.prisma.dataExport.create({ data: { requestedById: 'nobody', requestedByName: 'Asha Admin' } });
    await ctx.prisma.user.create({ data: { id: 'nobody', email: 'nobody@x.example', name: 'Asha Admin', passwordHash: 'x' } });
    await ctx.app.get(QueueService).documents.add('company-export', { exportId: row.id }, { attempts: 1 });
    await expect.poll(async () => (await ctx.prisma.dataExport.findUniqueOrThrow({ where: { id: row.id } })).status, { timeout: 20_000 }).toBe('DONE');
    const { checks } = await ctx.app.get(StatusService).status();
    expect(checks.find((c) => c.key === 'worker')).toMatchObject({ state: 'OK' });
  }, 30_000);

  it('reports the state of the installation without naming anyone in it', async () => {
    await ctx.prisma.emailLog.create({ data: { toAddress: 'private.person@customer.example', subject: 'Report for Secret Ltd', template: 'x', html: 'x', status: 'FAILED' } });
    const text = await registry.metrics();
    for (const name of [
      'lims_queue_jobs{queue="documents",state="waiting"} 0',
      'lims_queue_oldest_waiting_seconds{queue="email"} 0',
      'lims_emails_failed 1',
      'lims_whatsapp_failed 0',
      'lims_einvoices_unregistered{reason="uncertain"} 0',
      'lims_documents_failed 0',
      'lims_read_only 0',
    ])
      expect(text).toContain(name);
    expect(text).not.toMatch(/customer\.example|Secret/);
    expect(text).not.toMatch(/^lims_licence_days_left/m); // none is needed, so there is no number to alarm on
  });

  it('is no longer alive once stopped', async () => {
    const second = await startWorker();
    await second.stop();
    expect(second.live()).toBe(false);
  }, 30_000);
});
