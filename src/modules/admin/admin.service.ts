import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { can, currentUser } from '../../common/context.js';
import { badRequest, forbidden, notFound, requireRecentAuth } from '../../common/errors.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { Prisma, PrismaService, updateVersioned, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { assertPasswordPolicy } from '../auth/auth.service.js';
import { SessionService } from '../auth/session.service.js';
import { PERMISSIONS } from '../rbac/catalog.js';
import type { AuditQuery, CreateRoleDto, CreateSavedFilterDto, CreateUserDto, UpdateRoleDto, UpdateUserDto, UserListQuery } from './admin.dto.js';

const userInclude = { roles: { include: { role: { select: { id: true, name: true } } } } } as const;
type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

const toUserDto = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  designation: u.designation,
  phone: u.phone,
  departmentId: u.departmentId,
  isActive: u.isActive,
  totpEnabled: u.totpEnabled,
  lastLoginAt: u.lastLoginAt,
  signatureFileId: u.signatureFileId,
  version: u.version,
  roles: u.roles.map((r) => r.role),
});

/**
 * Someone who manages both users and roles is a full administrator: they set up every role, including ones whose
 * work they deliberately don't do (Admin has no tests.work, so it can't enter results). They may give any role and
 * grant any permission; every such change is audited and alerts the other administrators. Anyone holding only one of
 * the two is limited to what they hold, so a delegated user manager or role editor cannot widen their own access.
 * TODO(rbac-decision): whether full administrators should also be barred from giving themselves working roles.
 */
const isFullAdministrator = () => can('admin.users') && can('admin.roles');

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly company: CompanyService,
    private readonly sessions: SessionService,
  ) {}

  // ------------------------------------------------------------- users
  async listUsers(q: UserListQuery) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } : {}),
      ...(q.role ? { roles: { some: { role: { name: q.role } } } } : {}),
      ...(q.active ? { isActive: q.active === 'true' } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, include: userInclude, orderBy: orderBy(q, ['name', 'email', 'lastLoginAt'], 'name', 'asc'), ...skipTake(q) }),
      this.prisma.user.count({ where }),
    ]);
    return toPage(rows.map(toUserDto), total, q);
  }

  async getUser(id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, include: userInclude });
    if (!u) throw notFound('User');
    return toUserDto(u);
  }

  async createUser(dto: CreateUserDto) {
    requireRecentAuth();
    assertPasswordPolicy(dto.password, 'password');
    const passwordHash = await argon2.hash(dto.password);
    const email = dto.email.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      await this.assertRolesExist(tx, dto.roleIds);
      await this.assertCanGrant(tx, dto.roleIds);
      const u = await tx.user.create({
        data: {
          email,
          name: dto.name,
          passwordHash,
          designation: dto.designation,
          phone: dto.phone,
          departmentId: dto.departmentId,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          roles: { create: dto.roleIds.map((roleId) => ({ roleId })) },
        },
        include: userInclude,
      });
      await this.audit.record({ action: 'user.create', entity: 'User', entityId: u.id, after: toUserDto(u) }, tx);
      if (dto.roleIds.length) await this.onPrivilegeChange?.({ summary: `${currentUser()?.name ?? 'Someone'} created ${u.name} with ${u.roles.map((r) => r.role.name).join(', ')}`, userId: u.id });
      return toUserDto(u);
    });
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    const { version, roleIds, ...fields } = dto;
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findFirst({ where: { id, deletedAt: null }, include: userInclude });
      if (!before) throw notFound('User');
      if (dto.isActive === false && id === currentUser()?.id) throw badRequest('You cannot deactivate your own account');
      // Changing who has which roles, or switching an account off, needs the password confirmed.
      const rolesChange = roleIds !== undefined && (roleIds.length !== before.roles.length || roleIds.some((r) => !before.roles.some((x) => x.roleId === r)));
      if (rolesChange || (dto.isActive === false && before.isActive)) {
        requireRecentAuth();
        await this.assertCanManage(tx, id);
      }
      await updateVersioned(tx.user as never, id, version, fields);
      if (roleIds) {
        await this.assertRolesExist(tx, roleIds);
        // Only roles that are being added need checking: removing a role someone already has is always allowed.
        const current = new Set(before.roles.map((r) => r.roleId));
        await this.assertCanGrant(
          tx,
          roleIds.filter((r) => !current.has(r)),
        );
        if (id === currentUser()?.id) await this.assertKeepsAdminAccess(tx, roleIds);
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      const after = await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
      await this.audit.record({ action: 'user.update', entity: 'User', entityId: id, before: toUserDto(before), after: toUserDto(after) }, tx);
      const added = after.roles.filter((r) => !before.roles.some((b) => b.roleId === r.roleId)).map((r) => r.role.name);
      if (added.length) await this.onPrivilegeChange?.({ summary: `${currentUser()?.name ?? 'Someone'} gave ${after.name} ${added.join(', ')}`, userId: id });
      return toUserDto(after);
    });
    if (dto.isActive === false) await this.sessions.destroyAllForUser(id);
    return result;
  }

  async adminResetPassword(id: string, newPassword: string) {
    requireRecentAuth();
    assertPasswordPolicy(newPassword);
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw notFound('User');
    await this.assertCanManage(this.prisma, id);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await argon2.hash(newPassword), passwordChangedAt: new Date(), mustChangePassword: true, failedLogins: 0, lockedUntil: null },
    });
    await this.audit.record({ action: 'user.passwordReset', entity: 'User', entityId: id });
    await this.sessions.destroyAllForUser(id);
  }

  /** For someone who lost their phone. They sign in with their password alone and can set two-factor up again. */
  async resetTotp(id: string) {
    requireRecentAuth();
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw notFound('User');
    await this.assertCanManage(this.prisma, id);
    await this.prisma.user.update({ where: { id }, data: { totpEnabled: false, totpSecret: null } });
    await this.audit.record({ action: 'user.totpReset', entity: 'User', entityId: id });
    await this.sessions.destroyAllForUser(id);
    await this.onPrivilegeChange?.({ summary: `${currentUser()?.name ?? 'Someone'} turned off two-factor sign-in for ${user.name}`, userId: id });
  }

  /**
   * Taking over or weakening an account is as good as holding its roles, so a person who is not a full administrator
   * may only do it to people who hold nothing they lack themselves.
   */
  private async assertCanManage(tx: Tx | PrismaService, userId: string) {
    if (isFullAdministrator() || userId === currentUser()?.id) return;
    const roles = await tx.role.findMany({ where: { users: { some: { userId } } }, include: { permissions: true } });
    if (roles.some((r) => r.permissions.some((p) => !can(p.permissionCode)))) throw forbidden('This person holds permissions you don’t have. Ask a full administrator.');
  }

  private async assertRolesExist(tx: Tx, roleIds: string[]) {
    const count = await tx.role.count({ where: { id: { in: roleIds }, deletedAt: null } });
    if (count !== roleIds.length) throw badRequest('One or more roles do not exist', [{ field: 'roleIds', message: 'Unknown role' }]);
  }

  /**
   * No privilege escalation: a person can only give roles whose permissions they hold themselves, so someone who
   * manages users can't make anyone, themselves included, an Admin.
   */
  private async assertCanGrant(tx: Tx, roleIds: string[]) {
    if (!roleIds.length || isFullAdministrator()) return;
    const roles = await tx.role.findMany({ where: { id: { in: roleIds } }, include: { permissions: true } });
    for (const role of roles) {
      const missing = role.permissions.map((p) => p.permissionCode).filter((code) => !can(code));
      if (missing.length) throw forbidden(`You can't give the role ${role.name}: it includes permissions you don't have (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}).`);
    }
  }

  /** Set by the security module: admins are told whenever someone's access widens. */
  onPrivilegeChange: ((change: { summary: string; userId?: string }) => Promise<void>) | null = null;

  /** Adds one role to a person (an approved access request). Same rules as editing their roles. */
  async addRoleToUser(userId: string, roleId: string) {
    requireRecentAuth();
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, include: userInclude });
      if (!user) throw notFound('User');
      await this.assertRolesExist(tx, [roleId]);
      if (user.roles.some((r) => r.roleId === roleId)) return;
      await this.assertCanGrant(tx, [roleId]);
      await tx.userRole.create({ data: { userId, roleId } });
      const role = await tx.role.findUniqueOrThrow({ where: { id: roleId } });
      await this.audit.record({ action: 'user.roleAdded', entity: 'User', entityId: userId, after: { role: role.name } }, tx);
      await this.onPrivilegeChange?.({ summary: `${currentUser()?.name ?? 'Someone'} gave ${user.name} the role ${role.name}`, userId });
    });
  }

  /** Stops an Admin locking themselves out of user management by editing their own roles. */
  private async assertKeepsAdminAccess(tx: Tx, roleIds: string[]) {
    const has = await tx.rolePermission.count({ where: { roleId: { in: roleIds }, permissionCode: 'admin.users' } });
    if (!has) throw badRequest('You cannot remove your own access to user management');
  }

  // ------------------------------------------------------------- roles
  listPermissions() {
    return Object.entries(PERMISSIONS).map(([code, p]) => ({ code, ...p }));
  }

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      where: { deletedAt: null },
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      isActive: r.isActive,
      version: r.version,
      permissions: r.permissions.map((p) => p.permissionCode).sort(),
      userCount: r._count.users,
    }));
  }

  /** A role can only be given permissions its editor holds, so editing roles can't be used to gain access. */
  private assertHolds(codes: string[]) {
    if (isFullAdministrator()) return;
    const missing = codes.filter((c) => !can(c));
    if (missing.length) throw forbidden(`You can only grant permissions you hold yourself. Missing: ${missing.join(', ')}`);
  }

  private assertPermissions(codes: string[]) {
    const unknown = codes.filter((c) => !PERMISSIONS[c]);
    if (unknown.length) throw badRequest(`Unknown permissions: ${unknown.join(', ')}`, [{ field: 'permissions', message: 'Unknown permission' }]);
  }

  async createRole(dto: CreateRoleDto) {
    requireRecentAuth();
    this.assertPermissions(dto.permissions);
    this.assertHolds(dto.permissions);
    const role = await this.prisma.$transaction(async (tx) => {
      const r = await tx.role.create({
        data: { name: dto.name, description: dto.description, permissions: { create: dto.permissions.map((permissionCode) => ({ permissionCode })) } },
      });
      await this.audit.record({ action: 'role.create', entity: 'Role', entityId: r.id, after: dto }, tx);
      return r;
    });
    return (await this.listRoles()).find((r) => r.id === role.id)!;
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const { version, permissions, ...fields } = dto;
    if (permissions) {
      requireRecentAuth();
      this.assertPermissions(permissions);
    }
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.role.findFirst({ where: { id, deletedAt: null }, include: { permissions: true } });
      if (!before) throw notFound('Role');
      if (permissions) {
        const had = new Set(before.permissions.map((p) => p.permissionCode));
        this.assertHolds(permissions.filter((p) => !had.has(p)));
      }
      await updateVersioned(tx.role as never, id, version, fields);
      if (permissions) {
        const gained = permissions.filter((p) => !before.permissions.some((b) => b.permissionCode === p));
        if (gained.length) await this.onPrivilegeChange?.({ summary: `${currentUser()?.name ?? 'Someone'} added ${gained.join(', ')} to the role ${before.name}` });
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: permissions.map((permissionCode) => ({ roleId: id, permissionCode })) });
      }
      await this.audit.record({ action: 'role.update', entity: 'Role', entityId: id, before: { ...before, permissions: before.permissions.map((p) => p.permissionCode) }, after: dto }, tx);
      // At least one active role must still be able to manage users, or the deployment is unrecoverable.
      const adminCapable = await tx.rolePermission.count({
        where: { permissionCode: 'admin.users', role: { isActive: true, deletedAt: null, users: { some: {} } } },
      });
      if (!adminCapable) throw badRequest('At least one role in use must keep user management');
    });
    return (await this.listRoles()).find((r) => r.id === id)!;
  }

  // ------------------------------------------------------------- terms & calendar
  async latestTerms() {
    const kinds = ['QUOTATION', 'INVOICE', 'REPORT'] as const;
    const rows = await Promise.all(kinds.map((kind) => this.prisma.termsVersion.findFirst({ where: { kind }, orderBy: { versionNo: 'desc' } })));
    return rows.filter((r) => r !== null);
  }

  termsHistory(kind: 'QUOTATION' | 'INVOICE' | 'REPORT') {
    return this.prisma.termsVersion.findMany({ where: { kind }, orderBy: { versionNo: 'desc' } });
  }

  async addTerms(kind: 'QUOTATION' | 'INVOICE' | 'REPORT', body: string, tx?: Tx) {
    const run = async (t: Tx) => {
      const last = await t.termsVersion.findFirst({ where: { kind }, orderBy: { versionNo: 'desc' } });
      const row = await t.termsVersion.create({ data: { kind, body, versionNo: (last?.versionNo ?? 0) + 1, createdById: currentUser()?.id } });
      await this.audit.record({ action: 'terms.version', entity: 'TermsVersion', entityId: row.id, after: { kind, versionNo: row.versionNo } }, t);
      return row;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  listHolidays() {
    return this.prisma.holiday.findMany({ where: { deletedAt: null }, orderBy: { date: 'asc' } });
  }

  async addHoliday(date: string, name: string) {
    const row = await this.prisma.holiday.upsert({
      where: { date: new Date(date) },
      create: { date: new Date(date), name },
      update: { name, deletedAt: null },
    });
    await this.audit.record({ action: 'holiday.create', entity: 'Holiday', entityId: row.id, after: { date, name } });
    return row;
  }

  async removeHoliday(id: string) {
    await this.prisma.holiday.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ action: 'holiday.delete', entity: 'Holiday', entityId: id });
  }

  // ------------------------------------------------------------- audit
  async listAudit(q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.from || q.to
        ? { at: { ...(q.from ? { gte: new Date(`${q.from.slice(0, 10)}T00:00:00+05:30`) } : {}), ...(q.to ? { lte: new Date(`${q.to.slice(0, 10)}T23:59:59.999+05:30`) } : {}) } }
        : {}),
      ...(q.q ? { OR: [{ userName: { contains: q.q, mode: 'insensitive' } }, { reason: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: orderBy(q, ['at', 'action', 'entity', 'userName'], 'at'), ...skipTake(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return toPage(
      rows.map((r) => ({ ...r, id: r.id.toString() })),
      total,
      q,
    );
  }

  // ------------------------------------------------------------- company
  companyDetails() {
    const c = this.company.config;
    return {
      productName: c.productName,
      companyName: c.companyName,
      legalName: c.legalName,
      gstin: c.gstin,
      pan: c.pan,
      cin: c.cin,
      stateName: c.stateName,
      gstStateCode: c.gstStateCode,
      sacCode: c.sacCode,
      sacDescription: c.sacDescription,
      registeredAddress: c.registeredAddress,
      labAddress: c.labAddress,
      phone: c.phone,
      email: c.email,
      website: c.website,
      reportVerificationEmail: c.reportVerificationEmail,
      bankAccountName: c.bank.accountName,
      bankAccountNumber: c.bank.accountNumber,
      bankName: c.bank.bankName,
      bankBranch: c.bank.branch,
      bankIfsc: c.bank.ifsc,
      bankSwift: c.bank.swift,
      certificationText: c.accreditation.certificationText,
      nablMode: c.accreditation.nablMode,
      nablCertificateNo: c.accreditation.nablCertificateNo,
      ulrFormat: c.accreditation.ulrFormat,
      documentPrefix: c.documentPrefix,
      note: 'Edit these in Admin > Lab profile. Changes apply at once; issued documents keep the details they were issued with.',
    };
  }

  // ------------------------------------------------------------- saved filters
  listSavedFilters(screen: string) {
    return this.prisma.savedFilter.findMany({ where: { userId: currentUser()!.id, screen }, orderBy: { name: 'asc' } });
  }

  createSavedFilter(dto: CreateSavedFilterDto) {
    const userId = currentUser()!.id;
    return this.prisma.savedFilter.upsert({
      where: { userId_screen_name: { userId, screen: dto.screen, name: dto.name } },
      create: { userId, screen: dto.screen, name: dto.name, filters: dto.filters as Prisma.InputJsonValue },
      update: { filters: dto.filters as Prisma.InputJsonValue },
    });
  }

  async deleteSavedFilter(id: string) {
    const { count } = await this.prisma.savedFilter.deleteMany({ where: { id, userId: currentUser()!.id } });
    if (!count) throw notFound('Saved filter');
  }

  async setUserSignature(userId: string, fileId: string, version: number) {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file?.mimeType.startsWith('image/') || file.entity !== 'User' || file.entityId !== userId) {
      throw badRequest('Choose an image uploaded for this user', [{ field: 'fileId', message: 'Not an image for this user' }]);
    }
    await updateVersioned(this.prisma.user as never, userId, version, { signatureFileId: fileId });
    await this.audit.record({ action: 'user.signature', entity: 'User', entityId: userId, after: { fileId } });
    return this.getUser(userId);
  }

  settingsList() {
    return this.settings.all();
  }
}
