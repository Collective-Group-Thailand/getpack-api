import { DomainException } from '@common/errors/domain.exception';
import { MoneyDecimal } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import { type SpecLineDto } from '@modules/quotes/line-summary.dto';
import { specLabel } from '@modules/quotes/spec-label';
import { Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { MAX_QUANTITY_TIERS } from '../quotes/quote.dto';
import { QuoteEngineService } from '../quotes/quote-engine.service';
import { StorePricingService } from '../quotes/store-pricing.service';
import { defaultSpecConfiguration, defaultSpecQuantity } from './default-spec';
import { type PriceHintDto, type PriceHintQuery, type PriceTiersDto } from './price-hints.dto';
import { exVatFigure, vatStandardPct } from './vat-figures';

/** Every calculator a hint can be priced with (D-220). */
const HINTED = new Set(['folding', 'corrugate', 'label', 'tag_sleeve', 'pouch', 'service']);
/** C1b: the calculator stock products are priced with (U-B6 standard product). */
const STOCK_CALCULATOR = 'standard_product';

/**
 * Settings whose change moves a store price (C0): the print limits the default spec is priced under (print config,
 * ADR-0005), the margin floor of the store rules and the VAT rounding mode. A version dated in the future is picked
 * up by the hourly refresh once it is in force.
 */
export const PRICE_SETTING_KEYS: ReadonlySet<string> = new Set([
  'catalog.print_limits',
  'pricing.margin_floor_pct',
  'tax.rounding_mode',
]);

/** C1-API-2: how long a product's tier table is reused (the response is also `Cache-Control: max-age=60`). */
export const TIERS_TTL_MS = 60_000;
/** Never more tier tables kept in memory than this (the catalogue holds a few hundred products at most). */
const TIERS_CACHE_MAX = 500;

/**
 * The quantities of the tier table (C1-API-2): the configurator's presets, ascending and distinct, at most
 * `MAX_QUANTITY_TIERS`; the reference quantity alone when the product has no presets.
 */
export function tierQuantities(
  presets: readonly number[] | null | undefined,
  reference: number | null,
): number[] {
  const list = [...new Set((presets ?? []).filter((q) => Number.isInteger(q) && q > 0))].sort(
    (a, b) => a - b,
  );
  if (list.length) return list.slice(0, MAX_QUANTITY_TIERS);
  return reference !== null ? [reference] : [];
}

/** Up to the next satang: a "starting from" figure never undercuts the price a quote gives (D-181). */
const ceilMoney = (value: string) =>
  new MoneyDecimal(value).toDecimalPlaces(2, MoneyDecimal.ROUND_CEIL).toFixed(2);

/**
 * "Starting from" prices (D-220, D-181, D-441): each catalogue product's default spec — its admin-maintained
 * reference configuration, the very spec the configurator opens on — priced through the one store pricing path
 * (`StorePricingService`: store validation and rules, the quote engine, the spec-line helper; cheapest instant path,
 * D-043; no factory identity, D-050) at the reference quantity, cached in `catalog_price_hints`. A product without
 * a reference configuration, not instant, or with no factory able to price it has no hint — the card shows the RFQ
 * route, never an estimate.
 */
@Injectable()
export class PriceHintsService {
  private readonly logger = new Logger(PriceHintsService.name);
  private readonly tierCache = new Map<string, { until: number; value: PriceTiersDto }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: QuoteEngineService,
    private readonly storePricing: StorePricingService,
  ) {}

  /**
   * Recomputes the hints of one product or of all products that have (or had) one — and, for a full refresh, every
   * stock product's too (C1b).
   */
  async refresh(catalogProductId?: bigint): Promise<{ priced: number; cleared: number }> {
    const catalogue = await this.refreshCatalogue(catalogProductId);
    if (catalogProductId !== undefined) return catalogue;
    const stock = await this.refreshStock();
    return { priced: catalogue.priced + stock.priced, cleared: catalogue.cleared + stock.cleared };
  }

  private async refreshCatalogue(catalogProductId?: bigint): Promise<{ priced: number; cleared: number }> {
    const products = await this.prisma.catalogProduct.findMany({
      where: {
        ...(catalogProductId !== undefined ? { id: catalogProductId } : {}),
        OR: [{ referenceConfiguration: { not: { equals: null } } }, { priceHint: { isNot: null } }],
      },
      select: {
        id: true,
        publicId: true,
        status: true,
        referenceConfiguration: true,
        productType: { select: { status: true, quoteMode: true, calculatorKey: true } },
      },
    });
    let priced = 0;
    let cleared = 0;
    for (const p of products) {
      const hint = await this.price(p).catch((error: unknown) => {
        this.logger.warn({ err: error, catalogProductId: p.publicId }, 'price hint not computed');
        return null;
      });
      if (hint) {
        await this.prisma.catalogPriceHint.upsert({
          where: { catalogProductId: p.id },
          create: { catalogProductId: p.id, ...hint },
          update: hint,
        });
        priced += 1;
      } else {
        cleared += (await this.prisma.catalogPriceHint.deleteMany({ where: { catalogProductId: p.id } }))
          .count;
      }
    }
    return { priced, cleared };
  }

  private async price(p: {
    publicId: string;
    status: string;
    referenceConfiguration: Prisma.JsonValue;
    productType: { status: string; quoteMode: string; calculatorKey: string | null };
  }): Promise<Omit<Prisma.CatalogPriceHintUncheckedCreateInput, 'catalogProductId'> | null> {
    const key = p.productType.calculatorKey;
    const cfg = p.referenceConfiguration as Record<string, unknown> | null;
    if (
      !cfg ||
      p.status !== 'active' ||
      p.productType.status !== 'active' ||
      p.productType.quoteMode !== 'instant' ||
      !key ||
      !HINTED.has(key) ||
      !this.engine.hasCalculator(key as never)
    ) {
      return null;
    }
    const at = new Date();
    const configuration = defaultSpecConfiguration(cfg, p.publicId)!;
    const quantity = defaultSpecQuantity(configuration);
    // D-441: the configurator's own path, so the card, the product page and the configurator agree to the satang.
    const { view, calculation } = await this.storePricing.price(key as never, configuration, {
      at,
      log: false,
    });
    const step = view.steps.find((s) => s.quantity === quantity && s.instant && s.unitPrice !== null);
    if (!step) return null;
    const specSummary = calculation.specs;
    return {
      quantity: step.quantity,
      unitPrice: step.unitPrice!,
      leadTimeDays: step.leadTimeDays,
      specSummary: specSummary as unknown as Prisma.InputJsonValue,
      calculatorVersion: view.calculatorVersion,
      computedAt: at,
    };
  }

  /**
   * C1b (owner 2026-10-28, DECISIONS-STAGE-A §10.5): each active stock product's "starting from" price — its unit
   * price at its minimum orderable quantity (the first price tier, never the cheapest high-volume tier), priced through
   * the one store pricing path (`StorePricingService`, the price the cart gives for that quantity), cached in
   * `stock_price_hints`. Not instant, not priceable or inactive → no row (the card shows no price, never an estimate).
   */
  async refreshStock(stockProductId?: bigint): Promise<{ priced: number; cleared: number }> {
    const products = await this.prisma.stockProduct.findMany({
      where: {
        ...(stockProductId !== undefined
          ? { id: stockProductId }
          : { OR: [{ status: 'active' }, { priceHint: { isNot: null } }] }),
      },
      select: {
        id: true,
        publicId: true,
        status: true,
        minOrderQty: true,
        productType: { select: { status: true, quoteMode: true, calculatorKey: true } },
      },
    });
    let priced = 0;
    let cleared = 0;
    for (const p of products) {
      const hint = await this.priceStock(p).catch((error: unknown) => {
        this.logger.warn({ err: error, stockProductId: p.publicId }, 'stock price hint not computed');
        return null;
      });
      if (hint) {
        await this.prisma.stockPriceHint.upsert({
          where: { stockProductId: p.id },
          create: { stockProductId: p.id, ...hint },
          update: hint,
        });
        priced += 1;
      } else {
        cleared += (await this.prisma.stockPriceHint.deleteMany({ where: { stockProductId: p.id } })).count;
      }
    }
    return { priced, cleared };
  }

  private async priceStock(p: {
    publicId: string;
    status: string;
    minOrderQty: number;
    productType: { status: string; quoteMode: string; calculatorKey: string | null };
  }): Promise<Omit<Prisma.StockPriceHintUncheckedCreateInput, 'stockProductId'> | null> {
    if (
      p.status !== 'active' ||
      p.productType.status !== 'active' ||
      p.productType.quoteMode !== 'instant' ||
      p.productType.calculatorKey !== STOCK_CALCULATOR ||
      !this.engine.hasCalculator(STOCK_CALCULATOR)
    )
      return null;
    const at = new Date();
    const quantity = Math.max(1, p.minOrderQty);
    const { view } = await this.storePricing.price(
      STOCK_CALCULATOR,
      { stockProductId: p.publicId, quantities: [quantity] },
      { at, log: false },
    );
    const step = view.steps.find((s) => s.quantity === quantity && s.instant && s.unitPrice !== null);
    if (!step) return null;
    return {
      quantity,
      unitPrice: step.unitPrice!,
      leadTimeDays: step.leadTimeDays,
      calculatorVersion: view.calculatorVersion,
      computedAt: at,
    };
  }

  /** The public read: one entry per requested product (catalogue and stock, C1b). */
  async list(query: PriceHintQuery): Promise<PriceHintDto[]> {
    const slugs = query.slugs ?? [];
    const skus = query.skus ?? [];
    const products = await this.prisma.catalogProduct.findMany({
      where: {
        status: 'active',
        productType: { status: 'active', ...(query.productType ? { code: query.productType } : {}) },
        ...(slugs.length ? { slug: { in: slugs } } : {}),
      },
      select: {
        slug: true,
        productType: { select: { code: true, calculatorKey: true } },
        priceHint: true,
      },
      orderBy: { slug: 'asc' },
      take: 200,
    });
    const stock = skus.length
      ? await this.prisma.stockProduct.findMany({
          where: { sku: { in: skus }, status: 'active', productType: { status: 'active' } },
          select: { sku: true, productType: { select: { code: true } }, priceHint: true },
          orderBy: { sku: 'asc' },
        })
      : [];
    const ratePct = await vatStandardPct(this.prisma);
    return [
      ...products.map((p): PriceHintDto => {
        const h = p.priceHint;
        return {
          key: p.slug,
          kind: 'catalog_product',
          productTypeCode: p.productType.code,
          startingFromPerPiece: h ? ceilMoney(h.unitPrice.toString()) : null,
          startingFromPerPieceExVat: h ? exVatFigure(ceilMoney(h.unitPrice.toString()), ratePct) : null,
          currency: 'THB',
          basis: h
            ? {
                quantity: h.quantity,
                sizeCode: null,
                includesVat: true,
                includesDelivery: false,
                specs: h.specSummary as unknown as SpecLineDto[],
                label: specLabel(h.specSummary as unknown as SpecLineDto[], p.productType.calculatorKey),
              }
            : null,
          leadTimeBusinessDays:
            h && h.leadTimeDays !== null ? { min: h.leadTimeDays, max: h.leadTimeDays } : null,
          computedAt: h ? toBangkokIso(h.computedAt) : null,
        };
      }),
      // Stock products (C1b, §10.5): the unit price at the minimum orderable quantity, labelled with that quantity.
      ...stock.map((s): PriceHintDto => {
        const h = s.priceHint;
        const price = h ? ceilMoney(h.unitPrice.toString()) : null;
        return {
          key: s.sku,
          kind: 'stock_product',
          productTypeCode: s.productType.code,
          startingFromPerPiece: price,
          startingFromPerPieceExVat: exVatFigure(price, ratePct),
          currency: 'THB',
          basis: h
            ? {
                quantity: h.quantity,
                sizeCode: null,
                includesVat: true,
                includesDelivery: false,
                specs: [],
                label: specLabel([], STOCK_CALCULATOR),
              }
            : null,
          leadTimeBusinessDays:
            h && h.leadTimeDays !== null ? { min: h.leadTimeDays, max: h.leadTimeDays } : null,
          computedAt: h ? toBangkokIso(h.computedAt) : null,
        };
      }),
    ];
  }

  /**
   * C1-API-2: the default spec (D-441) priced at every quantity preset through the one store pricing path
   * (`StorePricingService`, GLOBAL-RULES §5) — the numbers `store.quotes.calculate` gives for the same configuration,
   * without a calculate log. Kept for `TIERS_TTL_MS`; a product without an instant default spec has no tiers.
   */
  async tiers(slug: string): Promise<PriceTiersDto> {
    const now = Date.now();
    const hit = this.tierCache.get(slug);
    if (hit && hit.until > now) return hit.value;
    const p = await this.prisma.catalogProduct.findFirst({
      where: { slug, status: 'active', productType: { status: 'active' } },
      select: {
        publicId: true,
        status: true,
        referenceConfiguration: true,
        quantityPresets: true,
        productType: { select: { code: true, status: true, quoteMode: true, calculatorKey: true } },
      },
    });
    if (!p) throw new DomainException('http.not_found');
    const value = await this.priceTiers(slug, p);
    if (this.tierCache.size >= TIERS_CACHE_MAX) this.tierCache.clear();
    this.tierCache.set(slug, { until: now + TIERS_TTL_MS, value });
    return value;
  }

  private async priceTiers(
    slug: string,
    p: {
      publicId: string;
      referenceConfiguration: Prisma.JsonValue;
      quantityPresets: number[];
      productType: { code: string; quoteMode: string; calculatorKey: string | null };
    },
  ): Promise<PriceTiersDto> {
    const empty: PriceTiersDto = {
      key: slug,
      productTypeCode: p.productType.code,
      currency: 'THB',
      basis: null,
      tiers: [],
      computedAt: null,
    };
    const key = p.productType.calculatorKey;
    const configuration = defaultSpecConfiguration(p.referenceConfiguration, p.publicId);
    if (
      !configuration ||
      p.productType.quoteMode !== 'instant' ||
      !key ||
      !HINTED.has(key) ||
      !this.engine.hasCalculator(key as never)
    )
      return empty;
    const reference = defaultSpecQuantity(configuration);
    const quantities = tierQuantities(p.quantityPresets, reference);
    if (!quantities.length) return empty;
    const at = new Date();
    try {
      const { calculation } = await this.storePricing.price(
        key as never,
        { ...configuration, quantities },
        { at, log: false },
      );
      return {
        ...empty,
        basis: {
          quantity: reference ?? quantities[0]!,
          sizeCode: null,
          includesVat: true,
          includesDelivery: false,
          specs: calculation.specs,
          label: calculation.specLabel,
        },
        tiers: calculation.steps,
        computedAt: toBangkokIso(at),
      };
    } catch (error) {
      this.logger.warn({ err: error, slug }, 'price tiers not computed');
      return empty;
    }
  }

  /** Effective-dated price lists and capacity change with time: refresh hourly. */
  @ScheduledJob({ name: 'pricing.price_hints_refresh', every: 3_600_000 })
  async refreshAll(): Promise<number> {
    return (await this.refresh()).priced;
  }

  /** Anything that moves a store price moves the hint with it (D-441): price lists, sell margins, VAT, quote mode. */
  @OnDomainEvent(
    [
      'price_list.version_approved',
      'sell_margin_table.version_approved',
      'tax_rate.version_approved',
      'product_type.quote_mode_changed',
    ],
    {
      consumer: 'pricing.price_hints',
    },
  )
  async onPricesChanged(): Promise<void> {
    await this.refresh();
  }

  /**
   * Print config and product-type changes (C0): a product type's calculator / options, or a catalogue import (inks,
   * finishes, materials) can change what the default spec costs, so every hint is recomputed.
   */
  @OnDomainEvent(['catalog.product_type.updated', 'catalog.import_applied'], {
    consumer: 'pricing.price_hints.config',
  })
  async onConfigChanged(): Promise<void> {
    await this.refresh();
  }

  /** A price-moving setting (`PRICE_SETTING_KEYS`) changed or its approved version landed. */
  @OnDomainEvent(['setting.changed'], { consumer: 'pricing.price_hints.settings' })
  async onSettingChanged(event: DomainEventEnvelope): Promise<void> {
    const key = event.payload['key'];
    if (typeof key === 'string' && PRICE_SETTING_KEYS.has(key)) await this.refresh();
  }

  /** C1b: a stock product's MOQ, status or type changed — its "starting from" price follows. */
  @OnDomainEvent(['catalog.stock_product.updated'], {
    consumer: 'pricing.price_hints.stock_product',
  })
  async onStockProductChanged(event: DomainEventEnvelope): Promise<void> {
    const row = await this.prisma.stockProduct.findUnique({
      where: { publicId: event.aggregateId },
      select: { id: true },
    });
    if (row) await this.refreshStock(row.id);
  }

  @OnDomainEvent(['catalog.catalog_product.updated', 'catalog.catalog_product.created'], {
    consumer: 'pricing.price_hints.product',
  })
  async onProductChanged(event: DomainEventEnvelope): Promise<void> {
    const row = await this.prisma.catalogProduct.findUnique({
      where: { publicId: event.aggregateId },
      select: { id: true },
    });
    if (row) await this.refresh(row.id);
  }
}
