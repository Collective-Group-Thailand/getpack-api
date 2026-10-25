import { createHash } from 'node:crypto';

import { type UserActor } from '@common/context/actor';
import { DomainException } from '@common/errors/domain.exception';
import { assertIfMatch, etagOf } from '@common/etag/etag';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type DesignOption, Prisma, type QuoteOption } from '@generated/prisma/client';
import { canonical } from '@modules/catalog/imports/import-engine';
import { type DraftOrder } from '@modules/checkout/checkout.extensions';
import { CheckoutService, type PricingItem } from '@modules/checkout/checkout.service';
import { addTotals, type Totals } from '@modules/checkout/order-pricing';
import { CustomersService, type TaxProfileSnapshot } from '@modules/customers/customers.service';
import { SUMMARY_INCLUDE } from '@modules/quotes/line-summary';
import { QuoteConversionService } from '@modules/quotes/quote-conversion.service';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import {
  destinationSnapshot,
  GROUP_INCLUDE,
  ORDER_INCLUDE,
  type OrderGroupRow,
  type OrderRow,
} from './order-views';
import { groupEtag, OrderLifecycleHooks, OrdersService } from './orders.service';

export const orderEtag = (o: { publicId: string; rowVersion: number }) => etagOf(o.publicId, o.rowVersion);

const BEFORE_PRODUCTION = ['waiting_payment', 'paid_for_production', 'artwork_approved'];
const D = (v: string | Prisma.Decimal | number | null | undefined) => new MoneyDecimal(v?.toString() ?? '0');

export interface RepriceInput {
  quoteId: string;
  quoteOptionId: string;
  reason: string;
  designOption?: string;
  destinations?: { addressId: string; quantity: number }[];
}

/** The quotation a re-price is priced from (with what `CheckoutService.priceItem` reads). */
export const REPRICE_QUOTE_INCLUDE = {
  productType: true,
  catalogProduct: SUMMARY_INCLUDE.catalogProduct,
} as const satisfies Prisma.QuoteInclude;
export type RepriceQuote = Prisma.QuoteGetPayload<{ include: typeof REPRICE_QUOTE_INCLUDE }>;

/** A re-price priced outside the transaction, written by `applyReprice`. */
export interface RepricePlan {
  order: OrderRow;
  groupId: bigint;
  quote: RepriceQuote;
  option: QuoteOption;
  designOption: string;
  draft: DraftOrder;
  vatPct: string;
  taxProfile: TaxProfileSnapshot | null;
}

export type QueueKey = 'waiting_payment' | 'artwork_review' | 'waiting_production' | 'due_soon' | 'late';

/**
 * CS operations on placed orders (B3.1): edit & re-price before production (the previous pricing is
 * kept in `order_price_revisions`; a new total below what was already paid is refused — that needs a
 * credit note, B5), change the customer of an unpaid group, remarks / cc e-mails / PO number, internal
 * notes, and the admin work queues ("รอชำระ", "รอตรวจไฟล์", "รอเริ่มผลิต", "ใกล้ครบกำหนดส่ง", "ล่าช้า").
 */
@Injectable()
export class OrderOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly checkout: CheckoutService,
    private readonly customers: CustomersService,
    private readonly conversion: QuoteConversionService,
    private readonly settings: SettingsService,
    private readonly hooks: OrderLifecycleHooks,
  ) {}

  // --- edit & re-price --------------------------------------------------------------------------------

  async reprice(actor: UserActor, orderPublicId: string, ifMatch: string | undefined, body: RepriceInput) {
    const at = new Date();
    const order = await this.orders.order({ publicId: orderPublicId });
    assertIfMatch(ifMatch, orderEtag(order));
    await this.assertRepriceable(order);

    const quote = await this.prisma.quote.findFirst({
      where: {
        publicId: body.quoteId,
        customerUserId: order.customerUserId,
        productTypeId: order.productTypeId,
      },
      include: REPRICE_QUOTE_INCLUDE,
    });
    const option = quote
      ? await this.prisma.quoteOption.findFirst({
          where: { publicId: body.quoteOptionId, quoteId: quote.id },
        })
      : null;
    if (!quote || !option) throw new DomainException('http.not_found');
    if (!['saved', 'shared', 'converted'].includes(quote.status) || quote.validUntil <= at)
      throw new DomainException('quotes.not_live');

    const plan = await this.planReprice(
      order,
      quote,
      option,
      body.designOption ?? order.designOption,
      at,
      body.destinations,
    );
    return this.prisma.withTx(
      async (tx) => {
        await this.applyReprice(tx, plan, actor, body.reason, at);
        return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
      },
      { timeout: 30_000 },
    );
  }

  /** Before production, without discounts or add-on charges (they have their own instalments). */
  async assertRepriceable(order: OrderRow): Promise<void> {
    if (!BEFORE_PRODUCTION.includes(order.status))
      throw new DomainException('order.invalid_transition', {
        params: { from: order.status, fact: 'repriced', reason: 'only before production' },
      });
    if ((await this.prisma.orderDiscount.count({ where: { orderId: order.id } })) > 0)
      throw new DomainException('order.reprice_has_discounts');
    // Add-on charges (extra design rounds, mockups) have their own instalments; a re-price would drop them.
    if (
      (await this.prisma.orderLine.count({
        where: { orderId: order.id, lineType: { in: ['extra_revision', 'mockup'] } },
      })) > 0
    )
      throw new DomainException('order.reprice_has_add_ons');
  }

  /** Prices `order` from `quote` / `option` outside any transaction (CS re-price, customer re-quote D-436). */
  async planReprice(
    order: OrderRow,
    quote: RepriceQuote,
    option: QuoteOption,
    designOption: string,
    at: Date,
    destinationsInput?: RepriceInput['destinations'],
  ): Promise<RepricePlan> {
    const group = await this.prisma.orderGroup.findUniqueOrThrow({ where: { id: order.orderGroupId } });
    const destinations = await this.destinations(order, option.quantity, destinationsInput);
    const fee = D(((option.result ?? {}) as { designFeeAmount?: string }).designFeeAmount);
    if ((designOption === 'hired_design') !== fee.gt(0) || designOption === 'free_design')
      throw new DomainException('cart.design_option_unavailable');

    const item: PricingItem = {
      id: null,
      publicId: null,
      quote,
      quoteOption: option,
      destinations,
      designOption,
      designNote: order.designNote,
      mockupOption: order.mockupOption,
      reorderOfOrderId: order.reorderOfOrderId,
      designDocumentId: order.designDocumentId,
      reuseArtworkProofId: order.reuseArtworkProofId,
    };
    const nature = await this.settings.at('tax.nature_by_product_type', { at });
    const snapshot = group.taxProfileSnapshot as TaxProfileSnapshot | null;
    const withholds = !!snapshot && snapshot.withholdsTax && snapshot.taxType !== 'individual';
    const wht = withholds ? await this.checkout.whtRates(at) : null;
    const { order: draft, vatPct } = await this.checkout.priceItem(item, 0, at, nature, wht);
    return { order, groupId: group.id, quote, option, designOption, draft, vatPct, taxProfile: snapshot };
  }

  /**
   * Writes a planned re-price in `tx`: the previous pricing kept as a revision, lines and destinations
   * replaced, the group's totals refreshed, `order.repriced` published (the payment schedule re-allocates the
   * unpaid part, ADR-0008). `promisedShipDate` re-plans the ship date (customer re-quote, D-436).
   */
  async applyReprice(
    tx: Tx,
    plan: RepricePlan,
    actor: UserActor,
    reason: string,
    at: Date,
    opts: { promisedShipDate?: Date | null; source?: 'staff' | 'customer_requote' } = {},
  ): Promise<{ previousGrossAmount: string; newGrossAmount: string }> {
    const { order, quote, option, draft, vatPct } = plan;
    const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    if (current.rowVersion !== order.rowVersion) throw new DomainException('concurrency.stale');
    const siblings = await tx.order.findMany({
      where: { orderGroupId: plan.groupId, id: { not: order.id }, status: { not: 'cancelled' } },
    });
    const groupTotals = addTotals([...siblings.map(totalsRow), draft.totals]);
    const paid = await this.paid(tx, plan.groupId);
    if (D(groupTotals.grossAmount).lt(paid))
      throw new DomainException('order.reprice_below_paid', {
        params: { paid, total: groupTotals.grossAmount },
      });

    const previousLines = await tx.orderLine.findMany({
      where: { orderId: order.id },
      orderBy: { lineNo: 'asc' },
    });
    await tx.orderPriceRevision.create({
      data: {
        orderId: order.id,
        revision: current.pricingRevision,
        previousSnapshot: current.pricingSnapshot as Prisma.InputJsonValue,
        previousLines: previousLines.map((l) => ({
          lineType: l.lineType,
          netAmount: l.netAmount.toFixed(2),
          vatAmount: l.vatAmount.toFixed(2),
          grossAmount: l.grossAmount.toFixed(2),
          whtAmount: l.whtAmount.toFixed(2),
        })),
        previousGross: current.grossAmount,
        newGross: draft.totals.grossAmount,
        reason,
        createdById: actor.userId,
      },
    });
    await tx.orderLine.deleteMany({ where: { orderId: order.id } });
    await tx.orderDestination.deleteMany({ where: { orderId: order.id } });

    const payable = D(draft.totals.netAmount).sub(draft.totals.discountAmount);
    const margin = draft.buyCostNet ? payable.sub(draft.buyCostNet) : null;
    const marginPct = margin && payable.gt(0) ? margin.div(payable).mul(100) : null;
    const floor = await this.settings.at('pricing.margin_floor_pct', { at });
    const pricingSnapshot = {
      schemaVersion: 1,
      quote: {
        id: quote.publicId,
        code: quote.quoteCode,
        source: quote.source,
        quantity: option.quantity,
      },
      tax: { vatPct, nature: draft.lines[0]!.taxNature, taxProfile: plan.taxProfile },
      shipping: draft.legs.map((l) => ({
        postcode: l.postcode,
        quantity: l.quantity,
        net: formatMoney(l.net),
      })),
      lines: draft.lines,
      totals: draft.totals,
      repricedFromRevision: current.pricingRevision,
    };
    const configRefs = draft.configRefs;
    await tx.order.update({
      where: { id: order.id },
      data: {
        quoteId: quote.id,
        quoteOptionId: option.id,
        quantityOrdered: option.quantity,
        designOption: plan.designOption as DesignOption,
        toleranceShortagePct: draft.toleranceShortagePct,
        toleranceOveragePct: draft.toleranceOveragePct,
        toleranceDimensionalMm: draft.toleranceDimensionalMm,
        toleranceColourDeltaE: draft.toleranceColourDeltaE,
        taxNature: draft.lines[0]!.taxNature,
        pricingSnapshot: pricingSnapshot as unknown as Prisma.InputJsonValue,
        configRefs: configRefs as Prisma.InputJsonValue,
        snapshotSha256: createHash('sha256')
          .update(JSON.stringify(canonical({ snapshot: pricingSnapshot, configRefs })))
          .digest(),
        pricingRevision: current.pricingRevision + 1,
        ...draft.totals,
        leadTimeDays: draft.leadTimeDays,
        ...(opts.promisedShipDate !== undefined && { promisedShipDate: opts.promisedShipDate }),
        selectedFactoryId: draft.selectedFactoryId,
        buyCostNet: draft.buyCostNet ? formatMoney(draft.buyCostNet) : null,
        marginAmount: margin ? formatMoney(margin) : null,
        marginPct: marginPct ? marginPct.toFixed(4) : null,
        belowMarginFloor: marginPct ? marginPct.lt(String(floor.value)) : false,
        updatedById: actor.userId,
        rowVersion: { increment: 1 },
      },
    });
    for (const [i, line] of draft.lines.entries()) {
      await tx.orderLine.create({
        data: {
          orderId: order.id,
          lineNo: i + 1,
          lineType: line.lineType,
          descriptionTh: line.descriptionTh,
          descriptionEn: line.descriptionEn,
          quantity: String(line.quantity),
          unit: line.lineType === 'shipping' ? 'trip' : line.lineType === 'product' ? option.unit : 'job',
          unitPrice: line.unitPrice,
          netAmount: line.netAmount,
          discountAmount: line.discountAmount,
          vatRatePct: line.vatRatePct,
          vatAmount: line.vatAmount,
          grossAmount: line.grossAmount,
          whtCategory: line.whtCategory,
          whtRatePct: line.whtRatePct,
          whtAmount: line.whtAmount,
          revenueCategory: line.revenueCategory,
          taxNature: line.taxNature,
          buyCostNet: line.lineType === 'product' && draft.buyCostNet ? formatMoney(draft.buyCostNet) : null,
        },
      });
    }
    for (const [i, leg] of draft.legs.entries()) {
      const s = leg.snapshot as {
        recipientName: string;
        phone: string;
        line1: string;
        line2: string | null;
      };
      await tx.orderDestination.create({
        data: {
          orderId: order.id,
          customerAddressId: leg.customerAddressId,
          recipientName: s.recipientName,
          phone: s.phone,
          line1: s.line1,
          line2: s.line2,
          subdistrictId: leg.subdistrictId,
          postcode: leg.postcode,
          provinceId: leg.provinceId,
          quantity: leg.quantity,
          shippingNetAmount: formatMoney(leg.net),
          sort: i,
        },
      });
    }
    await tx.orderGroup.update({
      where: { id: plan.groupId },
      data: { ...groupTotals, updatedById: actor.userId, rowVersion: { increment: 1 } },
    });
    await this.conversion.markConverted(tx, quote.id);
    await this.orders.record(
      tx,
      'order',
      order.publicId,
      'order.repriced',
      {
        revision: current.pricingRevision + 1,
        previousGrossAmount: current.grossAmount.toFixed(2),
        newGrossAmount: draft.totals.grossAmount,
        groupGrossAmount: groupTotals.grossAmount,
        quoteId: quote.publicId,
        reason,
        source: opts.source ?? 'staff',
      },
      actor,
    );
    return { previousGrossAmount: current.grossAmount.toFixed(2), newGrossAmount: draft.totals.grossAmount };
  }

  // --- change customer --------------------------------------------------------------------------------

  /** Moves an unpaid group (nothing paid) to another customer; the tax profile must be chosen again. */
  async changeCustomer(
    actor: UserActor,
    groupPublicId: string,
    ifMatch: string | undefined,
    customerPublicId: string,
  ) {
    return this.prisma.withTx(async (tx) => {
      const group = await this.orders.group(groupPublicId, undefined, tx);
      assertIfMatch(ifMatch, groupEtag(group));
      if (group.status !== 'waiting_payment' || (await this.paid(tx, group.id)) !== '0.00')
        throw new DomainException('order.invalid_transition', {
          params: { from: group.status, fact: 'customer_changed', reason: 'only unpaid groups' },
        });
      const to = await this.customers.customerIdOf(customerPublicId, tx);
      if (to === group.customerUserId) return group;
      await this.customers.ensureProfile(tx, to);
      await tx.orderGroup.update({
        where: { id: group.id },
        data: {
          customerUserId: to,
          taxProfileSnapshot: Prisma.DbNull,
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      await tx.order.updateMany({
        where: { orderGroupId: group.id },
        data: { customerUserId: to, rowVersion: { increment: 1 } },
      });
      await tx.orderDestination.updateMany({
        where: { order: { orderGroupId: group.id } },
        data: { customerAddressId: null },
      });
      const toUser = await tx.user.findUniqueOrThrow({ where: { id: to } });
      await this.orders.record(
        tx,
        'order_group',
        group.publicId,
        'order_group.customer_changed',
        {
          fromCustomerId: group.customer.publicId,
          toCustomerId: toUser.publicId,
        },
        actor,
      );
      return this.orders.group(groupPublicId, undefined, tx);
    });
  }

  // --- remarks, cc e-mails, PO number, notes ----------------------------------------------------------

  async updateGroup(
    actor: UserActor,
    groupPublicId: string,
    ifMatch: string | undefined,
    body: { csRemarks?: string | null; ccEmails?: string[]; poNumber?: string | null },
  ): Promise<OrderGroupRow> {
    return this.prisma.withTx(async (tx) => {
      const group = await this.orders.group(groupPublicId, undefined, tx);
      assertIfMatch(ifMatch, groupEtag(group));
      await tx.orderGroup.update({
        where: { id: group.id },
        data: {
          ...(body.csRemarks !== undefined && { csRemarks: body.csRemarks }),
          ...(body.ccEmails !== undefined && {
            ccEmails: [...new Set(body.ccEmails.map((e) => e.toLowerCase()))],
          }),
          ...(body.poNumber !== undefined && { poNumber: body.poNumber }),
          updatedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      // CS remarks, cc e-mails and PO numbers are back-office edits (remarks are internal only).
      await this.orders.record(
        tx,
        'order_group',
        group.publicId,
        'order_group.updated',
        {
          fields: Object.keys(body),
        },
        actor,
        ['internal'],
      );
      return tx.orderGroup.findUniqueOrThrow({ where: { id: group.id }, include: GROUP_INCLUDE });
    });
  }

  async addNote(actor: UserActor, orderPublicId: string, body: string, mentionPublicIds: string[] = []) {
    return this.prisma.withTx(async (tx) => {
      const order = await this.orders.order({ publicId: orderPublicId }, undefined, tx);
      const mentioned = mentionPublicIds.length
        ? await tx.user.findMany({
            where: { publicId: { in: mentionPublicIds }, kind: 'staff' },
            select: { id: true, publicId: true },
          })
        : [];
      if (mentioned.length !== new Set(mentionPublicIds).size)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'mentions', code: 'exists', message: 'every mention must be a staff user' }],
        });
      const note = await tx.orderNote.create({
        data: { orderId: order.id, authorUserId: actor.userId, body, mentions: mentioned.map((m) => m.id) },
        include: { author: true },
      });
      // Internal notes stay internal: the customer's timeline never learns of them.
      await this.orders.record(
        tx,
        'order',
        order.publicId,
        'order.note_added',
        {
          noteId: note.publicId,
          mentionIds: mentioned.map((m) => m.publicId),
        },
        actor,
        ['internal'],
      );
      return note;
    });
  }

  async notes(orderId: bigint, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.orderNote.findMany({
        where: { orderId },
        include: { author: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.orderNote.count({ where: { orderId } }),
    ]);
    const people = await this.mentioned(rows.flatMap((r) => r.mentions));
    return [
      rows.map((r) => ({ ...r, mentioned: r.mentions.map((id) => people.get(id)!).filter(Boolean) })),
      total,
    ] as const;
  }

  /** Staff users mentioned in notes, by internal id. */
  async mentioned(ids: bigint[]) {
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: [...new Set(ids)] } },
          select: { id: true, publicId: true, displayName: true },
        })
      : [];
    return new Map(users.map((u) => [u.id, { id: u.publicId, displayName: u.displayName }]));
  }

  // --- work queues --------------------------------------------------------------------------------------

  /** Admin work queues; `withinDays` narrows "due soon" (a view filter, not a business rule). */
  async queue(key: QueueKey, page: number, perPage: number, withinDays = 3, now = new Date()) {
    const where = orderQueueWhere(key, withinDays, now);
    const orderBy: Prisma.OrderOrderByWithRelationInput =
      key === 'waiting_payment'
        ? { createdAt: 'asc' }
        : key === 'artwork_review'
          ? { updatedAt: 'asc' }
          : { promisedShipDate: 'asc' };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { ...ORDER_INCLUDE, orderGroup: { include: { customer: true } } },
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { rows, total };
  }

  // --- helpers ------------------------------------------------------------------------------------------

  private async destinations(order: OrderRow, quantity: number, input?: RepriceInput['destinations']) {
    if (input) {
      const sum = input.reduce((a, d) => a + d.quantity, 0);
      if (sum !== quantity)
        throw new DomainException('validation.failed', {
          errors: [{ path: 'destinations', code: 'sum', message: `quantities must add up to ${quantity}` }],
        });
      return Promise.all(
        input.map(async (d, i) => {
          try {
            const { id, snapshot } = await this.customers.addressSnapshot(
              this.prisma,
              order.customerUserId,
              d.addressId,
            );
            return {
              id: null,
              customerAddressId: id,
              addressSnapshot: snapshot as unknown as Prisma.JsonValue,
              quantity: d.quantity,
            };
          } catch {
            throw new DomainException('validation.failed', {
              errors: [{ path: `destinations[${i}].addressId`, code: 'exists', message: 'unknown address' }],
            });
          }
        }),
      );
    }
    if (order.destinations.length !== 1 && quantity !== order.quantityOrdered)
      throw new DomainException('validation.failed', {
        errors: [
          { path: 'destinations', code: 'required', message: 'split destinations need new quantities' },
        ],
      });
    return order.destinations.map((d) => ({
      id: null,
      customerAddressId: d.customerAddressId,
      addressSnapshot: destinationSnapshot(d) as unknown as Prisma.JsonValue,
      quantity: order.destinations.length === 1 ? quantity : d.quantity,
    }));
  }

  private async paid(tx: Tx, groupId: bigint): Promise<string> {
    let paid = new MoneyDecimal(0);
    for (const hook of this.hooks.list()) {
      if (hook.paidAmount) paid = paid.add(await hook.paidAmount(tx, groupId));
    }
    return formatMoney(paid);
  }
}

function totalsRow(o: {
  netAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  shippingNetAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  whtAmount: Prisma.Decimal;
  cashAmount: Prisma.Decimal;
}): Totals {
  return {
    netAmount: o.netAmount.toFixed(2),
    discountAmount: o.discountAmount.toFixed(2),
    shippingNetAmount: o.shippingNetAmount.toFixed(2),
    vatAmount: o.vatAmount.toFixed(2),
    grossAmount: o.grossAmount.toFixed(2),
    whtAmount: o.whtAmount.toFixed(2),
    cashAmount: o.cashAmount.toFixed(2),
  };
}

/** Which orders a work queue holds (shared with the admin dashboard counts, U-B0.3). */
export function orderQueueWhere(key: QueueKey, withinDays = 3, now = new Date()): Prisma.OrderWhereInput {
  const today = new Date(`${bangkokDate(now)}T00:00:00Z`);
  const notShipped = { shippedAt: null, cancelledAt: null };
  return key === 'waiting_payment'
    ? { status: 'waiting_payment', orderGroup: { status: 'waiting_payment' } }
    : key === 'artwork_review'
      ? { artworkStatus: { in: ['uploaded', 'in_review'] }, cancelledAt: null }
      : key === 'waiting_production'
        ? { status: { in: ['paid_for_production', 'artwork_approved'] } }
        : key === 'due_soon'
          ? {
              ...notShipped,
              promisedShipDate: { gte: today, lte: new Date(today.getTime() + withinDays * 86_400_000) },
            }
          : { ...notShipped, promisedShipDate: { lt: today } };
}
