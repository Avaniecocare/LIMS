// The government IRP's direct API (NIC). Sources: the API documentation at einv-apisandbox.nic.in (authentication
// v1.04, generate / get / cancel IRN v1.03) and its Java and C# samples. Validate against the sandbox before production.
//
// Sign-in: {UserName, Password, AppKey, ForceRefreshAccessToken} → JSON → base64 → RSA (PKCS#1 v1.5, the IRP's public
// key) → base64, posted as {"Data": …}. The answer's Sek is AES-256-ECB (PKCS#7) under the AppKey; decrypted, it is the
// session key. Every later request body is the JSON encrypted with that key (AES-256-ECB, PKCS#7), base64; answers
// come back the same way.
import { constants, createCipheriv, createDecipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import type { EInvoiceConfig } from '../../config/infra.config.js';
import type { InvPayload } from './payload.js';
import { IrpRejection, type CancelReason, type IrpProvider, type Registered } from './provider.js';

const AUTH = '/eivital/v1.04/auth';
const GENERATE = '/eicore/v1.03/Invoice';
const BY_IRN = (irn: string) => `/eicore/v1.03/Invoice/irn/${encodeURIComponent(irn)}`;
const CANCEL = '/eicore/v1.03/Invoice/Cancel';
const TIMEOUT_MS = 30_000;
/** Re-sign in this long before the token's stated expiry. */
const EXPIRY_MARGIN_MS = 5 * 60_000;
/** Token and credential errors: sign in again once and repeat the call. */
const AUTH_ERRORS = new Set(['1005', '1008', '1010', '1015']);

export function aesEncrypt(key: Buffer, plain: Buffer): string {
  const c = createCipheriv('aes-256-ecb', key, null);
  return Buffer.concat([c.update(plain), c.final()]).toString('base64');
}
export function aesDecrypt(key: Buffer, b64: string): Buffer {
  const d = createDecipheriv('aes-256-ecb', key, null);
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]);
}
export function rsaEncrypt(publicKeyPem: string, plain: Buffer): string {
  return publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING }, plain).toString('base64');
}

/** "yyyy-MM-dd HH:mm:ss" in India time, as the IRP writes AckDt and TokenExpiry. */
export function parseIrpTime(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return new Date(s);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`);
}

type Envelope = { Status?: string | number; status?: string | number; Data?: unknown; ErrorDetails?: unknown; InfoDtls?: unknown };

/** ErrorDetails arrives as an array, or as base64 of one; both are read. */
export function readErrors(details: unknown): { ErrorCode: string; ErrorMessage: string }[] {
  let v = details;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(Buffer.from(v, 'base64').toString('utf8'));
    } catch {
      try {
        v = JSON.parse(details as string);
      } catch {
        return [{ ErrorCode: '', ErrorMessage: String(details) }];
      }
    }
  }
  return Array.isArray(v) ? v.map((e: { ErrorCode?: unknown; ErrorMessage?: unknown }) => ({ ErrorCode: String(e.ErrorCode ?? ''), ErrorMessage: String(e.ErrorMessage ?? '') })) : [];
}

/** The IRN of an existing registration, from a duplicate answer's InfoDtls (InfCd DUPIRN). */
export function duplicateIrn(info: unknown): string | null {
  const list = Array.isArray(info) ? info : [];
  for (const i of list as { InfCd?: string; Desc?: unknown }[]) {
    if (i?.InfCd !== 'DUPIRN') continue;
    const d = (typeof i.Desc === 'string' ? safeJson(i.Desc) : i.Desc) as { Irn?: string } | null;
    if (d?.Irn) return d.Irn;
  }
  return null;
}
const safeJson = (s: string) => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
};

export class NicIrp implements IrpProvider {
  readonly name = 'nic' as const;
  private session: { token: string; sek: Buffer; until: number } | null = null;
  private signingIn: Promise<{ token: string; sek: Buffer }> | null = null;

  constructor(
    private readonly c: EInvoiceConfig,
    private readonly http: typeof fetch = fetch,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return { 'content-type': 'application/json', accept: 'application/json', client_id: this.c.clientId, client_secret: this.c.clientSecret, Gstin: this.c.gstin, ...extra };
  }

  private async call(method: 'GET' | 'POST', path: string, headers: Record<string, string>, body?: unknown): Promise<Envelope> {
    let res: Response;
    try {
      res = await this.http(`${this.c.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new Error(`The GST portal did not answer (${(e as Error).name})`);
    }
    const text = await res.text();
    const json = safeJson(text) as Envelope | null;
    if (!json) throw new Error(`The GST portal answered HTTP ${res.status} without a readable body`);
    return json;
  }

  private ok(e: Envelope) {
    return String(e.Status ?? e.status) === '1';
  }

  private async signIn(): Promise<{ token: string; sek: Buffer }> {
    if (this.session && this.session.until > Date.now()) return this.session;
    // One sign-in at a time; parallel calls wait for it.
    this.signingIn ??= (async () => {
      const appKey = randomBytes(32);
      const inner = { UserName: this.c.username, Password: this.c.password, AppKey: appKey.toString('base64'), ForceRefreshAccessToken: true };
      const data = rsaEncrypt(this.c.publicKey, Buffer.from(Buffer.from(JSON.stringify(inner)).toString('base64')));
      const env = await this.call('POST', AUTH, this.headers(), { Data: data });
      if (!this.ok(env)) {
        const errors = readErrors(env.ErrorDetails);
        throw new IrpRejection(
          `Sign-in to the GST portal failed: ${errors.map((x) => x.ErrorMessage).join('; ') || 'no reason given'}`,
          errors.map((x) => x.ErrorCode),
        );
      }
      const d = (typeof env.Data === 'string' ? safeJson(env.Data) : env.Data) as { AuthToken: string; Sek: string; TokenExpiry?: string };
      const sek = aesDecrypt(appKey, d.Sek);
      const expiry = d.TokenExpiry ? parseIrpTime(d.TokenExpiry).getTime() : Date.now() + 55 * 60_000;
      this.session = { token: d.AuthToken, sek, until: expiry - EXPIRY_MARGIN_MS };
      return this.session;
    })().finally(() => {
      this.signingIn = null;
    });
    return this.signingIn;
  }

  /** An authenticated, encrypted call; signs in again once on a token error. */
  private async secure<T>(method: 'GET' | 'POST', path: string, body?: unknown, retried = false): Promise<T> {
    const s = await this.signIn();
    const env = await this.call(
      method,
      path,
      this.headers({ user_name: this.c.username, AuthToken: s.token }),
      body === undefined ? undefined : { Data: aesEncrypt(s.sek, Buffer.from(JSON.stringify(body))) },
    );
    if (this.ok(env)) return JSON.parse(aesDecrypt(s.sek, String(env.Data)).toString('utf8')) as T;
    const errors = readErrors(env.ErrorDetails);
    if (!retried && errors.some((x) => AUTH_ERRORS.has(x.ErrorCode))) {
      this.session = null;
      return this.secure(method, path, body, true);
    }
    const existing = errors.some((x) => x.ErrorCode === '2150') ? duplicateIrn(env.InfoDtls) : null;
    throw new IrpRejection(
      errors.map((x) => x.ErrorMessage).join('; ') || 'The GST portal refused the request',
      errors.map((x) => x.ErrorCode),
      existing,
    );
  }

  private registered(d: { Irn: string; AckNo: number | string; AckDt: string; SignedInvoice: string; SignedQRCode: string; Status?: string }): Registered {
    return { irn: d.Irn, ackNo: String(d.AckNo), ackDate: parseIrpTime(d.AckDt), signedInvoice: d.SignedInvoice, signedQrCode: d.SignedQRCode, cancelled: d.Status === 'CNL' };
  }

  async generate(payload: InvPayload): Promise<Registered> {
    return this.registered(await this.secure('POST', GENERATE, payload));
  }

  async fetch(irn: string): Promise<Registered> {
    return this.registered(await this.secure('GET', BY_IRN(irn)));
  }

  async cancel(irn: string, reason: CancelReason, remark: string): Promise<{ cancelledAt: Date }> {
    const d = await this.secure<{ Irn: string; CancelDate: string }>('POST', CANCEL, { Irn: irn, CnlRsn: reason, CnlRem: remark.replace(/["\\]/g, '').slice(0, 100) });
    return { cancelledAt: parseIrpTime(d.CancelDate) };
  }

  async check(): Promise<void> {
    this.session = null;
    await this.signIn();
  }
}
