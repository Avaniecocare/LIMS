import { Injectable, OnModuleInit } from '@nestjs/common';
import { can } from '../../common/context.js';
import { badRequest, notFound } from '../../common/errors.js';
import { istToday, isValidGstin, PAN_RE } from '../../common/india.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { AuditService } from '../../core/audit.service.js';
import { NumberingService } from '../../core/numbering.service.js';
import { Prisma, PrismaService, updateVersioned, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { DocumentsService, requirePermission, XLSX_MIME } from '../documents/documents.service.js';
import { buildWorkbook } from '../masters/excel.js';
import type { AddressInput, ContactInput, CreateCustomerDto, CustomerQuery, CustomerSummaryDto, CustomerTestsQuery, UpdateCustomerDto } from './customers.dto.js';

const include = { contacts: { where: { deletedAt: null } }, addresses: { where: { deletedAt: null } } } as const;
type Row = Prisma.CustomerGetPayload<{ include: typeof include }>;

const toDto = (c: Row) => ({
  id: c.id, crn: c.crn, name: c.name, gstin: c.gstin, pan: c.pan, stateName: c.stateName, stateCode: c.stateCode, creditDays: c.creditDays,
  withholdReportUntilPaid: c.withholdReportUntilPaid, notes: c.notes, isActive: c.isActive, version: c.version, contacts: c.contacts, addresses: c.addresses,
});

@Injectable()
export class CustomersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    this.documents.register('customer-export', {
      // Every customer's contacts (or every unpaid amount) in one file: confirm the password first.
      sensitive: true,
      authorize: requirePermission('customers.view'),
      run: async () => {
        const rows = await this.prisma.customer.findMany({ where: { deletedAt: null }, orderBy: { crn: 'asc' } });
        const buffer = await buildWorkbook([
          {
            name: 'Customers',
            columns: [
              { header: 'CRN', key: 'crn' }, { header: 'Name', key: 'name', width: 36 }, { header: 'GSTIN', key: 'gstin', width: 18 }, { header: 'PAN', key: 'pan' },
              { header: 'State', key: 'stateName' }, { header: 'State code', key: 'stateCode' }, { header: 'Credit days', key: 'creditDays' }, { header: 'Active', key: 'isActive' },
            ],
            rows,
          },
        ]);
        return { buffer, filename: 'customers.xlsx', mimeType: XLSX_MIME };
      },
    });
  }

  private validate(dto: CreateCustomerDto) {
    if (dto.gstin) {
      if (!isValidGstin(dto.gstin)) throw badRequest('That GSTIN is not valid', [{ field: 'gstin', message: 'Not a valid GSTIN' }]);
      if (dto.gstin.slice(0, 2) !== dto.stateCode) throw badRequest('The GSTIN belongs to a different state', [{ field: 'gstin', message: 'State code does not match the GSTIN' }]);
    }
    if (dto.pan && !PAN_RE.test(dto.pan)) throw badRequest('That PAN is not valid', [{ field: 'pan', message: 'Not a valid PAN' }]);
    if (dto.contacts && dto.contacts.filter((c) => c.isPrimary).length > 1) throw badRequest('Only one primary contact is allowed', [{ field: 'contacts', message: 'Only one primary contact' }]);
  }

  async list(q: CustomerQuery) {
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(q.active === 'false' ? { isActive: false } : q.active === 'all' ? {} : { isActive: true }),
      ...(q.stateCode ? { stateCode: q.stateCode } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { crn: { contains: q.q, mode: 'insensitive' } }, { gstin: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({ where, include, orderBy: orderBy(q, ['name', 'crn', 'stateName', 'creditDays'], 'name', 'asc'), ...skipTake(q) }),
      this.prisma.customer.count({ where }),
    ]);
    return toPage(rows.map(toDto), total, q);
  }

  async get(id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, deletedAt: null }, include });
    if (!c) throw notFound('Customer');
    return toDto(c);
  }

  async create(dto: CreateCustomerDto) {
    this.validate(dto);
    const defaultCredit = await this.settings.get('credit.defaultDays');
    return this.prisma.$transaction(async (tx) => {
      const crn = await this.numbering.next(tx, 'CUSTOMER');
      const c = await tx.customer.create({
        data: {
          crn,
          name: dto.name,
          gstin: dto.gstin || null,
          pan: dto.pan || null,
          stateName: dto.stateName,
          stateCode: dto.stateCode,
          creditDays: dto.creditDays ?? defaultCredit,
          withholdReportUntilPaid: dto.withholdReportUntilPaid ?? false,
          notes: dto.notes,
          contacts: dto.contacts ? { create: dto.contacts.map(contactData) } : undefined,
          addresses: dto.addresses ? { create: dto.addresses.map(addressData) } : undefined,
        },
        include,
      });
      await this.audit.record({ action: 'Customer.create', entity: 'Customer', entityId: c.id, after: toDto(c) }, tx);
      return toDto(c);
    });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    this.validate(dto);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.customer.findFirst({ where: { id, deletedAt: null }, include });
      if (!before) throw notFound('Customer');
      await updateVersioned(tx.customer as never, id, dto.version, {
        name: dto.name,
        gstin: dto.gstin || null,
        pan: dto.pan || null,
        stateName: dto.stateName,
        stateCode: dto.stateCode,
        creditDays: dto.creditDays,
        withholdReportUntilPaid: dto.withholdReportUntilPaid,
        notes: dto.notes,
        isActive: dto.isActive,
      });
      if (dto.contacts) await this.syncContacts(tx, id, dto.contacts);
      if (dto.addresses) await this.syncAddresses(tx, id, dto.addresses);
      const after = await tx.customer.findUniqueOrThrow({ where: { id }, include });
      await this.audit.record({ action: 'Customer.update', entity: 'Customer', entityId: id, before: toDto(before), after: toDto(after) }, tx);
      return toDto(after);
    });
  }

  /** Rows missing from the submitted list are soft deleted; history keeps its snapshots. */
  private async syncContacts(tx: Tx, customerId: string, contacts: ContactInput[]) {
    const keep = contacts.filter((c) => c.id).map((c) => c.id!);
    await tx.customerContact.updateMany({ where: { customerId, id: { notIn: keep }, deletedAt: null }, data: { deletedAt: new Date() } });
    for (const c of contacts) {
      if (c.id) {
        const { count } = await tx.customerContact.updateMany({ where: { id: c.id, customerId }, data: contactData(c) });
        if (!count) throw notFound('Contact');
      } else {
        await tx.customerContact.create({ data: { ...contactData(c), customerId } });
      }
    }
  }

  private async syncAddresses(tx: Tx, customerId: string, addresses: AddressInput[]) {
    const keep = addresses.filter((a) => a.id).map((a) => a.id!);
    await tx.customerAddress.updateMany({ where: { customerId, id: { notIn: keep }, deletedAt: null }, data: { deletedAt: new Date() } });
    for (const a of addresses) {
      if (a.id) {
        const { count } = await tx.customerAddress.updateMany({ where: { id: a.id, customerId }, data: addressData(a) });
        if (!count) throw notFound('Address');
      } else {
        await tx.customerAddress.create({ data: { ...addressData(a), customerId } });
      }
    }
  }

  /**
   * Everything the lab has done with one customer, in numbers: quotations, jobs, tests, reports and money.
   * Prices and money appear only for people who can see quotations or invoices.
   */
  async summary(id: string): Promise<CustomerSummaryDto> {
    const customer = await this.prisma.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!customer) throw notFound('Customer');
    const job = { job: { customerId: id } };
    const [jobGroups, samples, testGroups, reportsIssued, firstJob, lastJob, top] = await Promise.all([
      this.prisma.job.groupBy({ by: ['status'], where: { customerId: id, deletedAt: null }, _count: { _all: true } }),
      this.prisma.sample.count({ where: { ...job } }),
      this.prisma.sampleTest.groupBy({ by: ['status'], where: { deletedAt: null, sample: job }, _count: { _all: true } }),
      this.prisma.report.count({ where: { sample: job, revisions: { some: { status: 'ISSUED' } } } }),
      this.prisma.job.findFirst({ where: { customerId: id, deletedAt: null }, orderBy: { receivedAt: 'asc' }, select: { receivedAt: true } }),
      this.prisma.job.findFirst({ where: { customerId: id, deletedAt: null }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      this.prisma.sampleTest.groupBy({ by: ['testName'], where: { deletedAt: null, status: { not: 'CANCELLED' }, sample: job }, _count: { _all: true }, orderBy: { _count: { testName: 'desc' } }, take: 8 }),
    ]);
    const jobCount = (statuses: string[]) => jobGroups.filter((g) => statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
    const testCount = (statuses: string[]) => testGroups.filter((g) => statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
    let quotations: CustomerSummaryDto['quotations'] = null;
    if (can('quotations.view')) {
      const [groups, accepted] = await Promise.all([
        this.prisma.quotation.groupBy({ by: ['status'], where: { customerId: id, deletedAt: null }, _count: { _all: true } }),
        this.prisma.quotation.aggregate({ where: { customerId: id, deletedAt: null, status: 'ACCEPTED' }, _sum: { grandTotal: true }, _count: { _all: true } }),
      ]);
      quotations = {
        total: groups.reduce((n, g) => n + g._count._all, 0),
        accepted: accepted._count._all,
        acceptedValue: String(accepted._sum.grandTotal ?? 0),
        open: groups.filter((g) => ['DRAFT', 'SENT'].includes(g.status)).reduce((n, g) => n + g._count._all, 0),
      };
    }
    let money: CustomerSummaryDto['money'] = null;
    if (can('invoices.view')) {
      const live = { customerId: id, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] as ('ISSUED' | 'PARTIALLY_PAID' | 'PAID')[] } };
      const [all, open, overdue, lastPayment] = await Promise.all([
        this.prisma.invoice.aggregate({ where: live, _sum: { grandTotal: true, paidAmount: true, creditedAmount: true } }),
        this.prisma.invoice.findMany({ where: { ...live, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, select: { grandTotal: true, paidAmount: true, creditedAmount: true } }),
        this.prisma.invoice.findMany({ where: { ...live, status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: { lt: istToday() } }, select: { grandTotal: true, paidAmount: true, creditedAmount: true } }),
        this.prisma.payment.findFirst({ where: { customerId: id, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ]);
      const due = (rows: { grandTotal: unknown; paidAmount: unknown; creditedAmount: unknown }[]) =>
        rows.reduce((sum, r) => sum.plus(new Prisma.Decimal(String(r.grandTotal)).minus(String(r.paidAmount)).minus(String(r.creditedAmount))), new Prisma.Decimal(0)).toFixed(2);
      money = {
        invoiced: new Prisma.Decimal(String(all._sum.grandTotal ?? 0)).toFixed(2),
        paid: new Prisma.Decimal(String(all._sum.paidAmount ?? 0)).toFixed(2),
        outstanding: due(open),
        overdue: due(overdue),
        lastPaymentAt: lastPayment?.createdAt ?? null,
      };
    }
    return {
      quotations,
      jobs: { total: jobGroups.reduce((n, g) => n + g._count._all, 0), open: jobCount(['RECEIVED', 'PLANNED', 'IN_TESTING', 'REPORTING', 'ON_HOLD']), completed: jobCount(['COMPLETED']), cancelled: jobCount(['CANCELLED']) },
      samples,
      tests: { booked: testCount(['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'RESULTS_SUBMITTED', 'APPROVED', 'ON_HOLD']), approved: testCount(['APPROVED']), inProgress: testCount(['ASSIGNED', 'IN_PROGRESS', 'RESULTS_SUBMITTED']) },
      reportsIssued,
      money,
      firstJobAt: firstJob?.receivedAt ?? null,
      lastActivityAt: lastJob?.updatedAt ?? null,
      topTests: top.map((t) => ({ testName: t.testName, count: t._count._all })),
      testsByStatus: testGroups.map((g) => ({ status: g.status, count: g._count._all })),
    };
  }

  /** Every test this customer has booked, newest first, with its job, sample and report. */
  async tests(id: string, q: CustomerTestsQuery) {
    const where: Prisma.SampleTestWhereInput = {
      deletedAt: null,
      sample: { job: { customerId: id } },
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ testName: { contains: q.q, mode: 'insensitive' } }, { testCode: { contains: q.q, mode: 'insensitive' } }, { sample: { sampleNo: { contains: q.q, mode: 'insensitive' } } }, { sample: { job: { jobNo: { contains: q.q, mode: 'insensitive' } } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.sampleTest.findMany({
        where,
        include: { sample: { select: { id: true, sampleNo: true, description: true, job: { select: { id: true, jobNo: true } }, reports: { select: { id: true, reportNo: true, latestStatus: true } } } } },
        orderBy: orderBy(q, ['createdAt', 'testName', 'status'], 'createdAt', 'desc'),
        ...skipTake(q),
      }),
      this.prisma.sampleTest.count({ where }),
    ]);
    return toPage(
      rows.map((t) => {
        const report = t.sample.reports[0] ?? null;
        return {
          id: t.id, testCode: t.testCode, testName: t.testName, methodName: t.methodName, sampleId: t.sample.id, sampleNo: t.sample.sampleNo, sampleDescription: t.sample.description, jobId: t.sample.job.id, jobNo: t.sample.job.jobNo,
          status: t.status, bookedAt: t.createdAt, approvedAt: t.approvedAt, reportId: report?.id ?? null, reportNo: report?.reportNo ?? null, reportStatus: report?.latestStatus ?? null,
        };
      }),
      total,
      q,
    );
  }

  async history(id: string) {
    const rows = await this.prisma.auditLog.findMany({ where: { entity: 'Customer', entityId: id }, orderBy: { at: 'desc' }, take: 200 });
    return rows.map((r) => ({ id: r.id.toString(), at: r.at, userName: r.userName, action: r.action, before: r.before, after: r.after, reason: r.reason }));
  }
}

const contactData = (c: ContactInput) => ({ name: c.name, email: c.email ?? null, phone: c.phone ?? null, designation: c.designation ?? null, isPrimary: c.isPrimary ?? false });
const addressData = (a: AddressInput) => ({ kind: a.kind, line1: a.line1, line2: a.line2 ?? null, city: a.city, stateName: a.stateName, stateCode: a.stateCode, pincode: a.pincode ?? null });
