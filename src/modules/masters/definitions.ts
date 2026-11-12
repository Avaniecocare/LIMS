/* eslint-disable @typescript-eslint/no-explicit-any -- a generic table over Prisma delegates; each DTO stays typed at the edge */
import { badRequest } from '../../common/errors.js';
import { istToday } from '../../common/india.js';
import type { Tx } from '../../core/prisma.service.js';
import { FormulaError, parseExpression, variablesOf } from '../formulas/expression.js';
import type { SheetColumn } from './excel.js';

export interface MasterDef {
  key: string;
  entity: string;
  label: string;
  view: string;
  edit: string;
  delegate: (c: Tx) => any;
  search: string[];
  sort: string[];
  defaultSort: string;
  include?: object;
  /** model has no isActive/version columns */
  filter?: (q: any) => object;
  dto: (row: any) => unknown;
  data: (input: any, tx: Tx, existing?: any) => Promise<object> | object;
  /** nested rows (limits, options, items); runs after create/update in the same transaction */
  children?: (tx: Tx, id: string, input: any) => Promise<void>;
  /** returns why this record can't be deleted, or null */
  inUse?: (tx: Tx, id: string) => Promise<string | null>;
  columns: SheetColumn[];
  fromRow?: (v: Record<string, string>, tx: Tx) => Promise<any>;
  /** natural key for import upserts */
  importKey?: (input: any) => object;
}

const date = (v: unknown) => (v === undefined ? undefined : v ? new Date(v as string) : null);
const bool = (v: string | undefined) => (v === undefined ? undefined : ['1', 'true', 'yes', 'y'].includes(v.toLowerCase()));
const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));
const dec = (v: unknown) => (v === null || v === undefined ? null : String(v));

async function idByCode(delegate: any, code: string | undefined, label: string): Promise<string | null | undefined> {
  if (code === undefined) return undefined;
  if (code === '') return null;
  const row = await delegate.findFirst({ where: { code, deletedAt: null }, select: { id: true } });
  if (!row) throw new Error(`${label} "${code}" not found`);
  return row.id;
}

const inUseMessage = (what: string) => `This is used by ${what}. Deactivate it instead of deleting it.`;

const uniqueCheck = (ids: string[], message: string) => {
  if (new Set(ids).size !== ids.length) throw badRequest(message);
};

export const MASTERS: MasterDef[] = [
  {
    key: 'departments',
    entity: 'Department',
    label: 'Departments',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.department,
    search: ['code', 'name'],
    sort: ['code', 'name'],
    defaultSort: 'name',
    dto: (r) => ({ id: r.id, code: r.code, name: r.name, isActive: r.isActive, version: r.version }),
    data: (i) => ({ code: i.code, name: i.name }),
    inUse: async (tx, id) => {
      const n = (await tx.testMaster.count({ where: { departmentId: id, deletedAt: null } })) + (await tx.user.count({ where: { departmentId: id, deletedAt: null } }));
      return n ? inUseMessage('tests or users') : null;
    },
    columns: [{ header: 'Code', key: 'code' }, { header: 'Name', key: 'name', width: 30 }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v) => ({ code: v.Code, name: v.Name, isActive: bool(v.Active) }),
    importKey: (i) => ({ code: i.code }),
  },
  {
    key: 'units',
    entity: 'Unit',
    label: 'Units',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.unit,
    search: ['code', 'name', 'symbol'],
    sort: ['code', 'name'],
    defaultSort: 'name',
    dto: (r) => ({ id: r.id, code: r.code, name: r.name, symbol: r.symbol, isActive: r.isActive, version: r.version }),
    data: (i) => ({ code: i.code, name: i.name, symbol: i.symbol }),
    inUse: async (tx, id) => ((await tx.testParameter.count({ where: { unitId: id, deletedAt: null } })) ? inUseMessage('test parameters') : null),
    columns: [{ header: 'Code', key: 'code' }, { header: 'Name', key: 'name', width: 30 }, { header: 'Symbol', key: 'symbol' }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v) => ({ code: v.Code, name: v.Name, symbol: v.Symbol, isActive: bool(v.Active) }),
    importKey: (i) => ({ code: i.code }),
  },
  {
    key: 'unit-conversions',
    entity: 'UnitConversion',
    label: 'Unit conversions',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.unitConversion,
    search: [],
    sort: ['createdAt'],
    defaultSort: 'createdAt',
    include: { fromUnit: true, toUnit: true },
    dto: (r) => ({ id: r.id, fromUnitId: r.fromUnitId, toUnitId: r.toUnitId, fromUnitCode: r.fromUnit.code, toUnitCode: r.toUnit.code, factor: String(r.factor), isActive: r.isActive, version: r.version }),
    data: (i) => {
      if (i.fromUnitId === i.toUnitId) throw badRequest('A unit cannot convert to itself', [{ field: 'toUnitId', message: 'Pick a different unit' }]);
      return { fromUnitId: i.fromUnitId, toUnitId: i.toUnitId, factor: i.factor };
    },
    columns: [{ header: 'From', key: 'fromUnitCode' }, { header: 'To', key: 'toUnitCode' }, { header: 'Factor', key: 'factor' }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v, tx) => ({ fromUnitId: await idByCode(tx.unit, v.From, 'Unit'), toUnitId: await idByCode(tx.unit, v.To, 'Unit'), factor: v.Factor, isActive: bool(v.Active) }),
    importKey: (i) => ({ fromUnitId: i.fromUnitId, toUnitId: i.toUnitId }),
  },
  {
    key: 'test-methods',
    entity: 'TestMethod',
    label: 'Test methods',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.testMethod,
    search: ['code', 'name', 'standardRef'],
    sort: ['code', 'name'],
    defaultSort: 'code',
    dto: (r) => ({ id: r.id, code: r.code, name: r.name, standardRef: r.standardRef, accredited: r.accredited, accreditedUntil: r.accreditedUntil, isActive: r.isActive, version: r.version }),
    data: (i) => ({ code: i.code, name: i.name, standardRef: i.standardRef, accredited: i.accredited, accreditedUntil: date(i.accreditedUntil) }),
    inUse: async (tx, id) => ((await tx.testMaster.count({ where: { methodId: id, deletedAt: null } })) ? inUseMessage('tests') : null),
    columns: [{ header: 'Code', key: 'code' }, { header: 'Name', key: 'name', width: 40 }, { header: 'Standard', key: 'standardRef', width: 30 }, { header: 'Accredited', key: 'accredited' }, { header: 'Accredited until', key: 'accreditedUntil' }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v) => ({ code: v.Code, name: v.Name, standardRef: v.Standard, accredited: bool(v.Accredited), accreditedUntil: v['Accredited until'] || undefined, isActive: bool(v.Active) }),
    importKey: (i) => ({ code: i.code }),
  },
  {
    key: 'tests',
    entity: 'TestMaster',
    label: 'Tests',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.testMaster,
    search: ['code', 'name'],
    sort: ['code', 'name', 'defaultTatDays'],
    defaultSort: 'name',
    include: { department: true, method: true, _count: { select: { parameters: { where: { deletedAt: null } } } } },
    filter: (q) => (q.departmentId ? { departmentId: q.departmentId } : {}),
    dto: (r) => ({
      id: r.id, code: r.code, name: r.name, category: r.category, departmentId: r.departmentId, departmentName: r.department?.name ?? null, methodId: r.methodId, methodName: r.method?.name ?? null,
      defaultTatDays: r.defaultTatDays, urgentTatDays: r.urgentTatDays, accredited: r.accredited, accreditedUntil: r.accreditedUntil, stages: r.stages, parameterCount: r._count.parameters, isActive: r.isActive, version: r.version,
    }),
    data: (i) => {
      if (i.urgentTatDays !== undefined && i.defaultTatDays !== undefined && i.urgentTatDays > i.defaultTatDays) throw badRequest('Urgent TAT cannot be longer than the default TAT', [{ field: 'urgentTatDays', message: 'Cannot exceed the default TAT' }]);
      return { code: i.code, name: i.name, category: i.category, departmentId: i.departmentId, methodId: i.methodId, defaultTatDays: i.defaultTatDays, urgentTatDays: i.urgentTatDays, accredited: i.accredited, accreditedUntil: date(i.accreditedUntil), stages: i.stages };
    },
    inUse: async (tx, id) => ((await tx.sampleTest.count({ where: { testId: id } })) ? inUseMessage('samples') : null),
    columns: [{ header: 'Code', key: 'code' }, { header: 'Name', key: 'name', width: 40 }, { header: 'Category', key: 'category' }, { header: 'Department', key: 'departmentName' }, { header: 'Method', key: 'methodName', width: 30 }, { header: 'TAT days', key: 'defaultTatDays' }, { header: 'Urgent TAT days', key: 'urgentTatDays' }, { header: 'Accredited', key: 'accredited' }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v, tx) => ({ code: v.Code, name: v.Name, category: v.Category || undefined, departmentId: await idByCode(tx.department, v['Department code'], 'Department'), methodId: await idByCode(tx.testMethod, v['Method code'], 'Method'), defaultTatDays: num(v['TAT days']), urgentTatDays: num(v['Urgent TAT days']), accredited: bool(v.Accredited), isActive: bool(v.Active) }),
    importKey: (i) => ({ code: i.code }),
  },
  {
    key: 'test-parameters',
    entity: 'TestParameter',
    label: 'Test parameters',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.testParameter,
    search: ['code', 'name'],
    sort: ['sortOrder', 'code', 'name'],
    defaultSort: 'sortOrder',
    include: { test: { select: { code: true } }, unit: { select: { symbol: true } } },
    filter: (q) => (q.testId ? { testId: q.testId } : {}),
    dto: (r) => ({
      id: r.id, testId: r.testId, testCode: r.test.code, code: r.code, name: r.name, kind: r.kind, unitId: r.unitId, unitSymbol: r.unit?.symbol ?? null, decimals: r.decimals, resultSetId: r.resultSetId, formulaId: r.formulaId, formulaBindings: r.formulaBindings,
      accredited: r.accredited, accreditedUntil: r.accreditedUntil, sortOrder: r.sortOrder, showOnReport: r.showOnReport, isActive: r.isActive, version: r.version,
    }),
    data: async (i, tx) => {
      if (i.kind === 'RESULT_SET' && !i.resultSetId) throw badRequest('Choose a result set', [{ field: 'resultSetId', message: 'Required for this kind' }]);
      if (i.kind === 'CALCULATED') {
        if (!i.formulaId) throw badRequest('Choose a formula', [{ field: 'formulaId', message: 'Required for this kind' }]);
        const formula = await tx.formula.findUnique({ where: { id: i.formulaId }, include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } });
        if (!formula) throw badRequest('Formula not found', [{ field: 'formulaId', message: 'Not found' }]);
        const vars = formula.versions[0].variables as string[];
        const unbound = vars.filter((v) => !i.formulaBindings?.[v]);
        if (unbound.length) throw badRequest(`Bind these formula inputs to parameters: ${unbound.join(', ')}`, [{ field: 'formulaBindings', message: `Missing: ${unbound.join(', ')}` }]);
      }
      return { testId: i.testId, code: i.code, name: i.name, kind: i.kind, unitId: i.unitId, decimals: i.decimals, resultSetId: i.resultSetId, formulaId: i.formulaId, formulaBindings: i.formulaBindings ?? undefined, accredited: i.accredited, accreditedUntil: date(i.accreditedUntil), sortOrder: i.sortOrder, showOnReport: i.showOnReport };
    },
    inUse: async (tx, id) => ((await tx.parameterResult.count({ where: { parameterId: id } })) ? inUseMessage('test results') : null),
    columns: [{ header: 'Test code', key: 'testCode' }, { header: 'Code', key: 'code' }, { header: 'Name', key: 'name', width: 30 }, { header: 'Kind', key: 'kind' }, { header: 'Unit', key: 'unitSymbol' }, { header: 'Decimals', key: 'decimals' }, { header: 'Accredited', key: 'accredited' }, { header: 'Sort order', key: 'sortOrder' }, { header: 'Show on report', key: 'showOnReport' }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v, tx) => ({ testId: await idByCode(tx.testMaster, v['Test code'], 'Test'), code: v.Code, name: v.Name, kind: v.Kind || undefined, unitId: await idByCode(tx.unit, v['Unit code'], 'Unit'), decimals: num(v.Decimals), accredited: bool(v.Accredited), sortOrder: num(v['Sort order']), showOnReport: bool(v['Show on report']), isActive: bool(v.Active) }),
    importKey: (i) => ({ testId: i.testId, code: i.code }),
  },
  {
    key: 'specifications',
    entity: 'Specification',
    label: 'Specifications and grades',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.specification,
    search: ['code', 'name'],
    sort: ['code', 'name'],
    defaultSort: 'code',
    include: { limits: { where: { deletedAt: null }, include: { parameter: { include: { test: { select: { id: true, code: true } } } } } } },
    filter: (q) => (q.customerId ? { OR: [{ customerId: q.customerId }, { customerId: null }] } : {}),
    dto: (r) => ({
      id: r.id, code: r.code, name: r.name, customerId: r.customerId, isActive: r.isActive, version: r.version,
      limits: r.limits.map((l: any) => ({ parameterId: l.parameterId, parameterCode: l.parameter.code, parameterName: l.parameter.name, testId: l.parameter.test.id, testCode: l.parameter.test.code, minValue: dec(l.minValue), maxValue: dec(l.maxValue), textLimit: l.textLimit })),
    }),
    data: async (i, tx, existing) => {
      const dup = await tx.specification.findFirst({ where: { code: i.code, customerId: i.customerId ?? null, deletedAt: null, ...(existing ? { id: { not: existing.id } } : {}) } });
      if (dup) throw badRequest('A specification with this code already exists', [{ field: 'code', message: 'Already in use' }]);
      return { code: i.code, name: i.name, customerId: i.customerId };
    },
    children: async (tx, id, i) => {
      if (!i.limits) return;
      uniqueCheck(i.limits.map((l: any) => l.parameterId), 'A parameter is listed twice');
      for (const l of i.limits) {
        if (l.minValue != null && l.maxValue != null && Number(l.minValue) > Number(l.maxValue)) throw badRequest('Minimum cannot be above maximum', [{ field: 'limits', message: 'Minimum is above maximum' }]);
      }
      await tx.specificationLimit.updateMany({ where: { specificationId: id }, data: { deletedAt: new Date() } });
      for (const l of i.limits) {
        const values = { minValue: l.minValue ?? null, maxValue: l.maxValue ?? null, textLimit: l.textLimit ?? null, deletedAt: null };
        await tx.specificationLimit.upsert({ where: { specificationId_parameterId: { specificationId: id, parameterId: l.parameterId } }, create: { specificationId: id, parameterId: l.parameterId, ...values }, update: values });
      }
    },
    inUse: async (tx, id) => ((await tx.sampleTest.count({ where: { OR: [{ specificationId: id }, { dualSpecificationId: id }] } })) ? inUseMessage('samples') : null),
    columns: [{ header: 'Code', key: 'code' }, { header: 'Name', key: 'name', width: 40 }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v) => ({ code: v.Code, name: v.Name, isActive: bool(v.Active) }),
    importKey: (i) => ({ code: i.code, customerId: null }),
  },
  {
    key: 'test-groups',
    entity: 'TestGroup',
    label: 'Test and chemical groups',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.testGroup,
    search: ['code', 'name'],
    sort: ['code', 'name'],
    defaultSort: 'name',
    include: { items: { include: { test: { select: { code: true, name: true } }, parameter: { select: { name: true } } } } },
    dto: (r) => ({
      id: r.id, code: r.code, name: r.name, kind: r.kind, isActive: r.isActive, version: r.version,
      items: r.items.map((x: any) => ({ testId: x.testId, testCode: x.test.code, testName: x.test.name, parameterId: x.parameterId, parameterName: x.parameter?.name ?? null })),
    }),
    data: (i) => ({ code: i.code, name: i.name, kind: i.kind }),
    children: async (tx, id, i) => {
      if (!i.items) return;
      await tx.testGroupItem.deleteMany({ where: { groupId: id } });
      await tx.testGroupItem.createMany({ data: i.items.map((x: any) => ({ groupId: id, testId: x.testId, parameterId: x.parameterId ?? null })) });
    },
    columns: [{ header: 'Code', key: 'code' }, { header: 'Name', key: 'name', width: 30 }, { header: 'Kind', key: 'kind' }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v) => ({ code: v.Code, name: v.Name, kind: v.Kind || undefined, isActive: bool(v.Active) }),
    importKey: (i) => ({ code: i.code }),
  },
  {
    key: 'result-sets',
    entity: 'ResultSet',
    label: 'Result sets',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.resultSet,
    search: ['code', 'name'],
    sort: ['code', 'name'],
    defaultSort: 'name',
    include: { options: { orderBy: { sortOrder: 'asc' } } },
    dto: (r) => ({ id: r.id, code: r.code, name: r.name, isActive: r.isActive, version: r.version, options: r.options.map((o: any) => ({ value: o.value, isPass: o.isPass })) }),
    data: (i) => ({ code: i.code, name: i.name }),
    children: async (tx, id, i) => {
      if (!i.options) return;
      uniqueCheck(i.options.map((o: any) => o.value), 'A result value is listed twice');
      await tx.resultSetOption.deleteMany({ where: { resultSetId: id } });
      await tx.resultSetOption.createMany({ data: i.options.map((o: any, n: number) => ({ resultSetId: id, value: o.value, isPass: o.isPass ?? null, sortOrder: n })) });
    },
    inUse: async (tx, id) => ((await tx.testParameter.count({ where: { resultSetId: id, deletedAt: null } })) ? inUseMessage('test parameters') : null),
    columns: [{ header: 'Code', key: 'code' }, { header: 'Name', key: 'name', width: 30 }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v) => ({ code: v.Code, name: v.Name, isActive: bool(v.Active) }),
    importKey: (i) => ({ code: i.code }),
  },
  {
    key: 'formulas',
    entity: 'Formula',
    label: 'Formulas',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.formula,
    search: ['code', 'name'],
    sort: ['code', 'name'],
    defaultSort: 'name',
    include: { versions: { orderBy: { versionNo: 'desc' } } },
    dto: (r) => {
      const cur = r.versions.find((v: any) => v.versionNo === r.currentVersion) ?? r.versions[0];
      return {
        id: r.id, code: r.code, name: r.name, description: r.description, currentVersion: r.currentVersion, expression: cur?.expression ?? '', variables: cur?.variables ?? [], decimals: cur?.decimals ?? 2, isActive: r.isActive, version: r.version,
        versions: r.versions.map((v: any) => ({ id: v.id, versionNo: v.versionNo, expression: v.expression, variables: v.variables, decimals: v.decimals, createdAt: v.createdAt })),
      };
    },
    data: (i, _tx, existing) => {
      compileFormula(i.expression);
      return { code: i.code, name: i.name, description: i.description, ...(existing ? {} : { currentVersion: 1 }) };
    },
    // Every expression change makes a new version; results keep the version they used.
    children: async (tx, id, i) => {
      const last = await tx.formulaVersion.findFirst({ where: { formulaId: id }, orderBy: { versionNo: 'desc' } });
      const decimals = i.decimals ?? last?.decimals ?? 2;
      if (last && last.expression === i.expression && last.decimals === decimals) return;
      const versionNo = (last?.versionNo ?? 0) + 1;
      await tx.formulaVersion.create({ data: { formulaId: id, versionNo, expression: i.expression, variables: compileFormula(i.expression), decimals } });
      await tx.formula.update({ where: { id }, data: { currentVersion: versionNo } });
    },
    inUse: async (tx, id) => ((await tx.testParameter.count({ where: { formulaId: id, deletedAt: null } })) ? inUseMessage('test parameters') : null),
    columns: [{ header: 'Code', key: 'code' }, { header: 'Name', key: 'name', width: 30 }, { header: 'Expression', key: 'expression', width: 50 }, { header: 'Decimals', key: 'decimals' }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v) => ({ code: v.Code, name: v.Name, expression: v.Expression, decimals: num(v.Decimals), isActive: bool(v.Active) }),
    importKey: (i) => ({ code: i.code }),
  },
  {
    key: 'instruments',
    entity: 'Instrument',
    label: 'Instruments',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.instrument,
    search: ['code', 'name', 'serialNo'],
    sort: ['code', 'name', 'calibrationDueAt'],
    defaultSort: 'name',
    include: { department: { select: { name: true } } },
    filter: (q) => (q.departmentId ? { departmentId: q.departmentId } : {}),
    dto: (r) => ({
      id: r.id, code: r.code, name: r.name, serialNo: r.serialNo, departmentId: r.departmentId, departmentName: r.department?.name ?? null, lastCalibratedAt: r.lastCalibratedAt, calibrationDueAt: r.calibrationDueAt, certificateFileId: r.certificateFileId,
      calibrationOverdue: !!r.calibrationDueAt && r.calibrationDueAt < istToday(), isActive: r.isActive, version: r.version,
    }),
    data: (i) => {
      if (i.lastCalibratedAt && i.calibrationDueAt && new Date(i.calibrationDueAt) < new Date(i.lastCalibratedAt)) throw badRequest('Due date cannot be before the last calibration', [{ field: 'calibrationDueAt', message: 'Before last calibration' }]);
      return { code: i.code, name: i.name, serialNo: i.serialNo, departmentId: i.departmentId, lastCalibratedAt: date(i.lastCalibratedAt), calibrationDueAt: date(i.calibrationDueAt), certificateFileId: i.certificateFileId };
    },
    inUse: async (tx, id) => ((await tx.sampleTest.count({ where: { instrumentId: id } })) ? inUseMessage('tests') : null),
    columns: [{ header: 'Code', key: 'code' }, { header: 'Name', key: 'name', width: 30 }, { header: 'Serial no', key: 'serialNo' }, { header: 'Department', key: 'departmentName' }, { header: 'Last calibrated', key: 'lastCalibratedAt' }, { header: 'Calibration due', key: 'calibrationDueAt' }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v, tx) => ({ code: v.Code, name: v.Name, serialNo: v['Serial no'], departmentId: await idByCode(tx.department, v['Department code'], 'Department'), lastCalibratedAt: v['Last calibrated'] || undefined, calibrationDueAt: v['Calibration due'] || undefined, isActive: bool(v.Active) }),
    importKey: (i) => ({ code: i.code }),
  },
  {
    key: 'standard-rates',
    entity: 'StandardRate',
    label: 'Standard rates',
    view: 'rates.view',
    edit: 'rates.edit',
    delegate: (c) => c.standardRate,
    search: [],
    sort: ['effectiveFrom', 'rate'],
    defaultSort: 'effectiveFrom',
    include: { test: { select: { code: true, name: true } } },
    filter: (q) => ({ ...(q.testId ? { testId: q.testId } : {}), ...(q.q ? { test: { name: { contains: q.q, mode: 'insensitive' } } } : {}) }),
    dto: (r) => ({ id: r.id, testId: r.testId, testCode: r.test.code, testName: r.test.name, rate: String(r.rate), effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, isActive: r.isActive, version: r.version }),
    data: (i) => {
      assertRate(i);
      return { testId: i.testId, rate: i.rate, effectiveFrom: date(i.effectiveFrom), effectiveTo: date(i.effectiveTo) };
    },
    columns: [{ header: 'Test code', key: 'testCode' }, { header: 'Test', key: 'testName', width: 30 }, { header: 'Rate', key: 'rate' }, { header: 'Effective from', key: 'effectiveFrom' }, { header: 'Effective to', key: 'effectiveTo' }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v, tx) => ({ testId: await idByCode(tx.testMaster, v['Test code'], 'Test'), rate: v.Rate, effectiveFrom: v['Effective from'], effectiveTo: v['Effective to'] || undefined, isActive: bool(v.Active) }),
    importKey: (i) => ({ testId: i.testId, effectiveFrom: new Date(i.effectiveFrom) }),
  },
  {
    key: 'customer-rates',
    entity: 'CustomerRate',
    label: 'Customer rates',
    view: 'rates.view',
    edit: 'rates.edit',
    delegate: (c) => c.customerRate,
    search: [],
    sort: ['effectiveFrom', 'rate'],
    defaultSort: 'effectiveFrom',
    include: { test: { select: { code: true, name: true } }, customer: { select: { name: true, crn: true } } },
    filter: (q) => ({ ...(q.testId ? { testId: q.testId } : {}), ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.q ? { OR: [{ customer: { name: { contains: q.q, mode: 'insensitive' } } }, { test: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}) }),
    dto: (r) => ({ id: r.id, customerId: r.customerId, customerName: r.customer.name, crn: r.customer.crn, testId: r.testId, testCode: r.test.code, testName: r.test.name, rate: String(r.rate), effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, isActive: r.isActive, version: r.version }),
    data: (i) => {
      assertRate(i);
      return { customerId: i.customerId, testId: i.testId, rate: i.rate, effectiveFrom: date(i.effectiveFrom), effectiveTo: date(i.effectiveTo) };
    },
    columns: [{ header: 'CRN', key: 'crn' }, { header: 'Customer', key: 'customerName', width: 30 }, { header: 'Test code', key: 'testCode' }, { header: 'Test', key: 'testName', width: 30 }, { header: 'Rate', key: 'rate' }, { header: 'Effective from', key: 'effectiveFrom' }, { header: 'Effective to', key: 'effectiveTo' }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v, tx) => {
      const customer = await tx.customer.findFirst({ where: { crn: v.CRN, deletedAt: null }, select: { id: true } });
      if (!customer) throw new Error(`Customer "${v.CRN}" not found`);
      return { customerId: customer.id, testId: await idByCode(tx.testMaster, v['Test code'], 'Test'), rate: v.Rate, effectiveFrom: v['Effective from'], effectiveTo: v['Effective to'] || undefined, isActive: bool(v.Active) };
    },
    importKey: (i) => ({ customerId: i.customerId, testId: i.testId, effectiveFrom: new Date(i.effectiveFrom) }),
  },
  {
    key: 'remark-templates',
    entity: 'RemarkTemplate',
    label: 'Remark templates',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.remarkTemplate,
    search: ['code', 'text'],
    sort: ['code'],
    defaultSort: 'code',
    filter: (q) => (q.testId ? { OR: [{ testId: q.testId }, { testId: null }] } : {}),
    dto: (r) => ({ id: r.id, code: r.code, text: r.text, testId: r.testId, outcome: r.outcome, isActive: r.isActive, version: r.version }),
    data: (i) => ({ code: i.code, text: i.text, testId: i.testId, outcome: i.outcome }),
    columns: [{ header: 'Code', key: 'code' }, { header: 'Text', key: 'text', width: 60 }, { header: 'Outcome', key: 'outcome' }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v) => ({ code: v.Code, text: v.Text, outcome: v.Outcome || undefined, isActive: bool(v.Active) }),
    importKey: (i) => ({ code: i.code }),
  },
  {
    key: 'lookups',
    entity: 'LookupValue',
    label: 'Deviation types, receipt and dispatch modes',
    view: 'masters.view',
    edit: 'masters.edit',
    delegate: (c) => c.lookupValue,
    search: ['code', 'label'],
    sort: ['kind', 'code', 'label'],
    defaultSort: 'label',
    filter: (q) => (q.kind ? { kind: q.kind } : {}),
    dto: (r) => ({ id: r.id, kind: r.kind, code: r.code, label: r.label, isActive: r.isActive, version: r.version }),
    data: (i) => ({ kind: i.kind, code: i.code, label: i.label }),
    columns: [{ header: 'Kind', key: 'kind' }, { header: 'Code', key: 'code' }, { header: 'Label', key: 'label', width: 30 }, { header: 'Active', key: 'isActive' }],
    fromRow: async (v) => ({ kind: v.Kind, code: v.Code, label: v.Label, isActive: bool(v.Active) }),
    importKey: (i) => ({ kind: i.kind, code: i.code }),
  },
];

function assertRate(i: { rate: string; effectiveFrom: string; effectiveTo?: string | null }) {
  if (Number(i.rate) < 0) throw badRequest('Rate cannot be negative', [{ field: 'rate', message: 'Cannot be negative' }]);
  if (i.effectiveTo && new Date(i.effectiveTo) < new Date(i.effectiveFrom)) throw badRequest('End date is before the start date', [{ field: 'effectiveTo', message: 'Before the start date' }]);
}

/** Parses and returns the variable names; a bad expression never reaches the database. */
export function compileFormula(expression: string): string[] {
  try {
    return [...variablesOf(parseExpression(expression))];
  } catch (e) {
    if (e instanceof FormulaError) throw badRequest(e.message, [{ field: 'expression', message: e.message }]);
    throw e;
  }
}

