import { PrismaService } from '@database/prisma.service';
import { pouchShapeOf, sizeRulesOf } from '@modules/catalog/store/size-rules';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { csInputExtras } from './cs-input-extras';
import { type PouchInputDataDto } from './quotes.io.dto';

const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

/** What the CS pouch calculator offers (legacy `cs/pouch/get-input-data`, `PouchController.php:15-59`). */
@Injectable()
export class PouchInputDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async get(): Promise<PouchInputDataDto> {
    const active = { status: 'active' as const };
    const [patterns, films, inks, assemblies] = await Promise.all([
      this.prisma.pattern.findMany({
        where: { ...active, productType: { calculatorKey: 'pouch' }, pouchFormula: { not: null } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.material.findMany({ where: { ...active, kind: 'film' }, orderBy: { code: 'asc' } }),
      this.prisma.inkColour.findMany({ where: active, orderBy: { code: 'asc' } }),
      this.prisma.assembly.findMany({ where: active, orderBy: { code: 'asc' } }),
    ]);
    return {
      ...(await csInputExtras(this.prisma, this.settings, 'pouch')),
      patterns: patterns.map((p) => ({
        id: p.publicId,
        code: p.code,
        name: p.name,
        pouch: pouchShapeOf(p.pouchFormula, p.constraints)!,
        rules: sizeRulesOf(p.constraints),
      })),
      films: films.map((m) => ({
        id: m.publicId,
        code: m.code,
        nameTh: m.nameTh,
        nameEn: m.nameEn,
        micron: num(m.micron),
      })),
      printColours: inks.map((c) => ({
        id: c.publicId,
        code: c.code,
        name: c.name,
        colourKind: c.colourKind,
      })),
      options: assemblies.map((a) => ({
        id: a.publicId,
        code: a.code,
        nameTh: a.nameTh,
        nameEn: a.nameEn,
        requiresAmount: a.requiresAmount,
        requiresWidth: a.requiresWidth,
        requiresLength: a.requiresLength,
      })),
    };
  }
}
