import { Injectable } from '@nestjs/common';
import { can, currentUser } from '../../common/context.js';
import { badRequest, forbidden, notFound } from '../../common/errors.js';
import { AuditService } from '../../core/audit.service.js';
import { PrismaService } from '../../core/prisma.service.js';
import { StorageService, type StoreInput } from '../../core/storage.service.js';

/**
 * Record-level access for attachments. A file carries the entity it belongs to, and access
 * follows the permissions on that entity, so technicians can't reach customer letters by id.
 */
export const READ: Record<string, string[]> = {
  Instrument: ['masters.view'],
  Customer: ['customers.view'],
  Order: ['orders.view'],
  Quotation: ['quotations.view'],
  // Letters and images on jobs and samples can identify the customer.
  Job: ['customers.view'],
  Sample: ['customers.view'],
  Report: ['customers.view'],
  Invoice: ['invoices.view'],
  CreditNote: ['invoices.view'],
  Dispatch: ['dispatch.view'],
  User: ['admin.users'],
};
const WRITE: Record<string, string[]> = {
  Instrument: ['masters.edit'],
  Order: ['orders.edit'],
  Job: ['jobs.create', 'jobs.edit'],
  Sample: ['jobs.create', 'jobs.edit'],
  // Photographs added while correcting a draft report.
  Report: ['reports.review', 'reports.approve'],
  User: ['admin.users'],
};

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Tests are visible to all reviewers of tests, or to the technician assigned to them. */
  private async canReachTest(sampleTestId: string, write: boolean): Promise<boolean> {
    const test = await this.prisma.sampleTest.findUnique({ where: { id: sampleTestId }, select: { assignedToId: true, status: true } });
    if (!test) return false;
    // Approval locks results, and that includes their images and worksheets.
    if (write && test.status !== 'IN_PROGRESS') return false;
    if (can('tests.work') && test.assignedToId === currentUser()?.id) return true;
    return !write && can('tests.viewAll');
  }

  private async assertAccess(entity: string | null, entityId: string | null, write: boolean) {
    // Photos sent from a phone during a booking: only the person collecting them, until they are moved to the sample.
    if (entity === 'PhoneDraft' && entityId) {
      const link = await this.prisma.phoneUploadLink.findUnique({ where: { id: entityId }, select: { createdById: true } });
      if (link && link.createdById === currentUser()?.id) return;
      throw forbidden();
    }
    if (entity === 'SampleTest' && entityId) {
      if (await this.canReachTest(entityId, write)) return;
      throw forbidden();
    }
    const allowed = entity ? (write ? WRITE : READ)[entity] : undefined;
    if (entity === 'Report' && !write && !can('reports.view')) throw forbidden();
    if (!allowed || !allowed.some((p) => can(p))) throw forbidden();
  }

  /** Whether the caller may attach files to this record (used before handing out a phone link). */
  async assertCanAttach(entity: string, entityId: string) {
    await this.assertAccess(entity, entityId, true);
  }

  async upload(input: StoreInput) {
    await this.assertAccess(input.entity ?? null, input.entityId ?? null, true);
    if (!input.entityId) throw badRequest('Attachments must belong to a record', [{ field: 'entityId', message: 'Required' }]);
    const file = await this.storage.storeUpload(input);
    await this.audit.record({ action: 'file.upload', entity: input.entity!, entityId: input.entityId, after: { fileId: file.id, name: file.originalName, sha256: file.sha256 } });
    return file;
  }

  async list(entity: string, entityId: string, category?: string) {
    await this.assertAccess(entity, entityId, false);
    return this.prisma.fileObject.findMany({
      where: { entity, entityId, deletedAt: null, ...(category ? { category } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async url(id: string) {
    const file = await this.prisma.fileObject.findFirst({ where: { id, deletedAt: null } });
    if (!file) throw notFound('File');
    if (file.createdById !== currentUser()?.id) await this.assertAccess(file.entity, file.entityId, false);
    return this.storage.signedUrl(id);
  }

  async remove(id: string, reason?: string) {
    const file = await this.prisma.fileObject.findFirst({ where: { id, deletedAt: null } });
    if (!file) throw notFound('File');
    await this.assertAccess(file.entity, file.entityId, true);
    await this.prisma.fileObject.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ action: 'file.remove', entity: file.entity ?? 'File', entityId: file.entityId, before: { fileId: id, name: file.originalName }, reason });
  }
}
