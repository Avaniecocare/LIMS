import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { actorId, can } from '../../common/context.js';
import { istToday } from '../../common/india.js';
import { ReadPrismaService } from '../../core/prisma.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { dayEnd, dayStart, WHERE, type MisFilters } from '../mis/definitions.js';
import { MisService } from '../mis/mis.service.js';
import type { DashboardQuery } from './dashboard.dto.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1]));
  return p.toString() ? `?${p}` : '';
};
const reportLink = (key: string, o: Record<string, string | undefined> = {}) => `/reports/${key}${qs(o)}`;

/**
 * Dashboards never hold their own definition of a number: they count through the same report
 * functions and filters, and link to that report, so a figure and its report can't disagree.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: ReadPrismaService,
    private readonly mis: MisService,
    private readonly invoices: InvoicesService,
  ) {}

  async build(q: DashboardQuery) {
    const today = istToday();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const from = q.from ?? iso(monthStart);
    const to = q.to ?? iso(today);
    const f: MisFilters = { from, to };
    const [operations, quality, people, commercial, myWork] = await Promise.all([
      can('analytics.operations') ? this.operations(f, today) : null,
      can('analytics.quality') ? this.quality(f) : null,
      can('analytics.people') ? this.people(f, today) : null,
      can('analytics.commercial') ? this.commercial(f, today) : null,
      this.myWork(today),
    ]);
    return { from, to, operations, quality, people, commercial, myWork };
  }

  private async operations(f: MisFilters, today: Date) {
    const t = iso(today);
    const monthFrom = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
    const received = await this.mis.count('daily-collection-full', { from: t, to: t }, today);
    const receivedMonth = await this.mis.count('daily-collection-full', { from: monthFrom, to: t }, today);
    const crossed = await this.mis.count('tat-crossed', {}, today);
    const urgent = await this.mis.count('pending-samples', { urgent: 'true' }, today);
    const onHoldTests = await this.mis.count('result-pending', { status: 'ON_HOLD' }, today);
    const onHoldJobs = await this.db.job.count({ where: { deletedAt: null, status: 'ON_HOLD' } });
    // On time means approved on or before the due date, by the lab's calendar.
    const [{ total: approvedCount, onTime }] = await this.db.$queryRaw<{ total: number; onTime: number }[]>`
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ("approvedAt" AT TIME ZONE 'Asia/Kolkata')::date <= "dueDate")::int AS "onTime"
      FROM "SampleTest" WHERE "deletedAt" IS NULL AND "status" = 'APPROVED' AND "dueDate" IS NOT NULL AND "approvedAt" BETWEEN ${dayStart(f.from!)} AND ${dayEnd(f.to!)}`;
    const compliance = approvedCount ? Math.round((onTime / approvedCount) * 1000) / 10 : 0;
    const byStatus = await this.db.sample.groupBy({ by: ['status'], where: { deletedAt: null, status: { not: 'CANCELLED' } }, _count: true });
    const stages = await this.db.sampleTest.groupBy({ by: ['currentStage'], where: WHERE.resultPending({}), _count: true });
    return {
      metrics: [
        { key: 'received-today', label: 'Samples received today', value: received, display: null, link: reportLink('daily-collection-full', { from: t, to: t }) },
        { key: 'received-month', label: 'Samples this month', value: receivedMonth, display: null, link: reportLink('daily-collection-full', { from: monthFrom, to: t }) },
        { key: 'tat-crossed', label: 'TAT crossed', value: crossed, display: null, link: reportLink('tat-crossed') },
        { key: 'urgent-samples', label: 'Urgent samples open', value: urgent, display: null, link: reportLink('pending-samples', { urgent: 'true' }) },
        { key: 'jobs-on-hold', label: 'Jobs on hold', value: onHoldJobs, display: null, link: '/samples?status=ON_HOLD' },
        { key: 'tests-on-hold', label: 'Tests on hold', value: onHoldTests, display: null, link: reportLink('result-pending', { status: 'ON_HOLD' }) },
        { key: 'tat-compliance', label: 'TAT compliance', value: compliance, display: `${compliance}%`, link: reportLink('complete-test-detail', { from: f.from, to: f.to }) },
      ],
      samplesByStatus: byStatus.map((g) => ({ label: g.status, value: g._count, link: reportLink('sample-status', { status: g.status }) })),
      testsByStage: stages.filter((s) => s.currentStage).sort((x, y) => y._count - x._count).map((s) => ({ label: s.currentStage!, value: s._count, link: reportLink('result-pending', { stage: s.currentStage! }) })),
    };
  }

  private async quality(f: MisFilters) {
    const period = { gte: dayStart(f.from!), lte: dayEnd(f.to!) };
    const awaitingReview = await this.db.reportRevision.count({ where: { status: { in: ['DRAFT', 'IN_REVIEW'] } } });
    const awaitingApproval = await this.db.reportRevision.count({ where: { status: 'PENDING_APPROVAL' } });
    const rejections = await this.db.reportRejection.findMany({ where: { at: period }, select: { reason: true } });
    const testRejections = await this.db.statusEvent.findMany({ where: { entity: 'SampleTest', fromStatus: 'RESULTS_SUBMITTED', toStatus: 'IN_PROGRESS', at: period }, select: { reason: true } });
    const decided = await this.db.statusEvent.count({ where: { entity: 'SampleTest', fromStatus: 'RESULTS_SUBMITTED', at: period } });
    const rate = decided ? Math.round((testRejections.length / decided) * 1000) / 10 : 0;
    const revisions = await this.mis.count('revisions-issued', f);
    const reasons = new Map<string, number>();
    for (const r of [...rejections, ...testRejections]) reasons.set(r.reason ?? 'Not stated', (reasons.get(r.reason ?? 'Not stated') ?? 0) + 1);
    return {
      metrics: [
        { key: 'awaiting-review', label: 'Reports awaiting review', value: awaitingReview, display: null, link: '/approvals?tab=review' },
        { key: 'awaiting-approval', label: 'Reports awaiting approval', value: awaitingApproval, display: null, link: '/approvals?tab=sign' },
        { key: 'rejection-rate', label: 'Test rejection rate', value: rate, display: `${rate}%`, link: reportLink('technician-analysis', { from: f.from, to: f.to }) },
        { key: 'revisions-issued', label: 'Revisions issued', value: revisions, display: null, link: reportLink('revisions-issued', { from: f.from, to: f.to }) },
      ],
      rejectionReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, count]) => ({ reason, count })),
    };
  }

  private async people(f: MisFilters, today: Date) {
    const tech = (await this.mis['find']('performance-technician').run({ db: this.db, f, today, skip: 0, take: 50 })).rows;
    const inst = (await this.mis['find']('performance-machine').run({ db: this.db, f, today, skip: 0, take: 50 })).rows;
    const soon = new Date(today.getTime() + 30 * 86_400_000);
    const due = await this.db.instrument.findMany({ where: { deletedAt: null, isActive: true, calibrationDueAt: { lte: soon } }, orderBy: { calibrationDueAt: 'asc' }, take: 20 });
    return {
      byTechnician: tech.map((r) => ({ label: r.name, value: r.total, link: reportLink('performance-technician', { from: f.from, to: f.to }) })),
      byInstrument: inst.map((r) => ({ label: r.name, value: r.total, link: reportLink('performance-machine', { from: f.from, to: f.to }) })),
      calibrationsDue: due.map((i) => ({ id: i.id, name: i.name, dueDate: i.calibrationDueAt!, overdue: i.calibrationDueAt! < today })),
    };
  }

  private async commercial(f: MisFilters, today: Date) {
    const sent = await this.db.quotation.count({ where: { deletedAt: null, sentAt: { gte: dayStart(f.from!), lte: dayEnd(f.to!) } } });
    const accepted = await this.db.quotation.count({ where: { deletedAt: null, sentAt: { gte: dayStart(f.from!), lte: dayEnd(f.to!) }, status: 'ACCEPTED' } });
    const conversion = sent ? Math.round((accepted / sent) * 1000) / 10 : 0;
    const summary = await this.invoices.dueSummary({}, today);
    const invoices = await this.db.invoice.findMany({ where: WHERE.invoicesIssued(f), select: { grandTotal: true, invoiceDate: true } });
    const payments = await this.db.payment.findMany({ where: WHERE.paymentsReceived(f), select: { amount: true, paidOn: true } });
    const months = new Map<string, { billed: Decimal; collected: Decimal }>();
    const add = (d: Date, k: 'billed' | 'collected', v: unknown) => {
      const m = iso(d).slice(0, 7);
      const row = months.get(m) ?? { billed: new Decimal(0), collected: new Decimal(0) };
      row[k] = row[k].plus(String(v));
      months.set(m, row);
    };
    for (const i of invoices) add(i.invoiceDate!, 'billed', i.grandTotal);
    for (const p of payments) add(p.paidOn, 'collected', p.amount);
    const billed = invoices.reduce((s, i) => s.plus(String(i.grandTotal)), new Decimal(0));
    const collected = payments.reduce((s, p) => s.plus(String(p.amount)), new Decimal(0));
    const topCustomers = await this.db.$queryRaw<{ name: string; total: unknown }[]>`
      SELECT c."name" AS name, SUM(i."taxableAmount") AS total FROM "Invoice" i JOIN "Customer" c ON c."id" = i."customerId"
      WHERE i."deletedAt" IS NULL AND i."status" NOT IN ('DRAFT','CANCELLED') AND i."invoiceDate" BETWEEN ${new Date(f.from!)} AND ${new Date(f.to!)}
      GROUP BY c."name" ORDER BY total DESC LIMIT 10`;
    const topTests = await this.db.$queryRaw<{ name: string; total: unknown }[]>`
      SELECT t."testName" AS name, SUM(l."amount") AS total FROM "InvoiceLine" l JOIN "Invoice" i ON i."id" = l."invoiceId" JOIN "SampleTest" t ON t."id" = l."sampleTestId"
      WHERE i."deletedAt" IS NULL AND i."status" NOT IN ('DRAFT','CANCELLED') AND i."invoiceDate" BETWEEN ${new Date(f.from!)} AND ${new Date(f.to!)}
      GROUP BY t."testName" ORDER BY total DESC LIMIT 10`;
    const money = (d: Decimal) => d.toFixed(2);
    return {
      metrics: [
        { key: 'quotations-sent', label: 'Quotations sent', value: sent, display: null, link: reportLink('quotation-register', { from: f.from, to: f.to }) },
        { key: 'conversion', label: 'Conversion rate', value: conversion, display: `${conversion}%`, link: reportLink('quotation-register', { from: f.from, to: f.to, status: 'ACCEPTED' }) },
        { key: 'billed', label: 'Billed', value: billed.toNumber(), display: money(billed), link: reportLink('invoice-register', { from: f.from, to: f.to }) },
        { key: 'collected', label: 'Collected', value: collected.toNumber(), display: money(collected), link: reportLink('payment-register', { from: f.from, to: f.to }) },
        { key: 'outstanding', label: 'Outstanding', value: Number(summary.total), display: summary.total, link: reportLink('outstanding-ageing') },
      ],
      billedVsCollected: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, v]) => ({ label, billed: v.billed.toNumber(), collected: v.collected.toNumber() })),
      ageing: summary.ageing.map((a) => ({ label: a.bucket, value: Number(a.amount), link: `/due-invoices?bucket=${encodeURIComponent(a.bucket)}` })),
      topCustomers: topCustomers.map((r) => ({ label: r.name, value: Number(r.total), link: reportLink('invoice-register', { from: f.from, to: f.to }) })),
      topTests: topTests.map((r) => ({ label: r.name, value: Number(r.total), link: reportLink('invoice-register', { from: f.from, to: f.to }) })),
    };
  }

  /** The personal list: what is waiting on this user right now. */
  private async myWork(today: Date) {
    const me = actorId()!;
    const items: { key: string; label: string; count: number; link: string }[] = [];
    const add = (key: string, label: string, count: number, link: string) => {
      if (count) items.push({ key, label, count, link });
    };
    if (can('tests.work')) {
      add('my-open', 'Tests assigned to me', await this.db.sampleTest.count({ where: { deletedAt: null, assignedToId: me, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } } }), '/my-tests');
      add('my-overdue', 'My tests past due', await this.db.sampleTest.count({ where: { deletedAt: null, assignedToId: me, status: { in: ['ASSIGNED', 'IN_PROGRESS'] }, dueDate: { lt: today } } }), '/my-tests');
      add('my-sent-back', 'Sent back to me', await this.db.sampleTest.count({ where: { deletedAt: null, assignedToId: me, status: 'IN_PROGRESS', rejectionReason: { not: null } } }), '/my-tests');
    }
    if (can('tests.approve')) add('approve-tests', 'Results to approve', await this.db.sampleTest.count({ where: { deletedAt: null, status: 'RESULTS_SUBMITTED' } }), '/approvals?tab=results');
    if (can('reports.review')) add('review-reports', 'Reports to review', await this.db.reportRevision.count({ where: { status: { in: ['DRAFT', 'IN_REVIEW'] } } }), '/approvals?tab=review');
    if (can('reports.approve')) add('sign-reports', 'Reports to sign', await this.db.reportRevision.count({ where: { status: 'PENDING_APPROVAL' } }), '/approvals?tab=sign');
    if (can('reports.issue')) add('issue-reports', 'Reports to issue', await this.db.reportRevision.count({ where: { status: 'APPROVED' } }), '/approvals?tab=issue');
    if (can('planning.edit')) {
      add('to-plan', 'Tests to plan', await this.mis.count('pending-plan-detail', {}, today), '/planning?view=unplanned');
      add('to-assign', 'Tests to assign', await this.db.sampleTest.count({ where: { deletedAt: null, plannedAt: { not: null }, status: 'PLANNED' } }), '/planning?view=unassigned');
    }
    if (can('quotations.edit')) add('draft-quotations', 'Draft quotations', await this.db.quotation.count({ where: { deletedAt: null, status: 'DRAFT' } }), '/quotations?status=DRAFT');
    if (can('invoices.edit')) add('ready-invoice', 'Jobs ready to invoice', (await this.invoices.readyQueue({ page: 1, pageSize: 1 })).meta.total, '/invoices?tab=ready');
    if (can('invoices.view')) add('overdue-invoices', 'Overdue invoices', await this.db.invoice.count({ where: { deletedAt: null, status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: { lt: today } } }), '/due-invoices?overdue=true');
    return items;
  }
}
