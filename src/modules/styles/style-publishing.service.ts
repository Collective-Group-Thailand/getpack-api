import { type Tx } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import { SettingsService } from '@platform/settings/settings.service';

import { publishReasons } from './publishability';
import { StyleMakeabilityService } from './style-makeability.service';

/**
 * Recomputes D-243 publishability for the given bases (all when omitted): writes each variant's `publishable` and
 * reasons, stamps the first publication of a variant and of its base (D-184: codes are frozen from then), and
 * publishes `style_base.publishability_changed` when a base's publishable count changes.
 */
@Injectable()
export class StylePublishingService {
  constructor(
    private readonly settings: SettingsService,
    private readonly makeability: StyleMakeabilityService,
    private readonly events: DomainEvents,
  ) {}

  async recompute(
    tx: Tx,
    baseIds?: bigint[],
  ): Promise<{ bases: number; variants: number; publishable: number }> {
    if (baseIds && baseIds.length === 0) return { bases: 0, variants: 0, publishable: 0 };
    const publishedWave = Number((await this.settings.at('styles.published_wave', { tx })).value);
    const bases = await tx.styleBase.findMany({
      where: baseIds ? { id: { in: baseIds } } : {},
      include: {
        productType: { select: { status: true } },
        recipes: {
          select: { approvedAt: true, processes: true, version: true },
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
          },
        },
      },
    });
    const now = new Date();
    let variants = 0;
    let publishable = 0;
    for (const base of bases) {
      const approvedRecipe = base.recipes.find((r) => r.approvedAt !== null);
      const makeable = await this.makeability.makeable(
        tx,
        base.variants
          .filter((v) => v.status === 'active')
          .map((v) => ({
            variantId: v.id,
            baseId: base.id,
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
          wave: base.wave,
          publishedWave,
          productTypeActive: base.productType?.status === 'active',
          recipes: base.recipes.map((r) => ({ approved: r.approvedAt !== null })),
          namesApproved: {
            marketing: base.namesApprovedMarketingAt !== null,
            prepress: base.namesApprovedPrepressAt !== null,
          },
          makeable: makeable.get(v.id) ?? false,
        });
        const ok = reasons.length === 0;
        if (ok) after++;
        if (
          ok !== v.publishable ||
          JSON.stringify(reasons) !== JSON.stringify(v.reasons) ||
          (ok && !v.publishedAt)
        ) {
          await tx.styleVariant.update({
            where: { id: v.id },
            data: {
              publishable: ok,
              reasons,
              evaluatedAt: now,
              ...(ok && !v.publishedAt && { publishedAt: now }),
            },
          });
        }
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
