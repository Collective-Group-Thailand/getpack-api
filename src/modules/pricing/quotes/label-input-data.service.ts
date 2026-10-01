import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '@platform/settings/settings.service';

import { csInputExtras } from './cs-input-extras';
import { type LabelInputDataDto } from './quotes.io.dto';

const COATING_KINDS = ['coating', 'lamination'] as const;
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

/** What the CS label calculator offers (legacy `cs/label/get-input-data`, `Label/LabelController.php:36-90`). */
@Injectable()
export class LabelInputDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async get(): Promise<LabelInputDataDto> {
    const active = { status: 'active' as const };
    const [stocks, inks, finishes, diecuts, levels] = await Promise.all([
      this.prisma.material.findMany({ where: { ...active, kind: 'label_stock' }, orderBy: { code: 'asc' } }),
      this.prisma.inkColour.findMany({ where: active, orderBy: { code: 'asc' } }),
      this.prisma.finish.findMany({
        where: { ...active, finishKind: { in: [...COATING_KINDS] } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.diecutType.findMany({ where: active, orderBy: { code: 'asc' } }),
      this.prisma.difficultyLevel.findMany({ where: active, orderBy: [{ sort: 'asc' }, { code: 'asc' }] }),
    ]);
    return {
      ...(await csInputExtras(this.prisma, this.settings, 'label')),
      labelStocks: stocks.map((m) => ({
        id: m.publicId,
        code: m.code,
        nameTh: m.nameTh,
        nameEn: m.nameEn,
        gsm: num(m.gsm),
      })),
      inkColours: inks.map((c) => ({ id: c.publicId, code: c.code, name: c.name, colourKind: c.colourKind })),
      finishes: finishes.map((f) => ({
        id: f.publicId,
        code: f.code,
        nameTh: f.nameTh,
        nameEn: f.nameEn,
        finishKind: f.finishKind,
      })),
      diecutTypes: diecuts.map((d) => ({ id: d.publicId, code: d.code, nameTh: d.nameTh, nameEn: d.nameEn })),
      difficultyLevels: levels.map((l) => ({
        id: l.publicId,
        code: l.code,
        nameTh: l.nameTh,
        nameEn: l.nameEn,
      })),
    };
  }
}
