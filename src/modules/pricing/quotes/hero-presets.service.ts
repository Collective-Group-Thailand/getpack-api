import { DomainException } from '@common/errors/domain.exception';
import { type StoreConfiguratorDto } from '@modules/catalog/store/store-configurator.dto';
import { StoreConfiguratorService } from '@modules/catalog/store/store-configurator.service';
import { Injectable } from '@nestjs/common';
import { SettingNotFoundError, SettingsService } from '@platform/settings/settings.service';

import { type HeroPresetsDto } from './hero-presets.dto';
import {
  type CalculateBody,
  HERO_CALCULATORS,
  heroCalculateBody,
  type HeroMaterial,
  type HeroPrint,
  type HeroShape,
} from './hero-preview.adapter';

const PRINT_WORDS: Record<HeroPrint, { th: string; en: string }> = {
  none: { th: 'ไม่พิมพ์', en: 'No print' },
  one: { th: 'พิมพ์ 1 สี', en: 'One colour' },
  full: { th: 'พิมพ์สี่สี', en: 'Full colour' },
};

/** One hero shape resolved against its live configurator. */
interface ResolvedShape {
  id: HeroShape;
  configurator: StoreConfiguratorDto;
  sizes: StoreConfiguratorDto['standardSizes'];
  /** board → material option id of this product. */
  materials: Map<HeroMaterial, { id: string; nameTh: string; nameEn: string }>;
  /** print → front ink option ids of this product. */
  prints: Map<HeroPrint, string[]>;
}

export interface HeroResolution {
  shapes: ResolvedShape[];
  quantities: number[];
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

/**
 * D-310 the homepage Studio hero's presets come from the catalogue: `catalog.hero_presets` names the products and the
 * options; every entry is checked against the product's live configurator (active, instant, a box calculator, the
 * option published on the product) and dropped otherwise, so the hero never offers what cannot be priced.
 */
@Injectable()
export class HeroPresetsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly configurators: StoreConfiguratorService,
  ) {}

  async resolve(): Promise<HeroResolution> {
    let presets;
    try {
      presets = (await this.settings.at('catalog.hero_presets')).value;
    } catch (error) {
      if (error instanceof SettingNotFoundError) return { shapes: [], quantities: [] };
      throw error;
    }
    if (!presets) return { shapes: [], quantities: [] };
    const shapes: ResolvedShape[] = [];
    for (const shape of presets.shapes) {
      const configurator = await this.configurators.get(shape.productSlug).catch((error: unknown) => {
        if (error instanceof DomainException) return null;
        throw error;
      });
      if (
        !configurator?.instant ||
        !(HERO_CALCULATORS as readonly string[]).includes(configurator.calculator) ||
        configurator.patterns.length === 0
      )
        continue;
      const codes = shape.sizeCodes ?? [];
      const sizes = configurator.standardSizes.filter((s) => codes.length === 0 || codes.includes(s.code));
      const byCode = (kind: string) =>
        new Map(
          (configurator.optionGroups.find((g) => g.kind === kind)?.options ?? []).map((o) => [o.code, o]),
        );
      const materialOptions = byCode('material');
      const inkOptions = byCode('ink_colour');
      const materials = new Map<HeroMaterial, { id: string; nameTh: string; nameEn: string }>();
      for (const m of presets.materials) {
        const option = m.optionCodes.map((c) => materialOptions.get(c)).find((o) => o !== undefined);
        if (option) materials.set(m.id, { id: option.id, nameTh: option.nameTh, nameEn: option.nameEn });
      }
      const prints = new Map<HeroPrint, string[]>();
      for (const p of presets.prints) {
        if (p.id === 'none') {
          prints.set('none', []);
          continue;
        }
        const ids = p.optionCodes.map((c) => inkOptions.get(c)?.id);
        // Every ink of the print must be published on the product, or the print is not offered for it.
        if (ids.length > 0 && ids.every((id): id is string => id !== undefined)) prints.set(p.id, ids);
      }
      if (sizes.length === 0 || materials.size === 0 || prints.size === 0) continue;
      shapes.push({ id: shape.id, configurator, sizes, materials, prints });
    }
    return { shapes, quantities: [...presets.quantities].sort((a, b) => a - b) };
  }

  async presets(): Promise<HeroPresetsDto> {
    const { shapes, quantities } = await this.resolve();
    const materialIds = [...new Set(shapes.flatMap((s) => [...s.materials.keys()]))];
    const printIds = (['none', 'one', 'full'] as const).filter((p) => shapes.some((s) => s.prints.has(p)));
    return {
      shapes: shapes.map((s) => ({
        id: s.id,
        labelTh: s.configurator.patterns[0]!.name,
        productSlug: s.configurator.slug,
        catalogProductId: s.configurator.catalogProductId,
        productTypeCode: s.configurator.productTypeCode,
        calculator: s.configurator.calculator,
        patternId: s.configurator.patterns[0]!.id,
        dielineKey: s.configurator.patterns[0]!.dielineKey,
      })),
      sizes: shapes.flatMap((s) =>
        s.sizes.map((size) => ({
          id: `${s.id}:${size.code}`,
          shapeId: s.id,
          code: size.code,
          labelTh: size.name,
          lengthMm: size.lengthMm,
          widthMm: size.widthMm,
          heightMm: size.heightMm,
        })),
      ),
      materials: materialIds.map((id) => {
        const first = shapes.find((s) => s.materials.has(id))!.materials.get(id)!;
        return {
          id,
          labelTh: first.nameTh,
          labelEn: first.nameEn,
          options: shapes.flatMap((s) =>
            s.materials.has(id) ? [{ shapeId: s.id, materialId: s.materials.get(id)!.id }] : [],
          ),
        };
      }),
      prints: printIds.map((id) => ({
        id,
        labelTh: PRINT_WORDS[id].th,
        labelEn: PRINT_WORDS[id].en,
        options: shapes.flatMap((s) =>
          s.prints.has(id) ? [{ shapeId: s.id, inkIds: s.prints.get(id)! }] : [],
        ),
      })),
      qtys: shapes.length > 0 ? quantities : [],
    };
  }

  /**
   * The calculate body of a hero choice, or 409 `quotes.preview_unavailable` when the presets do not offer it (not
   * configured, or the shape / board / print / quantity is not one of them). Sizes are free within the calculator's
   * own limits, which `store.quotes.calculate` enforces as for `/configure`.
   */
  async body(input: HeroPreviewInput): Promise<{ body: CalculateBody; presetId: string | null }> {
    const { shapes, quantities } = await this.resolve();
    const shape = shapes.find((s) => s.id === input.shape);
    const material = shape?.materials.get(input.material);
    const inks = shape?.prints.get(input.print);
    if (!shape || !material || !inks || !quantities.includes(input.qty))
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
      }),
      presetId: size ? `${shape.id}:${size.code}` : null,
    };
  }
}
