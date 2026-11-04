import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';

let ctx: Ctx;
let admin: Client;
let tech: Client;
let sales: Client;

async function workbook(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  await createUser(ctx, 'admin@m.example', [ROLE_NAMES.admin]);
  await createUser(ctx, 'tech@m.example', [ROLE_NAMES.tech]);
  await createUser(ctx, 'sales@m.example', [ROLE_NAMES.sales]);
  admin = await login(ctx, 'admin@m.example');
  tech = await login(ctx, 'tech@m.example');
  sales = await login(ctx, 'sales@m.example');
});
afterAll(() => ctx.app.close());

describe('generic master behaviour', () => {
  it('creates, lists, searches, updates with concurrency check, and keeps history', async () => {
    const created = await admin.post('/masters/departments', { code: 'CHEM', name: 'Chemical' }).expect(201);
    await admin.post('/masters/departments', { code: 'CHEM', name: 'Duplicate' }).expect(409);
    const list = await admin.get('/masters/departments?q=chem').expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta).toMatchObject({ page: 1, total: 1 });
    await admin.patch(`/masters/departments/${created.body.id}`, { code: 'CHEM', name: 'Chemistry', version: 1 }).expect(200);
    await admin.patch(`/masters/departments/${created.body.id}`, { code: 'CHEM', name: 'Stale', version: 1 }).expect(409);
    const history = await admin.get(`/masters/departments/${created.body.id}/history`).expect(200);
    expect(history.body.map((h: { action: string }) => h.action)).toEqual(['Department.update', 'Department.create']);
    expect(history.body[0].before.name).toBe('Chemical');
    expect(history.body[0].after.name).toBe('Chemistry');
  });

  it('validates on the server with field errors', async () => {
    const res = await admin.post('/masters/departments', { code: '', extra: 1 }).expect(400);
    expect(res.body.error.fields.map((f: { field: string }) => f.field)).toEqual(expect.arrayContaining(['code', 'name', 'extra']));
  });

  it('refuses delete when in use, allows deactivate', async () => {
    const dept = await admin.post('/masters/departments', { code: 'MECH', name: 'Mechanical' }).expect(201);
    const test = await admin.post('/masters/tests', { code: 'T-DEL', name: 'In use', departmentId: dept.body.id }).expect(201);
    const res = await admin.del(`/masters/departments/${dept.body.id}`).expect(409);
    expect(res.body.error.message).toContain('Deactivate');
    await admin.patch(`/masters/departments/${dept.body.id}`, { code: 'MECH', name: 'Mechanical', version: 1, isActive: false }).expect(200);
    expect((await admin.get('/masters/departments?q=MECH').expect(200)).body.data).toHaveLength(0);
    expect((await admin.get('/masters/departments?q=MECH&active=all').expect(200)).body.data).toHaveLength(1);
    await admin.del(`/masters/tests/${test.body.id}`).expect(200);
    await admin.del(`/masters/departments/${dept.body.id}`).expect(200);
    await admin.get(`/masters/departments/${dept.body.id}`).expect(404);
    expect(await ctx.prisma.department.count({ where: { id: dept.body.id } })).toBe(1); // soft only
  });

  it('gates reads and writes by permission', async () => {
    await tech.get('/masters/departments').expect(403);
    await sales.post('/masters/departments', { code: 'X', name: 'X' }).expect(403);
    await sales.get('/masters/departments').expect(200);
    await tech.get('/masters/standard-rates').expect(403);
  });

  it('ignores an unsafe sort column', async () => {
    await admin.get('/masters/departments?sort=passwordHash').expect(200);
  });
});

describe('tests and parameters', () => {
  it('requires a formula and bindings for calculated parameters', async () => {
    const t = await admin.post('/masters/tests', { code: 'T1', name: 'Tensile' }).expect(201);
    const f = await admin.post('/masters/formulas', { code: 'UTS', name: 'UTS', expression: 'max_load / area', decimals: 2 }).expect(201);
    expect(f.body.variables.sort()).toEqual(['area', 'max_load']);
    await admin.post('/masters/test-parameters', { testId: t.body.id, code: 'UTS', name: 'UTS', kind: 'CALCULATED' }).expect(400);
    await admin.post('/masters/test-parameters', { testId: t.body.id, code: 'UTS', name: 'UTS', kind: 'CALCULATED', formulaId: f.body.id, formulaBindings: { max_load: 'LOAD' } }).expect(400);
    await admin.post('/masters/test-parameters', { testId: t.body.id, code: 'UTS', name: 'UTS', kind: 'CALCULATED', formulaId: f.body.id, formulaBindings: { max_load: 'LOAD', area: 'A0' } }).expect(201);
    const got = await admin.get(`/masters/tests/${t.body.id}`).expect(200);
    expect(got.body.parameterCount).toBe(1);
    expect(got.body.stages[0]).toBe('Sample Received by Analyst');
  });

  it('stores limits on a specification and rejects min above max', async () => {
    const t = await admin.post('/masters/tests', { code: 'T2', name: 'Density' }).expect(201);
    const p = await admin.post('/masters/test-parameters', { testId: t.body.id, code: 'D', name: 'Density' }).expect(201);
    await admin.post('/masters/specifications', { code: 'S-BAD', name: 'Bad', limits: [{ parameterId: p.body.id, minValue: '5', maxValue: '1' }] }).expect(400);
    const s = await admin.post('/masters/specifications', { code: 'S1', name: 'Grade A', limits: [{ parameterId: p.body.id, minValue: '0.8', maxValue: '1.2' }] }).expect(201);
    expect(s.body.limits[0]).toMatchObject({ parameterCode: 'D', testCode: 'T2' });
    expect(Number(s.body.limits[0].minValue)).toBe(0.8);
    await admin.post('/masters/specifications', { code: 'S1', name: 'Duplicate' }).expect(400);
    const updated = await admin.patch(`/masters/specifications/${s.body.id}`, { code: 'S1', name: 'Grade A', version: 1, limits: [] }).expect(200);
    expect(updated.body.limits).toHaveLength(0);
  });
});

describe('formula master', () => {
  it('versions on expression change and keeps old versions', async () => {
    const f = await admin.post('/masters/formulas', { code: 'F1', name: 'Doubler', expression: 'a * 2', decimals: 1 }).expect(201);
    expect(f.body.currentVersion).toBe(1);
    const same = await admin.patch(`/masters/formulas/${f.body.id}`, { code: 'F1', name: 'Renamed', expression: 'a * 2', decimals: 1, version: f.body.version }).expect(200);
    expect(same.body.currentVersion).toBe(1);
    const changed = await admin.patch(`/masters/formulas/${f.body.id}`, { code: 'F1', name: 'Tripler', expression: 'a * 3', decimals: 1, version: same.body.version }).expect(200);
    expect(changed.body.currentVersion).toBe(2);
    expect(changed.body.versions.map((v: { expression: string }) => v.expression)).toEqual(['a * 3', 'a * 2']);
  });

  it('rejects an invalid expression and offers a test console', async () => {
    const bad = await admin.post('/masters/formulas', { code: 'BAD', name: 'Bad', expression: 'process.exit(1)' }).expect(400);
    expect(bad.body.error.fields[0].field).toBe('expression');
    const ok = await admin.post('/masters/formula-console', { expression: '(A0 - Af) / A0 * 100', inputs: { A0: '100', Af: '45' }, decimals: 2 }).expect(200);
    expect(ok.body).toMatchObject({ valid: true, value: '55.00' });
    expect(ok.body.working).toContain('100 - 45');
    const partial = await admin.post('/masters/formula-console', { expression: 'a + b', inputs: {} }).expect(200);
    expect(partial.body).toMatchObject({ valid: true, value: null });
    const invalid = await admin.post('/masters/formula-console', { expression: '1 / 0', inputs: {} }).expect(200);
    expect(invalid.body).toMatchObject({ valid: false, error: 'Division by zero' });
  });
});

describe('units', () => {
  it('converts through the master', async () => {
    const a = await admin.post('/masters/units', { code: 'PSI', name: 'PSI', symbol: 'psi' }).expect(201);
    const b = await admin.post('/masters/units', { code: 'KSI', name: 'KSI', symbol: 'ksi' }).expect(201);
    await admin.post('/masters/unit-conversions', { fromUnitId: a.body.id, toUnitId: a.body.id, factor: '1' }).expect(400);
    const c = await admin.post('/masters/unit-conversions', { fromUnitId: a.body.id, toUnitId: b.body.id, factor: '0.001' }).expect(201);
    expect((await admin.post('/masters/convert', { conversionId: c.body.id, value: '2500' }).expect(200)).body.value).toBe('2.5000');
    await admin.post('/masters/convert', { conversionId: c.body.id, value: 'abc' }).expect(400);
  });
});

describe('rates', () => {
  it('prefers an effective customer rate over the standard rate', async () => {
    const t = await admin.post('/masters/tests', { code: 'T-RATE', name: 'Rated' }).expect(201);
    const cust = await admin.post('/customers', { name: 'Rate Co', stateName: 'Maharashtra', stateCode: '27' }).expect(201);
    const lookup = async (on: string) => (await admin.get(`/masters/rate-lookup?testId=${t.body.id}&customerId=${cust.body.id}&on=${on}`).expect(200)).body;
    expect(await lookup('2026-06-01')).toEqual({ rate: null, source: null });
    await admin.post('/masters/standard-rates', { testId: t.body.id, rate: '500.00', effectiveFrom: '2026-01-01' }).expect(201);
    await admin.post('/masters/standard-rates', { testId: t.body.id, rate: '600.00', effectiveFrom: '2026-07-01' }).expect(201);
    expect(await lookup('2026-06-30')).toMatchObject({ source: 'STANDARD_RATE' });
    expect(Number((await lookup('2026-06-30')).rate)).toBe(500);
    expect(Number((await lookup('2026-07-01')).rate)).toBe(600);
    await admin.post('/masters/customer-rates', { customerId: cust.body.id, testId: t.body.id, rate: '450', effectiveFrom: '2026-03-01', effectiveTo: '2026-03-31' }).expect(201);
    expect(await lookup('2026-03-15')).toMatchObject({ source: 'CUSTOMER_RATE' });
    expect(Number((await lookup('2026-03-15')).rate)).toBe(450);
    expect(await lookup('2026-04-01')).toMatchObject({ source: 'STANDARD_RATE' });
    await admin.post('/masters/standard-rates', { testId: t.body.id, rate: '-1', effectiveFrom: '2026-01-01' }).expect(400);
  });
});

describe('Excel', () => {
  const attach = (c: Client, url: string, buffer: Buffer) => {
    return c.post(url).attach('file', buffer, 'import.xlsx');
  };

  it('imports new and existing rows', async () => {
    const buffer = await workbook([['Code', 'Name', 'Symbol'], ['KG', 'Kilogram', 'kg'], ['G', 'Gram', 'g']]);
    const res = await attach(admin, '/masters/units/import', buffer).expect(200);
    expect(res.body).toEqual({ created: 2, updated: 0, errors: [] });
    const again = await attach(admin, '/masters/units/import', await workbook([['Code', 'Name', 'Symbol'], ['KG', 'Kilogram (SI)', 'kg']])).expect(200);
    expect(again.body).toEqual({ created: 0, updated: 1, errors: [] });
  });

  it('saves nothing when any row is invalid, and names the rows', async () => {
    const before = await ctx.prisma.unit.count();
    const res = await attach(admin, '/masters/units/import', await workbook([['Code', 'Name', 'Symbol'], ['OK1', 'Okay', 'ok'], ['BAD', '', '']])).expect(200);
    expect(res.body.created).toBe(0);
    expect(res.body.errors[0].row).toBe(3);
    expect(await ctx.prisma.unit.count()).toBe(before);
  });

  it('rejects a file that is not Excel', async () => {
    await attach(admin, '/masters/units/import', Buffer.from('not excel')).expect(400);
  });

  it('exports through a background job, gated by permission', async () => {
    await tech.post('/documents', { kind: 'master-export:units' }).expect(403);
    await admin.post('/documents', { kind: 'nope' }).expect(400);
    const job = await admin.post('/documents', { kind: 'master-export:units' }).expect(201);
    expect(job.body.status).toBe('QUEUED');
    await ctx.app.get(DocumentsService).process(job.body.id);
    const done = await admin.get(`/documents/${job.body.id}`).expect(200);
    expect(done.body.status).toBe('DONE');
    expect(done.body.url).toContain('X-Amz-Signature');
    await sales.get(`/documents/${job.body.id}`).expect(403);
  });

  it('neutralises spreadsheet formula injection on export', async () => {
    const { buildWorkbook } = await import('../../src/modules/masters/excel.js');
    const buf = await buildWorkbook([{ name: 's', columns: [{ header: 'A', key: 'a' }], rows: [{ a: '=HYPERLINK("http://evil")' }] }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    expect(String(wb.worksheets[0].getRow(2).getCell(1).value).startsWith("'=")).toBe(true);
  });
});

describe('customers', () => {
  const base = { name: 'Acme Industries', stateName: 'Maharashtra', stateCode: '27' };

  it('auto numbers, stores contacts and addresses, audits', async () => {
    const c = await sales.post('/customers', {
      ...base,
      gstin: '27AAAAA0000A1Z2',
      creditDays: 45,
      contacts: [{ name: 'Priya', email: 'p@acme.example', isPrimary: true }],
      addresses: [{ kind: 'BILLING', line1: '1 Road', city: 'Pune', stateName: 'Maharashtra', stateCode: '27', pincode: '411001' }],
    }).expect(201);
    expect(c.body.crn).toMatch(/^CRN-\d{5}$/);
    expect(c.body.contacts).toHaveLength(1);
    const contactId = c.body.contacts[0].id;
    const updated = await sales.patch(`/customers/${c.body.id}`, { ...base, version: 1, contacts: [{ id: contactId, name: 'Priya S', isPrimary: true }, { name: 'Ravi' }] }).expect(200);
    expect(updated.body.contacts.map((x: { name: string }) => x.name).sort()).toEqual(['Priya S', 'Ravi']);
    const history = await sales.get(`/customers/${c.body.id}/history`).expect(200);
    expect(history.body).toHaveLength(2);
  });

  it.each([
    [{ gstin: '27AAAAA0000A1Z3' }, 'gstin'],
    [{ gstin: '29BBBBB1111B1ZJ' }, 'gstin'],
    [{ pan: 'BAD' }, 'pan'],
    [{ stateCode: 'XX' }, 'stateCode'],
  ])('rejects %j', async (patch, field) => {
    const res = await sales.post('/customers', { ...base, ...patch }).expect(400);
    expect(res.body.error.fields.map((f: { field: string }) => f.field)).toContain(field);
  });

  it('hides customers from technicians', async () => {
    await tech.get('/customers').expect(403);
  });

  it('uses the default credit days setting', async () => {
    const c = await sales.post('/customers', base).expect(201);
    expect(c.body.creditDays).toBe(30);
  });
});

describe('numbering', () => {
  it('never duplicates under concurrent creation', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => sales.post('/customers', { name: `Concurrent ${i}`, stateName: 'Maharashtra', stateCode: '27' })));
    const crns = results.map((r) => {
      expect(r.status).toBe(201);
      return r.body.crn as string;
    });
    expect(new Set(crns).size).toBe(25);
  });
});

describe('files', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

  it('checks real content type, ties access to the record, and signs URLs', async () => {
    const inst = await admin.post('/masters/instruments', { code: 'I1', name: 'Spectrometer' }).expect(201);
    const send = (c: Client, buf: Buffer, name: string) => c.post('/files').field('entity', 'Instrument').field('entityId', inst.body.id).field('category', 'certificate').attach('file', buf, name);
    await send(admin, Buffer.from('<script>alert(1)</script>'), 'x.png').expect(400);
    const ok = await send(admin, PNG, 'cert.png').expect(201);
    expect(ok.body.mimeType).toBe('image/png');
    await send(tech, PNG, 'cert.png').expect(403);
    await tech.get(`/files/${ok.body.id}/url`).expect(403);
    const url = await admin.get(`/files/${ok.body.id}/url`).expect(200);
    expect(url.body.url).toContain('X-Amz-Expires=300');
    expect((await admin.get(`/files?entity=Instrument&entityId=${inst.body.id}`).expect(200)).body).toHaveLength(1);
  });

  it('refuses files with no owning record', async () => {
    await admin.post('/files').field('category', 'x').attach('file', PNG, 'x.png').expect(403);
  });
});

describe('instruments', () => {
  it('flags overdue calibration', async () => {
    const i = await admin.post('/masters/instruments', { code: 'OLD', name: 'Old', lastCalibratedAt: '2020-01-01', calibrationDueAt: '2021-01-01' }).expect(201);
    expect(i.body.calibrationOverdue).toBe(true);
    await admin.post('/masters/instruments', { code: 'BAD', name: 'Bad', lastCalibratedAt: '2021-01-01', calibrationDueAt: '2020-01-01' }).expect(400);
  });
});
