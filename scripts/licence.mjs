#!/usr/bin/env node
/**
 * For the vendor, on the vendor's own machine. Never part of an image.
 *   node scripts/licence.mjs keygen <folder>
 *       makes licence.key (private: keep it offline and backed up) and licence.pub (built into images)
 *   node scripts/licence.mjs issue --key licence.key --customer "Acme Labs" --kind trial --days 7
 *   node scripts/licence.mjs issue --key licence.key --customer "Acme Labs" --kind full --until 2027-11-30 --installation <id> [--grace 14]
 * Trials: --days counts from activation; --until (default 60 days from now) is the last day it works at all.
 */
import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const usage = () => {
  process.stderr.write(
    readFileSync(new URL(import.meta.url), 'utf8')
      .split('*/')[0]
      .replace(/^[\s\S]*?\/\*\*/, '')
      .replace(/^ \* ?/gm, '') + '\n',
  );
  process.exit(64);
};
const [command, ...rest] = process.argv.slice(2);
if (command === 'keygen' && rest[0]) {
  const [priv, pub] = ['licence.key', 'licence.pub'].map((f) => join(rest[0], f));
  if (existsSync(priv)) throw new Error(`${priv} already exists. Replacing it would make every image built with it refuse new licences.`);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
  process.stdout.write(`${priv}\n${pub}\n`);
} else if (command === 'issue') {
  const { values: v } = parseArgs({
    args: rest,
    options: {
      key: { type: 'string' },
      customer: { type: 'string' },
      kind: { type: 'string' },
      days: { type: 'string' },
      until: { type: 'string' },
      installation: { type: 'string' },
      grace: { type: 'string', default: '0' },
    },
  });
  if (!v.key || !v.customer || (v.kind !== 'trial' && v.kind !== 'full') || (v.kind === 'trial' ? !v.days : !v.until)) usage();
  const whole = (s, name) => {
    if (!/^\d+$/.test(s)) throw new Error(`--${name} must be a whole number`);
    return Number(s);
  };
  // The end of that day in India.
  const until = v.until ? new Date(`${v.until}T23:59:59+05:30`) : new Date(Date.now() + 60 * 86_400_000);
  if (Number.isNaN(until.getTime()) || until < new Date()) throw new Error('--until must be a date still to come, as YYYY-MM-DD');
  const licence = {
    id: randomUUID(),
    kind: v.kind,
    customer: v.customer,
    installation: v.installation ?? null,
    issuedAt: new Date().toISOString(),
    days: v.days ? whole(v.days, 'days') : null,
    notAfter: until.toISOString(),
    graceDays: whole(v.grace, 'grace'),
  };
  const body = `LIMS1.${Buffer.from(JSON.stringify(licence)).toString('base64url')}`;
  const signature = sign(null, Buffer.from(body), createPrivateKey(readFileSync(v.key))).toString('base64url');
  process.stderr.write(`${JSON.stringify(licence, null, 2)}\n`);
  process.stdout.write(`${body}.${signature}\n`);
} else usage();
