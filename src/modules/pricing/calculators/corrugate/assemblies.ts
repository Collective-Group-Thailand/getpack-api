import { PricingError } from '../shared/pricing-error';
import { type CorrugateFormula } from './geometry';
import { type AssemblyPrice, within } from './tables';

/**
 * Corrugate assemblies (U-B6): legacy `CalculatorCorrugate::calculateAssembly:1961-2037`, called for each
 * requested assembly, the automatic packing assembly (legacy group 22 appended to every part,
 * `CorrugateCalculator::setCSData:292-301`, quirk C8) and each fixed option (`:672-689`). Pure.
 *
 * Legacy's factory branches become terms and row data (quirk C6): factory 9's window price by area and its
 * packing per piece by box family, factory 4's free packing on RSC, factory 20's price by blank length. A
 * missing price row, which legacy reads as 0 (a PHP notice), refuses the configuration (C3).
 */

export interface AssemblyRequest {
  assemblyId: string;
  /** Catalogue: priced with the size and count of its pieces, material included (legacy `required_amount`). */
  requiresAmount: boolean;
  /** Catalogue: the automatic packing assembly (`auto_add`). */
  autoAdd: boolean;
  amount?: number;
  w?: number;
  l?: number;
}

export interface PackingTerms {
  /** Legacy factory 9: packing per piece for RSC / Tele / full-overlap boxes (0.8, `:2003-2005`)… */
  rscFamilyPerPcs: number | null;
  /** …and for other boxes (0.4, `:2006-2007`). */
  otherPerPcs: number | null;
  /** Legacy factory 4: no packing charge on an RSC-made box (`:2010-2011`). */
  freeOnRsc: boolean;
}

export interface AssemblyContext {
  qty: number;
  formula: CorrugateFormula;
  /** The part is made as RSC (legacy `pattern_type_id` 1). */
  rsc: boolean;
  /** The blank length with the factory's adjustment (legacy `$this->dL`, factory 20 bands). */
  blankDl: number;
  digital: boolean;
  /** Legacy `paper_trim.trim_finish_plate_mm` of the print type; null = no paper-trim line. */
  trimFinishPlateMm: number | null;
  packing: PackingTerms;
}

export interface AssemblyLine {
  assemblyId: string;
  /** Legacy `price_per_pcs` of the line (display). */
  pricePerPcs: number;
  total: number;
}

/** Legacy pattern ids 19, 29 and 39 (`:2003`): the RSC family of factory 9's packing price. */
const RSC_FAMILY: readonly CorrugateFormula[] = ['rsc', 'tele_body', 'tele_lid', 'full_overlap'];

/** The price row of an assembly for the quantity, window area and blank length (`:1964-1978`). */
function priceRow(
  prices: readonly AssemblyPrice[],
  request: AssemblyRequest,
  ctx: AssemblyContext,
): AssemblyPrice | undefined {
  const areaSqcm = request.w !== undefined && request.l !== undefined ? (request.w * request.l) / 100 : null;
  return prices.find(
    (p) =>
      p.assemblyId === request.assemblyId &&
      within(ctx.qty, p.rangeMin, p.rangeMax) &&
      // Window area `min < area ≤ max` (`:1972-1973`).
      (p.minAreaSqcm === null || (areaSqcm !== null && p.minAreaSqcm < areaSqcm)) &&
      (p.maxAreaSqcm === null || (areaSqcm !== null && p.maxAreaSqcm >= areaSqcm)) &&
      // Blank length `min ≤ dL < max` (`:1975-1976`).
      (p.minDlMm === null || p.minDlMm <= ctx.blankDl) &&
      (p.maxDlMm === null || p.maxDlMm > ctx.blankDl),
  );
}

/** One assembly's cost for the part's run (`:1961-2037`). */
export function assemblyLine(
  request: AssemblyRequest,
  prices: readonly AssemblyPrice[],
  ctx: AssemblyContext,
): AssemblyLine {
  const row = priceRow(prices, request, ctx);
  const missing = () =>
    new PricingError('price_line_missing', `corrugate_assembly_prices ${request.assemblyId}`);
  if (request.autoAdd) {
    // Packing (legacy group 22, `:1984-2015`).
    const { rscFamilyPerPcs, otherPerPcs, freeOnRsc } = ctx.packing;
    if (rscFamilyPerPcs !== null && otherPerPcs !== null) {
      const perPcs = RSC_FAMILY.includes(ctx.formula) ? rscFamilyPerPcs : otherPerPcs;
      return { assemblyId: request.assemblyId, pricePerPcs: perPcs, total: perPcs * ctx.qty };
    }
    if (freeOnRsc && ctx.rsc)
      return { assemblyId: request.assemblyId, pricePerPcs: row?.pricePerPcs ?? 0, total: 0 };
    if (!row) throw missing();
    return { assemblyId: request.assemblyId, pricePerPcs: row.pricePerPcs, total: row.pricePerPcs * ctx.qty };
  }
  if (!row) throw missing();
  if (row.method === 'per_area_piece') {
    // Legacy factory 9 window: qty × pieces × price, at least the minimum (`:1981-1983`).
    const sum = ctx.qty * (request.amount ?? 0) * row.pricePerPcs;
    return {
      assemblyId: request.assemblyId,
      pricePerPcs: row.pricePerPcs,
      total: Math.max(sum, row.minPrice ?? sum),
    };
  }
  // Digital with a minimum price: the minimum, flat (`:2017-2018`); otherwise per piece.
  let total = ctx.digital && row.minPrice ? row.minPrice : ctx.qty * row.pricePerPcs;
  if (request.requiresAmount) {
    // The pieces' material by area, trims included (`:2023-2027`).
    if (ctx.trimFinishPlateMm === null) throw new PricingError('price_line_missing', 'paper_trims');
    if (row.materialPricePerIn2 === null) throw missing();
    const trim = ctx.trimFinishPlateMm;
    const material =
      ((((request.w ?? 0) + trim) * ((request.l ?? 0) + trim)) / (25.4 * 25.4)) *
      row.materialPricePerIn2 *
      (request.amount ?? 0);
    total += material * ctx.qty;
  }
  return { assemblyId: request.assemblyId, pricePerPcs: row.pricePerPcs, total };
}

export function assemblyCost(
  requests: readonly AssemblyRequest[],
  prices: readonly AssemblyPrice[],
  ctx: AssemblyContext,
): { total: number; lines: AssemblyLine[] } {
  const lines = requests.map((r) => assemblyLine(r, prices, ctx));
  return { total: lines.reduce((a, l) => a + l.total, 0), lines };
}
