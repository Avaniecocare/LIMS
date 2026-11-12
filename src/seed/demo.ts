/**
 * Demo data. Everything here is fictional and flagged isDemo, so `remove` can take it out in one
 * command. Provisioning a real company never runs this unless explicitly requested.
 */
import argon2 from 'argon2';
import type { PrismaClient } from '../generated/prisma/client.js';
import { DEFAULT_ROLES } from '../modules/rbac/catalog.js';

export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'Demo-Password-1!';

const USERS: [string, string, string, string][] = [
  ['admin', 'Asha Admin', 'Admin', 'Administrator'],
  ['sales', 'Sameer Sales', 'Sales / Business Development', 'Business Development Executive'],
  ['reception', 'Rekha Reception', 'Sample Reception', 'Sample Coordinator'],
  ['planner', 'Pranav Planner', 'Lab Manager / Planner', 'Lab Manager'],
  ['tech', 'Tara Technician', 'Technician / Analyst', 'Senior Analyst'],
  ['tech2', 'Tushar Technician', 'Technician / Analyst', 'Analyst'],
  ['hod', 'Harish HoD', 'Head of Department', 'Head of Department'],
  ['reviewer', 'Ritu Reviewer', 'Report Reviewer', 'Quality Reviewer'],
  ['signatory', 'Sunil Signatory', 'Authorised Signatory', 'Authorised Signatory'],
  ['dispatch', 'Dev Dispatch', 'Dispatch', 'Dispatch Officer'],
  ['accounts', 'Anita Accounts', 'Accounts', 'Accounts Officer'],
  ['management', 'Meera Management', 'Management', 'Director'],
  ['docs', 'Dev Document Controller', 'Document Controller', 'Document Controller'],
  ['quality', 'Kavya Quality', 'Quality Manager', 'Quality Manager'],
];

type TestSeed = {
  code: string;
  name: string;
  category: 'CHEMICAL' | 'MECHANICAL' | 'PHYSICAL' | 'OTHER';
  dept: string;
  method?: string;
  rate: string;
  params: { code: string; name: string; kind?: 'NUMERIC' | 'TEXT' | 'RESULT_SET' | 'CALCULATED'; unit?: string; decimals?: number; formula?: string; bindings?: Record<string, string>; resultSet?: string }[];
};

const METHODS: [string, string, string][] = [
  ['VISUAL', 'Visual examination', 'Visual'],
  ['IS1448-16', 'Density', 'IS 1448 (Part 16): 2014'],
  ['IS1448-69', 'Flash Point (COC)', 'IS 1448 (Part 69): 2013'],
  ['IS1448-25', 'Kinematic Viscosity', 'IS 1448 (Part 25): 1976 (RA 2007)'],
  ['GCMSD', 'Qualitative Analysis', 'GC-MSD technique'],
  ['ISO15512', 'Moisture content', 'ISO 15512: 2019'],
  ['ASTM-E8', 'Tension testing of metallic materials (demo)', 'ASTM E8/E8M'],
  ['ASTM-E415', 'Spark atomic emission spectrometry of steel (demo)', 'ASTM E415'],
  ['ASTM-E23', 'Notched bar impact testing (demo)', 'ASTM E23'],
];

const TESTS: TestSeed[] = [
  { code: 'APP', name: 'Appearance (Visual)', category: 'PHYSICAL', dept: 'CHEM', method: 'VISUAL', rate: '550', params: [{ code: 'APPEAR', name: 'Appearance', kind: 'RESULT_SET', resultSet: 'APPEARANCE' }] },
  { code: 'DEN', name: 'Density', category: 'PHYSICAL', dept: 'CHEM', method: 'IS1448-16', rate: '550', params: [{ code: 'DENSITY', name: 'Density at 15°C', unit: 'GCM3', decimals: 4 }] },
  { code: 'FP', name: 'Flash Point (COC)', category: 'PHYSICAL', dept: 'CHEM', method: 'IS1448-69', rate: '1100', params: [{ code: 'FLASH', name: 'Flash point', unit: 'CEL', decimals: 1 }] },
  { code: 'KV40', name: 'Kinematic Viscosity at 40°C', category: 'PHYSICAL', dept: 'CHEM', method: 'IS1448-25', rate: '550', params: [{ code: 'KV', name: 'Kinematic viscosity at 40°C', unit: 'CST', decimals: 2 }] },
  { code: 'GCMS', name: 'Qualitative Analysis (GC-MSD)', category: 'CHEMICAL', dept: 'CHEM', method: 'GCMSD', rate: '10450', params: [{ code: 'QUAL', name: 'Qualitative result', kind: 'TEXT' }] },
  { code: 'MOIST', name: 'Moisture content', category: 'CHEMICAL', dept: 'CHEM', method: 'ISO15512', rate: '850', params: [{ code: 'WATER', name: 'Moisture, % by mass', unit: 'PCT_MASS', decimals: 3 }] },
  {
    code: 'CHEM-LAS',
    name: 'Chemical analysis, low alloy steel',
    category: 'CHEMICAL',
    dept: 'MET',
    method: 'ASTM-E415',
    rate: '1800',
    params: [
      { code: 'C', name: 'Carbon', unit: 'PCT', decimals: 3 }, { code: 'Mn', name: 'Manganese', unit: 'PCT', decimals: 3 }, { code: 'Cr', name: 'Chromium', unit: 'PCT', decimals: 3 }, { code: 'Mo', name: 'Molybdenum', unit: 'PCT', decimals: 3 },
      { code: 'V', name: 'Vanadium', unit: 'PCT', decimals: 3 }, { code: 'Ni', name: 'Nickel', unit: 'PCT', decimals: 3 }, { code: 'Cu', name: 'Copper', unit: 'PCT', decimals: 3 }, { code: 'N', name: 'Nitrogen', unit: 'PCT', decimals: 3 },
      { code: 'CE', name: 'Carbon equivalent (IIW)', kind: 'CALCULATED', decimals: 3, formula: 'CE_IIW', bindings: { C: 'C', Mn: 'Mn', Cr: 'Cr', Mo: 'Mo', V: 'V', Ni: 'Ni', Cu: 'Cu' } },
      { code: 'PREN', name: 'PREN', kind: 'CALCULATED', decimals: 2, formula: 'PREN', bindings: { Cr: 'Cr', Mo: 'Mo', N: 'N' } },
      { code: 'OTHERS', name: 'Sum of analysed elements', unit: 'PCT', decimals: 3 },
      { code: 'FE', name: 'Iron (remainder)', kind: 'CALCULATED', unit: 'PCT', decimals: 3, formula: 'REMAINDER', bindings: { sum_others: 'OTHERS' } },
    ],
  },
  {
    code: 'TENS',
    name: 'Tensile test',
    category: 'MECHANICAL',
    dept: 'MET',
    method: 'ASTM-E8',
    rate: '1500',
    params: [
      { code: 'WIDTH', name: 'Width', unit: 'MM', decimals: 2 }, { code: 'THICK', name: 'Thickness', unit: 'MM', decimals: 2 },
      { code: 'A0', name: 'Original area', kind: 'CALCULATED', unit: 'MM2', decimals: 3, formula: 'AREA_RECT', bindings: { width: 'WIDTH', thickness: 'THICK' } },
      { code: 'Af', name: 'Final area', unit: 'MM2', decimals: 3 }, { code: 'LOAD', name: 'Maximum load', unit: 'N', decimals: 0 }, { code: 'PROOFLOAD', name: 'Load at proof', unit: 'N', decimals: 0 },
      { code: 'L0', name: 'Original gauge length', unit: 'MM', decimals: 2 }, { code: 'Lf', name: 'Final gauge length', unit: 'MM', decimals: 2 },
      { code: 'UTS', name: 'Ultimate tensile strength', kind: 'CALCULATED', unit: 'MPA', decimals: 2, formula: 'UTS', bindings: { max_load: 'LOAD', original_area: 'A0' } },
      { code: 'PROOF', name: '0.2% proof stress', kind: 'CALCULATED', unit: 'MPA', decimals: 2, formula: 'PROOF', bindings: { load_at_proof: 'PROOFLOAD', original_area: 'A0' } },
      { code: 'ROA', name: 'Reduction of area', kind: 'CALCULATED', unit: 'PCT', decimals: 2, formula: 'ROA', bindings: { A0: 'A0', Af: 'Af' } },
      { code: 'EL', name: 'Elongation', kind: 'CALCULATED', unit: 'PCT', decimals: 2, formula: 'ELONGATION', bindings: { L0: 'L0', Lf: 'Lf' } },
    ],
  },
  {
    code: 'IMPACT',
    name: 'Charpy impact test',
    category: 'MECHANICAL',
    dept: 'MET',
    method: 'ASTM-E23',
    rate: '900',
    params: [
      { code: 'a', name: 'Impact energy 1', unit: 'J', decimals: 1 }, { code: 'b', name: 'Impact energy 2', unit: 'J', decimals: 1 }, { code: 'c', name: 'Impact energy 3', unit: 'J', decimals: 1 },
      { code: 'AVG', name: 'Average impact energy', kind: 'CALCULATED', unit: 'J', decimals: 1, formula: 'AVERAGE3', bindings: { a: 'a', b: 'b', c: 'c' } },
    ],
  },
];

const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Valid-format, fictional GSTINs only. */
const CUSTOMERS = [
  { name: 'Northwind Petrochem Pvt Ltd', gstin: '27EEEEE4444E1ZE', stateName: 'Maharashtra', stateCode: '27', city: 'Mumbai', contact: 'Neha Kulkarni', email: 'neha@northwind.example' },
  { name: 'Contoso Forgings Ltd', gstin: '24CCCCC2222C1ZE', stateName: 'Gujarat', stateCode: '24', city: 'Vadodara', contact: 'Rohan Shah', email: 'rohan@contoso.example' },
  { name: 'Fabrikam Steels LLP', gstin: '07DDDDD3333D1ZV', stateName: 'Delhi', stateCode: '07', city: 'New Delhi', contact: 'Vikram Sethi', email: 'vikram@fabrikam.example' },
];

export async function seedDemo(prisma: PrismaClient): Promise<void> {
  if (await prisma.user.findFirst({ where: { isDemo: true } })) {
    process.stdout.write('Demo data is already loaded.\n');
    return;
  }
  const hash = await argon2.hash(DEMO_PASSWORD);
  const start = addDays(today(), -365);

  await prisma.$transaction(
    async (tx) => {
      const roles = new Map((await tx.role.findMany()).map((r) => [r.name, r.id]));
      for (const name of Object.keys(DEFAULT_ROLES)) if (!roles.has(name)) throw new Error(`Role ${name} is missing; start the API once first`);

      const depts = new Map<string, string>();
      for (const [code, name] of [['CHEM', 'Chemical'], ['MET', 'Metallurgy']] as const) {
        depts.set(code, (await tx.department.create({ data: { code, name, isDemo: true } })).id);
      }
      for (const [username, name, role, designation] of USERS) {
        await tx.user.create({
          data: {
            email: `${username}@demo.example`,
            name,
            designation,
            passwordHash: hash,
            isDemo: true,
            passwordChangedAt: new Date(Date.now() - 60_000),
            departmentId: username === 'hod' || username.startsWith('tech') ? depts.get('MET') : undefined,
            roles: { create: [{ roleId: roles.get(role)! }] },
          },
        });
      }
      const methods = new Map<string, string>();
      for (const [code, name, standardRef] of METHODS) {
        methods.set(code, (await tx.testMethod.create({ data: { code, name, standardRef, isDemo: true } })).id);
      }
      const units = new Map((await tx.unit.findMany()).map((u) => [u.code, u.id]));
      const formulas = new Map((await tx.formula.findMany()).map((f) => [f.code, f.id]));
      const resultSets = new Map((await tx.resultSet.findMany()).map((r) => [r.code, r.id]));

      const params = new Map<string, string>();
      const testIds = new Map<string, string>();
      for (const t of TESTS) {
        const test = await tx.testMaster.create({
          data: { code: t.code, name: t.name, category: t.category, departmentId: depts.get(t.dept), methodId: t.method ? methods.get(t.method) : undefined, defaultTatDays: 5, urgentTatDays: 2, isDemo: true },
        });
        testIds.set(t.code, test.id);
        await tx.standardRate.create({ data: { testId: test.id, rate: t.rate, effectiveFrom: start, isDemo: true } });
        let sortOrder = 0;
        for (const p of t.params) {
          const row = await tx.testParameter.create({
            data: {
              testId: test.id,
              code: p.code,
              name: p.name,
              kind: p.kind ?? 'NUMERIC',
              unitId: p.unit ? units.get(p.unit) : undefined,
              decimals: p.decimals ?? 2,
              formulaId: p.formula ? formulas.get(p.formula) : undefined,
              formulaBindings: p.bindings,
              resultSetId: p.resultSet ? resultSets.get(p.resultSet) : undefined,
              sortOrder: sortOrder++,
              isDemo: true,
            },
          });
          params.set(`${t.code}.${p.code}`, row.id);
        }
      }

      const spec = await tx.specification.create({ data: { code: 'DEMO-FUEL', name: 'Demo fuel oil grade', isDemo: true } });
      await tx.specificationLimit.createMany({
        data: [
          { specificationId: spec.id, parameterId: params.get('DEN.DENSITY')!, minValue: '0.8000', maxValue: '0.9500' },
          { specificationId: spec.id, parameterId: params.get('FP.FLASH')!, minValue: '66' },
          { specificationId: spec.id, parameterId: params.get('KV40.KV')!, maxValue: '32' },
          { specificationId: spec.id, parameterId: params.get('MOIST.WATER')!, maxValue: '0.500' },
        ],
      });
      const steelA = await tx.specification.create({ data: { code: 'DEMO-S355', name: 'Demo structural steel A', isDemo: true } });
      const steelB = await tx.specification.create({ data: { code: 'DEMO-S420', name: 'Demo structural steel B', isDemo: true } });
      await tx.specificationLimit.createMany({
        data: [
          { specificationId: steelA.id, parameterId: params.get('CHEM-LAS.C')!, maxValue: '0.220' },
          { specificationId: steelA.id, parameterId: params.get('CHEM-LAS.CE')!, maxValue: '0.450' },
          { specificationId: steelA.id, parameterId: params.get('TENS.UTS')!, minValue: '470', maxValue: '630' },
          { specificationId: steelA.id, parameterId: params.get('TENS.EL')!, minValue: '20' },
          { specificationId: steelB.id, parameterId: params.get('CHEM-LAS.C')!, maxValue: '0.200' },
          { specificationId: steelB.id, parameterId: params.get('CHEM-LAS.CE')!, maxValue: '0.430' },
          { specificationId: steelB.id, parameterId: params.get('TENS.UTS')!, minValue: '520', maxValue: '680' },
          { specificationId: steelB.id, parameterId: params.get('TENS.EL')!, minValue: '19' },
        ],
      });

      const group = await tx.testGroup.create({ data: { code: 'FUEL-BASIC', name: 'Fuel oil basic panel', kind: 'TEST', isDemo: true } });
      await tx.testGroupItem.createMany({ data: ['APP', 'DEN', 'FP', 'KV40', 'GCMS'].map((c) => ({ groupId: group.id, testId: testIds.get(c)! })) });
      const chem = await tx.testGroup.create({ data: { code: 'STEEL-CHEM', name: 'Steel chemistry', kind: 'CHEMICAL', isDemo: true } });
      await tx.testGroupItem.createMany({ data: [{ groupId: chem.id, testId: testIds.get('CHEM-LAS')! }] });
      const mech = await tx.testGroup.create({ data: { code: 'STEEL-MECH', name: 'Steel mechanical panel', kind: 'TEST', isDemo: true } });
      await tx.testGroupItem.createMany({ data: ['TENS', 'IMPACT'].map((c) => ({ groupId: mech.id, testId: testIds.get(c)! })) });

      await tx.instrument.createMany({
        data: [
          { code: 'SPEC-01', name: 'Optical emission spectrometer (demo)', serialNo: 'DEMO-001', departmentId: depts.get('MET'), lastCalibratedAt: addDays(today(), -100), calibrationDueAt: addDays(today(), 265), isDemo: true },
          { code: 'UTM-01', name: 'Universal testing machine (demo)', serialNo: 'DEMO-002', departmentId: depts.get('MET'), lastCalibratedAt: addDays(today(), -350), calibrationDueAt: addDays(today(), 15), isDemo: true },
          { code: 'IMP-01', name: 'Impact tester (demo)', serialNo: 'DEMO-003', departmentId: depts.get('MET'), lastCalibratedAt: addDays(today(), -400), calibrationDueAt: addDays(today(), -35), isDemo: true },
          { code: 'GC-01', name: 'GC-MSD (demo)', serialNo: 'DEMO-004', departmentId: depts.get('CHEM'), lastCalibratedAt: addDays(today(), -50), calibrationDueAt: addDays(today(), 315), isDemo: true },
          { code: 'VISC-01', name: 'Viscometer bath (demo)', serialNo: 'DEMO-005', departmentId: depts.get('CHEM'), lastCalibratedAt: addDays(today(), -50), calibrationDueAt: addDays(today(), 315), isDemo: true },
        ],
      });
      await tx.remarkTemplate.createMany({
        data: [
          { code: 'PASS-GEN', text: 'The sample meets the specified requirements for the parameters tested.', outcome: 'PASS', isDemo: true },
          { code: 'FAIL-GEN', text: 'The sample does not meet the specified requirements for the parameters marked.', outcome: 'FAIL', isDemo: true },
          { code: 'NOTE-GEN', text: 'Tested as received.', outcome: 'ANY', isDemo: true },
        ],
      });

      let n = 0;
      for (const c of CUSTOMERS) {
        n++;
        const customer = await tx.customer.create({
          data: {
            crn: `DEMO-${String(n).padStart(4, '0')}`,
            name: c.name,
            gstin: c.gstin,
            pan: c.gstin.slice(2, 12),
            stateName: c.stateName,
            stateCode: c.stateCode,
            creditDays: 30,
            isDemo: true,
            contacts: { create: [{ name: c.contact, email: c.email, phone: '+91 00000 00000', designation: 'Purchase Manager', isPrimary: true }] },
            addresses: {
              create: [
                { kind: 'BILLING', line1: `${n} Example Road`, city: c.city, stateName: c.stateName, stateCode: c.stateCode, pincode: '000000' },
                { kind: 'REPORT', line1: `${n} Example Road`, city: c.city, stateName: c.stateName, stateCode: c.stateCode, pincode: '000000' },
              ],
            },
          },
        });
        if (n === 2) await tx.customerRate.create({ data: { customerId: customer.id, testId: testIds.get('TENS')!, rate: '1350', effectiveFrom: start, isDemo: true } });
      }

      for (const [kind, body] of [
        ['QUOTATION', 'Demo terms. Rates are valid until the date shown. Samples are tested as received. GST is charged as applicable.'],
        ['INVOICE', 'Demo terms. Payment is due within the credit period shown. Please quote the invoice number with your payment.'],
        ['REPORT', 'Demo terms. This report may not be reproduced except in full without written approval of the laboratory. Liability is limited to the testing fee paid.'],
      ] as const) {
        if (!(await tx.termsVersion.findFirst({ where: { kind } }))) await tx.termsVersion.create({ data: { kind, versionNo: 1, body } });
      }
      await tx.setting.upsert({ where: { key: 'setup.completed' }, create: { key: 'setup.completed', value: true }, update: { value: true } });
      // A demo install is shown as set up, so nobody is sent through the setup wizard.
      await tx.setting.upsert({ where: { key: 'setup.labCompleted' }, create: { key: 'setup.labCompleted', value: true }, update: { value: true } });
    },
    { timeout: 120_000 },
  );
  process.stdout.write(`Demo data loaded. Users are <role>@demo.example, for example admin@demo.example.\n`);
}

/** Removes demo rows and everything hanging off them. The append-only audit log is kept. */
export async function removeDemo(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const customers = (await tx.customer.findMany({ where: { isDemo: true }, select: { id: true } })).map((c) => c.id);
      const jobs = (await tx.job.findMany({ where: { OR: [{ isDemo: true }, { customerId: { in: customers } }] }, select: { id: true } })).map((j) => j.id);
      const samples = (await tx.sample.findMany({ where: { jobId: { in: jobs } }, select: { id: true } })).map((s) => s.id);
      const tests = (await tx.sampleTest.findMany({ where: { sampleId: { in: samples } }, select: { id: true } })).map((t) => t.id);
      const results = (await tx.parameterResult.findMany({ where: { sampleTestId: { in: tests } }, select: { id: true } })).map((r) => r.id);
      const reports = (await tx.report.findMany({ where: { sampleId: { in: samples } }, select: { id: true } })).map((r) => r.id);
      const revisions = (await tx.reportRevision.findMany({ where: { reportId: { in: reports } }, select: { id: true } })).map((r) => r.id);
      const invoices = (await tx.invoice.findMany({ where: { customerId: { in: customers } }, select: { id: true } })).map((i) => i.id);
      const payments = (await tx.payment.findMany({ where: { customerId: { in: customers } }, select: { id: true } })).map((p) => p.id);
      const quotations = (await tx.quotation.findMany({ where: { customerId: { in: customers } }, select: { id: true } })).map((q) => q.id);
      const qVersions = (await tx.quotationVersion.findMany({ where: { quotationId: { in: quotations } }, select: { id: true } })).map((v) => v.id);
      const demoTests = (await tx.testMaster.findMany({ where: { isDemo: true }, select: { id: true } })).map((t) => t.id);
      const demoParams = (await tx.testParameter.findMany({ where: { testId: { in: demoTests } }, select: { id: true } })).map((p) => p.id);
      const demoSpecs = (await tx.specification.findMany({ where: { OR: [{ isDemo: true }, { customerId: { in: customers } }] }, select: { id: true } })).map((s) => s.id);
      const demoUsers = (await tx.user.findMany({ where: { isDemo: true }, select: { id: true } })).map((u) => u.id);

      await tx.paymentAllocation.deleteMany({ where: { OR: [{ paymentId: { in: payments } }, { invoiceId: { in: invoices } }] } });
      await tx.payment.deleteMany({ where: { id: { in: payments } } });
      await tx.reminderLog.deleteMany({ where: { invoiceId: { in: invoices } } });
      await tx.creditNote.deleteMany({ where: { invoiceId: { in: invoices } } });
      await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoices } } });
      await tx.invoice.deleteMany({ where: { id: { in: invoices } } });
      await tx.dispatch.deleteMany({ where: { jobId: { in: jobs } } });
      await tx.reportSignature.deleteMany({ where: { revisionId: { in: revisions } } });
      await tx.reportRejection.deleteMany({ where: { revisionId: { in: revisions } } });
      await tx.reportRevision.deleteMany({ where: { id: { in: revisions } } });
      await tx.report.deleteMany({ where: { id: { in: reports } } });
      await tx.calculationRecord.deleteMany({ where: { parameterResultId: { in: results } } });
      await tx.parameterResult.deleteMany({ where: { id: { in: results } } });
      await tx.sampleTestStage.deleteMany({ where: { sampleTestId: { in: tests } } });
      await tx.sampleTest.deleteMany({ where: { id: { in: tests } } });
      await tx.plan.deleteMany({ where: { jobId: { in: jobs } } });
      await tx.sampleDeviation.deleteMany({ where: { jobId: { in: jobs } } });
      await tx.sampleAttribute.deleteMany({ where: { sampleId: { in: samples } } });
      await tx.sample.deleteMany({ where: { id: { in: samples } } });
      await tx.statusEvent.deleteMany({ where: { jobId: { in: jobs } } });
      await tx.job.deleteMany({ where: { id: { in: jobs } } });
      await tx.quotationLine.deleteMany({ where: { versionId: { in: qVersions } } });
      await tx.quotationVersion.deleteMany({ where: { id: { in: qVersions } } });
      await tx.quotation.deleteMany({ where: { id: { in: quotations } } });
      await tx.order.deleteMany({ where: { customerId: { in: customers } } });
      await tx.specificationLimit.deleteMany({ where: { OR: [{ specificationId: { in: demoSpecs } }, { parameterId: { in: demoParams } }] } });
      await tx.specification.deleteMany({ where: { id: { in: demoSpecs } } });
      await tx.testGroupItem.deleteMany({ where: { OR: [{ testId: { in: demoTests } }, { group: { isDemo: true } }] } });
      await tx.testGroup.deleteMany({ where: { isDemo: true } });
      await tx.customerRate.deleteMany({ where: { OR: [{ isDemo: true }, { customerId: { in: customers } }, { testId: { in: demoTests } }] } });
      await tx.standardRate.deleteMany({ where: { OR: [{ isDemo: true }, { testId: { in: demoTests } }] } });
      await tx.testParameter.deleteMany({ where: { id: { in: demoParams } } });
      await tx.testMaster.deleteMany({ where: { id: { in: demoTests } } });
      await tx.testMethod.deleteMany({ where: { isDemo: true } });
      await tx.instrument.deleteMany({ where: { isDemo: true } });
      await tx.remarkTemplate.deleteMany({ where: { isDemo: true } });
      await tx.customerContact.deleteMany({ where: { customerId: { in: customers } } });
      await tx.customerAddress.deleteMany({ where: { customerId: { in: customers } } });
      await tx.customer.deleteMany({ where: { id: { in: customers } } });
      await tx.notification.deleteMany({ where: { userId: { in: demoUsers } } });
      await tx.savedFilter.deleteMany({ where: { userId: { in: demoUsers } } });
      await tx.passwordResetToken.deleteMany({ where: { userId: { in: demoUsers } } });
      await tx.userRole.deleteMany({ where: { userId: { in: demoUsers } } });
      await tx.user.deleteMany({ where: { id: { in: demoUsers } } });
      await tx.department.deleteMany({ where: { isDemo: true } });
      // Back to first-run if no real user was ever created.
      if ((await tx.user.count()) === 0) await tx.setting.deleteMany({ where: { key: 'setup.completed' } });
    },
    { timeout: 180_000 },
  );
  process.stdout.write('Demo data removed.\n');
}
