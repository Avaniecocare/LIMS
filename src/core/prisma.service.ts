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
    super({ adapter: new PrismaPg({ connectionString: cfg.databaseUrl, max: cfg.databasePoolSize }) });
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
      adapter: new PrismaPg({ connectionString: cfg.databaseReadUrl ?? cfg.databaseUrl, max: cfg.databasePoolSize }),
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
