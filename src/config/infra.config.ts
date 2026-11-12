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
  /** a session ends this many hours after sign-in, however active it is */
  sessionMaxHours: number;
  sessionCookieName: string;
  sessionCookieDomain: string | null;
  cookieSecure: boolean;
  frontendOrigin: string;
  publicApiUrl: string;
  setupToken: string | null;
  s3: { endpoint: string; publicEndpoint: string | null; region: string; bucket: string; accessKey: string; secretKey: string; forcePathStyle: boolean };
  smtp: { host: string; port: number; secure: boolean; user: string | null; password: string | null; from: string; transport: 'smtp' | 'json' };
  maxUploadBytes: number;
  /** PIN code lookup service (India Post data); empty turns the lookup off */
  pincodeLookupUrl: string | null;
  errorTrackingDsn: string | null;
  logLevel: string;
  /** WhatsApp Business Cloud API; null when not set up */
  whatsapp: { apiUrl: string; token: string | null; phoneNumberId: string | null; transport: 'cloud' | 'json'; appSecret: string | null; verifyToken: string | null } | null;
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
    // TODO(rbac-decision): longest a session may last however active it is (12 hours, one long lab shift, chosen).
    sessionMaxHours: Number(env.SESSION_MAX_HOURS ?? 12),
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
    // WhatsApp is on when the token and phone number id are set (or the json transport, for development and tests).
    whatsapp:
      env.WHATSAPP_TRANSPORT === 'json' || (env.WHATSAPP_TOKEN?.trim() && env.WHATSAPP_PHONE_NUMBER_ID?.trim())
        ? {
            apiUrl: (env.WHATSAPP_API_URL?.trim() || 'https://graph.facebook.com/v21.0').replace(/\/+$/, ''),
            token: env.WHATSAPP_TOKEN?.trim() || null,
            phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null,
            transport: env.WHATSAPP_TRANSPORT === 'json' ? 'json' : 'cloud',
            // Delivered and read receipts arrive on Meta's webhook: the app secret signs them, the verify token proves the URL.
            appSecret: env.WHATSAPP_APP_SECRET?.trim() || null,
            verifyToken: env.WHATSAPP_VERIFY_TOKEN?.trim() || null,
          }
        : null,
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
    pincodeLookupUrl: env.PINCODE_LOOKUP_URL === undefined ? 'https://api.postalpincode.in/pincode/' : env.PINCODE_LOOKUP_URL.trim() || null,
    errorTrackingDsn: env.ERROR_TRACKING_DSN?.trim() || null,
    logLevel: env.LOG_LEVEL ?? 'info',
  };
  if (missing.length) throw new InfraConfigError(`Missing required environment variables: ${missing.join(', ')}`);
  if (secret.length < 32) throw new InfraConfigError('SESSION_SECRET must be at least 32 characters');
  // The example and test values are public (they are in the repository), so they must never sign production sessions.
  if (nodeEnv === 'production' && /dev-only|change-me|test-session-secret/i.test(secret)) {
    throw new InfraConfigError('SESSION_SECRET is the public example value. Generate a new random secret for production.');
  }
  return config;
}

export const INFRA_CONFIG = Symbol('INFRA_CONFIG');
