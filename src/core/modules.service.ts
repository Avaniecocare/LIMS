import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppError, badRequest, conflict } from '../common/errors.js';
import { logger } from '../common/logger.js';
import { INFRA_CONFIG, type InfraConfig } from '../config/infra.config.js';
import { AuditService } from './audit.service.js';
import { Prisma, PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';

/**
 * Parts of the product a laboratory can turn off. The core (customers, booking, planning, testing, approvals,
 * reports, masters, admin) is always on. Turning a module off hides its menus and buttons and refuses its endpoints;
 * nothing is deleted, so turning it back on brings everything back.
 */
// TODO(product-decision): which modules can be turned off, and whether a licence key should decide them.
export const MODULES = {
  quotations: { label: 'Orders and quotations', description: 'Enquiries, quotations and proforma invoices, and booking from an accepted quotation.' },
  dispatch: { label: 'Dispatch', description: 'Dispatch records, challans, and returnable samples.' },
  billing: { label: 'Billing', description: 'Tax invoices, payments, credit notes, due invoices and payment reminders.' },
  files: { label: 'File library', description: 'Folders of SOPs, certificates and other documents, with their own access role.' },
  phoneUpload: { label: 'Photos from a phone', description: 'A QR code that lets a phone send photos to a sample, test or report.' },
  analytics: { label: 'Analytics and MIS reports', description: 'Charts across the lab, and MIS reports with Excel and PDF export.' },
  quality: { label: 'Quality management', description: 'Equipment calibration and maintenance, staff authorisations and training, and non-conformance and CAPA.' },
  whatsapp: { label: 'WhatsApp', description: 'Send reports, invoices, sample-received letters and payment reminders to customers on WhatsApp.' },
  einvoice: { label: 'GST e-invoicing', description: 'Register B2B tax invoices and credit notes at the GST Invoice Registration Portal (IRN and signed QR code).' },
} as const;
/** Modules that also need the server set up; they stay off until it is. */
const NEEDS_SETUP: Partial<Record<keyof typeof MODULES, (infra: InfraConfig) => string | null>> = {
  whatsapp: (infra) => (infra.whatsapp ? null : 'Needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in the server settings.'),
  einvoice: (infra) => (infra.einvoice ? null : 'Needs EINVOICE_PROVIDER and the e-invoice API credentials in the server settings.'),
};
/** Modules that stay off until an administrator turns them on, even once the server is set up: switching them on
 *  changes what issuing an invoice does, so it must be a decision, not a side effect of a deployment. */
const OFF_UNTIL_TURNED_ON: ReadonlySet<string> = new Set(['einvoice']);
export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

const KEY = 'modules.enabled';
const CHANNEL = 'lims:modules-changed';

@Injectable()
export class ModulesService implements OnModuleInit, OnModuleDestroy {
  private cache: { at: number; map: Record<ModuleKey, boolean>; version: number } | null = null;
  private subscriber: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
  ) {}

  private setupNeeded(key: ModuleKey) {
    return NEEDS_SETUP[key]?.(this.infra) ?? null;
  }

  async onModuleInit() {
    try {
      this.subscriber = this.redis.client.duplicate();
      await this.subscriber.subscribe(CHANNEL);
      this.subscriber.on('message', () => (this.cache = null));
    } catch (err) {
      logger.warn({ err }, 'module change notifications are unavailable; other processes follow within a minute');
    }
  }

  async onModuleDestroy() {
    this.subscriber?.disconnect();
  }

  /** On/off for every module, read at most once a minute per process unless a change is announced. */
  async state(): Promise<{ map: Record<ModuleKey, boolean>; version: number }> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache;
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const saved = (row?.value as Partial<Record<ModuleKey, boolean>> | undefined) ?? {};
    const map = Object.fromEntries(MODULE_KEYS.map((k) => [k, (OFF_UNTIL_TURNED_ON.has(k) ? saved[k] === true : saved[k] !== false) && !this.setupNeeded(k)])) as Record<ModuleKey, boolean>;
    this.cache = { at: Date.now(), map, version: row?.version ?? 0 };
    return this.cache;
  }

  async isOn(key: ModuleKey) {
    return (await this.state()).map[key];
  }

  async enabled(): Promise<ModuleKey[]> {
    const { map } = await this.state();
    return MODULE_KEYS.filter((k) => map[k]);
  }

  /** Refuses with a clear message when the module is off. */
  async require(key: ModuleKey) {
    if (await this.isOn(key)) return;
    if (this.setupNeeded(key)) throw new AppError('MODULE_OFF', 403, `${MODULES[key].label} is not set up for this laboratory yet.`);
    throw new AppError('MODULE_OFF', 403, `${MODULES[key].label} is turned off for this laboratory. An administrator can turn it on in Admin, Modules.`);
  }

  async list() {
    const { map, version } = await this.state();
    return { version, modules: MODULE_KEYS.map((key) => ({ key, ...MODULES[key], enabled: map[key], setupNeeded: this.setupNeeded(key) })) };
  }

  async save(enabled: Record<string, boolean>, expectedVersion: number) {
    const unknown = Object.keys(enabled).filter((k) => !(MODULE_KEYS as string[]).includes(k));
    if (unknown.length) throw badRequest(`Unknown module ${unknown.join(', ')}`, [{ field: 'enabled', message: 'Unknown module' }]);
    const blocked = Object.entries(enabled).filter(([k, on]) => on && this.setupNeeded(k as ModuleKey));
    if (blocked.length) throw badRequest(this.setupNeeded(blocked[0][0] as ModuleKey)!, [{ field: 'enabled', message: 'Not set up' }]);
    const before = (await this.state()).map;
    const next = { ...before, ...enabled };
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findUnique({ where: { key: KEY } });
      if ((existing?.version ?? 0) !== expectedVersion) throw conflict();
      if (existing) {
        const { count } = await tx.setting.updateMany({ where: { key: KEY, version: expectedVersion }, data: { value: next as Prisma.InputJsonValue, version: { increment: 1 } } });
        if (count !== 1) throw conflict();
      } else await tx.setting.create({ data: { key: KEY, value: next as Prisma.InputJsonValue } });
      await this.audit.record({ action: 'modules.update', entity: 'Setting', entityId: KEY, before, after: next }, tx);
    });
    this.cache = null;
    // Other processes also re-read within a minute, so a failed announcement only delays them.
    await this.redis.client.publish(CHANNEL, '1').catch((err: unknown) => logger.warn({ err }, 'could not announce the module change'));
  }
}
