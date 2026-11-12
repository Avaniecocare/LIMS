import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../../src/modules/lab/templates/catalogue.js';
import { BUILTIN_FORMULAS } from '../../src/modules/formulas/expression.js';

/** The lab-type templates must work on a fresh install: everything a test refers to is in them, or built in. */
describe('lab-type templates', () => {
  const codes = <T extends { code: string }>(list: T[]) => new Set(list.map((x) => x.code));
  const units = codes(CATALOGUE.units);
  const sets = codes(CATALOGUE.resultSets);
  const methods = codes(CATALOGUE.methods);
  const depts = codes(CATALOGUE.departments);
  const formulas = new Set(BUILTIN_FORMULAS.map((f) => f.code));

  it('every test refers only to units, result sets, methods, departments and formulas that exist', () => {
    const problems: string[] = [];
    for (const t of CATALOGUE.tests) {
      if (!depts.has(t.department)) problems.push(`${t.code}: department ${t.department}`);
      if (t.method && !methods.has(t.method)) problems.push(`${t.code}: method ${t.method}`);
      for (const p of t.parameters) {
        if (p.unit && !units.has(p.unit)) problems.push(`${t.code}.${p.code}: unit ${p.unit}`);
        if (p.resultSet && !sets.has(p.resultSet)) problems.push(`${t.code}.${p.code}: result set ${p.resultSet}`);
        if (p.formula && !formulas.has(p.formula)) problems.push(`${t.code}.${p.code}: formula ${p.formula}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every limit and package points at a real test and parameter, and every department belongs to a template', () => {
    const tests = new Map(CATALOGUE.tests.map((t) => [t.code, t]));
    const problems: string[] = [];
    for (const s of CATALOGUE.specifications) for (const l of s.limits) if (!tests.get(l.test)?.parameters.some((p) => p.code === l.param)) problems.push(`${s.code}: ${l.test}.${l.param}`);
    for (const g of CATALOGUE.groups) for (const c of g.tests) if (!tests.has(c)) problems.push(`${g.code}: ${c}`);
    const covered = new Set(CATALOGUE.templates.flatMap((t) => t.departments));
    for (const d of depts) if (!covered.has(d)) problems.push(`department ${d} is in no template`);
    expect(problems).toEqual([]);
  });

  it('carries no prices and marks nothing accredited', () => {
    expect(JSON.stringify(CATALOGUE)).not.toMatch(/"rate"|"accredited":\s*true/);
  });
});
