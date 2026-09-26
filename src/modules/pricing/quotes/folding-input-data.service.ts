import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { type FoldingInputDataDto } from './quotes.io.dto';

const F1 = new Set(['coating', 'lamination']);
const F2 = new Set(['foil', 'spot_uv', 'emboss', 'deboss']);
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

/** What the CS folding calculator offers (legacy `GET cs/folding`, `Api/FoldingBoxController.php:75-155`). */
@Injectable()
export class FoldingInputDataService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<FoldingInputDataDto> {
    const active = { status: 'active' as const };
    const [patterns, materials, inks, finishes, diecuts, assemblies, levels] = await Promise.all([
      this.prisma.pattern.findMany({
        where: { ...active, productType: { calculatorKey: 'folding' }, geometryFormula: { not: null } },
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
      patterns: patterns.map((p) => ({
        id: p.publicId,
        code: p.code,
        name: p.name,
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
