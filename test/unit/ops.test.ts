import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadInfraConfig } from '../../src/config/infra.config.js';
import { httpDuration, measured } from '../../src/common/metrics.js';
import { StorageService } from '../../src/core/storage.service.js';
import { startOpsServer } from '../../src/ops/server.js';

const open: ReturnType<typeof startOpsServer>[] = [];
const start = async (probes: Parameters<typeof startOpsServer>[1]) => {
  const s = startOpsServer(0, probes);
  open.push(s);
  await new Promise((r) => (s.listening ? r(null) : s.once('listening', r)));
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return async (path: string, init?: RequestInit) => {
    const r = await fetch(base + path, init);
    return { status: r.status, text: await r.text() };
  };
};
afterEach(() => open.splice(0).forEach((s) => s.close()));

describe('the operations port', () => {
  it('says whether the process is alive, and separately whether it can work', async () => {
    const get = await start({ live: () => true, ready: () => Promise.reject(new Error('postgresql://user:secret@host')) });
    expect((await get('/live')).status).toBe(200);
    const ready = await get('/ready');
    expect(ready.status).toBe(503);
    expect(ready.text).not.toContain('secret');
    expect((await (await start({ live: () => false, ready: async () => 1 }))('/live')).status).toBe(503);
  });

  it('answers in time when what it depends on hangs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const get = await start({ live: () => true, ready: () => new Promise(() => undefined) });
    const answer = get('/ready');
    await new Promise((r) => setImmediate(r));
    await vi.waitFor(async () => {
      vi.advanceTimersByTime(5_000);
      expect((await Promise.race([answer, new Promise<null>((r) => setImmediate(() => r(null)))]))?.status).toBe(503);
    });
    vi.useRealTimers();
  });

  it('serves metrics to GET only, and nothing else', async () => {
    const get = await start({ live: () => true, ready: async () => 1 });
    httpDuration.observe({ method: 'GET', route: '/api/v1/customers/:id', status: '200' }, 0.02);
    measured('lims_test_gauge', 'x', [], async () => [{ value: 7 }]);
    measured('lims_test_broken', 'x', ['a'], () => Promise.reject(new Error('database down')));
    await get('/metrics');
    const m = await get('/metrics'); // a failure shows from the next reading on
    expect(m.status).toBe(200);
    expect(m.text).toContain('lims_metric_error{metric="lims_test_broken"} 1');
    expect(m.text).toContain('lims_http_request_duration_seconds_count{method="GET",route="/api/v1/customers/:id",status="200"} 1');
    expect(m.text).toContain('lims_test_gauge 7');
    expect(m.text).toContain('process_cpu_seconds_total');
    expect((await get('/metrics', { method: 'POST' })).status).toBe(405);
    expect((await get('/api/v1/customers')).status).toBe(404);
  });
});

describe('settings', () => {
  const base = { ...process.env };
  it('keeps the operations port apart from the public one', () => {
    expect(loadInfraConfig({ ...base, OPS_PORT: '' }).opsPort).toBe(9464);
    expect(loadInfraConfig({ ...base, OPS_PORT: '0' }).opsPort).toBeNull();
    expect(() => loadInfraConfig({ ...base, PORT: '3000', OPS_PORT: '3000' })).toThrow(/never public/);
    expect(() => loadInfraConfig({ ...base, OPS_PORT: 'x' })).toThrow(/OPS_PORT/);
  });
  it('takes both storage keys or neither', () => {
    expect(loadInfraConfig({ ...base, S3_ACCESS_KEY: '', S3_SECRET_KEY: '' }).s3.credentials).toBeNull();
    expect(loadInfraConfig({ ...base, S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 'b' }).s3.credentials).toEqual({ accessKeyId: 'a', secretAccessKey: 'b' });
    expect(() => loadInfraConfig({ ...base, S3_ACCESS_KEY: 'a', S3_SECRET_KEY: '' })).toThrow(/S3_SECRET_KEY/);
  });
});

describe('storage', () => {
  const service = () => new StorageService(loadInfraConfig({ ...process.env, S3_ACCESS_KEY: '', S3_SECRET_KEY: '' }), null as never);
  const s3 = (s: StorageService) => (s as unknown as { s3: { send: (c: object) => Promise<unknown>; config: { credentials: () => Promise<{ accessKeyId: string }> } } }).s3;

  it('uses the identity given to the machine when no keys are set', async () => {
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'from-the-machine');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'x');
    try {
      expect((await s3(service()).config.credentials()).accessKeyId).toBe('from-the-machine');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('makes a bucket only when there is none, and does not hide being refused', async () => {
    const s = service();
    const send = vi.spyOn(s3(s), 'send').mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { $metadata: { httpStatusCode: 403 } }));
    await expect(s.ensureBucket()).rejects.toThrow('Forbidden');
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRejectedValueOnce(Object.assign(new Error('NotFound'), { $metadata: { httpStatusCode: 404 } })).mockResolvedValueOnce({});
    await s.ensureBucket();
    expect(send.mock.calls.at(-1)![0].constructor.name).toBe('CreateBucketCommand');
  });
});
