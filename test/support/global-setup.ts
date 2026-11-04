import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import S3rver from 's3rver';

/** A real PostgreSQL schema, rebuilt from migrations, and a local S3 server unless CI provides one. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://lims@localhost:5432/lims_test';
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await admin.end();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });

  let stop = async () => {};
  if (!process.env.TEST_S3_ENDPOINT) {
    const dir = mkdtempSync(join(tmpdir(), 'lims-s3-'));
    const server = new S3rver({ port: 9199, address: '127.0.0.1', silent: true, directory: dir, configureBuckets: [{ name: 'lims-test' }] });
    await server.run();
    stop = async () => {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    };
  }
  return stop;
}
