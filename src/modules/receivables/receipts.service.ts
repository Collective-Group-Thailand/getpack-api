import { systemActor } from '@common/context/actor';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import { type Payment, type PaymentProvider, type ReceiptVia } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';

import { CustomerDocumentsService, type DocumentLineDraft } from './customer-documents.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const ZERO = () => new MoneyDecimal(0);
const round = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
const ACTOR = systemActor('receivables.receipts');

/** How a payment's money arrived, for the posting rules (P01, P02, P08, P01X). */
export function receiptViaOf(provider: PaymentProvider): ReceiptVia {
  return ({ scb: 'scb', twoc2p: 'twoc2p', slip: 'slip', bank: 'bank', internal: 'store_credit' } as const)[provider];
}

interface OrderShare {
  orderId: bigint;
  gross: MoneyValue;
  vat: MoneyValue;
  wht: MoneyValue;
  labels: string[];
}

/**
 * Receipts (accounting-design §2 tax point, §5 P01–P03, P08, P29, P01X). A payment applied to a group's
 * instalments is a tax point: the part of each order that is still an advance gets an instalment tax
 * invoice/receipt (TR); the part that pays an order already invoiced at delivery gets a receipt (RC) that
 * collects the receivable and — for hire of work — makes its VAT due. Cash the schedule does not need waits in
 * unapplied receipts; a callback no order claims is an unidentified receipt until Finance allocates it.
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly documents: CustomerDocumentsService,
    private readonly events: DomainEvents,
  ) {}

  @OnDomainEvent(['payment.received', 'payment.allocated'], { consumer: 'receivables.receipts' })
  async onPaymentApplied(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const payment = await tx.payment.findUnique({
      where: { publicId: String(event.payload['paymentId']) },
      include: {
        allocations: {
          include: {
            instalment: {
              include: { allocations: { include: { order: true }, orderBy: { orderId: 'asc' } } },
            },
          },
        },
      },
    });
    if (!payment?.orderGroupId || payment.allocations.length === 0) return;
    if ((await tx.customerDocument.count({ where: { paymentId: payment.id, docType: { in: ['tr', 'rc'] } } })) > 0) return;
    const via: ReceiptVia = event.type === 'payment.allocated' ? 'unidentified' : receiptViaOf(payment.provider);
    const shares = this.shares(payment);
    const day = bangkokDate(payment.paidAt ?? new Date(event.occurredAt));
    const group = await tx.orderGroup.findUniqueOrThrow({ where: { id: payment.orderGroupId } });
    const { buyer, fullForm } = await this.documents.buyerOfGroup(tx, group.id);

    const advance: DocumentLineDraft[] = [];
    const collections: { share: OrderShare; itemId: bigint; applied: MoneyValue }[] = [];
    for (const share of shares.values()) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: share.orderId } });
      const items = await tx.receivableItem.findMany({
        where: { orderId: order.id, status: { in: ['open', 'partially_paid'] } },
        orderBy: { dueDate: 'asc' },
      });
      let left = share.gross;
      for (const item of items) {
        if (left.lte(0)) break;
        const applied = MoneyDecimal.min(left, D(item.openAmount));
        collections.push({ share, itemId: item.id, applied });
        left = left.sub(applied);
      }
      if (left.gt(0)) {
        // The advance part keeps its proportional VAT and withholding (the schedule's split, ADR-0008).
        const ratio = share.gross.isZero() ? ZERO() : left.div(share.gross);
        const vat = round(share.vat.mul(ratio));
        const wht = round(share.wht.mul(ratio));
        advance.push({
          description: `${share.labels.join(', ')} — คำสั่งซื้อ ${order.orderCode}`,
          orderId: order.id,
          net: left.sub(vat),
          vatRatePct: (await this.vatRate(tx, order.id)).toFixed(4),
          vat,
          wht,
          taxNature: order.taxNature,
        });
      }
    }

    if (advance.length > 0) {
      await this.documents.issue(
        tx,
        {
          entityId: payment.entityId,
          docType: 'tr',
          docKind: 'instalment',
          documentDate: day,
          isTaxInvoice: true,
          customerUserId: group.customerUserId,
          companyId: group.companyId,
          companyBranchId: group.companyBranchId,
          buyer,
          isFullForm: fullForm,
          orderGroupId: group.id,
          orderId: advance.length === 1 ? advance[0]!.orderId : null,
          paymentId: payment.id,
          receiptVia: via,
          taxNature: advance.length === 1 ? advance[0]!.taxNature : null,
          isReceipt: true,
          lines: advance,
        },
        ACTOR,
      );
    }
    for (const c of collections) await this.collect(tx, payment, group.id, c, via, day, buyer, fullForm);
  }

  /** RC for money that pays an invoiced order (P08): the receivable is collected, VAT not yet due moves. */
  private async collect(
    tx: Tx,
    payment: Payment,
    groupId: bigint,
    c: { share: OrderShare; itemId: bigint; applied: MoneyValue },
    via: ReceiptVia,
    day: string,
    buyer: Awaited<ReturnType<CustomerDocumentsService['buyerOfGroup']>>['buyer'],
    fullForm: boolean,
  ) {
    const item = await tx.receivableItem.findUniqueOrThrow({ where: { id: c.itemId }, include: { customerDocument: true } });
    const original = item.customerDocument;
    const open = D(item.openAmount);
    const full = c.applied.eq(open);
    // VAT not yet due moves with the money (P08), the last receipt taking what is left; it is also the VAT
    // this receipt carries as the hire-of-work tax point. Otherwise the VAT is shown for information only.
    const notDue = full ? D(item.vatNotDueAmount) : MoneyDecimal.min(D(item.vatNotDueAmount), round(D(item.vatNotDueAmount).mul(c.applied).div(open)));
    const notDueBase = full ? D(item.vatNotDueBase) : MoneyDecimal.min(D(item.vatNotDueBase), round(D(item.vatNotDueBase).mul(c.applied).div(open)));
    const gross = D(original.grossAmount);
    const vat = notDue.gt(0) ? notDue : gross.isZero() ? ZERO() : round(c.applied.mul(original.vatAmount.toString()).div(gross));
    const wht = c.share.gross.isZero() ? ZERO() : round(c.share.wht.mul(c.applied).div(c.share.gross));
    const order = await tx.order.findUniqueOrThrow({ where: { id: c.share.orderId } });
    const rc = await this.documents.issue(
      tx,
      {
        entityId: payment.entityId,
        docType: 'rc',
        docKind: 'collection',
        documentDate: day,
        // Under hire of work the receipt is the tax point (§2): it carries the VAT that becomes due.
        isTaxInvoice: notDue.gt(0),
        customerUserId: item.customerUserId,
        companyId: item.companyId,
        companyBranchId: original.companyBranchId,
        buyer,
        isFullForm: fullForm,
        orderGroupId: groupId,
        orderId: order.id,
        paymentId: payment.id,
        originalDocumentId: original.id,
        receiptVia: via,
        taxNature: order.taxNature,
        isReceipt: true,
        lines: [
          {
            description: `รับชำระตาม ${original.docNumber} — คำสั่งซื้อ ${order.orderCode}`,
            orderId: order.id,
            net: c.applied.sub(vat),
            vatRatePct: original.vatRatePct.toFixed(4),
            vat,
            wht,
            taxNature: order.taxNature,
          },
        ],
        links: [{ documentId: original.id, kind: 'receipt_for', amount: c.applied }],
        posting: { vatNotDueAmount: formatMoney(notDue), vatNotDueBase: formatMoney(notDueBase) },
      },
      ACTOR,
    );
    const left = open.sub(c.applied);
    await tx.receivableApplication.create({
      data: { receivableItemId: item.id, paymentId: payment.id, documentId: rc.id, amount: formatMoney(c.applied) },
    });
    await tx.receivableItem.update({
      where: { id: item.id },
      data: {
        openAmount: formatMoney(left),
        status: left.isZero() ? 'paid' : 'partially_paid',
        vatNotDueAmount: formatMoney(D(item.vatNotDueAmount).sub(notDue)),
        vatNotDueBase: formatMoney(D(item.vatNotDueBase).sub(notDueBase)),
        rowVersion: { increment: 1 },
      },
    });
  }

  /**
   * Per order, the gross / VAT / withholding of the instalments this payment paid: each payment allocation
   * covers a share of its instalment, split over the orders like the instalment (ADR-0008), the rounding
   * remainder on the last order.
   */
  private shares(payment: Payment & {
    allocations: {
      grossAmount: { toString(): string };
      instalment: {
        seq: number;
        labelTh: string;
        grossAmount: { toString(): string };
        allocations: { orderId: bigint; grossAmount: { toString(): string }; vatAmount: { toString(): string }; whtAmount: { toString(): string } }[];
      };
    }[];
  }): Map<bigint, OrderShare> {
    const shares = new Map<bigint, OrderShare>();
    for (const alloc of payment.allocations) {
      const inst = alloc.instalment;
      const paidGross = D(alloc.grossAmount);
      const ratio = D(inst.grossAmount).isZero() ? ZERO() : paidGross.div(inst.grossAmount.toString());
      const rows = inst.allocations;
      let grossLeft = paidGross;
      rows.forEach((ia, i) => {
        const last = i === rows.length - 1;
        const gross = last ? grossLeft : round(D(ia.grossAmount).mul(ratio));
        grossLeft = grossLeft.sub(gross);
        const share = shares.get(ia.orderId) ?? { orderId: ia.orderId, gross: ZERO(), vat: ZERO(), wht: ZERO(), labels: [] };
        share.gross = share.gross.add(gross);
        share.vat = share.vat.add(round(D(ia.vatAmount).mul(ratio)));
        share.wht = share.wht.add(round(D(ia.whtAmount).mul(ratio)));
        if (!share.labels.includes(inst.labelTh)) share.labels.push(`งวดที่ ${inst.seq} ${inst.labelTh}`);
        shares.set(ia.orderId, share);
      });
    }
    return shares;
  }

  private async vatRate(tx: Tx, orderId: bigint): Promise<MoneyValue> {
    const line = await tx.orderLine.findFirst({ where: { orderId, lineType: 'product' } });
    return D(line?.vatRatePct ?? 7);
  }

  /** Cash beyond what the schedule needs waits in unapplied receipts (P01X) for a refund. */
  @OnDomainEvent(['payment.overpaid', 'payment.refund_required'], { consumer: 'receivables.unapplied' })
  async onUnapplied(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const payment = await tx.payment.findUnique({ where: { publicId: String(event.payload['paymentId']) }, include: { orderGroup: true } });
    if (!payment) return;
    const raw = event.payload['leftoverAmount'] ?? event.payload['cashAmount'];
    const amount = typeof raw === 'string' ? raw : '0';
    if (!D(amount).gt(0)) return;
    const customer = payment.orderGroup
      ? await tx.user.findUnique({ where: { id: payment.orderGroup.customerUserId }, select: { publicId: true } })
      : null;
    await this.events.record(
      tx,
      {
        type: 'customer_receipt.unapplied',
        aggregateType: 'payment',
        aggregateId: payment.publicId,
        entityId: payment.entityId,
        payload: {
          paymentId: payment.publicId,
          reference: payment.referenceCode,
          receivedOn: bangkokDate(payment.paidAt ?? new Date(event.occurredAt)),
          receiptVia: receiptViaOf(payment.provider),
          amount: formatMoney(amount),
          customerId: customer?.publicId ?? null,
          orderGroupId: payment.orderGroup?.publicId ?? null,
        },
      },
      ACTOR,
    );
  }

  /** A provider callback no order claims: parked in unidentified receipts (P29) until Finance allocates it. */
  @OnDomainEvent('payment.unidentified', { consumer: 'receivables.unidentified' })
  async onUnidentified(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const payment = await tx.payment.findUnique({ where: { publicId: String(event.payload['paymentId']) } });
    if (!payment) return;
    await this.events.record(
      tx,
      {
        type: 'unidentified_receipt.recorded',
        aggregateType: 'payment',
        aggregateId: payment.publicId,
        entityId: payment.entityId,
        payload: {
          receiptId: payment.publicId,
          reference: payment.referenceCode,
          receivedOn: bangkokDate(payment.paidAt ?? new Date(event.occurredAt)),
          receivedVia: receiptViaOf(payment.provider),
          receivedIntoAccountCode: null,
          amount: payment.cashAmount.toFixed(2),
        },
      },
      ACTOR,
    );
  }
}
