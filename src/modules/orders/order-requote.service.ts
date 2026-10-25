import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { bangkokDate, toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { canonical } from '@modules/catalog/imports/import-engine';
import { CheckoutService } from '@modules/checkout/checkout.service';
import { SavedQuotesService } from '@modules/quotes/saved-quotes.service';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import {
  OrderOperationsService,
  REPRICE_QUOTE_INCLUDE,
  type RepricePlan,
  type RepriceQuote,
} from './order-operations.service';
import { estimatedDeliveryDate, type OrderGroupRow, type OrderRow, paymentOverdue } from './order-views';
import { type RequotePreviewDto } from './orders.dto';
import { OrderLifecycleHooks, OrdersService } from './orders.service';

const DAY_MS = 86_400_000;
const D = (v: { toString(): string } | string | null | undefined) => new MoneyDecimal(v?.toString() ?? '0');
const REASON = 'ลูกค้าตรวจราคาใหม่หลังเลยกำหนดชำระ (D-436)';

interface QuoteInputShape {
  productTypeCode: string;
  configuration: Record<string, unknown>;
  deliveryPostcode?: string | null;
}

interface PlannedOrder {
  plan: RepricePlan;
  shipDate: Date | null;
}

/**
 * "ตรวจราคาใหม่และชำระ" (D-436, supersedes D-060's automatic cancellation): an unpaid order group past its payment
 * deadline is re-priced by the customer at today's price — every order through the pricing service again (a new
 * instant quotation of the same configuration, quantity and delivery postcode, today's lead time and ship date) —
 * shown with the difference (`preview`), then written when the customer confirms the same total (`confirm`), with a
 * new payment deadline; the customer then pays as usual. The write reuses the CS re-price (revision kept,
 * `order.repriced` → the payment schedule re-allocates, ADR-0008) and records `order_group.requoted`.
 * Not offered (`order.requote_unavailable`, the team quotes instead): a quotation that is not an instant price
 * (RFQ, sample), a reorder (tooling credits), discounts or add-on charges on an order, a payment being verified.
 */
@Injectable()
export class OrderRequoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly ops: OrderOperationsService,
    private readonly quotes: SavedQuotesService,
    private readonly checkout: CheckoutService,
    private readonly settings: SettingsService,
    private readonly hooks: OrderLifecycleHooks,
  ) {}

  /** Prices the group now (new quotations are saved; nothing on the order changes). */
  async preview(customerUserId: bigint, groupPublicId: string): Promise<RequotePreviewDto> {
    const at = new Date();
    const group = await this.orders.group(groupPublicId, customerUserId);
    await this.assertRequotable(group, at);
    const planned: PlannedOrder[] = [];
    for (const order of active(group)) {
      await this.assertOrderRequotable(order);
      const fresh = await this.freshQuote(order, customerUserId);
      const option = await this.prisma.quoteOption.findFirst({
        where: { quoteId: fresh.id, quantity: order.quantityOrdered },
      });
      if (!option)
        throw new DomainException('order.requote_unavailable', {
          params: { reason: 'quantity_unavailable' },
        });
      planned.push(await this.plan(order, fresh, option, at));
    }
    return this.view(group, planned, at);
  }

  /**
   * Writes the preview the customer accepted: the same quotations (live, the same configuration and quantity as
   * each order) and the same total, in one transaction with a new payment deadline.
   */
  async confirm(
    actor: UserActor,
    groupPublicId: string,
    body: {
      orders: { orderId: string; quoteId: string; quoteOptionId: string }[];
      expectedGrossAmount: string;
    },
  ): Promise<OrderGroupRow> {
    const at = new Date();
    const group = await this.orders.group(groupPublicId, actor.userId);
    await this.assertRequotable(group, at);
    const orders = active(group);
    const given = new Map(body.orders.map((o) => [o.orderId, o]));
    if (
      given.size !== body.orders.length ||
      orders.some((o) => !given.has(o.publicId)) ||
      given.size !== orders.length
    )
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'orders', code: 'set', message: 'every order of the group that is not cancelled, once' },
        ],
      });
    const planned: PlannedOrder[] = [];
    for (const order of orders) {
      await this.assertOrderRequotable(order);
      const ref = given.get(order.publicId)!;
      const quote = await this.prisma.quote.findFirst({
        where: { publicId: ref.quoteId, customerUserId: actor.userId, productTypeId: order.productTypeId },
        include: REPRICE_QUOTE_INCLUDE,
      });
      const option = quote
        ? await this.prisma.quoteOption.findFirst({
            where: { publicId: ref.quoteOptionId, quoteId: quote.id },
          })
        : null;
      if (!quote || !option) throw new DomainException('http.not_found');
      if (
        !['saved', 'shared'].includes(quote.status) ||
        quote.validUntil <= at ||
        quote.source !== 'instant' ||
        option.quantity !== order.quantityOrdered ||
        !sameConfiguration(quote.input, order.quote.input)
      )
        throw new DomainException('order.requote_changed', { params: { reason: 'quotation' } });
      planned.push(await this.plan(order, quote, option, at));
    }
    const total = planned.reduce((a, p) => a.add(p.plan.draft.totals.grossAmount), D(0));
    if (!total.eq(body.expectedGrossAmount))
      throw new DomainException('order.requote_changed', {
        params: { reason: 'total', expected: body.expectedGrossAmount, total: formatMoney(total) },
      });

    const expiry = await this.settings.at('orders.unpaid_expiry_days', { at });
    const expiresAt = new Date(at.getTime() + Number(expiry.value) * DAY_MS);
    await this.prisma.withTx(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM order_groups WHERE id = ${group.id} FOR UPDATE`;
        const current = await tx.orderGroup.findUniqueOrThrow({ where: { id: group.id } });
        if (current.rowVersion !== group.rowVersion) throw new DomainException('concurrency.stale');
        for (const hook of this.hooks.list())
          if (await hook.blocksRequote?.(tx, group.id))
            throw new DomainException('order.requote_unavailable', {
              params: { reason: 'payment_in_review' },
            });
        const changes = [];
        for (const { plan, shipDate } of planned) {
          const result = await this.ops.applyReprice(tx, plan, actor, REASON, at, {
            promisedShipDate: shipDate,
            source: 'customer_requote',
          });
          changes.push({ orderId: plan.order.publicId, ...result });
        }
        await tx.orderGroup.update({
          where: { id: group.id },
          data: { expiresAt, updatedById: actor.userId, rowVersion: { increment: 1 } },
        });
        await this.orders.record(
          tx,
          'order_group',
          group.publicId,
          'order_group.requoted',
          {
            previousGrossAmount: group.grossAmount.toFixed(2),
            newGrossAmount: formatMoney(total),
            previousExpiresAt: group.expiresAt?.toISOString() ?? null,
            expiresAt: expiresAt.toISOString(),
            unpaidExpiryVersionId: String(expiry.versionId),
            orders: changes,
          },
          actor,
        );
      },
      { timeout: 60_000 },
    );
    return this.orders.group(groupPublicId, actor.userId);
  }

  // --- helpers ------------------------------------------------------------------------------------------

  /** Unpaid, past its deadline, nothing paid and no payment being verified. */
  private async assertRequotable(group: OrderGroupRow, at: Date): Promise<void> {
    if (!paymentOverdue(group, at))
      throw new DomainException('order.requote_not_due', { params: { status: group.status } });
    await this.prisma.withTx(async (tx) => {
      for (const hook of this.hooks.list()) {
        if (await hook.blocksRequote?.(tx, group.id))
          throw new DomainException('order.requote_unavailable', { params: { reason: 'payment_in_review' } });
        if (hook.paidAmount && D(await hook.paidAmount(tx, group.id)).gt(0))
          throw new DomainException('order.requote_unavailable', { params: { reason: 'partly_paid' } });
      }
    });
  }

  private async assertOrderRequotable(order: OrderRow): Promise<void> {
    if (order.quote.source !== 'instant')
      throw new DomainException('order.requote_unavailable', { params: { reason: 'not_instant' } });
    if (order.reorderOfOrderId !== null)
      throw new DomainException('order.requote_unavailable', { params: { reason: 'reorder' } });
    try {
      await this.ops.assertRepriceable(order);
    } catch (error) {
      if (error instanceof DomainException && error.code !== 'order.invalid_transition')
        throw new DomainException('order.requote_unavailable', { params: { reason: error.code } });
      throw error;
    }
  }

  /** A new instant quotation of the order's configuration at today's price (D-051 re-price, D-436). */
  private async freshQuote(order: OrderRow, customerUserId: bigint): Promise<RepriceQuote> {
    const quote = order.quote;
    const input = quote.input as unknown as QuoteInputShape;
    let saved: { id: bigint };
    try {
      saved = await this.quotes.save(
        { kind: 'customer', userId: customerUserId },
        quote.channel,
        {
          productTypeCode: input.productTypeCode,
          configuration: input.configuration,
          deliveryPostcode: input.deliveryPostcode ?? undefined,
          targetPricePerUnit: quote.targetPricePerUnit?.toFixed(2) ?? null,
        },
        {
          customerUserId,
          ...(quote.designDocumentVersionId &&
            quote.specHash && {
              studio: {
                designDocumentVersionId: quote.designDocumentVersionId,
                specHash: Buffer.from(quote.specHash),
              },
            }),
        },
      );
    } catch (error) {
      if (error instanceof DomainException && error.status < 500)
        throw new DomainException('order.requote_unavailable', { params: { reason: error.code } });
      throw error;
    }
    return this.prisma.quote.findUniqueOrThrow({ where: { id: saved.id }, include: REPRICE_QUOTE_INCLUDE });
  }

  private async plan(
    order: OrderRow,
    quote: RepriceQuote,
    option: Parameters<OrderOperationsService['planReprice']>[2],
    at: Date,
  ): Promise<PlannedOrder> {
    const plan = await this.ops.planReprice(order, quote, option, order.designOption, at);
    return { plan, shipDate: await this.checkout.planShipDate(plan.draft, at) };
  }

  private async view(group: OrderGroupRow, planned: PlannedOrder[], at: Date): Promise<RequotePreviewDto> {
    const expiry = await this.settings.at('orders.unpaid_expiry_days', { at });
    const previous = planned.reduce((a, p) => a.add(p.plan.order.grossAmount.toString()), D(0));
    const next = planned.reduce((a, p) => a.add(p.plan.draft.totals.grossAmount), D(0));
    const cash = planned.reduce((a, p) => a.add(p.plan.draft.totals.cashAmount), D(0));
    const validUntil = planned
      .map((p) => p.plan.quote.validUntil)
      .reduce((a, b) => (b < a ? b : a), planned[0]?.plan.quote.validUntil ?? at);
    return {
      groupId: group.publicId,
      groupCode: group.groupCode,
      previousGrossAmount: formatMoney(previous),
      newGrossAmount: formatMoney(next),
      differenceAmount: formatMoney(next.sub(previous)),
      newCashAmount: formatMoney(cash),
      priceValidUntil: toBangkokIso(validUntil),
      paymentDueAt: toBangkokIso(new Date(at.getTime() + Number(expiry.value) * DAY_MS)),
      orders: planned.map(({ plan, shipDate }) => {
        const product = plan.draft.lines.find((l) => l.lineType === 'product');
        return {
          orderId: plan.order.publicId,
          orderCode: plan.order.orderCode,
          quoteId: plan.quote.publicId,
          quoteOptionId: plan.option.publicId,
          quantity: plan.option.quantity,
          previousGrossAmount: plan.order.grossAmount.toFixed(2),
          newGrossAmount: plan.draft.totals.grossAmount,
          differenceAmount: formatMoney(
            D(plan.draft.totals.grossAmount).sub(plan.order.grossAmount.toString()),
          ),
          newUnitPrice: product ? String(product.unitPrice) : plan.option.unitPrice.toFixed(6),
          leadTimeDays: plan.draft.leadTimeDays,
          promisedShipDate: shipDate ? bangkokDate(shipDate) : null,
          estimatedDeliveryDate: estimatedDeliveryDate(shipDate, plan.option),
        };
      }),
    };
  }
}

const active = (group: OrderGroupRow) => group.orders.filter((o) => o.cancelledAt === null);

/** The same configuration and delivery postcode (the stored, validated quotation inputs). */
export function sameConfiguration(a: unknown, b: unknown): boolean {
  const pick = (v: unknown) => {
    const i = (v ?? {}) as Partial<QuoteInputShape>;
    return JSON.stringify(
      canonical({
        productTypeCode: i.productTypeCode ?? null,
        configuration: i.configuration ?? {},
        deliveryPostcode: i.deliveryPostcode ?? null,
      }),
    );
  };
  return pick(a) === pick(b);
}
