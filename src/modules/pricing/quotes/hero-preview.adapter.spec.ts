import { type StoreConfiguratorDto } from '@modules/catalog/store/store-configurator.dto';

import { heroCalculateBody } from './hero-preview.adapter';

const base = {
  slug: 'box',
  catalogProductId: 'cp-1',
  productTypeCode: 'folding_carton',
  calculator: 'folding',
  instant: true,
  difficultyLevelId: 'dl-1',
  patterns: [{ id: 'pt-1', parts: [{ subPatternId: 'sp-1', seq: 1, name: 'main' }] }],
  standardSizes: [],
  optionGroups: [
    {
      kind: 'ink_colour',
      options: [
        { id: 'ink-cmyk', code: 'cmyk', attributes: { colourKind: 'process' } },
        { id: 'ink-black', code: 'black', attributes: { colourKind: 'spot' } },
      ],
    },
  ],
  printAreas: [],
} as unknown as StoreConfiguratorDto;

const selection = { lengthMm: 300, widthMm: 200, heightMm: 50, materialId: 'mat-1', quantity: 1000 };

describe('hero preview adapter (UX r2 A2, D-310)', () => {
  it('builds the folding configuration /configure sends: a process ink four times at full coverage', () => {
    expect(heroCalculateBody(base, { ...selection, inkIds: ['ink-cmyk'] })).toEqual({
      productTypeCode: 'folding_carton',
      configuration: {
        catalogProductId: 'cp-1',
        quantities: [1000],
        design: { graphic: false, structure: false },
        patternId: 'pt-1',
        l: 300,
        w: 200,
        d: 50,
        materialId: 'mat-1',
        difficultyLevelId: 'dl-1',
        parts: [
          {
            subPatternId: 'sp-1',
            printFront: [1, 2, 3, 4].map(() => ({ inkColourId: 'ink-cmyk', percent: 100 })),
            printBack: [],
            finish2: [],
            assemblies: [],
          },
        ],
      },
    });
    const spot = heroCalculateBody(base, { ...selection, inkIds: ['ink-black'] });
    expect((spot.configuration['parts'] as { printFront: unknown[] }[])[0]!.printFront).toEqual([
      { inkColourId: 'ink-black', percent: 100 },
    ]);
  });

  it('prints corrugate on the first print area and leaves no print empty', () => {
    const corrugate = {
      ...base,
      productTypeCode: 'corrugated',
      calculator: 'corrugate',
      printAreas: ['top', 'side'],
    } as unknown as StoreConfiguratorDto;
    const body = heroCalculateBody(corrugate, { ...selection, inkIds: ['ink-black'] });
    expect(body.configuration['parts']).toEqual([
      {
        subPatternId: 'sp-1',
        printFront: [{ inkColourId: 'ink-black', area: 'top' }],
        printBack: [],
        assemblies: [],
      },
    ]);
    const blank = heroCalculateBody(corrugate, { ...selection, inkIds: [] });
    expect((blank.configuration['parts'] as { printFront: unknown[] }[])[0]!.printFront).toEqual([]);
  });

  it('configures every part of a two-part box (body and lid), printed alike', () => {
    const telescope = {
      ...base,
      productTypeCode: 'corrugated',
      calculator: 'corrugate',
      printAreas: ['top'],
      patterns: [
        {
          id: 'pt-tele',
          parts: [
            { subPatternId: 'sp-body', seq: 1, name: 'body' },
            { subPatternId: 'sp-lid', seq: 2, name: 'lid' },
          ],
        },
      ],
    } as unknown as StoreConfiguratorDto;
    const body = heroCalculateBody(telescope, { ...selection, inkIds: ['ink-black'] });
    expect(body.configuration['parts']).toEqual(
      ['sp-body', 'sp-lid'].map((subPatternId) => ({
        subPatternId,
        printFront: [{ inkColourId: 'ink-black', area: 'top' }],
        printBack: [],
        assemblies: [],
      })),
    );
  });
});
