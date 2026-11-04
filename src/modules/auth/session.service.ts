import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { RedisService } from '../../core/redis.service.js';

export interface SessionData {
  userId: string;
  csrfToken: string;
  createdAt: number;
  ip: string | null;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly redis: RedisService,
    @Inject(INFRA_CONFIG) private readonly cfg: InfraConfig,
  ) {}

  /** The Redis key is an HMAC of the cookie value, so a Redis dump does not yield usable sessions. */
  private key(id: string) {
    return `sess:${createHmac('sha256', this.cfg.sessionSecret).update(id).digest('hex')}`;
  }

  private get ttl() {
    return this.cfg.sessionIdleMinutes * 60;
  }

  async create(userId: string, ip: string | null): Promise<{ id: string; data: SessionData }> {
    const id = randomBytes(32).toString('base64url');
    const data: SessionData = { userId, csrfToken: randomBytes(32).toString('base64url'), createdAt: Date.now(), ip };
    await this.redis.client.set(this.key(id), JSON.stringify(data), 'EX', this.ttl);
    await this.redis.client.sadd(`user-sess:${userId}`, this.key(id));
    await this.redis.client.expire(`user-sess:${userId}`, 7 * 24 * 3600);
    return { id, data };
  }

  /** Reads and slides the idle timeout. */
  async touch(id: string): Promise<SessionData | null> {
    const key = this.key(id);
    const raw = await this.redis.client.getex(key, 'EX', this.ttl);
    return raw ? (JSON.parse(raw) as SessionData) : null;
  }

  async destroy(id: string): Promise<void> {
    await this.redis.client.del(this.key(id));
  }

  /** Ends every session for a user, e.g. after a password change or deactivation. */
  async destroyAllForUser(userId: string): Promise<void> {
    const keys = await this.redis.client.smembers(`user-sess:${userId}`);
    if (keys.length) await this.redis.client.del(...keys);
    await this.redis.client.del(`user-sess:${userId}`);
  }

  cookieOptions() {
    return {
      path: '/',
      httpOnly: true,
      secure: this.cfg.cookieSecure,
      sameSite: 'lax' as const,
      domain: this.cfg.sessionCookieDomain ?? undefined,
      maxAge: this.ttl * 48,
    };
  }

  get cookieName() {
    return this.cfg.sessionCookieName;
  }
}
