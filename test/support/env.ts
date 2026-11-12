import { bluepeak } from './company-env.js';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://lims@localhost:5432/lims_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
  SESSION_SECRET: 'test-session-secret-test-session-secret-000',
  FRONTEND_ORIGIN: 'http://app.test.example',
  PUBLIC_API_URL: 'http://api.test.example',
  S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9199',
  S3_BUCKET: 'lims-test',
  S3_ACCESS_KEY: 'S3RVER',
  S3_SECRET_KEY: 'S3RVER',
  SMTP_FROM: 'lab@bluepeak.example',
  SMTP_TRANSPORT: 'json',
  WHATSAPP_TRANSPORT: 'json',
  WHATSAPP_APP_SECRET: 'test-app-secret',
  WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  LOG_LEVEL: 'silent',
  ...bluepeak,
});
