import 'reflect-metadata';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { logger, reportError } from '../common/logger.js';
import { INFRA_CONFIG, type InfraConfig } from '../config/infra.config.js';
import { DOMAIN_MODULES } from '../app.module.js';
import { CoreModule } from '../core/core.module.js';
import { jobDuration, jobsTotal } from '../common/metrics.js';
import { MailService } from '../core/mail.service.js';
import { PrismaService } from '../core/prisma.service.js';
import { RedisService } from '../core/redis.service.js';
import { measureInstallation } from '../ops/collect.js';
import { WhatsappService } from '../core/whatsapp.service.js';
import { QUEUE_DOCUMENTS, QUEUE_EMAIL, QUEUE_SCHEDULED, QUEUE_WHATSAPP, redisConnection } from '../core/queue.service.js';
import { DocumentsService } from '../modules/documents/documents.service.js';
import { installErrorWebhook } from '../common/error-webhook.js';
import { SchedulerService } from '../modules/scheduler/scheduler.service.js';

@Module({ imports: [CoreModule, ...DOMAIN_MODULES] })
export class WorkerModule {}

export interface WorkerHandle {
  app: INestApplicationContext;
  workers: Worker[];
  /** every queue is being worked */
  live: () => boolean;
  /** Redis and the database answer */
  ready: () => Promise<unknown>;
  stop(): Promise<void>;
}

export async function startWorker(): Promise<WorkerHandle> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['warn', 'error'] });
  installErrorWebhook(app.get<InfraConfig>(INFRA_CONFIG).errorTrackingDsn, 'lims-worker');
  const infra = app.get<InfraConfig>(INFRA_CONFIG);
  const connection = redisConnection(infra.redisUrl);
  const mail = app.get(MailService);
  const documents = app.get(DocumentsService);
  const scheduler = app.get(SchedulerService);
  const whatsapp = app.get(WhatsappService);

  const workers = [
    new Worker(QUEUE_EMAIL, async (job) => mail.deliver(job.data.emailLogId), { connection, concurrency: 5 }),
    new Worker(QUEUE_DOCUMENTS, async (job) => documents.process(job.data.documentJobId), { connection, concurrency: 2 }),
    new Worker(QUEUE_WHATSAPP, async (job) => whatsapp.deliver(job.data.messageId), { connection, concurrency: 3 }),
    new Worker(QUEUE_SCHEDULED, async (job) => scheduler.run(job.name), { connection, concurrency: 1 }),
  ];
  for (const w of workers) {
    w.on('completed', (job) => {
      jobsTotal.inc({ queue: w.name, result: 'completed' });
      if (job.finishedOn && job.processedOn) jobDuration.observe({ queue: w.name }, (job.finishedOn - job.processedOn) / 1000);
    });
    w.on('failed', () => jobsTotal.inc({ queue: w.name, result: 'failed' }));
    w.on('failed', (job, err) => {
      // The job's ids (never its payload, which can hold email addresses) plus the full error, so failures can be traced.
      logger.error(
        {
          queue: w.name,
          jobId: job?.id,
          jobName: job?.name,
          attempts: job?.attemptsMade,
          data: job ? Object.fromEntries(Object.entries(job.data ?? {}).filter(([k]) => /Id$/.test(k))) : undefined,
          err,
        },
        'job failed',
      );
      reportError(err, { queue: w.name, jobId: job?.id });
    });
  }
  await scheduler.install();
  measureInstallation(app);
  logger.info('worker started');
  return {
    app,
    workers,
    live: () => workers.every((w) => w.isRunning()),
    ready: () => Promise.all([app.get(RedisService).client.ping(), app.get(PrismaService).$queryRaw`SELECT 1`]),
    async stop() {
      await Promise.all(workers.map((w) => w.close()));
      await app.close();
    },
  };
}
