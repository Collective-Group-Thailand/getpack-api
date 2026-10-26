import { DomainException } from '@common/errors/domain.exception';
import { type Tx } from '@database/prisma.service';

import {
  checkSide,
  corrugateSides,
  type InkKind,
  PRINT_MODEL_CALCULATORS,
  printModelOf,
} from './print-model';

/**
 * Store rule (D-443): every side of a store configuration is one valid choice of the product's print model —
 * `none`, `spot` 1..N allowed colours, or `cmyk` (+ 0..M spot colours when the add-on is enabled). Without a model
 * the combinations that are never valid (CMYK + a spot colour such as ดำ + CMYK, the process set twice) are refused.
 * 422 `pricing.print_combination_invalid` with one field error per side (`errors[].code` ∈ `PRINT_VIOLATIONS`).
 */
export async function assertPrintCombination(
  db: Tx,
  calculatorKey: string,
  configuration: Record<string, unknown>,
): Promise<void> {
  if (!PRINT_MODEL_CALCULATORS.has(calculatorKey)) return;
  const sides = corrugateSides(configuration).filter((s) => s.inkColourIds.length > 0);
  const productId = configuration['catalogProductId'];
  const product =
    typeof productId === 'string'
      ? await db.catalogProduct.findUnique({ where: { publicId: productId }, select: { printModel: true } })
      : null;
  const model = printModelOf(product?.printModel);
  if (sides.length === 0 && !model) return;
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
  const errors = all.flatMap(({ path, side, inkColourIds }) => {
    if (inkColourIds.length === 0 && !onePart) return [];
    const violation = checkSide(model ? model[side] : null, inkColourIds, (id) => kinds.get(id));
    return violation ? [{ path, code: violation.code, message: violation.message }] : [];
  });
  if (errors.length > 0) throw new DomainException('pricing.print_combination_invalid', { errors });
}
