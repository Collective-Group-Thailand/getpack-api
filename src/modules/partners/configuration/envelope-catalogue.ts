import { DomainException } from '@common/errors/domain.exception';
import { type Tx } from '@database/prisma.service';
import { type CalculatorKey } from '@generated/prisma/client';

import { type EnvelopeError, parseEnvelope, type TierBEnvelope } from './tier-b-envelope';

/**
 * A tier-B envelope checked for a product type (D-234): its shape for the type's calculator, then every catalogue
 * reference — print types, patterns, stock products and service items of that type, standard sizes of its products, and
 * materials — must exist and not be archived. Throws 422 `validation.failed` with every problem.
 */
export async function validatedEnvelope(
  db: Tx,
  type: { id: bigint; calculatorKey: CalculatorKey | null },
  raw: unknown,
  path = 'envelope',
): Promise<TierBEnvelope> {
  const fail = (errors: EnvelopeError[]) =>
    new DomainException('validation.failed', {
      errors: errors.map((e) => ({
        path: e.path.replace(/^envelope/, path),
        code: 'envelope',
        message: e.message,
      })),
    });
  if (!type.calculatorKey) {
    throw fail([
      { path: 'envelope', message: 'a tier-B path needs a product type with a calculator (D-043)' },
    ]);
  }
  const { envelope, errors } = parseEnvelope(type.calculatorKey, raw);
  if (errors.length > 0) throw fail(errors);
  const live = { status: { not: 'archived' as const } };
  const found = async (
    key: keyof TierBEnvelope,
    ids: string[] | undefined,
    count: (ids: string[]) => Promise<number>,
  ) => {
    if (ids && (await count(ids)) !== ids.length) {
      errors.push({
        path: `envelope.${key}`,
        message: 'lists an id that is not in the catalogue for this product type',
      });
    }
  };
  const productTypeId = type.id;
  await found('printTypeIds', envelope.printTypeIds, (ids) =>
    db.printType.count({ where: { publicId: { in: ids }, productTypeId, ...live } }),
  );
  await found('patternIds', envelope.patternIds, (ids) =>
    db.pattern.count({ where: { publicId: { in: ids }, productTypeId, ...live } }),
  );
  await found('materialIds', envelope.materialIds, (ids) =>
    db.material.count({ where: { publicId: { in: ids }, ...live } }),
  );
  await found('standardSizeIds', envelope.standardSizeIds, (ids) =>
    db.standardSize.count({ where: { publicId: { in: ids }, catalogProduct: { productTypeId }, ...live } }),
  );
  await found('stockProductIds', envelope.stockProductIds, (ids) =>
    db.stockProduct.count({ where: { publicId: { in: ids }, productTypeId, ...live } }),
  );
  await found('catalogProductIds', envelope.catalogProductIds, (ids) =>
    db.catalogProduct.count({ where: { publicId: { in: ids }, productTypeId, ...live } }),
  );
  if (errors.length > 0) throw fail(errors);
  return envelope;
}
