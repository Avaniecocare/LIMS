import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { actorId, can, getContext, type CurrentUser } from '../../common/context.js';
import { AppError, badRequest, forbidden, notFound } from '../../common/errors.js';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { AuditService } from '../../core/audit.service.js';
import { CompanyService } from '../../core/company.service.js';
import { PrismaService } from '../../core/prisma.service.js';
import { FilesService } from '../files/files.service.js';
import type { ClaimPhoneUploadsDto, CreatePhoneUploadDto, PhonePurpose } from './phone-uploads.dto.js';

/** How long a phone link works. TODO(rbac-decision): 15 minutes and 20 photos per link chosen. */
export const PHONE_LINK_MINUTES = 15;
const MAX_UPLOADS = 20;
/** Where each kind of photo is stored: the record type and the attachment category. */
const TARGET: Record<PhonePurpose, { entity: string; category: string }> = {
  'sample-image': { entity: 'Sample', category: 'sample-image' },
  'report-photo': { entity: 'Report', category: 'report-photo' },
  'result-image': { entity: 'SampleTest', category: 'result-image' },
  'letter-page': { entity: 'Job', category: 'letter-page' },
  // Held against the link itself until the booking is saved; only the link's maker can see them.
  booking: { entity: 'PhoneDraft', category: 'sample-image' },
};

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * "Send photos from my phone". A signed-in person who may attach photos to a sample or report makes a link; the
 * phone that scans it can add photos to that one record and nothing else. The token is 256 random bits, kept only
 * as a hash, and the link ends after 15 minutes, after 20 photos, or when its maker closes it. Each upload runs with
 * the maker's current permissions, so a deactivated person's or a narrowed role's links stop working at once.
 */
@Injectable()
export class PhoneUploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly company: CompanyService,
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
  ) {}

  /** The sentence the phone shows. Record numbers only, never the customer. */
  private async labelFor(entity: string, entityId: string, note?: string | null) {
    switch (entity) {
      case 'Sample': {
        const s = await this.prisma.sample.findFirst({ where: { id: entityId, deletedAt: null }, select: { sampleNo: true } });
        if (!s) throw notFound('Sample');
        return `Photos of sample ${s.sampleNo}`;
      }
      case 'Report': {
        const r = await this.prisma.report.findUnique({ where: { id: entityId }, select: { reportNo: true, latestStatus: true, sample: { select: { sampleNo: true } } } });
        if (!r) throw notFound('Report');
        if (r.latestStatus !== 'DRAFT') throw new AppError('LOCKED', 422, 'Photos can only be added while the report is a draft');
        return `Photos for report ${r.reportNo} (sample ${r.sample.sampleNo})`;
      }
      case 'SampleTest': {
        const t = await this.prisma.sampleTest.findFirst({ where: { id: entityId, deletedAt: null }, select: { testName: true, sample: { select: { sampleNo: true } } } });
        if (!t) throw notFound('Test');
        return `Result photos: ${t.testName}, sample ${t.sample.sampleNo}`;
      }
      case 'Job': {
        const j = await this.prisma.job.findFirst({ where: { id: entityId, deletedAt: null }, select: { jobNo: true } });
        if (!j) throw notFound('Job');
        return `Pages of the customer's letter, job ${j.jobNo}`;
      }
      default:
        return `Photos for a new booking${note?.trim() ? ` (${note.trim()})` : ''}`;
    }
  }

  async create(dto: CreatePhoneUploadDto) {
    const target = TARGET[dto.purpose];
    let entityId: string;
    if (dto.purpose === 'booking') {
      // Nothing to attach to yet: whoever may book may collect photos for it.
      if (!can('jobs.create')) throw forbidden();
      entityId = randomUUID();
    } else {
      entityId = dto.entityId!;
      // Same rule as attaching a file from the computer.
      await this.files.assertCanAttach(target.entity, entityId);
    }
    const label = await this.labelFor(target.entity, entityId, dto.note);
    const token = randomBytes(32).toString('base64url');
    const link = await this.prisma.phoneUploadLink.create({
      data: { ...(dto.purpose === 'booking' ? { id: entityId } : {}), tokenHash: hash(token), entity: target.entity, entityId, category: target.category, label, createdById: actorId()!, expiresAt: new Date(Date.now() + PHONE_LINK_MINUTES * 60_000), maxUploads: MAX_UPLOADS },
    });
    await this.audit.record({ action: 'phoneUpload.linkCreated', entity: target.entity, entityId, after: { linkId: link.id, purpose: dto.purpose, expiresAt: link.expiresAt } });
    const url = `${this.infra.frontendOrigin.replace(/\/+$/, '')}/phone/${token}`;
    return { id: link.id, url, qrDataUri: await QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' }), label, expiresAt: link.expiresAt, maxUploads: link.maxUploads };
  }

  /**
   * After booking: photos sent from a phone are moved from the maker's holding area onto the new sample. Only the
   * person who collected them can move them, and only onto a sample they may attach photos to.
   */
  async claim(dto: ClaimPhoneUploadsDto) {
    await this.files.assertCanAttach('Sample', dto.sampleId);
    const ids = [...new Set(dto.fileIds)];
    const held = await this.prisma.fileObject.findMany({ where: { id: { in: ids }, entity: 'PhoneDraft', deletedAt: null }, select: { id: true, entityId: true } });
    const mine = new Set((await this.prisma.phoneUploadLink.findMany({ where: { id: { in: held.map((f) => f.entityId!) }, createdById: actorId()! }, select: { id: true } })).map((l) => l.id));
    if (held.length !== ids.length || held.some((f) => !mine.has(f.entityId!))) throw forbidden();
    await this.prisma.fileObject.updateMany({ where: { id: { in: ids } }, data: { entity: 'Sample', entityId: dto.sampleId, category: 'sample-image' } });
    await this.audit.record({ action: 'phoneUpload.claimed', entity: 'Sample', entityId: dto.sampleId, after: { fileIds: ids } });
    return { claimed: ids.length };
  }

  private active(link: { expiresAt: Date; revokedAt: Date | null; fileIds: string[]; maxUploads: number }) {
    return !link.revokedAt && link.expiresAt.getTime() > Date.now() && link.fileIds.length < link.maxUploads;
  }

  /** The maker's own links only. */
  private async mine(id: string) {
    const link = await this.prisma.phoneUploadLink.findUnique({ where: { id } });
    if (!link || link.createdById !== actorId()) throw notFound('Link');
    return link;
  }

  async status(id: string) {
    const link = await this.mine(id);
    return { id: link.id, label: link.label, expiresAt: link.expiresAt, active: this.active(link), fileIds: link.fileIds, maxUploads: link.maxUploads };
  }

  async end(id: string) {
    const link = await this.mine(id);
    if (!link.revokedAt) await this.prisma.phoneUploadLink.update({ where: { id }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  /** The same answer for an unknown, used-up, ended or expired link, so a phone learns nothing from a guess. */
  private async usable(token: string) {
    const link = typeof token === 'string' && token.length >= 40 && token.length <= 64 ? await this.prisma.phoneUploadLink.findUnique({ where: { tokenHash: hash(token) } }) : null;
    if (!link || !this.active(link)) throw new AppError('LINK_EXPIRED', 410, 'This link has expired or been used up. Ask for a new QR code on the computer.');
    return link;
  }

  async describe(token: string) {
    const link = await this.usable(token);
    return { laboratoryName: this.company.snapshot().companyName, label: link.label, expiresAt: link.expiresAt, remaining: link.maxUploads - link.fileIds.length };
  }

  async receive(token: string, file: { buffer: Buffer; filename: string; mimetype: string }) {
    const link = await this.usable(token);
    // Act as the link's maker, with their permissions as they are now.
    const maker = await this.prisma.user.findFirst({
      where: { id: link.createdById, isActive: true, deletedAt: null },
      include: { roles: { include: { role: { include: { permissions: true } } } } },
    });
    if (!maker) throw new AppError('LINK_EXPIRED', 410, 'This link has expired or been used up. Ask for a new QR code on the computer.');
    const roles = maker.roles.filter((r) => r.role.isActive && !r.role.deletedAt);
    const user: CurrentUser = { id: maker.id, name: maker.name, email: maker.email, designation: maker.designation, roles: roles.map((r) => r.role.name), permissions: new Set(roles.flatMap((r) => r.role.permissions.map((p) => p.permissionCode))), sessionId: `phone-link:${link.id}`, csrfToken: '' };
    const ctx = getContext();
    if (!ctx) throw forbidden();
    ctx.user = user;
    if (!file.mimetype.startsWith('image/')) throw badRequest('Only photos can be sent from a phone', [{ field: 'file', message: 'Not a photo' }]);
    if (link.entity === 'Report') await this.labelFor('Report', link.entityId); // still a draft
    const stored = await this.files.upload({ buffer: file.buffer, originalName: file.filename || 'phone-photo.jpg', mimeType: file.mimetype, category: link.category, entity: link.entity, entityId: link.entityId });
    if (!stored.mimeType.startsWith('image/')) {
      await this.files.remove(stored.id, 'Not a photo (sent from a phone)');
      throw badRequest('Only photos can be sent from a phone', [{ field: 'file', message: 'Not a photo' }]);
    }
    // Counted atomically, so two phones racing can't pass the limit.
    const updated = await this.prisma.$executeRaw`UPDATE "PhoneUploadLink" SET "fileIds" = array_append("fileIds", ${stored.id}) WHERE "id" = ${link.id} AND "revokedAt" IS NULL AND cardinality("fileIds") < "maxUploads"`;
    if (updated !== 1) {
      await this.files.remove(stored.id, 'Phone link limit reached');
      throw new AppError('LINK_EXPIRED', 410, 'This link has expired or been used up. Ask for a new QR code on the computer.');
    }
    await this.audit.record({ action: 'phoneUpload.received', entity: link.entity, entityId: link.entityId, after: { linkId: link.id, fileId: stored.id } });
    const after = link.fileIds.length + 1;
    return { received: after, remaining: link.maxUploads - after };
  }
}
