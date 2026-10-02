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
