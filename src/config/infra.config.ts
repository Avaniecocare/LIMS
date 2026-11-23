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
  /** The help site's "Ask AI" assistant; see HelpConfig. */
  help: HelpConfig;
  /** GST e-invoicing (IRN from the Invoice Registration Portal); null when not set up. See EInvoiceConfig. */
  einvoice: EInvoiceConfig | null;
}

/**
 * GST e-invoicing. `nic` talks to the government IRP directly with the lab's API credentials (from the e-invoice
 * portal's API registration); `mock` makes test IRNs locally, for development and demos, and every document it
 * touches is printed as a test. The credentials live only in server settings, never in the database or a browser.
 */
export interface EInvoiceConfig {
  provider: 'nic' | 'mock';
  environment: 'sandbox' | 'production';
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  /** the lab's GSTIN as registered for the API; must match the lab profile */
  gstin: string;
  /** the IRP's RSA public key (PEM) for the environment */
  publicKey: string;
}

/** The help assistant. It answers from the published documentation only, through this server. */
export interface HelpConfig {
  /** ENABLE_AI_ASSISTANT=true and a usable provider; otherwise the help site shows search only */
  enabled: boolean;
  /** anthropic (Claude), or mock: an offline extractive answer, for development and tests */
  provider: 'anthropic' | 'mock';
  apiKey: string | null;
  model: string;
  embedding: { provider: 'none' | 'voyage'; apiKey: string | null; model: string };
  /** where the docs build's help-index.json is read from: a file path, or a URL */
  indexPath: string | null;
  indexUrl: string;
  perMinute: number;
  perDay: number;
  signedInPerDay: number;
  /** US dollars; the assistant turns itself off for the rest of the day or month when reached */
  dailyBudget: number;
  monthlyBudget: number;
  maxQuestionLength: number;
  maxOutputTokens: number;
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
  requireLogin: boolean;
  /** origins allowed to call the assistant (the docs site); the app's own origin is always allowed */
  allowedOrigins: string[];
  supportEmail: string | null;
  logRetentionDays: number;
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
    help: loadHelpConfig(env, req('FRONTEND_ORIGIN')),
    einvoice: loadEInvoiceConfig(env),
  };
  if (missing.length) throw new InfraConfigError(`Missing required environment variables: ${missing.join(', ')}`);
  if (secret.length < 32) throw new InfraConfigError('SESSION_SECRET must be at least 32 characters');
  // The example and test values are public (they are in the repository), so they must never sign production sessions.
  if (nodeEnv === 'production' && /dev-only|change-me|test-session-secret/i.test(secret)) {
    throw new InfraConfigError('SESSION_SECRET is the public example value. Generate a new random secret for production.');
  }
  return config;
}

// TODO(product-decision): the help assistant's limits. Low by default so a public docs site cannot run up a bill.
function loadHelpConfig(env: NodeJS.ProcessEnv, frontendOrigin: string): HelpConfig {
  const int = (name: string, fallback: number, min = 1) => {
    const raw = env[name]?.trim();
    const n = raw ? Number(raw) : fallback;
    return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
  };
  const money = (name: string, fallback: number) => {
    // An empty value (as a deployment template writes it) means "use the default", not zero.
    const raw = env[name]?.trim();
    const n = raw ? Number(raw) : fallback;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const provider = env.AI_PROVIDER?.trim() === 'mock' ? 'mock' : 'anthropic';
  const apiKey = env.AI_API_KEY?.trim() || null;
  const usable = provider === 'mock' || !!apiKey;
  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return {
    enabled: env.ENABLE_AI_ASSISTANT === 'true' && usable,
    provider,
    apiKey,
    model: env.AI_MODEL?.trim() || 'claude-haiku-5-5',
    embedding: {
      provider: env.EMBEDDING_PROVIDER?.trim() === 'voyage' ? 'voyage' : 'none',
      apiKey: env.EMBEDDING_API_KEY?.trim() || null,
      model: env.EMBEDDING_MODEL?.trim() || 'voyage-3.5-lite',
    },
    indexPath: env.HELP_INDEX_PATH?.trim() || null,
    indexUrl: env.HELP_INDEX_URL?.trim() || `${frontendOrigin.replace(/\/+$/, '')}/help/help-index.json`,
    perMinute: int('RATE_LIMIT_PER_MINUTE', 10),
    perDay: int('RATE_LIMIT_PER_DAY', 50),
    signedInPerDay: int('SIGNED_IN_RATE_LIMIT_PER_DAY', 200),
    dailyBudget: money('DAILY_BUDGET_LIMIT', 1),
    monthlyBudget: money('MONTHLY_BUDGET_LIMIT', 20),
    maxQuestionLength: Math.min(int('MAX_QUESTION_LENGTH', 500, 20), 2000),
    maxOutputTokens: Math.min(int('MAX_OUTPUT_TOKENS', 800, 100), 4000),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() || null,
    turnstileSecretKey: env.TURNSTILE_SECRET_KEY?.trim() || null,
    requireLogin: env.AI_REQUIRE_LOGIN === 'true',
    allowedOrigins: [...new Set([frontendOrigin.replace(/\/+$/, ''), ...origins])],
    supportEmail: env.HELP_SUPPORT_EMAIL?.trim() || null,
    logRetentionDays: int('HELP_LOG_RETENTION_DAYS', 90),
  };
}

/**
 * TRUST_PROXY: how many proxies stand in front (1 behind one load balancer), or their addresses, or true/false. With
 * true every X-Forwarded-For entry is believed, so use it only behind a proxy that replaces what the caller sent (Caddy).
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const v = raw?.trim() || 'false';
  if (v === 'true' || v === 'false') return v === 'true';
  if (/^\d{1,2}$/.test(v)) return Number(v);
  if (/^[0-9a-fA-F.:]+(\/\d{1,3})?(\s*,\s*[0-9a-fA-F.:]+(\/\d{1,3})?)*$/.test(v)) return v;
  throw new InfraConfigError('TRUST_PROXY must be true, false, a number of proxies, or a list of addresses');
}

export const INFRA_CONFIG = Symbol('INFRA_CONFIG');

// Production: NIC's IRP 1 (IRP 2 is api.einvoice2.gst.gov.in). The sandbox's addresses are shown only after signing in
// to einv-apisandbox.nic.in, so a sandbox needs EINVOICE_BASE_URL.
const EINVOICE_PRODUCTION_URL = 'https://api.einvoice1.gst.gov.in';

/**
 * EINVOICE_PROVIDER=nic needs every credential (a half-configured provider would fail at the worst moment, when
 * an invoice is issued), so a missing one is a startup error. Unset means e-invoicing is not set up.
 */
export function loadEInvoiceConfig(env: NodeJS.ProcessEnv): EInvoiceConfig | null {
  const provider = env.EINVOICE_PROVIDER?.trim();
  if (!provider) return null;
  if (provider !== 'nic' && provider !== 'mock') throw new InfraConfigError('EINVOICE_PROVIDER must be nic or mock');
  const environment = env.EINVOICE_ENV?.trim() || 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production') throw new InfraConfigError('EINVOICE_ENV must be sandbox or production');
  if (provider === 'mock' && environment === 'production') throw new InfraConfigError('EINVOICE_PROVIDER=mock makes test IRNs only; it cannot be used with EINVOICE_ENV=production');
  const pem = (env.EINVOICE_PUBLIC_KEY ?? '').replace(/\\n/g, '\n').trim();
  const config: EInvoiceConfig = {
    provider,
    environment,
    baseUrl: (env.EINVOICE_BASE_URL?.trim() || (environment === 'production' ? EINVOICE_PRODUCTION_URL : '')).replace(/\/+$/, ''),
    clientId: env.EINVOICE_CLIENT_ID?.trim() ?? '',
    clientSecret: env.EINVOICE_CLIENT_SECRET?.trim() ?? '',
    username: env.EINVOICE_USERNAME?.trim() ?? '',
    password: env.EINVOICE_PASSWORD ?? '',
    gstin: (env.EINVOICE_GSTIN?.trim() ?? '').toUpperCase(),
    publicKey: pem,
  };
  if (provider === 'nic') {
    const missing = (['EINVOICE_CLIENT_ID', 'EINVOICE_CLIENT_SECRET', 'EINVOICE_USERNAME', 'EINVOICE_PASSWORD', 'EINVOICE_GSTIN', 'EINVOICE_PUBLIC_KEY'] as const).filter((k) => !env[k]?.trim());
    if (missing.length) throw new InfraConfigError(`EINVOICE_PROVIDER=nic needs ${missing.join(', ')}`);
    if (!config.baseUrl) throw new InfraConfigError('EINVOICE_ENV=sandbox needs EINVOICE_BASE_URL, the sandbox address shown after signing in to einv-apisandbox.nic.in');
    if (!pem.includes('BEGIN PUBLIC KEY')) throw new InfraConfigError('EINVOICE_PUBLIC_KEY must be the IRP public key in PEM form (-----BEGIN PUBLIC KEY-----)');
  }
  return config;
}
