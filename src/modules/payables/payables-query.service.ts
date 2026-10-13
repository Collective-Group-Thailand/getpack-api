import { type Actor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { ScopingService } from '@modules/iam/scoping.service';
import { dateOnly } from '@common/ledger-core/dates';
import { Injectable } from '@nestjs/common';

import { INVOICE_INCLUDE } from './vendor-invoices.service';

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
  confirmedBy: { select: { publicId: true, displayName: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      goodsReceipt: {
        select: {
          grNumber: true,
          poId: true,
          lines: {
            select: {
              lineNo: true,
              lineType: true,
              quantity: true,
              shipment: { select: { shipmentNo: true } },
            },
          },
        },
      },
      vendorDeduction: { select: { claim: { select: { claimNo: true } } } },
    },
  },
  vendorInvoices: {
    where: { status: { not: 'void' } },
    include: INVOICE_INCLUDE,
    orderBy: { createdAt: 'desc' },
  },
} as const satisfies Prisma.BillingStatementInclude;
export type BsRow = Prisma.BillingStatementGetPayload<{ include: typeof BS_INCLUDE }>;

export const PAYABLE_INCLUDE = {
  vendor: { select: { publicId: true, legalName: true } },
  purchaseOrder: { select: { poNumber: true } },
  order: { select: { orderCode: true } },
} as const satisfies Prisma.PayableItemInclude;
export type PayableRow = Prisma.PayableItemGetPayload<{ include: typeof PAYABLE_INCLUDE }>;

type Page = { page: number; perPage: number };

/** Money of a statement's jobs (U-B0.3), see `BillingStatementTotalsDto`. */
export interface StatementMoney {
  deductions: MoneyValue;
  advanceOffset: MoneyValue;
  alreadyPaid: MoneyValue;
  remaining: MoneyValue;
}

const D = (v: { toString(): string } | null | undefined) => new MoneyDecimal(v ? v.toString() : 0);

/**
 * The factory's accounts in Packio's ledger (accounting-design §5, the default posting rules): factory payables,
 * retention held, advances paid and claim receivables. A factory's statement of account reads these lines.
 */
export const FACTORY_ACCOUNTS = ['2110', '2130', '1250', '1260'] as const;
/** Journal source document → statement-of-account entry kind; anything else (manual, reversal) is an adjustment. */
const ACCOUNT_ENTRY_KIND: Record<string, 'goods_receipt' | 'advance_offset' | 'payout' | 'deduction'> = {
  goods_receipt: 'goods_receipt',
  purchase_order: 'advance_offset',
  payout_item: 'payout',
  vendor_deduction: 'deduction',
};
const round2 = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);

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
      this.prisma.purchaseOrder.findMany({
        where,
        include: PO_INCLUDE,
        orderBy: { issuedAt: 'desc' },
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
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
      this.prisma.goodsReceipt.findMany({
        where,
        include: GR_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
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
      this.prisma.billingStatement.findMany({
        where,
        include: BS_INCLUDE,
        orderBy: { generatedAt: 'desc' },
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
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

  /**
   * What was deducted, offset, paid and is still owed on the jobs (purchase orders) a statement bills (U-B0.3,
   * D-022, D-164). Paid = paid payout allocations, less the retention held on a balance (paid later as its own
   * payable, D-164); owed = open, eligible and in-run payables; the advance offset = advances counted against the
   * balance (P16).
   */
  async statementMoney(rows: BsRow[]): Promise<Map<bigint, StatementMoney>> {
    const posOf = (r: BsRow) => [
      ...new Set(r.lines.flatMap((l) => (l.goodsReceipt ? [l.goodsReceipt.poId] : []))),
    ];
    const poIds = [...new Set(rows.flatMap(posOf))];
    const payables = poIds.length
      ? await this.prisma.payableItem.findMany({
          where: { purchaseOrderId: { in: poIds } },
          include: {
            allocations: { include: { payoutItem: { select: { status: true } } } },
            deductions: { where: { status: 'applied', offsetAgainst: 'payable' }, select: { amount: true } },
          },
        })
      : [];
    const out = new Map<bigint, StatementMoney>();
    for (const r of rows) {
      const mine = new Set(posOf(r));
      const money: StatementMoney = {
        deductions: D(0),
        advanceOffset: D(0),
        alreadyPaid: D(0),
        remaining: D(0),
      };
      for (const p of payables.filter((x) => x.purchaseOrderId !== null && mine.has(x.purchaseOrderId))) {
        for (const d of p.deductions) money.deductions = money.deductions.add(D(d.amount));
        if (p.source === 'advance' && (p.status === 'paid' || p.status === 'in_run'))
          money.advanceOffset = money.advanceOffset.add(D(p.netAmount)).add(D(p.vatAmount));
        if (['open', 'eligible', 'in_run'].includes(p.status))
          money.remaining = money.remaining.add(D(p.openNetAmount)).add(D(p.openVatAmount));
        for (const a of p.allocations.filter((x) => x.payoutItem.status === 'paid')) {
          const gross = D(a.netAmount).add(D(a.vatAmount));
          const held = p.source === 'goods_receipt' ? round2(gross.mul(D(p.retentionPct)).div(100)) : D(0);
          money.alreadyPaid = money.alreadyPaid.add(gross.sub(held));
        }
      }
      out.set(r.id, money);
    }
    return out;
  }

  async payables(q: Page & { status?: Prisma.PayableItemWhereInput['status']; vendorId?: string }) {
    const where: Prisma.PayableItemWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.vendorId && { vendor: { publicId: q.vendorId } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payableItem.findMany({
        where,
        include: PAYABLE_INCLUDE,
        orderBy: [{ eligibleAt: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.payableItem.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * The payables of a factory's jobs (U-B0.3, D-022, D-164): one row per purchase order, newest first, with each
   * advance / balance / retention payable and the payout that paid it.
   */
  async payoutSchedule(factoryId: bigint, q: Page) {
    const where: Prisma.PurchaseOrderWhereInput = { factoryId };
    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          productionJob: { select: { jobNo: true } },
          order: { select: { orderCode: true } },
          _count: { select: { goodsReceipts: true } },
          payableItems: {
            where: { source: { in: ['advance', 'goods_receipt', 'retention'] } },
            orderBy: { id: 'asc' },
            include: {
              allocations: {
                where: { payoutItem: { status: 'paid' } },
                include: { payoutItem: { select: { publicId: true, paidOn: true } } },
                orderBy: { id: 'desc' },
              },
            },
          },
        },
        orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * The factory's posted ledger lines between two days (U-B0.3): factory payables, retention held, advances and claim
   * receivables (accounting-design §5), one entry per journal, with the balance before `from`.
   */
  async accountEntries(vendorId: bigint, from: string, to: string) {
    const base: Prisma.JournalLineWhereInput = {
      vendorId,
      account: { code: { in: [...FACTORY_ACCOUNTS] } },
      journalEntry: { status: 'posted' },
    };
    const [before, lines] = await Promise.all([
      this.prisma.journalLine.aggregate({
        where: { ...base, entryDate: { lt: dateOnly(from) } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.journalLine.findMany({
        where: { ...base, entryDate: { gte: dateOnly(from), lte: dateOnly(to) } },
        include: {
          journalEntry: {
            select: {
              sourceDocumentType: true,
              sourceDocumentNo: true,
              sourceDocumentPublicId: true,
              reversesEntryId: true,
            },
          },
        },
        orderBy: [{ entryDate: 'asc' }, { journalEntryId: 'asc' }, { lineNo: 'asc' }],
        take: 5000,
      }),
    ]);
    const deductionIds = [
      ...new Set(
        lines.flatMap((l) =>
          l.journalEntry.sourceDocumentType === 'vendor_deduction' && l.journalEntry.sourceDocumentPublicId
            ? [l.journalEntry.sourceDocumentPublicId]
            : [],
        ),
      ),
    ];
    const claims = deductionIds.length
      ? await this.prisma.vendorDeduction.findMany({
          where: { publicId: { in: deductionIds } },
          select: { publicId: true, claim: { select: { claimNo: true } } },
        })
      : [];
    const claimNo = new Map(claims.map((c) => [c.publicId, c.claim?.claimNo ?? null]));
    const entries: {
      journalEntryId: bigint;
      date: Date;
      kind: (typeof ACCOUNT_ENTRY_KIND)[keyof typeof ACCOUNT_ENTRY_KIND] | 'adjustment';
      reference: string | null;
      debit: MoneyValue;
      credit: MoneyValue;
    }[] = [];
    for (const l of lines) {
      let e = entries.at(-1);
      if (e?.journalEntryId !== l.journalEntryId) {
        const j = l.journalEntry;
        const type = j.sourceDocumentType ?? '';
        e = {
          journalEntryId: l.journalEntryId,
          date: l.entryDate,
          kind:
            j.reversesEntryId === null && Object.hasOwn(ACCOUNT_ENTRY_KIND, type)
              ? ACCOUNT_ENTRY_KIND[type]!
              : 'adjustment',
          reference:
            type === 'vendor_deduction'
              ? (claimNo.get(j.sourceDocumentPublicId ?? '') ?? null)
              : (j.sourceDocumentNo ?? null),
          debit: D(0),
          credit: D(0),
        };
        entries.push(e);
      }
      e.debit = e.debit.add(D(l.debit));
      e.credit = e.credit.add(D(l.credit));
    }
    return { opening: D(before._sum.credit).sub(D(before._sum.debit)), entries };
  }

  /** A factory the actor may see (U-B0.3). */
  async factoryOf(actor: Actor, factoryPublicId: string) {
    const factory = await this.prisma.factory.findUnique({ where: { publicId: factoryPublicId } });
    if (!factory) throw new DomainException('http.not_found');
    await this.scoping.assertInScope(actor, 'factory', factory.id);
    return factory;
  }

  /** The vendor behind a factory the actor may see (partner payout statements, 50 ทวิ). */
  async vendorOfFactory(actor: Actor, factoryPublicId: string): Promise<bigint> {
    const factory = await this.prisma.factory.findUnique({ where: { publicId: factoryPublicId } });
    if (!factory) throw new DomainException('http.not_found');
    await this.scoping.assertInScope(actor, 'factory', factory.id);
    return factory.vendorId;
  }
}
