import { Injectable } from '@nestjs/common';
import { badRequest } from '../../common/errors.js';
import { AuditService } from '../../core/audit.service.js';
import { PrismaService } from '../../core/prisma.service.js';
import { MastersService } from '../masters/masters.service.js';
import { CATALOGUE as catalogue } from './templates/catalogue.js';


export interface ApplyResult {
  created: Record<string, number>;
  skipped: number;
}

/**
 * Lab-type templates: a starting test catalogue (departments, methods, tests with their parameters, regulatory
 * specifications and packages) built from public standards. Applying one only ever adds: anything whose code already
 * exists, in any state, is left exactly as the lab has it. Prices and accreditation are never set; the lab adds both.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masters: MastersService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return catalogue.templates.map((t) => {
      const tests = catalogue.tests.filter((x) => t.departments.includes(x.department));
      const codes = new Set(tests.map((x) => x.code));
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        tests: tests.length,
        specifications: catalogue.specifications.filter((s) => s.limits.some((l) => codes.has(l.test))).map((s) => s.name),
        packages: catalogue.groups.filter((g) => g.tests.every((c) => codes.has(c))).length,
        sample: tests.slice(0, 6).map((x) => x.name),
      };
    });
  }

  async apply(ids: string[]): Promise<ApplyResult> {
    const chosen = catalogue.templates.filter((t) => ids.includes(t.id));
    if (!chosen.length || chosen.length !== new Set(ids).size) throw badRequest('Choose one or more of the listed templates', [{ field: 'templates', message: 'Unknown template' }]);
    const depts = new Set(chosen.flatMap((t) => t.departments));
    const tests = catalogue.tests.filter((t) => depts.has(t.department));
    const testCodes = new Set(tests.map((t) => t.code));
    const used = <T extends { code: string }>(list: T[], codes: Set<string | null | undefined>) => list.filter((x) => codes.has(x.code));
    const created: Record<string, number> = {};
    let skipped = 0;
    const bump = (k: string) => (created[k] = (created[k] ?? 0) + 1);

    /** Creates what is missing by code; returns code -> id for everything (new and existing). */
    const ensure = async <T extends { code: string }>(key: string, items: T[], existing: { id: string; code: string }[], body: (x: T) => object) => {
      const ids = new Map(existing.map((r) => [r.code, r.id]));
      for (const x of items) {
        if (ids.has(x.code)) {
          skipped++;
          continue;
        }
        const row = (await this.masters.create(key, body(x))) as { id: string };
        ids.set(x.code, row.id);
        bump(key);
      }
      return ids;
    };

    const unitCodes = new Set(tests.flatMap((t) => t.parameters.map((p) => p.unit)));
    const units = await ensure('units', used(catalogue.units, unitCodes), await this.prisma.unit.findMany({ select: { id: true, code: true } }), (u) => u);
    const departments = await ensure('departments', catalogue.departments.filter((d) => depts.has(d.code)), await this.prisma.department.findMany({ select: { id: true, code: true } }), (d) => d);
    const setCodes = new Set(tests.flatMap((t) => t.parameters.map((p) => p.resultSet)));
    const sets = await ensure('result-sets', used(catalogue.resultSets, setCodes), await this.prisma.resultSet.findMany({ select: { id: true, code: true } }), (s) => s);
    const methodCodes = new Set(tests.map((t) => t.method));
    const methods = await ensure('test-methods', used(catalogue.methods, methodCodes), await this.prisma.testMethod.findMany({ select: { id: true, code: true } }), (m) => ({ code: m.code, name: m.name, ...(m.standardRef ? { standardRef: m.standardRef } : {}), accredited: false }));
    const formulas = new Map((await this.prisma.formula.findMany({ where: { isActive: true }, select: { id: true, code: true } })).map((f) => [f.code, f.id]));

    // Tests, and the parameters of the tests created now (an existing test keeps its own parameters).
    const existingTests = await this.prisma.testMaster.findMany({ select: { id: true, code: true } });
    const before = new Set(existingTests.map((t) => t.code));
    const testIds = await ensure('tests', tests, existingTests, (t) => ({ code: t.code, name: t.name, category: t.category, departmentId: departments.get(t.department), methodId: t.method ? methods.get(t.method) : null, defaultTatDays: t.defaultTatDays, urgentTatDays: t.urgentTatDays, accredited: false, stages: t.stages }));
    for (const t of tests.filter((x) => !before.has(x.code))) {
      for (const [i, p] of t.parameters.entries()) {
        if (p.formula && !formulas.has(p.formula)) throw badRequest(`The standard formula ${p.formula} is missing`, [{ field: 'templates', message: 'Formula missing' }]);
        await this.masters.create('test-parameters', {
          testId: testIds.get(t.code),
          code: p.code,
          name: p.name,
          kind: p.kind,
          decimals: p.decimals,
          sortOrder: (i + 1) * 10,
          accredited: false,
          unitId: p.unit ? units.get(p.unit) : null,
          resultSetId: p.resultSet ? sets.get(p.resultSet) : null,
          formulaId: p.formula ? formulas.get(p.formula) : null,
          formulaBindings: p.bindings ?? null,
          showOnReport: p.showOnReport ?? true,
        });
        bump('test-parameters');
      }
    }

    // Specifications and packages that lie wholly inside the chosen templates.
    const params = await this.prisma.testParameter.findMany({ where: { testId: { in: [...testIds.values()] } }, select: { id: true, code: true, testId: true } });
    const codeOfTest = new Map([...testIds.entries()].map(([code, id]) => [id, code]));
    const paramId = new Map(params.map((p) => [`${codeOfTest.get(p.testId)}.${p.code}`, p.id]));
    const specs = catalogue.specifications.filter((s) => s.limits.every((l) => testCodes.has(l.test)));
    await ensure('specifications', specs, await this.prisma.specification.findMany({ where: { customerId: null }, select: { id: true, code: true } }), (s) => ({
      code: s.code,
      name: s.name,
      limits: s.limits.filter((l) => paramId.has(`${l.test}.${l.param}`)).map((l) => ({ parameterId: paramId.get(`${l.test}.${l.param}`), minValue: l.min, maxValue: l.max, textLimit: l.text })),
    }));
    const groups = catalogue.groups.filter((g) => g.tests.every((c) => testCodes.has(c)));
    await ensure('test-groups', groups, await this.prisma.testGroup.findMany({ select: { id: true, code: true } }), (g) => ({ code: g.code, name: g.name, kind: 'TEST', items: g.tests.map((c) => ({ testId: testIds.get(c) })) }));
    if (chosen.length) await ensure('remark-templates', catalogue.remarkTemplates, await this.prisma.remarkTemplate.findMany({ select: { id: true, code: true } }), (r) => ({ code: r.code, text: r.text, outcome: r.outcome, testId: null }));

    await this.audit.record({ action: 'lab.template.applied', entity: 'Setting', entityId: 'templates', after: { templates: ids, created, skipped } });
    return { created, skipped };
  }
}
