import { type PrismaService } from '@database/prisma.service';
import { type CalculatorKey } from '@generated/prisma/client';
import { MAX_QUANTITY_TIERS } from '@modules/pricing/quotes/quote.dto';
import { type SettingsService } from '@platform/settings/settings.service';

import { type CsCatalogProductDto, type CsDiscountPolicyDto } from './quotes.io.dto';

/**
 * What every CS calculator screen needs besides its options (U-B0.2): the calculator's active catalogue products
 * with their standard sizes and quantity limits / presets, and the discount CS may give without a memo
 * (`discounts.cs_limit_pct`, D-052).
 */
export async function csInputExtras(
  prisma: PrismaService,
  settings: SettingsService,
  calculator: CalculatorKey,
): Promise<{ catalogProducts: CsCatalogProductDto[]; discountPolicy: CsDiscountPolicyDto }> {
  const [products, limit] = await Promise.all([
    prisma.catalogProduct.findMany({
      where: { status: 'active', productType: { calculatorKey: calculator, status: 'active' } },
      include: {
        standardSizes: { where: { status: 'active' }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] },
      },
      orderBy: { slug: 'asc' },
    }),
    settings.at('discounts.cs_limit_pct'),
  ]);
  return {
    catalogProducts: products.map((p) => ({
      id: p.publicId,
      slug: p.slug,
      nameTh: p.nameTh,
      nameEn: p.nameEn,
      standardSizes: p.standardSizes.map((s) => ({
        id: s.publicId,
        code: s.code,
        name: s.name,
        lengthMm: s.lengthMm.toNumber(),
        widthMm: s.widthMm.toNumber(),
        heightMm: s.heightMm.toNumber(),
      })),
      quantity: {
        min: p.quantityMin,
        max: p.quantityMax,
        default: p.quantityDefault,
        presets: [...(p.quantityPresets ?? [])].sort((a, b) => a - b),
        maxTiers: MAX_QUANTITY_TIERS,
      },
    })),
    discountPolicy: { directLimitPct: String(limit.value) },
  };
}
