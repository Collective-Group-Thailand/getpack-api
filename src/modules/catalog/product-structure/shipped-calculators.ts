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
  // U-B6 label: golden cases test/golden/label (expected values from an independent Python transcription of the PHP),
  // validation docs/pricing-validation-label.md (pending sign-off). The type stays seeded `rfq` (A-16) until the
  // business signs off the cases and the launch factory's label price list (D-100).
  'label',
  // U-B6 tag & sleeve: the folding engine on flat blanks; golden cases test/golden/tag-sleeve (port snapshots over the
  // folding engine's hand-derived vectors), validation docs/pricing-validation-tag-sleeve.md (pending sign-off). The
  // type stays seeded `rfq` (A-16) until the business signs off the cases and the factory's tag price list (D-100).
  'tag_sleeve',
  // U-B6 pouch: golden cases test/golden/pouch (expected values from an independent Python transcription of the PHP),
  // validation docs/pricing-validation-pouch.md (pending sign-off). The type stays seeded `rfq` (A-16) until the
  // business signs off the cases and the factory's pouch price list (D-100).
  'pouch',
]);
