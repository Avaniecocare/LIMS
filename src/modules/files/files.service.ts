import { Injectable } from '@nestjs/common';
import { can, currentUser } from '../../common/context.js';
import { badRequest, forbidden, notFound } from '../../common/errors.js';
import { AuditService } from '../../core/audit.service.js';
import { PrismaService } from '../../core/prisma.service.js';
import { PDFDocument } from 'pdf-lib';
import { StorageService, sniffMime, type StoreInput } from '../../core/storage.service.js';

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

/**
 * What a test's files are for. Images and instrument reports can be printed on the test report; raw data and
 * worksheets are the test's records and never are.
 */
export const TEST_FILE_KINDS = ['result-image', 'instrument-report', 'raw-data', 'worksheet'] as const;
const PRINTABLE = new Set(['result-image', 'instrument-report']);
// TODO(product-decision): the longest instrument report a test report carries as an annexure, and in all per test.
export const MAX_ANNEX_PAGES = 20;
export const MAX_ANNEX_PAGES_PER_TEST = 60;

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
    const file = input.entity === 'SampleTest' ? await this.storeTestFile(input) : await this.storage.storeUpload({ ...input, printOnReport: false });
    await this.audit.record({ action: 'file.upload', entity: input.entity!, entityId: input.entityId, after: { fileId: file.id, name: file.originalName, sha256: file.sha256 } });
    return file;
  }

  /** A test's files, checked for what each kind is for. */
  private async storeTestFile(input: StoreInput) {
    const kind = input.category;
    if (!(TEST_FILE_KINDS as readonly string[]).includes(kind)) throw badRequest('Unknown kind of test file', [{ field: 'category', message: TEST_FILE_KINDS.join(', ') }]);
    if (kind === 'raw-data') return this.storage.storeRawData({ ...input, printOnReport: false });
    if (kind === 'worksheet') return this.storage.storeUpload({ ...input, printOnReport: false });
    const test = await this.prisma.sampleTest.findUniqueOrThrow({ where: { id: input.entityId! }, select: { test: { select: { printAttachments: true } } } });
    const printOnReport = input.printOnReport ?? test.test.printAttachments;
    const mime = sniffMime(input.buffer);
    if (kind === 'result-image') {
      if (!mime?.startsWith('image/'))
        throw badRequest('Result images are photos or graphs as PNG, JPEG or WebP. Add an instrument PDF under Instrument reports.', [{ field: 'file', message: 'Not an image' }]);
      return this.storage.storeUpload({ ...input, printOnReport });
    }
    // Instrument reports: the machine software's own PDF, printed as annexure pages of the test report.
    if (mime !== 'application/pdf') throw badRequest('Instrument reports are PDF files exported from the instrument software', [{ field: 'file', message: 'Not a PDF' }]);
    let pages: number;
    try {
      pages = (await PDFDocument.load(Uint8Array.from(input.buffer), { updateMetadata: false })).getPageCount();
    } catch (e) {
      const locked = e instanceof Error && /encrypt/i.test(e.message);
      throw badRequest(
        locked ? 'This PDF is password-protected. Export it again from the instrument software without a password.' : 'This PDF could not be read. Export it again from the instrument software.',
        [{ field: 'file', message: locked ? 'Password-protected' : 'Unreadable PDF' }],
      );
    }
    if (pages < 1 || pages > MAX_ANNEX_PAGES)
      throw badRequest(`An instrument report can have up to ${MAX_ANNEX_PAGES} pages; this one has ${pages}. Export only the pages that belong on the report.`, [
        { field: 'file', message: 'Too many pages' },
      ]);
    const existing = await this.prisma.fileObject.aggregate({ where: { entity: 'SampleTest', entityId: input.entityId!, category: 'instrument-report', deletedAt: null }, _sum: { pageCount: true } });
    if ((existing._sum.pageCount ?? 0) + pages > MAX_ANNEX_PAGES_PER_TEST)
      throw badRequest(`A test's instrument reports can add up to ${MAX_ANNEX_PAGES_PER_TEST} pages to the report.`, [{ field: 'file', message: 'Too many pages for this test' }]);
    return this.storage.storeUpload({ ...input, printOnReport, pageCount: pages });
  }

  /** Caption and "print on report" of a test's image or instrument report, while the test is still open. */
  async update(id: string, patch: { caption?: string | null; printOnReport?: boolean }) {
    const file = await this.prisma.fileObject.findFirst({ where: { id, deletedAt: null } });
    if (!file) throw notFound('File');
    await this.assertAccess(file.entity, file.entityId, true);
    if (patch.printOnReport !== undefined && !PRINTABLE.has(file.category))
      throw badRequest('Only result images and instrument reports can be printed on a report', [{ field: 'printOnReport', message: 'Not printable' }]);
    const data = {
      ...(patch.caption !== undefined ? { caption: patch.caption?.trim().slice(0, 200) || null } : {}),
      ...(patch.printOnReport !== undefined ? { printOnReport: patch.printOnReport } : {}),
    };
    const updated = await this.prisma.fileObject.update({ where: { id }, data });
    await this.audit.record({
      action: 'file.update',
      entity: file.entity ?? 'File',
      entityId: file.entityId,
      before: { fileId: id, caption: file.caption, printOnReport: file.printOnReport },
      after: { fileId: id, ...data },
    });
    return updated;
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
