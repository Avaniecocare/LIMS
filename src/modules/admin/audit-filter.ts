import type { Prisma } from '../../core/prisma.service.js';

export interface AuditFilter {
  entity?: string;
  entityId?: string;
  action?: string;
  userId?: string;
  from?: string;
  to?: string;
  q?: string;
}

/** What the audit screen shows, and what its export contains. Days are Indian days. */
export function auditWhere(f: AuditFilter): Prisma.AuditLogWhereInput {
  const contains = { contains: f.q, mode: 'insensitive' } as const;
  return {
    ...(f.entity ? { entity: f.entity } : {}),
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.action ? { action: { startsWith: f.action } } : {}),
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.from || f.to ? { at: { ...(f.from ? { gte: new Date(`${f.from.slice(0, 10)}T00:00:00+05:30`) } : {}), ...(f.to ? { lte: new Date(`${f.to.slice(0, 10)}T23:59:59.999+05:30`) } : {}) } } : {}),
    ...(f.q ? { OR: [{ userName: contains }, { action: contains }, { entity: contains }, { entityId: contains }, { reason: contains }] } : {}),
  };
}
