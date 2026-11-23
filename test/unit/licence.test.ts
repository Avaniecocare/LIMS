import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { licenceKey, readLicence, statusOf, type Licence } from '../../src/core/licence.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const key = licenceKey(publicKey.export({ type: 'spki', format: 'pem' }).toString());
const base: Licence = { id: 'l1', kind: 'trial', customer: 'Acme', installation: null, issuedAt: '2026-01-01T00:00:00Z', days: 7, notAfter: '2026-03-01T00:00:00Z', graceDays: 0 };
const issue = (l: object, k = privateKey) => {
  const body = `LIMS1.${Buffer.from(JSON.stringify({ ...base, ...l })).toString('base64url')}`;
  return `${body}.${sign(null, Buffer.from(body), k).toString('base64url')}`;
};
const at = (s: string) => new Date(s);

describe('reading a licence', () => {
  it('accepts only what the vendor signed, unaltered', () => {
    expect(readLicence(issue({}), key, 'me').customer).toBe('Acme');
    expect(readLicence(issue({}).replace(/(.{40})/g, '$1\n'), key, 'me').customer).toBe('Acme'); // pasted with line breaks
    const [p, body, s] = issue({}).split('.');
    const longer = Buffer.from(JSON.stringify({ ...base, days: 3000 })).toString('base64url');
    expect(() => readLicence(`${p}.${longer}.${s}`, key, 'me')).toThrow(/altered/);
    expect(() => readLicence(`${p}.${body}.`, key, 'me')).toThrow();
    expect(() => readLicence(issue({}, generateKeyPairSync('ed25519').privateKey), key, 'me')).toThrow(/altered/);
    expect(() => readLicence('hello', key, 'me')).toThrow(/not a licence/);
  });
  it('is for the installation it names', () => {
    expect(readLicence(issue({ installation: 'me' }), key, 'me').id).toBe('l1');
    expect(() => readLicence(issue({ installation: 'other' }), key, 'me')).toThrow(/another installation/);
  });
  it.each([{ kind: 'free' }, { days: 0 }, { days: -1 }, { days: 1.5 }, { notAfter: 'never' }, { graceDays: 9999 }, { customer: 5 }])('refuses nonsense %j', (l) => {
    expect(() => readLicence(issue(l), key, 'me')).toThrow(/incomplete/);
  });
  it('will not use another kind of key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(() => licenceKey(rsa)).toThrow(/Ed25519/);
  });
});

describe('what a licence allows', () => {
  const start = at('2026-02-01T00:00:00Z');
  const on = (l: Partial<Licence>, now: string) => statusOf({ ...base, ...l }, start, at(now));
  it.each([7, 30])('a %i-day trial counts from activation and then goes read-only', (days) => {
    const end = new Date(start.getTime() + days * 86_400_000);
    expect(on({ days, notAfter: '2027-01-01T00:00:00Z' }, '2026-02-01T00:00:01Z')).toMatchObject({ readOnly: false, daysLeft: days });
    expect(on({ days, notAfter: '2027-01-01T00:00:00Z' }, new Date(end.getTime() - 1).toISOString())).toMatchObject({ state: 'ending', readOnly: false, daysLeft: 1 });
    expect(on({ days, notAfter: '2027-01-01T00:00:00Z' }, end.toISOString())).toMatchObject({ state: 'expired', readOnly: true, daysLeft: 0 });
  });
  it('never works past its last day, however late it was activated', () => {
    expect(on({ days: 30, notAfter: '2026-02-03T00:00:00Z' }, '2026-02-03T00:00:00Z').readOnly).toBe(true);
  });
  it('keeps working through the grace days', () => {
    const l = { kind: 'full' as const, days: null, notAfter: '2026-06-01T00:00:00Z', graceDays: 14 };
    expect(on(l, '2026-05-01T00:00:00Z').state).toBe('active');
    expect(on(l, '2026-06-10T00:00:00Z')).toMatchObject({ state: 'grace', readOnly: false });
    expect(on(l, '2026-06-15T00:00:00Z')).toMatchObject({ state: 'expired', readOnly: true });
  });
  it('is read-only without one', () => expect(statusOf(null, null, start)).toMatchObject({ state: 'missing', readOnly: true }));
});

describe('the vendor’s tool', () => {
  const tool = (...args: string[]) => execFileSync(process.execPath, ['scripts/licence.mjs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  it('makes a key and licences the product accepts, and will not overwrite the key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lic-'));
    tool('keygen', dir);
    expect(statSync(join(dir, 'licence.key')).mode & 0o777).toBe(0o600);
    const pub = licenceKey(readFileSync(join(dir, 'licence.pub'), 'utf8'));
    const trial = tool('issue', '--key', join(dir, 'licence.key'), '--customer', 'Acme Labs', '--kind', 'trial', '--days', '7');
    expect(readLicence(trial, pub, 'x')).toMatchObject({ kind: 'trial', days: 7, customer: 'Acme Labs', installation: null });
    const full = tool('issue', '--key', join(dir, 'licence.key'), '--customer', 'Acme Labs', '--kind', 'full', '--until', '2099-11-30', '--installation', 'x', '--grace', '14');
    expect(readLicence(full, pub, 'x')).toMatchObject({ kind: 'full', days: null, graceDays: 14, notAfter: '2099-11-30T18:29:59.000Z' });
    expect(() => tool('keygen', dir)).toThrow();
    expect(() => tool('issue', '--key', join(dir, 'licence.key'), '--customer', 'A', '--kind', 'full', '--until', '2001-01-01')).toThrow();
  });
});
