import { type Prisma } from '../../src/generated/prisma/client';
import {
  lineKeyOf,
  normaliseColumns,
  PriceComponentRegistry,
  type PriceValues,
} from '../../src/modules/partners/pricing/price-component.registry';
import { type FinalLine, PriceListBuilder } from '../../src/modules/partners/pricing/price-list-builder';
import { CORRUGATE_PRICE_COMPONENTS } from '../../src/modules/pricing/calculators/corrugate/price-components';
import { FOLDING_PRICE_COMPONENTS } from '../../src/modules/pricing/calculators/folding/price-components';

type Tx = Prisma.TransactionClient;

const DEV_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00+07:00');

export interface DevCorrugate {
  factoryPublicId: string;
  rscPatternPublicId: string;
  telePatternPublicId: string;
  teleBodyPublicId: string;
  teleLidPublicId: string;
  openTopPatternPublicId: string;
  boardPublicId: string;
  /** Heavier fake boards KA185 and KI230 (U2.2). */
  heavierBoardPublicIds: [string, string];
  fluteTypePublicId: string;
  difficultyLevelPublicId: string;
  inkColourPublicId: string;
  coatingPublicId: string;
  packingAssemblyPublicId: string;
  flexoPrintTypePublicId: string;
  digitalPrintTypePublicId: string;
  catalogProductPublicId: string;
  priceListVersionId: bigint;
}

/**
 * An obviously fake corrugate setup for `pnpm dev` and the tests (D-005, U-B6): `[DEV]` names, made-up
 * flute factors and prices. It extends the dev folding factory F9001 (one launch factory serves every type,
 * D-101) with a tier-A corrugate price list for a flexo and a digital print type, capacity and getpack sell
 * margins, so an RSC, a Tele (body + lid) and an open-top box on a fake B-flute board can be priced end to
 * end. Idempotent. Needs `seedDevFolding` (factory, `dev-cmyk`, `dev-normal`) and the dev catalogue
 * (`dev-matt`).
 */
export async function seedDevCorrugate(tx: Tx): Promise<{ created: boolean; fixture: DevCorrugate }> {
  const corrugated = await tx.productType.findUniqueOrThrow({ where: { code: 'corrugated' } });
  const factory = await tx.factory.findUniqueOrThrow({ where: { code: 'F9001' } });
  const cmyk = await tx.inkColour.findUniqueOrThrow({ where: { code: 'dev-cmyk' } });
  const matt = await tx.finish.findUniqueOrThrow({ where: { code: 'dev-matt' } });
  const difficulty = await tx.difficultyLevel.findUniqueOrThrow({ where: { code: 'dev-normal' } });
  if (await tx.printType.findUnique({ where: { code: 'dev_corrugate_flexo' } })) {
    return { created: false, fixture: await describe(tx, factory.id) };
  }

  const printType = (code: string, nameTh: string, nameEn: string) =>
    tx.printType.create({ data: { code, productTypeId: corrugated.id, nameTh, nameEn, status: 'active' } });
  const flexo = await printType('dev_corrugate_flexo', '[DEV] เฟล็กโซ', '[DEV] Flexo');
  const digital = await printType('dev_corrugate_digital', '[DEV] ดิจิทัล', '[DEV] Digital');
  const flute = await tx.fluteType.create({
    data: {
      code: 'DEV-B',
      name: '[DEV] ลอน B',
      layers: 3,
      colA: 3,
      colC: 4,
      colDd: 5,
      colG: 35,
      colFh: 3,
      ct: 2,
      z: 0.5,
      status: 'active',
    },
  });
  const board = await tx.material.create({
    data: {
      code: 'dev-ka125-b',
      kind: 'corrugated_board',
      nameTh: '[DEV] กระดาษลัง KA125 ลอน B',
      nameEn: '[DEV] Kraft board KA125 B-flute',
      gsm: 450,
      fluteTypeId: flute.id,
      insideColour: 'น้ำตาล',
      outsideColour: 'น้ำตาล',
      coatable: true,
      status: 'active',
    },
  });
  // Two heavier fake B-flute boards, so the Structure Advisor (U2.2) has a choice to make.
  const heavier: { id: bigint; publicId: string }[] = [];
  for (const [code, name, gsm] of [
    ['dev-ka185-b', 'KA185', 560],
    ['dev-ki230-b', 'KI230', 700],
  ] as const) {
    heavier.push(
      await tx.material.create({
        data: {
          code,
          kind: 'corrugated_board',
          nameTh: `[DEV] กระดาษลัง ${name} ลอน B`,
          nameEn: `[DEV] Kraft board ${name} B-flute`,
          gsm,
          fluteTypeId: flute.id,
          insideColour: 'น้ำตาล',
          outsideColour: 'น้ำตาล',
          coatable: false,
          status: 'active',
        },
      }),
    );
  }
  const packing = await tx.assembly.create({
    data: {
      code: 'dev-packing',
      nameTh: '[DEV] ค่าห่อ',
      nameEn: '[DEV] Packing',
      autoAdd: true,
      status: 'active',
    },
  });
  const rsc = await tx.pattern.create({
    data: {
      productTypeId: corrugated.id,
      code: 'DEV-RSC',
      name: '[DEV] กล่องฝาชน',
      // Fake size rules (the configurator publishes them; customer requests are checked).
      constraints: { minW: 100, maxW: 800, minL: 100, maxL: 1000, minH: 50, maxH: 800, wMustExceedH: true },
      corrugateFormula: 'rsc',
      status: 'active',
      fluteTypes: { create: { fluteTypeId: flute.id } },
    },
  });
  await tx.pattern.create({
    data: {
      productTypeId: corrugated.id,
      code: 'DEV-TELE',
      name: '[DEV] กล่องฝาครอบ',
      constraints: {},
      status: 'active',
      subPatterns: {
        create: [
          { seq: 1, name: '[DEV] ตัวกล่อง', corrugateFormula: 'tele_body' },
          { seq: 2, name: '[DEV] ฝา', corrugateFormula: 'tele_lid' },
        ],
      },
    },
  });
  const openTop = await tx.pattern.create({
    data: {
      productTypeId: corrugated.id,
      code: 'DEV-OPEN-TOP',
      name: '[DEV] กล่องเปิดฝาบน',
      constraints: {},
      corrugateFormula: 'open_top',
      status: 'active',
    },
  });
  // The open-top formula reads condition values i, j, k, m (legacy `conditions`, fake bands).
  const condition = async (slot: 'i' | 'j' | 'k' | 'm', determinant: 'w' | 'w_over_l', bands: number[][]) => {
    const table = await tx.geometryBandTable.create({
      data: {
        code: `dev_corrugate_${slot}`,
        name: `[DEV] ${slot}`,
        status: 'active',
        bands: {
          create: bands.map(([lower, upper, value]) => ({ lower: lower!, upper: upper!, value: value! })),
        },
      },
    });
    const c = await tx.geometryCondition.create({
      data: {
        code: `dev_corrugate_${slot}`,
        bandTableId: table.id,
        variable: slot,
        determinant,
        status: 'active',
      },
    });
    await tx.patternGeometryCondition.create({ data: { patternId: openTop.id, slot, conditionId: c.id } });
  };
  await condition('i', 'w', [
    [0, 200, 10],
    [200.0001, 9999, 15],
  ]);
  await condition('j', 'w_over_l', [
    [0, 0.5, 1],
    [0.5001, 10, 0],
  ]);
  await condition('k', 'w', [[0, 9999, 5]]);
  await condition('m', 'w', [[0, 9999, 1]]);
  await tx.catalogProduct.create({
    data: {
      productTypeId: corrugated.id,
      slug: 'dev-rsc-carton',
      nameTh: '[DEV] กล่องลูกฟูกฝาชนทดสอบ',
      nameEn: '[DEV] Test RSC carton',
      templateAvailability: 'drawing',
      status: 'active',
      defaultDifficultyLevelId: difficulty.id,
      patterns: { create: { patternId: rsc.id } },
      options: {
        create: [
          { optionKind: 'material', optionId: board.id, isDefault: true },
          ...heavier.map((m, i) => ({ optionKind: 'material' as const, optionId: m.id, sort: i + 1 })),
        ],
      },
      standardSizes: {
        create: {
          code: 'M',
          name: '[DEV] 30×40×25 ซม.',
          lengthMm: 400,
          widthMm: 300,
          heightMm: 250,
          status: 'active',
        },
      },
    },
  });

  for (const pt of [flexo, digital]) {
    await tx.factoryCapability.create({
      data: { factoryId: factory.id, productTypeId: corrugated.id, printTypeId: pt.id, status: 'active' },
    });
  }
  const approved = {
    versionNo: 1,
    effectiveFrom: DEV_EFFECTIVE_FROM,
    status: 'approved' as const,
    reason: 'dev seed (fake)',
    decidedAt: new Date(),
  };
  await tx.factoryParticipation.create({
    data: {
      factoryId: factory.id,
      productTypeId: corrugated.id,
      versions: { create: { ...approved, tier: 'A' } },
    },
  });
  await tx.factoryCapacity.create({
    data: {
      factoryId: factory.id,
      productTypeId: corrugated.id,
      versions: { create: { ...approved, capacityUnit: 'pieces', weeklyCapacity: 1000000 } },
    },
  });

  const list = await tx.priceList.create({ data: { factoryId: factory.id, productTypeId: corrugated.id } });
  const version = await tx.priceListVersion.create({
    data: {
      priceListId: list.id,
      versionNo: 1,
      origin: 'factory_proposal',
      effectiveFrom: DEV_EFFECTIVE_FROM,
      reason: 'dev seed (fake prices)',
    },
  });
  const fx = flexo.publicId;
  const dg = digital.publicId;
  const terms = (printTypeId: string, engineVariant: 'flexo' | 'digital'): PriceValues => ({
    printTypeId,
    engineVariant,
    factoryMarginPct: '12',
    minOrderAmount: engineVariant === 'flexo' ? 300 : null,
    leadTimeDays: engineVariant === 'flexo' ? '10' : '5',
    bulkLeadTimeMinQty: null,
    bulkLeadTimeDays: null,
    maxColours: 3,
    paperCut: false,
    patternAreaPercentMethod: 1,
    topSideCombined: false,
    trimDlMm: engineVariant === 'digital' ? '5' : '0',
    trimDwMm: engineVariant === 'digital' ? '5' : '0',
    printFixCostPerSqm: engineVariant === 'digital' ? '12' : null,
    nonPrintFixCostPerSqm: engineVariant === 'digital' ? '4' : null,
    paperPriceByOrderAmount: false,
    digitalDieBlock: false,
    minLotPrice: engineVariant === 'digital' ? '500' : null,
    digitalBackPrintPricePerM2: null,
    digitalTwoSideAddon: false,
    packingPriceRscPerPcs: null,
    packingPriceOtherPerPcs: null,
    packingFreeOnRsc: false,
  });
  const process = (printTypeId: string): PriceValues => ({
    printTypeId,
    fluteTypeId: flute.publicId,
    trimMm: '30',
    minLengthM: '50',
    minSheet: 100,
    widthLayoutMax: 6,
    plRscMinIn: '20',
    plRscMaxIn: '90',
    pwRscMinIn: '8',
    pwRscMaxIn: '40',
    minRscFlapMm: '30',
    minRscSlhMm: '50',
    minSllMm: '100',
    minSlwMm: '100',
    gapMm: '5',
    tlMm: '10',
    twMm: '10',
    minLengthLayoutSlot: '1',
  });
  const boards = (printTypeId: string): [FinalLine['component'], PriceValues][] =>
    (
      [
        [board.publicId, null, 499, '5.2'],
        [board.publicId, 500, 1999, '4.6'],
        [board.publicId, 2000, null, '4.1'],
        [heavier[0]!.publicId, null, null, '5.6'],
        [heavier[1]!.publicId, null, null, '6.4'],
      ] as const
    ).map(([materialId, minSheet, maxSheet, pricePerSqft]) => [
      'board_prices',
      { materialId, printTypeId, minSheet, maxSheet, pricePerSqft },
    ]);
  const level = (printTypeId: string): PriceValues => ({
    difficultyLevelId: difficulty.publicId,
    printTypeId,
    printPlatePricePerIn2: '0.35',
    minPricePerPcs: '3.5',
    printWastePct: '4',
    printSetupSheets: 10,
    diecutWastePct: '3',
    diecutWasteSheets: 5,
    assemblyWastePct: '2',
    assemblySetupSheets: 6,
  });
  const rows: [FinalLine['component'], PriceValues][] = [
    ['corrugate_print_type_terms', terms(fx, 'flexo')],
    ['corrugate_print_type_terms', terms(dg, 'digital')],
    ['corrugate_process_terms', process(fx)],
    ['corrugate_process_terms', process(dg)],
    ...[40, 48, 56, 64, 72, 80].map((w): [FinalLine['component'], PriceValues] => [
      'paper_roll_widths',
      { widthIn: String(w) },
    ]),
    ...boards(fx),
    ...boards(dg),
    ['difficulty_levels', level(fx)],
    ['difficulty_levels', level(dg)],
    ...(
      [
        [0, '10', '0.5', '1500'],
        [1, '15', '0.6', '1800'],
        [2, '18', '0.8', '2000'],
        [3, '20', '1', '2500'],
      ] as const
    ).map(
      ([colourAmount, percentMargin, minMarginPerPcs, minMarginPerJob]): [
        FinalLine['component'],
        PriceValues,
      ] => [
        'difficulty_margins',
        {
          difficultyLevelId: difficulty.publicId,
          printTypeId: fx,
          colourAmount,
          percentMargin,
          minMarginPerPcs,
          minMarginPerJob,
        },
      ],
    ),
    ['percent_reduces', { minPrice: '0', percent: '0' }],
    ['percent_reduces', { minPrice: '50000', percent: '3' }],
    [
      'corrugate_die_blocks',
      {
        printTypeId: fx,
        kind: 'flexo',
        fluteTypeId: null,
        blockMaxWIn: '60',
        blockMaxLIn: '40',
        sideType: 'T',
        minPcs: null,
        maxPcs: null,
        blockPrice: '4500',
        min1layDiecutPrice: '0.9',
        stepDiecutPrice: '0.25',
        pricePerPcs: null,
        minDiecutPrice: '1500',
        deliveryCost: '300',
        pricePerSqm: null,
      },
    ],
    ['ink_colours', { inkColourId: cmyk.publicId, printTypeId: fx, isStandard: true }],
    ['ink_colours', { inkColourId: cmyk.publicId, printTypeId: dg, isStandard: true }],
    [
      'corrugate_print_prices',
      {
        printTypeId: dg,
        inkColourId: cmyk.publicId,
        materialId: null,
        minQty: null,
        maxQty: null,
        pricePerM2: '9.5',
        addTwoSidePerSqm: null,
      },
    ],
    [
      'finish_prices',
      {
        difficultyLevelId: difficulty.publicId,
        printTypeId: dg,
        finishId: matt.publicId,
        machineId: null,
        minPaperSheetAmount: null,
        maxPaperSheetAmount: null,
        finishPrice: null,
        pricePerSheet: null,
        priceByAreaPerIn2: '0.012',
        minPrice: null,
        toolingPrice: null,
        blockPricePerIn2: null,
        materialPricePerIn2: null,
        operationCost: null,
        addsDiecutWindow: false,
      },
    ],
    [
      'corrugate_diecut_prices',
      {
        printTypeId: dg,
        difficultyLevelId: difficulty.publicId,
        minQty: null,
        maxQty: null,
        pricePerJob: null,
        pricePerPcs: '1.1',
        pricePerM2: null,
      },
    ],
    ...[board, ...heavier].map((m): [FinalLine['component'], PriceValues] => [
      'paper_sizes',
      { materialId: m.publicId, printTypeId: dg, sizeWIn: '40', sizeLIn: '60' },
    ]),
    ...[fx, dg].map((printTypeId): [FinalLine['component'], PriceValues] => [
      'corrugate_assembly_prices',
      {
        printTypeId,
        assemblyId: packing.publicId,
        rangeMin: null,
        rangeMax: null,
        minAreaSqcm: null,
        maxAreaSqcm: null,
        minDlMm: null,
        maxDlMm: null,
        method: 'per_piece',
        pricePerPcs: '0.3',
        minPrice: null,
        materialPricePerIn2: null,
      },
    ]),
  ];
  const registry = new PriceComponentRegistry();
  for (const d of [...FOLDING_PRICE_COMPONENTS, ...CORRUGATE_PRICE_COMPONENTS]) registry.register(d);
  const lines: FinalLine[] = rows.map(([component, raw]) => {
    const d = registry.get(component)!;
    const { values, errors } = normaliseColumns([...d.dimensions, ...d.values], raw, component);
    if (errors.length > 0) throw new Error(`dev corrugate ${component}: ${JSON.stringify(errors)}`);
    return { component, action: 'add', lineKey: lineKeyOf(d, values), values };
  });
  const { lineCount, contentSha256 } = await new PriceListBuilder(registry).populate(
    tx,
    version.id,
    null,
    lines,
  );
  await tx.priceListVersion.update({
    where: { id: version.id },
    data: { lineCount, contentSha256, status: 'approved', decidedAt: new Date() },
  });

  // getpack's sell side for corrugate (fake values; D-063 admins set the real ones).
  const sellVersion = { versionNo: 1, effectiveFrom: DEV_EFFECTIVE_FROM, reason: 'dev seed (fake)' };
  const margin = await tx.sellMarginTable.create({
    data: {
      productTypeId: corrugated.id,
      kind: 'margin',
      description: '[DEV] margin',
      decisionRefs: ['D-063'],
      versions: { create: { ...sellVersion, fallbackPct: 30 } },
    },
    include: { versions: true },
  });
  await tx.sellMarginLine.createMany({
    data: [
      { versionId: margin.versions[0]!.id, qtyMin: 1, qtyMax: 999, valuePct: 35 },
      { versionId: margin.versions[0]!.id, qtyMin: 1000, qtyMax: null, valuePct: 25 },
    ],
  });
  await tx.sellMarginTableVersion.update({
    where: { id: margin.versions[0]!.id },
    data: { status: 'approved', decidedAt: new Date() },
  });
  for (const [kind, amount] of [
    ['fix_cost', 0],
    ['design_fee', 2000],
    ['structure_design_fee', 1500],
  ] as const) {
    await tx.sellMarginTable.create({
      data: {
        productTypeId: corrugated.id,
        kind,
        description: `[DEV] ${kind}`,
        decisionRefs: ['D-063'],
        versions: {
          create: { ...sellVersion, fallbackAmount: amount, status: 'approved', decidedAt: new Date() },
        },
      },
    });
  }
  return { created: true, fixture: await describe(tx, factory.id) };
}

async function describe(tx: Tx, factoryId: bigint): Promise<DevCorrugate> {
  const factory = await tx.factory.findUniqueOrThrow({ where: { id: factoryId } });
  const version = await tx.priceListVersion.findFirstOrThrow({
    where: { priceList: { factoryId, productType: { code: 'corrugated' } } },
    orderBy: { versionNo: 'desc' },
  });
  const one = async <T extends { publicId: string }>(p: Promise<T>) => (await p).publicId;
  const tele = await tx.pattern.findUniqueOrThrow({
    where: { code: 'DEV-TELE' },
    include: { subPatterns: { orderBy: { seq: 'asc' } } },
  });
  return {
    factoryPublicId: factory.publicId,
    rscPatternPublicId: await one(tx.pattern.findUniqueOrThrow({ where: { code: 'DEV-RSC' } })),
    telePatternPublicId: tele.publicId,
    teleBodyPublicId: tele.subPatterns[0]!.publicId,
    teleLidPublicId: tele.subPatterns[1]!.publicId,
    openTopPatternPublicId: await one(tx.pattern.findUniqueOrThrow({ where: { code: 'DEV-OPEN-TOP' } })),
    boardPublicId: await one(tx.material.findUniqueOrThrow({ where: { code: 'dev-ka125-b' } })),
    heavierBoardPublicIds: [
      await one(tx.material.findUniqueOrThrow({ where: { code: 'dev-ka185-b' } })),
      await one(tx.material.findUniqueOrThrow({ where: { code: 'dev-ki230-b' } })),
    ],
    fluteTypePublicId: await one(tx.fluteType.findUniqueOrThrow({ where: { code: 'DEV-B' } })),
    difficultyLevelPublicId: await one(
      tx.difficultyLevel.findUniqueOrThrow({ where: { code: 'dev-normal' } }),
    ),
    inkColourPublicId: await one(tx.inkColour.findUniqueOrThrow({ where: { code: 'dev-cmyk' } })),
    coatingPublicId: await one(tx.finish.findUniqueOrThrow({ where: { code: 'dev-matt' } })),
    packingAssemblyPublicId: await one(tx.assembly.findUniqueOrThrow({ where: { code: 'dev-packing' } })),
    flexoPrintTypePublicId: await one(
      tx.printType.findUniqueOrThrow({ where: { code: 'dev_corrugate_flexo' } }),
    ),
    digitalPrintTypePublicId: await one(
      tx.printType.findUniqueOrThrow({ where: { code: 'dev_corrugate_digital' } }),
    ),
    catalogProductPublicId: await one(
      tx.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-rsc-carton' } }),
    ),
    priceListVersionId: version.id,
  };
}
