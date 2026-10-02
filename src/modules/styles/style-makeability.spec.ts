import { capableFactories, type MakeabilityQuery, required } from './style-makeability.service';

const RULES = [
  { scope: 'category', scopeValue: 'folding_carton', process: 'die_cut_flatbed' },
  { scope: 'category', scopeValue: 'folding_carton', process: 'folder_gluer_straight_line' },
  { scope: 'option', scopeValue: 'tuck_bottom:crash_lock', process: 'folder_gluer_crash_lock' },
  { scope: 'option', scopeValue: 'pouch_feat:window', process: 'window_patching' },
  { scope: 'source_product_type', scopeValue: 'rigid', process: 'rigid_box_line' },
];
const cap = (factoryId: bigint, process: string, materialClass = 'paperboard') => ({
  factoryId,
  process,
  materialClass,
  leadTimeMinDays: 5,
  leadTimeMaxDays: 9,
});
const variant = (over: Partial<MakeabilityQuery> = {}): MakeabilityQuery => ({
  variantId: 1n,
  baseId: 1n,
  sourceProductType: 'folding',
  category: 'folding_carton',
  family: 'tuck_end',
  materialClass: 'paperboard',
  options: { tuck_top: 'straight_tuck', tuck_bottom: 'tuck' },
  recipeProcesses: [],
  ...over,
});

describe('style makeability (D-244)', () => {
  it('needs the processes of every matching rule, or the recipe’s own when it declares them', () => {
    expect(required(variant(), RULES)).toEqual(['die_cut_flatbed', 'folder_gluer_straight_line']);
    expect(required(variant({ options: { tuck_bottom: 'crash_lock' } }), RULES)).toContain(
      'folder_gluer_crash_lock',
    );
    expect(required(variant({ options: { pouch_feat: ['window', 'zipper'] } }), RULES)).toContain(
      'window_patching',
    );
    expect(required(variant({ recipeProcesses: ['slotter'] }), RULES)).toEqual(['slotter']);
  });

  it('makes a variant only at an active factory holding every process in the material class', () => {
    const caps = [
      cap(7n, 'die_cut_flatbed'),
      cap(7n, 'folder_gluer_straight_line'),
      cap(8n, 'die_cut_flatbed'),
    ];
    expect(capableFactories(variant(), RULES, caps)).toEqual([7n]);
    expect(capableFactories(variant({ options: { tuck_bottom: 'crash_lock' } }), RULES, caps)).toEqual([]);
    expect(capableFactories(variant({ materialClass: 'food_board' }), RULES, caps)).toEqual([]);
  });

  it('fails closed: a variant needing no known process is not makeable', () => {
    const v = variant({ sourceProductType: 'mailer', category: 'flexible', family: 'mailer', options: {} });
    expect(required(v, RULES)).toEqual([]);
    expect(capableFactories(v, RULES, [cap(7n, 'die_cut_flatbed')])).toEqual([]);
  });
});
