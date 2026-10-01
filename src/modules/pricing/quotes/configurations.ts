import { DomainException } from '@common/errors/domain.exception';
import { validateAs } from '@common/validation/validation';
import { type Tx } from '@database/prisma.service';
import { type CalculatorKey, type ProductUnit } from '@generated/prisma/client';
import { gussetViolation, sizeRulesOf, sizeViolation } from '@modules/catalog/store/size-rules';
import { type Type } from '@nestjs/common';

import { CorrugateConfigurationDto, CsCorrugateConfigurationDto } from './corrugate.dto';
import { LabelConfigurationDto } from './label.dto';
import { PouchConfigurationDto } from './pouch.dto';
import { FoldingConfigurationDto } from './quote.dto';
import { ServiceConfigurationDto } from './service.dto';
import { StandardProductConfigurationDto } from './standard-product.dto';
import { TagSleeveConfigurationDto } from './tag-sleeve.dto';

/**
 * The configuration DTO of each ported calculator (B2.3, U-B6): a quote's `configuration` is validated against
 * the DTO of its product type's calculator, errors under `configuration`. CS may use the staff variant (legacy
 * CS-only inputs, e.g. corrugate digital coverage).
 */
/** The sales unit a calculator's quantities count (the box calculators price pieces). */
export const CALCULATOR_SALES_UNIT: Partial<Record<CalculatorKey, ProductUnit>> = {
  folding: 'piece',
  corrugate: 'piece',
  label: 'piece',
  tag_sleeve: 'piece',
  pouch: 'pouch',
  service: 'job',
};

/** Calculators priced without a difficulty level (legacy pouch, standard-product and service prices have none, U-B6). */
export const CALCULATORS_WITHOUT_DIFFICULTY: ReadonlySet<CalculatorKey> = new Set<CalculatorKey>([
  'pouch',
  'standard_product',
  'service',
]);

const DTOS: Partial<Record<CalculatorKey, { store: Type<object>; staff: Type<object> }>> = {
  folding: { store: FoldingConfigurationDto, staff: FoldingConfigurationDto },
  corrugate: { store: CorrugateConfigurationDto, staff: CsCorrugateConfigurationDto },
  label: { store: LabelConfigurationDto, staff: LabelConfigurationDto },
  tag_sleeve: { store: TagSleeveConfigurationDto, staff: TagSleeveConfigurationDto },
  pouch: { store: PouchConfigurationDto, staff: PouchConfigurationDto },
  standard_product: { store: StandardProductConfigurationDto, staff: StandardProductConfigurationDto },
  service: { store: ServiceConfigurationDto, staff: ServiceConfigurationDto },
};

export async function validateConfiguration(
  key: CalculatorKey,
  configuration: unknown,
  opts: { staff: boolean },
): Promise<Record<string, unknown>> {
  const dtos = DTOS[key];
  if (!dtos) throw new DomainException('pricing.not_instant');
  return (await validateAs(opts.staff ? dtos.staff : dtos.store, configuration, 'configuration')) as Record<
    string,
    unknown
  >;
}

/**
 * The rules a customer request follows on top of the DTO (CS is not checked):
 * - the pattern's size rules (legacy `Calculator::validateInput:471-518`, customer path only; a tag or sleeve is a
 *   flat blank: width and length only, legacy skips the height and `l ≥ w` checks for packaging 5);
 * - the catalogue product's fixed difficulty level (legacy's customer path hard-coded it, port map quirk C9): a
 *   product with a default difficulty is priced at that level only; a corrugate request names its catalogue product,
 *   which the configurator gives.
 * A missing pattern is left to the calculator's own validation.
 */
export async function assertStoreRules(
  db: Tx,
  key: CalculatorKey,
  configuration: Record<string, unknown>,
): Promise<void> {
  const fail = (path: string, code: string, message: string): never => {
    throw new DomainException('validation.failed', { errors: [{ path, code, message }] });
  };
  const productId = configuration['catalogProductId'];
  if (typeof productId === 'string') {
    const product = await db.catalogProduct.findUnique({
      where: { publicId: productId },
      select: { defaultDifficultyLevel: { select: { publicId: true } } },
    });
    if (!product) fail('configuration.catalogProductId', 'exists', 'no such catalogue product');
    const fixed = product?.defaultDifficultyLevel?.publicId;
    if (fixed && !CALCULATORS_WITHOUT_DIFFICULTY.has(key) && configuration['difficultyLevelId'] !== fixed) {
      fail(
        'configuration.difficultyLevelId',
        'in',
        'the catalogue product is priced at its own difficulty level',
      );
    }
  } else if (
    key === 'corrugate' ||
    key === 'label' ||
    key === 'tag_sleeve' ||
    key === 'pouch' ||
    key === 'service'
  ) {
    fail('configuration.catalogProductId', 'required', 'the catalogue product is required');
  }
  if (typeof configuration['patternId'] !== 'string') return;
  const pattern = await db.pattern.findUnique({
    where: { publicId: configuration['patternId'] },
    select: { constraints: true },
  });
  if (!pattern) return;
  const violation = sizeViolation(
    sizeRulesOf(pattern.constraints),
    { w: Number(configuration['w']), l: Number(configuration['l']), d: Number(configuration['d']) },
    { corrugate: key === 'corrugate', flat: key === 'tag_sleeve' || key === 'pouch' },
  );
  if (violation) throw new DomainException('validation.failed', { errors: [violation] });
  if (key === 'pouch') {
    const gusset = gussetViolation(pattern.constraints, configuration);
    if (gusset) throw new DomainException('validation.failed', { errors: [gusset] });
  }
}
