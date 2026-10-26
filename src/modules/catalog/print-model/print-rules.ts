import { DomainException } from '@common/errors/domain.exception';
import { type Tx } from '@database/prisma.service';

import {
  checkSide,
  corrugateSides,
  type InkKind,
  PRINT_MODEL_CALCULATORS,
  type PrintViolationCode,
} from './print-model';
import { printLimitsAt, printModelInForce } from './print-model-versions';

export interface PrintCombinationError {
  path: string;
  code: PrintViolationCode;
  message: string;
}

/**
 * Store rule (D-443): every side of a store configuration is one valid choice of the product's print model in force
 * (B-API-6, effective-dated) — `none`, `spot` 1..N allowed colours, or `cmyk` (+ 0..M spot colours when the add-on is
 * enabled) — within what the engine can price (`catalog.print_limits`). Without a model the combinations that are
 * never valid (CMYK + a spot colour such as ดำ + CMYK, the process set twice) and more spot colours than the limit
 * are refused. One field error per side (`errors[].code` ∈ `PRINT_VIOLATIONS`); empty = valid.
 */
export async function printCombinationErrors(
  db: Tx,
  calculatorKey: string,
  configuration: Record<string, unknown>,
  at: Date = new Date(),
): Promise<PrintCombinationError[]> {
  if (!PRINT_MODEL_CALCULATORS.has(calculatorKey)) return [];
  const sides = corrugateSides(configuration).filter((s) => s.inkColourIds.length > 0);
  const productId = configuration['catalogProductId'];
  const model =
    typeof productId === 'string' ? await printModelInForce(db, { publicId: productId }, at) : null;
  if (sides.length === 0 && !model) return [];
  const limits = await printLimitsAt(db, at);
  const ids = [...new Set(sides.flatMap((s) => s.inkColourIds))];
  const inks =
    ids.length === 0
      ? []
      : await db.inkColour.findMany({
          where: { publicId: { in: ids } },
          select: { publicId: true, colourKind: true },
        });
  const kinds = new Map<string, InkKind>(inks.map((i) => [i.publicId, i.colourKind]));
  const all = corrugateSides(configuration);
  // A combination's other parts may stay unprinted (a Tele body under a printed lid): an empty side is checked
  // against `none` only on a one-part configuration.
  const onePart = all.length <= 2;
  return all.flatMap(({ path, side, inkColourIds }) => {
    if (inkColourIds.length === 0 && !onePart) return [];
    const violation = checkSide(model ? model[side] : null, inkColourIds, (id) => kinds.get(id), limits);
    return violation ? [{ path, code: violation.code, message: violation.message }] : [];
  });
}

/** 422 `pricing.print_combination_invalid` when `printCombinationErrors` finds any (saved quotes, admin, Studio…). */
export async function assertPrintCombination(
  db: Tx,
  calculatorKey: string,
  configuration: Record<string, unknown>,
  at: Date = new Date(),
): Promise<void> {
  const errors = await printCombinationErrors(db, calculatorKey, configuration, at);
  if (errors.length > 0) throw new DomainException('pricing.print_combination_invalid', { errors });
}
