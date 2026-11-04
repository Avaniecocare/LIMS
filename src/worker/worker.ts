import 'reflect-metadata';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { logger, reportError } from '../common/logger.js';
import { INFRA_CONFIG, type InfraConfig } from '../config/infra.config.js';
import { CoreModule } from '../core/core.module.js';
import { MailService } from '../core/mail.service.js';
import { QUEUE_EMAIL, redisConnection } from '../core/queue.service.js';

@Module({ imports: [CoreModule] })
export class WorkerModule {}

export interface WorkerHandle {
  app: INestApplicationContext;
  workers: Worker[];
  stop(): Promise<void>;
}

export async function startWorker(): Promise<WorkerHandle> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['warn', 'error'] });
  const infra = app.get<InfraConfig>(INFRA_CONFIG);
  const connection = redisConnection(infra.redisUrl);
  const mail = app.get(MailService);

  const workers = [
    new Worker(QUEUE_EMAIL, async (job) => mail.deliver(job.data.emailLogId), { connection, concurrency: 5 }),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) => {
      logger.error({ queue: w.name, jobId: job?.id, err: err.message }, 'job failed');
      reportError(err, { queue: w.name, jobId: job?.id });
    });
  }
  logger.info('worker started');
  return {
    app,
    workers,
    async stop() {
      await Promise.all(workers.map((w) => w.close()));
      await app.close();
    },
  };
}
