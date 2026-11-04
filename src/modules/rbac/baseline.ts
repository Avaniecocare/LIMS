import type { Tx } from '../../core/prisma.service.js';
import { BUILTIN_CONVERSIONS, BUILTIN_FORMULAS, parseExpression, variablesOf } from '../formulas/expression.js';

const UNITS = [
  ['PCT', 'Percent', '%'], ['PCT_MASS', 'Percent by mass', '% by mass'], ['MM', 'Millimetre', 'mm'], ['MM2', 'Square millimetre', 'mm²'], ['N', 'Newton', 'N'], ['KN', 'Kilonewton', 'kN'],
  ['CEL', 'Degree Celsius', '°C'], ['CST', 'Centistokes', 'cSt'], ['GCM3', 'Gram per cubic centimetre', 'g/cm³'], ['PSI', 'Pounds per square inch', 'psi'], ['KSI', 'Kilopounds per square inch', 'ksi'],
  ['MPA', 'Megapascal', 'MPa'], ['NM2', 'Newton per square metre', 'N/m²'], ['J', 'Joule', 'J'], ['KGFM', 'Kilogram-force metre', 'kgf·m'], ['FTLBF', 'Foot-pound force', 'ft·lbf'], ['MPY', 'Mils per year', 'mpy'], ['MPM', 'Mils per month', 'mils/month'],
] as const;

const LOOKUPS = [
  ['DEVIATION_TYPE', 'DAMAGE', 'Sample damaged'],
  ['DEVIATION_TYPE', 'SIZE_MISSING', 'Size not specified'],
  ['DEVIATION_TYPE', 'CLIENT_ID_MISSING', 'Client ID not specified'],
  ['DEVIATION_TYPE', 'INSUFFICIENT', 'Insufficient quantity'],
  ['DEVIATION_TYPE', 'IMPROPER_STAMP', 'Improper stamp'],
  ['DEVIATION_TYPE', 'TEST_DETAILS_MISSING', 'Missing test details'],
  ['RECEIPT_MODE', 'COURIER', 'Courier'],
  ['RECEIPT_MODE', 'BY_HAND', 'By hand'],
  ['RECEIPT_MODE', 'POST', 'Post'],
  ['RECEIPT_MODE', 'PICKUP', 'Collected by laboratory'],
  ['DISPATCH_MODE', 'COURIER', 'Courier'],
  ['DISPATCH_MODE', 'BY_HAND', 'By hand'],
  ['DISPATCH_MODE', 'POST', 'Post'],
] as const;

const RESULT_SETS = [
  ['COMPLIES', 'Complies / Does not comply', [['Complies', true], ['Does not comply', false]]],
  ['DETECTED', 'Detected / Not detected', [['Not detected', true], ['Detected', false]]],
  ['APPEARANCE', 'Appearance', [['Clear', null], ['Hazy', null], ['Turbid', null]]],
] as const;

/** Product defaults every deployment gets once. Never demo data, and an Admin may change them afterwards. */
export async function loadBaseline(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(727003)`;
  const marker = await tx.setting.findUnique({ where: { key: 'setup.baselineLoaded' } });
  if (marker) return;
  await tx.setting.create({ data: { key: 'setup.baselineLoaded', value: true } });

  await tx.unit.createMany({ data: UNITS.map(([code, name, symbol]) => ({ code, name, symbol })), skipDuplicates: true });
  const units = new Map((await tx.unit.findMany()).map((u) => [u.code, u.id]));
  await tx.unitConversion.createMany({
    data: BUILTIN_CONVERSIONS.map((c) => ({ fromUnitId: units.get(c.from)!, toUnitId: units.get(c.to)!, factor: c.factor })),
    skipDuplicates: true,
  });
  // Skip codes that already exist: an Admin's own record always wins over a product default.
  for (const f of BUILTIN_FORMULAS) {
    if (await tx.formula.findUnique({ where: { code: f.code } })) continue;
    await tx.formula.create({
      data: {
        code: f.code,
        name: f.name,
        versions: { create: { versionNo: 1, expression: f.expression, decimals: f.decimals, variables: [...variablesOf(parseExpression(f.expression))] } },
      },
    });
  }
  await tx.lookupValue.createMany({ data: LOOKUPS.map(([kind, code, label]) => ({ kind, code, label })), skipDuplicates: true });
  for (const [code, name, options] of RESULT_SETS) {
    if (await tx.resultSet.findUnique({ where: { code } })) continue;
    await tx.resultSet.create({
      data: { code, name, options: { create: options.map(([value, isPass], sortOrder) => ({ value, isPass, sortOrder })) } },
    });
  }
}
