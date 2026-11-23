import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { INFRA_CONFIG, type InfraConfig } from '../config/infra.config.js';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client: Redis;

  constructor(@Inject(INFRA_CONFIG) cfg: InfraConfig) {
    this.client = new Redis(cfg.redisUrl, { maxRetriesPerRequest: 3, lazyConnect: false });
  }

  /** After HTTP has drained: requests being answered still need it. */
  async onApplicationShutdown() {
    this.client.disconnect();
  }
}
