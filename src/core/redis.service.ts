import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { INFRA_CONFIG, type InfraConfig } from '../config/infra.config.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(INFRA_CONFIG) cfg: InfraConfig) {
    this.client = new Redis(cfg.redisUrl, { maxRetriesPerRequest: 3, lazyConnect: false });
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}
