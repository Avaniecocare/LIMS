import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { Secret, TOTP } from 'otpauth';
import { currentUser, getContext } from '../../common/context.js';
import { AppError, badRequest } from '../../common/errors.js';
import { COMPANY_CONFIG, type CompanyConfig } from '../../config/company.config.js';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { AuditService } from '../../core/audit.service.js';
import { MailService } from '../../core/mail.service.js';
import { PrismaService } from '../../core/prisma.service.js';
import { RedisService } from '../../core/redis.service.js';
import type { SessionUserDto } from './auth.dto.js';
import { SessionService } from './session.service.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_ATTEMPTS = 10;
const TOTP_ROLES = new Set(['Admin', 'Authorised Signatory', 'Accounts']);
// Verified against when the email is unknown, so timing does not reveal which accounts exist.
const DUMMY_HASH = argon2.hash('dummy-password-for-constant-time');

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push('at least 10 characters');
  if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
  if (!/[0-9]/.test(password)) problems.push('a digit');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('a symbol');
  return problems;
}

export function assertPasswordPolicy(password: string, field = 'newPassword') {
  const problems = passwordProblems(password);
  if (problems.length) {
    const message = `Password needs ${problems.join(', ')}`;
    throw badRequest(message, [{ field, message }]);
  }
}

const invalidLogin = () => new AppError('INVALID_CREDENTIALS', 401, 'Incorrect email or password');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(COMPANY_CONFIG) private readonly company: CompanyConfig,
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
  ) {}

  private async rateLimit(email: string) {
    const ip = getContext()?.ip ?? 'unknown';
    const key = `login-rate:${ip}:${email}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, RATE_WINDOW_SECONDS);
    if (count > RATE_MAX_ATTEMPTS) throw new AppError('RATE_LIMITED', 429, 'Too many attempts. Wait a minute and try again.');
  }

  /** Returns either a TOTP challenge or the id of the verified user. */
  async verifyCredentials(emailRaw: string, password: string): Promise<{ userId?: string; totpChallenge?: string }> {
    const email = emailRaw.trim().toLowerCase();
    await this.rateLimit(email);
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (!user) {
      await argon2.verify(await DUMMY_HASH, password).catch(() => false);
      await this.audit.record({ action: 'auth.login.failed', entity: 'User', after: { email: 'unknown' } });
      throw invalidLogin();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 423, `Account locked after repeated failures. Try again after ${LOCK_MINUTES} minutes or reset your password.`);
    }
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok || !user.isActive) {
      const failed = user.failedLogins + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined },
      });
      await this.audit.record({ action: lock ? 'auth.account.locked' : 'auth.login.failed', entity: 'User', entityId: user.id });
      throw invalidLogin();
    }
    if (user.totpEnabled) {
      const totpChallenge = randomBytes(32).toString('base64url');
      await this.redis.client.set(`totp-challenge:${totpChallenge}`, user.id, 'EX', 300);
      return { totpChallenge };
    }
    return { userId: user.id };
  }

  async verifyTotpChallenge(challenge: string, code: string): Promise<string> {
    const key = `totp-challenge:${challenge}`;
    const userId = await this.redis.client.get(key);
    if (!userId) throw new AppError('TOTP_EXPIRED', 401, 'Sign-in expired. Start again.');
    const attemptsKey = `${key}:attempts`;
    const attempts = await this.redis.client.incr(attemptsKey);
    await this.redis.client.expire(attemptsKey, 300);
    if (attempts > 5) {
      await this.redis.client.del(key);
      throw new AppError('RATE_LIMITED', 429, 'Too many attempts. Start again.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // validate() returns the matched window offset, where 0 is a valid match; null means no match.
    if (!user.totpSecret || this.totp(user.email, user.totpSecret).validate({ token: code, window: 1 }) === null) {
      await this.audit.record({ action: 'auth.totp.failed', entity: 'User', entityId: user.id });
      throw new AppError('INVALID_TOTP', 401, 'Incorrect code');
    }
    await this.redis.client.del(key);
    return user.id;
  }

  async startSession(userId: string) {
    const ip = getContext()?.ip ?? null;
    const session = await this.sessions.create(userId, ip);
    const user = await this.prisma.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const ctx = getContext();
    await this.prisma.auditLog.create({
      data: { userId, userName: user.name, ip, requestId: ctx?.requestId, action: 'auth.login', entity: 'User', entityId: userId },
    });
    return session;
  }

  async describe(userId: string, csrfToken: string): Promise<SessionUserDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { include: { role: { include: { permissions: true } } } } },
    });
    const roles = user.roles.filter((r) => r.role.isActive && !r.role.deletedAt);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      designation: user.designation,
      roles: roles.map((r) => r.role.name),
      permissions: [...new Set(roles.flatMap((r) => r.role.permissions.map((p) => p.permissionCode)))].sort(),
      csrfToken,
      totpEnabled: user.totpEnabled,
      mustChangePassword: user.mustChangePassword,
      totpAvailable: roles.some((r) => TOTP_ROLES.has(r.role.name)),
    };
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const me = currentUser()!;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!(await argon2.verify(user.passwordHash, currentPassword).catch(() => false))) {
      throw badRequest('Current password is incorrect', [{ field: 'currentPassword', message: 'Incorrect password' }]);
    }
    assertPasswordPolicy(newPassword);
    await this.prisma.user.update({
      where: { id: me.id },
      data: { passwordHash: await argon2.hash(newPassword), passwordChangedAt: new Date(), mustChangePassword: false },
    });
    await this.audit.record({ action: 'auth.password.changed', entity: 'User', entityId: me.id });
    await this.sessions.destroyAllForUser(me.id);
  }

  /** Always succeeds from the caller's view, so it cannot be used to discover accounts. */
  async forgotPassword(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();
    await this.rateLimit(`forgot:${email}`);
    const user = await this.prisma.user.findFirst({ where: { email, isActive: true, deletedAt: null } });
    if (!user) return;
    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60 * 60_000) },
    });
    const link = `${this.infra.frontendOrigin}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.enqueue({
      to: user.email,
      subject: `Reset your ${this.company.productName} password`,
      template: 'password-reset',
      entity: 'User',
      entityId: user.id,
      bodyHtml: `<p>A password reset was requested for your account.</p><p><a href="${link}">Set a new password</a></p><p>This link works for one hour. If you did not ask for this, you can ignore this email.</p>`,
    });
    await this.audit.record({ action: 'auth.password.resetRequested', entity: 'User', entityId: user.id });
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw badRequest('This reset link is invalid or has expired', [{ field: 'token', message: 'Invalid or expired' }]);
    }
    assertPasswordPolicy(newPassword);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw badRequest('This reset link has already been used');
      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash: await argon2.hash(newPassword), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null, mustChangePassword: false },
      });
      await this.audit.record({ action: 'auth.password.reset', entity: 'User', entityId: row.userId }, tx);
    });
    await this.sessions.destroyAllForUser(row.userId);
  }

  private totp(email: string, secret: string) {
    return new TOTP({ issuer: this.company.productName, label: email, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
  }

  async totpSetup() {
    const me = currentUser()!;
    if (!me.roles.some((r) => TOTP_ROLES.has(r))) throw badRequest('Two-factor login is available for Admin, Signatory and Accounts roles');
    const secret = new Secret({ size: 20 }).base32;
    await this.prisma.user.update({ where: { id: me.id }, data: { totpSecret: secret, totpEnabled: false } });
    return { secret, otpauthUrl: this.totp(me.email, secret).toString() };
  }

  async totpEnable(code: string) {
    const me = currentUser()!;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!user.totpSecret || this.totp(user.email, user.totpSecret).validate({ token: code, window: 1 }) === null) {
      throw badRequest('Incorrect code', [{ field: 'code', message: 'Incorrect code' }]);
    }
    await this.prisma.user.update({ where: { id: me.id }, data: { totpEnabled: true } });
    await this.audit.record({ action: 'auth.totp.enabled', entity: 'User', entityId: me.id });
  }

  async totpDisable(password: string) {
    const me = currentUser()!;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!(await argon2.verify(user.passwordHash, password).catch(() => false))) {
      throw badRequest('Incorrect password', [{ field: 'password', message: 'Incorrect password' }]);
    }
    await this.prisma.user.update({ where: { id: me.id }, data: { totpEnabled: false, totpSecret: null } });
    await this.audit.record({ action: 'auth.totp.disabled', entity: 'User', entityId: me.id });
  }

  /** Re-authentication for electronic signatures. */
  async confirmPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return argon2.verify(user.passwordHash, password).catch(() => false);
  }
}
