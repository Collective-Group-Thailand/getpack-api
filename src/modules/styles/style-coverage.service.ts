import { toBangkokIso } from '@common/time/bangkok';
import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { PUBLISH_REASONS } from './publishability';
import { type StyleCoverageDto } from './style-coverage.dto';
import { StyleMakeabilityService } from './style-makeability.service';

/**
 * Coverage of the style library (U3.B3, D-243, D-244): per category the active variants, how many are publishable
 * and makeable, the reasons, and per process how many variants need it and how many active factories hold it — the
 * "styles we cannot make yet" list for recruitment (the partner prospectus shows it aggregated, D-102, D-201).
 */
@Injectable()
export class StyleCoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly makeability: StyleMakeabilityService,
  ) {}

  async coverage(): Promise<StyleCoverageDto> {
    const bases = await this.prisma.styleBase.findMany({
      where: { status: 'active' },
      include: {
        variants: {
          where: { status: 'active' },
          select: { id: true, options: true, publishable: true, reasons: true },
        },
        recipes: {
          where: { approvedAt: { not: null } },
          orderBy: { version: 'desc' },
          take: 1,
          select: { processes: true },
        },
      },
    });
    const queries = bases.flatMap((b) =>
      b.variants.map((v) => ({
        variantId: v.id,
        baseId: b.id,
        sourceProductType: b.sourceProductType,
        category: b.category,
        family: b.family,
        materialClass: b.materialClass,
        options: v.options as Record<string, unknown>,
        recipeProcesses: b.recipes[0]?.processes ?? [],
      })),
    );
    const needed = await this.makeability.requiredProcesses(this.prisma, queries);
    const categories = new Map<string, StyleCoverageDto['categories'][number]>();
    for (const b of bases) {
      const c = categories.get(b.category) ?? {
        category: b.category,
        bases: 0,
        variants: 0,
        publishable: 0,
        makeable: 0,
        notMakeable: 0,
        reasons: [],
      };
      c.bases++;
      for (const v of b.variants) {
        c.variants++;
        if (v.publishable) c.publishable++;
        if (v.reasons.includes('not_makeable')) c.notMakeable++;
        else c.makeable++;
        for (const reason of v.reasons) {
          const hit = c.reasons.find((r) => r.reason === reason);
          if (hit) hit.count++;
          else if ((PUBLISH_REASONS as readonly string[]).includes(reason))
            c.reasons.push({ reason: reason as (typeof PUBLISH_REASONS)[number], count: 1 });
        }
      }
      categories.set(b.category, c);
    }
    const processes = await this.prisma.processType.findMany({ orderBy: [{ sort: 'asc' }, { code: 'asc' }] });
    const factories = await this.prisma.factoryProcessCapability.groupBy({
      by: ['processTypeId', 'factoryId'],
      where: { status: 'verified', factory: { status: 'active' } },
    });
    const processRows = processes.map((p) => ({
      code: p.code,
      nameTh: p.nameTh,
      nameEn: p.nameEn,
      variantsNeeding: [...needed.values()].filter((list) => list.includes(p.code)).length,
      factories: new Set(factories.filter((f) => f.processTypeId === p.id).map((f) => f.factoryId)).size,
    }));
    processRows.sort(
      (a, b) =>
        Number(a.factories > 0) - Number(b.factories > 0) ||
        b.variantsNeeding - a.variantsNeeding ||
        a.code.localeCompare(b.code),
    );
    return {
      categories: [...categories.values()]
        .map((c) => ({
          ...c,
          reasons: c.reasons.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
        }))
        .sort((a, b) => a.category.localeCompare(b.category)),
      processes: processRows,
      generatedAt: toBangkokIso(new Date()),
    };
  }
}
