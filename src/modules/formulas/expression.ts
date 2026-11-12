/**
 * Safe arithmetic expression engine for the formula master. Hand-written Pratt parser over a
 * small grammar, evaluated with exact decimals. There is no eval, no property access and no way
 * to reach anything but the numeric inputs and the functions listed here.
 */
import { Decimal } from 'decimal.js';

export class FormulaError extends Error {}

type Node =
  | { t: 'num'; v: string }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

type Token = { k: 'num' | 'id' | 'op'; v: string; at: number };

const MAX_LENGTH = 500;
const MAX_DEPTH = 40;

function tokenize(src: string): Token[] {
  if (src.length > MAX_LENGTH) throw new FormulaError(`Formula is longer than ${MAX_LENGTH} characters`);
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+(\.\d*)?|\.\d+)/.exec(src.slice(i));
      if (!m) throw new FormulaError(`Invalid number at position ${i + 1}`);
      out.push({ k: 'num', v: m[0], at: i });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ k: 'id', v: m[0], at: i });
      i += m[0].length;
    } else if ('+-*/^(),'.includes(c)) {
      out.push({ k: 'op', v: c, at: i });
      i++;
    } else {
      throw new FormulaError(`Unexpected character "${c}" at position ${i + 1}`);
    }
  }
  return out;
}

const FUNCTIONS: Record<string, { min: number; max: number; run: (a: Decimal[]) => Decimal }> = {
  avg: { min: 1, max: 100, run: (a) => Decimal.sum(...a).div(a.length) },
  average: { min: 1, max: 100, run: (a) => Decimal.sum(...a).div(a.length) },
  sum: { min: 1, max: 100, run: (a) => Decimal.sum(...a) },
  min: { min: 1, max: 100, run: (a) => Decimal.min(...a) },
  max: { min: 1, max: 100, run: (a) => Decimal.max(...a) },
  abs: { min: 1, max: 1, run: ([x]) => x.abs() },
  sqrt: {
    min: 1,
    max: 1,
    run: ([x]) => {
      if (x.isNegative()) throw new FormulaError('Square root of a negative number');
      return x.sqrt();
    },
  },
  round: { min: 2, max: 2, run: ([x, d]) => x.toDecimalPlaces(d.toNumber(), Decimal.ROUND_HALF_UP) },
};

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };

class Parser {
  private p = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    if (!this.tokens.length) throw new FormulaError('Formula is empty');
    const node = this.expr(0, 0);
    if (this.p < this.tokens.length) throw new FormulaError(`Unexpected "${this.tokens[this.p].v}" at position ${this.tokens[this.p].at + 1}`);
    return node;
  }

  private peek() {
    return this.tokens[this.p];
  }

  private expect(v: string) {
    const t = this.tokens[this.p];
    if (t?.v !== v) throw new FormulaError(t ? `Expected "${v}" at position ${t.at + 1}` : `Expected "${v}" at the end of the formula`);
    this.p++;
  }

  private expr(minPrec: number, depth: number): Node {
    if (depth > MAX_DEPTH) throw new FormulaError('Formula is nested too deeply');
    let left = this.unary(depth);
    for (;;) {
      const t = this.peek();
      if (!t || t.k !== 'op' || !(t.v in PRECEDENCE) || PRECEDENCE[t.v] < minPrec) return left;
      this.p++;
      // ^ is right-associative
      const next = t.v === '^' ? PRECEDENCE[t.v] : PRECEDENCE[t.v] + 1;
      const right = this.expr(next, depth + 1);
      left = { t: 'bin', op: t.v as '+', a: left, b: right };
    }
  }

  private unary(depth: number): Node {
    const t = this.peek();
    if (t?.k === 'op' && (t.v === '-' || t.v === '+')) {
      this.p++;
      // Binds looser than ^, so -x^2 means -(x^2).
      const a = this.expr(3, depth + 1);
      return t.v === '-' ? { t: 'neg', a } : a;
    }
    return this.primary(depth);
  }

  private primary(depth: number): Node {
    const t = this.peek();
    if (!t) throw new FormulaError('The formula ends unexpectedly');
    this.p++;
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'id') {
      if (this.peek()?.v !== '(') return { t: 'var', name: t.v };
      const fn = FUNCTIONS[t.v.toLowerCase()];
      if (!fn) throw new FormulaError(`Unknown function "${t.v}"`);
      this.p++;
      const args: Node[] = [];
      if (this.peek()?.v !== ')') {
        args.push(this.expr(0, depth + 1));
        while (this.peek()?.v === ',') {
          this.p++;
          args.push(this.expr(0, depth + 1));
        }
      }
      this.expect(')');
      if (args.length < fn.min || args.length > fn.max) throw new FormulaError(`Wrong number of inputs for ${t.v}()`);
      return { t: 'call', name: t.v.toLowerCase(), args };
    }
    if (t.v === '(') {
      const inner = this.expr(0, depth + 1);
      this.expect(')');
      return inner;
    }
    throw new FormulaError(`Unexpected "${t.v}" at position ${t.at + 1}`);
  }
}

export const parseExpression = (src: string): Node => new Parser(tokenize(src)).parse();

export function variablesOf(node: Node, out = new Set<string>()): Set<string> {
  if (node.t === 'var') out.add(node.name);
  else if (node.t === 'neg') variablesOf(node.a, out);
  else if (node.t === 'bin') {
    variablesOf(node.a, out);
    variablesOf(node.b, out);
  } else if (node.t === 'call') node.args.forEach((a) => variablesOf(a, out));
  return out;
}

/** Any value beyond this is not a laboratory number. Checked at every step, so nothing grows big enough to exhaust memory. */
const MAX_INTERMEDIATE = new Decimal('1e20');

function bounded(value: Decimal): Decimal {
  if (!value.isFinite() || value.abs().greaterThan(MAX_INTERMEDIATE)) throw new FormulaError('The result is too large');
  return value;
}

function evaluate(node: Node, inputs: Record<string, Decimal>): Decimal {
  return bounded(evaluateUnbounded(node, inputs));
}

function evaluateUnbounded(node: Node, inputs: Record<string, Decimal>): Decimal {
  switch (node.t) {
    case 'num':
      return new Decimal(node.v);
    case 'var': {
      const v = inputs[node.name];
      if (v === undefined) throw new FormulaError(`Missing input "${node.name}"`);
      return v;
    }
    case 'neg':
      return evaluate(node.a, inputs).negated();
    case 'call':
      return FUNCTIONS[node.name].run(node.args.map((a) => evaluate(a, inputs)));
    case 'bin': {
      const a = evaluate(node.a, inputs);
      const b = evaluate(node.b, inputs);
      if (node.op === '+') return a.plus(b);
      if (node.op === '-') return a.minus(b);
      if (node.op === '*') return a.times(b);
      if (node.op === '/') {
        if (b.isZero()) throw new FormulaError('Division by zero');
        return a.div(b);
      }
      if (b.abs().greaterThan(100)) throw new FormulaError('Exponent is too large');
      const result = a.pow(b);
      if (!result.isFinite()) throw new FormulaError('The result is not a number');
      return result;
    }
  }
}

function show(node: Node, inputs: Record<string, Decimal>): string {
  switch (node.t) {
    case 'num':
      return node.v;
    case 'var':
      return inputs[node.name].toString();
    case 'neg':
      return `-${show(node.a, inputs)}`;
    case 'call':
      return `${node.name}(${node.args.map((a) => show(a, inputs)).join(', ')})`;
    case 'bin':
      return `(${show(node.a, inputs)} ${node.op} ${show(node.b, inputs)})`;
  }
}

export interface FormulaResult {
  /** rounded to the formula's decimal places */
  value: string;
  unrounded: string;
  /** the formula with inputs substituted, shown to the analyst and stored */
  working: string;
}

/** Inputs may be strings or numbers; anything not a finite number is rejected, never coerced. */
export function runFormula(expression: string, rawInputs: Record<string, string | number>, decimals = 2): FormulaResult {
  const node = parseExpression(expression);
  // Own properties only, on a null-prototype map: a variable named __proto__ is just a missing input.
  const inputs: Record<string, Decimal> = Object.create(null);
  for (const name of variablesOf(node)) {
    const raw = Object.hasOwn(rawInputs, name) ? rawInputs[name] : undefined;
    if (raw === undefined || raw === null || raw === '') throw new FormulaError(`Missing input "${name}"`);
    let d: Decimal;
    try {
      d = new Decimal(raw);
    } catch {
      throw new FormulaError(`Input "${name}" is not a number`);
    }
    if (!d.isFinite()) throw new FormulaError(`Input "${name}" is not a number`);
    if (d.abs().greaterThan(MAX_INTERMEDIATE)) throw new FormulaError(`Input "${name}" is too large`);
    inputs[name] = d;
  }
  const result = evaluate(node, inputs);
  return {
    value: result.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toFixed(decimals),
    unrounded: result.toString(),
    working: `${show(node, inputs)} = ${result.toDecimalPlaces(Math.max(decimals, 4), Decimal.ROUND_HALF_UP).toString()}`,
  };
}

/** The built-in formulas from the formula master, seeded for every deployment. */
export const BUILTIN_FORMULAS = [
  { code: 'AVERAGE3', name: 'Average', expression: 'avg(a, b, c)', decimals: 2 },
  { code: 'REMAINDER', name: 'Remainder in chemical analysis', expression: '100 - sum_others', decimals: 3 },
  { code: 'CE_IIW', name: 'Carbon equivalent (IIW)', expression: 'C + Mn/6 + (Cr + Mo + V)/5 + (Ni + Cu)/15', decimals: 3 },
  { code: 'PREN', name: 'PREN', expression: 'Cr + 3.3 * Mo + 16 * N', decimals: 2 },
  { code: 'AREA_RECT', name: 'Area from width and thickness', expression: 'width * thickness', decimals: 3 },
  { code: 'AREA_ROUND', name: 'Area from diameter', expression: '3.14159265358979 * d^2 / 4', decimals: 3 },
  { code: 'UTS', name: 'UTS', expression: 'max_load / original_area', decimals: 2 },
  { code: 'ROA', name: 'Reduction of area', expression: '(A0 - Af) / A0 * 100', decimals: 2 },
  { code: 'ELONGATION', name: 'Elongation', expression: '(Lf - L0) / L0 * 100', decimals: 2 },
  { code: 'PROOF', name: 'Proof stress', expression: 'load_at_proof / original_area', decimals: 2 },
] as const;

/** Standard conversions from the unit master; factors are exact where a definition exists. */
export const BUILTIN_CONVERSIONS = [
  { from: 'PSI', to: 'KSI', factor: '0.001' },
  { from: 'MPA', to: 'NM2', factor: '1000000' },
  { from: 'J', to: 'KGFM', factor: '0.10197162129779' },
  { from: 'J', to: 'FTLBF', factor: '0.73756214927727' },
  { from: 'MPY', to: 'MPM', factor: '0.08333333333333' },
] as const;

export function convertUnit(value: string | number, factor: string, decimals = 4): string {
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    throw new FormulaError('The value is not a number');
  }
  if (!d.isFinite()) throw new FormulaError('The value is not a number');
  return d.times(factor).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toFixed(decimals);
}
