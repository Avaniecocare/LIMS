import { afterAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { createApp } from '../../src/bootstrap.js';
import { MailService } from '../../src/core/mail.service.js';
import { PrismaService } from '../../src/core/prisma.service.js';
import { QuotationsService } from '../../src/modules/quotations/quotations.service.js';
import { bluepeak, greenfield } from '../support/company-env.js';
import { createUser, login, resetDb, ROLE_NAMES } from '../support/harness.js';

/** Same code, two env files. Each must show only its own company, in API, email and documents. */
const companies = [
  { env: bluepeak, own: ['BluePeak LIMS', 'BluePeak Testing Labs', '27AAAAA0000A1Z2', 'lab@bluepeak.example'], other: ['Greenfield', '29BBBBB1111B1ZJ', 'greenfield.example'] },
  { env: greenfield, own: ['Greenfield Lab Manager', 'Greenfield Analytical', '29BBBBB1111B1ZJ', 'hello@greenfield.example'], other: ['BluePeak', '27AAAAA0000A1Z2', 'bluepeak.example'] },
];

afterAll(() => {
  Object.assign(process.env, bluepeak);
});

describe.each(companies)('white label: $env.COMPANY_NAME', ({ env, own, other }) => {
  let app: NestFastifyApplication;
  afterAll(() => app.close());

  it('shows only its own details in branding, emails and documents', async () => {
    Object.assign(process.env, env);
    app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const prisma = app.get(PrismaService);
    const ctx = { app, prisma, http: () => request(app.getHttpServer()) };
    await resetDb(ctx);

    const branding = (await ctx.http().get('/api/v1/public/branding').expect(200)).body;
    expect(branding.productName).toBe(env.COMPANY_PRODUCT_NAME);
    expect(branding.primaryColor).toBe(env.COMPANY_PRIMARY_COLOR);
    for (const o of other) expect(JSON.stringify(branding)).not.toContain(o);

    await createUser(ctx, 'wl@x.example', [ROLE_NAMES.admin]);
    const a = await login(ctx, 'wl@x.example');
    const company = JSON.stringify((await a.get('/admin/company').expect(200)).body);
    for (const o of own.slice(1)) expect(company).toContain(o);
    for (const o of other) expect(company).not.toContain(o);

    const test = (await a.post('/masters/tests', { code: 'T', name: 'Test' }).expect(201)).body;
    await a.post('/masters/standard-rates', { testId: test.id, rate: '100', effectiveFrom: '2020-01-01' }).expect(201);
    const cust = (await a.post('/customers', { name: 'Fictional Buyer', stateName: 'Goa', stateCode: '30' }).expect(201)).body;
    const q = (await a.post('/quotations', { customerId: cust.id, lines: [{ sampleDescription: 's', testId: test.id, quantity: 1 }] }).expect(201)).body;
    expect(q.quotationNo.startsWith(`${env.COMPANY_DOCUMENT_PREFIX}/`)).toBe(true);
    const html = await app.get(QuotationsService).preview(q.versions[0].id);
    for (const o of own.slice(1)) expect(html).toContain(o);
    for (const o of other) expect(html).not.toContain(o);

    const mail = app.get(MailService);
    const id = await mail.enqueue({ to: 'x@y.example', subject: 'Hello', bodyHtml: '<p>Hi</p>', template: 'test' });
    await mail.deliver(id);
    const sent = mail.adapter.sent.at(-1)!;
    expect(sent.from).toContain(env.COMPANY_NAME);
    for (const o of other) expect(sent.html).not.toContain(o);
    expect(sent.html).toContain(env.COMPANY_LEGAL_NAME);
  });
});

describe('no company data in the product', () => {
  it('source code and templates carry no fictional or real company values', async () => {
    const { execSync } = await import('node:child_process');
    // Fixtures, demo seeds and env examples are the only places a company may appear.
    const out = execSync(`grep -rlE "BluePeak|Greenfield|27AAAAA0000A1Z2|29BBBBB1111B1ZJ" src || true`).toString().trim();
    expect(out).toBe('');
  });
});
