import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultCompany, validateProfile } from '../../src/config/company.config.js';
import { AuditService } from '../../src/core/audit.service.js';
import { CompanyService } from '../../src/core/company.service.js';
import { PrismaService } from '../../src/core/prisma.service.js';
import { RedisService } from '../../src/core/redis.service.js';
import { StorageService } from '../../src/core/storage.service.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';

/** The lab profile and branding live in the database, edited by the admin, and apply everywhere without a restart. */
let ctx: Ctx;
let admin: Client, tech: Client;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
/** The editable branding fields (the stored picture ids are set by upload, not sent). */
const editable = (b: Record<string, unknown>) => ({
  appName: b.appName,
  primaryColor: b.primaryColor,
  accentColor: b.accentColor,
  surfaceColor: b.surfaceColor,
  navColor: b.navColor,
  loginTagline: b.loginTagline,
  poweredBy: b.poweredBy,
});
const publicBranding = async () => (await ctx.http().get('/api/v1/public/branding').expect(200)).body;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  await createUser(ctx, 'admin@lab.example', [ROLE_NAMES.admin], 'Lab Admin');
  await createUser(ctx, 'tech@lab.example', [ROLE_NAMES.tech]);
  [admin, tech] = await Promise.all([login(ctx, 'admin@lab.example'), login(ctx, 'tech@lab.example')]);
});
afterAll(() => ctx.app.close());

describe('lab profile and branding', () => {
  it('starts from the install it imported, and only admins can see or change it', async () => {
    const lab = (await admin.get('/admin/lab').expect(200)).body;
    expect(lab.profile).toMatchObject({ companyName: 'BluePeak Testing Labs', gstin: '27AAAAA0000A1Z2' });
    await tech.get('/admin/lab').expect(403);
    await tech.put('/admin/lab/branding', { version: lab.brandingVersion, branding: { ...editable(lab.branding), primaryColor: '#000000' } }).expect(403);
  });

  it('a colour or name change shows on every screen at once, with no restart', async () => {
    const lab = (await admin.get('/admin/lab').expect(200)).body;
    const branding = {
      appName: 'Greenfield Lab Suite',
      primaryColor: '#14532d',
      accentColor: '#166534',
      surfaceColor: '#f0fdf4',
      navColor: '#052e16',
      loginTagline: 'Testing you can trust',
      poweredBy: false,
    };
    await admin.put('/admin/lab/branding', { version: lab.brandingVersion, branding }).expect(200);
    expect(await publicBranding()).toMatchObject({ productName: 'Greenfield Lab Suite', primaryColor: '#14532d', navColor: '#052e16', loginTagline: 'Testing you can trust', poweredBy: false });
    // Saving over someone else's change is refused rather than silently lost.
    await admin.put('/admin/lab/branding', { version: lab.brandingVersion, branding: { ...branding, primaryColor: '#7f1d1d' } }).expect(409);
    await admin.put('/admin/lab/branding', { version: lab.brandingVersion + 1, branding: { ...branding, primaryColor: 'red' } }).expect(400);
  });

  it('uploads a logo and sign-in picture, refuses anything that is not a picture, and falls back to initials', async () => {
    let lab = (await admin.get('/admin/lab').expect(200)).body;
    lab = (await admin.post('/admin/lab/branding/logo').field('version', String(lab.brandingVersion)).attach('file', PNG, 'logo.png').expect(201)).body;
    const b = await publicBranding();
    const logo = await ctx.http().get(new URL(b.logoUrl).pathname).expect(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(Buffer.from(logo.body).equals(PNG)).toBe(true);
    await admin.post('/admin/lab/branding/logo').field('version', String(lab.brandingVersion)).attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'logo.pdf').expect(400);
    await admin.post('/admin/lab/branding/banner').field('version', String(lab.brandingVersion)).attach('file', PNG, 'x.png').expect(400);
    lab = (await admin.post('/admin/lab/branding/login').field('version', String(lab.brandingVersion)).attach('file', PNG, 'lab.png').expect(201)).body;
    expect((await publicBranding()).loginImageUrl).toContain('/public/branding/login');
    // Removed: the logo becomes the lab's initials, never a broken image.
    lab = (await admin.del(`/admin/lab/branding/logo?version=${lab.brandingVersion}`).expect(200)).body;
    const initials = await ctx.http().get('/api/v1/public/branding/logo').expect(200);
    expect(initials.headers['content-type']).toContain('image/svg+xml');
    expect(String(initials.body)).toContain('BT');
  });

  it('profile changes need the password confirmed, are checked, and apply to new documents at once', async () => {
    const fresh = await login(ctx, 'admin@lab.example', undefined, { reauth: false });
    const lab = (await admin.get('/admin/lab').expect(200)).body;
    const profile = { ...lab.profile, companyName: 'Greenfield Testing Services', bank: { ...lab.profile.bank, accountNumber: '111122223333' } };
    expect((await fresh.put('/admin/lab/profile', { version: lab.profileVersion, profile }).expect(403)).body.error.code).toBe('REAUTH_REQUIRED');
    const bad = await admin.put('/admin/lab/profile', { version: lab.profileVersion, profile: { ...profile, gstin: '27AAAAA0000A1Z9', pan: 'ABCDE1234F' } }).expect(400);
    expect(bad.body.error.fields.map((f: { field: string }) => f.field)).toEqual(expect.arrayContaining(['gstin']));
    await admin.put('/admin/lab/profile', { version: lab.profileVersion, profile }).expect(200);
    expect((await publicBranding()).companyName).toBe('Greenfield Testing Services');
    expect(ctx.app.get(CompanyService).snapshot()).toMatchObject({ companyName: 'Greenfield Testing Services', bank: { accountNumber: '111122223333' } });
    // Recorded, with what it was before.
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'company.profile.update' }, orderBy: { at: 'desc' } });
    expect(audit?.userName).toBe('Lab Admin');
  });

  it('another process (the worker) picks up a change by itself', async () => {
    const other = new CompanyService(ctx.app.get(PrismaService), ctx.app.get(StorageService), ctx.app.get(RedisService), ctx.app.get(AuditService));
    await other.onModuleInit();
    const lab = (await admin.get('/admin/lab').expect(200)).body;
    await admin.put('/admin/lab/branding', { version: lab.brandingVersion, branding: { ...editable(lab.branding), accentColor: '#0e7490' } }).expect(200);
    await expect.poll(() => other.config.branding.accentColor, { timeout: 5000 }).toBe('#0e7490');
    await other.onModuleDestroy();
  });

  it('an upgrade or restart never overwrites what the admin saved', async () => {
    const service = ctx.app.get(CompanyService);
    const before = service.config.companyName;
    await (service as unknown as { seed: () => Promise<void> }).seed();
    await service.reload();
    expect(service.config.companyName).toBe(before);
  });
});

describe('setup wizard', () => {
  it('offers lab-type templates built from public standards, without prices', async () => {
    const list = (await admin.get('/admin/lab/templates').expect(200)).body as { id: string; tests: number; specifications: string[] }[];
    expect(list.map((t) => t.id)).toEqual(['water', 'air', 'soil', 'noise', 'materials']);
    expect(list.find((t) => t.id === 'water')).toMatchObject({ tests: 59 });
    expect(list.find((t) => t.id === 'water')!.specifications.join(' ')).toContain('IS 10500');
  });

  it("applying a template only adds, so applying again changes nothing and keeps the lab's own edits", async () => {
    await tech.post('/admin/lab/templates/apply', { templates: ['noise'] }).expect(403);
    await admin.post('/admin/lab/templates/apply', { templates: ['nothing-like-this'] }).expect(400);
    const firstRes = await admin.post('/admin/lab/templates/apply', { templates: ['water', 'noise'] });
    expect(firstRes.status, JSON.stringify(firstRes.body)).toBe(200);
    const first = firstRes.body;
    expect(first.created).toMatchObject({ tests: 61, 'test-methods': expect.any(Number), specifications: 7 });
    expect(first.created['test-parameters']).toBeGreaterThanOrEqual(61);
    // No prices and nothing accredited: the lab sets both.
    expect(await ctx.prisma.standardRate.count()).toBe(0);
    expect(await ctx.prisma.testMaster.count({ where: { accredited: true } })).toBe(0);
    // The lab renames a test; applying again adds nothing and leaves the rename alone.
    await ctx.prisma.testMaster.update({ where: { code: 'WTR-PH' }, data: { name: 'pH (our wording)' } });
    const again = (await admin.post('/admin/lab/templates/apply', { templates: ['water'] }).expect(200)).body;
    expect(again.created).toEqual({});
    expect(again.skipped).toBeGreaterThan(0);
    expect((await ctx.prisma.testMaster.findUniqueOrThrow({ where: { code: 'WTR-PH' } })).name).toBe('pH (our wording)');
    // A limit from IS 10500 came with it, linked to the right parameter.
    const spec = await ctx.prisma.specification.findFirstOrThrow({ where: { code: 'IS10500-ACC' }, include: { limits: true } });
    expect(spec.limits.length).toBeGreaterThan(20);
  });

  it('tracks the steps, sends a test email at once, and finishes', async () => {
    // As on a fresh install (the test environment imports an older install, which counts as set up).
    await ctx.prisma.setting.deleteMany({ where: { key: { in: ['setup.labCompleted', 'setup.emailTested'] } } });
    const status = (await admin.get('/admin/lab/setup').expect(200)).body;
    expect(status).toMatchObject({ completed: false, steps: { catalogue: true, team: true, email: false } });
    await admin.post('/admin/lab/setup/test-email', { to: 'me@lab.example' }).expect(200);
    await admin.post('/admin/lab/setup/test-email', { to: 'not an email' }).expect(400);
    expect((await admin.get('/admin/lab/setup').expect(200)).body.steps.email).toBe(true);
    await admin.post('/admin/lab/setup/complete').expect(200);
    await admin.post('/admin/lab/setup/complete').expect(200);
    expect((await admin.get('/admin/lab/setup').expect(200)).body.completed).toBe(true);
    await tech.get('/admin/lab/setup').expect(403);
  });
});

describe('email templates', () => {
  it('the lab edits a template, previews it in its branded layout, and customers get the new wording', async () => {
    let list = (await admin.get('/admin/lab/email-templates').expect(200)).body;
    expect(list.templates.map((t: { key: string }) => t.key)).toEqual(['acknowledgement', 'quotation', 'report', 'invoice', 'reminder', 'password-reset']);
    const subject = 'We have your samples: {{jobNo}}';
    const body = 'Namaste {{contactName}},\n\nYour samples for job **{{jobNo}}** reached {{labName}} today.{{#photoText}} Photos attached.{{/photoText}}';
    // Unknown names are caught before saving.
    const bad = await admin.put('/admin/lab/email-templates/acknowledgement', { version: list.version, subject, body: `${body} {{invoiceNo}}` }).expect(400);
    expect(bad.body.error.fields[0].message).toContain('{{invoiceNo}}');
    const preview = (await admin.post('/admin/lab/email-templates/acknowledgement/preview', { subject, body }).expect(200)).body;
    expect(preview.subject).toMatch(/^We have your samples: /);
    expect(preview.html).toContain('<strong>');
    expect(preview.html).toContain('<!doctype html>');
    await tech.put('/admin/lab/email-templates/acknowledgement', { version: list.version, subject, body }).expect(403);
    list = (await admin.put('/admin/lab/email-templates/acknowledgement', { version: list.version, subject, body }).expect(200)).body;
    expect(list.templates[0]).toMatchObject({ customized: true, subject });

    const { EmailTemplateService } = await import('../../src/core/email-template.service.js');
    const sent = await ctx.app.get(EmailTemplateService).render('acknowledgement', { jobNo: 'J/1', contactName: 'Rohan', labName: 'Our Lab', photoText: null });
    expect(sent).toEqual({ subject: 'We have your samples: J/1', bodyHtml: '<p>Namaste Rohan,</p><p>Your samples for job <strong>J/1</strong> reached Our Lab today.</p>' });

    // Back to the product's wording.
    list = (await admin.del(`/admin/lab/email-templates/acknowledgement?version=${list.version}`).expect(200)).body;
    expect(list.templates[0].customized).toBe(false);
    expect((await ctx.app.get(EmailTemplateService).render('acknowledgement', { jobNo: 'J/1' })).subject).toContain('Samples received: J/1');
    await admin.put('/admin/lab/email-templates/nonsense', { version: list.version, subject, body }).expect(400);
  });
});

describe('modules', () => {
  it('a module turned off disappears from the session, its pages and exports are refused, and turning it on brings it back', async () => {
    let list = (await admin.get('/admin/lab/modules').expect(200)).body;
    expect(list.modules.map((m: { key: string; enabled: boolean }) => [m.key, m.enabled])).toEqual([
      ['quotations', true],
      ['dispatch', true],
      ['billing', true],
      ['files', true],
      ['phoneUpload', true],
      ['analytics', true],
      ['quality', true],
      ['whatsapp', true],
      // Off until an administrator turns it on, even though the test server is set up for it.
      ['einvoice', false],
    ]);
    await tech.put('/admin/lab/modules', { version: list.version, enabled: { billing: false } }).expect(403);
    await admin.put('/admin/lab/modules', { version: list.version, enabled: { warp: false } }).expect(400);
    list = (await admin.put('/admin/lab/modules', { version: list.version, enabled: { billing: false, phoneUpload: false } }).expect(200)).body;
    try {
      expect((await admin.get('/auth/me').expect(200)).body.modules).toEqual(['quotations', 'dispatch', 'files', 'analytics', 'quality', 'whatsapp']);
      const off = await admin.get('/invoices').expect(403);
      expect(off.body.error).toMatchObject({ code: 'MODULE_OFF' });
      expect(off.body.error.message).toContain('Billing is turned off');
      expect((await admin.post('/documents', { kind: 'due-invoices-export', params: {} })).body.error.code).toBe('MODULE_OFF');
      // Even a public phone link is closed while its module is off.
      await ctx.http().get('/api/v1/public/phone-uploads/some-token-that-is-long-enough-to-check-xxxxxxx').expect(403);
      // The rest of the product carries on.
      await admin.get('/customers').expect(200);
    } finally {
      list = (await admin.put('/admin/lab/modules', { version: list.version, enabled: { billing: true, phoneUpload: true } }).expect(200)).body;
    }
    await admin.get('/invoices').expect(200);
    expect((await admin.get('/auth/me').expect(200)).body.modules).toHaveLength(8);
  });
});

describe('a fresh install', () => {
  it('starts from BRAND_NAME with neutral defaults, to be completed in the setup wizard', () => {
    const { profile, branding } = defaultCompany({ BRAND_NAME: 'Shree Analytical Labs' });
    expect(profile).toMatchObject({ companyName: 'Shree Analytical Labs', documentPrefix: 'SAL', gstin: '', sacCode: '998346' });
    expect(branding).toMatchObject({ appName: null, poweredBy: true, logoFileId: null });
    // An unfinished profile is still a valid one: the lab can complete it later.
    expect(validateProfile(profile)).toEqual([]);
    expect(defaultCompany({}).profile.companyName).toBe('LIMS');
  });
});
