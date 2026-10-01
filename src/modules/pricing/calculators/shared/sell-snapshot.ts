import { DomainException } from '@common/errors/domain.exception';
import { type Tx } from '@database/prisma.service';
import { type Prisma } from '@generated/prisma/client';

import { type SellMarginLine, type SellSnapshot } from './sell';

const num = (d: Prisma.Decimal | null | undefined): number | null =>
  d === null || d === undefined ? null : Number(d.toString());

export interface LoadedSell {
  snapshot: SellSnapshot;
  versionIds: bigint[];
  vatRateVersionId: bigint;
}

/**
 * Packio's sell side at `at` for a product type and print type (D-063, schema-design A-23): per kind
 * (`margin`, `fix_cost`, `design_fee`, `structure_design_fee`) the print type's own approved table
 * version, else the product type's; VAT the dated `vat_standard` rate. Every version id used is
 * returned for the quote snapshot (§2.2).
 */
export async function loadSellSnapshot(
  db: Tx,
  productTypeId: bigint,
  /** Null: the product type's tables only (a CS amount with no factory print type, U-B6 service). */
  printTypeId: bigint | null,
  at: Date,
  opts: { priceMaxInclusive?: boolean } = {},
): Promise<LoadedSell> {
  const tables = await db.sellMarginTable.findMany({
    where: {
      productTypeId,
      OR: printTypeId === null ? [{ printTypeId: null }] : [{ printTypeId }, { printTypeId: null }],
    },
    include: {
      versions: {
        where: { status: 'approved', effectiveFrom: { lte: at } },
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        take: 1,
        include: { lines: { orderBy: { id: 'asc' } } },
      },
    },
  });
  const pick = (kind: string) =>
    (
      (printTypeId !== null
        ? tables.find((t) => t.kind === kind && t.printTypeId === printTypeId)
        : undefined) ?? tables.find((t) => t.kind === kind && t.printTypeId === null)
    )?.versions[0];
  const margin = pick('margin');
  const fixCost = pick('fix_cost');
  const design = pick('design_fee');
  const structure = pick('structure_design_fee');
  const amount = (v: typeof margin): number | null =>
    v ? (num(v.lines[0]?.valueAmount) ?? num(v.fallbackAmount)) : null;
  const vat = await db.taxRateVersion.findFirst({
    where: { taxRate: { code: 'vat_standard' }, status: 'approved', effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
  });
  if (!vat) throw new DomainException('pricing.vat_rate_missing');
  const lines: SellMarginLine[] = (margin?.lines ?? [])
    .filter((l) => l.valuePct !== null)
    .map((l) => ({
      qtyMin: l.qtyMin,
      qtyMax: l.qtyMax,
      priceMin: num(l.priceMin),
      priceMax: num(l.priceMax),
      valuePct: num(l.valuePct) ?? 0,
    }));
  return {
    snapshot: {
      marginLines: lines,
      marginFallbackPct: margin ? num(margin.fallbackPct) : null,
      fixCost: amount(fixCost) ?? 0,
      designFee: amount(design),
      structureDesignFee: amount(structure),
      vatPct: num(vat.ratePct) ?? 0,
      ...(opts.priceMaxInclusive ? { priceMaxInclusive: true } : {}),
    },
    versionIds: [margin, fixCost, design, structure].flatMap((x) => (x ? [x.id] : [])),
    vatRateVersionId: vat.id,
  };
}
