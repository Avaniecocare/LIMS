import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeGstin, gstStateByName } from '../../src/common/india.js';
import { LookupService } from '../../src/modules/lookup/lookup.service.js';
import { bootApp, createUser, login, resetDb, ROLE_NAMES, type Client, type Ctx } from '../support/harness.js';

/** File library, customer history and form auto-fill. */
let ctx: Ctx;
let admin: Client, docs: Client, sales: Client, tech: Client, accounts: Client;
let customerId: string;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const CSV = Buffer.from('test,price\nTensile,1000\n');

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx);
  await createUser(ctx, 'admin@ft.example', [ROLE_NAMES.admin]);
  await createUser(ctx, 'docs@ft.example', ['Document Controller']);
  await createUser(ctx, 'sales@ft.example', [ROLE_NAMES.sales]);
  await createUser(ctx, 'tech@ft.example', [ROLE_NAMES.tech]);
  await createUser(ctx, 'accounts@ft.example', [ROLE_NAMES.accounts]);
  [admin, docs, sales, tech, accounts] = await Promise.all(['admin', 'docs', 'sales', 'tech', 'accounts'].map((u) => login(ctx, `${u}@ft.example`)));
  customerId = (await admin.post('/customers', { name: 'History Co', stateName: 'Uttar Pradesh', stateCode: '09' }).expect(201)).body.id;
});
afterAll(() => ctx.app.close());

describe('file library', () => {
  it('a Document Controller files documents in folders; others need the permission', async () => {
    const sop = (await docs.post('/library/folders', { name: 'SOPs' }).expect(201)).body;
    await docs.post('/library/folders', { name: 'sops' }).expect(400); // same name, any case
    const sub = (await docs.post('/library/folders', { name: 'Mechanical', parentId: sop.id }).expect(201)).body;
    await docs.patch(`/library/folders/${sop.id}`, { name: 'SOPs', parentId: sub.id, version: sop.version }).expect(400); // not inside itself
    const up = (await docs.post('/library/files').field('folderId', sub.id).field('description', 'Tensile SOP rev 3').attach('file', PDF, 'Tensile SOP.pdf').expect(201)).body;
    await docs.post('/library/files').field('folderId', sub.id).attach('file', CSV, 'Rates.csv').expect(201);
    await docs.post('/library/files').attach('file', Buffer.from('MZ\x90\x00binary'), 'tool.exe').expect(400);
    const list = (await docs.get(`/library/files?folderId=${sub.id}`).expect(200)).body;
    expect(list.data.map((f: { originalName: string }) => f.originalName).sort()).toEqual(['Rates.csv', 'Tensile SOP.pdf']);
    expect(list.data.find((f: { id: string }) => f.id === up.id)).toMatchObject({ folderName: 'Mechanical', description: 'Tensile SOP rev 3', canEdit: true });
    await docs.del(`/library/folders/${sub.id}`).expect(400); // not empty
    await tech.get('/library/files').expect(403);
    await sales.post('/library/folders', { name: 'Mine' }).expect(403);
    const url = (await docs.get(`/library/files/${up.id}/url`).expect(200)).body;
    expect(url.url).toContain('X-Amz-Signature');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'file.download', entityId: up.id } })).toBe(1);
  });

  it('a file linked to a customer appears on that customer and only for people who may see customers', async () => {
    const f = (await docs.post('/library/files').field('entity', 'Customer').field('entityId', customerId).attach('file', PDF, 'PO 118.pdf').expect(201)).body;
    const forCustomer = (await admin.get(`/library/files?entity=Customer&entityId=${customerId}`).expect(200)).body;
    expect(forCustomer.data.map((x: { id: string }) => x.id)).toContain(f.id);
    expect(forCustomer.data[0].entityLabel).toContain('History Co');
    // System files (generated PDFs) can't be edited from the library.
    const generated = await ctx.prisma.fileObject.create({
      data: {
        storageKey: `generated/x/${Date.now()}`,
        originalName: 'Invoice.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'x',
        category: 'generated',
        entity: 'Customer',
        entityId: customerId,
      },
    });
    await docs.patch(`/library/files/${generated.id}`, { originalName: 'Renamed.pdf' }).expect(400);
    await docs.del(`/library/files/${generated.id}`).expect(400);
  });
});

describe('customer history', () => {
  it('summarises the customer and shows money only to people with invoice access', async () => {
    const asAccounts = (await accounts.get(`/customers/${customerId}/summary`).expect(200)).body;
    expect(asAccounts).toMatchObject({ jobs: { total: 0 }, samples: 0, tests: { booked: 0 }, reportsIssued: 0 });
    expect(asAccounts.money).toMatchObject({ invoiced: '0.00', outstanding: '0.00' });
    const asSales = (await sales.get(`/customers/${customerId}/summary`).expect(200)).body;
    expect(asSales.money).toBeNull();
    expect(asSales.quotations).toMatchObject({ total: 0 });
    await tech.get(`/customers/${customerId}/summary`).expect(403);
    expect((await sales.get(`/customers/${customerId}/tests`).expect(200)).body).toMatchObject({ data: [], meta: { total: 0 } });
  });
});

describe('form auto-fill', () => {
  it('decodes state and PAN from a GSTIN', async () => {
    expect(decodeGstin('09aagcg1234k1zl')).toEqual({ valid: true, stateCode: '09', stateName: 'Uttar Pradesh', pan: 'AAGCG1234K' });
    expect(decodeGstin('09AAGCG1234K1Z5').valid).toBe(false);
    expect(gstStateByName('NCT of Delhi')?.code).toBe('07');
    const res = (await sales.get('/lookup/gstin/06AABCB5678M1Z9').expect(200)).body;
    expect(res).toMatchObject({ valid: true, stateCode: '06', stateName: 'Haryana' });
    await tech.get('/lookup/gstin/06AABCB5678M1Z9').expect(403);
  });

  it('fills city, state and GST code from a PIN code, and degrades quietly when the service is down', async () => {
    const service = ctx.app.get(LookupService);
    await ctx.app.get((await import('../../src/core/redis.service.js')).RedisService).client.del('pincode:v2:201306', 'pincode:v2:110001');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            Status: 'Success',
            PostOffice: [
              { Name: 'Bisrakh', District: 'Gautam Buddha Nagar', State: 'Uttar Pradesh' },
              { Name: 'Greater Noida', District: 'Gautam Buddha Nagar', State: 'Uttar Pradesh' },
            ],
          },
        ]),
        { status: 200 },
      ),
    );
    expect(await service.pincode('201306')).toEqual({
      pincode: '201306',
      found: true,
      city: 'Gautam Buddha Nagar',
      district: 'Gautam Buddha Nagar',
      stateName: 'Uttar Pradesh',
      stateCode: '09',
      localities: ['Bisrakh', 'Greater Noida'],
      match: 'exact',
      nearbyPincode: null,
    });
    // Service down: no neighbour calls, just the state from the PIN's first digits.
    fetchMock.mockRejectedValue(new Error('network down'));
    const calls = fetchMock.mock.calls.length;
    expect(await service.pincode('110001')).toMatchObject({ found: true, match: 'region', stateName: 'Delhi', stateCode: '07', city: null });
    expect(fetchMock.mock.calls.length - calls).toBe(1);
    fetchMock.mockRestore();
    await sales.get('/lookup/pincode/012345').expect(400);
  });

  it('a PIN code India Post does not list yet is filled from the nearest listed one in the same district', async () => {
    const service = ctx.app.get(LookupService);
    const redis = ctx.app.get((await import('../../src/core/redis.service.js')).RedisService).client;
    const keys = await redis.keys('pincode:v2:2013*');
    if (keys.length) await redis.del(...keys);
    const none = () => new Response(JSON.stringify([{ Message: 'No records found', Status: 'Error', PostOffice: null }]), { status: 200 });
    const asked: string[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const pin = String(url).slice(-6);
      asked.push(pin);
      if (pin === '201314') return new Response(JSON.stringify([{ Status: 'Success', PostOffice: [{ Name: 'Chhaisa', District: 'Gautam Buddha Nagar', State: 'Uttar Pradesh' }] }]), { status: 200 });
      return none();
    });
    expect(await service.pincode('201318')).toEqual({
      pincode: '201318',
      found: true,
      city: 'Gautam Buddha Nagar',
      district: 'Gautam Buddha Nagar',
      stateName: 'Uttar Pradesh',
      stateCode: '09',
      localities: [],
      match: 'nearby',
      nearbyPincode: '201314',
    });
    // Closest first: 201319, 201317, 201320, 201316 before 201314.
    expect(asked.slice(0, 5)).toEqual(['201318', '201319', '201317', '201320', '201316']);
    // And with nothing listed nearby at all, the state still comes from the first digits.
    fetchMock.mockImplementation(async () => none());
    expect(await service.pincode('263999')).toMatchObject({ found: true, match: 'region', stateName: 'Uttarakhand', city: null });
    fetchMock.mockRestore();
  });
});
