// S3-compatible server for machines without Docker/MinIO. Docker Compose uses MinIO instead.
import { mkdirSync } from 'node:fs';
import S3rver from 's3rver';

const directory = process.env.S3RVER_DIR ?? 'tmp/s3';
mkdirSync(directory, { recursive: true });
const port = Number(process.env.S3RVER_PORT ?? 9000);
await new S3rver({ port, address: '127.0.0.1', silent: true, directory, allowMismatchedSignatures: true, configureBuckets: [{ name: process.env.S3_BUCKET ?? 'lims' }] }).run();
console.log(`s3rver on :${port}`);
