import { Injectable, OnModuleInit } from '@nestjs/common';
import { currentUser } from '../../common/context.js';
import { badRequest, notFound, rule, setForbiddenHook } from '../../common/errors.js';
import { skipTake, toPage } from '../../common/pagination.dto.js';
import { AuditService } from '../../core/audit.service.js';
import { PrismaService } from '../../core/prisma.service.js';
import { RedisService } from '../../core/redis.service.js';
import { AdminService } from '../admin/admin.service.js';
import { setSensitiveExportHook } from '../documents/documents.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PERMISSIONS } from '../rbac/catalog.js';
import type { AccessRequestQuery, ApproveAccessDto, CreateAccessRequestDto } from './security.dto.js';

// TODO(rbac-decision): how long without signing in before an account is flagged as dormant (90 days chosen).
const DORMANT_DAYS = 90;
/** Refusals within ten minutes before admins are told someone keeps trying things they may not do. */
// TODO(rbac-decision): refusals within ten minutes before admins get a security alert (20 chosen).
const FORBIDDEN_ALERT_AT = 20;

/**
 * Access requests, the access review, and alerts on the events that matter for access: repeated refusals,
 * privileges widening, and bulk exports of customer or money data.
 */
const EXPORT_NAMES: Record<string, string> = {
  'customer-export': 'all customers and their contacts',
  'due-invoices-export': 'all due invoices',
  'audit-export': 'the audit log',
  'company-export': 'all of the lab’s data and files',
};

@Injectable()
export class SecurityService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly admin: AdminService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    setForbiddenHook((userId) => this.onForbidden(userId));
    setSensitiveExportHook((kind) =>
      this.alert(`${currentUser()?.name ?? 'Someone'} exported ${EXPORT_NAMES[kind] ?? kind}`, `export:${kind}:${currentUser()?.id}:${new Date().toISOString().slice(0, 13)}`),
    );
    this.admin.onPrivilegeChange = (c) => this.alert(c.summary, null);
  }

  private async alert(title: string, dedupeKey: string | null) {
    await this.audit.record({ action: 'security.alert', entity: 'Security', after: { title } });
    await this.notifications.notifyHolders(this.prisma, 'admin.users', { type: 'SECURITY_ALERT', title, link: '/admin?tab=audit', ...(dedupeKey ? { dedupeKey } : {}) });
  }

  private async onForbidden(userId: string) {
    const key = `forbidden:${userId}`;
    const n = await this.redis.client.incr(key);
    if (n === 1) await this.redis.client.expire(key, 600);
    if (n !== FORBIDDEN_ALERT_AT) return;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await this.alert(`${user?.name ?? 'A user'} was refused ${FORBIDDEN_ALERT_AT} times in ten minutes`, `forbidden:${userId}:${new Date().toISOString().slice(0, 13)}`);
  }

  // ---------------------------------------------------------------- access requests
  async request(dto: CreateAccessRequestDto) {
    const me = currentUser()!;
    const open = await this.prisma.accessRequest.findFirst({ where: { userId: me.id, page: dto.page, status: 'PENDING' } });
    if (open) throw rule('ALREADY_REQUESTED', 'You have already asked for access to this page. An administrator will answer it.');
    const recent = await this.prisma.accessRequest.count({ where: { userId: me.id, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } } });
    if (recent >= 10) throw rule('TOO_MANY_REQUESTS', 'You have made several access requests today. Wait for an answer before asking again.');
    const row = await this.prisma.accessRequest.create({ data: { userId: me.id, page: dto.page, reason: dto.reason.trim() } });
    await this.audit.record({ action: 'access.requested', entity: 'AccessRequest', entityId: row.id, after: { page: dto.page, reason: dto.reason } });
    await this.notifications.notifyHolders(this.prisma, 'admin.users', {
      type: 'ACCESS_REQUEST',
      title: `${me.name} asked for access to ${dto.page}`,
      body: dto.reason.slice(0, 200),
      link: '/admin?tab=access',
    });
    return this.dto(row.id);
  }

  async mine() {
    const rows = await this.prisma.accessRequest.findMany({ where: { userId: currentUser()!.id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true } });
    return Promise.all(rows.map((r) => this.dto(r.id)));
  }

  async list(q: AccessRequestQuery) {
    const where = q.status ? { status: q.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.accessRequest.findMany({ where, orderBy: { createdAt: 'desc' }, select: { id: true }, ...skipTake(q) }),
      this.prisma.accessRequest.count({ where }),
    ]);
    return toPage(await Promise.all(rows.map((r) => this.dto(r.id))), total, q);
  }

  private async pending(id: string) {
    const row = await this.prisma.accessRequest.findUnique({ where: { id } });
    if (!row) throw notFound('Access request');
    if (row.status !== 'PENDING') throw rule('ALREADY_DECIDED', 'This request has already been answered');
    if (row.userId === currentUser()!.id) throw badRequest('You cannot answer your own access request');
    return row;
  }

  /** Approving gives the person a role, under the same no-escalation rule as editing their roles. */
  async approve(id: string, dto: ApproveAccessDto) {
    const row = await this.pending(id);
    await this.admin.addRoleToUser(row.userId, dto.roleId);
    const me = currentUser()!;
    const role = await this.prisma.role.findUniqueOrThrow({ where: { id: dto.roleId } });
    await this.prisma.accessRequest.update({
      where: { id },
      data: { status: 'APPROVED', grantedRoleId: role.id, decidedById: me.id, decidedByName: me.name, decisionNote: dto.note?.trim() || null, decidedAt: new Date() },
    });
    await this.audit.record({ action: 'access.approved', entity: 'AccessRequest', entityId: id, after: { role: role.name, note: dto.note } });
    await this.notifications.send(this.prisma, [row.userId], {
      type: 'ACCESS_DECISION',
      title: `Your access request for ${row.page} was approved`,
      body: `You now have the role ${role.name}. Reload the page to see it.${dto.note ? ` ${dto.note}` : ''}`,
      link: row.page,
    });
    return this.dto(id);
  }

  async deny(id: string, note: string) {
    const row = await this.pending(id);
    const me = currentUser()!;
    await this.prisma.accessRequest.update({ where: { id }, data: { status: 'DENIED', decidedById: me.id, decidedByName: me.name, decisionNote: note.trim(), decidedAt: new Date() } });
    await this.audit.record({ action: 'access.denied', entity: 'AccessRequest', entityId: id, after: { note } });
    await this.notifications.send(this.prisma, [row.userId], { type: 'ACCESS_DECISION', title: `Your access request for ${row.page} was declined`, body: note, link: '/' });
    return this.dto(id);
  }

  private async dto(id: string) {
    const r = await this.prisma.accessRequest.findUniqueOrThrow({ where: { id }, include: { user: { select: { name: true, email: true, roles: { select: { role: { select: { name: true } } } } } } } });
    const granted = r.grantedRoleId ? await this.prisma.role.findUnique({ where: { id: r.grantedRoleId }, select: { name: true } }) : null;
    return {
      id: r.id,
      userId: r.userId,
      userName: r.user.name,
      userEmail: r.user.email,
      currentRoles: r.user.roles.map((x) => x.role.name),
      page: r.page,
      reason: r.reason,
      status: r.status,
      grantedRoleName: granted?.name ?? null,
      decidedByName: r.decidedByName,
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt,
      createdAt: r.createdAt,
    };
  }

  // ---------------------------------------------------------------- access review
  /** Who can do what, with the accounts that most need a second look flagged. */
  async review() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      include: { roles: { include: { role: { include: { permissions: true } } } } },
      orderBy: { name: 'asc' },
    });
    const cutoff = Date.now() - DORMANT_DAYS * 86_400_000;
    const holders = new Map<string, number>();
    const rows = users.map((u) => {
      const roles = u.roles.filter((r) => r.role.isActive && !r.role.deletedAt);
      const perms = new Set(roles.flatMap((r) => r.role.permissions.map((p) => p.permissionCode)));
      if (u.isActive) for (const p of perms) holders.set(p, (holders.get(p) ?? 0) + 1);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        isActive: u.isActive,
        roles: roles.map((r) => r.role.name),
        permissionCount: perms.size,
        lastLoginAt: u.lastLoginAt,
        adminCapable: perms.has('admin.users') || perms.has('admin.roles'),
        dormant: u.isActive && (!u.lastLoginAt || u.lastLoginAt.getTime() < cutoff),
        locked: !!u.lockedUntil && u.lockedUntil > new Date(),
        mustChangePassword: u.mustChangePassword,
        createdAt: u.createdAt,
      };
    });
    await this.audit.record({ action: 'access.reviewed', entity: 'Security', after: { users: rows.length } });
    return {
      users: rows,
      permissions: Object.entries(PERMISSIONS).map(([code, p]) => ({ code, module: p.module, description: p.description, holders: holders.get(code) ?? 0 })),
      generatedAt: new Date(),
    };
  }
}
