import type { INestApplicationContext } from '@nestjs/common';
import { measured } from '../common/metrics.js';
import { PrismaService } from '../core/prisma.service.js';
import { QueueService } from '../core/queue.service.js';
import { LicenceService } from '../modules/licence/licence.service.js';

/** What the worker can say about the whole installation. Only the worker, so the numbers are not counted per API copy. */
export function measureInstallation(app: INestApplicationContext): void {
  const prisma = app.get(PrismaService);
  const { email, documents, scheduled, whatsapp } = app.get(QueueService);
  const queues = [email, documents, scheduled, whatsapp];

  measured('lims_queue_jobs', 'Background jobs by queue and state', ['queue', 'state'], async () =>
    (
      await Promise.all(queues.map(async (q) => Object.entries(await q.getJobCounts('waiting', 'active', 'delayed', 'failed')).map(([state, value]) => ({ labels: { queue: q.name, state }, value }))))
    ).flat(),
  );
  measured('lims_queue_oldest_waiting_seconds', 'How long the next job has waited', ['queue'], () =>
    Promise.all(
      queues.map(async (q) => {
        const [job] = await q.getJobs(['waiting'], 0, 0, true);
        return { labels: { queue: q.name }, value: job ? Math.max(0, (Date.now() - job.timestamp) / 1000) : 0 };
      }),
    ),
  );
  measured('lims_emails_failed', 'Emails given up on in the last day', [], async () => [
    { value: await prisma.emailLog.count({ where: { status: 'FAILED', createdAt: { gt: new Date(Date.now() - 86_400_000) } } }) },
  ]);
  measured('lims_whatsapp_failed', 'WhatsApp messages that failed in the last day', [], async () => [
    { value: await prisma.whatsappMessage.count({ where: { status: 'FAILED', createdAt: { gt: new Date(Date.now() - 86_400_000) } } }) },
  ]);
  measured('lims_einvoices_unregistered', 'GST documents not registered: failed, or sent with no clear answer', ['reason'], async () => [
    { labels: { reason: 'failed' }, value: await prisma.eInvoice.count({ where: { status: 'FAILED', uncertain: false } }) },
    { labels: { reason: 'uncertain' }, value: await prisma.eInvoice.count({ where: { status: { in: ['FAILED', 'PENDING'] }, uncertain: true, updatedAt: { lt: new Date(Date.now() - 300_000) } } }) },
  ]);
  measured('lims_documents_failed', 'PDFs and exports that failed in the last day', [], async () => [
    { value: await prisma.documentJob.count({ where: { status: 'FAILED', createdAt: { gt: new Date(Date.now() - 86_400_000) } } }) },
  ]);
  measured('lims_licence_days_left', 'Days until the licence ends; absent when none is needed', ['kind'], async () => {
    const s = await app.get(LicenceService).status();
    return s.daysLeft === null || !s.licence ? [] : [{ labels: { kind: s.licence.kind }, value: s.daysLeft }];
  });
  measured('lims_read_only', '1 when the licence has ended and nothing can be saved', [], async () => [{ value: (await app.get(LicenceService).status()).readOnly ? 1 : 0 }]);
}
