/** Pure result logic: calculated parameters and pass/fail. No database, so it is directly testable. */
import { Decimal } from 'decimal.js';
import { FormulaError, runFormula } from '../formulas/expression.js';

export interface LimitSnapshot {
  spec: string;
  role: 'primary' | 'dual';
  min: string | null;
  max: string | null;
  text: string | null;
}

export interface ParamRow {
  parameterId: string;
  code: string;
  kind: 'NUMERIC' | 'TEXT' | 'RESULT_SET' | 'CALCULATED';
  decimals: number;
  limits: LimitSnapshot[];
  formula?: { versionId: string; expression: string; bindings: Record<string, string> } | null;
  /** allowed values for RESULT_SET */
  options?: { value: string; isPass: boolean | null }[];
}

export interface ComputedRow {
  parameterId: string;
  numericValue: string | null;
  textValue: string | null;
  passPrimary: boolean | null;
  passDual: boolean | null;
  calculation: { formulaVersionId: string; inputs: Record<string, string>; working: string; result: string } | null;
  error: string | null;
}

export function passAgainst(value: string | null, limit: LimitSnapshot | undefined): boolean | null {
  if (!limit || value === null) return null;
  if (limit.min === null && limit.max === null) return null;
  const v = new Decimal(value);
  if (limit.min !== null && v.lessThan(limit.min)) return false;
  if (limit.max !== null && v.greaterThan(limit.max)) return false;
  return true;
}

/** The results column holds 12 digits before the point. */
const MAX_MAGNITUDE = new Decimal('1e12');

function isNumber(raw: string): boolean {
  try {
    return new Decimal(raw).isFinite();
  } catch {
    return false;
  }
}

const inRange = (raw: Decimal.Value) => new Decimal(raw).abs().lessThan(MAX_MAGNITUDE);

/**
 * Applies entered values to the parameter list. Calculated parameters resolve in dependency order,
 * so area can feed strength; each uses its inputs as reported, at their stated decimals, so anyone
 * can repeat the working from the printed figures.
 */
export function computeResults(params: ParamRow[], entered: Record<string, string | null | undefined>): ComputedRow[] {
  const byCode = new Map(params.map((p) => [p.code, p]));
  const out = new Map<string, ComputedRow>();
  const values = new Map<string, string>();

  for (const p of params) {
    if (p.kind === 'CALCULATED') continue;
    const raw = entered[p.parameterId]?.trim() ?? '';
    const row: ComputedRow = { parameterId: p.parameterId, numericValue: null, textValue: null, passPrimary: null, passDual: null, calculation: null, error: null };
    if (raw !== '') {
      if (p.kind === 'NUMERIC') {
        if (!isNumber(raw)) row.error = 'Not a number';
        else if (!inRange(raw)) row.error = 'Too large';
        else {
          row.numericValue = new Decimal(raw).toDecimalPlaces(p.decimals, Decimal.ROUND_HALF_UP).toFixed(p.decimals);
          values.set(p.code, row.numericValue);
        }
      } else if (p.kind === 'RESULT_SET') {
        const option = p.options?.find((o) => o.value === raw);
        if (!option) row.error = 'Not one of the allowed results';
        else {
          row.textValue = raw;
          row.passPrimary = option.isPass;
          row.passDual = p.limits.some((l) => l.role === 'dual') ? option.isPass : null;
        }
      } else {
        row.textValue = raw;
      }
    }
    out.set(p.parameterId, row);
  }

  const pending = new Set(params.filter((p) => p.kind === 'CALCULATED'));
  // Repeats until nothing more resolves; the guard stops on a cycle or missing input.
  for (let pass = 0; pass <= params.length && pending.size; pass++) {
    for (const p of [...pending]) {
      const f = p.formula;
      const row: ComputedRow = { parameterId: p.parameterId, numericValue: null, textValue: null, passPrimary: null, passDual: null, calculation: null, error: null };
      if (!f) {
        row.error = 'No formula set';
        out.set(p.parameterId, row);
        pending.delete(p);
        continue;
      }
      const inputs: Record<string, string> = {};
      let ready = true;
      for (const [variable, code] of Object.entries(f.bindings)) {
        const v = values.get(code);
        if (v === undefined) ready = false;
        else inputs[variable] = v;
      }
      if (!ready) continue;
      try {
        const r = runFormula(f.expression, inputs, p.decimals);
        if (!inRange(r.value)) throw new FormulaError('The result is too large');
        row.numericValue = r.value;
        row.calculation = { formulaVersionId: f.versionId, inputs, working: r.working, result: r.value };
        values.set(p.code, r.value);
      } catch (e) {
        row.error = e instanceof FormulaError ? e.message : 'Could not calculate';
      }
      out.set(p.parameterId, row);
      pending.delete(p);
    }
  }
  for (const p of pending) {
    const missing = Object.values(p.formula?.bindings ?? {}).filter((c) => !values.has(c) && byCode.has(c));
    out.set(p.parameterId, { parameterId: p.parameterId, numericValue: null, textValue: null, passPrimary: null, passDual: null, calculation: null, error: missing.length ? `Waiting for ${missing.join(', ')}` : 'Waiting for inputs' });
  }

  for (const p of params) {
    const row = out.get(p.parameterId)!;
    if (row.numericValue !== null) {
      row.passPrimary = passAgainst(row.numericValue, p.limits.find((l) => l.role === 'primary'));
      row.passDual = passAgainst(row.numericValue, p.limits.find((l) => l.role === 'dual'));
    }
  }
  return params.map((p) => out.get(p.parameterId)!);
}

export function overallOutcome(rows: { passPrimary: boolean | null; passDual: boolean | null }[]): 'PASS' | 'FAIL' | 'ANY' {
  const flags = rows.flatMap((r) => [r.passPrimary, r.passDual]).filter((f): f is boolean => f !== null);
  if (!flags.length) return 'ANY';
  return flags.every(Boolean) ? 'PASS' : 'FAIL';
}
