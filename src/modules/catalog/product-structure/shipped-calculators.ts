import { type CalculatorKey } from '@generated/prisma/client';

/**
 * Calculators ported with golden tests (B2.3). A product type may switch to `instant` only when its
 * calculator is listed here (D-100: "a type moves from RFQ to Instant when its calculator ships").
 * Each B2.3 session adds its key in the same commit as the calculator.
 */
export const SHIPPED_CALCULATORS: ReadonlySet<CalculatorKey> = new Set<CalculatorKey>([
  // B2.3: golden cases test/golden/folding, validation docs/pricing-validation-folding.md (pending sign-off).
  'folding',
  // U-B6: golden cases test/golden/corrugate (expected values from an independent transcription of the PHP),
  // validation docs/pricing-validation-corrugate.md (signed off 2026-09-30). The type stays seeded `rfq` (A-16)
  // until the business switches it to instant (D-100).
  'corrugate',
]);
