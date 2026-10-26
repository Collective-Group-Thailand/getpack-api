import { type Tx } from '@database/prisma.service';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { type PrintLimits, type PrintModel, printModelOf } from './print-model';

/**
 * B-API-6 (D-443, ADR-0005): the print model of a catalogue product is effective-dated — `catalog_product_print_models`
 * holds its versions and every read uses the one in force (greatest `effectiveFrom ≤ at`, ties: greatest `versionNo`).
 */
export interface PrintModelVersionLike {
  versionNo: number;
  effectiveFrom: Date;
  model: unknown;
}

export const PRINT_MODEL_VERSION_ORDER = [{ effectiveFrom: 'desc' as const }, { versionNo: 'desc' as const }];

/** The version in force at `at` among a product's versions (any order), or null. */
export function versionInForce<T extends PrintModelVersionLike>(versions: readonly T[], at: Date): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom.getTime() > at.getTime()) continue;
    if (
      !best ||
      v.effectiveFrom.getTime() > best.effectiveFrom.getTime() ||
      (v.effectiveFrom.getTime() === best.effectiveFrom.getTime() && v.versionNo > best.versionNo)
    )
      best = v;
  }
  return best;
}

/** The model in force at `at` of these versions (null: none, or a version that cleared it). */
export function modelInForce(versions: readonly PrintModelVersionLike[], at: Date): PrintModel | null {
  return printModelOf(versionInForce(versions, at)?.model ?? null);
}

/** The model in force of one catalogue product (internal id or public id). */
export async function printModelInForce(
  db: Tx,
  product: { id: bigint } | { publicId: string },
  at: Date = new Date(),
): Promise<PrintModel | null> {
  const version = await db.catalogProductPrintModel.findFirst({
    where: {
      ...('id' in product
        ? { catalogProductId: product.id }
        : { catalogProduct: { publicId: product.publicId } }),
      effectiveFrom: { lte: at },
    },
    orderBy: PRINT_MODEL_VERSION_ORDER,
    select: { model: true },
  });
  return printModelOf(version?.model ?? null);
}

/**
 * The print limits in force (`catalog.print_limits`, ADR-0005, seeded max 1 spot colour per side and the CMYK + spot
 * add-on off — `pending_business`). Null while the setting has no version in force: only the product's model applies.
 */
export async function printLimitsAt(db: Tx, at: Date = new Date()): Promise<PrintLimits | null> {
  try {
    const { value } = await new SettingsService(db as never).at('catalog.print_limits', { at, tx: db });
    return value;
  } catch (error) {
    if (error instanceof SettingNotFoundError) return null;
    throw error;
  }
}
