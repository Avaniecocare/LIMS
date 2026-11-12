import { describe, expect, it } from 'vitest';
import { computeResults, overallOutcome, passAgainst, type LimitSnapshot, type ParamRow } from '../../src/modules/testing/calc.js';

const lim = (min: string | null, max: string | null, role: 'primary' | 'dual' = 'primary'): LimitSnapshot => ({ spec: 'S', role, min, max, text: null });
const num = (code: string, limits: LimitSnapshot[] = [], decimals = 2): ParamRow => ({ parameterId: code, code, kind: 'NUMERIC', decimals, limits });
const calc = (code: string, expression: string, bindings: Record<string, string>, limits: LimitSnapshot[] = [], decimals = 2): ParamRow => ({
  parameterId: code,
  code,
  kind: 'CALCULATED',
  decimals,
  limits,
  formula: { versionId: `v-${code}`, expression, bindings },
});
const byId = (rows: ReturnType<typeof computeResults>) => Object.fromEntries(rows.map((r) => [r.parameterId, r]));

describe('pass and fail', () => {
  it('treats limits as inclusive', () => {
    expect(passAgainst('5', lim('5', '10'))).toBe(true);
    expect(passAgainst('10', lim('5', '10'))).toBe(true);
    expect(passAgainst('4.99', lim('5', '10'))).toBe(false);
    expect(passAgainst('10.01', lim('5', '10'))).toBe(false);
  });
  it('handles open-ended limits and absence', () => {
    expect(passAgainst('100', lim('5', null))).toBe(true);
    expect(passAgainst('1', lim(null, '0.5'))).toBe(false);
    expect(passAgainst('1', undefined)).toBeNull();
    expect(passAgainst(null, lim('1', '2'))).toBeNull();
    expect(passAgainst('1', lim(null, null))).toBeNull();
  });
  it('evaluates both grades when dual', () => {
    const r = byId(computeResults([num('X', [lim('5', null), lim('8', null, 'dual')])], { X: '6' }));
    expect(r.X).toMatchObject({ passPrimary: true, passDual: false });
  });
});

describe('calculated parameters', () => {
  it('chains in dependency order regardless of list position, using reported figures', () => {
    const params = [calc('UTS', 'L / A', { L: 'LOAD', A: 'AREA' }, [lim('470', '630')]), calc('AREA', 'w * t', { w: 'W', t: 'T' }, [], 3), num('W'), num('T'), num('LOAD', [], 0)];
    const r = byId(computeResults(params, { W: '12.5', T: '10', LOAD: '62500' }));
    expect(r.AREA.numericValue).toBe('125.000');
    expect(r.UTS.numericValue).toBe('500.00');
    expect(r.UTS.passPrimary).toBe(true);
    expect(r.UTS.calculation).toMatchObject({ formulaVersionId: 'v-UTS', inputs: { L: '62500', A: '125.000' } });
    expect(r.UTS.calculation!.working).toContain('62500 / 125');
  });

  it('waits rather than guessing when an input is missing', () => {
    const r = byId(computeResults([calc('C', 'a + b', { a: 'A', b: 'B' }), num('A'), num('B')], { A: '1' }));
    expect(r.C.numericValue).toBeNull();
    expect(r.C.error).toBe('Waiting for B');
  });

  it('reports a cycle without hanging', () => {
    const r = byId(computeResults([calc('A', 'b', { b: 'B' }), calc('B', 'a', { a: 'A' })], {}));
    expect(r.A.numericValue).toBeNull();
    expect(r.B.numericValue).toBeNull();
  });

  it('surfaces formula errors such as division by zero', () => {
    const r = byId(computeResults([calc('R', 'a / b', { a: 'A', b: 'B' }), num('A'), num('B')], { A: '1', B: '0' }));
    expect(r.R.error).toBe('Division by zero');
  });

  it('rounds entered values to the parameter decimals, half up', () => {
    expect(byId(computeResults([num('A', [], 2)], { A: '1.005' })).A.numericValue).toBe('1.01');
    expect(byId(computeResults([num('A', [], 0)], { A: '2.5' })).A.numericValue).toBe('3');
  });

  it('rejects non-numeric entry', () => {
    expect(byId(computeResults([num('A')], { A: 'abc' })).A).toMatchObject({ numericValue: null, error: 'Not a number' });
    expect(byId(computeResults([num('A')], { A: 'Infinity' })).A.error).toBe('Not a number');
  });
});

describe('non-numeric results', () => {
  const set: ParamRow = {
    parameterId: 'S',
    code: 'S',
    kind: 'RESULT_SET',
    decimals: 0,
    limits: [],
    options: [
      { value: 'Complies', isPass: true },
      { value: 'Does not comply', isPass: false },
      { value: 'N/A', isPass: null },
    ],
  };
  it('takes pass/fail from the selected option', () => {
    expect(byId(computeResults([set], { S: 'Complies' })).S).toMatchObject({ textValue: 'Complies', passPrimary: true });
    expect(byId(computeResults([set], { S: 'Does not comply' })).S.passPrimary).toBe(false);
    expect(byId(computeResults([set], { S: 'N/A' })).S.passPrimary).toBeNull();
  });
  it('refuses a value outside the set', () => expect(byId(computeResults([set], { S: 'Maybe' })).S.error).toContain('allowed'));
  it('stores free text', () => {
    const text: ParamRow = { parameterId: 'T', code: 'T', kind: 'TEXT', decimals: 0, limits: [] };
    expect(byId(computeResults([text], { T: ' Clear ' })).T.textValue).toBe('Clear');
  });
});

describe('overall outcome', () => {
  it('summarises', () => {
    expect(overallOutcome([{ passPrimary: true, passDual: null }])).toBe('PASS');
    expect(overallOutcome([{ passPrimary: true, passDual: false }])).toBe('FAIL');
    expect(overallOutcome([{ passPrimary: null, passDual: null }])).toBe('ANY');
  });
});
