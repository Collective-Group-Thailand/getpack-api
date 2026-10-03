import { createHash } from 'node:crypto';

import { DomainException } from '@common/errors/domain.exception';
import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type DesignOption, type MockupOption, Prisma, type ProductUnit } from '@generated/prisma/client';
import { type CartActor, type CartItemRow, type CartRow, CartsService } from '@modules/carts/carts.service';
import { canonical } from '@modules/catalog/imports/import-engine';
import { CustomersService, type TaxProfileSnapshot } from '@modules/customers/customers.service';
import { QuoteEngineService } from '@modules/pricing/quotes/quote-engine.service';
import { QuoteConversionService } from '@modules/quotes/quote-conversion.service';
import { pricedConfiguration } from '@modules/quotes/quote-input';
import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@platform/activity/activity-log.service';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { DocumentNumberingService } from '@platform/numbering/document-numbering.service';
import { type SettingValues } from '@platform/settings/setting-keys';
import { SettingsService } from '@platform/settings/settings.service';

import { GROUP_INCLUDE, type OrderGroupRow } from '../orders/order-views';
import {
  type CheckoutDraft,
  CheckoutExtensions,
  type CheckoutInput,
  type DraftOrder,
  type PlacedGroup,
  type ShippingLeg,
} from './checkout.extensions';
import {
  addTotals,
  type LineType,
  priceOrderLines,
  type QuoteOptionInput,
  shippedPerDestination,
  totalsOf,
} from './order-pricing';

const D = (v: string | number | MoneyValue | Prisma.Decimal | null | undefined) =>
  new MoneyDecimal(v?.toString() ?? '0');
const DAY_MS = 86_400_000;
const LINE_UNITS: Record<LineType, ProductUnit | null> = {
  product: null,
  design_fee: 'job',
  structure_design_fee: 'job',
  shipping: 'trip',
};

/** What `priceItem` needs: a cart item satisfies it; CS re-pricing builds one from an order. */
export interface PricingItem {
  id: bigint | null;
  publicId: string | null;
  quote: CartItemRow['quote'];
  quoteOption: CartItemRow['quoteOption'];
  destinations: {
    id: bigint | null;
    customerAddressId: bigint | null;
    addressSnapshot: Prisma.JsonValue;
    quantity: number;
  }[];
  designOption: string;
  designNote: string | null;
  mockupOption: string;
  reorderOfOrderId: bigint | null;
  designDocumentId: bigint | null;
  /** D-276 the design version pinned on the cart item (absent when re-pricing an existing order). */
  designDocumentVersionId?: bigint | null;
  reuseArtworkProofId: bigint | null;
}

function invalid(path: string, message: string, code = 'invalid'): never {
  throw new DomainException('validation.failed', { errors: [{ path, code, message }] });
}

/**
 * Checkout (B3.1): the server re-prices everything — each cart item keeps its locked quotation price
 * (D-051) and gets shipping priced per destination (D-013) — then one **order group** and one **order
 * per cart item** are written in one transaction with their lines, destinations (the snapshot factories
 * see, D-142), pricing snapshot and version ids, expected customer withholding (D-174) and the unpaid
 * expiry (D-060). Extensions (promotions, points, discounts, payment schedule, company approval) plug in
 * through `CheckoutExtensions`. Preview runs the same pricing without writing.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartsService,
    private readonly customers: CustomersService,
    private readonly engine: QuoteEngineService,
    private readonly conversion: QuoteConversionService,
    private readonly settings: SettingsService,
    private readonly numbering: DocumentNumberingService,
    private readonly calendars: BusinessCalendarService,
    private readonly extensions: CheckoutExtensions,
    private readonly events: DomainEvents,
    private readonly activity: ActivityLogService,
  ) {}

  /** Prices the active cart for checkout (no writes). */
  async price(who: CartActor, input: CheckoutInput, at = new Date()): Promise<CheckoutDraft> {
    const cart = await this.carts.get(who);
    if (cart.items.length === 0) throw new DomainException('checkout.cart_empty');
    this.checkItems(cart, at);
    let taxProfile: TaxProfileSnapshot | null = null;
    for (const extension of this.extensions.list()) {
      const supplied = extension.taxProfile ? await extension.taxProfile(who, input, this.prisma) : undefined;
      if (supplied !== undefined) {
        taxProfile = supplied;
        break;
      }
    }
    if (!taxProfile && input.taxProfileId)
      taxProfile = await this.taxProfile(who.customerUserId, input.taxProfileId);
    const nature = await this.settings.at('tax.nature_by_product_type', { at });
    const floor = await this.settings.at('pricing.margin_floor_pct', { at });
    const withholds = taxProfile !== null && taxProfile.withholdsTax && taxProfile.taxType !== 'individual';
    const wht = withholds ? await this.whtRates(at) : null;

    const orders: DraftOrder[] = [];
    let vatPct = '7';
    for (const [index, item] of cart.items.entries()) {
      const priced = await this.priceItem(item, index, at, nature, wht);
      vatPct = priced.vatPct;
      orders.push(priced.order);
    }

    const draft: CheckoutDraft = {
      actor: who.actor,
      customerUserId: who.customerUserId,
      channel: who.channel,
      csUserId: who.csUserId,
      at,
      cartId: cart.id,
      cartRowVersion: cart.rowVersion,
      input,
      taxProfile,
      vatPct,
      orders,
      totals: addTotals(orders.map((o) => o.totals)),
      notices: [],
      state: {},
      preview: {},
      initialStatus: 'waiting_payment',
      settingVersionIds: {
        'tax.nature_by_product_type': String(nature.versionId),
        'pricing.margin_floor_pct': String(floor.versionId),
      },
    };
    // Totals are recomputed after each extension, so later ones (the schedule) see the discounted amounts.
    for (const extension of this.extensions.list()) {
      if (!extension.adjust) continue;
      await extension.adjust(draft, this.prisma);
      for (const order of draft.orders) order.totals = totalsOf(order.lines);
      draft.totals = addTotals(draft.orders.map((o) => o.totals));
    }
    draft.state['marginFloorPct'] = String(floor.value);
    return draft;
  }

  /** Places the order group (Idempotency-Key at the controller). */
  async checkout(who: CartActor, input: CheckoutInput): Promise<OrderGroupRow> {
    const draft = await this.price(who, input);
    if (input.expectedGrossAmount && D(input.expectedGrossAmount).cmp(draft.totals.grossAmount) !== 0) {
      throw new DomainException('checkout.total_changed', {
        params: { expected: input.expectedGrossAmount, actual: draft.totals.grossAmount },
      });
    }
    const expiry = await this.settings.at('orders.unpaid_expiry_days', { at: draft.at });
    const calendar = await this.calendars.calendar();
    const floor = D(draft.state['marginFloorPct'] as string);
    return this.prisma.withTx(
      async (tx) => {
        const { count } = await tx.cart.updateMany({
          where: { id: draft.cartId, status: 'active', rowVersion: draft.cartRowVersion },
          data: { status: 'checked_out', checkedOutAt: draft.at, rowVersion: { increment: 1 } },
        });
        if (count !== 1) throw new DomainException('concurrency.stale');
        await this.customers.assignCode(tx, draft.customerUserId);
        await this.recordFirstTouch(tx, draft);
        const entity = await tx.entity.findFirstOrThrow({ where: { isDefault: true } });
        const groupCode = await this.numbering.next(tx, 'order_group', draft.at);
        const placedBy = draft.actor.type === 'user' ? draft.actor.userId : draft.customerUserId;
        const group = await tx.orderGroup.create({
          data: {
            groupCode,
            entityId: entity.id,
            customerUserId: draft.customerUserId,
            placedByUserId: placedBy,
            onBehalfOfUserId: draft.csUserId ? draft.customerUserId : null,
            cartId: draft.cartId,
            channel: draft.channel,
            status: draft.initialStatus,
            taxProfileSnapshot: (draft.taxProfile ?? undefined) as Prisma.InputJsonValue | undefined,
            poNumber: draft.input.poNumber ?? null,
            ...draft.totals,
            expiresAt:
              draft.initialStatus === 'waiting_payment'
                ? new Date(draft.at.getTime() + Number(expiry.value) * DAY_MS)
                : null,
            placedAt: draft.at,
            ccEmails: [...new Set((draft.input.ccEmails ?? []).map((e) => e.toLowerCase()))],
            csRemarks: draft.input.csRemarks ?? null,
            utm: draft.input.utm ?? undefined,
          },
        });

        const placed: PlacedGroup = { groupId: group.id, groupPublicId: group.publicId, orders: [] };
        for (const o of draft.orders) {
          const orderCode = await this.numbering.next(tx, 'order', draft.at);
          const snapshot = this.snapshotOf(o, draft, String(expiry.versionId));
          const configRefs = {
            ...o.configRefs,
            settingVersionIds: {
              ...((o.configRefs['settingVersionIds'] as Record<string, string> | undefined) ?? {}),
              ...draft.settingVersionIds,
              'orders.unpaid_expiry_days': String(expiry.versionId),
            },
          };
          const payable = D(o.totals.netAmount).sub(o.totals.discountAmount);
          const margin = o.buyCostNet ? payable.sub(o.buyCostNet) : null;
          const marginPct = margin && payable.gt(0) ? margin.div(payable).mul(100) : null;
          const order = await tx.order.create({
            data: {
              orderCode,
              entityId: entity.id,
              orderGroupId: group.id,
              // D-253: a standalone sample quotation becomes an order of kind `sample`.
              kind: o.quoteSource === 'sample' ? 'sample' : 'standard',
              customerUserId: draft.customerUserId,
              productTypeId: o.productTypeId,
              catalogProductId: o.catalogProductId,
              stockProductId: o.stockProductId,
              quoteId: o.quoteId,
              quoteOptionId: o.quoteOptionId,
              reorderOfOrderId: o.reorderOfOrderId,
              designDocumentId: o.designDocumentId,
              designDocumentVersionId: o.designDocumentVersionId,
              reuseArtworkProofId: o.reuseArtworkProofId,
              artworkStatus: 'awaiting_template',
              designOption: o.designOption as DesignOption,
              designNote: o.designNote,
              mockupOption: o.mockupOption as MockupOption,
              quantityOrdered: o.quantity,
              unit: o.unit as ProductUnit,
              toleranceShortagePct: o.toleranceShortagePct,
              toleranceOveragePct: o.toleranceOveragePct,
              toleranceDimensionalMm: o.toleranceDimensionalMm,
              toleranceColourDeltaE: o.toleranceColourDeltaE,
              taxNature: o.lines[0]!.taxNature,
              pricingSnapshot: snapshot as Prisma.InputJsonValue,
              configRefs: configRefs,
              snapshotSha256: createHash('sha256')
                .update(JSON.stringify(canonical({ snapshot, configRefs })))
                .digest(),
              ...o.totals,
              leadTimeDays: o.leadTimeDays,
              promisedShipDate: this.promisedShipDate(o, draft.at, calendar),
              selectedFactoryId: o.selectedFactoryId,
              buyCostNet: o.buyCostNet ? formatMoney(o.buyCostNet) : null,
              marginAmount: margin ? formatMoney(margin) : null,
              marginPct: marginPct ? marginPct.toFixed(4) : null,
              belowMarginFloor: marginPct ? marginPct.lt(floor) : false,
            },
          });
          const lineIds: bigint[] = [];
          for (const [i, line] of o.lines.entries()) {
            const created = await tx.orderLine.create({
              data: {
                orderId: order.id,
                lineNo: i + 1,
                lineType: line.lineType,
                descriptionTh: line.descriptionTh,
                descriptionEn: line.descriptionEn,
                quantity: String(line.quantity),
                unit: LINE_UNITS[line.lineType] ?? (o.unit as ProductUnit),
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
                buyCostNet: line.lineType === 'product' && o.buyCostNet ? formatMoney(o.buyCostNet) : null,
              },
            });
            lineIds.push(created.id);
          }
          for (const d of o.discounts) {
            await tx.orderDiscount.create({
              data: {
                orderId: order.id,
                orderLineId: d.lineIndex === null ? null : lineIds[d.lineIndex]!,
                source: d.source,
                grantedByUserId: d.grantedByUserId ?? null,
                pct: d.pct ?? null,
                amount: d.amount,
                cappedAmount: d.cappedAmount ?? '0.00',
                capReason: d.capReason ?? null,
                promotionId: d.promotionId ?? null,
                couponCodeId: d.couponCodeId ?? null,
                campaignId: d.campaignId ?? null,
                discountMemoId: d.discountMemoId ?? null,
              },
            });
          }
          for (const [i, leg] of o.legs.entries()) {
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
          placed.orders.push({ id: order.id, publicId: order.publicId, draft: o });
        }

        for (const quoteId of new Set(draft.orders.map((o) => o.quoteId))) {
          await this.conversion.markConverted(tx, quoteId);
        }
        for (const extension of this.extensions.list()) {
          if (extension.placed) await extension.placed(tx, draft, placed);
        }
        await this.recordPlaced(tx, draft, group.publicId, groupCode, placed);
        return tx.orderGroup.findUniqueOrThrow({ where: { id: group.id }, include: GROUP_INCLUDE });
      },
      { timeout: 30_000 },
    );
  }

  /**
   * Prices one configuration (a cart item, or an order being re-priced by CS): locked quotation price,
   * shipping per destination, VAT and withholding per line. Shared by checkout and the CS re-price.
   */
  async priceItem(
    item: PricingItem,
    index: number,
    at: Date,
    nature: { value: SettingValues['tax.nature_by_product_type']; versionId: bigint },
    wht: {
      rates: Record<'hire_of_work' | 'transport' | 'service', string>;
      versionIds: Record<string, string>;
    } | null,
  ): Promise<{ order: DraftOrder; vatPct: string }> {
    const option = item.quoteOption;
    const configRefs = (item.quote.configRefs ?? {}) as { vatRateVersionId?: string | null };
    const vatPct = await this.vatPct(configRefs.vatRateVersionId ?? null, at);
    const legs = await this.legs(item, index, at);
    const productTypeCode = item.quote.productType.code;
    const natureOf = nature.value.overrides[productTypeCode] ?? nature.value.default;
    const optionInput: QuoteOptionInput = {
      source: item.quote.source,
      quantity: option.quantity,
      netAmount: option.netAmount.toFixed(2),
      vatAmount: option.vatAmount.toFixed(2),
      grossAmount: option.grossAmount.toFixed(2),
      shippingAmount: option.shippingAmount?.toFixed(2) ?? null,
      result: (option.result ?? {}) as QuoteOptionInput['result'],
    };
    const shippingNet = shippedPerDestination(item.quote.source)
      ? legs.reduce((a, l) => a.add(l.net), D(0))
      : null;
    const lines = priceOrderLines(optionInput, shippingNet, {
      vatPct,
      nature: natureOf,
      // D-254: a standalone sample is revenue 4140 (mockup / sample fees).
      productRevenue:
        item.quote.source === 'sample'
          ? 'mockup'
          : productTypeCode === 'standard_product'
            ? 'standard_product'
            : 'made_to_order',
      wht: wht?.rates ?? null,
    });
    const internal = (option.internalBreakdown ?? null) as {
      shipping?: { costAmount?: string } | null;
    } | null;
    const quoteShipCost = D(internal?.shipping?.costAmount ?? '0');
    const legCost = legs.reduce((a, l) => a.add(l.cost ?? 0), D(0));
    const buyCostNet = option.buyCostNet
      ? shippedPerDestination(item.quote.source)
        ? D(option.buyCostNet).sub(quoteShipCost).add(legCost)
        : D(option.buyCostNet)
      : null;
    const order: DraftOrder = {
      cartItemId: item.id,
      cartItemPublicId: item.publicId,
      quoteId: item.quote.id,
      quotePublicId: item.quote.publicId,
      quoteCode: item.quote.quoteCode,
      quoteSource: item.quote.source,
      quoteOptionId: option.id,
      productTypeId: item.quote.productTypeId,
      productTypeCode,
      catalogProductId: item.quote.catalogProductId,
      stockProductId: item.quote.stockProductId,
      quantity: option.quantity,
      unit: option.unit,
      designOption: item.designOption,
      designNote: item.designNote,
      mockupOption: item.mockupOption,
      reorderOfOrderId: item.reorderOfOrderId,
      designDocumentId: item.designDocumentId,
      designDocumentVersionId: item.designDocumentVersionId ?? null,
      reuseArtworkProofId: item.reuseArtworkProofId,
      leadTimeDays: option.leadTimeDays,
      earliestShipDate: option.earliestShipDate,
      toleranceShortagePct: option.toleranceShortagePct?.toFixed(4) ?? null,
      toleranceOveragePct: option.toleranceOveragePct?.toFixed(4) ?? null,
      toleranceDimensionalMm: option.toleranceDimensionalMm?.toFixed(2) ?? null,
      toleranceColourDeltaE: option.toleranceColourDeltaE?.toFixed(2) ?? null,
      selectedFactoryId: option.selectedFactoryId,
      lines,
      discounts: [],
      legs,
      buyCostNet,
      totals: totalsOf(lines),
      snapshot: {},
      configRefs: {
        ...(item.quote.configRefs as Record<string, unknown>),
        checkout: {
          natureSettingVersionId: String(nature.versionId),
          whtRateVersionIds: wht?.versionIds ?? null,
          shippingRateVersionIds: legs.map((l) => ({
            customer: l.customerRateVersionId,
            factoryPayout: l.factoryPayoutVersionId,
          })),
        },
      },
    };
    return { order, vatPct };
  }

  // --- helpers --------------------------------------------------------------------------------------

  /** Every item must hold its price lock and have complete destinations. */
  private checkItems(cart: CartRow, at: Date) {
    const expired = cart.items.filter((i) => i.priceLockedUntil <= at || i.pendingQuoteOptionId !== null);
    if (expired.length > 0)
      throw new DomainException('checkout.price_expired', {
        params: { items: expired.map((i) => i.publicId).join(', ') },
      });
    for (const [index, item] of cart.items.entries()) {
      const covered = item.destinations.reduce((a, d) => a + d.quantity, 0);
      if (item.destinations.length === 0 || covered !== item.quantity) {
        throw new DomainException('checkout.destinations_incomplete', {
          errors: [
            { path: `items[${index}].destinations`, code: 'sum', message: `must add up to ${item.quantity}` },
          ],
        });
      }
    }
  }

  /** Destinations of an item with their shipping: priced per leg for instant quotations, fixed for RFQ. */
  private async legs(item: PricingItem, index: number, at: Date): Promise<ShippingLeg[]> {
    const rows = await Promise.all(
      item.destinations.map(async (d) => {
        const snap = d.addressSnapshot as {
          postcode: string;
          provinceId: string;
          subdistrictId: string | null;
        };
        const province = await this.prisma.geoProvince.findUnique({ where: { publicId: snap.provinceId } });
        const sub = snap.subdistrictId
          ? await this.prisma.geoSubdistrict.findUnique({ where: { publicId: snap.subdistrictId } })
          : null;
        if (!province) invalid(`items[${index}].destinations`, 'the address province no longer exists');
        return { d, snap, provinceId: province.id, subdistrictId: sub?.id ?? null };
      }),
    );
    if (item.quote.source === 'rfq') {
      // The quotation priced delivery to the RFQ's postcode only.
      if (rows.length !== 1 || rows[0]!.snap.postcode !== item.quote.deliveryPostcode) {
        throw new DomainException('checkout.rfq_destination_fixed', {
          errors: [
            {
              path: `items[${index}].destinations`,
              code: 'fixed',
              message: `one destination on postcode ${item.quote.deliveryPostcode ?? '-'}`,
            },
          ],
        });
      }
      const r = rows[0]!;
      return [
        {
          cartDestinationId: r.d.id,
          customerAddressId: r.d.customerAddressId,
          snapshot: r.d.addressSnapshot as Record<string, unknown>,
          postcode: r.snap.postcode,
          provinceId: r.provinceId,
          subdistrictId: r.subdistrictId,
          quantity: r.d.quantity,
          net: D(0),
          cost: null,
          method: null,
          customerRateVersionId: null,
          factoryPayoutVersionId: null,
        },
      ];
    }
    const factoryId = item.quoteOption.selectedFactoryId;
    if (!factoryId) throw new DomainException('checkout.shipping_unavailable');
    const calculator = item.quote.productType.calculatorKey;
    if (!calculator) throw new DomainException('checkout.shipping_unavailable');
    const priced = await this.engine.destinationShipping(
      calculator,
      pricedConfiguration(item.quote.input),
      factoryId,
      rows.map((r) => ({ postcode: r.snap.postcode, quantity: r.d.quantity })),
      at,
    );
    return rows.map((r, j) => {
      const p = priced[j]!;
      if (!p.available) {
        throw new DomainException('checkout.shipping_unavailable', {
          errors: [
            { path: `items[${index}].destinations[${j}]`, code: p.reason, message: 'no shipping price' },
          ],
        });
      }
      return {
        cartDestinationId: r.d.id,
        customerAddressId: r.d.customerAddressId,
        snapshot: r.d.addressSnapshot as Record<string, unknown>,
        postcode: r.snap.postcode,
        provinceId: r.provinceId,
        subdistrictId: r.subdistrictId,
        quantity: r.d.quantity,
        net: p.net,
        cost: p.cost,
        method: p.method,
        customerRateVersionId: p.customerRateVersionId,
        factoryPayoutVersionId: p.factoryPayoutVersionId,
      };
    });
  }

  private async taxProfile(userId: bigint, publicId: string): Promise<TaxProfileSnapshot> {
    try {
      return await this.customers.taxProfileSnapshot(this.prisma, userId, publicId);
    } catch (error) {
      if (error instanceof DomainException && error.code === 'http.not_found')
        invalid('taxProfileId', 'unknown tax profile', 'exists');
      throw error;
    }
  }

  private async vatPct(versionId: string | null, at: Date): Promise<string> {
    const version = versionId
      ? await this.prisma.taxRateVersion.findUnique({ where: { id: BigInt(versionId) } })
      : await this.prisma.taxRateVersion.findFirst({
          where: { taxRate: { code: 'vat_standard' }, status: 'approved', effectiveFrom: { lte: at } },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        });
    if (!version) throw new DomainException('pricing.vat_rate_missing');
    return version.ratePct.toString();
  }

  /** Customer withholding rates in force (D-174). */
  async whtRates(at: Date) {
    const codes = {
      hire_of_work: 'wht_customer_hire_of_work',
      transport: 'wht_customer_transport',
      service: 'wht_customer_service',
    } as const;
    const rates = {} as Record<keyof typeof codes, string>;
    const versionIds: Record<string, string> = {};
    for (const [category, code] of Object.entries(codes) as [keyof typeof codes, string][]) {
      const version = await this.prisma.taxRateVersion.findFirst({
        where: { taxRate: { code }, status: 'approved', effectiveFrom: { lte: at } },
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      });
      if (!version) throw new DomainException('checkout.wht_rate_missing', { params: { code } });
      rates[category] = version.ratePct.toString();
      versionIds[code] = String(version.id);
    }
    return { rates, versionIds };
  }

  /** The quotation's earliest ship date when still ahead, else today + lead time in working days. */
  private promisedShipDate(
    o: DraftOrder,
    at: Date,
    calendar: Awaited<ReturnType<BusinessCalendarService['calendar']>>,
  ): Date | null {
    const today = bangkokDate(at);
    if (o.earliestShipDate && o.earliestShipDate.toISOString().slice(0, 10) >= today)
      return o.earliestShipDate;
    if (o.leadTimeDays === null) return null;
    const day = bangkokDate(calendar.addWorkingDays(startOfBangkokDay(today), o.leadTimeDays));
    return new Date(`${day}T00:00:00Z`);
  }

  private snapshotOf(o: DraftOrder, draft: CheckoutDraft, expiryVersionId: string): Record<string, unknown> {
    return {
      schemaVersion: 1,
      quote: {
        id: o.quotePublicId,
        code: o.quoteCode,
        source: o.quoteSource,
        quantity: o.quantity,
      },
      tax: {
        vatPct: draft.vatPct,
        nature: o.lines[0]!.taxNature,
        taxProfile: draft.taxProfile,
      },
      shipping: o.legs.map((l) => ({
        postcode: l.postcode,
        quantity: l.quantity,
        net: formatMoney(l.net),
        method: l.method,
      })),
      lines: o.lines,
      // Internal ids stay out of the snapshot; promotions carry their public ids in `meta`.
      discounts: o.discounts.map(
        ({ promotionId: _p, couponCodeId: _c, campaignId: _k, discountMemoId: _m, ...d }) => ({
          ...d,
          grantedByUserId: d.grantedByUserId?.toString() ?? null,
        }),
      ),
      totals: o.totals,
      unpaidExpirySettingVersionId: expiryVersionId,
      ...o.snapshot,
    };
  }

  private async recordFirstTouch(tx: Tx, draft: CheckoutDraft) {
    if (!draft.input.utm) return;
    await tx.customerProfile.updateMany({
      where: { userId: draft.customerUserId, firstTouch: { equals: Prisma.DbNull } },
      data: { firstTouch: draft.input.utm },
    });
  }

  private async recordPlaced(
    tx: Tx,
    draft: CheckoutDraft,
    groupPublicId: string,
    groupCode: string,
    placed: PlacedGroup,
  ) {
    const customer = await tx.user.findUniqueOrThrow({ where: { id: draft.customerUserId } });
    const event = await this.events.record(
      tx,
      {
        type: 'order_group.placed',
        aggregateType: 'order_group',
        aggregateId: groupPublicId,
        payload: {
          groupId: groupPublicId,
          groupCode,
          customerId: customer.publicId,
          channel: draft.channel,
          status: draft.initialStatus,
          grossAmount: draft.totals.grossAmount,
          cashAmount: draft.totals.cashAmount,
          orderIds: placed.orders.map((o) => o.publicId),
          placedByCs: draft.csUserId !== null,
        },
      },
      draft.actor,
    );
    await this.activity.record(tx, {
      aggregateType: 'order_group',
      aggregatePublicId: groupPublicId,
      action: 'order_group.placed',
      messageKey: 'activity.order_group.placed',
      messageParams: { groupCode, grossAmount: draft.totals.grossAmount },
      visibility: ['internal', 'customer'],
      domainEventId: event.id,
      actor: draft.actor,
    });
    for (const o of placed.orders) {
      const orderEvent = await this.events.record(
        tx,
        {
          type: 'order.placed',
          aggregateType: 'order',
          aggregateId: o.publicId,
          payload: {
            orderId: o.publicId,
            groupId: groupPublicId,
            customerId: customer.publicId,
            productTypeCode: o.draft.productTypeCode,
            quantity: o.draft.quantity,
            grossAmount: o.draft.totals.grossAmount,
            quoteId: o.draft.quotePublicId,
          },
        },
        draft.actor,
      );
      await this.activity.record(tx, {
        aggregateType: 'order',
        aggregatePublicId: o.publicId,
        action: 'order.placed',
        messageKey: 'activity.order.placed',
        visibility: ['internal', 'customer'],
        domainEventId: orderEvent.id,
        actor: draft.actor,
      });
    }
  }
}
