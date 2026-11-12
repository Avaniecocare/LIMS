import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { Secret, TOTP } from 'otpauth';
import { currentUser, getContext } from '../../common/context.js';
import { AppError, badRequest } from '../../common/errors.js';
import { CompanyService } from '../../core/company.service.js';
import { EmailTemplateService } from '../../core/email-template.service.js';
import { ModulesService } from '../../core/modules.service.js';
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
/** Failed sign-ins from one address across all accounts, so guessing one password against many emails is slowed too. */
const IP_FAILURE_WINDOW_SECONDS = 600;
const IP_MAX_FAILURES = 30;
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

// One answer for a wrong password, an unknown email and a locked account, so the response never reveals which emails exist.
const invalidLogin = () => new AppError('INVALID_CREDENTIALS', 401, `Incorrect email or password. After ${MAX_FAILED_LOGINS} failed attempts an account is locked for ${LOCK_MINUTES} minutes; use Forgot password if you are unsure.`);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly company: CompanyService,
    private readonly templates: EmailTemplateService,
    private readonly modules: ModulesService,
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
  ) {}

  private async rateLimit(email: string) {
    const ip = getContext()?.ip ?? 'unknown';
    const ipFailures = Number((await this.redis.client.get(`login-ip-failures:${ip}`)) ?? 0);
    if (ipFailures >= IP_MAX_FAILURES) throw new AppError('RATE_LIMITED', 429, 'Too many failed sign-ins from this network. Wait ten minutes and try again.');
    const key = `login-rate:${ip}:${email}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, RATE_WINDOW_SECONDS);
    if (count > RATE_MAX_ATTEMPTS) throw new AppError('RATE_LIMITED', 429, 'Too many attempts. Wait a minute and try again.');
  }

  private async countIpFailure() {
    const key = `login-ip-failures:${getContext()?.ip ?? 'unknown'}`;
    const n = await this.redis.client.incr(key);
    if (n === 1) await this.redis.client.expire(key, IP_FAILURE_WINDOW_SECONDS);
  }

  /** Returns either a TOTP challenge or the id of the verified user. */
  async verifyCredentials(emailRaw: string, password: string): Promise<{ userId?: string; totpChallenge?: string }> {
    const email = emailRaw.trim().toLowerCase();
    await this.rateLimit(email);
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (!user) {
      await argon2.verify(await DUMMY_HASH, password).catch(() => false);
      await this.audit.record({ action: 'auth.login.failed', entity: 'User', after: { email: 'unknown' } });
      await this.countIpFailure();
      throw invalidLogin();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await argon2.verify(await DUMMY_HASH, password).catch(() => false);
      await this.audit.record({ action: 'auth.login.locked', entity: 'User', entityId: user.id });
      throw invalidLogin();
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
      await this.countIpFailure();
      throw invalidLogin();
    }
    // Only failures count: staff signing in repeatedly, or sharing an office IP, are not attackers.
    await this.redis.client.del(`login-rate:${getContext()?.ip ?? 'unknown'}:${email}`);
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

  /** Confirms the password for sensitive actions; wrong attempts count towards the lockout like a sign-in. */
  async reauthenticate(password: string) {
    const me = currentUser()!;
    await this.rateLimit(`reauth:${me.id}`);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!(await argon2.verify(user.passwordHash, password).catch(() => false))) {
      await this.audit.record({ action: 'auth.reauth.failed', entity: 'User', entityId: me.id });
      throw new AppError('INVALID_PASSWORD', 403, 'Incorrect password', [{ field: 'password', message: 'Incorrect password' }]);
    }
    await this.sessions.markReauthenticated(me.sessionId);
    await this.audit.record({ action: 'auth.reauth', entity: 'User', entityId: me.id });
  }

  async recordSessionsRevoked(count: number, what: string) {
    if (count) await this.audit.record({ action: 'auth.sessions.revoked', entity: 'User', entityId: currentUser()!.id, after: { count, what } });
  }

  async signInHistory(userId: string) {
    const rows = await this.prisma.auditLog.findMany({ where: { entity: 'User', entityId: userId, action: { in: ['auth.login', 'auth.login.failed', 'auth.login.locked', 'auth.account.locked'] } }, orderBy: { at: 'desc' }, take: 50, select: { at: true, action: true, ip: true } });
    return rows;
  }

  async startSession(userId: string) {
    const ip = getContext()?.ip ?? null;
    const session = await this.sessions.create(userId, ip, getContext()?.userAgent ?? null);
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
      modules: await this.modules.enabled(),
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
    const mail = await this.templates.render('password-reset', { ...this.templates.commonValues(), appName: this.company.config.productName, userName: user.name, resetLink: link });
    await this.mail.enqueue({ to: user.email, subject: mail.subject, template: 'password-reset', entity: 'User', entityId: user.id, bodyHtml: mail.bodyHtml });
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
      // Any other reset link sent to this user stops working too.
      await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash: await argon2.hash(newPassword), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null, mustChangePassword: false },
      });
      await this.audit.record({ action: 'auth.password.reset', entity: 'User', entityId: row.userId }, tx);
    });
    await this.sessions.destroyAllForUser(row.userId);
  }

  private totp(email: string, secret: string) {
    return new TOTP({ issuer: this.company.config.productName, label: email, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
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
