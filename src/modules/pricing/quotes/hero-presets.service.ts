import { DomainException } from '@common/errors/domain.exception';
import { PrismaService } from '@database/prisma.service';
import { type StoreConfiguratorDto } from '@modules/catalog/store/store-configurator.dto';
import { StoreConfiguratorService } from '@modules/catalog/store/store-configurator.service';
import { Injectable } from '@nestjs/common';
import { type SettingValues } from '@platform/settings/setting-keys';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { assertStoreRules, validateConfiguration } from './configurations';
import { type HeroPresetsDto } from './hero-presets.dto';
import {
  type CalculateBody,
  HERO_CALCULATORS,
  heroCalculateBody,
  type HeroMaterial,
  type HeroPrint,
  type HeroShape,
} from './hero-preview.adapter';

type Presets = SettingValues['catalog.hero_presets'];

const PRINT_WORDS: Record<HeroPrint, { th: string; en: string }> = {
  none: { th: 'ไม่พิมพ์', en: 'No print' },
  one: { th: 'พิมพ์ 1 สี', en: 'One colour' },
  full: { th: 'พิมพ์สี่สี', en: 'Full colour' },
};

export interface HeroSize {
  /** Index in `sizesMm` — the size id is `<shape>:s<index>`. */
  index: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

/** One hero shape resolved against its live configurator: only what the product can price. */
export interface ResolvedShape {
  id: HeroShape;
  labelTh: string;
  styleCode: string | null;
  configurator: StoreConfiguratorDto;
  patternId: string;
  sizes: HeroSize[];
  /** board → material option of this product. */
  materials: Map<HeroMaterial, { id: string; nameTh: string; nameEn: string }>;
  /** print → front ink option ids of this product (`none` → []). */
  prints: Map<HeroPrint, string[]>;
  qtys: number[];
}

export interface HeroSelection {
  shape: HeroShape;
  size: number;
  material: HeroMaterial;
  print: HeroPrint;
  qty: number;
}

export interface HeroResolution {
  presets: Presets | null;
  shapes: ResolvedShape[];
  default: HeroSelection | null;
}

export interface HeroPreviewInput {
  shape: HeroShape;
  material: HeroMaterial;
  print: HeroPrint;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  qty: number;
}

/** W × D × H mm → "18×12×5 ซม." */
export const sizeLabelTh = (s: { lengthMm: number; widthMm: number; heightMm: number }) =>
  `${[s.lengthMm, s.widthMm, s.heightMm].map((mm) => String(Math.round(mm) / 10)).join('×')} ซม.`;

/** The owner's default selection, when the catalogue offers every part of it; otherwise none (D-310). */
export function offeredDefault(
  shapes: ResolvedShape[],
  wanted: Presets['default'] | undefined,
): HeroSelection | null {
  const shape = shapes.find((s) => s.id === wanted?.shape);
  if (
    !wanted ||
    !shape ||
    !shape.sizes.some((s) => s.index === wanted.size) ||
    !shape.materials.has(wanted.material as HeroMaterial) ||
    !shape.prints.has(wanted.print as HeroPrint) ||
    !shape.qtys.includes(wanted.qty)
  )
    return null;
  return {
    shape: shape.id,
    size: wanted.size,
    material: wanted.material as HeroMaterial,
    print: wanted.print as HeroPrint,
    qty: wanted.qty,
  };
}

/**
 * D-310 the homepage Studio hero's presets: the product owner's values in `catalog.hero_presets`, mapped onto the
 * live catalogue. A shape opens its `productSlug`, or the active instant product whose pattern carries its
 * `styleCode`; per shape, only the boards and prints published on that product, the sizes the calculator's own store
 * checks accept with every offered board, and the quantities within the product's limits are offered. Anything the
 * catalogue cannot price is dropped — never shipped unquotable.
 */
@Injectable()
export class HeroPresetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly configurators: StoreConfiguratorService,
  ) {}

  async resolve(): Promise<HeroResolution> {
    let presets: Presets | null;
    try {
      presets = (await this.settings.at('catalog.hero_presets')).value ?? null;
    } catch (error) {
      if (!(error instanceof SettingNotFoundError)) throw error;
      presets = null;
    }
    if (!presets) return { presets: null, shapes: [], default: null };
    const shapes: ResolvedShape[] = [];
    for (const shape of presets.shapes) {
      const resolved = await this.resolveShape(presets, shape);
      if (resolved) shapes.push(resolved);
    }
    return { presets, shapes, default: offeredDefault(shapes, presets.default) };
  }

  private async resolveShape(
    presets: Presets,
    shape: Presets['shapes'][number],
  ): Promise<ResolvedShape | null> {
    const target = await this.productOf(shape);
    if (!target) return null;
    const configurator = await this.configurators.get(target.slug).catch((error: unknown) => {
      if (error instanceof DomainException) return null;
      throw error;
    });
    if (!configurator?.instant || !(HERO_CALCULATORS as readonly string[]).includes(configurator.calculator))
      return null;
    const pattern =
      configurator.patterns.find((p) => p.id === target.patternId) ?? configurator.patterns[0] ?? null;
    if (!pattern) return null;
    const byCode = (kind: string) =>
      new Map(
        (configurator.optionGroups.find((g) => g.kind === kind)?.options ?? []).map((o) => [o.code, o]),
      );
    const materialOptions = byCode('material');
    const inkOptions = byCode('ink_colour');
    const materials = new Map<HeroMaterial, { id: string; nameTh: string; nameEn: string }>();
    for (const m of presets.materials) {
      const option = (m.optionCodes ?? []).map((c) => materialOptions.get(c)).find((o) => o !== undefined);
      if (option) materials.set(m.id, { id: option.id, nameTh: option.nameTh, nameEn: option.nameEn });
    }
    const prints = new Map<HeroPrint, string[]>();
    for (const p of presets.prints) {
      if (p.id === 'none') {
        prints.set('none', []);
        continue;
      }
      const ids = (p.optionCodes ?? []).map((c) => inkOptions.get(c)?.id);
      // Every ink of the print must be published on the product, or the print is not offered for it.
      if (ids.length > 0 && ids.every((id): id is string => id !== undefined)) prints.set(p.id, ids);
    }
    const { min, max } = configurator.quantity;
    const qtys = [...presets.quantities]
      .sort((a, b) => a - b)
      .filter((q) => (min === null || q >= min) && (max === null || q <= max));
    if (materials.size === 0 || prints.size === 0 || qtys.length === 0) return null;
    const sizes: HeroSize[] = [];
    for (const [index, s] of presets.sizesMm.entries()) {
      const size = { index, lengthMm: s.w, widthMm: s.d, heightMm: s.h };
      if (await this.sizeAccepted(configurator, pattern.id, size, [...materials.values()], qtys[0]!))
        sizes.push(size);
    }
    if (sizes.length === 0) return null;
    return {
      id: shape.id,
      labelTh: shape.labelTh,
      styleCode: shape.styleCode ?? pattern.styleCode ?? null,
      configurator,
      patternId: pattern.id,
      sizes,
      materials,
      prints,
      qtys,
    };
  }

  /** `productSlug`, else the first active instant product with a pattern of that style code. */
  private async productOf(
    shape: Presets['shapes'][number],
  ): Promise<{ slug: string; patternId?: string } | null> {
    if (shape.productSlug) return { slug: shape.productSlug };
    if (!shape.styleCode) return null;
    const link = await this.prisma.catalogProductPattern.findFirst({
      where: {
        pattern: { styleCode: shape.styleCode, status: 'active' },
        catalogProduct: { status: 'active', productType: { status: 'active', quoteMode: 'instant' } },
      },
      orderBy: [{ catalogProductId: 'asc' }, { sort: 'asc' }],
      select: { catalogProduct: { select: { slug: true } }, pattern: { select: { publicId: true } } },
    });
    return link ? { slug: link.catalogProduct.slug, patternId: link.pattern.publicId } : null;
  }

  /** The calculator's own store checks (size rules, limits) with every offered board, as `store.quotes.calculate`. */
  private async sizeAccepted(
    configurator: StoreConfiguratorDto,
    patternId: string,
    size: HeroSize,
    materials: { id: string }[],
    qty: number,
  ): Promise<boolean> {
    const key = configurator.calculator;
    try {
      for (const material of materials) {
        const body = heroCalculateBody(configurator, {
          ...size,
          materialId: material.id,
          inkIds: [],
          quantity: qty,
          patternId,
        });
        const configuration = await validateConfiguration(key, body.configuration, { staff: false });
        await assertStoreRules(this.prisma, key, configuration);
      }
      return true;
    } catch (error) {
      if (error instanceof DomainException) return false;
      throw error;
    }
  }

  async presets(): Promise<HeroPresetsDto> {
    const { presets, shapes, default: selection } = await this.resolve();
    const materialIds = (['kraft350', 'art350', 'corrE'] as const).filter((m) =>
      shapes.some((s) => s.materials.has(m)),
    );
    const printIds = (['none', 'one', 'full'] as const).filter((p) => shapes.some((s) => s.prints.has(p)));
    const label = (list: { id: string; labelTh: string }[] | undefined, id: string) =>
      list?.find((x) => x.id === id)?.labelTh;
    let defaultDto: HeroPresetsDto['default'] = null;
    if (selection) {
      const shape = shapes.find((s) => s.id === selection.shape)!;
      const size = shape.sizes.find((z) => z.index === selection.size)!;
      defaultDto = {
        shape: selection.shape,
        sizeId: `${shape.id}:s${size.index}`,
        lengthMm: size.lengthMm,
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        material: selection.material,
        print: selection.print,
        qty: selection.qty,
      };
    }
    return {
      shapes: shapes.map((s) => ({
        id: s.id,
        labelTh: s.labelTh,
        styleCode: s.styleCode,
        productSlug: s.configurator.slug,
        catalogProductId: s.configurator.catalogProductId,
        productTypeCode: s.configurator.productTypeCode,
        calculator: s.configurator.calculator,
        patternId: s.patternId,
        dielineKey: s.configurator.patterns.find((p) => p.id === s.patternId)?.dielineKey ?? null,
        qtys: s.qtys,
      })),
      sizes: shapes.flatMap((s) =>
        s.sizes.map((size) => ({
          id: `${s.id}:s${size.index}`,
          shapeId: s.id,
          code: `s${size.index}`,
          labelTh: sizeLabelTh(size),
          lengthMm: size.lengthMm,
          widthMm: size.widthMm,
          heightMm: size.heightMm,
        })),
      ),
      materials: materialIds.map((id) => {
        const first = shapes.find((s) => s.materials.has(id))!.materials.get(id)!;
        return {
          id,
          labelTh: label(presets?.materials, id) ?? first.nameTh,
          labelEn: first.nameEn,
          options: shapes.flatMap((s) =>
            s.materials.has(id) ? [{ shapeId: s.id, materialId: s.materials.get(id)!.id }] : [],
          ),
        };
      }),
      prints: printIds.map((id) => ({
        id,
        labelTh: label(presets?.prints, id) ?? PRINT_WORDS[id].th,
        labelEn: PRINT_WORDS[id].en,
        options: shapes.flatMap((s) =>
          s.prints.has(id) ? [{ shapeId: s.id, inkIds: s.prints.get(id)! }] : [],
        ),
      })),
      qtys: [...new Set(shapes.flatMap((s) => s.qtys))].sort((a, b) => a - b),
      default: defaultDto,
    };
  }

  /**
   * The calculate body of a hero choice, or 409 `quotes.preview_unavailable` when the shape does not offer the board,
   * the print or the quantity. Sizes are free within the calculator's own limits, which `store.quotes.calculate`
   * enforces as for `/configure`; `presetId` names the preset size the dimensions match.
   */
  async body(input: HeroPreviewInput): Promise<{ body: CalculateBody; presetId: string | null }> {
    const { shapes } = await this.resolve();
    const shape = shapes.find((s) => s.id === input.shape);
    const material = shape?.materials.get(input.material);
    const inks = shape?.prints.get(input.print);
    if (!shape || !material || !inks || !shape.qtys.includes(input.qty))
      throw new DomainException('quotes.preview_unavailable');
    const size = shape.sizes.find(
      (s) => s.lengthMm === input.lengthMm && s.widthMm === input.widthMm && s.heightMm === input.heightMm,
    );
    return {
      body: heroCalculateBody(shape.configurator, {
        lengthMm: input.lengthMm,
        widthMm: input.widthMm,
        heightMm: input.heightMm,
        materialId: material.id,
        inkIds: inks,
        quantity: input.qty,
        patternId: shape.patternId,
      }),
      presetId: size ? `${shape.id}:s${size.index}` : null,
    };
  }
}
