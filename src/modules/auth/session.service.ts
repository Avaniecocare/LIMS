import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { RedisService } from '../../core/redis.service.js';

export interface SessionData {
  userId: string;
  csrfToken: string;
  createdAt: number;
  ip: string | null;
  /** browser and device, for the "where you're signed in" list */
  userAgent?: string | null;
  lastSeenAt?: number;
  /** when the password was last confirmed in this session, for sensitive actions */
  reauthAt?: number;
}

export interface SessionInfo {
  id: string;
  createdAt: number;
  lastSeenAt: number | null;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

/** Sessions are listed by a short public id derived from the stored key, never by the cookie value. */
const publicId = (key: string) => key.slice(-16);

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

  async create(userId: string, ip: string | null, userAgent: string | null = null): Promise<{ id: string; data: SessionData }> {
    const id = randomBytes(32).toString('base64url');
    const data: SessionData = { userId, csrfToken: randomBytes(32).toString('base64url'), createdAt: Date.now(), ip, userAgent: userAgent?.slice(0, 300) ?? null, lastSeenAt: Date.now() };
    await this.redis.client.set(this.key(id), JSON.stringify(data), 'EX', this.ttl);
    await this.redis.client.sadd(`user-sess:${userId}`, this.key(id));
    await this.redis.client.expire(`user-sess:${userId}`, 7 * 24 * 3600);
    return { id, data };
  }

  /** Reads and slides the idle timeout, up to an absolute limit after sign-in. */
  async touch(id: string): Promise<SessionData | null> {
    const key = this.key(id);
    const raw = await this.redis.client.getex(key, 'EX', this.ttl);
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    if (Date.now() - data.createdAt > this.cfg.sessionMaxHours * 3600_000) {
      await this.redis.client.del(key);
      return null;
    }
    // "Last active" for the sessions list, written at most once a minute.
    if (!data.lastSeenAt || Date.now() - data.lastSeenAt > 60_000) {
      data.lastSeenAt = Date.now();
      await this.redis.client.set(key, JSON.stringify(data), 'KEEPTTL');
    }
    return data;
  }

  /** Records that the person just confirmed their password in this session. */
  async markReauthenticated(id: string): Promise<void> {
    const key = this.key(id);
    const raw = await this.redis.client.get(key);
    if (!raw) return;
    await this.redis.client.set(key, JSON.stringify({ ...(JSON.parse(raw) as SessionData), reauthAt: Date.now() }), 'KEEPTTL');
  }

  /** The person's live sessions, newest first. */
  async list(userId: string, currentId: string): Promise<SessionInfo[]> {
    const keys = await this.redis.client.smembers(`user-sess:${userId}`);
    const current = this.key(currentId);
    const out: SessionInfo[] = [];
    for (const key of keys) {
      const raw = await this.redis.client.get(key);
      if (!raw) {
        await this.redis.client.srem(`user-sess:${userId}`, key);
        continue;
      }
      const d = JSON.parse(raw) as SessionData;
      out.push({ id: publicId(key), createdAt: d.createdAt, lastSeenAt: d.lastSeenAt ?? null, ip: d.ip, userAgent: d.userAgent ?? null, current: key === current });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Ends one of the person's own sessions by its public id, or all others when id is null. */
  async revoke(userId: string, currentId: string, id: string | null): Promise<number> {
    const keys = await this.redis.client.smembers(`user-sess:${userId}`);
    const current = this.key(currentId);
    const targets = keys.filter((k) => k !== current && (id === null || publicId(k) === id));
    if (targets.length) {
      await this.redis.client.del(...targets);
      await this.redis.client.srem(`user-sess:${userId}`, ...targets);
    }
    return targets.length;
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
