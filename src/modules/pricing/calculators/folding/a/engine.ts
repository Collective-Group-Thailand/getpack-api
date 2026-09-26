import { calculateGeometry } from '../geometry/pattern-area';
import {
  GeometryError,
  type GeometryInput,
  type GeometrySnapshot,
  type PatternArea,
} from '../geometry/types';
import { excludedProcess, type PartRequest, PricingError, type ProcessExclusion } from '../request';
import { type DigitalTables, type OffsetTables } from '../tables';
import { type PricedLayout, priceLayout, sortPricedLayouts } from './cost';
import { type DigitalPricedLayout, priceDigitalLayout, sortDigitalLayouts } from './digital';
import { layoutWaste } from './waste';

/**
 * Engine A offset for one part at one factory and print type (legacy `FoldingCalculator::calculate:1293`
 * with `A/CalculateWaste` and `A/CalculateCost`): minimum order, layouts, waste and cost per quantity.
 */

export interface OffsetPartInput {
  geometry: Omit<GeometryInput, 'boxAmounts' | 'quantities'>;
  /** Quantities the customer asked for (legacy `arrayBoxAmount`). */
  quantities: readonly number[];
  request: PartRequest;
}

export interface OffsetPartSnapshot {
  geometry: GeometrySnapshot;
  tables: OffsetTables;
  exclusions: readonly ProcessExclusion[];
  /** Legacy `factory_match_print_type.min_order_for_production`: smaller runs are produced at this size. */
  minOrderForProduction: number | null;
}

export interface OffsetStep {
  qty: number;
  /** The run produced and costed (legacy `box_amount`). */
  boxAmount: number;
  /** Priced layouts, cheapest first; empty when no layout can be priced. */
  layouts: PricedLayout[];
}

export interface OffsetPartResult {
  patternArea: PatternArea;
  steps: OffsetStep[];
}

/** Legacy raises a run below the production minimum to it and keeps the asked quantity (`:1311-1318`). */
export function productionRuns(
  quantities: readonly number[],
  minOrderForProduction: number | null,
): number[] {
  const min = minOrderForProduction === null ? 0 : Math.trunc(minOrderForProduction);
  return quantities.map((q) => (min > q ? min : q));
}

export function priceOffsetPart(input: OffsetPartInput, snapshot: OffsetPartSnapshot): OffsetPartResult {
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
    const priced: PricedLayout[] = [];
    for (const layout of candidates) {
      const waste = layoutWaste('offset', input.request, layout, snapshot.tables);
      const result = priceLayout(input.request, layout, waste, snapshot.tables);
      if (result) priced.push(result);
    }
    return {
      qty: input.quantities[index]!,
      boxAmount: boxAmounts[index]!,
      layouts: sortPricedLayouts(priced),
    };
  });
  return { patternArea: geometry.patternArea, steps };
}

export interface DigitalPartSnapshot extends Omit<OffsetPartSnapshot, 'tables'> {
  tables: DigitalTables;
}

export interface DigitalPartResult {
  patternArea: PatternArea;
  steps: { qty: number; boxAmount: number; layouts: DigitalPricedLayout[] }[];
}

/** Engine A digital for one part: the same layouts and waste as offset, digital cost (`:1349`). */
export function priceDigitalPart(input: OffsetPartInput, snapshot: DigitalPartSnapshot): DigitalPartResult {
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
    const priced: DigitalPricedLayout[] = [];
    for (const layout of candidates) {
      const waste = layoutWaste('digital', input.request, layout, snapshot.tables);
      const result = priceDigitalLayout(input.request, layout, waste, snapshot.tables);
      if (result) priced.push(result);
    }
    return {
      qty: input.quantities[index]!,
      boxAmount: boxAmounts[index]!,
      layouts: sortDigitalLayouts(priced),
    };
  });
  return { patternArea: geometry.patternArea, steps };
}
