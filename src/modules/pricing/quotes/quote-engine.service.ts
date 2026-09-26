import { isIP } from 'node:net';

import { formatMoney } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { PrismaService, type Tx } from '@database/prisma.service';
import { type Prisma, type SalesChannel } from '@generated/prisma/client';
import { CapacityService } from '@modules/partners/capacity/capacity.service';
import { QuotePathService } from '@modules/partners/quote-path/quote-path.service';
import { Injectable, Logger } from '@nestjs/common';
import { BusinessCalendarService } from '@platform/calendar/business-calendar.service';
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
 * capacity on the promise (D-101), the selected factory's tolerance (D-021), the margin floor (D-012) —
 * and the calculate log (B6). Customers never see the factory (D-050): the staff-only part of the
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
  shippingAmount: string | null;
  vatAmount: string | null;
  grossAmount: string | null;
  leadTimeDays: number | null;
  earliestShipDate: string | null;
  toleranceShortagePct: string | null;
  toleranceOveragePct: string | null;
  shippingPending: boolean;
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
    calculatorVersion: string;
  };
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
    const floor = Number((await this.settings.at('pricing.margin_floor_pct', { at })).value);
    const byKey = new Map(loaded.map((l) => [l.option.optionKey, l]));
    const factoryIds = new Map(candidates.map((c) => [c.factoryPublicId, c.factoryId]));

    const steps: QuoteStepView[] = [];
    for (const [index, qty] of cfg.quantities.entries()) {
      // Cheapest buy price first, then lead time; skip an option whose capacity cannot hold the run.
      const ranked = result.options
        .filter((o) => o.steps[index])
        .sort(
          (a, b) =>
            a.steps[index]!.buyPrice - b.steps[index]!.buyPrice ||
            a.steps[index]!.leadTimeDays - b.steps[index]!.leadTimeDays,
        );
      let chosen: { key: string; step: OptionStep; shipDate: string } | null = null;
      const reason =
        ranked.length === 0
          ? candidates.length === 0
            ? 'no_price_path'
            : 'not_priceable'
          : 'capacity_unavailable';
      for (const o of ranked) {
        const step = o.steps[index]!;
        const shipDate = await this.promise(factoryIds.get(o.factoryId)!, resolved, step, at, db);
        if (shipDate) {
          chosen = { key: o.optionKey, step, shipDate };
          break;
        }
      }
      if (!chosen) {
        steps.push(this.noPrice(qty, reason));
        continue;
      }
      const option = byKey.get(chosen.key)!;
      const tolerance = await this.tolerance(
        factoryIds.get(option.option.factoryId)!,
        resolved.productTypeId,
        at,
        db,
      );
      const s = chosen.step;
      steps.push({
        quantity: qty,
        instant: true,
        reason: null,
        unitPrice: formatMoney(s.perPcsWithDelivery),
        productAmount: formatMoney(s.sum),
        designFeeAmount: formatMoney(s.designFee),
        structureDesignFeeAmount: formatMoney(s.structureDesignFee),
        shippingAmount: formatMoney(s.deliveryPrice),
        vatAmount: formatMoney(s.vatPrice),
        grossAmount: formatMoney(s.total),
        leadTimeDays: s.leadTimeDays,
        earliestShipDate: chosen.shipDate,
        toleranceShortagePct: tolerance.shortage,
        toleranceOveragePct: tolerance.overage,
        shippingPending: !s.shippingPriced,
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
        calculatorVersion: FOLDING_CALCULATOR_VERSION,
      },
    };
    await this.log(cfg, resolved, view, ctx, at, Date.now() - started);
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
      vatAmount: null,
      grossAmount: null,
      leadTimeDays: null,
      earliestShipDate: null,
      toleranceShortagePct: null,
      toleranceOveragePct: null,
      shippingPending: false,
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
  ): Promise<void> {
    const instant = view.steps.some((s) => s.instant);
    try {
      await this.prisma.calculateLog.create({
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
          })),
          calculatorVersion: view.calculatorVersion,
          instantPath: instant,
          routedToRfq: !instant,
          durationMs,
          ipPrefix: ipPrefix(ctx.ip),
        },
      });
    } catch (error) {
      // Analytics must never fail a quote.
      this.logger.warn({ err: error }, 'calculate log not written');
    }
  }
}
