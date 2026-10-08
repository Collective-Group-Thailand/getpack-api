import { type StoreConfiguratorDto } from '@modules/catalog/store/store-configurator.dto';

/**
 * The homepage Studio hero → the body `store.quotes.calculate` takes (UX round 2 Phase 4 §A2, D-310). A thin
 * mapping only: the configuration is the one `/configure` sends for the same choices (packio-web
 * `configurator/build.ts`: first pattern and its first part, the board as `materialId`, front inks at full coverage
 * — a process ink four times on folding — no back print, no finish), so the price is the calculator's (D-043).
 */
export const HERO_SHAPES = ['mailer', 'lid', 'tuck'] as const;
export const HERO_MATERIALS = ['kraft350', 'art350', 'corrE'] as const;
export const HERO_PRINTS = ['none', 'one', 'full'] as const;
export type HeroShape = (typeof HERO_SHAPES)[number];
export type HeroMaterial = (typeof HERO_MATERIALS)[number];
export type HeroPrint = (typeof HERO_PRINTS)[number];

/** Calculators whose configuration is a box the hero draws. */
export const HERO_CALCULATORS = ['folding', 'corrugate'] as const;

/** Full coverage per ink colour, as the configurator and the CS desk price it. */
const FULL_COVERAGE = 100;

export interface HeroSelection {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  /** The material option id the board maps to for this product. */
  materialId: string;
  /** Front ink option ids the print maps to for this product (empty = no print). */
  inkIds: string[];
  quantity: number;
}

export interface CalculateBody {
  productTypeCode: string;
  configuration: Record<string, unknown>;
}

const optionsOf = (configurator: StoreConfiguratorDto, kind: string) =>
  configurator.optionGroups.find((g) => g.kind === kind)?.options ?? [];

/** A process (CMYK) ink is one four-colour pass: the folding calculator takes it as its colour four times. */
function isProcessInk(configurator: StoreConfiguratorDto, id: string): boolean {
  return optionsOf(configurator, 'ink_colour').some(
    (o) => o.id === id && o.attributes['colourKind'] === 'process',
  );
}

export function heroCalculateBody(configurator: StoreConfiguratorDto, s: HeroSelection): CalculateBody {
  const pattern = configurator.patterns[0];
  if (!pattern) throw new Error('a hero product has a pattern');
  const subPattern = pattern.parts[0]?.subPatternId;
  const common = {
    catalogProductId: configurator.catalogProductId,
    quantities: [s.quantity],
    design: { graphic: false, structure: false },
    patternId: pattern.id,
    l: s.lengthMm,
    w: s.widthMm,
    d: s.heightMm,
    materialId: s.materialId,
    difficultyLevelId: configurator.difficultyLevelId ?? '',
  };
  if (configurator.calculator === 'corrugate') {
    const area = configurator.printAreas[0] ?? 'all_round';
    return {
      productTypeCode: configurator.productTypeCode,
      configuration: {
        ...common,
        parts: [
          {
            ...(subPattern ? { subPatternId: subPattern } : {}),
            printFront: s.inkIds.map((inkColourId) => ({ inkColourId, area })),
            printBack: [],
            assemblies: [],
          },
        ],
      },
    };
  }
  return {
    productTypeCode: configurator.productTypeCode,
    configuration: {
      ...common,
      parts: [
        {
          ...(subPattern ? { subPatternId: subPattern } : {}),
          printFront: s.inkIds.flatMap((inkColourId) =>
            Array.from({ length: isProcessInk(configurator, inkColourId) ? 4 : 1 }, () => ({
              inkColourId,
              percent: FULL_COVERAGE,
            })),
          ),
          printBack: [],
          finish2: [],
          assemblies: [],
        },
      ],
    },
  };
}
