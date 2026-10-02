import { type OffsetPartInput, productionRuns } from '../a/engine';
import { calculateGeometry } from '../geometry/pattern-area';
import { GeometryError, type GeometrySnapshot, type PatternArea } from '../geometry/types';
import { excludedProcess, PricingError, type ProcessExclusion } from '../request';
import { type BPricedLayout, priceBLayout, sortBLayouts } from './cost';
import { type BTables } from './tables';
import { bLayoutWaste } from './waste';

/**
 * Engine B for one part at one factory and print type (legacy `FoldingCalculator::calculate:1293-1355` with
 * `B/CalculateWaste` and `B/CalculateCost`, D-233): production minimum, layouts with the plain paper trim (the loader
 * sets `useMaxMinPaperTrim` off for `b`), B waste and B cost per quantity.
 */

export interface BPartSnapshot {
  geometry: GeometrySnapshot;
  tables: BTables;
  exclusions: readonly ProcessExclusion[];
  minOrderForProduction: number | null;
}

export interface BPartResult {
  patternArea: PatternArea;
  steps: { qty: number; boxAmount: number; layouts: BPricedLayout[] }[];
}

export function priceBPart(input: OffsetPartInput, snapshot: BPartSnapshot): BPartResult {
  const excluded = excludedProcess(input.request, snapshot.exclusions);
  if (excluded) throw new PricingError('process_not_possible', excluded);
  const boxAmounts = productionRuns(input.quantities, snapshot.minOrderForProduction);
  let geometry;
  try {
    geometry = calculateGeometry(
      { ...input.geometry, boxAmounts, quantities: input.quantities },
      snapshot.geometry,
    );
  } catch (error) {
    if (error instanceof GeometryError) throw new PricingError(error.code, error.detail);
    throw error;
  }
  const steps = geometry.layouts.map((candidates, index) => {
    const priced: BPricedLayout[] = [];
    for (const layout of candidates) {
      const waste = bLayoutWaste(input.request, layout, snapshot.tables);
      priced.push(...priceBLayout(input.request, layout, waste, snapshot.tables));
    }
    return { qty: input.quantities[index]!, boxAmount: boxAmounts[index]!, layouts: sortBLayouts(priced) };
  });
  return { patternArea: geometry.patternArea, steps };
}
