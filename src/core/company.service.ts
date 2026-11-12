import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { badRequest, conflict } from '../common/errors.js';
import { logger } from '../common/logger.js';
import {
  defaultCompany,
  legacyCompanyFromEnv,
  toCompanyConfig,
  validateBranding,
  validateProfile,
  type BrandingSettings,
  type CompanyConfig,
  type CompanyProfile,
  type CompanySnapshot,
} from '../config/company.config.js';
import { AuditService } from './audit.service.js';
import { Prisma, PrismaService } from './prisma.service.js';
import { RedisService } from './redis.service.js';
import { StorageService } from './storage.service.js';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

export const mimeForPath = (path: string) => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';

const PROFILE_KEY = 'company.profile';
const BRANDING_KEY = 'company.branding';
const CHANNEL = 'lims:company-changed';

export type BrandImageKind = 'logo' | 'favicon' | 'login';
const IMAGE_FIELD: Record<BrandImageKind, 'logoFileId' | 'faviconFileId' | 'loginImageFileId'> = { logo: 'logoFileId', favicon: 'faviconFileId', login: 'loginImageFileId' };

interface Image {
  buffer: Buffer;
  mimeType: string;
  version: string;
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Until the lab uploads a logo: its initials on its primary colour, so nothing shows a broken image. */
export function initialsMark(name: string, color: string): Buffer {
  const initials =
    name
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z0-9]/g, '')[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'L';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" rx="14" fill="${escapeXml(color)}"/><text x="32" y="41" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#ffffff">${escapeXml(initials)}</text></svg>`,
  );
}

/**
 * The laboratory's identity and branding, from the database. Every process (API and worker) keeps a copy in memory
 * so the many synchronous readers (PDF templates, emails, numbering) stay fast, and reloads it whenever any process
 * saves a change, announced over Redis. Nothing needs a restart.
 */
@Injectable()
export class CompanyService implements OnModuleInit, OnModuleDestroy {
  private profile: CompanyProfile;
  private brand: BrandingSettings;
  private versions = { profile: 0, branding: 0 };
  private images = new Map<BrandImageKind, Image | null>();
  private current: CompanyConfig;
  private subscriber: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {
    // Usable before the database has been read (and in tools that never start the module): the defaults.
    const legacy = legacyCompanyFromEnv();
    const start = legacy ?? defaultCompany();
    this.profile = start.profile;
    this.brand = start.branding;
    this.current = toCompanyConfig(this.profile, this.brand);
  }

  async onModuleInit() {
    await this.seed();
    await this.reload();
    try {
      this.subscriber = this.redis.client.duplicate();
      await this.subscriber.subscribe(CHANNEL);
      this.subscriber.on('message', () => void this.reload().catch((err) => logger.error({ err }, 'reloading the lab profile failed')));
    } catch (err) {
      logger.warn({ err }, 'lab profile change notifications are unavailable; changes apply to other processes on restart');
    }
  }

  async onModuleDestroy() {
    this.subscriber?.disconnect();
  }

  /** The profile and branding as last saved, for every synchronous reader. */
  get config(): CompanyConfig {
    return this.current;
  }

  /**
   * First start: import an install configured with COMPANY_* variables (images included), or start from BRAND_NAME.
   * Only ever inserts, so a profile saved by the admin is never overwritten, even by an older image's start-up.
   */
  private async seed() {
    const [p, b] = await Promise.all([this.prisma.setting.findUnique({ where: { key: PROFILE_KEY } }), this.prisma.setting.findUnique({ where: { key: BRANDING_KEY } })]);
    if (p && b) return;
    const legacy = legacyCompanyFromEnv();
    const start = legacy ?? defaultCompany();
    const branding = { ...start.branding };
    if (legacy && !b) {
      const store = async (path: string | null, name: string) => {
        if (!path) return null;
        try {
          const buffer = readFileSync(path);
          return (await this.storage.store({ buffer, originalName: name, mimeType: mimeForPath(path), category: 'branding', entity: 'Branding', entityId: null })).id;
        } catch (err) {
          logger.warn({ err }, `could not import the ${name} from COMPANY_* settings`);
          return null;
        }
      };
      branding.logoFileId = await store(legacy.logoPath, `logo${extname(legacy.logoPath ?? '.png')}`);
      branding.faviconFileId = await store(legacy.faviconPath, `favicon${extname(legacy.faviconPath ?? '.png')}`);
    }
    const insert = (key: string, value: unknown) => this.prisma.$executeRaw`INSERT INTO "Setting" ("key", "value", "version", "updatedAt") VALUES (${key}, ${JSON.stringify(value)}::jsonb, 1, now()) ON CONFLICT ("key") DO NOTHING`;
    if (!p) await insert(PROFILE_KEY, start.profile);
    // An install imported from COMPANY_* settings is already set up: its administrators skip the setup wizard.
    if (legacy && !p) await insert('setup.labCompleted', true);
    if (!b) await insert(BRANDING_KEY, branding);
    logger.info(legacy ? 'lab profile imported from COMPANY_* settings' : 'lab profile started from BRAND_NAME');
  }

  /** Reads the saved profile and branding (and their images) into memory. */
  async reload() {
    const [p, b] = await Promise.all([this.prisma.setting.findUnique({ where: { key: PROFILE_KEY } }), this.prisma.setting.findUnique({ where: { key: BRANDING_KEY } })]);
    const defaults = defaultCompany();
    // A missing row (never saved, or cleared) means version 0; what is in memory is kept until something is saved.
    if (!p) this.versions.profile = 0;
    if (!b) this.versions.branding = 0;
    if (p) {
      const saved = p.value as unknown as Partial<CompanyProfile>;
      this.profile = { ...defaults.profile, ...saved, bank: { ...defaults.profile.bank, ...saved.bank }, accreditation: { ...defaults.profile.accreditation, ...saved.accreditation } };
      this.versions.profile = p.version;
    }
    if (b) {
      this.brand = { ...defaults.branding, ...(b.value as unknown as Partial<BrandingSettings>) };
      this.versions.branding = b.version;
    }
    this.images.clear();
    for (const kind of Object.keys(IMAGE_FIELD) as BrandImageKind[]) this.images.set(kind, await this.loadImage(this.brand[IMAGE_FIELD[kind]]));
    this.current = toCompanyConfig(this.profile, this.brand);
  }

  private async loadImage(fileId: string | null): Promise<Image | null> {
    if (!fileId) return null;
    try {
      const f = await this.storage.read(fileId);
      return { buffer: f.buffer, mimeType: f.mimeType, version: fileId.slice(-12) };
    } catch (err) {
      logger.warn({ err, fileId }, 'a branding image could not be read; the default is used');
      return null;
    }
  }

  /** A branding image, or the built-in default (initials) for the logo and favicon. */
  image(kind: BrandImageKind): Image | null {
    const saved = this.images.get(kind);
    if (saved) return saved;
    if (kind === 'login') return null;
    const mark = initialsMark(this.current.companyName, this.brand.primaryColor);
    return { buffer: mark, mimeType: 'image/svg+xml', version: `d${this.versions.branding}` };
  }

  logoDataUri(): string | null {
    const saved = this.images.get('logo');
    return saved ? `data:${saved.mimeType};base64,${saved.buffer.toString('base64')}` : null;
  }

  /** Stored on documents when issued; PDFs regenerate from this, never from the live profile. */
  snapshot(): CompanySnapshot {
    const { branding, ...rest } = this.current;
    return { ...rest, branding: { primaryColor: branding.primaryColor, accentColor: branding.accentColor, logoDataUri: this.logoDataUri() } };
  }

  /** For the admin screens: everything, read fresh, with the versions needed to save. */
  async details() {
    await this.reload();
    return { profile: this.profile, branding: this.brand, productName: this.current.productName, profileVersion: this.versions.profile, brandingVersion: this.versions.branding };
  }

  private async write(key: string, value: unknown, expectedVersion: number, action: string, before: unknown) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findUnique({ where: { key } });
      if ((existing?.version ?? 0) !== expectedVersion) throw conflict();
      if (existing) {
        const { count } = await tx.setting.updateMany({ where: { key, version: expectedVersion }, data: { value: value as Prisma.InputJsonValue, version: { increment: 1 } } });
        if (count !== 1) throw conflict();
      } else {
        await tx.setting.create({ data: { key, value: value as Prisma.InputJsonValue } });
      }
      await this.audit.record({ action, entity: 'Setting', entityId: key, before, after: value }, tx);
    });
    await this.reload();
    // Other processes also re-read within a minute, so a failed announcement only delays them.
    await this.redis.client.publish(CHANNEL, key).catch((err: unknown) => logger.warn({ err }, 'could not announce the lab profile change'));
  }

  async saveProfile(profile: CompanyProfile, expectedVersion: number) {
    const clean: CompanyProfile = {
      ...profile,
      gstin: profile.gstin.trim().toUpperCase(),
      pan: profile.pan.trim().toUpperCase(),
      bank: { ...profile.bank, ifsc: profile.bank.ifsc.trim().toUpperCase(), swift: profile.bank.swift?.trim().toUpperCase() || null },
    };
    const problems = validateProfile(clean);
    if (problems.length) throw badRequest('Some details need correcting', problems);
    // The audit keeps the bank account and other details as they were, for the record of who changed what.
    await this.write(PROFILE_KEY, clean, expectedVersion, 'company.profile.update', this.profile);
  }

  async saveBranding(branding: Omit<BrandingSettings, 'logoFileId' | 'faviconFileId' | 'loginImageFileId'>, expectedVersion: number) {
    const next: BrandingSettings = { ...this.brand, ...branding, appName: branding.appName?.trim() || null, loginTagline: branding.loginTagline?.trim() || null };
    const problems = validateBranding(next);
    if (problems.length) throw badRequest('Some details need correcting', problems);
    await this.write(BRANDING_KEY, next, expectedVersion, 'company.branding.update', this.brand);
  }

  /** Replaces (or, with null, removes) the logo, favicon or sign-in image. The old file stays for issued documents' history. */
  async setImage(kind: BrandImageKind, fileId: string | null, expectedVersion: number) {
    const next = { ...this.brand, [IMAGE_FIELD[kind]]: fileId };
    await this.write(BRANDING_KEY, next, expectedVersion, `company.branding.${kind}`, { [IMAGE_FIELD[kind]]: this.brand[IMAGE_FIELD[kind]] });
  }
}
