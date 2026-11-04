import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { INFRA_CONFIG, type InfraConfig } from '../config/infra.config.js';

export const QUEUE_EMAIL = 'email';
export const QUEUE_DOCUMENTS = 'documents';
export const QUEUE_SCHEDULED = 'scheduled';

export const redisConnection = (url: string) => {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
};

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly email: Queue;
  readonly documents: Queue;
  readonly scheduled: Queue;

  constructor(@Inject(INFRA_CONFIG) cfg: InfraConfig) {
    const connection = redisConnection(cfg.redisUrl);
    const defaultJobOptions = {
      attempts: 5,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    };
    this.email = new Queue(QUEUE_EMAIL, { connection, defaultJobOptions });
    this.documents = new Queue(QUEUE_DOCUMENTS, { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 2 } });
    this.scheduled = new Queue(QUEUE_SCHEDULED, { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 2 } });
  }

  async onModuleDestroy() {
    await Promise.all([this.email.close(), this.documents.close(), this.scheduled.close()]);
  }
}
