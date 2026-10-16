/**
 * D-243 publishability gates of a style variant — pure, so the nightly job, an import and a curation change all reach
 * the same answer. Every unmet gate is a reason code; a variant is publishable only with none.
 *
 * D-407: publishable means a customer can see and design it — the structure is drawn and checked (an approved recipe),
 * named, and belongs to an active product type. Whether a factory can make it decides how it is ordered (instant or a
 * quotation request, `pricePath`), no longer whether it is shown; the launch waves no longer gate it either.
 * `wave_not_open` and `not_makeable` stay in the value set for rows evaluated before D-407.
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
  'not_drawable',
] as const;
export type PublishReason = (typeof PUBLISH_REASONS)[number];

export interface GateInput {
  baseStatus: 'active' | 'retired';
  variantStatus: 'active' | 'retired';
  hidden: boolean;
  /** An active getpack product type: instant calculator or RFQ, both a pricing path (D-100). */
  productTypeActive: boolean;
  recipes: { approved: boolean }[];
  namesApproved: { marketing: boolean; prepress: boolean };
  /** D-407: the approved recipe draws exactly these options (null: not known, e.g. a recipe outside the engine). */
  drawable: boolean | null;
}

export function publishReasons(g: GateInput): PublishReason[] {
  const reasons: PublishReason[] = [];
  if (g.baseStatus === 'retired' || g.variantStatus === 'retired') reasons.push('retired');
  if (g.hidden) reasons.push('hidden');
  if (!g.productTypeActive) reasons.push('no_product_type');
  if (g.recipes.length === 0) reasons.push('no_recipe');
  else if (!g.recipes.some((r) => r.approved)) reasons.push('recipe_not_approved');
  if (!g.namesApproved.marketing || !g.namesApproved.prepress) reasons.push('names_not_approved');
  if (g.drawable === false) reasons.push('not_drawable');
  return reasons;
}

export const PRICE_REASONS = [
  'no_calculator',
  'calculator_not_signed',
  'option_not_priced',
  'not_makeable',
] as const;
export type PriceReason = (typeof PRICE_REASONS)[number];

export interface PriceInput {
  /** The getpack product type's calculator (null: an RFQ-only type, D-100). */
  calculatorKey: string | null;
  /** The type is switched to instant — the Pricing owner's sign-off switch (A-16). */
  instantType: boolean;
  /** The variant's options (`axis → value`; a multi-select is an array). */
  options: Record<string, unknown>;
  /** Active option price rules of the calculator, as `axis:value`. */
  rules: ReadonlySet<string>;
  /** D-407: some active factory has every process it needs, verified (D-245). */
  makeable: boolean;
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
 * D-266 the price path of a variant: instant only with a calculator, its type switched to instant, every option
 * value covered by a price rule (D-268) and a factory able to make it (D-407); otherwise RFQ with the reasons.
 */
export function pricePath(p: PriceInput): { path: 'instant' | 'rfq'; reasons: PriceReason[] } {
  const reasons: PriceReason[] = [];
  if (!p.calculatorKey) reasons.push('no_calculator');
  else if (!p.instantType) reasons.push('calculator_not_signed');
  if (p.calculatorKey && optionValues(p.options).some((v) => !p.rules.has(v)))
    reasons.push('option_not_priced');
  if (!p.makeable) reasons.push('not_makeable');
  return { path: reasons.length === 0 ? 'instant' : 'rfq', reasons };
}

/** A variant's options as the engine names them: a multi-select joined sorted with `+`, empty as `none`. */
export function optionKeyMap(options: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(options).map(([axis, v]) => [
      axis,
      Array.isArray(v) ? (v as unknown[]).map(String).sort().join('+') || 'none' : String(v),
    ]),
  );
}

/**
 * D-407: whether one of the engine variants is exactly this variant — every option the same value (an axis the engine
 * variant does not carry never matches), as the storefront's 3D view and the drawing service pick it.
 */
export function drawableBy(
  options: Record<string, unknown>,
  engineVariants: Record<string, string>[],
): boolean {
  const wanted = Object.entries(optionKeyMap(options));
  return engineVariants.some((axes) => wanted.every(([axis, value]) => axes[axis] === value));
}
