import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { CalculatorRegistry } from '@modules/pricing/calculators/calculator';
import {
  defaultSizeIndex,
  defaultSpecConfiguration,
  defaultSpecQuantity,
  withSpecDefaults,
} from '@modules/pricing/hints/default-spec';
import {
  CALCULATOR_SALES_UNIT,
  CALCULATORS_WITHOUT_DIFFICULTY,
} from '@modules/pricing/quotes/configurations';
import { MAX_QUANTITY_TIERS } from '@modules/pricing/quotes/quote.dto';
import { StorePricingService } from '@modules/pricing/quotes/store-pricing.service';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { CONTENT_INCLUDE } from '../crud/option-content';
import { pouchShapeOf, sizeRulesOf } from './size-rules';
import { imageUrl, StoreCatalogService } from './store-catalog.service';
import { type StoreConfiguratorDto } from './store-configurator.dto';

const ACTIVE = 'active' as const;

/**
 * The configurator read of a catalogue product whose type has a ported calculator (U-B6, triage
 * `store.configurator`): patterns with parts, flutes and typed size rules, standard sizes, the options with the
 * ids the quote configuration takes, the product's difficulty level, print areas, the D-051 validity. A product of
 * a type without a ported calculator is not found (RFQ only). No price, factory or cost data (D-044, D-050).
 */
@Injectable()
export class StoreConfiguratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: StoreCatalogService,
    private readonly settings: SettingsService,
    private readonly calculators: CalculatorRegistry,
    private readonly storePricing: StorePricingService,
  ) {}

  async get(slug: string): Promise<StoreConfiguratorDto> {
    const p = await this.prisma.catalogProduct.findFirst({
      where: { slug, status: ACTIVE, productType: { status: ACTIVE } },
      include: {
        productType: { select: { code: true, calculatorKey: true, quoteMode: true } },
        defaultDifficultyLevel: { select: { publicId: true, status: true } },
        patterns: {
          where: { pattern: { status: ACTIVE } },
          include: {
            pattern: {
              include: {
                ...CONTENT_INCLUDE,
                subPatterns: { orderBy: { seq: 'asc' } },
                fluteTypes: { include: { fluteType: { select: { publicId: true } } } },
                // The style drawn for "ดาวน์โหลดแบบกล่อง" (D-271): its published variants, never a factory.
                styleBase: {
                  select: {
                    code: true,
                    status: true,
                    variants: {
                      where: { publishable: true, status: ACTIVE },
                      select: { code: true },
                      orderBy: { code: 'asc' },
                    },
                  },
                },
              },
            },
          },
          orderBy: { sort: 'asc' },
        },
        options: { orderBy: [{ sort: 'asc' }] },
        standardSizes: { where: { status: ACTIVE }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] },
      },
    });
    const calculator = p?.productType.calculatorKey;
    if (!p || !calculator || !this.calculators.has(calculator)) throw new DomainException('http.not_found');
    const difficulty = p.defaultDifficultyLevel?.status === ACTIVE ? p.defaultDifficultyLevel.publicId : null;
    const validity = await this.settings.at('quotes.validity_days');
    // D-441: the default spec (the D-220 reference configuration) is what the configurator opens on and what the
    // "starting from" price is priced at — option defaults, the standard size and the quantity follow it.
    const spec = defaultSpecConfiguration(p.referenceConfiguration, p.publicId);
    const sizes = p.standardSizes.map((s) => ({
      id: s.publicId,
      code: s.code,
      name: s.name,
      lengthMm: s.lengthMm.toNumber(),
      widthMm: s.widthMm.toNumber(),
      heightMm: s.heightMm.toNumber(),
    }));
    const sizeIndex = defaultSizeIndex(sizes, spec);
    const specQuantity = defaultSpecQuantity(spec);
    const described = spec ? await this.storePricing.describe(calculator, spec).catch(() => null) : null;
    return {
      slug: p.slug,
      catalogProductId: p.publicId,
      productTypeCode: p.productType.code,
      calculator,
      instant:
        p.productType.quoteMode === 'instant' &&
        (difficulty !== null || CALCULATORS_WITHOUT_DIFFICULTY.has(calculator)),
      difficultyLevelId: difficulty,
      patterns: p.patterns.map(({ pattern }) => ({
        id: pattern.publicId,
        code: pattern.code,
        styleCode: pattern.styleCode,
        internationalName: pattern.internationalName,
        name: pattern.name,
        dielineKey: pattern.dielineKey,
        parts: pattern.subPatterns.map((s) => ({ subPatternId: s.publicId, seq: s.seq, name: s.name })),
        fluteTypeIds: pattern.fluteTypes.map((f) => f.fluteType.publicId),
        rules: sizeRulesOf(pattern.constraints),
        pouch: pouchShapeOf(pattern.pouchFormula, pattern.constraints),
        descriptionTh: pattern.descriptionTh,
        descriptionEn: pattern.descriptionEn,
        imageUrl: imageUrl(pattern.imageFile?.publicId),
        dielineVariantCodes:
          pattern.styleBase?.status === ACTIVE ? pattern.styleBase.variants.map((v) => v.code) : [],
      })),
      standardSizes: sizes.map((s, i) => ({ ...s, isDefault: spec ? i === sizeIndex : i === 0 })),
      optionGroups: withSpecDefaults(await this.catalog.optionGroups(p.options), spec),
      defaultSpec:
        spec && described && specQuantity !== null
          ? {
              configuration: spec,
              quantity: specQuantity,
              standardSizeCode: sizeIndex >= 0 ? sizes[sizeIndex]!.code : null,
              specs: described.specs,
              specLabel: described.label,
            }
          : null,
      printAreas: calculator === 'corrugate' ? ['top', 'side', 'top_side', 'all_round'] : [],
      quoteValidityDays: Number(validity.value),
      unit: CALCULATOR_SALES_UNIT[calculator] ?? 'piece',
      quantity: {
        min: p.quantityMin,
        max: p.quantityMax,
        default: specQuantity ?? p.quantityDefault,
        presets: [...(p.quantityPresets ?? [])].sort((a, b) => a - b),
        maxTiers: MAX_QUANTITY_TIERS,
      },
      // Uploading a file is always possible, the online designer works from the pattern's dieline (B4.1) and a
      // hired design is priced by quoting with `design.graphic` (D-071); `free_design` needs a promotion (D-181).
      design: { options: ['own_file', 'online_designer', 'hired_design'], default: 'own_file' },
    };
  }
}
