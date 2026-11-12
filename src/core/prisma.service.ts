import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { conflict } from '../common/errors.js';
import { INFRA_CONFIG, type InfraConfig } from '../config/infra.config.js';

export type Tx = Prisma.TransactionClient;
export { Prisma };

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(INFRA_CONFIG) cfg: InfraConfig) {
    // Big bookings and plans run many statements in one transaction; Prisma's 5-second default turns them into errors.
    super({ adapter: new PrismaPg({ connectionString: cfg.databaseUrl, max: cfg.databasePoolSize }), transactionOptions: { timeout: 30_000, maxWait: 10_000 } });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/**
 * Read layer for reports and dashboards. Points at DATABASE_READ_URL when configured,
 * so moving these queries to a replica is a configuration change only.
 */
@Injectable()
export class ReadPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(INFRA_CONFIG) cfg: InfraConfig) {
    super({
      // Without a replica this is a second pool on the same database, so keep it small.
      adapter: new PrismaPg({ connectionString: cfg.databaseReadUrl ?? cfg.databaseUrl, max: cfg.databaseReadUrl ? cfg.databasePoolSize : Math.max(2, Math.ceil(cfg.databasePoolSize / 4)) }),
    });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** Optimistic concurrency: the update only lands if the caller saw the latest version. */
export async function updateVersioned<D extends object>(
  delegate: { updateMany: (args: { where: { id: string; version: number }; data: never }) => Promise<{ count: number }> },
  id: string,
  expectedVersion: number,
  data: D,
): Promise<void> {
  const { count } = await delegate.updateMany({
    where: { id, version: expectedVersion },
    data: { ...data, version: { increment: 1 } } as never,
  });
  if (count !== 1) throw conflict();
}
