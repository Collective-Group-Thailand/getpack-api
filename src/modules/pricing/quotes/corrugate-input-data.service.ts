import { PrismaService } from '@database/prisma.service';
import { sizeRulesOf } from '@modules/catalog/store/size-rules';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { PRINT_AREAS } from './corrugate.dto';
import { csInputExtras } from './cs-input-extras';
import { type CorrugateInputDataDto } from './quotes.io.dto';

const COATING_KINDS = ['coating', 'lamination'] as const;
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

/** What the CS corrugate calculator offers (legacy `GET cs/corrugate`, `Api/Corrugate/CorrugateController.php:104-189`). */
@Injectable()
export class CorrugateInputDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async get(): Promise<CorrugateInputDataDto> {
    const active = { status: 'active' as const };
    const [patterns, boards, inks, coatings, assemblies, levels] = await Promise.all([
      this.prisma.pattern.findMany({
        where: {
          ...active,
          productType: { calculatorKey: 'corrugate' },
          OR: [
            { corrugateFormula: { not: null } },
            { subPatterns: { some: { corrugateFormula: { not: null } } } },
          ],
        },
        include: {
          subPatterns: { orderBy: { seq: 'asc' } },
          fluteTypes: { include: { fluteType: { select: { publicId: true } } } },
        },
        orderBy: { code: 'asc' },
      }),
      this.prisma.material.findMany({
        where: { ...active, kind: 'corrugated_board', fluteType: { status: 'active' } },
        include: { fluteType: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.inkColour.findMany({ where: active, orderBy: { code: 'asc' } }),
      this.prisma.finish.findMany({
        where: { ...active, finishKind: { in: [...COATING_KINDS] } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.assembly.findMany({ where: { ...active, autoAdd: false }, orderBy: { code: 'asc' } }),
      this.prisma.difficultyLevel.findMany({ where: active, orderBy: [{ sort: 'asc' }, { code: 'asc' }] }),
    ]);
    return {
      ...(await csInputExtras(this.prisma, this.settings, 'corrugate')),
      patterns: patterns.map((p) => ({
        id: p.publicId,
        code: p.code,
        name: p.name,
        rules: sizeRulesOf(p.constraints),
        corrugateFormula: p.corrugateFormula,
        fluteTypeIds: p.fluteTypes.map((f) => f.fluteType.publicId),
        subPatterns: p.subPatterns.map((s) => ({
          id: s.publicId,
          seq: s.seq,
          name: s.name,
          corrugateFormula: s.corrugateFormula,
        })),
      })),
      boards: boards.map((m) => ({
        id: m.publicId,
        code: m.code,
        nameTh: m.nameTh,
        nameEn: m.nameEn,
        gsm: num(m.gsm),
        flute: {
          id: m.fluteType!.publicId,
          code: m.fluteType!.code,
          name: m.fluteType!.name,
          layers: m.fluteType!.layers,
        },
        coatable: m.coatable,
        insideColour: m.insideColour,
        outsideColour: m.outsideColour,
        strength: m.strength,
      })),
      inkColours: inks.map((c) => ({ id: c.publicId, code: c.code, name: c.name, colourKind: c.colourKind })),
      coatings: coatings.map((f) => ({
        id: f.publicId,
        code: f.code,
        nameTh: f.nameTh,
        nameEn: f.nameEn,
        finishKind: f.finishKind,
      })),
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
      printAreas: [...PRINT_AREAS],
    };
  }
}
