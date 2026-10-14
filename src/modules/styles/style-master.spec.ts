import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { publishReasons } from './publishability';
import { codeSuffix, MasterFileError, optionKey, parseMaster, variantsOf } from './style-master';

const MASTER = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'docs', 'design-tool', 'style-library-master.json'), 'utf8'),
) as Record<string, unknown> & { styles: Record<string, unknown>[] };

describe('style master file (U3.B1, D-241)', () => {
  const master = parseMaster(MASTER);

  it('generates exactly the 105 bases and 960 variants the file declares', () => {
    expect(master.bases).toHaveLength(105);
    const total = master.bases.reduce((n, b) => n + variantsOf(b, master).length, 0);
    expect(total).toBe(960);
    const te = master.bases.find((b) => b.code === 'PK-TE-01')!;
    expect(variantsOf(te, master)).toHaveLength(228);
  });

  it('keys options in the base axis order, multi-select values sorted and joined, the empty set as none', () => {
    expect(
      optionKey(['tuck_top', 'tuck_bottom', 'hang'], {
        tuck_top: 'reverse_tuck',
        tuck_bottom: 'crash_lock',
        hang: 'none',
      }),
    ).toBe('tuck_top=reverse_tuck;tuck_bottom=crash_lock;hang=none');
    expect(optionKey(['pouch_feat'], { pouch_feat: ['zipper', 'hang_hole'] })).toBe(
      'pouch_feat=hang_hole+zipper',
    );
    expect(optionKey(['pouch_feat'], { pouch_feat: [] })).toBe('pouch_feat=none');
    const pouch = master.bases.find((b) => b.variantAxes.includes('pouch_feat'))!;
    const keys = variantsOf(pouch, master).map((v) => v.optionKey);
    expect(new Set(keys).size).toBe(16);
  });

  it('restricts the tuck pair to the allowed pairs', () => {
    const te = master.bases.find((b) => b.code === 'PK-TE-01')!;
    const pairs = new Set(
      variantsOf(te, master).map(
        (v) => `${String(v.options['tuck_top'])}/${String(v.options['tuck_bottom'])}`,
      ),
    );
    expect(pairs.size).toBe(19);
    expect([...pairs].every((p) => master.allowedTuckPairs.some(([t, b]) => `${t}/${b}` === p))).toBe(true);
  });

  it('derives a stable base-32 suffix, unique within every base at 4 characters for this file', () => {
    expect(codeSuffix('PK-TE-01', 'tuck_top=reverse_tuck')).toBe(
      codeSuffix('PK-TE-01', 'tuck_top=reverse_tuck'),
    );
    expect(codeSuffix('PK-TE-01', 'x')).toMatch(/^[A-Z2-7]{4}$/);
    expect(codeSuffix('PK-TE-01', 'x', 6).startsWith(codeSuffix('PK-TE-01', 'x'))).toBe(true);
    for (const base of master.bases) {
      const suffixes = variantsOf(base, master).map((v) => codeSuffix(base.code, v.optionKey));
      expect(new Set(suffixes).size).toBe(suffixes.length);
    }
  });

  it('refuses a file whose counts do not match, an unknown axis or a bad code', () => {
    const broken = structuredClone(MASTER);
    broken.styles[0]!['distinct_variants'] = 5;
    expect(() => parseMaster(broken)).toThrow(MasterFileError);
    const axis = structuredClone(MASTER);
    axis.styles[0]!['variant_axes'] = 'tuck_top;tuck_bottom;colour';
    expect(() => parseMaster(axis)).toThrow(/unknown axis colour/);
    const code = structuredClone(MASTER);
    code.styles[0]!['code'] = 'TE-01';
    expect(() => parseMaster(code)).toThrow(/PK-<FAMILY>-<NN>/);
  });
});

describe('publishability gates (D-243)', () => {
  const ok = {
    baseStatus: 'active' as const,
    variantStatus: 'active' as const,
    hidden: false,
    productTypeActive: true,
    recipes: [{ approved: true }],
    namesApproved: { marketing: true, prepress: true },
    drawable: null,
  };

  it('publishes only when every gate passes, and names each unmet gate', () => {
    expect(publishReasons(ok)).toEqual([]);
    expect(publishReasons({ ...ok, recipes: [] })).toEqual(['no_recipe']);
    expect(publishReasons({ ...ok, drawable: true })).toEqual([]);
    expect(publishReasons({ ...ok, drawable: false })).toEqual(['not_drawable']);
    expect(publishReasons({ ...ok, recipes: [{ approved: false }] })).toEqual(['recipe_not_approved']);
    expect(publishReasons({ ...ok, namesApproved: { marketing: true, prepress: false } })).toEqual([
      'names_not_approved',
    ]);
    expect(
      publishReasons({
        ...ok,
        hidden: true,
        productTypeActive: false,
        variantStatus: 'retired',
      }),
    ).toEqual(['retired', 'hidden', 'no_product_type']);
  });
});
