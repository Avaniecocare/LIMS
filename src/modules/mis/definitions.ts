/* eslint-disable @typescript-eslint/no-explicit-any -- rows are shaped per report and described by their column list */
import { Prisma, type ReadPrismaService } from '../../core/prisma.service.js';
import { ageingBucket, daysOverdue } from '../invoices/ageing.js';
import { balanceOf } from '../invoices/invoices.service.js';

export interface MisFilters {
  from?: string;
  to?: string;
  customerId?: string;
  departmentId?: string;
  technicianId?: string;
  status?: string;
  urgent?: string;
  stage?: string;
}

export interface MisColumn {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'datetime' | 'number' | 'money';
  /** identity column: dropped for roles that can't see customer identity */
  customer?: boolean;
}

export interface MisContext {
  db: ReadPrismaService;
  f: MisFilters;
  today: Date;
  skip: number;
  take: number;
}

export interface MisReport {
  key: string;
  no: number;
  title: string;
  group: string;
  permission: 'mis.view' | 'mis.commercial';
  filters: ('date' | 'customer' | 'department' | 'technician' | 'status')[];
  columns: MisColumn[];
  run: (c: MisContext) => Promise<{ rows: any[]; total: number }>;
}

/** Whole-day IST bounds, so a date filter means the lab's day and not UTC's. */
export const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
export const dayEnd = (d: string) => new Date(`${d}T23:59:59.999+05:30`);
const between = (f: MisFilters) => (f.from || f.to ? { ...(f.from ? { gte: dayStart(f.from) } : {}), ...(f.to ? { lte: dayEnd(f.to) } : {}) } : undefined);
const betweenDates = (f: MisFilters) => (f.from || f.to ? { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) } : undefined);
/** Inclusive SQL bounds; open ends use a far date so every report accepts the same filters. */
const sqlFrom = (f: MisFilters) => (f.from ? dayStart(f.from) : new Date('2000-01-01'));
const sqlTo = (f: MisFilters) => (f.to ? dayEnd(f.to) : new Date('2100-01-01'));

const page = async <T>(find: (args: { skip: number; take: number }) => Promise<T[]>, count: () => Promise<number>, c: MisContext) => {
  const [rows, total] = await Promise.all([find({ skip: c.skip, take: c.take }), count()]);
  return { rows, total };
};

/** Aggregate reports compute all groups, then page in memory; they stay small by construction. */
const pageMemory = (rows: any[], c: MisContext) => ({ rows: rows.slice(c.skip, c.skip + c.take), total: rows.length });

/** ---- Shared definitions. The dashboard counts these same filters, so its numbers always match. ---- */
export const WHERE = {
  pendingSamples: (f: MisFilters): Prisma.SampleWhereInput => ({ deletedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] }, ...sampleFilter(f) }),
  tatCrossedTests: (f: MisFilters, today: Date): Prisma.SampleTestWhereInput => ({ deletedAt: null, status: { notIn: ['APPROVED', 'CANCELLED'] }, dueDate: { lt: today }, sample: { status: { not: 'CANCELLED' }, job: { status: { not: 'CANCELLED' } } }, ...testFilter(f) }),
  pendingPlan: (f: MisFilters): Prisma.SampleTestWhereInput => ({ deletedAt: null, plannedAt: null, status: { not: 'CANCELLED' }, sample: { status: { not: 'CANCELLED' }, job: { status: { not: 'CANCELLED' } } }, ...testFilter(f) }),
  resultPending: (f: MisFilters): Prisma.SampleTestWhereInput => ({ deletedAt: null, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] }, sample: { job: { status: { not: 'CANCELLED' } } }, ...testFilter(f) }),
  pendingTests: (f: MisFilters): Prisma.SampleTestWhereInput => ({ deletedAt: null, status: { notIn: ['APPROVED', 'CANCELLED'] }, sample: { status: { not: 'CANCELLED' }, job: { status: { not: 'CANCELLED' } } }, ...testFilter(f) }),
  samplesReceived: (f: MisFilters): Prisma.SampleWhereInput => ({ deletedAt: null, job: { deletedAt: null, ...(between(f) ? { receivedAt: between(f) } : {}), ...(f.customerId ? { customerId: f.customerId } : {}) } }),
  invoicesIssued: (f: MisFilters): Prisma.InvoiceWhereInput => ({ deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] }, ...(betweenDates(f) ? { invoiceDate: betweenDates(f) } : {}), ...(f.customerId ? { customerId: f.customerId } : {}) }),
  paymentsReceived: (f: MisFilters): Prisma.PaymentWhereInput => ({ deletedAt: null, ...(betweenDates(f) ? { paidOn: betweenDates(f) } : {}), ...(f.customerId ? { customerId: f.customerId } : {}) }),
  quotations: (f: MisFilters): Prisma.QuotationWhereInput => ({ deletedAt: null, ...(between(f) ? { createdAt: between(f) } : {}), ...(f.customerId ? { customerId: f.customerId } : {}), ...(f.status ? { status: f.status as never } : {}) }),
  outstanding: (f: MisFilters): Prisma.InvoiceWhereInput => ({ deletedAt: null, status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, ...(f.customerId ? { customerId: f.customerId } : {}) }),
};

function sampleFilter(f: MisFilters): Prisma.SampleWhereInput {
  return {
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.customerId || between(f) || f.urgent === 'true' ? { job: { ...(f.customerId ? { customerId: f.customerId } : {}), ...(between(f) ? { receivedAt: between(f) } : {}), ...(f.urgent === 'true' ? { urgent: true } : {}) } } : {}),
    ...(f.departmentId || f.technicianId ? { tests: { some: { ...(f.departmentId ? { departmentId: f.departmentId } : {}), ...(f.technicianId ? { assignedToId: f.technicianId } : {}) } } } : {}),
  };
}

function testFilter(f: MisFilters): Prisma.SampleTestWhereInput {
  return {
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.stage ? { currentStage: f.stage } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.technicianId ? { assignedToId: f.technicianId } : {}),
    ...(f.customerId ? { sample: { job: { customerId: f.customerId } } } : {}),
  };
}

const sampleInclude = { job: { select: { jobNo: true, urgent: true, receivedAt: true, customer: { select: { name: true } } } }, _count: { select: { tests: { where: { deletedAt: null, status: { not: 'CANCELLED' as const } } } } } };
const sampleRow = (s: any) => ({ sampleNo: s.sampleNo, jobNo: s.job.jobNo, customer: s.job.customer.name, description: s.description, status: s.status, urgent: s.job.urgent ? 'Yes' : 'No', receivedAt: s.job.receivedAt, tests: s._count.tests, condition: s.condition, quantity: s.quantity, size: s.size });
const sampleColumns: MisColumn[] = [
  { key: 'sampleNo', label: 'Sample no.' }, { key: 'jobNo', label: 'Job no.' }, { key: 'customer', label: 'Customer', customer: true }, { key: 'description', label: 'Description' }, { key: 'status', label: 'Status' }, { key: 'urgent', label: 'Urgent' }, { key: 'receivedAt', label: 'Received', type: 'datetime' }, { key: 'tests', label: 'Tests', type: 'number' },
];

const testInclude = { sample: { select: { sampleNo: true, description: true, job: { select: { jobNo: true, customer: { select: { name: true } } } } } }, assignedTo: { select: { name: true } }, instrument: { select: { name: true } } };
const testRow = (t: any) => ({ sampleNo: t.sample.sampleNo, jobNo: t.sample.job.jobNo, customer: t.sample.job.customer.name, testName: t.testName, methodName: t.methodName, status: t.status, urgent: t.urgent ? 'Yes' : 'No', dueDate: t.dueDate, plannedAt: t.plannedAt, technician: t.assignedTo?.name ?? null, instrument: t.instrument?.name ?? null, submittedAt: t.submittedAt, approvedAt: t.approvedAt, conductedBy: t.conductedByName });
const testColumns: MisColumn[] = [
  { key: 'sampleNo', label: 'Sample no.' }, { key: 'jobNo', label: 'Job no.' }, { key: 'customer', label: 'Customer', customer: true }, { key: 'testName', label: 'Test' }, { key: 'status', label: 'Status' }, { key: 'urgent', label: 'Urgent' }, { key: 'dueDate', label: 'Due', type: 'date' }, { key: 'technician', label: 'Technician' }, { key: 'instrument', label: 'Instrument' },
];


async function performance(c: MisContext, by: 'instrument' | 'technician') {
  const column = by === 'instrument' ? Prisma.sql`t."instrumentId"` : Prisma.sql`t."assignedToId"`;
  const join = by === 'instrument' ? Prisma.sql`JOIN "Instrument" g ON g."id" = t."instrumentId"` : Prisma.sql`JOIN "User" g ON g."id" = t."assignedToId"`;
  const rows = await c.db.$queryRaw<any[]>`
    SELECT g."name" AS name,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE t."status" = 'APPROVED')::int AS approved,
      COUNT(*) FILTER (WHERE t."status" IN ('IN_PROGRESS','RESULTS_SUBMITTED'))::int AS "inProgress",
      COUNT(*) FILTER (WHERE t."status" NOT IN ('APPROVED','CANCELLED') AND t."dueDate" < ${c.today})::int AS overdue,
      COUNT(*) FILTER (WHERE t."approvedAt" IS NOT NULL AND t."approvedAt"::date <= t."dueDate")::int AS "onTime",
      ROUND(AVG(EXTRACT(EPOCH FROM (t."approvedAt" - t."startedAt")) / 3600) FILTER (WHERE t."approvedAt" IS NOT NULL AND t."startedAt" IS NOT NULL)::numeric, 1) AS "avgHours"
    FROM "SampleTest" t ${join}
    WHERE t."deletedAt" IS NULL AND t."status" <> 'CANCELLED' AND ${column} IS NOT NULL
      AND t."createdAt" BETWEEN ${sqlFrom(c.f)} AND ${sqlTo(c.f)}
      AND (${c.f.departmentId ?? null}::text IS NULL OR t."departmentId" = ${c.f.departmentId ?? null})
      AND (${c.f.technicianId ?? null}::text IS NULL OR t."assignedToId" = ${c.f.technicianId ?? null})
    GROUP BY g."name" ORDER BY total DESC`;
  return pageMemory(rows.map((r) => ({ ...r, avgHours: r.avgHours === null ? null : Number(r.avgHours) })), c);
}

async function collector(c: MisContext, bucket: 'day' | 'month', withReceiver: boolean) {
  const trunc = bucket === 'day' ? Prisma.sql`to_char(j."receivedAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')` : Prisma.sql`to_char(j."receivedAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`;
  const rows = await c.db.$queryRaw<any[]>`
    SELECT ${trunc} AS period, ${withReceiver ? Prisma.sql`COALESCE(u."name", 'Unknown')` : Prisma.sql`''`} AS collector,
      COUNT(DISTINCT j."id")::int AS jobs, COUNT(s."id")::int AS samples,
      COUNT(s."id") FILTER (WHERE j."urgent")::int AS urgent
    FROM "Job" j JOIN "Sample" s ON s."jobId" = j."id" AND s."deletedAt" IS NULL LEFT JOIN "User" u ON u."id" = j."receivedById"
    WHERE j."deletedAt" IS NULL AND j."receivedAt" BETWEEN ${sqlFrom(c.f)} AND ${sqlTo(c.f)}
      AND (${c.f.customerId ?? null}::text IS NULL OR j."customerId" = ${c.f.customerId ?? null})
    GROUP BY 1, 2 ORDER BY 1 DESC, 2`;
  return pageMemory(rows, c);
}

export const REPORTS: MisReport[] = [
  {
    key: 'pending-samples', no: 1, title: 'Pending Sample Report', group: 'Samples', permission: 'mis.view', filters: ['date', 'customer', 'department', 'technician', 'status'], columns: sampleColumns,
    run: (c) => page((a) => c.db.sample.findMany({ where: WHERE.pendingSamples(c.f), include: sampleInclude, orderBy: { createdAt: 'asc' }, ...a }).then((r) => r.map(sampleRow)), () => c.db.sample.count({ where: WHERE.pendingSamples(c.f) }), c),
  },
  {
    key: 'tat-crossed', no: 2, title: 'TAT Crossed Sample Report', group: 'Samples', permission: 'mis.view', filters: ['customer', 'department', 'technician'], columns: [...testColumns, { key: 'daysLate', label: 'Days late', type: 'number' }],
    run: (c) => page((a) => c.db.sampleTest.findMany({ where: WHERE.tatCrossedTests(c.f, c.today), include: testInclude, orderBy: { dueDate: 'asc' }, ...a }).then((r) => r.map((t) => ({ ...testRow(t), daysLate: daysOverdue(t.dueDate!, c.today) }))), () => c.db.sampleTest.count({ where: WHERE.tatCrossedTests(c.f, c.today) }), c),
  },
  {
    key: 'performance-machine', no: 3, title: 'Performance Analysis: Machine-wise', group: 'Performance', permission: 'mis.view', filters: ['date', 'department'],
    columns: [{ key: 'name', label: 'Instrument' }, { key: 'total', label: 'Tests', type: 'number' }, { key: 'approved', label: 'Approved', type: 'number' }, { key: 'inProgress', label: 'In progress', type: 'number' }, { key: 'overdue', label: 'Overdue', type: 'number' }, { key: 'onTime', label: 'On time', type: 'number' }, { key: 'avgHours', label: 'Avg hours', type: 'number' }],
    run: (c) => performance(c, 'instrument'),
  },
  {
    key: 'performance-technician', no: 4, title: 'Performance Analysis: Technician-wise', group: 'Performance', permission: 'mis.view', filters: ['date', 'department', 'technician'],
    columns: [{ key: 'name', label: 'Technician' }, { key: 'total', label: 'Tests', type: 'number' }, { key: 'approved', label: 'Approved', type: 'number' }, { key: 'inProgress', label: 'In progress', type: 'number' }, { key: 'overdue', label: 'Overdue', type: 'number' }, { key: 'onTime', label: 'On time', type: 'number' }, { key: 'avgHours', label: 'Avg hours', type: 'number' }],
    run: (c) => performance(c, 'technician'),
  },
  {
    key: 'daily-collection-summary', no: 5, title: 'Daily Sample Collection Summary', group: 'Samples', permission: 'mis.view', filters: ['date', 'customer'],
    columns: [{ key: 'period', label: 'Date' }, { key: 'jobs', label: 'Jobs', type: 'number' }, { key: 'samples', label: 'Samples', type: 'number' }, { key: 'urgent', label: 'Urgent samples', type: 'number' }],
    run: (c) => collector(c, 'day', false),
  },
  {
    key: 'daily-collection-full', no: 6, title: 'Daily Sample Collection Full', group: 'Samples', permission: 'mis.view', filters: ['date', 'customer'], columns: sampleColumns,
    run: (c) => page((a) => c.db.sample.findMany({ where: WHERE.samplesReceived(c.f), include: sampleInclude, orderBy: { createdAt: 'desc' }, ...a }).then((r) => r.map(sampleRow)), () => c.db.sample.count({ where: WHERE.samplesReceived(c.f) }), c),
  },
  {
    key: 'daily-sample-detail', no: 7, title: 'Daily Sample Detail', group: 'Samples', permission: 'mis.view', filters: ['date', 'customer'],
    columns: [...sampleColumns, { key: 'condition', label: 'Condition' }, { key: 'quantity', label: 'Quantity' }, { key: 'size', label: 'Size' }, { key: 'attributes', label: 'Details' }],
    run: (c) => page((a) => c.db.sample.findMany({ where: WHERE.samplesReceived(c.f), include: { ...sampleInclude, attributes: true }, orderBy: { createdAt: 'desc' }, ...a }).then((r) => r.map((s) => ({ ...sampleRow(s), attributes: s.attributes.map((x) => `${x.label}: ${x.value}`).join('; ') }))), () => c.db.sample.count({ where: WHERE.samplesReceived(c.f) }), c),
  },
  {
    key: 'daily-plan-detail', no: 8, title: 'Daily Plan Detail', group: 'Planning', permission: 'mis.view', filters: ['date', 'customer', 'department', 'technician'], columns: [...testColumns, { key: 'plannedAt', label: 'Planned', type: 'datetime' }],
    run: (c) => {
      const where: Prisma.SampleTestWhereInput = { deletedAt: null, plannedAt: between(c.f) ?? { not: null }, ...testFilter(c.f) };
      return page((a) => c.db.sampleTest.findMany({ where, include: testInclude, orderBy: { plannedAt: 'desc' }, ...a }).then((r) => r.map(testRow)), () => c.db.sampleTest.count({ where }), c);
    },
  },
  {
    key: 'pending-plan-detail', no: 9, title: 'Pending Plan Detail', group: 'Planning', permission: 'mis.view', filters: ['customer', 'department'], columns: testColumns.filter((x) => !['dueDate', 'technician', 'instrument'].includes(x.key)),
    run: (c) => page((a) => c.db.sampleTest.findMany({ where: WHERE.pendingPlan(c.f), include: testInclude, orderBy: { createdAt: 'asc' }, ...a }).then((r) => r.map(testRow)), () => c.db.sampleTest.count({ where: WHERE.pendingPlan(c.f) }), c),
  },
  {
    key: 'daily-test-results', no: 10, title: 'Daily Test Result Detail', group: 'Testing', permission: 'mis.view', filters: ['date', 'customer', 'department', 'technician'],
    columns: [{ key: 'sampleNo', label: 'Sample no.' }, { key: 'customer', label: 'Customer', customer: true }, { key: 'testName', label: 'Test' }, { key: 'parameter', label: 'Parameter' }, { key: 'value', label: 'Result' }, { key: 'unit', label: 'Unit' }, { key: 'pass', label: 'Pass/Fail' }, { key: 'conductedBy', label: 'Conducted by' }, { key: 'submittedAt', label: 'Submitted', type: 'datetime' }],
    run: (c) => {
      const where: Prisma.ParameterResultWhereInput = { sampleTest: { deletedAt: null, status: { in: ['RESULTS_SUBMITTED', 'APPROVED'] }, submittedAt: between(c.f) ?? { not: null }, ...testFilter(c.f) } };
      return page(
        (a) => c.db.parameterResult.findMany({ where, include: { sampleTest: { include: testInclude } }, orderBy: [{ sampleTest: { submittedAt: 'desc' } }, { sortOrder: 'asc' }], ...a }).then((rows) => rows.map((r) => ({ sampleNo: r.sampleTest.sample.sampleNo, customer: r.sampleTest.sample.job.customer.name, testName: r.sampleTest.testName, parameter: r.name, value: r.numericValue !== null ? String(r.numericValue) : r.textValue, unit: r.unit, pass: r.passPrimary === null ? '' : r.passPrimary ? 'Pass' : 'Fail', conductedBy: r.sampleTest.conductedByName, submittedAt: r.sampleTest.submittedAt }))),
        () => c.db.parameterResult.count({ where }),
        c,
      );
    },
  },
  {
    key: 'result-pending', no: 11, title: 'Test Result Pending Detail', group: 'Testing', permission: 'mis.view', filters: ['customer', 'department', 'technician', 'status'], columns: testColumns,
    run: (c) => page((a) => c.db.sampleTest.findMany({ where: WHERE.resultPending(c.f), include: testInclude, orderBy: { dueDate: 'asc' }, ...a }).then((r) => r.map(testRow)), () => c.db.sampleTest.count({ where: WHERE.resultPending(c.f) }), c),
  },
  {
    key: 'pending-tests-summary', no: 12, title: 'Pending Tests Summary', group: 'Testing', permission: 'mis.view', filters: ['customer', 'department', 'technician'],
    columns: [{ key: 'testName', label: 'Test' }, { key: 'status', label: 'Status' }, { key: 'count', label: 'Tests', type: 'number' }],
    run: async (c) => {
      const groups = await c.db.sampleTest.groupBy({ by: ['testName', 'status'], where: WHERE.pendingTests(c.f), _count: true, orderBy: [{ testName: 'asc' }, { status: 'asc' }] });
      return pageMemory(groups.map((g) => ({ testName: g.testName, status: g.status, count: g._count })), c);
    },
  },
  {
    key: 'sample-status', no: 13, title: 'Sample Status Detail', group: 'Samples', permission: 'mis.view', filters: ['date', 'customer', 'department', 'status'], columns: sampleColumns,
    run: (c) => {
      const where: Prisma.SampleWhereInput = { deletedAt: null, ...sampleFilter(c.f) };
      return page((a) => c.db.sample.findMany({ where, include: sampleInclude, orderBy: { createdAt: 'desc' }, ...a }).then((r) => r.map(sampleRow)), () => c.db.sample.count({ where }), c);
    },
  },
  {
    key: 'collector-detail', no: 14, title: 'Daily Sample Collector: Detail', group: 'Collectors', permission: 'mis.view', filters: ['date', 'customer'],
    columns: [{ key: 'collector', label: 'Collected by' }, ...sampleColumns],
    run: async (c) => {
      const res = await page((a) => c.db.sample.findMany({ where: WHERE.samplesReceived(c.f), include: { ...sampleInclude, job: { select: { ...sampleInclude.job.select, receivedById: true } } }, orderBy: { createdAt: 'desc' }, ...a }), () => c.db.sample.count({ where: WHERE.samplesReceived(c.f) }), c);
      const users = new Map((await c.db.user.findMany({ where: { id: { in: res.rows.map((r) => r.job.receivedById).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      return { rows: res.rows.map((s) => ({ ...sampleRow(s), collector: users.get(s.job.receivedById ?? '') ?? 'Unknown' })), total: res.total };
    },
  },
  {
    key: 'collector-daily', no: 15, title: 'Daily Sample Collector: Summary', group: 'Collectors', permission: 'mis.view', filters: ['date', 'customer'],
    columns: [{ key: 'period', label: 'Date' }, { key: 'collector', label: 'Collected by' }, { key: 'jobs', label: 'Jobs', type: 'number' }, { key: 'samples', label: 'Samples', type: 'number' }],
    run: (c) => collector(c, 'day', true),
  },
  {
    key: 'collector-monthly', no: 16, title: 'Monthly Sample Collector: Summary', group: 'Collectors', permission: 'mis.view', filters: ['date', 'customer'],
    columns: [{ key: 'period', label: 'Month' }, { key: 'collector', label: 'Collected by' }, { key: 'jobs', label: 'Jobs', type: 'number' }, { key: 'samples', label: 'Samples', type: 'number' }],
    run: (c) => collector(c, 'month', true),
  },
  {
    key: 'technician-analysis', no: 17, title: 'Technician Analysis', group: 'Performance', permission: 'mis.view', filters: ['date', 'department', 'technician'],
    columns: [{ key: 'name', label: 'Technician' }, { key: 'assigned', label: 'Assigned', type: 'number' }, { key: 'submitted', label: 'Submitted', type: 'number' }, { key: 'approved', label: 'Approved', type: 'number' }, { key: 'sentBack', label: 'Sent back', type: 'number' }, { key: 'firstPassPct', label: 'First-pass %', type: 'number' }],
    run: async (c) => {
      const rows = await c.db.$queryRaw<any[]>`
        SELECT u."name" AS name, COUNT(*)::int AS assigned,
          COUNT(*) FILTER (WHERE t."submittedAt" IS NOT NULL OR t."status" = 'APPROVED')::int AS submitted,
          COUNT(*) FILTER (WHERE t."status" = 'APPROVED')::int AS approved,
          COALESCE(SUM((SELECT COUNT(*) FROM "StatusEvent" e WHERE e."entity" = 'SampleTest' AND e."entityId" = t."id" AND e."fromStatus" = 'RESULTS_SUBMITTED' AND e."toStatus" = 'IN_PROGRESS')), 0)::int AS "sentBack"
        FROM "SampleTest" t JOIN "User" u ON u."id" = t."assignedToId"
        WHERE t."deletedAt" IS NULL AND t."status" <> 'CANCELLED' AND t."createdAt" BETWEEN ${sqlFrom(c.f)} AND ${sqlTo(c.f)}
          AND (${c.f.departmentId ?? null}::text IS NULL OR t."departmentId" = ${c.f.departmentId ?? null})
          AND (${c.f.technicianId ?? null}::text IS NULL OR t."assignedToId" = ${c.f.technicianId ?? null})
        GROUP BY u."name" ORDER BY assigned DESC`;
      return pageMemory(rows.map((r) => ({ ...r, firstPassPct: r.submitted ? Math.round(((r.submitted - Math.min(r.sentBack, r.submitted)) / r.submitted) * 100) : null })), c);
    },
  },
  {
    key: 'pending-by-test', no: 18, title: 'Pending Test Detail by Test', group: 'Testing', permission: 'mis.view', filters: ['customer', 'department', 'technician'], columns: [{ key: 'testName', label: 'Test' }, ...testColumns.filter((x) => x.key !== 'testName')],
    run: (c) => page((a) => c.db.sampleTest.findMany({ where: WHERE.pendingTests(c.f), include: testInclude, orderBy: [{ testName: 'asc' }, { dueDate: 'asc' }], ...a }).then((r) => r.map(testRow)), () => c.db.sampleTest.count({ where: WHERE.pendingTests(c.f) }), c),
  },
  {
    key: 'complete-test-detail', no: 19, title: 'Complete Test Detail', group: 'Testing', permission: 'mis.view', filters: ['date', 'customer', 'department', 'technician'],
    columns: [...testColumns.filter((x) => x.key !== 'status'), { key: 'methodName', label: 'Method' }, { key: 'conductedBy', label: 'Conducted by' }, { key: 'submittedAt', label: 'Submitted', type: 'datetime' }, { key: 'approvedAt', label: 'Approved', type: 'datetime' }],
    run: (c) => {
      const where: Prisma.SampleTestWhereInput = { deletedAt: null, status: 'APPROVED', ...(between(c.f) ? { approvedAt: between(c.f) } : {}), ...testFilter(c.f) };
      return page((a) => c.db.sampleTest.findMany({ where, include: testInclude, orderBy: { approvedAt: 'desc' }, ...a }).then((r) => r.map(testRow)), () => c.db.sampleTest.count({ where }), c);
    },
  },
  {
    key: 'sample-returnable', no: 20, title: 'Sample Returnable Status', group: 'Samples', permission: 'mis.view', filters: ['date', 'customer'],
    columns: [{ key: 'sampleNo', label: 'Sample no.' }, { key: 'jobNo', label: 'Job no.' }, { key: 'customer', label: 'Customer', customer: true }, { key: 'description', label: 'Description' }, { key: 'returnStatus', label: 'Return status' }, { key: 'returnedAt', label: 'Returned', type: 'date' }, { key: 'retentionUntil', label: 'Retain until', type: 'date' }, { key: 'disposedAt', label: 'Disposed', type: 'date' }],
    run: (c) => {
      const where: Prisma.SampleWhereInput = { ...WHERE.samplesReceived(c.f), returnable: true };
      return page((a) => c.db.sample.findMany({ where, include: sampleInclude, orderBy: { createdAt: 'desc' }, ...a }).then((r) => r.map((s) => ({ ...sampleRow(s), returnStatus: s.returnedAt ? s.returnStatus : 'Pending', returnedAt: s.returnedAt, retentionUntil: s.retentionUntil, disposedAt: s.disposedAt }))), () => c.db.sample.count({ where }), c);
    },
  },
  {
    key: 'quotation-register', no: 21, title: 'Quotation Register', group: 'Commercial', permission: 'mis.commercial', filters: ['date', 'customer', 'status'],
    columns: [{ key: 'quotationNo', label: 'Quotation no.' }, { key: 'createdAt', label: 'Date', type: 'date' }, { key: 'customer', label: 'Customer', customer: true }, { key: 'status', label: 'Status' }, { key: 'versionNo', label: 'Version', type: 'number' }, { key: 'validUntil', label: 'Valid until', type: 'date' }, { key: 'grandTotal', label: 'Total', type: 'money' }],
    run: (c) => page((a) => c.db.quotation.findMany({ where: WHERE.quotations(c.f), include: { customer: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, ...a }).then((r) => r.map((q) => ({ quotationNo: q.quotationNo, createdAt: q.createdAt, customer: q.customer.name, status: q.status, versionNo: q.currentVersionNo, validUntil: q.validUntil, grandTotal: String(q.grandTotal) }))), () => c.db.quotation.count({ where: WHERE.quotations(c.f) }), c),
  },
  {
    key: 'invoice-register', no: 22, title: 'Invoice Register with GST Summary', group: 'Commercial', permission: 'mis.commercial', filters: ['date', 'customer'],
    columns: [{ key: 'invoiceNo', label: 'Invoice no.' }, { key: 'invoiceDate', label: 'Date', type: 'date' }, { key: 'customer', label: 'Customer', customer: true }, { key: 'gstin', label: 'GSTIN' }, { key: 'placeOfSupply', label: 'Place of supply' }, { key: 'taxable', label: 'Taxable', type: 'money' }, { key: 'cgst', label: 'CGST', type: 'money' }, { key: 'sgst', label: 'SGST', type: 'money' }, { key: 'igst', label: 'IGST', type: 'money' }, { key: 'roundOff', label: 'Round off', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'status', label: 'Status' }],
    run: (c) => page((a) => c.db.invoice.findMany({ where: WHERE.invoicesIssued(c.f), include: { customer: { select: { name: true, gstin: true } } }, orderBy: { invoiceDate: 'desc' }, ...a }).then((r) => r.map((i) => ({ invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, customer: i.customer.name, gstin: i.customer.gstin, placeOfSupply: `${i.placeOfSupply} (${i.placeOfSupplyCode})`, taxable: String(i.taxableAmount), cgst: String(i.cgst), sgst: String(i.sgst), igst: String(i.igst), roundOff: String(i.roundOff), total: String(i.grandTotal), status: i.status }))), () => c.db.invoice.count({ where: WHERE.invoicesIssued(c.f) }), c),
  },
  {
    key: 'payment-register', no: 23, title: 'Payment Register', group: 'Commercial', permission: 'mis.commercial', filters: ['date', 'customer'],
    columns: [{ key: 'paymentNo', label: 'Receipt no.' }, { key: 'paidOn', label: 'Date', type: 'date' }, { key: 'customer', label: 'Customer', customer: true }, { key: 'mode', label: 'Mode' }, { key: 'reference', label: 'Reference' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'unapplied', label: 'On account', type: 'money' }],
    run: (c) => page((a) => c.db.payment.findMany({ where: WHERE.paymentsReceived(c.f), include: { customer: { select: { name: true } } }, orderBy: { paidOn: 'desc' }, ...a }).then((r) => r.map((p) => ({ paymentNo: p.paymentNo, paidOn: p.paidOn, customer: p.customer.name, mode: p.mode, reference: p.reference, amount: String(p.amount), unapplied: String(p.unapplied) }))), () => c.db.payment.count({ where: WHERE.paymentsReceived(c.f) }), c),
  },
  {
    key: 'revisions-issued', no: 25, title: 'Report Revisions Issued', group: 'Quality', permission: 'mis.view', filters: ['date', 'customer'],
    columns: [{ key: 'reportNo', label: 'Report no.' }, { key: 'revisionNo', label: 'Revision', type: 'number' }, { key: 'customer', label: 'Customer', customer: true }, { key: 'reason', label: 'Reason' }, { key: 'issuedAt', label: 'Issued', type: 'datetime' }],
    run: (c) => {
      const where: Prisma.ReportRevisionWhereInput = { revisionNo: { gt: 0 }, issuedAt: between(c.f) ?? { not: null }, ...(c.f.customerId ? { report: { sample: { job: { customerId: c.f.customerId } } } } : {}) };
      return page((a) => c.db.reportRevision.findMany({ where, include: { report: { select: { reportNo: true, sample: { select: { job: { select: { customer: { select: { name: true } } } } } } } } }, orderBy: { issuedAt: 'desc' }, ...a }).then((r) => r.map((v) => ({ reportNo: v.report.reportNo, revisionNo: v.revisionNo, customer: v.report.sample.job.customer.name, reason: v.revisionReason, issuedAt: v.issuedAt }))), () => c.db.reportRevision.count({ where }), c);
    },
  },
  {
    key: 'outstanding-ageing', no: 24, title: 'Outstanding and Ageing Report', group: 'Commercial', permission: 'mis.commercial', filters: ['customer'],
    columns: [{ key: 'customer', label: 'Customer', customer: true }, { key: 'invoiceNo', label: 'Invoice no.' }, { key: 'invoiceDate', label: 'Date', type: 'date' }, { key: 'dueDate', label: 'Due', type: 'date' }, { key: 'total', label: 'Amount', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' }, { key: 'daysOverdue', label: 'Days overdue', type: 'number' }, { key: 'bucket', label: 'Ageing' }],
    run: (c) => page((a) => c.db.invoice.findMany({ where: WHERE.outstanding(c.f), include: { customer: { select: { name: true } } }, orderBy: { dueDate: 'asc' }, ...a }).then((r) => r.map((i) => ({ customer: i.customer.name, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, dueDate: i.dueDate, total: String(i.grandTotal), paid: String(i.paidAmount), balance: balanceOf(i).toFixed(2), daysOverdue: Math.max(0, daysOverdue(i.dueDate!, c.today)), bucket: ageingBucket(i.dueDate!, c.today) }))), () => c.db.invoice.count({ where: WHERE.outstanding(c.f) }), c),
  },
];

