import { Injectable } from '@nestjs/common';
import { can, currentUser } from '../../common/context.js';
import { badRequest, conflict, forbidden, notFound } from '../../common/errors.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { AuditService } from '../../core/audit.service.js';
import { Prisma, PrismaService } from '../../core/prisma.service.js';
import { StorageService } from '../../core/storage.service.js';
import { READ } from '../files/files.service.js';
import type { FolderInput, LibraryFileUpdate, LibraryQuery } from './library.dto.js';

export const LIBRARY = 'library';
/** Records a library file can be linked to, so it also shows on that record's history. */
const LINKABLE = ['Customer', 'Job'] as const;

/**
 * The file library: folders and documents the lab keeps (SOPs, certificates, customer letters), plus a view of
 * every file the system holds. Access follows the record a file belongs to: a file linked to a customer needs
 * permission to see customers, an invoice PDF needs invoice access, and so on. Generated exports that belong to
 * no record are shown only to the person who made them.
 */
@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private assertView() {
    if (!can('files.view')) throw forbidden();
  }

  private assertManage() {
    if (!can('files.manage')) throw forbidden();
  }

  /** The files this user may see, as a database condition. */
  private visible(): Prisma.FileObjectWhereInput {
    const entities = Object.entries(READ)
      .filter(([entity, perms]) => perms.some((p) => can(p)) && (entity !== 'Report' || can('reports.view')))
      .map(([entity]) => entity);
    if (can('tests.viewAll')) entities.push('SampleTest');
    return {
      deletedAt: null,
      OR: [{ entity: null, category: LIBRARY }, { entity: { in: entities } }, { entity: null, createdById: currentUser()?.id ?? '' }],
    };
  }

  // ---------------------------------------------------------------- folders
  async folders() {
    this.assertView();
    const rows = await this.prisma.fileFolder.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, include: { _count: { select: { files: { where: { deletedAt: null } } } } } });
    return rows.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, fileCount: f._count.files, version: f.version }));
  }

  private async assertFolder(id: string | null | undefined) {
    if (!id) return null;
    const f = await this.prisma.fileFolder.findFirst({ where: { id, deletedAt: null } });
    if (!f) throw badRequest('That folder does not exist', [{ field: 'folderId', message: 'Unknown folder' }]);
    return f;
  }

  async createFolder(dto: FolderInput) {
    this.assertManage();
    await this.assertFolder(dto.parentId);
    try {
      const f = await this.prisma.fileFolder.create({ data: { name: dto.name.trim(), parentId: dto.parentId ?? null, createdById: currentUser()?.id } });
      await this.audit.record({ action: 'Folder.create', entity: 'FileFolder', entityId: f.id, after: { name: f.name, parentId: f.parentId } });
      return { id: f.id, name: f.name, parentId: f.parentId, fileCount: 0, version: f.version };
    } catch (e) {
      throw duplicateName(e);
    }
  }

  async updateFolder(id: string, dto: FolderInput & { version: number }) {
    this.assertManage();
    const f = await this.prisma.fileFolder.findFirst({ where: { id, deletedAt: null } });
    if (!f) throw notFound('Folder');
    if (dto.parentId) {
      await this.assertFolder(dto.parentId);
      // A folder cannot move inside itself or one of its own subfolders.
      for (let cur: string | null = dto.parentId; cur; cur = (await this.prisma.fileFolder.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null) {
        if (cur === id) throw badRequest('A folder cannot be moved inside itself', [{ field: 'parentId', message: 'Choose another folder' }]);
      }
    }
    try {
      const { count } = await this.prisma.fileFolder.updateMany({ where: { id, version: dto.version }, data: { name: dto.name.trim(), parentId: dto.parentId ?? null, version: { increment: 1 } } });
      if (count !== 1) throw conflict();
    } catch (e) {
      throw duplicateName(e);
    }
    await this.audit.record({ action: 'Folder.update', entity: 'FileFolder', entityId: id, before: { name: f.name, parentId: f.parentId }, after: { name: dto.name, parentId: dto.parentId ?? null } });
    return (await this.folders()).find((x) => x.id === id)!;
  }

  async removeFolder(id: string) {
    this.assertManage();
    const f = await this.prisma.fileFolder.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { files: { where: { deletedAt: null } }, children: { where: { deletedAt: null } } } } },
    });
    if (!f) throw notFound('Folder');
    if (f._count.files || f._count.children) throw badRequest('Only an empty folder can be removed. Move or remove what is inside it first.');
    await this.prisma.fileFolder.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ action: 'Folder.remove', entity: 'FileFolder', entityId: id, before: { name: f.name } });
  }

  // ---------------------------------------------------------------- files
  async list(q: LibraryQuery) {
    this.assertView();
    const scope = q.scope ?? 'library';
    const where: Prisma.FileObjectWhereInput = {
      AND: [
        this.visible(),
        scope === 'library' ? { category: LIBRARY } : scope === 'system' ? { category: { not: LIBRARY } } : {},
        q.folderId === 'none' ? { folderId: null } : q.folderId ? { folderId: q.folderId } : {},
        q.entity ? { entity: q.entity, ...(q.entityId ? { entityId: q.entityId } : {}) } : {},
        q.q ? { OR: [{ originalName: { contains: q.q, mode: 'insensitive' } }, { description: { contains: q.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.fileObject.findMany({ where, include: { folder: { select: { name: true } } }, orderBy: orderBy(q, ['createdAt', 'originalName', 'sizeBytes'], 'createdAt', 'desc'), ...skipTake(q) }),
      this.prisma.fileObject.count({ where }),
    ]);
    const labels = await this.entityLabels(rows);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const manage = can('files.manage');
    return toPage(
      rows.map((r) => ({
        id: r.id,
        originalName: r.originalName,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        category: r.category,
        entity: r.entity,
        entityId: r.entityId,
        entityLabel: r.entity && r.entityId ? (labels.get(`${r.entity}:${r.entityId}`) ?? null) : null,
        folderId: r.folderId,
        folderName: r.folder?.name ?? null,
        description: r.description,
        createdAt: r.createdAt,
        createdByName: r.createdById ? (userName.get(r.createdById) ?? null) : null,
        canEdit: manage && r.category === LIBRARY,
      })),
      total,
      q,
    );
  }

  /** Human names for the records files belong to, looked up once per page. */
  private async entityLabels(rows: { entity: string | null; entityId: string | null }[]) {
    const ids = (entity: string) => [...new Set(rows.filter((r) => r.entity === entity && r.entityId).map((r) => r.entityId!))];
    const out = new Map<string, string>();
    const put = (entity: string, list: { id: string; label: string }[]) => list.forEach((x) => out.set(`${entity}:${x.id}`, x.label));
    const [customers, jobs, samples, reports, invoices, quotations, tests] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: ids('Customer') } }, select: { id: true, name: true, crn: true } }),
      this.prisma.job.findMany({ where: { id: { in: ids('Job') } }, select: { id: true, jobNo: true } }),
      this.prisma.sample.findMany({ where: { id: { in: ids('Sample') } }, select: { id: true, sampleNo: true } }),
      this.prisma.report.findMany({ where: { id: { in: ids('Report') } }, select: { id: true, reportNo: true } }),
      this.prisma.invoice.findMany({ where: { id: { in: ids('Invoice') } }, select: { id: true, invoiceNo: true } }),
      this.prisma.quotation.findMany({ where: { id: { in: ids('Quotation') } }, select: { id: true, quotationNo: true } }),
      this.prisma.sampleTest.findMany({ where: { id: { in: ids('SampleTest') } }, select: { id: true, testName: true, sample: { select: { sampleNo: true } } } }),
    ]);
    put(
      'Customer',
      customers.map((c) => ({ id: c.id, label: `${c.name} (${c.crn})` })),
    );
    put(
      'Job',
      jobs.map((j) => ({ id: j.id, label: `Job ${j.jobNo}` })),
    );
    put(
      'Sample',
      samples.map((s) => ({ id: s.id, label: `Sample ${s.sampleNo}` })),
    );
    put(
      'Report',
      reports.map((r) => ({ id: r.id, label: `Report ${r.reportNo}` })),
    );
    put(
      'Invoice',
      invoices.map((i) => ({ id: i.id, label: `Invoice ${i.invoiceNo ?? 'draft'}` })),
    );
    put(
      'Quotation',
      quotations.map((x) => ({ id: x.id, label: `Quotation ${x.quotationNo}` })),
    );
    put(
      'SampleTest',
      tests.map((t) => ({ id: t.id, label: `${t.sample.sampleNo} · ${t.testName}` })),
    );
    return out;
  }

  private async assertLink(entity: string | null | undefined, entityId: string | null | undefined) {
    if (!entity && !entityId) return;
    if (!entity || !entityId || !(LINKABLE as readonly string[]).includes(entity)) throw badRequest('Files can be linked to a customer or a job', [{ field: 'entity', message: 'Customer or Job' }]);
    if (!READ[entity].some((p) => can(p))) throw forbidden();
    const exists = entity === 'Customer' ? await this.prisma.customer.count({ where: { id: entityId, deletedAt: null } }) : await this.prisma.job.count({ where: { id: entityId, deletedAt: null } });
    if (!exists) throw badRequest(`That ${entity.toLowerCase()} does not exist`, [{ field: 'entityId', message: 'Not found' }]);
  }

  async upload(input: { buffer: Buffer; originalName: string; folderId?: string | null; description?: string | null; entity?: string | null; entityId?: string | null }) {
    this.assertManage();
    await this.assertFolder(input.folderId);
    await this.assertLink(input.entity, input.entityId);
    const file = await this.storage.storeLibraryUpload({
      buffer: input.buffer,
      originalName: input.originalName,
      mimeType: '',
      category: LIBRARY,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
    });
    const saved = await this.prisma.fileObject.update({ where: { id: file.id }, data: { folderId: input.folderId ?? null, description: input.description?.trim() || null } });
    await this.audit.record({
      action: 'file.upload',
      entity: 'FileObject',
      entityId: file.id,
      after: { name: saved.originalName, folderId: saved.folderId, linkedTo: input.entity ? `${input.entity}:${input.entityId}` : null, sha256: saved.sha256 },
    });
    return saved;
  }

  private async libraryFile(id: string) {
    const f = await this.prisma.fileObject.findFirst({ where: { id, deletedAt: null } });
    if (!f) throw notFound('File');
    if (f.category !== LIBRARY) throw badRequest('Files made by the system (reports, invoices, attachments) are managed on their own record, not here.');
    return f;
  }

  async update(id: string, dto: LibraryFileUpdate) {
    this.assertManage();
    const f = await this.libraryFile(id);
    if (dto.folderId !== undefined) await this.assertFolder(dto.folderId);
    if (dto.entity !== undefined || dto.entityId !== undefined) await this.assertLink(dto.entity, dto.entityId);
    const name = dto.originalName?.trim();
    const data: Prisma.FileObjectUpdateInput = {
      ...(name ? { originalName: name.replace(/[^\w.\- ()]/g, '_').slice(0, 200) } : {}),
      ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
      ...(dto.folderId !== undefined ? { folder: dto.folderId ? { connect: { id: dto.folderId } } : { disconnect: true } } : {}),
      ...(dto.entity !== undefined ? { entity: dto.entity ?? null, entityId: dto.entityId ?? null } : {}),
    };
    const saved = await this.prisma.fileObject.update({ where: { id }, data });
    await this.audit.record({
      action: 'file.update',
      entity: 'FileObject',
      entityId: id,
      before: { name: f.originalName, folderId: f.folderId, description: f.description, entity: f.entity, entityId: f.entityId },
      after: { name: saved.originalName, folderId: saved.folderId, description: saved.description, entity: saved.entity, entityId: saved.entityId },
    });
    return saved;
  }

  async remove(id: string, reason?: string) {
    this.assertManage();
    const f = await this.libraryFile(id);
    await this.prisma.fileObject.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ action: 'file.remove', entity: 'FileObject', entityId: id, before: { name: f.originalName, folderId: f.folderId }, reason });
  }

  /** A short-lived link, checked against the same visibility as the list. */
  async url(id: string) {
    this.assertView();
    const f = await this.prisma.fileObject.findFirst({ where: { AND: [{ id }, this.visible()] } });
    if (!f) throw notFound('File');
    await this.audit.record({ action: 'file.download', entity: 'FileObject', entityId: id, after: { name: f.originalName } });
    return this.storage.signedUrl(id);
  }
}

function duplicateName(e: unknown) {
  if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002')
    return badRequest('A folder with this name already exists here', [{ field: 'name', message: 'Already exists here' }]);
  return e;
}
