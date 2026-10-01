import { DomainException } from '@common/errors/domain.exception';
import { validateAs } from '@common/validation/validation';
import { type Tx } from '@database/prisma.service';
import { type CalculatorKey, type ProductUnit } from '@generated/prisma/client';
import { sizeRulesOf, sizeViolation } from '@modules/catalog/store/size-rules';
import { type Type } from '@nestjs/common';

import { CorrugateConfigurationDto, CsCorrugateConfigurationDto } from './corrugate.dto';
import { LabelConfigurationDto } from './label.dto';
import { FoldingConfigurationDto } from './quote.dto';

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
};

const DTOS: Partial<Record<CalculatorKey, { store: Type<object>; staff: Type<object> }>> = {
  folding: { store: FoldingConfigurationDto, staff: FoldingConfigurationDto },
  corrugate: { store: CorrugateConfigurationDto, staff: CsCorrugateConfigurationDto },
  label: { store: LabelConfigurationDto, staff: LabelConfigurationDto },
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
 * - the pattern's size rules (legacy `Calculator::validateInput:471-518`, customer path only);
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
    if (fixed && configuration['difficultyLevelId'] !== fixed) {
      fail(
        'configuration.difficultyLevelId',
        'in',
        'the catalogue product is priced at its own difficulty level',
      );
    }
  } else if (key === 'corrugate' || key === 'label') {
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
    { corrugate: key === 'corrugate' },
  );
  if (violation) throw new DomainException('validation.failed', { errors: [violation] });
}
