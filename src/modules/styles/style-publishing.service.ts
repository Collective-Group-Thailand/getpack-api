import { type Tx } from '@database/prisma.service';
import { DIELINE_ENGINE, type DielineEngine } from '@integrations/dieline/dieline-engine.port';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { drawableBy, pricePath, publishReasons } from './publishability';
import { searchDocument } from './search-document';
import { StyleMakeabilityService } from './style-makeability.service';

/**
 * Recomputes D-243 publishability for the given bases (all when omitted): writes each variant's `publishable` and
 * reasons, stamps the first publication of a variant and of its base (D-184: codes are frozen from then), and
 * publishes `style_base.publishability_changed` when a base's publishable count changes; keeps the search document
 * current (D-245).
 */
@Injectable()
export class StylePublishingService {
  private readonly logger = new Logger(StylePublishingService.name);

  constructor(
    private readonly makeability: StyleMakeabilityService,
    private readonly events: DomainEvents,
    @Inject(DIELINE_ENGINE) private readonly engine: DielineEngine,
  ) {}

  /**
   * D-407: the variants an approved engine recipe draws (`axis → value`), or null when that is not known — a recipe that
   * is not the engine's (`{ engine: [...] }`) or an engine that cannot load: the gate is then left open.
   */
  private async drawnVariants(recipe: unknown): Promise<Record<string, string>[] | null> {
    const stored = recipe as { engine?: unknown };
    if (!Array.isArray(stored?.engine)) return null;
    try {
      return (await this.engine.facts(stored as never)).variants;
    } catch (error) {
      this.logger.warn(`drawable variants unknown: ${(error as Error).message}`);
      return null;
    }
  }

  async recompute(
    tx: Tx,
    baseIds?: bigint[],
  ): Promise<{ bases: number; variants: number; publishable: number }> {
    if (baseIds && baseIds.length === 0) return { bases: 0, variants: 0, publishable: 0 };
    const bases = await tx.styleBase.findMany({
      where: baseIds ? { id: { in: baseIds } } : {},
      include: {
        productType: { select: { status: true, calculatorKey: true, quoteMode: true } },
        recipes: {
          select: { approvedAt: true, processes: true, version: true, recipe: true },
          orderBy: { version: 'desc' },
        },
        variants: {
          select: {
            id: true,
            options: true,
            status: true,
            publishable: true,
            reasons: true,
            publishedAt: true,
            pricePath: true,
            priceReasons: true,
          },
        },
        synonyms: { select: { term: true } },
        useCases: { select: { code: true } },
      },
    });
    // D-268: the active option price rules per calculator.
    const ruleRows = await tx.styleOptionPriceRule.findMany({
      where: { status: 'active' },
      select: { calculatorKey: true, axis: true, value: true },
    });
    const rules = new Map<string, Set<string>>();
    for (const r of ruleRows) {
      const set = rules.get(r.calculatorKey) ?? new Set<string>();
      set.add(`${r.axis}:${r.value}`);
      rules.set(r.calculatorKey, set);
    }
    const now = new Date();
    let variants = 0;
    let publishable = 0;
    for (const base of bases) {
      const approvedRecipe = base.recipes.find((r) => r.approvedAt !== null);
      const drawn = approvedRecipe ? await this.drawnVariants(approvedRecipe.recipe) : null;
      const makeable = await this.makeability.makeable(
        tx,
        base.variants
          .filter((v) => v.status === 'active')
          .map((v) => ({
            variantId: v.id,
            baseId: base.id,
            sourceProductType: base.sourceProductType,
            category: base.category,
            family: base.family,
            materialClass: base.materialClass,
            options: v.options as Record<string, unknown>,
            recipeProcesses: approvedRecipe?.processes ?? [],
          })),
      );
      const before = base.variants.filter((v) => v.publishable).length;
      let after = 0;
      for (const v of base.variants) {
        const reasons = publishReasons({
          baseStatus: base.status,
          variantStatus: v.status,
          hidden: base.hidden,
          productTypeActive: base.productType?.status === 'active',
          recipes: base.recipes.map((r) => ({ approved: r.approvedAt !== null })),
          namesApproved: {
            marketing: base.namesApprovedMarketingAt !== null,
            prepress: base.namesApprovedPrepressAt !== null,
          },
          drawable: drawn ? drawableBy(v.options as Record<string, unknown>, drawn) : null,
        });
        const ok = reasons.length === 0;
        if (ok) after++;
        // D-266: instant only with a signed calculator and every option priced.
        const calculatorKey = base.productType?.calculatorKey ?? null;
        const price = pricePath({
          calculatorKey,
          instantType: base.productType?.quoteMode === 'instant',
          options: v.options as Record<string, unknown>,
          rules: rules.get(calculatorKey ?? '') ?? new Set<string>(),
          makeable: makeable.get(v.id) ?? false,
        });
        if (
          ok !== v.publishable ||
          JSON.stringify(reasons) !== JSON.stringify(v.reasons) ||
          price.path !== v.pricePath ||
          JSON.stringify(price.reasons) !== JSON.stringify(v.priceReasons) ||
          (ok && !v.publishedAt)
        ) {
          await tx.styleVariant.update({
            where: { id: v.id },
            data: {
              publishable: ok,
              reasons,
              pricePath: price.path,
              priceReasons: price.reasons,
              evaluatedAt: now,
              ...(ok && !v.publishedAt && { publishedAt: now }),
            },
          });
        }
      }
      const document = searchDocument(
        base,
        base.synonyms.map((x) => x.term),
        base.useCases.map((u) => u.code),
      );
      if (document !== base.searchDocument) {
        await tx.styleBase.update({ where: { id: base.id }, data: { searchDocument: document } });
      }
      if (after > 0 && !base.publishedAt) {
        await tx.styleBase.update({ where: { id: base.id }, data: { publishedAt: now } });
      }
      if (after !== before) {
        await this.events.record(tx, {
          type: 'style_base.publishability_changed',
          aggregateType: 'style_base',
          aggregateId: base.publicId,
          payload: {
            baseId: base.publicId,
            code: base.code,
            publishableBefore: before,
            publishableAfter: after,
          },
        });
      }
      variants += base.variants.length;
      publishable += after;
    }
    return { bases: bases.length, variants, publishable };
  }
}
