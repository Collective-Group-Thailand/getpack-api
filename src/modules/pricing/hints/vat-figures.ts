import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { exVat } from '@common/money/vat';
import { type Prisma } from '@generated/prisma/client';

type Db = Pick<Prisma.TransactionClient, 'taxRateVersion'>;

/**
 * C1b (owner 2026-10-28, DECISIONS-STAGE-A §10.6): the approved `vat_standard` rate in force at `at`, in percent —
 * the rate the shared VAT helper uses; null when none is approved (the ex-VAT figures are then left out, never
 * computed with a constant).
 */
export async function vatStandardPct(db: Db, at = new Date()): Promise<MoneyValue | null> {
  const version = await db.taxRateVersion.findFirst({
    where: { taxRate: { code: 'vat_standard' }, status: 'approved', effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
    select: { ratePct: true },
  });
  return version ? new MoneyDecimal(version.ratePct.toString()) : null;
}

/**
 * The ex-VAT (net) figure of a VAT-inclusive per-piece price the storefront shows: the shared helper's ex-VAT of one
 * inclusive line (`exVat`, half-up to the satang). Null when there is no price or no rate. Pure.
 */
export function exVatFigure(inclusive: string | null, ratePct: MoneyValue | null): string | null {
  if (inclusive === null || ratePct === null) return null;
  return exVat({ amount: inclusive, inclusive: true }, ratePct).toFixed(2);
}
