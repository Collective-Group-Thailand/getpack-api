import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { type Promotion } from '@generated/prisma/client';
import { QuotePathService } from '@modules/partners/quote-path/quote-path.service';
import { exVatFigure, vatStandardPct } from '@modules/pricing/hints/vat-figures';
import { type SpecLineDto } from '@modules/quotes/line-summary.dto';
import { type SpecLabel, specLabel } from '@modules/quotes/spec-label';
import { Injectable } from '@nestjs/common';

/** What a starting price assumes: its quantity and the default spec, as lines and as one string (D-441). */
const basis = (h: { quantity: number; specSummary: unknown }, calculatorKey: string | null) => {
  const specs = (Array.isArray(h.specSummary) ? h.specSummary : []) as SpecLineDto[];
  return { quantity: h.quantity, specs, label: specLabel(specs, calculatorKey) };
};

/** Up to the next satang, like the D-220 hint (a starting price never undercuts a quote, D-181). */
const ceilMoney = (value: MoneyValue) => value.toDecimalPlaces(2, MoneyDecimal.ROUND_CEIL).toFixed(2);

export interface CardItem {
  catalogProductId: string | null;
  productTypeId: bigint;
  productTypeCode: string;
  categoryCode: string | null;
}

export interface CampaignBadge {
  label: string;
  endsAt: string;
  promotionId: string;
}

export interface CardFacts {
  startingPricePerPiece: string | null;
  /** C1b §10.6: the same figure without VAT (shared helper, approved rate); null without a price or a rate. */
  startingPricePerPieceExVat: string | null;
  startingPriceAssumes: { quantity: number; specs: SpecLineDto[]; label: SpecLabel } | null;
  moq: number | null;
  leadTimeDays: { min: number; max: number } | null;
  availability: 'instant' | 'partial' | 'rfq';
  campaignBadge: CampaignBadge | null;
  /** D-307: present only with a live promotion lowering the per-piece price of the basis; the hint price. */
  referencePrice?: string;
  cacheTags: string[];
}

interface Conditions {
  channels?: string[];
  segments?: string[];
  productTypeCodes?: string[];
  categoryCodes?: string[];
  catalogProductIds?: string[];
  minQuantity?: number;
  minOrderValue?: string;
  firstOrderOnly?: boolean;
  paymentMethods?: string[];
  zoneCodes?: string[];
}
type Benefit =
  | { type: 'percent'; pct: string; maxAmount?: string }
  | { type: 'unit_price_override'; unitPrice: string }
  | { type: string };

/**
 * The truthful card read model (U-B4, D-181, D-307): starting price per piece and its basis (D-220 hints), MOQ, lead
 * time, availability (D-043, D-234), a campaign badge only from a live automatic promotion with a real end date that
 * targets the item for the web channel, and a reference price only when that promotion lowers the basis's price for
 * everyone. Cache tags for the web's revalidation (D-308).
 */
@Injectable()
export class CardFactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotePath: QuotePathService,
  ) {}

  /** Live automatic promotions for the web channel with a real end date (D-181), most important first. */
  async livePromotions(now = new Date()): Promise<Promotion[]> {
    const rows = await this.prisma.promotion.findMany({
      where: { kind: 'automatic', status: 'active', startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: [{ priority: 'desc' }, { endsAt: 'asc' }, { id: 'asc' }],
    });
    return rows.filter((p) => {
      const c = (p.conditions ?? {}) as Conditions;
      return !c.channels || c.channels.includes('web');
    });
  }

  /** The promotion that badges an item: one whose targeting names it (product, type or category) — not a blanket one. */
  badgeFor(item: CardItem, promotions: Promotion[]): Promotion | null {
    return (
      promotions.find((p) => {
        const c = (p.conditions ?? {}) as Conditions;
        const targeted = c.productTypeCodes || c.categoryCodes || c.catalogProductIds;
        if (!targeted) return false;
        return (
          (!c.productTypeCodes || c.productTypeCodes.includes(item.productTypeCode)) &&
          (!c.categoryCodes || (item.categoryCode !== null && c.categoryCodes.includes(item.categoryCode))) &&
          (!c.catalogProductIds ||
            (item.catalogProductId !== null && c.catalogProductIds.includes(item.catalogProductId)))
        );
      }) ?? null
    );
  }

  /** D-307: the promoted per-piece price of the basis, or null when the promotion cannot promise it to everyone. */
  promotedPrice(p: Promotion, unitPrice: MoneyValue, quantity: number): MoneyValue | null {
    const c = (p.conditions ?? {}) as Conditions;
    if (c.segments || c.firstOrderOnly || c.paymentMethods || c.zoneCodes) return null;
    if (c.minQuantity && c.minQuantity > quantity) return null;
    if (c.minOrderValue && new MoneyDecimal(c.minOrderValue).gt(unitPrice.mul(quantity))) return null;
    const b = p.benefit as Benefit;
    if (b.type === 'percent' && 'pct' in b) {
      const off = unitPrice.mul(b.pct).div(100);
      if ('maxAmount' in b && b.maxAmount && off.mul(quantity).gt(b.maxAmount)) return null;
      return unitPrice.sub(off);
    }
    if (b.type === 'unit_price_override' && 'unitPrice' in b) {
      const v = new MoneyDecimal(b.unitPrice);
      return v.lt(unitPrice) ? v : null;
    }
    return null;
  }

  badge(p: Promotion): CampaignBadge {
    return { label: p.name, endsAt: toBangkokIso(p.endsAt!), promotionId: p.publicId };
  }

  /** Availability per product type (public id → value), resolved once per type. */
  async availabilities(typePublicIds: string[]): Promise<Map<string, 'instant' | 'partial' | 'rfq'>> {
    const out = new Map<string, 'instant' | 'partial' | 'rfq'>();
    for (const id of [...new Set(typePublicIds)])
      out.set(id, (await this.quotePath.availability(id)).availability);
    return out;
  }

  /** Facts of catalogue product cards, by product id. */
  async forProducts(ids: bigint[], now = new Date()): Promise<Map<bigint, CardFacts>> {
    const rows = await this.prisma.catalogProduct.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        publicId: true,
        slug: true,
        quantityMin: true,
        priceHint: true,
        productType: {
          select: {
            id: true,
            publicId: true,
            code: true,
            calculatorKey: true,
            category: { select: { code: true } },
          },
        },
      },
    });
    const [promotions, availability, ratePct] = await Promise.all([
      this.livePromotions(now),
      this.availabilities(rows.map((r) => r.productType.publicId)),
      vatStandardPct(this.prisma, now),
    ]);
    const out = new Map<bigint, CardFacts>();
    for (const r of rows) {
      const h = r.priceHint;
      const promo = this.badgeFor(
        {
          catalogProductId: r.publicId,
          productTypeId: r.productType.id,
          productTypeCode: r.productType.code,
          categoryCode: r.productType.category.code,
        },
        promotions,
      );
      const list = h ? new MoneyDecimal(h.unitPrice.toString()) : null;
      const promoted = promo && list && h ? this.promotedPrice(promo, list, h.quantity) : null;
      const starting = list ? ceilMoney(promoted ?? list) : null;
      out.set(r.id, {
        startingPricePerPiece: starting,
        startingPricePerPieceExVat: exVatFigure(starting, ratePct),
        startingPriceAssumes: h ? basis(h, r.productType.calculatorKey) : null,
        moq: r.quantityMin,
        leadTimeDays: h && h.leadTimeDays !== null ? { min: h.leadTimeDays, max: h.leadTimeDays } : null,
        availability: availability.get(r.productType.publicId) ?? 'rfq',
        campaignBadge: promo ? this.badge(promo) : null,
        ...(promoted && list && { referencePrice: ceilMoney(list) }),
        cacheTags: [
          `catalog:type:${r.productType.publicId}`,
          `catalog:product:${r.slug}`,
          ...(promo ? [`promo:${promo.publicId}`] : []),
        ],
      });
    }
    return out;
  }

  /** Facts of product type cards: the cheapest product's starting price, the smallest MOQ, the lead-time range. */
  async forTypes(typeIds: bigint[], now = new Date()): Promise<Map<bigint, CardFacts>> {
    const types = await this.prisma.productType.findMany({
      where: { id: { in: typeIds } },
      select: {
        id: true,
        publicId: true,
        code: true,
        calculatorKey: true,
        category: { select: { code: true } },
        catalogProducts: {
          where: { status: 'active' },
          select: { quantityMin: true, priceHint: true },
        },
      },
    });
    const [promotions, availability, ratePct] = await Promise.all([
      this.livePromotions(now),
      this.availabilities(types.map((t) => t.publicId)),
      vatStandardPct(this.prisma, now),
    ]);
    const out = new Map<bigint, CardFacts>();
    for (const t of types) {
      const hints = t.catalogProducts.map((p) => p.priceHint).filter((h) => h !== null);
      const cheapest = [...hints].sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice))[0];
      const leads = hints.map((h) => h.leadTimeDays).filter((d): d is number => d !== null);
      const moqs = t.catalogProducts.map((p) => p.quantityMin).filter((m): m is number => m !== null);
      const promo = this.badgeFor(
        {
          catalogProductId: null,
          productTypeId: t.id,
          productTypeCode: t.code,
          categoryCode: t.category.code,
        },
        promotions,
      );
      const starting = cheapest ? ceilMoney(new MoneyDecimal(cheapest.unitPrice.toString())) : null;
      out.set(t.id, {
        startingPricePerPiece: starting,
        startingPricePerPieceExVat: exVatFigure(starting, ratePct),
        startingPriceAssumes: cheapest ? basis(cheapest, t.calculatorKey) : null,
        moq: moqs.length ? Math.min(...moqs) : null,
        leadTimeDays: leads.length ? { min: Math.min(...leads), max: Math.max(...leads) } : null,
        availability: availability.get(t.publicId) ?? 'rfq',
        campaignBadge: promo ? this.badge(promo) : null,
        cacheTags: [`catalog:type:${t.publicId}`, ...(promo ? [`promo:${promo.publicId}`] : [])],
      });
    }
    return out;
  }

  /** Stock product cards: a badge at most, never a reference price (D-307). */
  async forStock(
    items: {
      sku: string;
      productTypeId: bigint;
      productTypeCode: string;
      productTypePublicId: string;
      categoryCode: string | null;
    }[],
    now = new Date(),
  ): Promise<Map<string, { campaignBadge: CampaignBadge | null; cacheTags: string[] }>> {
    const promotions = await this.livePromotions(now);
    return new Map(
      items.map((s) => {
        const promo = this.badgeFor({ catalogProductId: null, ...s }, promotions);
        return [
          s.sku,
          {
            campaignBadge: promo ? this.badge(promo) : null,
            cacheTags: [
              `catalog:type:${s.productTypePublicId}`,
              ...(promo ? [`promo:${promo.publicId}`] : []),
            ],
          },
        ];
      }),
    );
  }
}
