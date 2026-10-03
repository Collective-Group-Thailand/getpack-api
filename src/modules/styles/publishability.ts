/**
 * D-243 publishability gates of a style variant — pure, so the nightly job, an import and a curation change all reach
 * the same answer. Every unmet gate is a reason code; a variant is publishable only with none.
 */

export const PUBLISH_REASONS = [
  'retired',
  'hidden',
  'wave_not_open',
  'no_product_type',
  'no_recipe',
  'recipe_not_approved',
  'names_not_approved',
  'not_makeable',
] as const;
export type PublishReason = (typeof PUBLISH_REASONS)[number];

export interface GateInput {
  baseStatus: 'active' | 'retired';
  variantStatus: 'active' | 'retired';
  hidden: boolean;
  wave: number;
  publishedWave: number;
  /** An active Packio product type: instant calculator or RFQ, both a pricing path (D-100). */
  productTypeActive: boolean;
  recipes: { approved: boolean }[];
  namesApproved: { marketing: boolean; prepress: boolean };
  makeable: boolean;
}

export function publishReasons(g: GateInput): PublishReason[] {
  const reasons: PublishReason[] = [];
  if (g.baseStatus === 'retired' || g.variantStatus === 'retired') reasons.push('retired');
  if (g.hidden) reasons.push('hidden');
  if (g.wave > g.publishedWave) reasons.push('wave_not_open');
  if (!g.productTypeActive) reasons.push('no_product_type');
  if (g.recipes.length === 0) reasons.push('no_recipe');
  else if (!g.recipes.some((r) => r.approved)) reasons.push('recipe_not_approved');
  if (!g.namesApproved.marketing || !g.namesApproved.prepress) reasons.push('names_not_approved');
  if (!g.makeable) reasons.push('not_makeable');
  return reasons;
}

export const PRICE_REASONS = ['no_calculator', 'calculator_not_signed', 'option_not_priced'] as const;
export type PriceReason = (typeof PRICE_REASONS)[number];

export interface PriceInput {
  /** The Packio product type's calculator (null: an RFQ-only type, D-100). */
  calculatorKey: string | null;
  /** The type is switched to instant — the Pricing owner's sign-off switch (A-16). */
  instantType: boolean;
  /** The variant's options (`axis → value`; a multi-select is an array). */
  options: Record<string, unknown>;
  /** Active option price rules of the calculator, as `axis:value`. */
  rules: ReadonlySet<string>;
}

/** The option values of a variant as `axis:value`; `none` (no feature) never needs a rule (assumption U3 (7)). */
export function optionValues(options: Record<string, unknown>): string[] {
  return Object.entries(options).flatMap(([axis, v]) =>
    (Array.isArray(v) ? (v as unknown[]).map(String) : [String(v)])
      .filter((value) => value !== '' && value !== 'none')
      .map((value) => `${axis}:${value}`),
  );
}

/**
 * D-266 the price path of a variant: instant only with a calculator, its type switched to instant and every option
 * value covered by a price rule (D-268); otherwise RFQ with the reasons.
 */
export function pricePath(p: PriceInput): { path: 'instant' | 'rfq'; reasons: PriceReason[] } {
  const reasons: PriceReason[] = [];
  if (!p.calculatorKey) reasons.push('no_calculator');
  else if (!p.instantType) reasons.push('calculator_not_signed');
  if (p.calculatorKey && optionValues(p.options).some((v) => !p.rules.has(v)))
    reasons.push('option_not_priced');
  return { path: reasons.length === 0 ? 'instant' : 'rfq', reasons };
}
