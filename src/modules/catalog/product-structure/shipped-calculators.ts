import { type CalculatorKey } from '@generated/prisma/client';

/**
 * Calculators ported with golden tests (B2.3). A product type may switch to `instant` only when its
 * calculator is listed here (D-100: "a type moves from RFQ to Instant when its calculator ships").
 * Each B2.3 session adds its key in the same commit as the calculator.
 */
export const SHIPPED_CALCULATORS: ReadonlySet<CalculatorKey> = new Set<CalculatorKey>([]);
