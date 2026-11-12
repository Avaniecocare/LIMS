import { describe, expect, it } from 'vitest';
import { decideTransition, INVOICE, JOB, MACHINES, QUOTATION, REPORT, TEST, type Machine } from '../../src/common/workflow.js';
import { DEFAULT_ROLES } from '../../src/modules/rbac/catalog.js';

const R = {
  admin: 'Admin', sales: 'Sales / Business Development', reception: 'Sample Reception', planner: 'Lab Manager / Planner', tech: 'Technician / Analyst', hod: 'Head of Department',
  reviewer: 'Report Reviewer', signatory: 'Authorised Signatory', dispatch: 'Dispatch', accounts: 'Accounts', management: 'Management',
} as const;
type Role = keyof typeof R;
const ALL = Object.keys(R) as Role[];
const perms = (r: Role) => new Set(DEFAULT_ROLES[R[r]].permissions);

/**
 * The intended policy written out independently of the code: [machine, from, to, roles allowed].
 * Every edge in every machine must appear, and every other from/to pair must be rejected.
 */
const POLICY: [Machine, string, string, Role[]][] = [
  [QUOTATION, 'DRAFT', 'SENT', ['admin', 'sales']],
  [QUOTATION, 'DRAFT', 'ACCEPTED', ['admin', 'sales']],
  [QUOTATION, 'SENT', 'ACCEPTED', ['admin', 'sales']],
  [QUOTATION, 'SENT', 'REJECTED', ['admin', 'sales']],
  [QUOTATION, 'SENT', 'EXPIRED', []],
  [QUOTATION, 'SENT', 'DRAFT', ['admin', 'sales']],
  [QUOTATION, 'REJECTED', 'DRAFT', ['admin', 'sales']],
  [QUOTATION, 'EXPIRED', 'DRAFT', ['admin', 'sales']],

  [JOB, 'RECEIVED', 'PLANNED', ['admin', 'planner']],
  [JOB, 'RECEIVED', 'ON_HOLD', ['admin', 'reception', 'planner']],
  [JOB, 'RECEIVED', 'CANCELLED', ['admin', 'planner']],
  [JOB, 'PLANNED', 'IN_TESTING', []],
  [JOB, 'PLANNED', 'RECEIVED', []],
  [JOB, 'PLANNED', 'ON_HOLD', ['admin', 'reception', 'planner']],
  [JOB, 'PLANNED', 'CANCELLED', ['admin', 'planner']],
  [JOB, 'IN_TESTING', 'REPORTING', []],
  [JOB, 'IN_TESTING', 'PLANNED', []],
  [JOB, 'IN_TESTING', 'ON_HOLD', ['admin', 'reception', 'planner']],
  [JOB, 'IN_TESTING', 'CANCELLED', ['admin', 'planner']],
  [JOB, 'REPORTING', 'COMPLETED', []],
  [JOB, 'REPORTING', 'IN_TESTING', []],
  [JOB, 'REPORTING', 'ON_HOLD', ['admin', 'reception', 'planner']],
  [JOB, 'REPORTING', 'CANCELLED', ['admin', 'planner']],
  [JOB, 'COMPLETED', 'REPORTING', []],
  [JOB, 'ON_HOLD', 'RECEIVED', ['admin', 'reception', 'planner']],
  [JOB, 'ON_HOLD', 'PLANNED', ['admin', 'reception', 'planner']],
  [JOB, 'ON_HOLD', 'IN_TESTING', ['admin', 'reception', 'planner']],
  [JOB, 'ON_HOLD', 'REPORTING', ['admin', 'reception', 'planner']],
  [JOB, 'ON_HOLD', 'CANCELLED', ['admin', 'planner']],

  [TEST, 'PLANNED', 'ASSIGNED', ['admin', 'planner']],
  [TEST, 'PLANNED', 'ON_HOLD', ['admin', 'planner', 'tech', 'hod']],
  [TEST, 'PLANNED', 'CANCELLED', ['admin', 'planner']],
  [TEST, 'ASSIGNED', 'IN_PROGRESS', ['tech']],
  [TEST, 'ASSIGNED', 'PLANNED', ['admin', 'planner']],
  [TEST, 'ASSIGNED', 'ON_HOLD', ['admin', 'planner', 'tech', 'hod']],
  [TEST, 'ASSIGNED', 'CANCELLED', ['admin', 'planner']],
  [TEST, 'IN_PROGRESS', 'RESULTS_SUBMITTED', ['tech']],
  [TEST, 'IN_PROGRESS', 'ON_HOLD', ['admin', 'planner', 'tech', 'hod']],
  [TEST, 'IN_PROGRESS', 'CANCELLED', ['admin', 'planner']],
  [TEST, 'RESULTS_SUBMITTED', 'APPROVED', ['admin', 'hod']],
  [TEST, 'RESULTS_SUBMITTED', 'IN_PROGRESS', ['admin', 'hod']],
  [TEST, 'RESULTS_SUBMITTED', 'CANCELLED', ['admin', 'planner']],
  [TEST, 'APPROVED', 'IN_PROGRESS', ['admin', 'reviewer', 'signatory']],
  [TEST, 'ON_HOLD', 'PLANNED', ['admin', 'planner', 'tech', 'hod']],
  [TEST, 'ON_HOLD', 'ASSIGNED', ['admin', 'planner', 'tech', 'hod']],
  [TEST, 'ON_HOLD', 'IN_PROGRESS', ['admin', 'planner', 'tech', 'hod']],
  [TEST, 'ON_HOLD', 'CANCELLED', ['admin', 'planner']],

  [REPORT, 'DRAFT', 'IN_REVIEW', ['admin', 'reviewer']],
  [REPORT, 'IN_REVIEW', 'PENDING_APPROVAL', ['admin', 'reviewer']],
  [REPORT, 'IN_REVIEW', 'DRAFT', ['admin', 'reviewer']],
  [REPORT, 'PENDING_APPROVAL', 'APPROVED', ['admin', 'signatory']],
  [REPORT, 'PENDING_APPROVAL', 'DRAFT', ['admin', 'signatory']],
  [REPORT, 'APPROVED', 'ISSUED', ['admin', 'signatory']],
  [REPORT, 'ISSUED', 'SUPERSEDED', []],

  [INVOICE, 'DRAFT', 'ISSUED', ['admin', 'accounts']],
  [INVOICE, 'DRAFT', 'CANCELLED', ['admin', 'accounts']],
  [INVOICE, 'ISSUED', 'CANCELLED', ['admin', 'accounts']],
  [INVOICE, 'ISSUED', 'PARTIALLY_PAID', []],
  [INVOICE, 'ISSUED', 'PAID', []],
  [INVOICE, 'PARTIALLY_PAID', 'PAID', []],
  [INVOICE, 'PARTIALLY_PAID', 'ISSUED', []],
  [INVOICE, 'PAID', 'PARTIALLY_PAID', []],
  [INVOICE, 'PAID', 'ISSUED', []],
];

const key = (m: Machine, from: string, to: string) => `${Object.entries(MACHINES).find(([, v]) => v === m)![0]}:${from}->${to}`;

describe('status transitions by role', () => {
  const allowed = new Map(POLICY.map(([m, f, t, r]) => [key(m, f, t), r]));

  it('the policy lists every edge the code defines', () => {
    const edges = Object.values(MACHINES).flatMap((m) => Object.entries(m).flatMap(([f, tos]) => Object.keys(tos).map((t) => key(m, f, t))));
    expect(edges.sort()).toEqual([...allowed.keys()].sort());
  });

  for (const [name, machine] of Object.entries(MACHINES)) {
    const states = Object.keys(machine);
    for (const from of states) {
      for (const to of states) {
        if (from === to) continue;
        const roles = allowed.get(key(machine, from, to));
        it(`${name} ${from} -> ${to}`, () => {
          for (const role of ALL) {
            const result = decideTransition(machine, from, to, perms(role), 'because');
            if (roles === undefined) expect(result, role).toBe('invalid');
            else expect(result, role).toBe(roles.includes(role) ? 'ok' : 'forbidden');
          }
        });
      }
    }
  }

  it('requires a reason where stated', () => {
    const edges: [Machine, string, string][] = [[QUOTATION, 'SENT', 'REJECTED'], [JOB, 'RECEIVED', 'ON_HOLD'], [JOB, 'RECEIVED', 'CANCELLED'], [TEST, 'IN_PROGRESS', 'ON_HOLD'], [TEST, 'PLANNED', 'CANCELLED'], [TEST, 'RESULTS_SUBMITTED', 'IN_PROGRESS'], [REPORT, 'IN_REVIEW', 'DRAFT'], [REPORT, 'PENDING_APPROVAL', 'DRAFT'], [INVOICE, 'ISSUED', 'CANCELLED']];
    const every = { has: () => true };
    for (const [m, f, t] of edges) {
      expect(decideTransition(m, f, t, every, '')).toBe('reason');
      expect(decideTransition(m, f, t, every, '   ')).toBe('reason');
      expect(decideTransition(m, f, t, every, 'ok')).toBe('ok');
    }
  });

  it('nothing leaves a terminal state', () => {
    for (const m of [QUOTATION.ACCEPTED, JOB.CANCELLED, TEST.CANCELLED, REPORT.SUPERSEDED, INVOICE.CANCELLED]) expect(Object.keys(m)).toEqual([]);
  });
});
