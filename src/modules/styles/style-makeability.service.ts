import { type PrismaService, type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

export interface MakeabilityQuery {
  variantId: bigint;
  baseId: bigint;
  sourceProductType: string;
  category: string;
  family: string;
  materialClass: string;
  options: Record<string, unknown>;
  /** Processes the base's approved recipe declares (empty = use the process rules). */
  recipeProcesses: string[];
}

/** A factory able to make a base, with the lead-time band of the processes it needs (staff only, D-050). */
export interface CapableFactory {
  factoryId: bigint;
  leadTime: { minDays: number; maxDays: number } | null;
}

interface Rule {
  scope: string;
  scopeValue: string;
  process: string;
}

interface Capability {
  factoryId: bigint;
  process: string;
  materialClass: string;
  leadTimeMinDays: number;
  leadTimeMaxDays: number;
}

/**
 * Which variants at least one active partner can make (D-243, D-244): the processes a variant needs come from its
 * approved recipe when it declares them, otherwise from the style process rules matching its master product type,
 * category, family and option values; a variant needing no known process is **not** makeable (fail closed). A factory
 * makes it when it is active and holds a **verified** capability for every needed process in the base's material
 * class. Blank-size fit joins when the drawing engine yields blanks (U3.B4/B5, D-244).
 */
@Injectable()
export class StyleMakeabilityService {
  async makeable(db: Tx | PrismaService, variants: MakeabilityQuery[]): Promise<Map<bigint, boolean>> {
    if (variants.length === 0) return new Map();
    const { rules, capabilities } = await this.load(db);
    return new Map(variants.map((v) => [v.variantId, capableFactories(v, rules, capabilities).length > 0]));
  }

  /** The processes a variant needs (for coverage reports). */
  async requiredProcesses(
    db: Tx | PrismaService,
    variants: MakeabilityQuery[],
  ): Promise<Map<bigint, string[]>> {
    const { rules } = await this.load(db, { capabilities: false });
    return new Map(variants.map((v) => [v.variantId, required(v, rules)]));
  }

  /** The active factories able to make at least one publishable variant of the base, with their lead-time bands. */
  async factoriesFor(db: Tx | PrismaService, baseId: bigint): Promise<CapableFactory[]> {
    const base = await db.styleBase.findUnique({
      where: { id: baseId },
      include: {
        variants: { where: { publishable: true, status: 'active' }, select: { id: true, options: true } },
        recipes: {
          where: { approvedAt: { not: null } },
          orderBy: { version: 'desc' },
          take: 1,
          select: { processes: true },
        },
      },
    });
    if (!base || base.variants.length === 0) return [];
    const { rules, capabilities } = await this.load(db);
    const bands = new Map<bigint, { minDays: number; maxDays: number }>();
    for (const v of base.variants) {
      const query: MakeabilityQuery = {
        variantId: v.id,
        baseId: base.id,
        sourceProductType: base.sourceProductType,
        category: base.category,
        family: base.family,
        materialClass: base.materialClass,
        options: v.options as Record<string, unknown>,
        recipeProcesses: base.recipes[0]?.processes ?? [],
      };
      const needed = required(query, rules);
      for (const factoryId of capableFactories(query, rules, capabilities)) {
        const rows = capabilities.filter(
          (c) =>
            c.factoryId === factoryId && c.materialClass === base.materialClass && needed.includes(c.process),
        );
        const band = {
          minDays: Math.max(...rows.map((r) => r.leadTimeMinDays)),
          maxDays: Math.max(...rows.map((r) => r.leadTimeMaxDays)),
        };
        const known = bands.get(factoryId);
        bands.set(
          factoryId,
          known
            ? {
                minDays: Math.min(known.minDays, band.minDays),
                maxDays: Math.max(known.maxDays, band.maxDays),
              }
            : band,
        );
      }
    }
    return [...bands].map(([factoryId, leadTime]) => ({ factoryId, leadTime }));
  }

  private async load(db: Tx | PrismaService, opts: { capabilities?: boolean } = {}) {
    const rules: Rule[] = (
      await db.styleProcessRule.findMany({
        select: { scope: true, scopeValue: true, processType: { select: { code: true } } },
      })
    ).map((r) => ({ scope: r.scope, scopeValue: r.scopeValue, process: r.processType.code }));
    const capabilities: Capability[] =
      opts.capabilities === false
        ? []
        : (
            await db.factoryProcessCapability.findMany({
              where: { status: 'verified', factory: { status: 'active' } },
              select: {
                factoryId: true,
                materialClass: true,
                leadTimeMinDays: true,
                leadTimeMaxDays: true,
                processType: { select: { code: true } },
              },
            })
          ).map((c) => ({
            factoryId: c.factoryId,
            process: c.processType.code,
            materialClass: c.materialClass,
            leadTimeMinDays: c.leadTimeMinDays,
            leadTimeMaxDays: c.leadTimeMaxDays,
          }));
    return { rules, capabilities };
  }
}

/** The processes a variant needs: its recipe's, else every rule matching it (D-244). */
export function required(v: MakeabilityQuery, rules: readonly Rule[]): string[] {
  if (v.recipeProcesses.length > 0) return [...new Set(v.recipeProcesses)].sort();
  const options = new Set<string>();
  for (const [axis, value] of Object.entries(v.options)) {
    for (const one of Array.isArray(value) ? value : [value])
      if (typeof one === 'string') options.add(`${axis}:${one}`);
  }
  const hit = (r: Rule) =>
    (r.scope === 'source_product_type' && r.scopeValue === v.sourceProductType) ||
    (r.scope === 'category' && r.scopeValue === v.category) ||
    (r.scope === 'family' && r.scopeValue === v.family) ||
    (r.scope === 'option' && options.has(r.scopeValue));
  return [...new Set(rules.filter(hit).map((r) => r.process))].sort();
}

/** Active factories with a verified capability for every needed process in the material class (none needed → none). */
export function capableFactories(
  v: MakeabilityQuery,
  rules: readonly Rule[],
  capabilities: readonly Capability[],
): bigint[] {
  const needed = required(v, rules);
  if (needed.length === 0) return [];
  const byFactory = new Map<bigint, Set<string>>();
  for (const c of capabilities) {
    if (c.materialClass !== v.materialClass) continue;
    const set = byFactory.get(c.factoryId) ?? new Set<string>();
    set.add(c.process);
    byFactory.set(c.factoryId, set);
  }
  return [...byFactory].filter(([, set]) => needed.every((p) => set.has(p))).map(([id]) => id);
}
