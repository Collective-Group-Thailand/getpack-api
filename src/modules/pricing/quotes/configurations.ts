import { DomainException } from '@common/errors/domain.exception';
import { validateAs } from '@common/validation/validation';
import { type CalculatorKey } from '@generated/prisma/client';
import { type Type } from '@nestjs/common';

import { CorrugateConfigurationDto, CsCorrugateConfigurationDto } from './corrugate.dto';
import { FoldingConfigurationDto } from './quote.dto';

/**
 * The configuration DTO of each ported calculator (B2.3, U-B6): a quote's `configuration` is validated against
 * the DTO of its product type's calculator, errors under `configuration`. CS may use the staff variant (legacy
 * CS-only inputs, e.g. corrugate digital coverage).
 */
const DTOS: Partial<Record<CalculatorKey, { store: Type<object>; staff: Type<object> }>> = {
  folding: { store: FoldingConfigurationDto, staff: FoldingConfigurationDto },
  corrugate: { store: CorrugateConfigurationDto, staff: CsCorrugateConfigurationDto },
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
