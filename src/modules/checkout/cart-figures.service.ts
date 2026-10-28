import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { cartLimits } from '@modules/carts/cart-settings';
import { cartDto, type CartExtras, quantityEditable } from '@modules/carts/cart-views';
import { type CartDto, type CartShippingEstimateDto } from '@modules/carts/carts.dto';
import { type CartItemRow, type CartRow, productGross } from '@modules/carts/carts.service';
import { vatStandardPct } from '@modules/pricing/hints/vat-figures';
import { QuoteEngineService } from '@modules/pricing/quotes/quote-engine.service';
import { arrivalWindow, type TransitDaysValue, transitFor } from '@modules/pricing/quotes/transit-days';
import { pricedConfiguration } from '@modules/quotes/quote-input';
import { Injectable } from '@nestjs/common';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { goodsVat, tierHintOf } from './cart-figures';
import { type QuoteOptionInput } from './order-pricing';

const D = (v: string | number | MoneyValue | null | undefined) => new MoneyDecimal(v?.toString() ?? '0');

const optionInput = (item: CartItemRow): QuoteOptionInput => ({
  source: item.quote.source,
  quantity: item.quoteOption.quantity,
  netAmount: item.quoteOption.netAmount.toFixed(2),
  vatAmount: item.quoteOption.vatAmount.toFixed(2),
  grossAmount: item.quoteOption.grossAmount.toFixed(2),
  shippingAmount: item.quoteOption.shippingAmount?.toFixed(2) ?? null,
  result: (item.quoteOption.result ?? {}) as QuoteOptionInput['result'],
});

/** The VAT of an RFQ quotation's own shipping line (as `priceOrderLines` keeps it). */
function rfqShippingVat(item: CartItemRow): MoneyValue {
  const result = (item.quoteOption.result ?? {}) as QuoteOptionInput['result'];
  if (result.shippingVatAmount !== undefined && result.shippingVatAmount !== null)
    return D(result.shippingVatAmount);
  return D(item.quoteOption.shippingAmount?.toString()).sub(D(result.shippingNetAmount));
}

/**
 * D-452 (Stage C block C5): the cart's summary figures and its shipping estimate. Everything comes from the
 * services checkout already uses — the order pricing for the VAT included in the goods, the quotation's own options
 * for the tier hint, the quote engine's destination shipping for the estimate — and nothing is written.
 */
@Injectable()
export class CartFigures {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly engine: QuoteEngineService,
    private readonly calendars: BusinessCalendarService,
  ) {}

  /** The cart as `CartDto` with VAT, limits, tier hints and quantity limits. */
  async view(cart: CartRow, now = new Date()): Promise<CartDto> {
    return cartDto(cart, now, await this.extras(cart, now));
  }

  async extras(cart: CartRow, now = new Date()): Promise<CartExtras> {
    const [limits, vatAmount, options, products] = await Promise.all([
      cartLimits(this.settings, now),
      this.goodsVat(cart, now),
      this.prisma.quoteOption.findMany({
        where: { quoteId: { in: [...new Set(cart.items.map((i) => i.quoteId))] } },
        select: {
          quoteId: true,
          publicId: true,
          quantity: true,
          unitPrice: true,
          grossAmount: true,
          shippingAmount: true,
        },
      }),
      this.prisma.catalogProduct.findMany({
        where: {
          id: {
            in: cart.items.map((i) => i.quote.catalogProductId).filter((id): id is bigint => id !== null),
          },
        },
        select: { id: true, quantityMin: true, quantityMax: true },
      }),
    ]);
    const items = new Map(
      cart.items.map((item) => {
        const locked = item.priceLockedUntil > now && item.pendingQuoteOptionId === null;
        const product = products.find((p) => p.id === item.quote.catalogProductId);
        const tierHint =
          locked && quantityEditable(item)
            ? tierHintOf(
                options
                  .filter((o) => o.quoteId === item.quoteId)
                  .map((o) => ({
                    publicId: o.publicId,
                    quantity: o.quantity,
                    unitPrice: o.unitPrice.toString(),
                    grossAmount: o.grossAmount.toFixed(2),
                    shippingAmount: o.shippingAmount?.toFixed(2) ?? null,
                  })),
                { quantity: item.quantity, unitPrice: item.unitPrice.toString() },
              )
            : null;
        return [
          item.publicId,
          {
            tierHint,
            quantityLimits: product ? { min: product.quantityMin, max: product.quantityMax } : null,
          },
        ] as const;
      }),
    );
    return { vatAmount, maxCodes: limits.maxCodes, quantityStep: limits.quantityStep, items };
  }

  /** VAT included in the goods of every item (each at its quotation's VAT rate); null when a rate is missing. */
  async goodsVat(cart: CartRow, now = new Date()): Promise<string | null> {
    let total = D(0);
    for (const item of cart.items) {
      const pct = await this.vatPctOf(item, now);
      if (pct === null) return null;
      total = total.add(goodsVat(optionInput(item), pct));
    }
    return formatMoney(total);
  }

  /**
   * Shipping every item to `postcode` at the customer rate card (D-013) — what checkout prices per destination —
   * with the zone's name and the arrival window (ready date + transit working days). Nothing is saved.
   */
  async estimateShipping(
    cart: CartRow,
    postcode: string,
    now = new Date(),
  ): Promise<CartShippingEstimateDto> {
    let net = D(0);
    let rfqGross = D(0);
    let zone: { code: string; nameTh: string; nameEn: string } | null = null;
    const unavailable: string[] = [];
    for (const item of cart.items) {
      if (item.quote.source === 'rfq') {
        // An RFQ quotation priced delivery to its own postcode only (`checkout.rfq_destination_fixed`).
        if (item.quote.deliveryPostcode !== postcode) unavailable.push(item.publicId);
        else rfqGross = rfqGross.add(D(item.shippingAmount?.toString()));
        continue;
      }
      const factoryId = item.quoteOption.selectedFactoryId;
      const calculator = item.quote.productType.calculatorKey;
      if (!factoryId || !calculator) {
        unavailable.push(item.publicId);
        continue;
      }
      const [leg] = await this.engine.destinationShipping(
        calculator,
        pricedConfiguration(item.quote.input),
        factoryId,
        [{ postcode, quantity: item.quantity }],
        now,
      );
      if (!leg?.available) {
        unavailable.push(item.publicId);
        continue;
      }
      net = net.add(leg.net);
      zone ??= leg.zone;
    }
    const available = cart.items.length > 0 && unavailable.length === 0;
    const pct = available ? await vatStandardPct(this.prisma, now) : null;
    const shippingVat =
      pct !== null ? net.mul(pct).div(100).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP) : null;
    const gross = available && shippingVat !== null ? net.add(shippingVat).add(rfqGross) : null;
    const goodsVat = gross ? await this.goodsVat(cart, now) : null;
    const goodsGross = cart.items.reduce((a, i) => a.add(productGross(i)), D(0));
    // An RFQ quotation's own shipping VAT is inside its option's VAT (order-pricing), so it counts here too.
    const rfqShipVat = cart.items
      .filter((i) => i.quote.source === 'rfq')
      .reduce((a, i) => a.add(rfqShippingVat(i)), D(0));
    const readyDate = await this.readyDate(cart, now);
    const arrival = available && zone && readyDate ? await this.arrival(zone.code, readyDate, now) : null;
    return {
      postcode,
      available: gross !== null,
      shippingGrossAmount: gross ? formatMoney(gross) : null,
      totalGrossAmount: gross ? formatMoney(goodsGross.add(gross)) : null,
      vatAmount:
        gross && goodsVat !== null && shippingVat !== null
          ? formatMoney(D(goodsVat).add(shippingVat).add(rfqShipVat))
          : null,
      zone: zone ? { th: zone.nameTh, en: zone.nameEn } : null,
      readyDate,
      arrival,
      unavailableItemIds: unavailable,
    };
  }

  /**
   * The latest ready date of the items as checkout promises it (D-436): the quotation's earliest ship date while
   * ahead, else today + its lead time in working days; null when an item has neither.
   */
  private async readyDate(cart: CartRow, now: Date): Promise<string | null> {
    const today = bangkokDate(now);
    let latest: string | null = null;
    const calendar = await this.calendars.calendar();
    for (const item of cart.items) {
      const ship = item.quoteOption.earliestShipDate?.toISOString().slice(0, 10) ?? null;
      const day =
        ship && ship >= today
          ? ship
          : item.quoteOption.leadTimeDays !== null
            ? bangkokDate(calendar.addWorkingDays(startOfBangkokDay(today), item.quoteOption.leadTimeDays))
            : null;
      if (day === null) return null;
      if (latest === null || day > latest) latest = day;
    }
    return latest;
  }

  private async arrival(zoneCode: string, readyDate: string, now: Date) {
    let value: TransitDaysValue;
    try {
      value = (await this.settings.at('shipping.transit_days', { at: now })).value;
    } catch (error) {
      if (error instanceof SettingNotFoundError) return null;
      throw error;
    }
    const transit = transitFor(value, zoneCode);
    return transit ? arrivalWindow(await this.calendars.calendar(), readyDate, transit) : null;
  }

  /** The quotation's VAT rate (its snapshot), else the approved `vat_standard` rate in force; null when none. */
  private async vatPctOf(item: CartItemRow, now: Date): Promise<string | null> {
    const refs = (item.quote.configRefs ?? {}) as { vatRateVersionId?: string | null };
    if (refs.vatRateVersionId) {
      const version = await this.prisma.taxRateVersion.findUnique({
        where: { id: BigInt(refs.vatRateVersionId) },
      });
      if (version) return version.ratePct.toString();
    }
    const pct = await vatStandardPct(this.prisma, now);
    return pct ? pct.toString() : null;
  }
}
