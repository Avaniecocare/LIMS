import type { Client, Ctx } from './harness.js';

/** Masters a quotation or job needs: tests with rates that produce the required GST example. */
export async function billingFixture(admin: Client, ctx: Ctx, suffix = '') {
  const test = async (code: string, name: string, rate: string) => {
    const t = await admin.post('/masters/tests', { code: code + suffix, name }).expect(201);
    await admin.post('/masters/standard-rates', { testId: t.body.id, rate, effectiveFrom: '2020-01-01' }).expect(201);
    return t.body.id as string;
  };
  const a = await test('APP', 'Appearance', '550');
  const d = await test('DEN', 'Density', '550');
  const f = await test('FP', 'Flash Point', '1100');
  const k = await test('KV', 'Viscosity', '550');
  const g = await test('GC', 'GC-MSD', '10450');
  const intra = (
    await admin
      .post('/customers', {
        name: `Intra ${suffix}`,
        stateName: 'Maharashtra',
        stateCode: '27',
        addresses: [{ kind: 'BILLING', line1: '1 Road', city: 'Pune', stateName: 'Maharashtra', stateCode: '27' }],
        contacts: [{ name: 'Priya', email: 'priya@intra.example', isPrimary: true }],
      })
      .expect(201)
  ).body;
  const inter = (await admin.post('/customers', { name: `Inter ${suffix}`, stateName: 'Karnataka', stateCode: '29' }).expect(201)).body;
  void ctx;
  return { tests: { a, d, f, k, g }, intra, inter, testIds: [a, d, f, k, g] };
}

export const fiveLines = (testIds: string[], sampleDescription = 'Fuel oil sample') => testIds.map((testId) => ({ sampleDescription, testId, quantity: 1 }));
