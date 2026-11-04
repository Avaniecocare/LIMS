import { describe, expect, it } from 'vitest';
import { BUILTIN_CONVERSIONS, BUILTIN_FORMULAS, convertUnit, FormulaError, parseExpression, runFormula, variablesOf } from '../../src/modules/formulas/expression.js';

const expr = (code: string) => BUILTIN_FORMULAS.find((f) => f.code === code)!.expression;
const factor = (from: string, to: string) => BUILTIN_CONVERSIONS.find((c) => c.from === from && c.to === to)!.factor;

describe('built-in formulas', () => {
  it('average', () => expect(runFormula(expr('AVERAGE3'), { a: 10, b: 20, c: 40 }, 2).value).toBe('23.33'));
  it('remainder in chemical analysis', () => expect(runFormula(expr('REMAINDER'), { sum_others: '2.75' }, 3).value).toBe('97.250'));
  it('carbon equivalent (IIW)', () => {
    // 0.20 + 1.20/6 + (0.30+0.10+0.05)/5 + (0.15+0.15)/15 = 0.20 + 0.20 + 0.09 + 0.02
    expect(runFormula(expr('CE_IIW'), { C: '0.20', Mn: '1.20', Cr: '0.30', Mo: '0.10', V: '0.05', Ni: '0.15', Cu: '0.15' }, 3).value).toBe('0.510');
  });
  it('PREN', () => expect(runFormula(expr('PREN'), { Cr: 22, Mo: 3, N: '0.17' }, 2).value).toBe('34.62'));
  it('area from dimensions', () => {
    expect(runFormula(expr('AREA_RECT'), { width: '12.5', thickness: 4 }, 3).value).toBe('50.000');
    expect(runFormula(expr('AREA_ROUND'), { d: 10 }, 3).value).toBe('78.540');
  });
  it('UTS', () => expect(runFormula(expr('UTS'), { max_load: 39270, original_area: '78.54' }, 2).value).toBe('500.00'));
  it('reduction of area', () => expect(runFormula(expr('ROA'), { A0: 100, Af: 45 }, 2).value).toBe('55.00'));
  it('elongation', () => expect(runFormula(expr('ELONGATION'), { L0: 50, Lf: 62 }, 2).value).toBe('24.00'));
  it('proof stress', () => expect(runFormula(expr('PROOF'), { load_at_proof: 27489, original_area: '78.54' }, 2).value).toBe('350.00'));
});

describe('unit conversions', () => {
  it('PSI to KSI', () => expect(convertUnit(2500, factor('PSI', 'KSI'))).toBe('2.5000'));
  it('MPa to N/m²', () => expect(convertUnit('1.5', factor('MPA', 'NM2'), 0)).toBe('1500000'));
  it('Joules to kgf·m', () => expect(convertUnit(100, factor('J', 'KGFM'))).toBe('10.1972'));
  it('Joules to ft·lbf', () => expect(convertUnit(100, factor('J', 'FTLBF'))).toBe('73.7562'));
  it('mils per year to mils per month', () => expect(convertUnit(12, factor('MPY', 'MPM'), 2)).toBe('1.00'));
  it('rejects a non-number', () => expect(() => convertUnit('abc', '2')).toThrow(FormulaError));
});

describe('rounding', () => {
  it('rounds half up on exact decimals, not binary floats', () => {
    expect(runFormula('a', { a: '1.005' }, 2).value).toBe('1.01');
    expect(runFormula('a + b', { a: '0.1', b: '0.2' }, 1).value).toBe('0.3');
    expect(runFormula('a + b', { a: '0.1', b: '0.2' }, 20).unrounded).toBe('0.3');
  });
});

describe('invalid input', () => {
  it.each([
    ['1 / 0', {}, /Division by zero/],
    ['a', {}, /Missing input/],
    ['a', { a: 'x' }, /not a number/],
    ['a', { a: 'Infinity' }, /not a number/],
    ['a', { a: '' }, /Missing input/],
    ['sqrt(0 - 1)', {}, /negative/],
    ['2 +', {}, /ends unexpectedly/],
    ['(2', {}, /Expected/],
    ['nope(1)', {}, /Unknown function/],
    ['avg()', {}, /Wrong number/],
    ['2 ^ 1000', {}, /too large/],
  ])('%s is rejected', (e, inputs, msg) => {
    expect(() => runFormula(e, inputs as never)).toThrow(msg);
  });

  it.each(['process.exit(1)', 'a.b', 'constructor', '"x"', 'a[0]', 'a; b', '`x`', '__proto__.x', 'x=1', 'a => a'])('cannot express code: %s', (e) => {
    // Bare identifiers parse as ordinary variables with no value; everything else is a syntax error.
    expect(() => runFormula(e, {})).toThrow(FormulaError);
  });

  it('does not read inherited properties as inputs', () => {
    expect(() => runFormula('__proto__ + constructor', {})).toThrow(/Missing input/);
  });

  it('caps length and nesting', () => {
    expect(() => parseExpression('1+'.repeat(400) + '1')).toThrow(/longer than/);
    expect(() => parseExpression(`${'('.repeat(100)}1${')'.repeat(100)}`)).toThrow(/nested too deeply/);
  });
});

describe('operators', () => {
  it('respects precedence and associativity', () => {
    expect(runFormula('2 + 3 * 4', {}, 0).value).toBe('14');
    expect(runFormula('(2 + 3) * 4', {}, 0).value).toBe('20');
    expect(runFormula('2 ^ 3 ^ 2', {}, 0).value).toBe('512');
    expect(runFormula('-2 ^ 2', {}, 0).value).toBe('-4');
    expect(runFormula('10 - 4 - 3', {}, 0).value).toBe('3');
  });
  it('lists variables', () => expect([...variablesOf(parseExpression('a + avg(b, c) * 2'))].sort()).toEqual(['a', 'b', 'c']));
  it('shows working', () => expect(runFormula('(A0 - Af) / A0 * 100', { A0: 100, Af: 45 }, 2).working).toContain('100 - 45'));
});
