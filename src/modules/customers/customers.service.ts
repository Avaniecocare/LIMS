import { Injectable, OnModuleInit } from '@nestjs/common';
import { badRequest, notFound } from '../../common/errors.js';
import { isValidGstin, PAN_RE } from '../../common/india.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { AuditService } from '../../core/audit.service.js';
import { NumberingService } from '../../core/numbering.service.js';
import { Prisma, PrismaService, updateVersioned, type Tx } from '../../core/prisma.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { DocumentsService, requirePermission, XLSX_MIME } from '../documents/documents.service.js';
import { buildWorkbook } from '../masters/excel.js';
import type { AddressInput, ContactInput, CreateCustomerDto, CustomerQuery, UpdateCustomerDto } from './customers.dto.js';

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

  async history(id: string) {
    const rows = await this.prisma.auditLog.findMany({ where: { entity: 'Customer', entityId: id }, orderBy: { at: 'desc' }, take: 200 });
    return rows.map((r) => ({ id: r.id.toString(), at: r.at, userName: r.userName, action: r.action, before: r.before, after: r.after, reason: r.reason }));
  }
}

const contactData = (c: ContactInput) => ({ name: c.name, email: c.email ?? null, phone: c.phone ?? null, designation: c.designation ?? null, isPrimary: c.isPrimary ?? false });
const addressData = (a: AddressInput) => ({ kind: a.kind, line1: a.line1, line2: a.line2 ?? null, city: a.city, stateName: a.stateName, stateCode: a.stateCode, pincode: a.pincode ?? null });
