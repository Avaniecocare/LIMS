import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService, type Tx } from '../../core/prisma.service.js';
import { DEFAULT_ROLES, PERMISSIONS } from './catalog.js';

/**
 * Keeps the Permission table in step with the code and creates default roles the first time.
 * Runs in a transaction with an advisory lock, so several API instances can start at once.
 */
export async function syncPermissions(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(727002)`;
  for (const [code, p] of Object.entries(PERMISSIONS)) {
    await tx.permission.upsert({ where: { code }, create: { code, ...p }, update: p });
  }
  if ((await tx.role.count()) > 0) return; // Role mappings belong to the Admin once they exist.
  for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
    await tx.role.create({
      data: {
        name,
        description: def.description,
        isSystem: true,
        permissions: { create: def.permissions.map((permissionCode) => ({ permissionCode })) },
      },
    });
  }
}

@Injectable()
export class RbacBootstrap implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.prisma.$transaction(syncPermissions);
  }
}
