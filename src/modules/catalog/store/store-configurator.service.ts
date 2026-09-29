import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { CalculatorRegistry } from '@modules/pricing/calculators/calculator';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { sizeRulesOf } from './size-rules';
import { StoreCatalogService } from './store-catalog.service';
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
                subPatterns: { orderBy: { seq: 'asc' } },
                fluteTypes: { include: { fluteType: { select: { publicId: true } } } },
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
    return {
      slug: p.slug,
      catalogProductId: p.publicId,
      productTypeCode: p.productType.code,
      calculator,
      instant: p.productType.quoteMode === 'instant' && difficulty !== null,
      difficultyLevelId: difficulty,
      patterns: p.patterns.map(({ pattern }) => ({
        id: pattern.publicId,
        code: pattern.code,
        name: pattern.name,
        dielineKey: pattern.dielineKey,
        parts: pattern.subPatterns.map((s) => ({ subPatternId: s.publicId, seq: s.seq, name: s.name })),
        fluteTypeIds: pattern.fluteTypes.map((f) => f.fluteType.publicId),
        rules: sizeRulesOf(pattern.constraints),
      })),
      standardSizes: p.standardSizes.map((s) => ({
        id: s.publicId,
        code: s.code,
        name: s.name,
        lengthMm: s.lengthMm.toNumber(),
        widthMm: s.widthMm.toNumber(),
        heightMm: s.heightMm.toNumber(),
      })),
      optionGroups: await this.catalog.optionGroups(p.options),
      printAreas: calculator === 'corrugate' ? ['top', 'side', 'top_side', 'all_round'] : [],
      quoteValidityDays: Number(validity.value),
    };
  }
}
