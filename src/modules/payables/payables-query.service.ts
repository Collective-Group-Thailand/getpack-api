import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { ScopingService } from '@modules/iam/scoping.service';
import { Injectable } from '@nestjs/common';

export const PO_INCLUDE = {
  factory: { select: { publicId: true } },
  productionJob: { select: { jobNo: true } },
  order: { select: { orderCode: true } },
  lines: { orderBy: { lineNo: 'asc' } },
} as const satisfies Prisma.PurchaseOrderInclude;
export type PoRow = Prisma.PurchaseOrderGetPayload<{ include: typeof PO_INCLUDE }>;

export const GR_INCLUDE = {
  po: { select: { poNumber: true } },
  lines: { orderBy: { lineNo: 'asc' } },
} as const satisfies Prisma.GoodsReceiptInclude;
export type GrRow = Prisma.GoodsReceiptGetPayload<{ include: typeof GR_INCLUDE }>;

export const BS_INCLUDE = {
  factory: { select: { publicId: true } },
  lines: { orderBy: { lineNo: 'asc' } },
} as const satisfies Prisma.BillingStatementInclude;
export type BsRow = Prisma.BillingStatementGetPayload<{ include: typeof BS_INCLUDE }>;

export const PAYABLE_INCLUDE = {
  vendor: { select: { publicId: true, legalName: true } },
  purchaseOrder: { select: { poNumber: true } },
  order: { select: { orderCode: true } },
} as const satisfies Prisma.PayableItemInclude;
export type PayableRow = Prisma.PayableItemGetPayload<{ include: typeof PAYABLE_INCLUDE }>;

type Page = { page: number; perPage: number };

/**
 * Reads of the factory AP documents (§6): POs, goods receipts, billing statements and payables. Factory
 * users see only their own factories' rows (others are 404, contract §5); staff see all.
 */
@Injectable()
export class PayablesQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoping: ScopingService,
  ) {}

  private async factoryWhere(actor: Actor, factoryPublicId?: string) {
    return {
      ...(await this.scoping.where(actor, 'factory', 'factoryId')),
      ...(factoryPublicId && { factory: { publicId: factoryPublicId } }),
    };
  }

  async purchaseOrders(actor: Actor, q: Page & { factoryId?: string; status?: string }) {
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(await this.factoryWhere(actor, q.factoryId)),
      ...(q.status && { status: q.status as Prisma.PurchaseOrderWhereInput['status'] }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({ where, include: PO_INCLUDE, orderBy: { issuedAt: 'desc' }, skip: (q.page - 1) * q.perPage, take: q.perPage }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return { rows, total };
  }

  async purchaseOrder(actor: Actor, publicId: string): Promise<PoRow> {
    const row = await this.prisma.purchaseOrder.findUnique({ where: { publicId }, include: PO_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    await this.scoping.assertInScope(actor, 'factory', row.factoryId);
    return row;
  }

  async goodsReceipts(actor: Actor, q: Page & { factoryId?: string }) {
    const where: Prisma.GoodsReceiptWhereInput = await this.factoryWhere(actor, q.factoryId);
    const [rows, total] = await Promise.all([
      this.prisma.goodsReceipt.findMany({ where, include: GR_INCLUDE, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.perPage, take: q.perPage }),
      this.prisma.goodsReceipt.count({ where }),
    ]);
    return { rows, total };
  }

  async statements(actor: Actor, q: Page & { factoryId?: string; status?: string }) {
    const where: Prisma.BillingStatementWhereInput = {
      ...(await this.factoryWhere(actor, q.factoryId)),
      ...(q.status && { status: q.status as Prisma.BillingStatementWhereInput['status'] }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.billingStatement.findMany({ where, include: BS_INCLUDE, orderBy: { generatedAt: 'desc' }, skip: (q.page - 1) * q.perPage, take: q.perPage }),
      this.prisma.billingStatement.count({ where }),
    ]);
    return { rows, total };
  }

  async statement(actor: Actor, publicId: string): Promise<BsRow> {
    const row = await this.prisma.billingStatement.findUnique({ where: { publicId }, include: BS_INCLUDE });
    if (!row) throw new DomainException('http.not_found');
    await this.scoping.assertInScope(actor, 'factory', row.factoryId);
    return row;
  }

  async payables(q: Page & { status?: Prisma.PayableItemWhereInput['status']; vendorId?: string }) {
    const where: Prisma.PayableItemWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.vendorId && { vendor: { publicId: q.vendorId } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payableItem.findMany({ where, include: PAYABLE_INCLUDE, orderBy: [{ eligibleAt: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.perPage, take: q.perPage }),
      this.prisma.payableItem.count({ where }),
    ]);
    return { rows, total };
  }

  /** The vendor behind a factory the actor may see (partner payout statements, 50 ทวิ). */
  async vendorOfFactory(actor: Actor, factoryPublicId: string): Promise<bigint> {
    const factory = await this.prisma.factory.findUnique({ where: { publicId: factoryPublicId } });
    if (!factory) throw new DomainException('http.not_found');
    await this.scoping.assertInScope(actor, 'factory', factory.id);
    return factory.vendorId;
  }
}
