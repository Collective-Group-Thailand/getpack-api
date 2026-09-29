import { type CalculatorKey } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';

import { type AnyCalculatorAdapter } from './adapter';

/**
 * A pricing calculator (B2.3): a **pure** function of a typed input, the price-list snapshot of the
 * factory being priced and the sell-side snapshot — no database or clock access inside the maths.
 * The quote engine loads the snapshots through the calculator's adapter (`adapter.ts`) and records
 * their version ids (schema-design §2.2).
 */
export interface Calculator<Input, Snapshot, Result> {
  readonly key: CalculatorKey;
  /** Semver of the port, recorded as `calculatorVersion` in every quote snapshot (§3.5). */
  readonly version: string;
  calculate(input: Input, snapshot: Snapshot): Result;
}

/**
 * Calculator adapters available to the quote engine, keyed by `calculator_key`; each adapter registers
 * itself on module init. Being registered is not being shipped: a product type goes `instant` only
 * once its key is in `SHIPPED_CALCULATORS`, next to its golden tests (schema-design A-16).
 */
@Injectable()
export class CalculatorRegistry {
  private readonly adapters = new Map<CalculatorKey, AnyCalculatorAdapter>();

  register(adapter: AnyCalculatorAdapter): void {
    if (this.adapters.has(adapter.key)) {
      throw new Error(`Calculator already registered: ${adapter.key}`);
    }
    this.adapters.set(adapter.key, adapter);
  }

  has(key: CalculatorKey): boolean {
    return this.adapters.has(key);
  }

  get(key: CalculatorKey): AnyCalculatorAdapter {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new Error(`No calculator registered for ${key}`);
    return adapter;
  }
}
