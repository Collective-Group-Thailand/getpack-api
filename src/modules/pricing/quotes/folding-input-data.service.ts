import { PrismaService } from '@database/prisma.service';
import { sizeRulesOf } from '@modules/catalog/store/size-rules';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { csInputExtras } from './cs-input-extras';
import { type FoldingInputDataDto } from './quotes.io.dto';

const F1 = new Set(['coating', 'lamination']);
const F2 = new Set(['foil', 'spot_uv', 'emboss', 'deboss']);
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

/**
 * What the CS folding calculator offers (legacy `GET cs/folding`, `Api/FoldingBoxController.php:75-155`), and the CS tag
 * & sleeve calculator — the same choices over the tag patterns, flat blanks only (legacy `cs/tag/get-input-data`,
 * `TagAndSleeveController.php:35-123`).
 */
@Injectable()
export class FoldingInputDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async get(calculator: 'folding' | 'tag_sleeve' = 'folding'): Promise<FoldingInputDataDto> {
    const active = { status: 'active' as const };
    const geometryFormula = calculator === 'folding' ? { not: null } : ('flat' as const);
    const [patterns, materials, inks, finishes, diecuts, assemblies, levels] = await Promise.all([
      this.prisma.pattern.findMany({
        where: { ...active, productType: { calculatorKey: calculator }, geometryFormula },
        include: { subPatterns: { orderBy: { seq: 'asc' } } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.material.findMany({
        where: { ...active, kind: { in: ['paper', 'board'] } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.inkColour.findMany({ where: active, orderBy: { code: 'asc' } }),
      this.prisma.finish.findMany({ where: active, orderBy: { code: 'asc' } }),
      this.prisma.diecutType.findMany({ where: active, orderBy: { code: 'asc' } }),
      this.prisma.assembly.findMany({ where: active, orderBy: { code: 'asc' } }),
      this.prisma.difficultyLevel.findMany({ where: active, orderBy: [{ sort: 'asc' }, { code: 'asc' }] }),
    ]);
    return {
      ...(await csInputExtras(this.prisma, this.settings, calculator)),
      patterns: patterns
        .filter((p) => calculator === 'folding' || p.subPatterns.length === 0)
        .map((p) => ({
          id: p.publicId,
          code: p.code,
          name: p.name,
          rules: sizeRulesOf(p.constraints),
          geometryFormula: p.geometryFormula!,
          subPatterns: p.subPatterns.map((s) => ({ id: s.publicId, seq: s.seq, name: s.name })),
        })),
      materials: materials.map((m) => ({
        id: m.publicId,
        code: m.code,
        nameTh: m.nameTh,
        nameEn: m.nameEn,
        gsm: num(m.gsm),
      })),
      inkColours: inks.map((c) => ({ id: c.publicId, code: c.code, name: c.name, colourKind: c.colourKind })),
      finishes: finishes
        .filter((f) => F1.has(f.finishKind) || F2.has(f.finishKind))
        .map((f) => ({
          id: f.publicId,
          code: f.code,
          nameTh: f.nameTh,
          nameEn: f.nameEn,
          finishKind: f.finishKind,
          slot: F1.has(f.finishKind) ? ('finish1' as const) : ('finish2' as const),
          requiresAmount: f.requiresAmount,
          requiresWidth: f.requiresWidth,
          requiresLength: f.requiresLength,
        })),
      diecutTypes: diecuts.map((d) => ({ id: d.publicId, code: d.code, nameTh: d.nameTh, nameEn: d.nameEn })),
      assemblies: assemblies.map((a) => ({
        id: a.publicId,
        code: a.code,
        nameTh: a.nameTh,
        nameEn: a.nameEn,
        requiresAmount: a.requiresAmount,
        requiresWidth: a.requiresWidth,
        requiresLength: a.requiresLength,
      })),
      difficultyLevels: levels.map((l) => ({
        id: l.publicId,
        code: l.code,
        nameTh: l.nameTh,
        nameEn: l.nameEn,
      })),
    };
  }
}
