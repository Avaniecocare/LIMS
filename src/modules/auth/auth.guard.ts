import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { getContext, type CurrentUser } from '../../common/context.js';
import { AppError, forbidden } from '../../common/errors.js';
import { PrismaService } from '../../core/prisma.service.js';
import { PERMS_KEY, PUBLIC_KEY } from './decorators.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const unauthenticated = () => new AppError('UNAUTHENTICATED', 401, 'Please sign in');

const tokensMatch = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Global guard: session, CSRF and permission checks for every route. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const sid = req.cookies?.[this.sessions.cookieName];
    if (!sid) throw unauthenticated();
    const session = await this.sessions.touch(sid);
    if (!session) throw unauthenticated();

    const user = await this.prisma.user.findFirst({
      where: { id: session.userId, isActive: true, deletedAt: null },
      include: { roles: { include: { role: { include: { permissions: true } } } } },
    });
    // A password change invalidates older sessions even if the Redis cleanup was missed.
    if (!user || user.passwordChangedAt.getTime() > session.createdAt) {
      await this.sessions.destroy(sid);
      throw unauthenticated();
    }

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.headers['x-csrf-token'];
      if (typeof header !== 'string' || !tokensMatch(header, session.csrfToken)) {
        throw new AppError('CSRF_FAILED', 403, 'Security token missing or invalid. Reload the page and try again.');
      }
    }

    const activeRoles = user.roles.filter((r) => r.role.isActive && !r.role.deletedAt);
    const current: CurrentUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      designation: user.designation,
      roles: activeRoles.map((r) => r.role.name),
      permissions: new Set(activeRoles.flatMap((r) => r.role.permissions.map((p) => p.permissionCode))),
      sessionId: sid,
      csrfToken: session.csrfToken,
    };
    const ctx = getContext();
    if (ctx) ctx.user = current;

    const required = this.reflector.getAllAndOverride<string[]>(PERMS_KEY, targets);
    if (required?.length && !required.some((p) => current.permissions.has(p))) throw forbidden();
    return true;
  }
}
