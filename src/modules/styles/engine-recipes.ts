import { type DielineEngine } from '@integrations/dieline/dieline-engine.port';

/**
 * ADR-0010 / D-270: a recipe bundle (U3.B1 format) from the vendored `@getpack/dieline` engine — one entry per style base
 * the engine's recipes name, the recipe being the set of those engine recipes (`{ engine: [...] }`), with the processes
 * they need (in the D-244 taxonomy) and the size ranges per material class. Imported like any bundle: recipes wait for
 * Prepress approval (D-243).
 */

/** Engine process names → the seeded process taxonomy (D-244); `die_cut` is flatbed until Prepress says otherwise. */
export const ENGINE_PROCESS: Record<string, string> = {
  die_cut: 'die_cut_flatbed',
  folder_gluer_straight: 'folder_gluer_straight_line',
  folder_gluer_corner: 'folder_gluer_4_6_corner',
};

export interface EngineBundle {
  schemaVersion: string;
  source: string;
  recipes: {
    baseCode: string;
    recipe: { engine: unknown[] };
    processes: string[];
    sizeRanges: Record<string, Record<string, number | null>>;
  }[];
}

export async function engineBundle(engine: DielineEngine): Promise<EngineBundle> {
  const byBase = await engine.recipesByBase();
  const recipes: EngineBundle['recipes'] = [];
  for (const baseCode of Object.keys(byBase).sort()) {
    const stored = { engine: byBase[baseCode]! };
    const facts = await engine.facts(stored);
    const sizeRanges: Record<string, Record<string, number | null>> = {};
    for (const [cls, r] of Object.entries(facts.sizeRanges)) {
      sizeRanges[cls] = {
        minL: r['length']?.min ?? null,
        maxL: r['length']?.max ?? null,
        minW: r['width']?.min ?? null,
        maxW: r['width']?.max ?? null,
        minH: r['height']?.min ?? null,
        maxH: r['height']?.max ?? null,
      };
    }
    recipes.push({
      baseCode,
      recipe: stored,
      processes: [...new Set(facts.processes.map((p) => ENGINE_PROCESS[p] ?? p))].sort(),
      sizeRanges,
    });
  }
  return { schemaVersion: '1.0', source: await engine.version(), recipes };
}
