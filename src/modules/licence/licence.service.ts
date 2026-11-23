import { randomUUID, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AppError, badRequest, requireRecentAuth } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { AuditService } from '../../core/audit.service.js';
import { licenceKey, LicenceError, readLicence, statusOf, type LicenceStatus } from '../../core/licence.js';
import { Prisma, PrismaService } from '../../core/prisma.service.js';

const KEY = 'licence.state';
/** Baked into the image when it is built with LICENCE_PUBLIC_KEY. An image without it needs no licence. */
const KEY_FILE = new URL('../../../licence.pub', import.meta.url);
const CACHE_MS = 60_000;
/** How often the latest time seen is written down. */
const SEEN_MS = 15 * 60_000;

interface Saved {
  installation: string;
  licence: string | null;
  startedAt: string | null;
  /** the latest time this installation has known, so setting the clock back gives nothing back */
  lastSeen: string;
  /** every licence used here, so one trial cannot be started twice */
  used: Record<string, string>;
  /** audit rows up to this one no longer count as evidence of the time: they are older than the licence in use */
  auditFrom: string;
}

@Injectable()
export class LicenceService implements OnModuleInit {
  private key: KeyObject | null = null;
  private cache: { at: number; status: LicenceStatus; installation: string } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
  ) {
    let pem = '';
    try {
      pem = readFileSync(KEY_FILE, 'utf8').trim();
    } catch {
      // Not built with a key.
    }
    // Tests only: in a real installation the environment belongs to the customer.
    if (infra.nodeEnv === 'test') pem = process.env.TEST_LICENCE_PUBLIC_KEY ?? pem;
    if (pem) this.key = licenceKey(pem);
  }

  async onModuleInit() {
    if (!this.key) return;
    // A licence given in the server settings is used once, if it is new here.
    const given = this.infra.licence;
    if (!given) return;
    try {
      await this.activate(given, true);
    } catch (err) {
      logger.warn({ reason: err instanceof Error ? err.message : 'failed' }, 'the licence in LICENCE could not be used');
    }
  }

  get required() {
    return !!this.key;
  }

  private async load(): Promise<Saved> {
    const fresh: Saved = { installation: randomUUID(), licence: null, startedAt: null, lastSeen: new Date().toISOString(), used: {}, auditFrom: '0' };
    await this.prisma.$executeRaw`INSERT INTO "Setting" ("key", "value", "version", "updatedAt") VALUES (${KEY}, ${JSON.stringify(fresh)}::jsonb, 1, now()) ON CONFLICT ("key") DO NOTHING`;
    return (await this.prisma.setting.findUniqueOrThrow({ where: { key: KEY } })).value as unknown as Saved;
  }

  /** The audit log is append-only, so its newest row is a second witness to how late it is. */
  private async latest(saved: Saved): Promise<Date> {
    const last = await this.prisma.auditLog.findFirst({ where: { id: { gt: BigInt(saved.auditFrom) } }, orderBy: { id: 'desc' }, select: { at: true } });
    return new Date(Math.max(Date.now(), Date.parse(saved.lastSeen), last?.at.getTime() ?? 0));
  }

  async status(): Promise<LicenceStatus & { installation: string | null }> {
    if (!this.key) return { state: 'not-required', readOnly: false, licence: null, startedAt: null, endsAt: null, readOnlyFrom: null, daysLeft: null, installation: null };
    if (this.cache && Date.now() - this.cache.at < CACHE_MS && Date.now() >= this.cache.at) return { ...this.cache.status, installation: this.cache.installation };
    const saved = await this.load();
    const now = await this.latest(saved);
    if (now.getTime() - Date.parse(saved.lastSeen) > SEEN_MS)
      // Only ever forwards, whichever process gets there first.
      await this.prisma
        .$executeRaw`UPDATE "Setting" SET "value" = jsonb_set("value", '{lastSeen}', to_jsonb(${now.toISOString()}::text)), "updatedAt" = now() WHERE "key" = ${KEY} AND "value"->>'lastSeen' < ${now.toISOString()}`;
    let status: LicenceStatus;
    try {
      status = statusOf(saved.licence ? readLicence(saved.licence, this.key, saved.installation) : null, saved.startedAt ? new Date(saved.startedAt) : null, now);
    } catch (err) {
      // Altered in the database: treated as none.
      logger.error({ reason: err instanceof Error ? err.message : 'failed' }, 'the stored licence is not valid');
      status = statusOf(null, null, now);
    }
    this.cache = { at: Date.now(), status, installation: saved.installation };
    return { ...status, installation: saved.installation };
  }

  /** Throws when the installation is read-only. */
  async requireWritable() {
    if (!this.key) return;
    const s = await this.status();
    if (!s.readOnly) return;
    throw new AppError(
      'READ_ONLY',
      403,
      s.state === 'missing'
        ? 'This installation has no licence yet, so nothing can be saved. An administrator can add one in Admin, Licence.'
        : 'The licence has ended, so nothing new can be saved. Everything is still here to read and export. An administrator can add a new licence in Admin, Licence.',
    );
  }

  async activate(text: string, fromServer = false): Promise<LicenceStatus> {
    if (!this.key) throw badRequest('This installation does not need a licence');
    if (!fromServer) requireRecentAuth();
    const saved = await this.load();
    let licence;
    try {
      licence = readLicence(text, this.key, saved.installation);
    } catch (err) {
      const message = err instanceof LicenceError ? err.message : 'That is not a licence';
      throw badRequest(message, [{ field: 'licence', message }]);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Setting" WHERE "key" = ${KEY} FOR UPDATE`;
      const now = (await tx.setting.findUniqueOrThrow({ where: { key: KEY } })).value as unknown as Saved;
      // The same licence again keeps its first start, so entering it twice does not start it twice.
      const first = now.used[licence.id];
      // A new licence carries the vendor's own date, which is better evidence than anything recorded here: a server
      // whose clock once jumped years ahead would otherwise stay locked until then.
      const at = first ? await this.latest(now) : new Date(Math.max(Date.now(), Date.parse(licence.issuedAt)));
      const newest = first ? null : await tx.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
      const startedAt = first ?? at.toISOString();
      const next: Saved = {
        ...now,
        licence: text.replace(/\s+/g, ''),
        startedAt,
        lastSeen: at.toISOString(),
        used: { ...now.used, [licence.id]: startedAt },
        auditFrom: newest ? newest.id.toString() : now.auditFrom,
      };
      // A server setting left in place must not put an older licence back over a newer one.
      if (fromServer && now.used[licence.id]) return;
      if (statusOf(licence, new Date(startedAt), at).readOnly) throw badRequest('This licence has already ended', [{ field: 'licence', message: 'Already ended' }]);
      await tx.setting.update({ where: { key: KEY }, data: { value: next as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      await this.audit.record(
        { action: 'licence.activated', entity: 'Setting', entityId: KEY, after: { id: licence.id, kind: licence.kind, customer: licence.customer, notAfter: licence.notAfter, days: licence.days } },
        tx,
      );
    });
    this.cache = null;
    return this.status();
  }
}
