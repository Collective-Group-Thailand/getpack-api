import { type Calculator } from '../calculator';
import { type PricedLayout } from './a/cost';
import { type DigitalPricedLayout } from './a/digital';
import { priceDigitalPart, priceOffsetPart } from './a/engine';
import { type GeometryInput, type GeometrySnapshot } from './geometry/types';
import { type PartRequest, PricingError, type ProcessExclusion } from './request';
import { type ForSale, saleMargin, type SellSnapshot } from './sell';
import { type DigitalTables, type OffsetTables } from './tables';

/**
 * The folding calculator (B2.3): legacy `FoldingCalculator::calculate_cs` (`app/Models/FoldingCalculator.php:874-1240`)
 * as a pure function. Each option is one factory × print type: every part is priced by its engine, the
 * cheapest layout per quantity is kept, Packio's sell side is applied per part and the design fees once
 * per quote (quirk Q2). An option is complete for a quantity only when every part is (quirk Q1 fixed:
 * legacy mixed print types across parts). Selection follows D-043/D-101: lowest buy price, then lead time.
 */

export const FOLDING_CALCULATOR_VERSION = '1.0.0';

export type FoldingEngine = 'a_offset' | 'a_digital' | 'b';

export interface FoldingPart {
  key: string;
  geometry: Omit<GeometryInput, 'boxAmounts' | 'quantities'>;
  request: PartRequest;
}

export interface FoldingInput {
  quantities: readonly number[];
  parts: readonly FoldingPart[];
  design: { graphic: boolean; structure: boolean };
}

export interface FoldingOption {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  engine: FoldingEngine;
  /** Legacy `factory_match_print_type.lead_time`, rounded up (`FoldingCalculator.php:1162-1163`). */
  leadTimeDays: number | null;
  /** From this quantity the lead time is `days` (legacy factories 9 and 16, `getCustomLeadTime`). */
  bulkLeadTime: { minQty: number; days: number } | null;
  minOrderForProduction: number | null;
  tables: OffsetTables | DigitalTables;
  parts: Readonly<Record<string, { geometry: GeometrySnapshot; exclusions: readonly ProcessExclusion[] }>>;
  sell: SellSnapshot;
  /**
   * Carrier cost before VAT per part and quantity (B2.4, D-013); legacy prices each part's cartons
   * (`Calculator.php:335-359`). Absent = shipping not priced yet.
   */
  shippingCosts?: Readonly<Record<string, readonly number[]>>;
}

export interface FoldingSnapshot {
  options: readonly FoldingOption[];
}

export interface PartStep {
  partKey: string;
  layout: PricedLayout | DigitalPricedLayout;
  /** The factory's price for the part's lot (legacy `margin.salePrice`), part of the buy price (D-042). */
  buyPrice: number;
  forSale: ForSale;
}

export interface OptionStep {
  qty: number;
  boxAmount: number;
  parts: PartStep[];
  buyPrice: number;
  perPcs: number;
  perPcsWithDelivery: number;
  sum: number;
  deliveryPrice: number;
  vatPrice: number;
  designFee: number;
  structureDesignFee: number;
  /** Customer price, VAT included (legacy `summary.total`). */
  total: number;
  leadTimeDays: number;
  /** Packio's margin on the quote net of VAT: (net − buy price) ÷ net (D-012 floor check). */
  marginPct: number;
  shippingPriced: boolean;
}

export interface OptionResult {
  optionKey: string;
  factoryId: string;
  printTypeId: string;
  steps: (OptionStep | null)[];
  error: { code: PricingError['code']; detail: string } | null;
}

export interface FoldingResult {
  options: OptionResult[];
  /** Selected option per quantity (null = no instant price for that quantity). */
  selection: (string | null)[];
}

type PartLayouts = { boxAmount: number; layouts: (PricedLayout | DigitalPricedLayout)[] }[];

function priceParts(input: FoldingInput, option: FoldingOption): Map<string, PartLayouts> {
  if (option.engine === 'b') {
    // Legacy prices type-B factories only in the factory tools (`FoldingCalculator.php:414`); engine B is
    // not ported (PROGRESS, B2.3 slice 6), so a B print type is no instant price path.
    throw new PricingError('process_not_possible', 'engine B is not available for instant quotes');
  }
  const byPart = new Map<string, PartLayouts>();
  for (const part of input.parts) {
    const partSnapshot = option.parts[part.key];
    if (!partSnapshot) throw new PricingError('process_not_possible', `part ${part.key} not offered`);
    const snapshot = {
      geometry: partSnapshot.geometry,
      exclusions: partSnapshot.exclusions,
      minOrderForProduction: option.minOrderForProduction,
    };
    const partInput = { geometry: part.geometry, quantities: input.quantities, request: part.request };
    const result =
      option.engine === 'a_digital'
        ? priceDigitalPart(partInput, { ...snapshot, tables: option.tables as DigitalTables })
        : priceOffsetPart(partInput, { ...snapshot, tables: option.tables as OffsetTables });
    byPart.set(part.key, result.steps);
  }
  return byPart;
}

function leadTime(option: FoldingOption, qty: number): number {
  const base = Math.ceil(option.leadTimeDays ?? 0);
  return option.bulkLeadTime && qty >= option.bulkLeadTime.minQty ? option.bulkLeadTime.days : base;
}

function optionResult(input: FoldingInput, option: FoldingOption): OptionResult {
  const head = { optionKey: option.optionKey, factoryId: option.factoryId, printTypeId: option.printTypeId };
  let byPart: Map<string, PartLayouts>;
  try {
    byPart = priceParts(input, option);
  } catch (error) {
    if (error instanceof PricingError) {
      return {
        ...head,
        steps: input.quantities.map(() => null),
        error: { code: error.code, detail: error.detail },
      };
    }
    throw error;
  }
  const vatInclude = (100 + option.sell.vatPct) / 100;
  const steps = input.quantities.map((qty, index): OptionStep | null => {
    const parts: PartStep[] = [];
    for (const part of input.parts) {
      const step = byPart.get(part.key)![index]!;
      const layout = step.layouts[0];
      if (!layout) return null;
      const buyPrice = layout.margin.salePrice;
      const shipping = option.shippingCosts?.[part.key]?.[index] ?? 0;
      const forSale = saleMargin(option.sell, buyPrice, qty, step.boxAmount, shipping);
      parts.push({ partKey: part.key, layout, buyPrice, forSale });
    }
    const sum = (f: (p: PartStep) => number) => parts.reduce((a, p) => a + f(p), 0);
    const designFee = input.design.graphic ? (option.sell.designFee ?? 0) : 0;
    const structureDesignFee = input.design.structure ? (option.sell.structureDesignFee ?? 0) : 0;
    const total = sum((p) => p.forSale.total) + designFee + structureDesignFee;
    const buyPrice = sum((p) => p.buyPrice);
    const net = total / vatInclude;
    return {
      qty,
      boxAmount: byPart.get(input.parts[0]!.key)![index]!.boxAmount,
      parts,
      buyPrice,
      perPcs: sum((p) => p.forSale.perPcs),
      perPcsWithDelivery: sum((p) => p.forSale.perPcsWithDelivery),
      sum: sum((p) => p.forSale.sum),
      deliveryPrice: sum((p) => p.forSale.deliveryPrice),
      vatPrice: sum((p) => p.forSale.vatPrice),
      designFee,
      structureDesignFee,
      total,
      leadTimeDays: leadTime(option, qty),
      marginPct: net > 0 ? ((net - buyPrice) / net) * 100 : 0,
      shippingPriced: option.shippingCosts !== undefined,
    };
  });
  return { ...head, steps, error: null };
}

/** Lowest buy price, then shortest lead time, then option order (D-043, D-101). */
function select(options: OptionResult[], index: number): string | null {
  let best: { key: string; step: OptionStep } | null = null;
  for (const o of options) {
    const step = o.steps[index];
    if (!step) continue;
    if (
      !best ||
      step.buyPrice < best.step.buyPrice ||
      (step.buyPrice === best.step.buyPrice && step.leadTimeDays < best.step.leadTimeDays)
    ) {
      best = { key: o.optionKey, step };
    }
  }
  return best?.key ?? null;
}

export const foldingCalculator: Calculator<FoldingInput, FoldingSnapshot, FoldingResult> = {
  key: 'folding',
  version: FOLDING_CALCULATOR_VERSION,
  calculate(input, snapshot) {
    const options = snapshot.options.map((o) => optionResult(input, o));
    return { options, selection: input.quantities.map((_, i) => select(options, i)) };
  },
};
