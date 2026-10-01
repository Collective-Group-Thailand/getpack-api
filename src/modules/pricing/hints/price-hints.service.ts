import { MoneyDecimal } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';
import {
  type BoxConfiguration,
  boxSpecLines,
  type LabelSpecConfiguration,
  labelSpecLines,
  type PouchSpecConfiguration,
  pouchSpecLines,
  type TagSleeveSpecConfiguration,
  tagSleeveSpecLines,
} from '@modules/quotes/line-summary';
import { type SpecLineDto } from '@modules/quotes/line-summary.dto';
import { Injectable, Logger } from '@nestjs/common';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import { OnDomainEvent } from '@platform/domain-events/on-domain-event.decorator';
import { ScheduledJob } from '@platform/maintenance/scheduled-job.decorator';

import { QuoteEngineService } from '../quotes/quote-engine.service';
import { type PriceHintDto, type PriceHintQuery } from './price-hints.dto';

const BOX = new Set(['folding', 'corrugate']);
/** Every calculator a hint can be priced with (D-220). */
const HINTED = new Set([...BOX, 'label', 'tag_sleeve', 'pouch']);

/** Up to the next satang: a "starting from" figure never undercuts the price a quote gives (D-181). */
const ceilMoney = (value: string) =>
  new MoneyDecimal(value).toDecimalPlaces(2, MoneyDecimal.ROUND_CEIL).toFixed(2);

/**
 * "Starting from" prices (D-220, D-181): each catalogue product's admin-maintained reference configuration,
 * priced by its ported calculator through the quote path (cheapest instant path, D-043; no factory identity,
 * D-050), cached in `catalog_price_hints`. A product without a reference configuration, not instant, or with no
 * factory able to price it has no hint — the card shows the RFQ route, never an estimate.
 */
@Injectable()
export class PriceHintsService {
  private readonly logger = new Logger(PriceHintsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: QuoteEngineService,
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
    const view = await this.engine.price(
      key as never,
      { ...cfg, catalogProductId: p.publicId },
      { channel: 'web', at, log: false },
    );
    const cheapest = view.steps
      .filter((s) => s.instant && s.unitPrice !== null)
      .sort((a, b) => new MoneyDecimal(a.unitPrice!).cmp(new MoneyDecimal(b.unitPrice!)))[0];
    if (!cheapest) return null;
    const specSummary = BOX.has(key)
      ? await boxSpecLines(this.prisma, cfg as unknown as BoxConfiguration)
      : key === 'tag_sleeve'
        ? await tagSleeveSpecLines(this.prisma, cfg as unknown as TagSleeveSpecConfiguration)
        : key === 'pouch'
          ? await pouchSpecLines(this.prisma, cfg as unknown as PouchSpecConfiguration)
          : await labelSpecLines(this.prisma, cfg as unknown as LabelSpecConfiguration);
    return {
      quantity: cheapest.quantity,
      unitPrice: cheapest.unitPrice!,
      leadTimeDays: cheapest.leadTimeDays,
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
        productType: { select: { code: true } },
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

  @OnDomainEvent(['price_list.version_approved', 'product_type.quote_mode_changed'], {
    consumer: 'pricing.price_hints',
  })
  async onPricesChanged(): Promise<void> {
    await this.refresh();
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
