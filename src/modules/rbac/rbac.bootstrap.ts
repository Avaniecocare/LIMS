import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService, type Tx } from '../../core/prisma.service.js';
import { loadBaseline } from './baseline.js';
import { DEFAULT_ROLES, PERMISSIONS, ROLE_UPGRADES } from './catalog.js';

/**
 * Keeps the Permission table in step with the code and creates default roles the first time.
 * Runs in a transaction with an advisory lock, so several API instances can start at once.
 */
export async function syncPermissions(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(727002)`;
  for (const [code, p] of Object.entries(PERMISSIONS)) {
    await tx.permission.upsert({ where: { code }, create: { code, ...p }, update: p });
  }
  const fresh = (await tx.role.count()) === 0;
  if (fresh) {
    for (const [name, def] of Object.entries(DEFAULT_ROLES)) await createRole(tx, name, def);
  }
  // Role mappings belong to the Admin once they exist; upgrades only add, and each runs once.
  for (const upgrade of ROLE_UPGRADES) {
    if (await tx.setting.findUnique({ where: { key: upgrade.key } })) continue;
    // Fresh installs get the same grants, so every deployment ends up with one set of defaults.
    for (const name of upgrade.createRoles) {
      if (!(await tx.role.findFirst({ where: { name } }))) await createRole(tx, name, DEFAULT_ROLES[name]);
    }
    for (const [permissionCode, roleNames] of Object.entries(upgrade.grants)) {
      const roles = await tx.role.findMany({ where: { name: { in: roleNames }, isSystem: true }, select: { id: true } });
      for (const r of roles) await tx.rolePermission.upsert({ where: { roleId_permissionCode: { roleId: r.id, permissionCode } }, create: { roleId: r.id, permissionCode }, update: {} });
    }
    await tx.setting.create({ data: { key: upgrade.key, value: true } });
  }
}

async function createRole(tx: Tx, name: string, def: { description: string; permissions: string[] }) {
  await tx.role.create({
    data: { name, description: def.description, isSystem: true, permissions: { create: def.permissions.map((permissionCode) => ({ permissionCode })) } },
  });
}

@Injectable()
export class RbacBootstrap implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.prisma.$transaction(syncPermissions);
    await this.prisma.$transaction(loadBaseline);
  }
}
