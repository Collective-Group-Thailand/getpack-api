import { isIP } from 'node:net';

import { formatMoney, MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesChannel } from '@generated/prisma/client';
import { CapacityService } from '@modules/partners/capacity/capacity.service';
import { QuotePathService } from '@modules/partners/quote-path/quote-path.service';
import { type RateMissReason } from '@modules/shipping/rates/customer-rates.dto';
import {
  type Delivery,
  type ShipmentPart,
  ShippingQuoteService,
} from '@modules/shipping/shipping-quote.service';
import { Injectable, Logger } from '@nestjs/common';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import {
  FOLDING_CALCULATOR_VERSION,
  foldingCalculator,
  type OptionStep,
} from '../calculators/folding/folding-calculator';
import {
  type FoldingConfiguration,
  FoldingSnapshotLoader,
  type LoadedOption,
  type ResolvedFolding,
} from '../calculators/folding/folding-snapshot.loader';

/**
 * Prices a folding configuration for a channel (B2.3): the instant price paths of the type (D-043),
 * one option per factory × print type, the pure calculator, then the rules that need the database —
 * capacity on the promise (D-101), the selected factory's tolerance (D-021), the margin floor (D-012),
 * delivery as its own line (B2.4, D-013: customer rate card; factories ranked by buy price + their
 * delivery cost, fleet payout or fallback carrier) — and the calculate log (B6). Customers never see the factory (D-050): the staff-only part of the
 * result is separate and dropped by the store surface.
 */

export interface QuoteContext {
  channel: SalesChannel;
  at?: Date;
  actorUserId?: bigint;
  anonymousId?: string;
  ip?: string;
  deliveryPostcode?: string;
}

export interface QuoteStepView {
  quantity: number;
  instant: boolean;
  /** Why there is no instant price for this quantity (routes to RFQ). */
  reason: string | null;
  unitPrice: string | null;
  productAmount: string | null;
  designFeeAmount: string | null;
  structureDesignFeeAmount: string | null;
  /** Shipping incl. VAT; null while shipping is not priced. */
  shippingAmount: string | null;
  shippingNetAmount: string | null;
  shippingVatAmount: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  leadTimeDays: number | null;
  earliestShipDate: string | null;
  /** Ship date plus the zone's extra lead days or the carrier's transit days, when known. */
  earliestDeliveryDate: string | null;
  toleranceShortagePct: string | null;
  toleranceOveragePct: string | null;
  shippingPending: boolean;
  shippingPendingReason: RateMissReason | null;
  /** Staff only (D-044, D-050). */
  internal: {
    factoryId: string;
    printTypeId: string;
    priceListVersionId: string;
    buyPrice: string;
    marginPct: string;
    belowMarginFloor: boolean;
    productionRun: number;
    parts: {
      partKey: string;
      buyPrice: string;
      layoutAmount: number;
      sheets: number;
      layoutStandard: boolean;
    }[];
    shipping: {
      method: 'factory_fleet' | 'flash_express' | 'deliveree';
      costAmount: string;
      marginAmount: string;
      weightG: number;
      cartons: number | null;
      volumeCm3: number | null;
      pallets: number | null;
      zoneCode: string;
      customerRateVersionId: string;
      factoryPayoutVersionId: string | null;
    } | null;
  } | null;
}

export interface QuoteView {
  calculatorVersion: string;
  steps: QuoteStepView[];
  /** Staff only: every option priced, with its error when it had none. */
  options: { optionKey: string; error: string | null }[];
  configRefs: {
    priceListVersionIds: Record<string, string>;
    sellMarginVersionIds: string[];
    vatRateVersionId: string | null;
    shippingRateCardVersionIds: { customer: string | null; factoryPayouts: Record<string, string> };
    settingVersionIds: Record<string, string>;
    calculatorVersion: string;
  };
  /** The analytics row of this calculation (null when it could not be written); internal only. */
  calculateLog?: { id: bigint; occurredAt: Date } | null;
}

export interface FactoryQuoteView {
  calculatorVersion: string;
  priceListVersionId: string | null;
  options: {
    printTypeId: string;
    error: string | null;
    steps: {
      quantity: number;
      productionRun: number | null;
      buyPrice: string | null;
      leadTimeDays: number | null;
      parts: {
        partKey: string;
        totalCost: string;
        buyPrice: string;
        layoutAmount: number;
        sheets: number;
        layoutStandard: boolean;
      }[];
    }[];
  }[];
}

/** One destination of a checkout (B3.1): customer price and Packio's cost of delivering it. */
export type DestinationShipping =
  | {
      available: true;
      /** Customer shipping, VAT-exclusive (D-013). */
      net: MoneyValue;
      /** Packio's cost for the selected factory (fleet payout or carrier quote). */
      cost: MoneyValue;
      method: 'factory_fleet' | 'flash_express' | 'deliveree';
      customerRateVersionId: string | null;
      factoryPayoutVersionId: string | null;
      weightG: number;
      settingVersionIds: Record<string, string>;
    }
  | { available: false; reason: RateMissReason | 'delivery_unavailable' };

/** Keeps the network part only (schema-design §2.11): /24 for IPv4, /48 for IPv6. */
export function ipPrefix(ip: string | undefined): string | null {
  if (!ip) return null;
  const plain = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(plain) === 4) return `${plain.split('.').slice(0, 3).join('.')}.0/24`;
  if (isIP(plain) === 6) {
    const groups = plain.split('::')[0]!.split(':').slice(0, 3);
    return `${groups.join(':')}::/48`;
  }
  return null;
}

@Injectable()
export class QuoteEngineService {
  private readonly logger = new Logger(QuoteEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: FoldingSnapshotLoader,
    private readonly quotePath: QuotePathService,
    private readonly capacity: CapacityService,
    private readonly calendars: BusinessCalendarService,
    private readonly settings: SettingsService,
    private readonly shipping: ShippingQuoteService,
    private readonly events: DomainEvents,
  ) {}

  async priceFolding(cfg: FoldingConfiguration, ctx: QuoteContext): Promise<QuoteView> {
    const started = Date.now();
    const at = ctx.at ?? new Date();
    const db = this.prisma;
    const resolved = await this.loader.resolve(cfg, db);
    const candidates = await this.quotePath.instantCandidates(resolved.productTypeId, at, db);
    const loaded: LoadedOption[] = [];
    for (const c of candidates) {
      loaded.push(
        ...(await this.loader.options(
          { id: c.factoryId, publicId: c.factoryPublicId },
          c.priceListVersionId,
          resolved,
          at,
          db,
        )),
      );
    }
    const result = foldingCalculator.calculate(
      {
        quantities: cfg.quantities,
        parts: resolved.parts,
        design: cfg.design ?? { graphic: false, structure: false },
      },
      { options: loaded.map((l) => l.option) },
    );
    const floorSetting = await this.settings.at('pricing.margin_floor_pct', { at });
    const floor = Number(floorSetting.value);
    const settingVersionIds: Record<string, string> = {
      'pricing.margin_floor_pct': String(floorSetting.versionId),
    };
    const byKey = new Map(loaded.map((l) => [l.option.optionKey, l]));
    const factoryIds = new Map(candidates.map((c) => [c.factoryPublicId, c.factoryId]));
    const vatPct = loaded[0] ? await this.vatPct(loaded[0].vatRateVersionId, db) : null;
    const shipParts = this.shipmentParts(resolved);
    let customerRateVersionId: string | null = null;
    const payoutVersionIds: Record<string, string> = {};

    const steps: QuoteStepView[] = [];
    for (const [index, qty] of cfg.quantities.entries()) {
      const prepared = await this.shipping.prepare(shipParts, qty, ctx.deliveryPostcode ?? null, at, db);
      Object.assign(settingVersionIds, prepared.settingVersionIds);
      if (prepared.customer.versionId !== null)
        customerRateVersionId = prepared.customer.versionId.toString();
      const shippingPriced = prepared.customer.priced;
      // Effective cost to Collective Group: buy price + delivery cost (fleet payout or carrier), then
      // lead time; an option without a delivery path to the postcode is skipped (fail closed).
      const deliveries = new Map<string, Delivery>();
      const priceable = result.options.filter((o) => o.steps[index]);
      const ranked: {
        optionKey: string;
        factoryId: string;
        step: OptionStep;
        delivery: Delivery | null;
        cost: number;
      }[] = [];
      for (const o of priceable) {
        const step = o.steps[index]!;
        let delivery: Delivery | null = null;
        if (shippingPriced) {
          delivery =
            deliveries.get(o.factoryId) ??
            (await this.shipping.delivery(factoryIds.get(o.factoryId)!, prepared, at, db));
          deliveries.set(o.factoryId, delivery);
          if (!delivery.available) continue;
        }
        const cost = step.buyPrice + (delivery?.available ? delivery.cost.toNumber() : 0);
        ranked.push({ optionKey: o.optionKey, factoryId: o.factoryId, step, delivery, cost });
      }
      ranked.sort(
        (a, b) =>
          a.cost - b.cost ||
          a.step.leadTimeDays + extraDays(a.delivery) - (b.step.leadTimeDays + extraDays(b.delivery)),
      );
      let chosen: ((typeof ranked)[number] & { shipDate: string }) | null = null;
      const reason =
        priceable.length === 0
          ? candidates.length === 0
            ? 'no_price_path'
            : 'not_priceable'
          : ranked.length === 0
            ? 'delivery_unavailable'
            : 'capacity_unavailable';
      for (const r of ranked) {
        const shipDate = await this.promise(factoryIds.get(r.factoryId)!, resolved, r.step, at, db);
        if (shipDate) {
          chosen = { ...r, shipDate };
          break;
        }
      }
      if (!chosen) {
        steps.push(this.noPrice(qty, reason));
        continue;
      }
      const option = byKey.get(chosen.optionKey)!;
      const factoryId = factoryIds.get(option.option.factoryId)!;
      const tolerance = await this.tolerance(factoryId, resolved.productTypeId, at, db);
      const s = chosen.step;
      const delivery = chosen.delivery?.available ? chosen.delivery : null;
      const customer = prepared.customer.priced ? prepared.customer : null;
      const shipNet = customer ? customer.net : null;
      const shipVat = shipNet && vatPct ? ShippingQuoteService.vat(shipNet, vatPct) : null;
      const shipGross = shipNet && shipVat ? shipNet.add(shipVat) : null;
      if (delivery?.factoryPayoutVersionId) {
        payoutVersionIds[option.option.factoryId] = delivery.factoryPayoutVersionId.toString();
      }
      steps.push({
        quantity: qty,
        instant: true,
        reason: null,
        unitPrice: formatMoney(s.perPcsWithDelivery),
        productAmount: formatMoney(s.sum),
        designFeeAmount: formatMoney(s.designFee),
        structureDesignFeeAmount: formatMoney(s.structureDesignFee),
        shippingAmount: shipGross ? formatMoney(shipGross) : null,
        shippingNetAmount: shipNet ? formatMoney(shipNet) : null,
        shippingVatAmount: shipVat ? formatMoney(shipVat) : null,
        vatAmount: formatMoney(new MoneyDecimal(formatMoney(s.vatPrice)).add(shipVat ?? 0)),
        grossAmount: formatMoney(new MoneyDecimal(formatMoney(s.total)).add(shipGross ?? 0)),
        leadTimeDays: s.leadTimeDays,
        earliestShipDate: chosen.shipDate,
        earliestDeliveryDate:
          delivery && delivery.extraDays !== null
            ? await this.addWorkingDays(factoryId, chosen.shipDate, delivery.extraDays, db)
            : null,
        toleranceShortagePct: tolerance.shortage,
        toleranceOveragePct: tolerance.overage,
        shippingPending: !shipGross,
        shippingPendingReason: shipGross
          ? null
          : (ShippingQuoteService.missReason(prepared.customer) ?? 'no_rate_card'),
        internal: {
          factoryId: option.option.factoryId,
          printTypeId: option.printTypePublicId,
          priceListVersionId: option.priceListVersionPublicId,
          buyPrice: formatMoney(s.buyPrice),
          marginPct: s.marginPct.toFixed(4),
          belowMarginFloor: s.marginPct < floor,
          productionRun: s.boxAmount,
          parts: s.parts.map((p) => ({
            partKey: p.partKey,
            buyPrice: formatMoney(p.buyPrice),
            layoutAmount: p.layout.layout.layoutAmount,
            sheets: p.layout.waste.totalSheets,
            layoutStandard: p.layout.layout.layoutStandard,
          })),
          shipping:
            delivery && customer && shipNet
              ? {
                  method: delivery.method,
                  costAmount: formatMoney(delivery.cost),
                  marginAmount: formatMoney(shipNet.sub(delivery.cost)),
                  weightG: prepared.pack.weightG,
                  cartons: prepared.pack.cartons,
                  volumeCm3: prepared.pack.volumeCm3,
                  pallets: prepared.pack.pallets,
                  zoneCode: customer.zoneCode,
                  customerRateVersionId: customer.versionPublicId,
                  factoryPayoutVersionId: delivery.factoryPayoutVersionPublicId,
                }
              : null,
        },
      });
    }

    const view: QuoteView = {
      calculatorVersion: FOLDING_CALCULATOR_VERSION,
      steps,
      options: result.options.map((o) => ({
        optionKey: o.optionKey,
        error: o.error ? `${o.error.code}: ${o.error.detail}` : null,
      })),
      configRefs: {
        priceListVersionIds: Object.fromEntries(
          loaded.map((l) => [l.option.factoryId, l.priceListVersionId.toString()]),
        ),
        sellMarginVersionIds: [...new Set(loaded.flatMap((l) => l.sellMarginVersionIds.map(String)))],
        vatRateVersionId: loaded[0]?.vatRateVersionId.toString() ?? null,
        shippingRateCardVersionIds: { customer: customerRateVersionId, factoryPayouts: payoutVersionIds },
        settingVersionIds,
        calculatorVersion: FOLDING_CALCULATOR_VERSION,
      },
    };
    view.calculateLog = await this.log(cfg, resolved, view, ctx, at, Date.now() - started);
    return view;
  }

  /**
   * The buy side of a configuration at one factory, on its own price list in force (D-044: a factory
   * sees only its own prices, never Packio's sell side or another factory).
   */
  async priceFoldingForFactory(
    cfg: FoldingConfiguration,
    factory: { id: bigint; publicId: string },
    at = new Date(),
  ): Promise<FactoryQuoteView> {
    const db = this.prisma;
    const resolved = await this.loader.resolve(cfg, db);
    const version = await db.priceListVersion.findFirst({
      where: {
        status: 'approved',
        effectiveFrom: { lte: at },
        priceList: { factoryId: factory.id, productTypeId: resolved.productTypeId },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
    if (!version)
      return { calculatorVersion: FOLDING_CALCULATOR_VERSION, priceListVersionId: null, options: [] };
    const loaded = await this.loader.options(factory, version.id, resolved, at, db);
    const result = foldingCalculator.calculate(
      { quantities: cfg.quantities, parts: resolved.parts, design: { graphic: false, structure: false } },
      { options: loaded.map((l) => l.option) },
    );
    return {
      calculatorVersion: FOLDING_CALCULATOR_VERSION,
      priceListVersionId: version.publicId,
      options: result.options.map((o, i) => ({
        printTypeId: loaded[i]!.printTypePublicId,
        error: o.error ? `${o.error.code}: ${o.error.detail}` : null,
        steps: o.steps.map((s, q) =>
          s
            ? {
                quantity: s.qty,
                productionRun: s.boxAmount,
                buyPrice: formatMoney(s.buyPrice),
                leadTimeDays: s.leadTimeDays,
                parts: s.parts.map((p) => ({
                  partKey: p.partKey,
                  totalCost: formatMoney(p.layout.totalCost),
                  buyPrice: formatMoney(p.buyPrice),
                  layoutAmount: p.layout.layout.layoutAmount,
                  sheets: p.layout.waste.totalSheets,
                  layoutStandard: p.layout.layout.layoutStandard,
                })),
              }
            : {
                quantity: cfg.quantities[q]!,
                productionRun: null,
                buyPrice: null,
                leadTimeDays: null,
                parts: [],
              },
        ),
      })),
    };
  }

  private noPrice(quantity: number, reason: string): QuoteStepView {
    return {
      quantity,
      instant: false,
      reason,
      unitPrice: null,
      productAmount: null,
      designFeeAmount: null,
      structureDesignFeeAmount: null,
      shippingAmount: null,
      shippingNetAmount: null,
      shippingVatAmount: null,
      vatAmount: null,
      grossAmount: null,
      leadTimeDays: null,
      earliestShipDate: null,
      earliestDeliveryDate: null,
      toleranceShortagePct: null,
      toleranceOveragePct: null,
      shippingPending: false,
      shippingPendingReason: null,
      internal: null,
    };
  }

  /**
   * The earliest ship date the factory can promise (D-101): the first week with room for the run, then
   * the lead time in the factory's working days. Null when capacity is not configured or full.
   */
  private async promise(
    factoryId: bigint,
    resolved: ResolvedFolding,
    step: OptionStep,
    at: Date,
    db: Tx,
  ): Promise<string | null> {
    const unit = await db.factoryCapacityVersion.findFirst({
      where: {
        capacity: { factoryId, productTypeId: resolved.productTypeId },
        status: 'approved',
        effectiveFrom: { lte: at },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    });
    if (!unit) return null;
    const load =
      unit.capacityUnit === 'pieces'
        ? step.boxAmount
        : unit.capacityUnit === 'sheets'
          ? step.parts.reduce((a, p) => a + p.layout.waste.totalSheets, 0)
          : unit.capacityUnit === 'sqm'
            ? step.parts.reduce(
                (a, p) => a + (p.layout.layout.dw * p.layout.layout.dl * step.boxAmount) / 1000000,
                0,
              )
            : 1;
    const availability = await this.capacity.nextAvailable(
      factoryId,
      resolved.productTypeId,
      load.toFixed(3),
      at,
      db,
    );
    if (!availability.available) return null;
    const factory = await db.factory.findUniqueOrThrow({
      where: { id: factoryId },
      include: { calendar: true },
    });
    const calendar = await this.calendars.calendar(factory.calendar?.code);
    const start = new Date(`${availability.earliestDate}T00:00:00+07:00`);
    return bangkokDate(calendar.addWorkingDays(start, step.leadTimeDays));
  }

  /**
   * Shipping of a saved folding configuration split over destinations (checkout, B3.1): each leg is
   * packed for its own quantity and priced on the customer rate card for its postcode (VAT-exclusive,
   * D-013), and costed for the factory the quotation selected (its fleet payout or a fallback carrier).
   * A leg without a customer price or without a delivery path for that factory is not available.
   */
  async destinationShipping(
    cfg: FoldingConfiguration,
    factoryId: bigint,
    legs: readonly { postcode: string; quantity: number }[],
    at: Date,
    db: Tx = this.prisma,
  ): Promise<DestinationShipping[]> {
    const resolved = await this.loader.resolve(cfg, db);
    const parts = this.shipmentParts(resolved);
    const out: DestinationShipping[] = [];
    for (const leg of legs) {
      const prepared = await this.shipping.prepare(parts, leg.quantity, leg.postcode, at, db);
      if (!prepared.customer.priced) {
        out.push({
          available: false,
          reason: ShippingQuoteService.missReason(prepared.customer) ?? 'no_rate_card',
        });
        continue;
      }
      const delivery = await this.shipping.delivery(factoryId, prepared, at, db);
      if (!delivery.available) {
        out.push({ available: false, reason: 'delivery_unavailable' });
        continue;
      }
      out.push({
        available: true,
        net: prepared.customer.net,
        cost: delivery.cost,
        method: delivery.method,
        customerRateVersionId: prepared.customer.versionId?.toString() ?? null,
        factoryPayoutVersionId: delivery.factoryPayoutVersionId?.toString() ?? null,
        weightG: prepared.pack.weightG,
        settingVersionIds: prepared.settingVersionIds,
      });
    }
    return out;
  }

  private shipmentParts(resolved: ResolvedFolding): ShipmentPart[] {
    return resolved.parts.map((p) => {
      const blank = p.pattern.standardBlanks?.find(
        (b) => b.wMm === p.geometry.w && b.lMm === p.geometry.l && b.dMm === p.geometry.d,
      );
      return {
        formula: p.pattern.formula,
        w: p.geometry.w,
        l: p.geometry.l,
        d: p.geometry.d,
        gsm: resolved.materialGsm,
        standardBlank: blank ? { dw: blank.dwMm, dl: blank.dlMm } : null,
      };
    });
  }

  private async vatPct(versionId: bigint, db: Tx): Promise<MoneyValue> {
    const version = await db.taxRateVersion.findUniqueOrThrow({ where: { id: versionId } });
    return new MoneyDecimal(version.ratePct.toString());
  }

  private async addWorkingDays(factoryId: bigint, date: string, days: number, db: Tx): Promise<string> {
    const factory = await db.factory.findUniqueOrThrow({
      where: { id: factoryId },
      include: { calendar: true },
    });
    const calendar = await this.calendars.calendar(factory.calendar?.code);
    return bangkokDate(calendar.addWorkingDays(new Date(`${date}T00:00:00+07:00`), days));
  }

  /** The factory's tolerance for the type, else its default, else the platform default (D-021, D-163). */
  private async tolerance(
    factoryId: bigint,
    productTypeId: bigint,
    at: Date,
    db: Tx,
  ): Promise<{ shortage: string; overage: string }> {
    const inForce = { status: 'approved' as const, effectiveFrom: { lte: at } };
    const latest = [{ effectiveFrom: 'desc' as const }, { versionNo: 'desc' as const }];
    for (const scope of [productTypeId, null]) {
      const version = await db.factoryTolerancePolicyVersion.findFirst({
        where: { ...inForce, policy: { factoryId, productTypeId: scope } },
        orderBy: latest,
      });
      if (version)
        return { shortage: version.shortagePct.toFixed(4), overage: version.overagePct.toFixed(4) };
    }
    const fallback = (await this.settings.at('fulfilment.tolerance_default_pct', { at })).value;
    const pct = Number(fallback).toFixed(4);
    return { shortage: pct, overage: pct };
  }

  /** One `calculate_logs` row per calculation (B6 analytics, D-102 unmet demand); no PII. */
  private async log(
    cfg: FoldingConfiguration,
    resolved: ResolvedFolding,
    view: QuoteView,
    ctx: QuoteContext,
    at: Date,
    durationMs: number,
  ): Promise<{ id: bigint; occurredAt: Date } | null> {
    const instant = view.steps.some((s) => s.instant);
    try {
      const row = await this.prisma.calculateLog.create({
        data: {
          occurredAt: at,
          channel: ctx.channel,
          productTypeId: resolved.productTypeId,
          catalogProductId: resolved.catalogProductId,
          actorUserId: ctx.actorUserId ?? null,
          anonymousId: ctx.anonymousId ?? null,
          quantities: [...cfg.quantities],
          lengthMm: cfg.l,
          widthMm: cfg.w,
          heightMm: cfg.d,
          deliveryPostcode: ctx.deliveryPostcode ?? null,
          input: JSON.parse(JSON.stringify(cfg)) as Prisma.InputJsonValue,
          inputSchemaVersion: 1,
          resultSummary: view.steps.map((s) => ({
            quantity: s.quantity,
            instant: s.instant,
            reason: s.reason,
            grossAmount: s.grossAmount,
            shippingAmount: s.shippingAmount,
          })),
          calculatorVersion: view.calculatorVersion,
          instantPath: instant,
          routedToRfq: !instant,
          durationMs,
          ipPrefix: ipPrefix(ctx.ip),
        },
        select: { id: true, occurredAt: true },
      });
      // Analytics and unmet demand (D-102) subscribe; banded, no PII.
      const type = await this.prisma.productType.findUniqueOrThrow({
        where: { id: resolved.productTypeId },
        select: { publicId: true },
      });
      await this.prisma.withTx((tx) =>
        this.events.record(tx, {
          type: 'quote.calculated',
          aggregateType: 'product_type',
          aggregateId: type.publicId,
          payload: {
            calculateLogId: row.id.toString(),
            occurredAt: row.occurredAt.toISOString(),
            channel: ctx.channel,
            productTypeId: resolved.productTypeId.toString(),
            quantities: [...cfg.quantities],
            instant,
            reasons: [...new Set(view.steps.map((s) => s.reason).filter((r): r is string => r !== null))],
            deliveryPostcode: ctx.deliveryPostcode ?? null,
            dimensionsMm: { w: cfg.w, l: cfg.l, d: cfg.d },
          },
        }),
      );
      return row;
    } catch (error) {
      // Analytics must never fail a quote.
      this.logger.warn({ err: error }, 'calculate log not written');
      return null;
    }
  }
}

const extraDays = (delivery: Delivery | null): number =>
  delivery?.available ? (delivery.extraDays ?? 0) : 0;
