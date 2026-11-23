import { can } from './context.js';

// Customer identity needs customers.view everywhere, including in what was recorded about a job or report.

/** Audit rows keep who, what and when; the recorded values can name the customer, so they need customers.view. */
export function hideIdentity<T extends { before: unknown; after: unknown }>(rows: T[]): T[] {
  return can('customers.view') ? rows : rows.map((r) => ({ ...r, before: null, after: null }));
}

/** Emails to a customer keep their status and time; addresses, subjects and delivery errors can name the customer. */
export function hideEmailIdentity<T extends { toAddress: string; ccAddress: string | null; subject: string; lastError: string | null }>(rows: T[]): T[] {
  return can('customers.view') ? rows : rows.map((r) => ({ ...r, toAddress: '••••', ccAddress: null, subject: 'Email to the customer', lastError: r.lastError && 'Could not be delivered' }));
}
