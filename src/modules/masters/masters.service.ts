/* eslint-disable @typescript-eslint/no-explicit-any -- generic over Prisma delegates */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { badRequest, conflict, notFound, flattenValidation } from '../../common/errors.js';
import { istToday } from '../../common/india.js';
import { orderBy, skipTake, toPage, type PageQuery } from '../../common/pagination.dto.js';
import { AuditService } from '../../core/audit.service.js';
import { PrismaService, type Tx } from '../../core/prisma.service.js';
import { DocumentsService, requirePermission, XLSX_MIME } from '../documents/documents.service.js';
import { convertUnit, FormulaError, runFormula } from '../formulas/expression.js';
import { compileFormula, MASTERS, type MasterDef } from './definitions.js';
import { buildWorkbook, readFirstSheet } from './excel.js';
import type { ConvertInput, FormulaTestInput, MasterQuery } from './masters.dto.js';

const MAX_IMPORT_ROWS = 5000;

export interface RateResult {
  rate: string | null;
  source: 'CUSTOMER_RATE' | 'STANDARD_RATE' | null;
}

@Injectable()
export class MastersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    for (const def of MASTERS) {
      this.documents.register(`master-export:${def.key}`, {
        authorize: requirePermission(def.view),
        run: async () => {
          const rows = await this.exportRows(def);
          return { buffer: await buildWorkbook([{ name: def.label, columns: def.columns, rows }]), filename: `${def.key}.xlsx`, mimeType: XLSX_MIME };
        },
      });
    }
  }

  private def(key: string): MasterDef {
    const d = MASTERS.find((m) => m.key === key);
    if (!d) throw notFound('Master');
    return d;
  }

  private where(def: MasterDef, q: MasterQuery & PageQuery) {
    const active = q.active ?? 'true';
    const search = q.q && def.search.length ? { OR: def.search.map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })) } : {};
    return {
      deletedAt: null,
      ...(active === 'all' ? {} : { isActive: active === 'true' }),
      ...search,
      ...(def.filter?.(q) ?? {}),
    };
  }

  async list(key: string, q: MasterQuery) {
    const def = this.def(key);
    const where = this.where(def, q);
    const d = def.delegate(this.prisma);
    const [rows, total] = await Promise.all([
      d.findMany({ where, include: def.include, orderBy: orderBy(q, def.sort as string[], def.defaultSort, 'asc'), ...skipTake(q) }),
      d.count({ where }),
    ]);
    return toPage(rows.map(def.dto), total, q);
  }

  async get(key: string, id: string) {
    const def = this.def(key);
    const row = await def.delegate(this.prisma).findFirst({ where: { id, deletedAt: null }, include: def.include });
    if (!row) throw notFound(def.label);
    return def.dto(row);
  }

  async create(key: string, input: any) {
    const def = this.def(key);
    return this.prisma.$transaction(async (tx) => this.createIn(def, tx, input));
  }

  private async createIn(def: MasterDef, tx: Tx, input: any) {
    const d = def.delegate(tx);
    const row = await d.create({ data: { ...(await def.data(input, tx)), ...(input.isActive === undefined ? {} : { isActive: input.isActive }) } });
    await def.children?.(tx, row.id, input);
    const full = await d.findUniqueOrThrow({ where: { id: row.id }, include: def.include });
    await this.audit.record({ action: `${def.entity}.create`, entity: def.entity, entityId: row.id, after: def.dto(full) }, tx);
    return def.dto(full);
  }

  async update(key: string, id: string, input: any) {
    const def = this.def(key);
    if (!input.version) throw badRequest('version is required', [{ field: 'version', message: 'Required' }]);
    return this.prisma.$transaction(async (tx) => this.updateIn(def, tx, id, input, input.version));
  }

  private async updateIn(def: MasterDef, tx: Tx, id: string, input: any, expectedVersion: number) {
    const d = def.delegate(tx);
    const before = await d.findFirst({ where: { id, deletedAt: null }, include: def.include });
    if (!before) throw notFound(def.label);
    const data = await def.data(input, tx, before);
    const { count } = await d.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, ...(input.isActive === undefined ? {} : { isActive: input.isActive }), version: { increment: 1 } },
    });
    if (count !== 1) throw conflict();
    await def.children?.(tx, id, input);
    const after = await d.findUniqueOrThrow({ where: { id }, include: def.include });
    await this.audit.record({ action: `${def.entity}.update`, entity: def.entity, entityId: id, before: def.dto(before), after: def.dto(after) }, tx);
    return def.dto(after);
  }

  /** Soft delete, refused when the record is in use: then it can only be deactivated. */
  async remove(key: string, id: string) {
    const def = this.def(key);
    await this.prisma.$transaction(async (tx) => {
      const d = def.delegate(tx);
      const row = await d.findFirst({ where: { id, deletedAt: null } });
      if (!row) throw notFound(def.label);
      const inUse = await def.inUse?.(tx, id);
      if (inUse) throw conflict(inUse);
      await d.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      await this.audit.record({ action: `${def.entity}.delete`, entity: def.entity, entityId: id, before: { isActive: row.isActive } }, tx);
    });
  }

  async history(key: string, id: string) {
    const def = this.def(key);
    const rows = await this.prisma.auditLog.findMany({ where: { entity: def.entity, entityId: id }, orderBy: { at: 'desc' }, take: 200 });
    return rows.map((r) => ({ id: r.id.toString(), at: r.at, userName: r.userName, action: r.action, before: r.before, after: r.after, reason: r.reason }));
  }

  private async exportRows(def: MasterDef) {
    const rows = await def.delegate(this.prisma).findMany({ where: { deletedAt: null }, include: def.include, orderBy: { [def.defaultSort]: 'asc' } });
    return rows.map(def.dto) as Record<string, unknown>[];
  }

  /**
   * All-or-nothing: if any row fails, nothing is saved and every failure is listed,
   * so a corrected file can simply be uploaded again.
   */
  async importExcel(key: string, buffer: Buffer, inputClass: new () => object) {
    const def = this.def(key);
    if (!def.fromRow || !def.importKey) throw badRequest('This master cannot be imported');
    let rows: Awaited<ReturnType<typeof readFirstSheet>>;
    try {
      rows = await readFirstSheet(buffer);
    } catch {
      throw badRequest('That is not a readable Excel file', [{ field: 'file', message: 'Unreadable file' }]);
    }
    if (rows.length > MAX_IMPORT_ROWS) throw badRequest(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);
    const errors: { row: number; message: string }[] = [];
    let created = 0;
    let updated = 0;
    class Rollback extends Error {}
    try {
      await this.prisma.$transaction(
        async (tx) => {
          for (const { row, values } of rows) {
            try {
              const input = await def.fromRow!(values, tx);
              const instance = plainToInstance(inputClass, stripUndefined(input));
              const problems = flattenValidation(await validate(instance, { whitelist: true }));
              if (problems.length) throw new Error(problems.map((p) => `${p.field}: ${p.message}`).join('; '));
              const existing = await def.delegate(tx).findFirst({ where: { ...def.importKey!(input), deletedAt: null } });
              if (existing) {
                await this.updateIn(def, tx, existing.id, input, existing.version);
                updated++;
              } else {
                await this.createIn(def, tx, input);
                created++;
              }
            } catch (e) {
              errors.push({ row, message: e instanceof Error ? e.message : 'Invalid row' });
              // A failed statement aborts the Postgres transaction, so stop rather than cascade errors.
              if (isDbError(e)) break;
            }
          }
          if (errors.length) throw new Rollback();
        },
        { timeout: 120_000 },
      );
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
      return { created: 0, updated: 0, errors };
    }
    return { created, updated, errors };
  }

  // ------------------------------------------------------------------- formulas & units
  testFormula(dto: FormulaTestInput) {
    try {
      const variables = compileFormula(dto.expression);
      const haveAll = variables.every((v) => dto.inputs[v] !== undefined && dto.inputs[v] !== '');
      if (!haveAll) return { valid: true, variables, value: null, working: null, error: null };
      const r = runFormula(dto.expression, dto.inputs, dto.decimals ?? 2);
      return { valid: true, variables, value: r.value, working: r.working, error: null };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Invalid formula';
      return { valid: false, variables: [], value: null, working: null, error };
    }
  }

  async convert(dto: ConvertInput) {
    const row = await this.prisma.unitConversion.findFirst({ where: { id: dto.conversionId, isActive: true, deletedAt: null } });
    if (!row) throw notFound('Conversion');
    try {
      return { value: convertUnit(dto.value, String(row.factor), dto.decimals ?? 4) };
    } catch (e) {
      if (e instanceof FormulaError) throw badRequest(e.message, [{ field: 'value', message: e.message }]);
      throw e;
    }
  }

  // ------------------------------------------------------------------- rates
  /** Rate priority for new work: customer rate, then standard rate, effective on the given date. */
  async lookupRate(testId: string, customerId: string | null | undefined, on: Date = istToday(), tx?: Tx): Promise<RateResult> {
    const c = tx ?? this.prisma;
    const effective = { isActive: true, deletedAt: null, effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }] };
    if (customerId) {
      const custom = await c.customerRate.findFirst({ where: { testId, customerId, ...effective }, orderBy: { effectiveFrom: 'desc' } });
      if (custom) return { rate: String(custom.rate), source: 'CUSTOMER_RATE' };
    }
    const standard = await c.standardRate.findFirst({ where: { testId, ...effective }, orderBy: { effectiveFrom: 'desc' } });
    if (standard) return { rate: String(standard.rate), source: 'STANDARD_RATE' };
    return { rate: null, source: null };
  }
}

const stripUndefined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const isDbError = (e: unknown) => typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string';
