#!/usr/bin/env node
// Measures list endpoints against the seeded volume. Requires a running API on that database:
//   DATABASE_URL=<load db> node load-test/run.mjs --seed     (once)
//   API_URL=http://localhost:3000 EMAIL=... PASSWORD=... node load-test/run.mjs
// Fails if any endpoint's p95 exceeds its budget.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const API = process.env.API_URL ?? 'http://localhost:3000';
const P95_BUDGET_MS = Number(process.env.P95_BUDGET_MS ?? 800);
const ROUNDS = Number(process.env.ROUNDS ?? 15);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

if (process.argv.includes('--seed')) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM "SampleTest"`);
  if (rows[0].n >= 500000) {
    console.log(`Already seeded: ${rows[0].n} tests.`);
  } else {
    console.log('Seeding 500,000 tests...');
    console.time('seed');
    const open = Number(process.env.OPEN_PERCENT ?? 4);
    await client.query(readFileSync(new URL('./seed.sql', import.meta.url), 'utf8').replaceAll('__OPEN__', String(open)));
    console.timeEnd('seed');
  }
  await client.end();
  process.exit(0);
}

const login = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD }) });
if (!login.ok) throw new Error(`Login failed: ${login.status}`);
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const get = async (path) => {
  const start = performance.now();
  const res = await fetch(`${API}/api/v1${path}`, { headers: { cookie } });
  const ms = performance.now() - start;
  const body = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${body.slice(0, 200)}`);
  return { ms, body };
};

const techId = process.env.TECH_ID ?? '00000000-0000-4000-8000-000000000001';
const ENDPOINTS = [
  '/planning/tests?view=assigned',
  '/planning/tests?view=assigned&page=5000&pageSize=25',
  '/planning/tests?view=unassigned',
  `/planning/tests?view=assigned&assignedToId=${techId}`,
  '/planning/tests?view=assigned&q=Load%20Test%20150',
  '/planning/tests?view=assigned&q=LOAD%2FS%2F0012',
  '/tests/approvals',
  '/jobs',
  '/jobs?status=IN_TESTING&sort=receivedAt&order=desc',
  '/jobs?page=1500',
  '/jobs?q=LOAD%2FJOB%2F00123',
  '/samples',
  '/samples?status=IN_TESTING',
  '/samples?q=LOAD%2FS%2F0012',
  '/mis/pending-samples',
  '/mis/tat-crossed',
  '/mis/result-pending',
  '/mis/pending-by-test',
  '/mis/complete-test-detail',
  '/search?q=LOAD%2FS%2F001',
  '/dashboard',
];

const results = [];
for (const path of ENDPOINTS) {
  const times = [];
  for (let r = 0; r < ROUNDS; r++) {
    const batch = await Promise.all(Array.from({ length: CONCURRENCY }, () => get(path)));
    times.push(...batch.map((b) => b.ms));
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  results.push({ path, p50: Math.round(p50), p95: Math.round(p95), ok: p95 <= P95_BUDGET_MS });
  console.log(`${String(Math.round(p50)).padStart(6)} ms p50 ${String(Math.round(p95)).padStart(6)} ms p95  ${p95 <= P95_BUDGET_MS ? 'ok  ' : 'SLOW'} ${path}`);
}
const slow = results.filter((r) => !r.ok);
console.log(slow.length ? `\n${slow.length} endpoints over the ${P95_BUDGET_MS} ms budget.` : `\nAll ${results.length} endpoints within the ${P95_BUDGET_MS} ms p95 budget, at ${CONCURRENCY} concurrent requests.`);
process.exit(slow.length ? 1 : 0);
