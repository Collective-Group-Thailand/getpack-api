import { systemActor } from '@common/context/actor';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { addCalendarDays, bangkokDate } from '@common/time/bangkok';
import { type Tx } from '@database/prisma.service';
import { type CustomerDocument } from '@generated/prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { SettingsService } from '@platform/settings/settings.service';

import { CreditNotesService } from './credit-notes.service';
import {
  CustomerDocumentsService,
  type DocumentLineDraft,
  type PostingFields,
} from './customer-documents.service';

const D = (v: { toString(): string } | string | number) => new MoneyDecimal(v.toString());
const ZERO = () => new MoneyDecimal(0);
const round = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);
const ACTOR = systemActor('receivables.delivery');

/**
 * Documents at delivery and after (accounting-design §2, §5 P06, P07, P09, P19, P23):
 * - POD recognises the order's revenue. When nothing is left to pay, or the sale is a sale of goods, a
 *   **final tax invoice** shows the full value and deducts the instalments already taxed (P06); a
 *   hire-of-work order with an unpaid remainder gets an **invoice** whose VAT is not yet due (P07) until the
 *   receipt (P08). The remainder is an AR item due per the schedule (credit terms, D-121).
 * - A shortage within tolerance (D-021) is credited by a credit note at once (P19).
 * - An order cancelled after a deposit gets a credit note for what was paid (P23), less the forfeited
 *   deposit when the policy keeps some (setting, P23F).
 */
@Injectable()
export class DeliveryDocumentsService {
  private readonly logger = new Logger(DeliveryDocumentsService.name);

  constructor(
    private readonly documents: CustomerDocumentsService,
    private readonly creditNotes: CreditNotesService,
    private readonly settings: SettingsService,
    private readonly events: DomainEvents,
  ) {}

  @OnDomainEvent('order.fact_recorded', { consumer: 'receivables.delivery' })
  async onFact(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    if (event.payload['fact'] !== 'delivered') return;
    const order = await tx.order.findUnique({ where: { publicId: String(event.payload['orderId']) } });
    if (order) await this.ensureDeliveryDocument(tx, order.id);
  }

  /** The order's final TR or invoice (once). */
  async ensureDeliveryDocument(tx: Tx, orderId: bigint): Promise<CustomerDocument | null> {
    const existing = await tx.customerDocument.findFirst({
      where: { orderId, docKind: { in: ['final', 'delivery'] }, status: 'issued' },
    });
    if (existing) return existing;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        orderGroup: { include: { paymentSchedule: { include: { instalments: true } } } },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: { discounts: { include: { campaign: true, promotion: true } } },
        },
        productType: { select: { publicId: true } },
      },
    });
    if (!order.deliveredAt || order.cancelledAt) return null;
    const advances = await tx.customerDocumentLine.findMany({
      where: { orderId, document: { docKind: 'instalment', status: 'issued' } },
      include: { document: true },
    });
    const credited = await tx.customerDocumentLine.findMany({
      where: { orderId, document: { docType: 'cn', cnKind: 'cancellation', status: 'issued' } },
    });
    const sum = (
      rows: {
        netAmount: { toString(): string };
        discountAmount: { toString(): string };
        vatAmount: { toString(): string };
      }[],
    ) =>
      rows.reduce(
        (a, l) => ({
          net: a.net.add(D(l.netAmount).sub(l.discountAmount.toString())),
          vat: a.vat.add(l.vatAmount.toString()),
        }),
        { net: ZERO(), vat: ZERO() },
      );
    const paid = sum(advances);
    const back = sum(credited);
    const lines = order.lines;
    const orderNet = lines.reduce((a, l) => a.add(D(l.netAmount).sub(l.discountAmount.toString())), ZERO());
    const orderVat = lines.reduce((a, l) => a.add(l.vatAmount.toString()), ZERO());
    let appliedNet = paid.net.sub(back.net);
    let appliedVat = paid.vat.sub(back.vat);
    if (appliedNet.gt(orderNet)) {
      // Paid more than the (re-priced) order: the excess stays an advance for a credit note / refund.
      this.logger.warn(`order ${order.orderCode}: advances exceed the order value`);
      appliedNet = orderNet;
      appliedVat = MoneyDecimal.min(appliedVat, orderVat);
    }
    const remainingNet = orderNet.sub(appliedNet);
    const remainingVat = MoneyDecimal.max(orderVat.sub(appliedVat), 0);
    const remainingGross = remainingNet.add(remainingVat);
    const hireOfWorkInvoice = remainingGross.gt(0) && order.taxNature === 'hire_of_work';
    const day = bangkokDate(order.deliveredAt);
    const { buyer, fullForm } = await this.documents.buyerOfGroup(tx, order.orderGroupId);
    const productTypeId = order.productType.publicId;
    const posting: PostingFields = {
      appliedAdvanceNet: formatMoney(appliedNet),
      remainingNet: formatMoney(remainingNet),
      remainingVat: formatMoney(remainingVat),
      remainingGross: formatMoney(remainingGross),
      vatDue: !hireOfWorkInvoice,
      revenue: lines.map((l) => ({
        category: l.revenueCategory,
        net: formatMoney(D(l.netAmount).sub(l.discountAmount.toString())),
        productTypeId,
        orderId: order.publicId,
      })),
      discounts: lines.flatMap((l) => {
        const detailed = l.discounts.filter((d) => D(d.amount).gt(0));
        const total = D(l.discountAmount);
        const listed = detailed.reduce((a, d) => a.add(d.amount.toString()), ZERO());
        const out: NonNullable<PostingFields['discounts']> = detailed.map((d) => ({
          source: d.source,
          category: l.revenueCategory,
          amount: formatMoney(d.amount.toString()),
          campaignId: d.campaign?.publicId ?? null,
          promotionId: d.promotion?.publicId ?? null,
          productTypeId,
          orderId: order.publicId,
        }));
        // Discount rows of the line that do not add up to its discount (rounding, caps) keep the rest.
        if (total.gt(listed))
          out.push({
            source: 'other',
            category: l.revenueCategory,
            amount: formatMoney(total.sub(listed)),
            campaignId: null,
            promotionId: null,
            productTypeId,
            orderId: order.publicId,
          });
        return total.gt(0) ? out : [];
      }),
    };
    const docLines: DocumentLineDraft[] = lines.map((l) => ({
      description: l.descriptionTh,
      orderId: order.id,
      orderLineId: l.id,
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice.toString(),
      net: D(l.netAmount),
      discount: D(l.discountAmount),
      vatRatePct: l.vatRatePct.toFixed(4),
      vat: D(l.vatAmount),
      wht: D(l.whtAmount),
      revenueCategory: l.revenueCategory,
      taxNature: l.taxNature,
    }));
    const instalmentDocs = [...new Map(advances.map((a) => [a.document.id, a.document])).values()];
    return this.documents.issue(
      tx,
      {
        entityId: order.entityId,
        docType: hireOfWorkInvoice ? 'iv' : 'tr',
        docKind: hireOfWorkInvoice ? 'delivery' : 'final',
        documentDate: day,
        isTaxInvoice: !hireOfWorkInvoice,
        customerUserId: order.customerUserId,
        companyId: order.orderGroup.companyId,
        companyBranchId: order.orderGroup.companyBranchId,
        buyer,
        isFullForm: fullForm,
        orderGroupId: order.orderGroupId,
        orderId: order.id,
        taxNature: order.taxNature,
        lines: docLines,
        deductedPrior: appliedNet.add(appliedVat),
        amountDue: remainingGross,
        dueDate: remainingGross.gt(0)
          ? this.dueDate(order.orderGroup.paymentSchedule?.instalments ?? [], day)
          : null,
        receivable: hireOfWorkInvoice ? { vatNotDueAmount: remainingVat, vatNotDueBase: remainingNet } : null,
        links: instalmentDocs.map((d) => ({ documentId: d.id, kind: 'deducts_instalment' as const })),
        posting,
      },
      ACTOR,
    );
  }

  /** The unpaid remainder is due on delivery, or the schedule's days after delivery (credit terms, D-121). */
  private dueDate(
    instalments: { dueTrigger: string; dueOffsetDays: number | null; status: string }[],
    day: string,
  ): string {
    const open = instalments.filter((i) => !['paid', 'cancelled', 'refunded'].includes(i.status));
    const offset = Math.max(
      0,
      ...open.filter((i) => i.dueTrigger === 'days_after_delivery').map((i) => i.dueOffsetDays ?? 0),
    );
    return addCalendarDays(day, offset);
  }

  /** Shortage within tolerance → pro-rata credit note at once (D-021, P19). */
  @OnDomainEvent('delivery.reconciled', { consumer: 'receivables.shortage_credit' })
  async onReconciled(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const credit = event.payload['credit'] as { net: string; vat: string; gross: string } | null;
    if (event.payload['outcome'] !== 'shortage_within' || !credit || !D(credit.gross).gt(0)) return;
    const order = await tx.order.findUnique({ where: { publicId: String(event.payload['orderId']) } });
    if (!order) return;
    if (
      (await tx.customerDocument.count({ where: { orderId: order.id, docType: 'cn', cnKind: 'shortage' } })) >
      0
    )
      return;
    await this.ensureDeliveryDocument(tx, order.id);
    await this.creditNotes.issue(
      tx,
      {
        orderId: order.id,
        cnKind: 'shortage',
        net: D(credit.net),
        vat: D(credit.vat),
        note: `ส่งมอบ ${String(event.payload['deliveredQuantity'])} จาก ${String(event.payload['orderedQuantity'])} ชิ้น`,
      },
      ACTOR,
    );
  }

  /** Cancellation after a deposit → credit note for what was paid, less the forfeited deposit (P23, P23F). */
  @OnDomainEvent('order.cancelled', { consumer: 'receivables.cancellation' })
  async onCancelled(event: DomainEventEnvelope, tx: Tx): Promise<void> {
    const order = await tx.order.findUnique({
      where: { publicId: event.aggregateId },
      include: { orderGroup: true },
    });
    if (!order) return;
    if (
      (await tx.customerDocument.count({
        where: { orderId: order.id, docType: 'cn', cnKind: 'cancellation' },
      })) > 0
    )
      return;
    const advances = await tx.customerDocumentLine.findMany({
      where: { orderId: order.id, document: { docKind: 'instalment', status: 'issued' } },
    });
    const net = advances.reduce((a, l) => a.add(l.netAmount.toString()), ZERO());
    const vat = advances.reduce((a, l) => a.add(l.vatAmount.toString()), ZERO());
    if (!net.add(vat).gt(0)) return;
    const pct = D((await this.settings.at('receivables.forfeited_deposit_policy', { tx })).value.forfeitPct);
    const keptNet = round(net.mul(pct).div(100));
    const keptVat = round(vat.mul(pct).div(100));
    const customer = await tx.user.findUniqueOrThrow({
      where: { id: order.customerUserId },
      select: { publicId: true },
    });
    if (keptNet.gt(0)) {
      await this.events.record(
        tx,
        {
          type: 'customer_deposit.forfeited',
          aggregateType: 'order',
          aggregateId: order.publicId,
          entityId: order.entityId,
          payload: {
            orderId: order.publicId,
            orderCode: order.orderCode,
            orderGroupId: order.orderGroup.publicId,
            customerId: customer.publicId,
            documentDate: bangkokDate(new Date(event.occurredAt)),
            netAmount: formatMoney(keptNet),
            vatAmount: formatMoney(keptVat),
            forfeitPct: pct.toString(),
          },
        },
        ACTOR,
      );
    }
    const creditNet = net.sub(keptNet);
    const creditVat = vat.sub(keptVat);
    if (creditNet.add(creditVat).gt(0))
      await this.creditNotes.issue(
        tx,
        {
          orderId: order.id,
          cnKind: 'cancellation',
          net: creditNet,
          vat: creditVat,
          settleTo: 'store_credit',
          note: `ยกเลิกคำสั่งซื้อ ${order.orderCode}`,
        },
        ACTOR,
      );
  }
}
