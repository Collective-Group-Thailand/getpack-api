import { GetpackDielineEngine } from '@integrations/dieline/getpack-dieline.engine';

import { engineBundle } from './engine-recipes';
import { parseRecipeBundle } from './recipe-bundle';

/** D-270: the recipe bundle built from the vendored engine imports like any bundle (U3.B1 format). */
describe('engineBundle (ADR-0010, D-270)', () => {
  it('gives one recipe per style base, processes in the taxonomy and size ranges per material class', async () => {
    const bundle = await engineBundle(new GetpackDielineEngine());
    expect(bundle.source).toMatch(/^@getpack\/dieline@/);
    const parsed = parseRecipeBundle(bundle);
    expect(parsed.recipes.length).toBeGreaterThan(10);
    const te = bundle.recipes.find((r) => r.baseCode === 'PK-TE-01')!;
    expect(te.recipe.engine.length).toBeGreaterThan(1);
    expect(te.processes).toContain('die_cut_flatbed');
    expect(te.processes).not.toContain('die_cut');
    expect(te.sizeRanges['paperboard']).toMatchObject({ minL: expect.any(Number), maxH: expect.any(Number) });
  });
});
