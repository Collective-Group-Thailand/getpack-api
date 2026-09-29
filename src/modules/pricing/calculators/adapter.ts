import { type Tx } from '@database/prisma.service';
import { type CalculatorKey, type Prisma } from '@generated/prisma/client';
import { type ShipmentPart } from '@modules/shipping/shipping-quote.service';

import { type PricingError } from './shared/pricing-error';

/**
 * What the quote engine needs from a calculator port (B2.3, U-B6): turning an API configuration into
 * calculator parts against the catalogue, loading one option per factory × print type from a price-list
 * version, the pure calculation, the shipment to pack (B2.4) and the calculate-log summary (B6). The
 * engine owns everything shared — price paths (D-043), delivery, capacity (D-101), tolerance (D-021),
 * the margin floor (D-012) and the log — so a new calculator adds an adapter, not a new engine.
 */

/** The part of a resolved configuration the engine reads; each calculator adds its own fields. */
export interface ResolvedBase {
  productTypeId: bigint;
  catalogProductId: bigint | null;
  quantities: readonly number[];
}

/** The part of a loaded option the engine reads (snapshot references and identities). */
export interface LoadedOptionBase {
  optionKey: string;
  /** Factory public id. */
  factoryId: string;
  printTypePublicId: string;
  priceListVersionId: bigint;
  priceListVersionPublicId: string;
  sellMarginVersionIds: bigint[];
  vatRateVersionId: bigint;
}

/** One part of a priced step, in the engine's terms (staff and factory views). */
export interface PricedPart {
  partKey: string;
  /** The factory's price for the part's lot (D-042). */
  buyPrice: number;
  /** The factory's cost build-up before its margin (factory view only, D-044). */
  totalCost: number;
  /** Blanks per sheet / roll width lay-out. */
  layoutAmount: number;
  /** Sheets run, waste included — capacity in `sheets`. */
  sheets: number;
  layoutStandard: boolean;
  /** Blank area of one piece, m² — capacity in `sqm`. */
  blankAreaSqm: number;
}

/** One quantity of one option, VAT-inclusive customer amounts as the calculators produce them. */
export interface PricedStep {
  qty: number;
  /** The run the factory produces (minimum production run applied). */
  productionRun: number;
  buyPrice: number;
  /** Packio's margin on the quote net of VAT (D-012 floor check). */
  marginPct: number;
  leadTimeDays: number;
  unitPrice: number;
  productAmount: number;
  designFee: number;
  structureDesignFee: number;
  /** Print plates and die blocks charged apart, VAT included (corrugate flexo; 0 otherwise). */
  toolingAmount: number;
  vatAmount: number;
  /** Customer price, VAT included, shipping excluded (its own line, D-013). */
  total: number;
  parts: PricedPart[];
}

export interface PricedOption {
  optionKey: string;
  /** Factory public id. */
  factoryId: string;
  printTypeId: string;
  steps: (PricedStep | null)[];
  error: { code: PricingError['code']; detail: string } | null;
}

/** The `calculate_logs` columns that depend on the configuration (B6, no PII). */
export interface CalculationLogInput {
  quantities: number[];
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  input: Prisma.InputJsonValue;
  inputSchemaVersion: number;
}

export interface CalculatorAdapter<
  Cfg = unknown,
  Resolved extends ResolvedBase = ResolvedBase,
  Loaded extends LoadedOptionBase = LoadedOptionBase,
> {
  readonly key: CalculatorKey;
  /** Semver of the port, recorded as `calculatorVersion` in every quote snapshot (§3.5). */
  readonly version: string;
  /** Validates the configuration against the active catalogue (422 `validation.failed`). */
  resolve(cfg: Cfg, db: Tx): Promise<Resolved>;
  /** One option per print type the factory's price-list version has terms for. */
  options(
    factory: { id: bigint; publicId: string },
    priceListVersionId: bigint,
    resolved: Resolved,
    at: Date,
    db: Tx,
  ): Promise<Loaded[]>;
  /** Pure: no database or clock. `withDesign` false prices the factory side only. */
  calculate(resolved: Resolved, loaded: readonly Loaded[], opts: { withDesign: boolean }): PricedOption[];
  shipmentParts(resolved: Resolved): ShipmentPart[];
  logInput(cfg: Cfg): CalculationLogInput;
  /** The configuration asked at other quantities (re-pricing, factory margin checks). */
  withQuantities(cfg: Cfg, quantities: readonly number[]): Cfg;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry
export type AnyCalculatorAdapter = CalculatorAdapter<any, any, any>;
