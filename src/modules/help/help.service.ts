import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, badRequest } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import { helpAnswers, helpCost, helpLatency, helpTokens } from '../../common/metrics.js';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { Prisma, PrismaService } from '../../core/prisma.service.js';
import { RedisService } from '../../core/redis.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { cleanQuestion, hasPromptTags, looksLikeInjection, looksOffTopic, normalizeQuestion, scrubPersonal } from './guard.js';
import { HelpIndexService } from './help-index.service.js';
import { HELP_SYSTEM_PROMPT, NOT_FOUND_ANSWER, OFF_TOPIC_ANSWER, buildUserMessage } from './prompt.js';
import { answerFrom } from './answer.js';
import { HelpBudget, type Reservation } from './budget.js';
import { createProviders } from './providers/index.js';
import { NO_USAGE, worstCaseMicros, type AnswerProvider, type ChatMessage } from './providers/types.js';
import { isRelevant, type Hit } from './retrieval.js';

/** Who is asking, as far as the limits are concerned. The IP is only ever used hashed, as a counter key. */
export interface Asker {
  ip: string | null;
  userId: string | null;
  userAgent: string | null;
  origin: string | null;
  requestedWith: string | null;
  turnstileToken: string | null;
}
export type HelpEvent =
  | { event: 'meta'; data: { id: string; sources: { title: string; url: string; heading: string | null }[] } }
  | { event: 'delta'; data: { text: string } }
  /** what has been shown is withdrawn, and this put in its place */
  | { event: 'replace'; data: { text: string } }
  | { event: 'error'; data: { message: string } }
  | { event: 'done'; data: { outcome: string } };
type Outcome = Prisma.HelpQuestionCreateInput['outcome'];

const MAX_HISTORY_TURNS = 4;
const MAX_TURN_CHARS = 2000;
const CACHE_TTL_S = 7 * 24 * 3600;
const MAX_HISTORY_CHARS = 8000;
/** Part of the cache key and the log, so answers written under older instructions are not served as new ones. */
const PROMPT_VERSION = createHash('sha256').update(HELP_SYSTEM_PROMPT).digest('hex').slice(0, 8);
// Clients that are not a person using a browser. A real browser always sends a user agent.
const BOT_UA = /(curl|wget|python|httpie|go-http|java\/|okhttp|libwww|scrapy|aiohttp|axios|node-fetch|postman|insomnia|\bbot\b|spider|crawl|slurp)/i;

@Injectable()
export class HelpService implements OnModuleInit {
  private readonly providers: AnswerProvider[];
  private readonly budget: HelpBudget;

  constructor(
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
    private readonly index: HelpIndexService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly scheduler: SchedulerService,
  ) {
    this.providers = createProviders(infra.help);
    this.budget = new HelpBudget(redis, () => ({ day: Math.floor(this.cfg.dailyBudget * 1e6), month: Math.floor(this.cfg.monthlyBudget * 1e6) }));
  }

  private get cfg() {
    return this.infra.help;
  }

  onModuleInit() {
    if (this.cfg.offBecause) logger.warn({ reason: this.cfg.offBecause }, 'the help assistant is off');
    // Question logs are kept only as long as they are useful for finding gaps in the docs.
    this.scheduler.register({ name: 'help-log-retention', pattern: '15 3 * * *', run: () => this.purgeOldLogs() });
  }

  status(signedIn: boolean) {
    const available = this.providers.length > 0 && !!this.index.search;
    return {
      enabled: available,
      signedIn,
      requireLogin: this.cfg.requireLogin,
      maxQuestionLength: this.cfg.maxQuestionLength,
      turnstileSiteKey: !signedIn && this.cfg.turnstileSecretKey ? this.cfg.turnstileSiteKey : null,
      supportEmail: this.cfg.supportEmail,
    };
  }

  /**
   * Every check that can refuse a request runs here, before any streaming starts, so refusals are plain HTTP
   * errors. Returns the stream of answer events.
   */
  async ask(asker: Asker, body: { question?: unknown; history?: unknown }, signal: AbortSignal = new AbortController().signal): Promise<AsyncGenerator<HelpEvent>> {
    const started = Date.now();
    const signedIn = !!asker.userId;
    if (!this.providers.length || !this.index.search) throw new AppError('HELP_OFF', 503, 'The help assistant is not available right now. Use Search instead.');
    if (this.cfg.requireLogin && !signedIn) throw new AppError('HELP_LOGIN', 401, 'Sign in to ask the help assistant.');

    // Browsers only: the docs page sends this header and an allowed Origin; scripts and other sites do not.
    if (!asker.userAgent || BOT_UA.test(asker.userAgent) || asker.requestedWith !== 'lims-help' || !asker.origin || !this.cfg.allowedOrigins.includes(asker.origin.replace(/\/+$/, ''))) {
      // A flood of these must not become a flood of rows.
      if (await this.firstThisMinute('blocked', asker)) await this.log({ outcome: 'BLOCKED', signedIn, started });
      throw new AppError('FORBIDDEN', 403, 'This request was not accepted.');
    }

    await this.limit(asker, started);
    if (!signedIn && this.cfg.turnstileSecretKey && !(await this.human(asker.turnstileToken))) {
      if (await this.firstThisMinute('captcha', asker)) await this.log({ outcome: 'CAPTCHA_FAILED', signedIn, started });
      throw new AppError('HELP_CAPTCHA', 403, 'Please confirm you are a person and ask again.');
    }

    const checked = cleanQuestion(body.question, this.cfg.maxQuestionLength);
    if (!checked.ok) {
      const message = {
        empty: 'Type a question first.',
        too_long: `Questions can be up to ${this.cfg.maxQuestionLength} characters.`,
        garbage: 'That does not look like a question. Try asking how to do something.',
      }[checked.reason];
      throw badRequest(message, [{ field: 'question', message }]);
    }
    const question = scrubPersonal(checked.question);
    await this.notRepeated(asker, question);
    const history = this.history(body.history);

    if (hasPromptTags(body.question as string) || looksLikeInjection(question) || history.some((h) => h.role === 'user' && looksLikeInjection(h.content)))
      return this.fixed(OFF_TOPIC_ANSWER, 'BLOCKED', question, signedIn, started);
    if (looksOffTopic(question)) return this.fixed(OFF_TOPIC_ANSWER, 'OFF_TOPIC', question, signedIn, started);

    // A short follow-up ("and on a phone?") is searched together with the question before it.
    const lastUser = [...history].reverse().find((t) => t.role === 'user')?.content;
    const searchText = lastUser && question.split(' ').length < 8 ? `${lastUser} ${question}` : question;
    // The visitor's browser sends the history, so it can only help a question that has something to do with the docs
    // itself: an off-topic question must not ride in on an invented earlier turn.
    const onItsOwn = this.index.search.search(question, { staff: signedIn, k: 5 });
    const spent = await this.budget.spentToday();
    const paused = spent.day >= this.cfg.dailyBudget * 1e6 || spent.month >= this.cfg.monthlyBudget * 1e6;
    const queryVector = paused ? null : await this.embedQuery(searchText);
    const result = this.index.search.search(searchText, { staff: signedIn, k: 5, queryVector });
    const { hits } = result;
    if (!isRelevant(result) || (lastUser && !onItsOwn.hits.length)) {
      const suggestions = hits.slice(0, 3).map((h) => `- [${h.chunk.heading ?? h.chunk.title}](${h.chunk.url})`);
      const text = `${NOT_FOUND_ANSWER}${suggestions.length ? `\n\nThese pages may be related:\n${suggestions.join('\n')}` : ' Try Search at the top of the page, or ask your administrator.'}`;
      return this.fixed(text, 'NOT_FOUND', question, signedIn, started, hits.slice(0, 3));
    }

    const cacheKey = history.length ? null : `help:answer:${signedIn ? 'staff' : 'public'}:${this.index.search.version}:${PROMPT_VERSION}:${this.cfg.model}:${sha(normalizeQuestion(question))}`;
    if (cacheKey) {
      const hit = await this.redis.client.get(cacheKey);
      if (hit) {
        const cached = JSON.parse(hit) as { text: string; urls: string[] };
        const used = hits.filter((h) => cached.urls.includes(h.chunk.url));
        return this.fixed(cached.text, 'CACHED', question, signedIn, started, used.length ? used : hits.slice(0, 3));
      }
    }

    const messages: ChatMessage[] = [...history, { role: 'user', content: buildUserMessage(question, hits) }];
    const request = { system: HELP_SYSTEM_PROMPT, messages, maxTokens: this.cfg.maxOutputTokens, hits };
    const held = await this.budget.reserve(Math.max(...this.providers.map((p) => worstCaseMicros(p.price, request))));
    if (!held) {
      await this.log({ outcome: 'BUDGET_REACHED', question, signedIn, started });
      throw new AppError('HELP_PAUSED', 503, 'The help assistant has answered all it can for now and will be back later. Search still works.');
    }
    return this.generate({ question, request, hits, cacheKey, signedIn, started, signal, held });
  }

  private async *generate(c: {
    question: string;
    request: { system: string; messages: ChatMessage[]; maxTokens: number; hits: Hit[] };
    hits: Hit[];
    cacheKey: string | null;
    signedIn: boolean;
    started: number;
    signal: AbortSignal;
    held: Reservation;
  }): AsyncGenerator<HelpEvent> {
    const id = randomUUID();
    const sources = sourcesOf(c.hits);
    let text = '';
    let outcome: Outcome = 'CANCELLED';
    let result = { usage: NO_USAGE, cost: 0, model: this.providers[0].model, attempts: 0 };
    // Whatever happens, a visitor leaving included, the cost is charged and the question logged.
    try {
      yield { event: 'meta', data: { id, sources } };
      let stop: 'end' | 'length' | 'refusal' | null = null;
      for await (const ev of answerFrom(this.providers, c.request, c.signal)) {
        if (ev.type === 'text') {
          text += ev.text;
          yield { event: 'delta', data: { text: ev.text } };
        } else if (ev.type === 'spent') result = ev;
        else stop = ev.stop;
      }
      if (stop === 'refusal') {
        outcome = 'REFUSED';
        yield { event: 'replace', data: { text: OFF_TOPIC_ANSWER } };
      } else if (stop === 'length') {
        outcome = 'TRUNCATED';
        yield { event: 'delta', data: { text: '\n\nThis answer was cut short. Open the pages below for the rest.' } };
      } else outcome = text.trim().startsWith(NOT_FOUND_ANSWER) ? 'NOT_FOUND' : 'ANSWERED';
    } catch (err) {
      if (!c.signal.aborted) {
        outcome = 'ERROR';
        logger.warn({ err: err instanceof Error ? { name: err.name, message: err.message.slice(0, 200) } : 'error' }, 'help assistant answer failed');
      }
    } finally {
      await this.settle(c.held, result.cost).catch((err: unknown) => logger.warn({ err }, 'could not settle the help budget'));
      await this.log({
        id,
        outcome,
        question: c.question,
        sources,
        signedIn: c.signedIn,
        started: c.started,
        model: result.model,
        inputTokens: result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens,
        outputTokens: result.usage.outputTokens,
        costMicros: result.cost,
        attempts: result.attempts,
      });
    }
    if (outcome === 'ERROR') {
      yield { event: 'error', data: { message: 'The help assistant could not finish this answer. Try again, or use Search.' } };
      return;
    }
    if (outcome === 'CANCELLED') return;
    if (c.cacheKey && outcome === 'ANSWERED' && text) await this.redis.client.set(c.cacheKey, JSON.stringify({ text, urls: c.hits.map((h) => h.chunk.url) }), 'EX', CACHE_TTL_S).catch(() => undefined);
    yield { event: 'done', data: { outcome: outcome.toLowerCase() } };
  }

  /** An answer that needs no model: not found, off topic, blocked or cached. */
  private async fixed(text: string, outcome: Outcome, question: string, signedIn: boolean, started: number, hits: Hit[] = []): Promise<AsyncGenerator<HelpEvent>> {
    const id = randomUUID();
    const sources = sourcesOf(hits);
    // Blocked text is not kept: nothing in it is useful for improving the docs.
    await this.log({ id, outcome, question: outcome === 'BLOCKED' ? null : question, sources, signedIn, started });
    return (async function* () {
      yield { event: 'meta' as const, data: { id, sources: outcome === 'CACHED' ? sources : [] } };
      yield { event: 'delta' as const, data: { text } };
      yield { event: 'done' as const, data: { outcome: outcome.toLowerCase() } };
    })();
  }

  // ---------------------------------------------------------------- limits

  private requesterKey(asker: Asker) {
    return asker.userId ? `u:${asker.userId}` : `ip:${sha(`${this.infra.sessionSecret}|${networkOf(asker.ip)}`).slice(0, 24)}`;
  }

  private async count(key: string, ttl: number) {
    // In one step: a count left without an expiry would lock the person out for good.
    return Number(await this.redis.client.eval("local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n", 1, key, ttl));
  }

  private async firstThisMinute(what: string, asker: Asker): Promise<boolean> {
    return (await this.redis.client.set(`help:once:${what}:${this.requesterKey(asker)}`, '1', 'EX', 60, 'NX')) === 'OK';
  }

  /** Per person (signed in) or per address (anonymous), per minute and per day; anonymous addresses also per day. */
  private async limit(asker: Asker, started: number) {
    const who = this.requesterKey(asker);
    const perDay = asker.userId ? this.cfg.signedInPerDay : this.cfg.perDay;
    const minute = await this.count(`help:rl:m:${who}`, 60);
    const day = await this.count(`help:rl:d:${who}:${today()}`, 26 * 3600);
    if (minute > this.cfg.perMinute || day > perDay) {
      if (await this.firstThisMinute('limited', asker)) await this.log({ outcome: 'RATE_LIMITED', signedIn: !!asker.userId, started });
      throw new AppError(
        'RATE_LIMITED',
        429,
        minute > this.cfg.perMinute
          ? 'Too many questions in the last minute. Wait a moment and ask again.'
          : 'You have asked the most questions allowed today. Search still works, and the assistant is back tomorrow.',
      );
    }
  }

  /** The same question again within a few seconds is a double click or a script, not a new question. */
  private async notRepeated(asker: Asker, question: string) {
    const key = `help:last:${this.requesterKey(asker)}:${sha(normalizeQuestion(question)).slice(0, 16)}`;
    const fresh = await this.redis.client.set(key, '1', 'EX', 5, 'NX');
    if (!fresh) throw new AppError('RATE_LIMITED', 429, 'You just asked that. The answer is above.');
  }

  /** Cloudflare Turnstile: a fresh token per question for visitors who are not signed in. */
  private async human(token: string | null): Promise<boolean> {
    if (!token || token.length > 2048) return false;
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: this.cfg.turnstileSecretKey!, response: token }),
        signal: AbortSignal.timeout(8_000),
      });
      return ((await res.json()) as { success?: boolean }).success === true;
    } catch {
      // The check could not be made: refuse rather than let unchecked traffic through.
      return false;
    }
  }

  private async settle(held: Reservation, micros: number) {
    const day = await this.budget.settle(held, micros);
    // Administrators hear once a day when the assistant has used most of its daily budget.
    if (day >= this.cfg.dailyBudget * 1e6 * 0.8 && (await this.redis.client.set(`help:alert:${today()}`, '1', 'EX', 26 * 3600, 'NX'))) {
      await this.notifications
        .notifyHolders(this.prisma, 'admin.settings', {
          type: 'SECURITY_ALERT',
          title: 'The help assistant has used 80% of today’s budget',
          body: `Spent about $${(day / 1e6).toFixed(2)} of $${this.cfg.dailyBudget.toFixed(2)} today. It pauses by itself at the limit; search keeps working.`,
          link: '/admin?tab=help',
          dedupeKey: `help-budget-${today()}`,
        })
        .catch((err: unknown) => logger.warn({ err }, 'could not send the help budget alert'));
    }
  }

  private history(raw: unknown): ChatMessage[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw badRequest('history must be a list', [{ field: 'history', message: 'A list of earlier turns' }]);
    const turns = raw
      .slice(-MAX_HISTORY_TURNS * 2)
      .filter((t): t is { role: 'user' | 'assistant'; content: string } => !!t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
      .map((t) => ({ role: t.role, content: scrubPersonal(t.content.replace(/<[^>]*>/g, ' ').slice(0, MAX_TURN_CHARS)) }));
    // The conversation must start with the visitor and alternate.
    while (turns.length && turns[0].role !== 'user') turns.shift();
    const out: ChatMessage[] = [];
    for (const t of turns) if (!out.length || out[out.length - 1].role !== t.role) out.push(t);
    if (out.length && out[out.length - 1].role === 'user') out.pop();
    // The oldest turns go first when the whole is too long.
    while (out.reduce((n, m) => n + m.content.length, 0) > MAX_HISTORY_CHARS) out.splice(0, 2);
    return out;
  }

  /** The question's vector, when the index was built with embeddings. Failures fall back to keywords. */
  private async embedQuery(text: string): Promise<number[] | null> {
    const e = this.cfg.embedding;
    if (e.provider !== 'voyage' || !e.apiKey || !this.index.search?.index.embeddingModel) return null;
    try {
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${e.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.index.search.index.embeddingModel, input_type: 'query', input: [text] }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return null;
      return ((await res.json()) as { data: { embedding: number[] }[] }).data[0]?.embedding ?? null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- logs and feedback

  private async log(e: {
    id?: string;
    outcome: Outcome;
    question?: string | null;
    sources?: unknown;
    signedIn: boolean;
    started: number;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    costMicros?: number;
    attempts?: number;
  }) {
    const model = e.model ?? 'none';
    helpAnswers.inc({ outcome: e.outcome, model });
    if (e.model) {
      helpTokens.inc({ direction: 'input', model }, e.inputTokens ?? 0);
      helpTokens.inc({ direction: 'output', model }, e.outputTokens ?? 0);
      helpCost.inc({ model }, (e.costMicros ?? 0) / 1e6);
      helpLatency.observe((Date.now() - e.started) / 1000);
    }
    try {
      await this.prisma.helpQuestion.create({
        data: {
          ...(e.id ? { id: e.id } : {}),
          outcome: e.outcome,
          question: e.question ? e.question.slice(0, 500) : null,
          sources: (e.sources ?? []) as Prisma.InputJsonValue,
          model: e.model ?? null,
          inputTokens: e.inputTokens ?? 0,
          outputTokens: e.outputTokens ?? 0,
          costMicros: e.costMicros ?? 0,
          attempts: e.attempts ?? 0,
          promptVersion: e.model ? PROMPT_VERSION : null,
          latencyMs: Date.now() - e.started,
          signedIn: e.signedIn,
        },
      });
    } catch (err) {
      logger.warn({ err }, 'could not log a help question');
    }
  }

  async feedback(id: unknown, helpful: unknown) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || typeof helpful !== 'boolean') throw badRequest('id and helpful are required');
    // Only once, and only for an answer given in the last day.
    await this.prisma.helpQuestion.updateMany({ where: { id, helpful: null, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } }, data: { helpful } });
    return { ok: true };
  }

  async pageFeedback(path: unknown, helpful: unknown, asker: Asker) {
    if (typeof path !== 'string' || !/^\/help\/[\w\-/.]*$/.test(path) || path.length > 300 || typeof helpful !== 'boolean') throw badRequest('path and helpful are required');
    const n = await this.count(`help:pf:${this.requesterKey(asker)}:${today()}`, 26 * 3600);
    if (n > 100) return { ok: true };
    await this.prisma.helpPageFeedback.create({ data: { path, helpful } });
    return { ok: true };
  }

  async purgeOldLogs() {
    const before = new Date(Date.now() - this.cfg.logRetentionDays * 24 * 3600_000);
    const a = await this.prisma.helpQuestion.deleteMany({ where: { createdAt: { lt: before } } });
    const b = await this.prisma.helpPageFeedback.deleteMany({ where: { createdAt: { lt: before } } });
    return a.count + b.count;
  }

  /** The administrator's view: what people ask, what the docs do not answer, cost and refused requests. */
  async analytics(days: number) {
    const since = new Date(Date.now() - days * 24 * 3600_000);
    const where = { createdAt: { gte: since } };
    const [byOutcome, daily, top, unanswered, negative, pages] = await Promise.all([
      this.prisma.helpQuestion.groupBy({ by: ['outcome'], where, _count: { _all: true } }),
      this.prisma.$queryRaw<{ day: string; questions: bigint; cost: bigint }[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*) AS questions, coalesce(sum("costMicros"), 0) AS cost
        FROM "HelpQuestion" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ question: string; n: bigint }[]>`
        SELECT lower(question) AS question, count(*) AS n FROM "HelpQuestion"
        WHERE "createdAt" >= ${since} AND question IS NOT NULL AND outcome IN ('ANSWERED', 'CACHED') GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      this.prisma.helpQuestion.findMany({ where: { ...where, outcome: 'NOT_FOUND', question: { not: null } }, orderBy: { createdAt: 'desc' }, take: 30, select: { question: true, createdAt: true } }),
      this.prisma.helpQuestion.findMany({ where: { ...where, helpful: false }, orderBy: { createdAt: 'desc' }, take: 30, select: { question: true, sources: true, createdAt: true } }),
      this.prisma.$queryRaw<{ path: string; yes: bigint; no: bigint }[]>`
        SELECT path, count(*) FILTER (WHERE helpful) AS yes, count(*) FILTER (WHERE NOT helpful) AS no FROM "HelpPageFeedback"
        WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 3 DESC, 2 DESC LIMIT 20`,
    ]);
    const spent = await this.budget.spentToday();
    const outcomes = Object.fromEntries(byOutcome.map((o) => [o.outcome, o._count._all]));
    return {
      days,
      enabled: this.status(false).enabled,
      model: this.cfg.model,
      fallbackModel: this.cfg.providers[1]?.model ?? null,
      spentToday: spent.day / 1e6,
      spentThisMonth: spent.month / 1e6,
      dailyBudget: this.cfg.dailyBudget,
      monthlyBudget: this.cfg.monthlyBudget,
      outcomes,
      daily: daily.map((d) => ({ day: d.day, questions: Number(d.questions), cost: Number(d.cost) / 1e6 })),
      topQuestions: top.map((t) => ({ question: t.question, count: Number(t.n) })),
      unanswered: unanswered.map((u) => ({ question: u.question!, at: u.createdAt })),
      notHelpful: negative.map((n) => ({ question: n.question, sources: n.sources as { url: string }[], at: n.createdAt })),
      pages: pages.map((p) => ({ path: p.path, helpful: Number(p.yes), notHelpful: Number(p.no) })),
    };
  }
}

/** One home or office usually has a whole IPv6 /64 to itself, so counting single addresses would not limit anyone. */
export function networkOf(ip: string | null): string {
  if (!ip) return 'unknown';
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('%')[0].split('::');
  const h = head ? head.split(':') : [];
  const rest = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...h, ...Array<string>(Math.max(0, 8 - h.length - rest.length)).fill('0'), ...rest] : h;
  return full
    .slice(0, 4)
    .map((x) => x.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':');
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
const sourcesOf = (hits: Hit[]) => {
  const seen = new Set<string>();
  return hits
    .filter((h) => {
      const page = h.chunk.url;
      if (seen.has(page)) return false;
      seen.add(page);
      return true;
    })
    .slice(0, 4)
    .map((h) => ({ title: h.chunk.title, url: h.chunk.url, heading: h.chunk.heading }));
};
