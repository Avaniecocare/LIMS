/** Writes openapi.json from the compiled app, without listening on a port. */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { buildOpenApi, createApp } from './bootstrap.js';

const app = await createApp();
const doc = buildOpenApi(app);
writeFileSync(process.argv[2] ?? 'openapi.json', `${JSON.stringify(doc, null, 2)}\n`);
await app.close();
process.exit(0);
