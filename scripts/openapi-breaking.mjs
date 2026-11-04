#!/usr/bin/env node
// Compares openapi.json with the released baseline. Fails on a breaking change to /api/v1
// unless its id is listed in openapi/approved-breaking.json.
import { existsSync, readFileSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const [currentPath = 'openapi.json', baselinePath = 'openapi/baseline.json', approvedPath = 'openapi/approved-breaking.json'] = process.argv.slice(2);
if (!existsSync(baselinePath)) {
  console.log(`No baseline at ${baselinePath}; nothing to compare yet.`);
  process.exit(0);
}
const cur = load(currentPath);
const base = load(baselinePath);
const approved = new Set(existsSync(approvedPath) ? load(approvedPath) : []);
const breaks = [];

const resolve = (doc, schema) => {
  let s = schema;
  while (s?.$ref) s = s.$ref.split('/').slice(1).reduce((o, k) => o?.[k], doc);
  return s;
};

function compareRequest(where, b, c) {
  b = resolve(base, b);
  c = resolve(cur, c);
  if (!b || !c) return;
  for (const req of c.required ?? []) {
    if (!(b.required ?? []).includes(req)) breaks.push(`${where}: request field "${req}" is now required`);
  }
  for (const [k, v] of Object.entries(b.properties ?? {})) {
    if (!c.properties?.[k]) breaks.push(`${where}: request field "${k}" removed`);
    else if (v.type && c.properties[k].type && v.type !== c.properties[k].type) breaks.push(`${where}: request field "${k}" changed type`);
  }
}

function compareResponse(where, b, c, seen = new Set()) {
  b = resolve(base, b);
  c = resolve(cur, c);
  if (!b || !c) return;
  if (b.type === 'array' && c.type === 'array') return compareResponse(`${where}[]`, b.items, c.items, seen);
  for (const [k, v] of Object.entries(b.properties ?? {})) {
    if (!c.properties?.[k]) {
      breaks.push(`${where}: response field "${k}" removed`);
      continue;
    }
    if (v.type && c.properties[k].type && v.type !== c.properties[k].type) breaks.push(`${where}: response field "${k}" changed type`);
    const key = `${where}.${k}`;
    if (!seen.has(key)) {
      seen.add(key);
      compareResponse(key, v, c.properties[k], seen);
    }
  }
}

for (const [path, methods] of Object.entries(base.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    const where = `${method.toUpperCase()} ${path}`;
    const curOp = cur.paths[path]?.[method];
    if (!curOp) {
      breaks.push(`${where}: removed`);
      continue;
    }
    for (const p of curOp.parameters ?? []) {
      const was = (op.parameters ?? []).find((x) => x.name === p.name && x.in === p.in);
      if (p.required && !was?.required) breaks.push(`${where}: parameter "${p.name}" is now required`);
    }
    for (const p of op.parameters ?? []) {
      if (!(curOp.parameters ?? []).some((x) => x.name === p.name && x.in === p.in)) breaks.push(`${where}: parameter "${p.name}" removed`);
    }
    compareRequest(where, op.requestBody?.content?.['application/json']?.schema, curOp.requestBody?.content?.['application/json']?.schema);
    for (const [status, res] of Object.entries(op.responses ?? {})) {
      const curRes = curOp.responses?.[status];
      if (!curRes) {
        breaks.push(`${where}: response ${status} removed`);
        continue;
      }
      compareResponse(`${where} ${status}`, res.content?.['application/json']?.schema, curRes.content?.['application/json']?.schema);
    }
  }
}

const unapproved = [...new Set(breaks)].filter((b) => !approved.has(b));
if (unapproved.length) {
  console.error('Breaking changes to /api/v1:');
  for (const b of unapproved) console.error(`  - ${b}`);
  console.error(`\nIf intended, add these exact lines to ${approvedPath} in the same pull request.`);
  process.exit(1);
}
console.log(`OpenAPI contract check passed (${breaks.length} approved breaking changes).`);
