import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QualityService, addMonths, dueStatus } from '../../src/modules/quality/quality.service.js';
import { billingFixture } from '../support/fixtures.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';

/** Quality management (ISO/IEC 17025) and the DPDP privacy registers. */
let ctx: Ctx;
let admin: Client, reception: Client, planner: Client, tech: Client, qm: Client;
let fx: Awaited<ReturnType<typeof billingFixture>>;
const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  for (const [e, r] of Object.entries({ admin: ROLE_NAMES.admin, reception: ROLE_NAMES.reception, planner: ROLE_NAMES.planner, tech: ROLE_NAMES.tech, hod: ROLE_NAMES.hod })) await createUser(ctx, `${e}@q.example`, [r], `${e} person`);
  await createUser(ctx, 'qm@q.example', ['Quality Manager'], 'Quinn Quality');
  [admin, reception, planner, tech, qm] = await Promise.all(['admin', 'reception', 'planner', 'tech', 'qm'].map((e) => login(ctx, `${e}@q.example`)));
  fx = await billingFixture(admin, ctx);
  await admin.post('/masters/test-parameters', { testId: fx.tests.d, code: 'DENSITY', name: 'Density', decimals: 3 }).expect(201);
  await admin.post('/masters/test-parameters', { testId: fx.tests.a, code: 'APPEAR', name: 'Appearance', kind: 'TEXT' }).expect(201);
});
afterAll(() => ctx.app.close());

describe('dates', () => {
  it('adds months without spilling into the next month, and ranks what is due', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths(new Date('2026-03-15T00:00:00Z'), 12).toISOString().slice(0, 10)).toBe('2027-03-15');
    const t = new Date('2026-06-01T00:00:00Z');
    expect(dueStatus([new Date('2026-05-31T00:00:00Z')], t, 15)).toBe('OVERDUE');
    expect(dueStatus([new Date('2026-06-10T00:00:00Z'), null], t, 15)).toBe('DUE_SOON');
    expect(dueStatus([new Date('2026-09-01T00:00:00Z')], t, 15)).toBe('OK');
    expect(dueStatus([null, null], t, 15)).toBe('NOT_SCHEDULED');
  });
});

describe('equipment', () => {
  it('a calibration moves the due date by the interval; a failed one puts the instrument out of use; admins are reminded', async () => {
    const inst = (await admin.post('/masters/instruments', { code: 'UTM-1', name: 'Universal testing machine' }).expect(201)).body;
    const row = async () => (await qm.get('/quality/equipment').expect(200)).body.find((e: { id: string }) => e.id === inst.id);
    expect((await row()).status).toBe('NOT_SCHEDULED');
    await qm.patch(`/quality/equipment/${inst.id}/schedule`, { version: (await row()).version, calibrationIntervalMonths: 12, maintenanceIntervalMonths: 6, maintenanceDueAt: daysFromNow(5) }).expect(200);
    expect((await row()).status).toBe('DUE_SOON');
    await tech.post(`/quality/equipment/${inst.id}/events`, { kind: 'CALIBRATION', performedOn: today(), performedBy: 'NABL-accredited agency', outcome: 'PASS' }).expect(403);
    await qm.post(`/quality/equipment/${inst.id}/events`, { kind: 'CALIBRATION', performedOn: daysFromNow(2), performedBy: 'x', outcome: 'PASS' }).expect(400);
    await qm.post(`/quality/equipment/${inst.id}/events`, { kind: 'CALIBRATION', performedOn: today(), performedBy: 'Calibration agency', outcome: 'PASS', certificateNo: 'CC/2026/118' }).expect(201);
    await qm.post(`/quality/equipment/${inst.id}/events`, { kind: 'MAINTENANCE', performedOn: today(), performedBy: 'Service engineer', outcome: 'PASS' }).expect(201);
    const after = await row();
    expect(String(after.calibrationDueAt).slice(0, 4)).toBe(String(new Date().getUTCFullYear() + 1));
    expect(after.status).toBe('OK');
    expect((await qm.get(`/quality/equipment/${inst.id}/events`).expect(200)).body).toHaveLength(2);

    // Failed calibration: due today, so planners can no longer pick it if overdue instruments are blocked.
    await qm.post(`/quality/equipment/${inst.id}/events`, { kind: 'CALIBRATION', performedOn: today(), performedBy: 'Calibration agency', outcome: 'FAIL', notes: 'Load cell out of tolerance' }).expect(201);
    expect(String((await row()).calibrationDueAt).slice(0, 10)).toBe(today());

    await admin.post('/masters/instruments', { code: 'OVEN-1', name: 'Drying oven', lastCalibratedAt: daysFromNow(-400), calibrationDueAt: daysFromNow(-10) }).expect(201);
    const sent = await ctx.app.get(QualityService).equipmentReminders();
    expect(sent).toBeGreaterThanOrEqual(1);
    const notes = (await admin.get('/notifications').expect(200)).body.data.filter((n: { type: string }) => n.type === 'EQUIPMENT_DUE');
    expect(notes[0].title).toMatch(/overdue/);
    // Once a day only.
    await ctx.app.get(QualityService).equipmentReminders();
    expect((await admin.get('/notifications').expect(200)).body.data.filter((n: { type: string }) => n.type === 'EQUIPMENT_DUE')).toHaveLength(notes.length);
  });
});

describe('competency', () => {
  it('authorises an analyst for a test, refuses a duplicate, withdraws it, and can make planners respect it', async () => {
    const techUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'tech@q.example' } });
    await tech.post('/quality/authorisations', { userId: techUser.id, testId: fx.tests.d, authorisedOn: today() }).expect(403);
    await qm.post('/quality/authorisations', { userId: techUser.id, testId: fx.tests.d, authorisedOn: today(), validUntil: daysFromNow(365), evidence: 'Five supervised trials within limits' }).expect(201);
    await qm.post('/quality/authorisations', { userId: techUser.id, testId: fx.tests.d, authorisedOn: today() }).expect(422);
    const list = (await qm.get(`/quality/authorisations?userId=${techUser.id}`).expect(200)).body;
    expect(list[0]).toMatchObject({ userName: 'tech person', state: 'ACTIVE', authorisedByName: 'Quinn Quality' });
    expect((await planner.get(`/quality/authorisations/check?userId=${techUser.id}&testIds=${fx.tests.d},${fx.tests.a}`).expect(200)).body).toEqual({ missing: [fx.tests.a], enforced: false });

    // Enforced: assigning a test the analyst is not authorised for is refused, an authorised one goes through.
    await admin.put('/admin/settings/controls.requireAuthorisation', { value: true, version: 0, reason: 'NABL surveillance finding' }).expect(200);
    try {
      const job = (await reception.post('/jobs', { customerId: fx.intra.id, noQuotationReason: 'Repeat', samples: [{ description: 'Plate' }] }).expect(201)).body;
      const planRes = await planner.post('/planning/plans', { sampleIds: [job.samples[0].id], tests: [{ testId: fx.tests.d }, { testId: fx.tests.a }] });
      expect(planRes.status, JSON.stringify(planRes.body)).toBe(201);
      const plan = planRes.body;
      const [d, a] = plan.sampleTestIds as string[];
      const refused = await planner.post('/planning/assign', { sampleTestIds: [a], assignedToId: techUser.id }).expect(422);
      expect(refused.body.error.code).toBe('NOT_AUTHORISED');
      await planner.post('/planning/assign', { sampleTestIds: [d], assignedToId: techUser.id }).expect(200);
    } finally {
      await admin.put('/admin/settings/controls.requireAuthorisation', { value: false, version: 1, reason: 'Back to warnings' }).expect(200);
    }
    await qm.post(`/quality/authorisations/${list[0].id}/withdraw`, { reason: 'Left the chemistry section' }).expect(200);
    expect((await qm.get(`/quality/authorisations?userId=${techUser.id}`).expect(200)).body[0].state).toBe('WITHDRAWN');
    await qm.post('/quality/training', { userId: techUser.id, title: 'ISO/IEC 17025:2017 awareness', trainedOn: today(), trainer: 'Quality Manager', hours: 4 }).expect(201);
    expect((await qm.get(`/quality/training?userId=${techUser.id}`).expect(200)).body[0]).toMatchObject({ title: 'ISO/IEC 17025:2017 awareness', hours: '4' });
  });
});

describe('non-conformance and CAPA', () => {
  it('anyone can raise one; each step needs what it should; the owner cannot verify their own action', async () => {
    const qmUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'qm@q.example' } });
    const adminUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'admin@q.example' } });
    let nc = (await tech.post('/quality/nc', { source: 'Routine work', title: 'Wrong buffer used for pH calibration', description: 'pH 7 buffer past expiry', severity: 'MAJOR', reference: 'LAB/S/26-27/000045', ownerId: qmUser.id, dueOn: daysFromNow(14) }).expect(201)).body;
    expect(nc.ncNo).toMatch(/\/NC\/\d{2}-\d{2}\/0001$/);
    expect(nc).toMatchObject({ status: 'OPEN', ownerName: 'Quinn Quality', createdByName: 'tech person' });
    // The analyst can follow what they reported, but not open the register.
    expect((await tech.get('/quality/nc/mine').expect(200)).body.map((x: { id: string }) => x.id)).toEqual([nc.id]);
    await tech.get('/quality/nc').expect(403);
    expect((await qm.get('/quality/nc/mine').expect(200)).body).toEqual([]);
    await tech.patch(`/quality/nc/${nc.id}`, { version: nc.version, status: 'ACTION' }).expect(403);
    expect((await qm.patch(`/quality/nc/${nc.id}`, { version: nc.version, status: 'ACTION' }).expect(422)).body.error.message).toContain('correction or the root cause');
    nc = (await qm.patch(`/quality/nc/${nc.id}`, { version: nc.version, status: 'ACTION', correction: 'Buffers replaced, meter recalibrated', rootCause: 'No expiry check before use' }).expect(200)).body;
    await qm.patch(`/quality/nc/${nc.id}`, { version: nc.version, status: 'CLOSED' }).expect(422);
    nc = (await qm.patch(`/quality/nc/${nc.id}`, { version: nc.version, status: 'VERIFICATION', correctiveAction: 'Expiry check added to the daily calibration log' }).expect(200)).body;
    expect((await qm.patch(`/quality/nc/${nc.id}`, { version: nc.version, status: 'CLOSED', verification: 'Log reviewed for 4 weeks' }).expect(422)).body.error.code).toBe('SELF_VERIFY');
    // Someone else verifies.
    await ctx.prisma.nonConformance.update({ where: { id: nc.id }, data: { ownerId: adminUser.id, ownerName: 'admin person' } });
    nc = (await qm.patch(`/quality/nc/${nc.id}`, { version: nc.version, status: 'CLOSED', verification: 'Log reviewed for 4 weeks' }).expect(200)).body;
    expect(nc).toMatchObject({ status: 'CLOSED', verifiedByName: 'Quinn Quality' });
    expect(nc.closedAt).toBeTruthy();
    await qm.patch(`/quality/nc/${nc.id}`, { version: nc.version - 1, status: 'ACTION' }).expect(409);
    const summary = (await qm.get('/quality/summary').expect(200)).body;
    expect(summary).toMatchObject({ ncOpen: 0, equipmentOverdue: expect.any(Number) });
  });

  it('is refused while the quality module is off', async () => {
    const list = (await admin.get('/admin/lab/modules').expect(200)).body;
    await admin.put('/admin/lab/modules', { version: list.version, enabled: { quality: false } }).expect(200);
    try {
      expect((await qm.get('/quality/equipment').expect(403)).body.error.code).toBe('MODULE_OFF');
    } finally {
      await admin.put('/admin/lab/modules', { version: list.version + 1, enabled: { quality: true } }).expect(200);
    }
  });
});

describe('privacy (DPDP Act)', () => {
  it("tracks a request to its deadline, finds the person's data, erases a contact, and keeps documents", async () => {
    const contact = await ctx.prisma.customerContact.create({ data: { customerId: fx.intra.id, name: 'Priya Contact', email: 'priya@customer.example', phone: '+91 90000 00000' } });
    await tech.get('/privacy/requests').expect(403);
    const req = (await admin.post('/privacy/requests', { kind: 'ERASURE', requesterName: 'Priya Contact', requesterEmail: 'Priya@Customer.example', details: 'Please delete my details; I have left the company.', receivedOn: today() }).expect(201)).body;
    expect(String(req.dueOn).slice(0, 10)).toBe(daysFromNow(30));
    const found = (await admin.get('/privacy/personal-data?email=priya@customer.example').expect(200)).body;
    expect(found.items).toEqual([expect.objectContaining({ place: 'Customer contact', erasable: true })]);
    // Erasing needs the password confirmed.
    const fresh = await login(ctx, 'admin@q.example', undefined, { reauth: false });
    expect((await fresh.post(`/privacy/requests/${req.id}/erase`).expect(403)).body.error.code).toBe('REAUTH_REQUIRED');
    expect((await admin.post(`/privacy/requests/${req.id}/erase`).expect(200)).body).toEqual({ contacts: 1 });
    expect(await ctx.prisma.customerContact.findUniqueOrThrow({ where: { id: contact.id } })).toMatchObject({ name: 'Erased on request', email: null, phone: null });
    const done = (await admin.post(`/privacy/requests/${req.id}/resolve`, { version: req.version, status: 'DONE', resolution: 'Contact details erased; issued documents kept as required by GST rules.' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'DONE', resolvedByName: 'admin person' });
    await admin.post(`/privacy/requests/${req.id}/resolve`, { version: done.version, status: 'DONE', resolution: 'again' }).expect(422);
  });

  it('logs a breach with the 72-hour reporting clock, and records when the Board and people were told', async () => {
    const detectedAt = new Date(Date.now() - 3_600_000).toISOString();
    const b = (await admin.post('/privacy/breaches', { detectedAt, description: 'A laptop with exported customer contacts was lost', dataAffected: 'Names, emails and phones of customer contacts', peopleAffected: 40 }).expect(201)).body;
    expect(new Date(b.boardReportDueAt).getTime() - new Date(detectedAt).getTime()).toBe(72 * 3_600_000);
    const updated = (await admin.patch(`/privacy/breaches/${b.id}`, { version: b.version, reportedToBoardAt: new Date().toISOString(), containment: 'Device wiped remotely' }).expect(200)).body;
    expect(updated.reportedToBoardAt).toBeTruthy();
    await admin.patch(`/privacy/breaches/${b.id}`, { version: b.version, closedAt: new Date().toISOString() }).expect(409);
  });
});
