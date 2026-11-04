import { Injectable } from '@nestjs/common';
import { getContext } from '../common/context.js';
import { Prisma, PrismaService, type Tx } from './prisma.service.js';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

const SENSITIVE = new Set(['passwordHash', 'totpSecret', 'tokenHash']);

/** Removes secrets and makes Decimals, Dates and BigInts JSON-safe before they reach the log. */
export function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === 'object') {
    const ctor = (value as object).constructor?.name;
    if (ctor === 'Decimal' || ctor === 'i') return String(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as object)) {
      if (!SENSITIVE.has(k)) out[k] = scrub(v);
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass the transaction so the audit row commits or rolls back with the change. */
  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    const ctx = getContext();
    await (tx ?? this.prisma).auditLog.create({
      data: {
        userId: ctx?.user?.id ?? null,
        userName: ctx?.user?.name ?? null,
        ip: ctx?.ip ?? null,
        requestId: ctx?.requestId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: entry.before === undefined ? Prisma.JsonNull : (scrub(entry.before) as Prisma.InputJsonValue),
        after: entry.after === undefined ? Prisma.JsonNull : (scrub(entry.after) as Prisma.InputJsonValue),
        reason: entry.reason ?? null,
      },
    });
  }

  /** Audit + status history for one workflow transition. */
  async status(
    tx: Tx,
    e: { entity: string; entityId: string; from: string | null; to: string; reason?: string | null; jobId?: string | null; meta?: unknown },
  ): Promise<void> {
    const ctx = getContext();
    await tx.statusEvent.create({
      data: {
        entity: e.entity,
        entityId: e.entityId,
        fromStatus: e.from,
        toStatus: e.to,
        reason: e.reason ?? null,
        meta: e.meta === undefined ? Prisma.JsonNull : (scrub(e.meta) as Prisma.InputJsonValue),
        byId: ctx?.user?.id ?? null,
        byName: ctx?.user?.name ?? 'System',
        jobId: e.jobId ?? null,
      },
    });
    await this.record(
      {
        action: `${e.entity}.status`,
        entity: e.entity,
        entityId: e.entityId,
        before: { status: e.from },
        after: { status: e.to },
        reason: e.reason,
      },
      tx,
    );
  }
}
