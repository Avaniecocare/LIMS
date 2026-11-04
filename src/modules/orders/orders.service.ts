import { Injectable } from '@nestjs/common';
import { notFound } from '../../common/errors.js';
import { orderBy, skipTake, toPage } from '../../common/pagination.dto.js';
import { actorId } from '../../common/context.js';
import { AuditService } from '../../core/audit.service.js';
import { NumberingService } from '../../core/numbering.service.js';
import { Prisma, PrismaService, updateVersioned } from '../../core/prisma.service.js';
import type { CreateOrderDto, OrderQuery, UpdateOrderDto } from './orders.dto.js';

const include = { customer: { select: { name: true } }, _count: { select: { quotations: true } } } as const;
type Row = Prisma.OrderGetPayload<{ include: typeof include }>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  private async dto(rows: Row[]) {
    const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((x): x is string => !!x))];
    const owners = new Map((await this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id, orderNo: r.orderNo, customerId: r.customerId, customerName: r.customer.name, source: r.source, reference: r.reference, description: r.description, receivedOn: r.receivedOn,
      stage: r.stage, ownerId: r.ownerId, ownerName: r.ownerId ? (owners.get(r.ownerId) ?? null) : null, version: r.version, createdAt: r.createdAt, quotationCount: r._count.quotations,
    }));
  }

  async list(q: OrderQuery) {
    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      ...(q.stage ? { stage: q.stage } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.from || q.to ? { receivedOn: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ orderNo: { contains: q.q, mode: 'insensitive' } }, { reference: { contains: q.q, mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({ where, include, orderBy: orderBy(q, ['orderNo', 'receivedOn', 'stage'], 'receivedOn'), ...skipTake(q) }),
      this.prisma.order.count({ where }),
    ]);
    return toPage(await this.dto(rows), total, q);
  }

  async pipeline() {
    const groups = await this.prisma.order.groupBy({ by: ['stage'], where: { deletedAt: null }, _count: true });
    return (['NEW', 'QUOTED', 'WON', 'LOST'] as const).map((stage) => ({ stage, count: groups.find((g) => g.stage === stage)?._count ?? 0 }));
  }

  async get(id: string) {
    const row = await this.prisma.order.findFirst({ where: { id, deletedAt: null }, include });
    if (!row) throw notFound('Order');
    return (await this.dto([row]))[0];
  }

  async create(dto: CreateOrderDto) {
    const id = await this.prisma.$transaction(async (tx) => {
      const orderNo = await this.numbering.next(tx, 'ORDER');
      const row = await tx.order.create({
        data: { orderNo, customerId: dto.customerId, source: dto.source, reference: dto.reference, description: dto.description, receivedOn: new Date(dto.receivedOn), ownerId: dto.ownerId ?? actorId(), createdById: actorId() },
      });
      await this.audit.record({ action: 'Order.create', entity: 'Order', entityId: row.id, after: row }, tx);
      return row.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateOrderDto) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.order.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound('Order');
      await updateVersioned(tx.order as never, id, dto.version, { customerId: dto.customerId, source: dto.source, reference: dto.reference, description: dto.description, receivedOn: new Date(dto.receivedOn), ownerId: dto.ownerId, stage: dto.stage });
      await this.audit.record({ action: 'Order.update', entity: 'Order', entityId: id, before, after: dto }, tx);
    });
    return this.get(id);
  }

  owners() {
    return this.prisma.user.findMany({
      where: { isActive: true, deletedAt: null, roles: { some: { role: { permissions: { some: { permissionCode: 'orders.edit' } } } } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
