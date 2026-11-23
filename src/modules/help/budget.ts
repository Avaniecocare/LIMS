import { randomUUID } from 'node:crypto';
import type { RedisService } from '../../core/redis.service.js';

export interface Reservation {
  id: string;
  day: string;
  month: string;
  micros: number;
}

// Takes the worst case off both budgets in one step, so requests arriving together cannot all pass the same check.
const RESERVE = `
local day = tonumber(redis.call('GET', KEYS[1]) or '0')
local month = tonumber(redis.call('GET', KEYS[2]) or '0')
local want = tonumber(ARGV[1])
if day >= tonumber(ARGV[2]) or month >= tonumber(ARGV[3]) then return 0 end
if day + want > tonumber(ARGV[2]) or month + want > tonumber(ARGV[3]) then return 0 end
redis.call('INCRBY', KEYS[1], want)
redis.call('EXPIRE', KEYS[1], 259200)
redis.call('INCRBY', KEYS[2], want)
redis.call('EXPIRE', KEYS[2], 3456000)
redis.call('SET', KEYS[3], want, 'EX', 86400)
return 1`;

// Once per reservation: gives back what was not spent. Returns the day's total.
const SETTLE = `
local held = redis.call('GET', KEYS[3])
if not held then return -1 end
redis.call('DEL', KEYS[3])
local change = tonumber(ARGV[1]) - tonumber(held)
redis.call('INCRBY', KEYS[2], change)
return redis.call('INCRBY', KEYS[1], change)`;

/** The assistant's spending limits. A reservation that is never settled (a crash) stays counted: the money may be gone. */
export class HelpBudget {
  constructor(
    private readonly redis: RedisService,
    private readonly limits: () => { day: number; month: number },
  ) {}

  private keys(r: Reservation) {
    return [`help:cost:d:${r.day}`, `help:cost:m:${r.month}`, `help:hold:${r.id}`];
  }

  async reserve(micros: number, now = new Date()): Promise<Reservation | null> {
    const day = now.toISOString().slice(0, 10);
    const r = { id: randomUUID(), day, month: day.slice(0, 7), micros };
    const { day: d, month: m } = this.limits();
    return (await this.redis.client.eval(RESERVE, 3, ...this.keys(r), micros, d, m)) === 1 ? r : null;
  }

  /** Returns what has been spent or reserved today, in millionths of a dollar. */
  async settle(r: Reservation, spent: number): Promise<number> {
    return Number(await this.redis.client.eval(SETTLE, 3, ...this.keys(r), Math.max(0, Math.ceil(spent))));
  }

  async spentToday(now = new Date()): Promise<{ day: number; month: number }> {
    const day = now.toISOString().slice(0, 10);
    const [d, m] = await this.redis.client.mget(`help:cost:d:${day}`, `help:cost:m:${day.slice(0, 7)}`);
    return { day: Number(d ?? 0), month: Number(m ?? 0) };
  }
}
