import { DomainException } from '@common/errors/domain.exception';
import { type ProblemFieldError } from '@common/errors/problem-details.dto';
import { validateAs } from '@common/validation/validation';
import { type Tx } from '@database/prisma.service';
import { type CalculatorKey, type ProductUnit } from '@generated/prisma/client';
import { type PrintCombinationError, printCombinationErrors } from '@modules/catalog/print-model/print-rules';
import { gussetViolation, sizeRulesOf, sizeViolation } from '@modules/catalog/store/size-rules';
import { type Type } from '@nestjs/common';
import { getMetadataStorage, ValidationTypes } from 'class-validator';

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
 * - the product's per-side print model in force (D-443, B-API-6): one valid print choice per side
 *   (`pricing.print_combination_invalid`, or collected for the store calculation, which answers with the quote path).
 * A missing pattern is left to the calculator's own validation.
 */
export async function assertStoreRules(
  db: Tx,
  key: CalculatorKey,
  configuration: Record<string, unknown>,
  options: { printCombination?: 'refuse' | 'collect' } = {},
): Promise<{ printErrors: PrintCombinationError[] }> {
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
  // B-API-6: the store calculation collects a combination the engine cannot price (it answers with the quote path);
  // every other caller refuses it (422 `pricing.print_combination_invalid`).
  const printErrors = await printCombinationErrors(db, key, configuration);
  if (printErrors.length > 0 && options.printCombination !== 'collect')
    throw new DomainException('pricing.print_combination_invalid', { errors: printErrors });
  const result = { printErrors };
  if (typeof configuration['patternId'] !== 'string') return result;
  const pattern = await db.pattern.findUnique({
    where: { publicId: configuration['patternId'] },
    select: { constraints: true },
  });
  if (!pattern) return result;
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
  return result;
}

/** The calculators whose sizes carry a measurement basis the customer must choose (D-182). */
const SIZED: ReadonlySet<CalculatorKey> = new Set<CalculatorKey>([
  'folding',
  'corrugate',
  'tag_sleeve',
  'label',
  'pouch',
]);

/** The required top-level fields of a DTO: those validated without `@IsOptional` (class-validator metadata). */
function requiredFields(dto: Type<object>): string[] {
  const metas = getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false);
  const optional = new Set(
    metas.filter((m) => m.type === ValidationTypes.CONDITIONAL_VALIDATION).map((m) => m.propertyName),
  );
  return [...new Set(metas.map((m) => m.propertyName))].filter((p) => !optional.has(p)).sort();
}

const blank = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export interface Completeness {
  /** 0–100: the share of the required fields given. */
  completenessPct: number;
  /** Required fields not given yet (top level). */
  missingFields: string[];
  /** Fields given with a value the calculator refuses. */
  invalidFields: ProblemFieldError[];
  /** Every required field given and every value valid: the draft can be priced or sent as an RFQ. */
  complete: boolean;
}

/**
 * How complete a draft configuration is (D-185): the calculator's required fields — and the measurement basis of a
 * sized product, which the customer must choose (D-182) — given or missing, and the invalid values. Nothing is priced.
 */
export async function assessConfiguration(
  key: CalculatorKey,
  configuration: Record<string, unknown>,
): Promise<Completeness> {
  const dtos = DTOS[key];
  if (!dtos) throw new DomainException('pricing.not_instant');
  const required = [...requiredFields(dtos.store), ...(SIZED.has(key) ? ['basis'] : [])];
  const missingFields = required.filter((f) => blank(configuration[f]));
  let invalidFields: ProblemFieldError[] = [];
  try {
    await validateAs(dtos.store, configuration, 'configuration');
  } catch (error) {
    if (!(error instanceof DomainException) || error.code !== 'validation.failed') throw error;
    const missing = new Set(missingFields.map((f) => `configuration.${f}`));
    invalidFields = (error.errors ?? []).filter(
      (e) =>
        ![...missing].some((m) => e.path === m || e.path.startsWith(`${m}.`) || e.path.startsWith(`${m}[`)),
    );
  }
  const given = required.length - missingFields.length;
  return {
    completenessPct: required.length === 0 ? 100 : Math.round((given / required.length) * 10000) / 100,
    missingFields,
    invalidFields,
    complete: missingFields.length === 0 && invalidFields.length === 0,
  };
}
