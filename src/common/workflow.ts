/**
 * Every workflow status change in one table. Services call `assertTransition`, so an edge that
 * is not listed here cannot happen, whatever the UI sends.
 */
import { currentUser } from './context.js';
import { forbidden, invalidTransition, reasonRequired } from './errors.js';

export interface Edge {
  /** Any of these permissions may take the edge. Absent means only the system can (jobs, cascades). */
  perm?: string[];
  reason?: boolean;
}

export type Machine = Record<string, Record<string, Edge>>;

const system: Edge = {};

export const QUOTATION: Machine = {
  // A customer can accept on the phone or at the counter, before anything is emailed.
  DRAFT: { SENT: { perm: ['quotations.send'] }, ACCEPTED: { perm: ['quotations.decide'] } },
  SENT: { ACCEPTED: { perm: ['quotations.decide'] }, REJECTED: { perm: ['quotations.decide'], reason: true }, EXPIRED: system, DRAFT: { perm: ['quotations.edit'], reason: true } },
  REJECTED: { DRAFT: { perm: ['quotations.edit'], reason: true } },
  EXPIRED: { DRAFT: { perm: ['quotations.edit'], reason: true } },
  ACCEPTED: {},
};

const hold: Edge = { perm: ['jobs.hold'], reason: true };
const cancelJob: Edge = { perm: ['jobs.cancel'], reason: true };

export const JOB: Machine = {
  RECEIVED: { PLANNED: { perm: ['planning.edit'] }, ON_HOLD: hold, CANCELLED: cancelJob },
  PLANNED: { IN_TESTING: system, ON_HOLD: hold, CANCELLED: cancelJob, RECEIVED: system },
  IN_TESTING: { REPORTING: system, ON_HOLD: hold, CANCELLED: cancelJob, PLANNED: system },
  REPORTING: { COMPLETED: system, IN_TESTING: system, ON_HOLD: hold, CANCELLED: cancelJob },
  COMPLETED: { REPORTING: system },
  ON_HOLD: { RECEIVED: { perm: ['jobs.hold'] }, PLANNED: { perm: ['jobs.hold'] }, IN_TESTING: { perm: ['jobs.hold'] }, REPORTING: { perm: ['jobs.hold'] }, CANCELLED: cancelJob },
  CANCELLED: {},
};

const holdTest: Edge = { perm: ['tests.hold', 'tests.work'], reason: true };
const releaseTest: Edge = { perm: ['tests.hold', 'tests.work'] };
const cancelTest: Edge = { perm: ['jobs.cancel', 'planning.edit'], reason: true };

export const TEST: Machine = {
  PLANNED: { ASSIGNED: { perm: ['planning.edit'] }, ON_HOLD: holdTest, CANCELLED: cancelTest },
  ASSIGNED: { IN_PROGRESS: { perm: ['tests.work'] }, PLANNED: { perm: ['planning.edit'] }, ON_HOLD: holdTest, CANCELLED: cancelTest },
  IN_PROGRESS: { RESULTS_SUBMITTED: { perm: ['tests.work'] }, ON_HOLD: holdTest, CANCELLED: cancelTest },
  RESULTS_SUBMITTED: { APPROVED: { perm: ['tests.approve'] }, IN_PROGRESS: { perm: ['tests.approve'], reason: true }, CANCELLED: cancelTest },
  // Locked. Only a report rejection that sends the test back for re-testing reopens it.
  APPROVED: { IN_PROGRESS: { perm: ['reports.review', 'reports.approve'], reason: true } },
  ON_HOLD: { PLANNED: releaseTest, ASSIGNED: releaseTest, IN_PROGRESS: releaseTest, CANCELLED: cancelTest },
  CANCELLED: {},
};

export const REPORT: Machine = {
  DRAFT: { IN_REVIEW: { perm: ['reports.review'] } },
  IN_REVIEW: { PENDING_APPROVAL: { perm: ['reports.review'] }, DRAFT: { perm: ['reports.review'], reason: true } },
  PENDING_APPROVAL: { APPROVED: { perm: ['reports.approve'] }, DRAFT: { perm: ['reports.approve'], reason: true } },
  APPROVED: { ISSUED: { perm: ['reports.issue'] } },
  ISSUED: { SUPERSEDED: system },
  SUPERSEDED: {},
};

export const INVOICE: Machine = {
  DRAFT: { ISSUED: { perm: ['invoices.edit'] }, CANCELLED: { perm: ['invoices.edit'], reason: true } },
  ISSUED: { PARTIALLY_PAID: system, PAID: system, CANCELLED: { perm: ['invoices.edit'], reason: true } },
  PARTIALLY_PAID: { PAID: system, ISSUED: system },
  PAID: { PARTIALLY_PAID: system, ISSUED: system },
  CANCELLED: {},
};

export const MACHINES = { QUOTATION, JOB, TEST, REPORT, INVOICE };

/** Pure decision used by services and by the role matrix test. */
export function decideTransition(machine: Machine, from: string, to: string, permissions: { has(p: string): boolean } | null, reason?: string | null): 'ok' | 'invalid' | 'forbidden' | 'reason' {
  const edge = machine[from]?.[to];
  if (!edge) return 'invalid';
  if (permissions) {
    if (!edge.perm) return 'forbidden'; // a system-only edge can't be taken by a person
    if (!edge.perm.some((p) => permissions.has(p))) return 'forbidden';
  }
  if (edge.reason && !reason?.trim()) return 'reason';
  return 'ok';
}

/** For a request from a user. */
export function assertTransition(machine: Machine, from: string, to: string, reason?: string | null): void {
  const result = decideTransition(machine, from, to, currentUser()?.permissions ?? new Set<string>(), reason);
  if (result === 'invalid') throw invalidTransition(from, to);
  if (result === 'forbidden') throw forbidden();
  if (result === 'reason') throw reasonRequired();
}

/** For cascades and scheduled jobs: the edge must still exist, but no user permission applies. */
export function assertSystemTransition(machine: Machine, from: string, to: string): void {
  if (!machine[from]?.[to]) throw invalidTransition(from, to);
}

