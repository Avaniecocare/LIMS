/**
 * One image, two processes: `node dist/main.js api` or `node dist/main.js worker`.
 * Refuses to start on invalid configuration, naming the variable but not its value.
 */
import 'reflect-metadata';
import { logger } from './common/logger.js';
import { CompanyConfigError, loadCompanyConfig } from './config/company.config.js';
import { InfraConfigError, loadInfraConfig } from './config/infra.config.js';

function validateConfigOrExit() {
  try {
    loadInfraConfig();
    loadCompanyConfig();
  } catch (e) {
    if (e instanceof CompanyConfigError || e instanceof InfraConfigError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(78); // EX_CONFIG
    }
    throw e;
  }
}

async function main() {
  validateConfigOrExit();
  const mode = process.argv[2] ?? 'api';
  if (mode === 'worker') {
    const { startWorker } = await import('./worker/worker.js');
    await startWorker();
    return;
  }
  if (mode !== 'api') {
    process.stderr.write(`Unknown process "${mode}". Use "api" or "worker".\n`);
    process.exit(64);
  }
  const { createApp } = await import('./bootstrap.js');
  const app = await createApp();
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.info({ port }, 'api listening');
}

main().catch((e) => {
  logger.fatal({ err: e }, 'startup failed');
  process.exit(1);
});
