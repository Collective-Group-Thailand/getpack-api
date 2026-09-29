import { type Tx } from '@database/prisma.service';
import { type PriceValues } from '@modules/partners/pricing/price-component.registry';

/** Group-1 suggestions (D-040): the material family a line prices, by its material's public id. */
export const materialFamily = async (values: PriceValues, db: Tx): Promise<bigint | null> => {
  const rows = await db.$queryRawUnsafe<{ family_id: bigint | null }[]>(
    'SELECT family_id FROM materials WHERE public_id = $1::uuid',
    values['materialId'],
  );
  return rows[0]?.family_id ?? null;
};
