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

import { QuoteEngineService } from '../quotes/quote-engine.service';
import { StorePricingService } from '../quotes/store-pricing.service';
import { defaultSpecConfiguration, defaultSpecQuantity } from './default-spec';
import { type PriceHintDto, type PriceHintQuery } from './price-hints.dto';

/** Every calculator a hint can be priced with (D-220). */
const HINTED = new Set(['folding', 'corrugate', 'label', 'tag_sleeve', 'pouch', 'service']);

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: QuoteEngineService,
    private readonly storePricing: StorePricingService,
  ) {}

  /** Recomputes the hints of one product or of all products that have (or had) one. */
  async refresh(catalogProductId?: bigint): Promise<{ priced: number; cleared: number }> {
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

  /** The public read: one entry per requested product (stock products have no hint until their calculator ships). */
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
          select: { sku: true, productType: { select: { code: true } } },
          orderBy: { sku: 'asc' },
        })
      : [];
    return [
      ...products.map((p): PriceHintDto => {
        const h = p.priceHint;
        return {
          key: p.slug,
          kind: 'catalog_product',
          productTypeCode: p.productType.code,
          startingFromPerPiece: h ? ceilMoney(h.unitPrice.toString()) : null,
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
      // Stock products: the standard-product calculator prices them (U-B6), but the published "starting from" figure
      // waits for the summary's delivery basis (`stock_product_price_summaries`, PROGRESS U-B6 standard product).
      ...stock.map((s): PriceHintDto => ({
        key: s.sku,
        kind: 'stock_product',
        productTypeCode: s.productType.code,
        startingFromPerPiece: null,
        currency: 'THB',
        basis: null,
        leadTimeBusinessDays: null,
        computedAt: null,
      })),
    ];
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
