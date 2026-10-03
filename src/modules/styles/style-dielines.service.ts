import { type Tx } from '@database/prisma.service';
import {
  DIELINE_ENGINE,
  type DielineEngine,
  type DielineMaterial,
  type DielineQuantities,
  type StoredRecipe,
} from '@integrations/dieline/dieline-engine.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';

/** The engine's material kind for a catalogue material (ADR-0010). */
const ENGINE_KIND: Record<string, string> = {
  paper: 'paper',
  board: 'paperboard',
  corrugated_board: 'corrugated',
  label_stock: 'label',
  film: 'flexible',
};

export interface FrozenQuantities {
  engineVersion: string;
  variantCode: string;
  recipeVersion: number;
  sizes: Record<string, number>;
  quantities: DielineQuantities;
  /** Rules the size breaks (engine codes), empty when it builds cleanly. */
  violations: string[];
  /** D-267: verified partner capabilities whose blank envelope fits this blank (either way round). */
  partnersFitting: number;
}

/**
 * D-267 dieline-derived quantities of a quote naming a style variant: the variant's approved recipe built by the engine
 * (ADR-0010) at the size priced and on the configuration's material, frozen on the quote. They change no price until a
 * calculator's validation is signed with them (`pricing.dieline_quantities`), and give the blank-size fit count of
 * makeability (D-244). Best effort: no engine, no recipe or no caliper → nothing frozen.
 */
@Injectable()
export class StyleDielinesService {
  private readonly logger = new Logger(StyleDielinesService.name);

  constructor(
    @Inject(DIELINE_ENGINE) private readonly engine: DielineEngine,
    private readonly flags: FeatureFlagsService,
  ) {}

  async ready(): Promise<boolean> {
    return (await this.flags.isEnabled('drawing.engine')) && (await this.engine.available());
  }

  async quantitiesFor(
    db: Tx,
    configuration: Record<string, unknown>,
    sizes: { l: number; w: number; d: number } | null,
  ): Promise<FrozenQuantities | null> {
    const code = configuration['styleVariantCode'];
    if (typeof code !== 'string' || !sizes || !(await this.ready())) return null;
    const variant = await db.styleVariant.findUnique({
      where: { code },
      select: {
        options: true,
        base: {
          select: {
            materialClass: true,
            recipes: {
              where: { approvedAt: { not: null } },
              orderBy: { version: 'desc' },
              take: 1,
              select: { version: true, recipe: true, processes: true },
            },
          },
        },
      },
    });
    const recipe = variant?.base.recipes[0];
    if (!variant || !recipe) return null;
    const material = await this.material(db, configuration['materialId']);
    if (!material) return null;
    const engineSizes = { length: sizes.l, width: sizes.w, height: sizes.d };
    try {
      const built = await this.engine.build(
        {
          recipe: recipe.recipe as unknown as StoredRecipe,
          options: variant.options as Record<string, unknown>,
          sizes: engineSizes,
          material,
        },
        [],
      );
      return {
        engineVersion: built.engineVersion,
        variantCode: code,
        recipeVersion: recipe.version,
        sizes: engineSizes,
        quantities: built.quantities,
        violations: built.violations.map((v) => v.code),
        partnersFitting: await this.partnersFitting(
          db,
          recipe.processes,
          variant.base.materialClass,
          built.quantities,
        ),
      };
    } catch (error) {
      this.logger.warn(`dieline quantities of ${code}: ${(error as Error).message}`);
      return null;
    }
  }

  private async material(db: Tx, materialPublicId: unknown): Promise<DielineMaterial | null> {
    if (typeof materialPublicId !== 'string') return null;
    const m = await db.material.findUnique({
      where: { publicId: materialPublicId },
      select: { kind: true, caliperMm: true },
    });
    if (!m?.caliperMm || !ENGINE_KIND[m.kind]) return null;
    return { kind: ENGINE_KIND[m.kind]!, caliperMm: Number(m.caliperMm) };
  }

  /** Verified capabilities of active factories, for every process the recipe needs, whose blank envelope fits. */
  private async partnersFitting(
    db: Tx,
    processes: string[],
    materialClass: string | null,
    q: DielineQuantities,
  ): Promise<number> {
    if (processes.length === 0) return 0;
    const rows = await db.factoryProcessCapability.findMany({
      where: {
        status: 'verified',
        factory: { status: 'active' },
        processType: { code: { in: processes } },
        ...(materialClass ? { materialClass } : {}),
      },
      select: {
        factoryId: true,
        processType: { select: { code: true } },
        minBlankWMm: true,
        maxBlankWMm: true,
        minBlankLMm: true,
        maxBlankLMm: true,
      },
    });
    const fits = (r: (typeof rows)[number], w: number, l: number) =>
      (r.minBlankWMm === null || w >= Number(r.minBlankWMm)) &&
      (r.maxBlankWMm === null || w <= Number(r.maxBlankWMm)) &&
      (r.minBlankLMm === null || l >= Number(r.minBlankLMm)) &&
      (r.maxBlankLMm === null || l <= Number(r.maxBlankLMm));
    const byFactory = new Map<bigint, Set<string>>();
    for (const r of rows) {
      if (!fits(r, q.blankWidthMm, q.blankHeightMm) && !fits(r, q.blankHeightMm, q.blankWidthMm)) continue;
      const set = byFactory.get(r.factoryId) ?? new Set<string>();
      set.add(r.processType.code);
      byFactory.set(r.factoryId, set);
    }
    return [...byFactory.values()].filter((set) => processes.every((p) => set.has(p))).length;
  }
}
