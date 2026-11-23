import { createPublicKey, verify, type KeyObject } from 'node:crypto';

/**
 * Licences: small signed documents, checked without calling anyone. The vendor signs with a private key that is never
 * in this repository or an image; an image holds only the public key. This file is pure, so every rule is unit-tested.
 */
export interface Licence {
  id: string;
  kind: 'trial' | 'full';
  customer: string;
  /** the installation it is for; null fits any */
  installation: string | null;
  issuedAt: string;
  /** days from activation; a trial that is not activated yet has used none */
  days: number | null;
  /** whatever happens, not valid after this */
  notAfter: string;
  /** days of normal work after the end, for a renewal in progress */
  graceDays: number;
}

export type LicenceState = 'not-required' | 'missing' | 'active' | 'ending' | 'grace' | 'expired';
export interface LicenceStatus {
  state: LicenceState;
  readOnly: boolean;
  licence: Pick<Licence, 'id' | 'kind' | 'customer'> | null;
  startedAt: Date | null;
  endsAt: Date | null;
  readOnlyFrom: Date | null;
  daysLeft: number | null;
}

const DAY = 86_400_000;
const PREFIX = 'LIMS1';
/** From this many days before the end, administrators are reminded. */
export const ENDING_DAYS = 14;

export class LicenceError extends Error {}

export const licenceKey = (pem: string): KeyObject => {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new LicenceError('The licence public key must be Ed25519');
  return key;
};

/** Reads and checks a licence. Says nothing about dates: see `statusOf`. */
export function readLicence(text: string, key: KeyObject, installation: string): Licence {
  const parts = text.replace(/\s+/g, '').split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX || text.length > 8000) throw new LicenceError('That is not a licence');
  if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw new LicenceError('This licence was not issued for this product, or has been altered');
  const l = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Licence;
  const date = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
  const whole = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
  if (
    typeof l.id !== 'string' ||
    (l.kind !== 'trial' && l.kind !== 'full') ||
    typeof l.customer !== 'string' ||
    !date(l.issuedAt) ||
    !date(l.notAfter) ||
    !(l.days === null || (whole(l.days, 3660) && l.days > 0)) ||
    !whole(l.graceDays, 365)
  )
    throw new LicenceError('This licence is incomplete');
  if (l.installation && l.installation !== installation) throw new LicenceError(`This licence is for another installation. This one is ${installation}`);
  return l;
}

export function statusOf(licence: Licence | null, startedAt: Date | null, now: Date): LicenceStatus {
  if (!licence || !startedAt) return { state: 'missing', readOnly: true, licence: null, startedAt: null, endsAt: null, readOnlyFrom: null, daysLeft: null };
  const limit = Date.parse(licence.notAfter);
  const end = new Date(licence.days === null ? limit : Math.min(limit, startedAt.getTime() + licence.days * DAY));
  const readOnlyFrom = new Date(end.getTime() + licence.graceDays * DAY);
  const left = end.getTime() - now.getTime();
  const state: LicenceState = now >= readOnlyFrom ? 'expired' : left <= 0 ? 'grace' : left <= ENDING_DAYS * DAY ? 'ending' : 'active';
  return {
    state,
    readOnly: state === 'expired',
    licence: { id: licence.id, kind: licence.kind, customer: licence.customer },
    startedAt,
    endsAt: end,
    readOnlyFrom,
    daysLeft: Math.max(0, Math.ceil(left / DAY)),
  };
}
