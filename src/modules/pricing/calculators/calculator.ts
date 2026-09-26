import { type CalculatorKey } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

/**
 * A pricing calculator (B2.3): a **pure** function of a typed input, the price-list snapshot of the
 * factory being priced and the sell-side snapshot — no database or clock access inside the maths.
 * The quote engine loads the snapshots and records their version ids (schema-design §2.2).
 */
export interface Calculator<Input, Snapshot, Result> {
  readonly key: CalculatorKey;
  /** Semver of the port, recorded as `calculatorVersion` in every quote snapshot (§3.5). */
  readonly version: string;
  calculate(input: Input, snapshot: Snapshot): Result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous registry
type AnyCalculator = Calculator<any, any, any>;

/**
 * Calculators available to the quote engine, keyed by `calculator_key`. Being registered is not
 * being shipped: a product type goes `instant` only once its key is in `SHIPPED_CALCULATORS`, next
 * to its golden tests (schema-design A-16).
 */
@Injectable()
export class CalculatorRegistry {
  private readonly calculators = new Map<CalculatorKey, AnyCalculator>();

  register(calculator: AnyCalculator): void {
    if (this.calculators.has(calculator.key)) {
      throw new Error(`Calculator already registered: ${calculator.key}`);
    }
    this.calculators.set(calculator.key, calculator);
  }

  has(key: CalculatorKey): boolean {
    return this.calculators.has(key);
  }

  get(key: CalculatorKey): AnyCalculator {
    const calculator = this.calculators.get(key);
    if (!calculator) throw new Error(`No calculator registered for ${key}`);
    return calculator;
  }
}
