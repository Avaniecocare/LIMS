/** Infrastructure values and secrets, kept apart from the COMPANY_* group. */
export interface InfraConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  databaseReadUrl: string | null;
  databasePoolSize: number;
  redisUrl: string;
  sessionSecret: string;
  sessionIdleMinutes: number;
  sessionCookieName: string;
  sessionCookieDomain: string | null;
  cookieSecure: boolean;
  frontendOrigin: string;
  publicApiUrl: string;
  setupToken: string | null;
  s3: { endpoint: string; publicEndpoint: string | null; region: string; bucket: string; accessKey: string; secretKey: string; forcePathStyle: boolean };
  smtp: { host: string; port: number; secure: boolean; user: string | null; password: string | null; from: string; transport: 'smtp' | 'json' };
  maxUploadBytes: number;
  errorTrackingDsn: string | null;
  logLevel: string;
}

export class InfraConfigError extends Error {}

export function loadInfraConfig(env: NodeJS.ProcessEnv = process.env): InfraConfig {
  const missing: string[] = [];
  const req = (name: string): string => {
    const v = env[name]?.trim();
    if (!v) missing.push(name);
    return v ?? '';
  };
  const secret = req('SESSION_SECRET');
  const nodeEnv = env.NODE_ENV ?? 'development';
  const config: InfraConfig = {
    nodeEnv,
    port: Number(env.PORT ?? 3000),
    databaseUrl: req('DATABASE_URL'),
    databaseReadUrl: env.DATABASE_READ_URL?.trim() || null,
    databasePoolSize: Number(env.DATABASE_POOL_SIZE ?? 10),
    redisUrl: req('REDIS_URL'),
    sessionSecret: secret,
    sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES ?? 30),
    sessionCookieName: env.SESSION_COOKIE_NAME?.trim() || 'lims_sid',
    sessionCookieDomain: env.SESSION_COOKIE_DOMAIN?.trim() || null,
    cookieSecure: (env.COOKIE_SECURE ?? (nodeEnv === 'production' ? 'true' : 'false')) === 'true',
    frontendOrigin: req('FRONTEND_ORIGIN'),
    publicApiUrl: env.PUBLIC_API_URL?.trim() || `http://localhost:${env.PORT ?? 3000}`,
    setupToken: env.SETUP_TOKEN?.trim() || null,
    s3: {
      endpoint: req('S3_ENDPOINT'),
      publicEndpoint: env.S3_PUBLIC_ENDPOINT?.trim() || null,
      region: env.S3_REGION?.trim() || 'us-east-1',
      bucket: req('S3_BUCKET'),
      accessKey: req('S3_ACCESS_KEY'),
      secretKey: req('S3_SECRET_KEY'),
      forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    },
    smtp: {
      host: env.SMTP_HOST?.trim() || 'localhost',
      port: Number(env.SMTP_PORT ?? 1025),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER?.trim() || null,
      password: env.SMTP_PASSWORD || null,
      from: req('SMTP_FROM'),
      transport: env.SMTP_TRANSPORT === 'json' ? 'json' : 'smtp',
    },
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024),
    errorTrackingDsn: env.ERROR_TRACKING_DSN?.trim() || null,
    logLevel: env.LOG_LEVEL ?? 'info',
  };
  if (missing.length) throw new InfraConfigError(`Missing required environment variables: ${missing.join(', ')}`);
  if (secret.length < 32) throw new InfraConfigError('SESSION_SECRET must be at least 32 characters');
  return config;
}

export const INFRA_CONFIG = Symbol('INFRA_CONFIG');
