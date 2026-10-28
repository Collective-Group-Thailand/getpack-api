import { type Prisma } from '../../src/generated/prisma/client';
import {
  lineKeyOf,
  normaliseColumns,
  PriceComponentRegistry,
  type PriceValues,
} from '../../src/modules/partners/pricing/price-component.registry';
import { type FinalLine, PriceListBuilder } from '../../src/modules/partners/pricing/price-list-builder';
import { FOLDING_PRICE_COMPONENTS } from '../../src/modules/pricing/calculators/folding/price-components';

type Tx = Prisma.TransactionClient;

const DEV_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00+07:00');

export interface DevTagSleeve {
  factoryPublicId: string;
  patternPublicId: string;
  materialPublicId: string;
  difficultyLevelPublicId: string;
  inkColourPublicId: string;
  finishPublicId: string;
  foilPublicId: string;
  diecutTypePublicId: string;
  holePublicId: string;
  offsetPrintTypePublicId: string;
  digitalPrintTypePublicId: string;
  catalogProductPublicId: string;
  priceListVersionId: bigint;
}

/**
 * An obviously fake tag & sleeve setup for `pnpm dev` and the tests (D-005, U-B6 tag & sleeve): `[DEV]` names, made-up
 * prices. It extends the dev folding factory F9001 (one launch factory serves every type, D-101) with a tier-A
 * `tag_sleeve` price list holding the folding components — an offset and a digital print type —, a flat tag pattern,
 * a hole assembly, a foil finish (offset only, port map T9), capacity and getpack sell margins, so a hang tag on art
 * card can be priced end to end. Idempotent. Needs `seedDevFolding` (factory, `dev-cmyk`, `dev-normal`, `dev-diecut`)
 * and the dev catalogue (`dev-art-350`, `dev-matt`, `dev-coatings`).
 */
export async function seedDevTagSleeve(tx: Tx): Promise<{ created: boolean; fixture: DevTagSleeve }> {
  const tag = await tx.productType.findUniqueOrThrow({ where: { code: 'tag_sleeve' } });
  const factory = await tx.factory.findUniqueOrThrow({ where: { code: 'F9001' } });
  const material = await tx.material.findUniqueOrThrow({ where: { code: 'dev-art-350' } });
  const cmyk = await tx.inkColour.findUniqueOrThrow({ where: { code: 'dev-cmyk' } });
  const matt = await tx.finish.findUniqueOrThrow({ where: { code: 'dev-matt' } });
  const difficulty = await tx.difficultyLevel.findUniqueOrThrow({ where: { code: 'dev-normal' } });
  const diecut = await tx.diecutType.findUniqueOrThrow({ where: { code: 'dev-diecut' } });
  if (await tx.printType.findUnique({ where: { code: 'dev_tag_offset' } })) {
    return { created: false, fixture: await describe(tx, factory.id) };
  }
  if (tag.status !== 'active')
    await tx.productType.update({ where: { id: tag.id }, data: { status: 'active' } });

  const printType = (code: string, nameTh: string, nameEn: string) =>
    tx.printType.create({ data: { code, productTypeId: tag.id, nameTh, nameEn, status: 'active' } });
  const offset = await printType('dev_tag_offset', '[DEV] ออฟเซ็ท ป้ายแท็ก', '[DEV] Offset tag');
  const digital = await printType('dev_tag_digital', '[DEV] ดิจิทัล ป้ายแท็ก', '[DEV] Digital tag');
  const pattern = await tx.pattern.create({
    data: {
      productTypeId: tag.id,
      code: 'DEV-TAG',
      // C7 (D-455): the engine drawing that opens this pattern in the Studio (tag-cut, @getpack/dieline).
      dielineKey: 'tag-cut',
      name: '[DEV] ป้ายกระดาษ Tag ตัดมุม',
      constraints: { minW: 20, maxW: 300, minL: 20, maxL: 400 },
      geometryFormula: 'flat',
      status: 'active',
    },
  });
  const assemblyGroup = await tx.assemblyGroup.create({
    data: {
      code: 'dev-tag-finishing',
      nameTh: '[DEV] งานป้าย',
      nameEn: '[DEV] Tag finishing',
      status: 'active',
    },
  });
  const hole = await tx.assembly.create({
    data: {
      groupId: assemblyGroup.id,
      code: 'dev-hole-3mm',
      nameTh: '[DEV] เจาะรู 3 มม.',
      nameEn: '[DEV] Hole 3 mm',
      status: 'active',
    },
  });
  const coatings = await tx.finishGroup.findUniqueOrThrow({ where: { code: 'dev-coatings' } });
  const foil = await tx.finish.create({
    data: {
      groupId: coatings.id,
      code: 'dev-foil',
      nameTh: '[DEV] ปั๊มฟอยล์',
      nameEn: '[DEV] Hot foil',
      finishKind: 'foil',
      status: 'active',
    },
  });
  await tx.catalogProduct.create({
    data: {
      productTypeId: tag.id,
      slug: 'dev-hang-tag',
      nameTh: '[DEV] ป้ายแท็กทดสอบ',
      nameEn: '[DEV] Test hang tag',
      templateAvailability: 'drawing',
      status: 'active',
      defaultDifficultyLevelId: difficulty.id,
      patterns: { create: [{ patternId: pattern.id, sort: 0 }] },
      options: { create: [{ optionKind: 'material', optionId: material.id, isDefault: true }] },
    },
  });
  for (const pt of [offset, digital]) {
    await tx.factoryCapability.create({
      data: { factoryId: factory.id, productTypeId: tag.id, printTypeId: pt.id, status: 'active' },
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
    data: { factoryId: factory.id, productTypeId: tag.id, versions: { create: { ...approved, tier: 'A' } } },
  });
  await tx.factoryCapacity.create({
    data: {
      factoryId: factory.id,
      productTypeId: tag.id,
      versions: { create: { ...approved, capacityUnit: 'pieces', weeklyCapacity: 2000000 } },
    },
  });
  const machine = (name: string, printTypeId: bigint) =>
    tx.factoryMachine.create({ data: { factoryId: factory.id, name, printTypeId } });
  const press = await machine('[DEV] Tag offset press', offset.id);
  const cutter = await machine('[DEV] Tag die cutter', offset.id);
  const foiler = await machine('[DEV] Tag foil press', offset.id);
  const digitalPress = await machine('[DEV] Tag digital press', digital.id);
  const digitalCutter = await machine('[DEV] Tag digital cutter', digital.id);

  const list = await tx.priceList.create({ data: { factoryId: factory.id, productTypeId: tag.id } });
  const version = await tx.priceListVersion.create({
    data: {
      priceListId: list.id,
      versionNo: 1,
      origin: 'factory_proposal',
      effectiveFrom: DEV_EFFECTIVE_FROM,
      reason: 'dev seed (fake prices)',
    },
  });
  const all = { minPaperSheetAmount: null, maxPaperSheetAmount: null };
  const terms = (printTypeId: string, engineVariant: 'a_offset' | 'a_digital'): PriceValues => ({
    printTypeId,
    engineVariant,
    wasteMethod: 1,
    finish2StepDownWaste: false,
    canFlipPaperSize: false,
    disableOverlapLayout: false,
    factoryMarginPct: engineVariant === 'a_offset' ? '10' : '15',
    minOrderAmount: null,
    minOrderForProduction: engineVariant === 'a_offset' ? 500 : null,
    leadTimeDays: engineVariant === 'a_offset' ? '7' : '3',
    assemblyWasteByAssembly: false,
    diecutWasteByBoxAmount: false,
    fourColourPriceByMaxPercent: false,
    costMultiplier: '1',
    digitalDiecutBlock: 'none',
    digitalFinishMethod: 'sheet_area',
    digitalPaperMethod: 'auto',
    digitalPrintBand: 'sheets',
    digitalPrintByMaterial: false,
    digitalPrintMethod: 'sheet_area',
    minLotPrice: null,
    trimDlMm: '0',
    trimDwMm: '0',
    usePaperAmountForCal: false,
    bulkLeadTimeDays: null,
    bulkLeadTimeMinQty: null,
  });
  /** Rows every print type needs: trims, paper, inks and the waste tables. */
  const common = (pt: string, paper: PriceValues): [FinalLine['component'], PriceValues][] => {
    const scoped = { difficultyLevelId: difficulty.publicId, printTypeId: pt };
    return [
      [
        'paper_trims',
        {
          printTypeId: pt,
          gapMm: '3',
          trimWMm: '10',
          trimLMm: '12',
          edgeTrimMm: '5',
          trimFoilMm: '4',
          trimFinishPlateMm: '6',
          endJobTrimMm: null,
        },
      ],
      [
        'material_prices',
        {
          materialId: material.publicId,
          printTypeId: pt,
          minPaperAmount: null,
          maxPaperAmount: null,
          ...paper,
        },
      ],
      ['paper_sizes', { materialId: material.publicId, printTypeId: pt, sizeWIn: '31', sizeLIn: '43' }],
      ['ink_colours', { inkColourId: cmyk.publicId, printTypeId: pt, isStandard: true }],
      [
        'print_wastes',
        {
          ...scoped,
          minPercentPrint: '0',
          maxPercentPrint: '100',
          ...all,
          percentWaste: '10',
          setupWaste: 50,
        },
      ],
      ['finish_wastes', { ...scoped, finishId: null, ...all, percentWaste: '5', setupWaste: 20 }],
      [
        'diecut_wastes',
        {
          ...scoped,
          diecutTypeId: diecut.publicId,
          ...all,
          minBoxAmount: null,
          maxBoxAmount: null,
          percentWaste: '2',
          setupWaste: 30,
        },
      ],
      ['assembly_wastes', { ...scoped, assemblyId: null, ...all, percentWaste: '1', setupWaste: 10 }],
    ];
  };
  const op = offset.publicId;
  const dg = digital.publicId;
  const offsetScoped = { difficultyLevelId: difficulty.publicId, printTypeId: op };
  const digitalScoped = { difficultyLevelId: difficulty.publicId, printTypeId: dg };
  const printPrice = {
    ...all,
    minBoxAmount: null,
    maxBoxAmount: null,
    materialId: null,
    priceColorCombineSpecialColor: '0',
    addTwoSidePerSqm: null,
  };
  const finishPrice = {
    ...all,
    machineId: null,
    finishPrice: '0',
    toolingPrice: '0',
    blockPricePerIn2: '0',
    materialPricePerIn2: '0',
    operationCost: '0',
    addsDiecutWindow: false,
  };
  const assemblyPrice = {
    difficultyLevelId: difficulty.publicId,
    assemblyId: hole.publicId,
    rangeAmountMin: null,
    rangeAmountMax: null,
    minAreaSqcm: null,
    maxAreaSqcm: null,
    assemblyType: 3,
    addsDiecutWindow: false,
    pricePerCm: null,
    pricePerPcs: '0.05',
    minPrice: '150',
    minimumOperation: null,
    blockPrice: null,
    materialPricePerIn2: null,
    digitalMethod: 'per_piece',
  };
  const rows: [FinalLine['component'], PriceValues][] = [
    ['print_type_terms', terms(op, 'a_offset')],
    ['print_type_terms', terms(dg, 'a_digital')],
    [
      'paper_sheets',
      { sizeWIn: '31', sizeLIn: '43', sheetCut: 1, sheetWIn: '31', sheetLIn: '43', isFixGrain: false },
    ],
    [
      'paper_sheets',
      { sizeWIn: '31', sizeLIn: '43', sheetCut: 4, sheetWIn: '15.5', sheetLIn: '21.5', isFixGrain: false },
    ],
    ...common(op, { costPerKg: '30', costPerPcs: null, costPerM2: null }),
    ...common(dg, { costPerKg: null, costPerPcs: null, costPerM2: '12' }),
    // Offset: plates, a 4-colour flat price, matt lamination, foil with its plate, die-cut and block, the hole.
    [
      'print_plates',
      {
        ...offsetScoped,
        machineId: press.publicId,
        plateWMinIn: '10',
        plateWMaxIn: '35',
        plateLMinIn: '15',
        plateLMaxIn: '45',
        platePrice: '400',
      },
    ],
    [
      'print_prices',
      {
        ...offsetScoped,
        ...printPrice,
        machineId: press.publicId,
        inkColourId: cmyk.publicId,
        percentColor: '100',
        pricePerSheet: '1',
        pricePerPcs: '0.4',
        flatPriceFourColor: '700',
        flatPriceFourColorPerPcs: '0.2',
        operationCost: '100',
        priceInkPerM2: null,
      },
    ],
    [
      'finish_prices',
      {
        ...offsetScoped,
        ...finishPrice,
        finishId: matt.publicId,
        pricePerSheet: '0.5',
        priceByAreaPerIn2: '0.01',
        minPrice: '200',
        toolingPrice: '100',
        operationCost: '30',
      },
    ],
    [
      'finish_prices',
      {
        ...offsetScoped,
        ...finishPrice,
        finishId: foil.publicId,
        machineId: foiler.publicId,
        finishPrice: '500',
        pricePerSheet: '0.8',
        priceByAreaPerIn2: '0',
        minPrice: '800',
        toolingPrice: '200',
        materialPricePerIn2: '0.004',
        operationCost: '60',
      },
    ],
    [
      'finish_plates',
      {
        ...offsetScoped,
        finishId: foil.publicId,
        machineId: foiler.publicId,
        plateWMinIn: '10',
        plateWMaxIn: '35',
        plateLMinIn: '15',
        plateLMaxIn: '45',
        pricePerIn2: '2',
        minPlatePrice: '600',
      },
    ],
    [
      'diecut_prices',
      {
        ...offsetScoped,
        machineId: cutter.publicId,
        ...all,
        diecutPrice: '300',
        pricePerSheet: '0.4',
        operationCost: '50',
        pricePerPcs: null,
        minPrice: null,
      },
    ],
    [
      'diecut_block_prices',
      {
        ...offsetScoped,
        machineId: cutter.publicId,
        blockWMinIn: '10',
        blockWMaxIn: '35',
        blockLMinIn: '15',
        blockLMaxIn: '45',
        layMin: 1,
        layMax: 200,
        minPcs: null,
        maxPcs: null,
        diecutPrice: '900',
        pricePerDrawing: '5',
        pricePerPcs: null,
        minDiecutPrice: null,
      },
    ],
    // The offset row first: offset assembly prices ignore the print type and take the first match (legacy).
    ['assembly_prices', { ...assemblyPrice, printTypeId: null }],
    // Digital: ink per m², matt by area, die-cut per sheet, the hole on the digital print type.
    [
      'print_prices',
      {
        ...digitalScoped,
        ...printPrice,
        machineId: digitalPress.publicId,
        inkColourId: cmyk.publicId,
        percentColor: null,
        pricePerSheet: null,
        pricePerPcs: null,
        flatPriceFourColor: null,
        flatPriceFourColorPerPcs: null,
        operationCost: null,
        priceInkPerM2: '30',
      },
    ],
    [
      'finish_prices',
      {
        ...digitalScoped,
        ...finishPrice,
        finishId: matt.publicId,
        pricePerSheet: '2',
        priceByAreaPerIn2: '0.006',
        minPrice: '150',
      },
    ],
    [
      'diecut_prices',
      {
        ...digitalScoped,
        machineId: digitalCutter.publicId,
        ...all,
        diecutPrice: '400',
        pricePerSheet: '1.5',
        operationCost: '0',
        pricePerPcs: '0',
        minPrice: '250',
      },
    ],
    ['assembly_prices', { ...assemblyPrice, printTypeId: dg, pricePerPcs: '0.08', minPrice: '100' }],
  ];
  const registry = new PriceComponentRegistry();
  for (const d of FOLDING_PRICE_COMPONENTS) registry.register(d);
  const lines: FinalLine[] = rows.map(([component, raw]) => {
    const d = registry.get(component)!;
    const { values, errors } = normaliseColumns([...d.dimensions, ...d.values], raw, component);
    if (errors.length > 0) throw new Error(`dev tag & sleeve ${component}: ${JSON.stringify(errors)}`);
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

  // getpack's sell side for tags & sleeves (fake values; D-063 admins set the real ones). No structure fee (T18).
  const sellVersion = { versionNo: 1, effectiveFrom: DEV_EFFECTIVE_FROM, reason: 'dev seed (fake)' };
  const margin = await tx.sellMarginTable.create({
    data: {
      productTypeId: tag.id,
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
    ['design_fee', 1000],
  ] as const) {
    await tx.sellMarginTable.create({
      data: {
        productTypeId: tag.id,
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

async function describe(tx: Tx, factoryId: bigint): Promise<DevTagSleeve> {
  const factory = await tx.factory.findUniqueOrThrow({ where: { id: factoryId } });
  const version = await tx.priceListVersion.findFirstOrThrow({
    where: { priceList: { factoryId, productType: { code: 'tag_sleeve' } } },
    orderBy: { versionNo: 'desc' },
  });
  const one = async <T extends { publicId: string }>(p: Promise<T>) => (await p).publicId;
  return {
    factoryPublicId: factory.publicId,
    patternPublicId: await one(tx.pattern.findUniqueOrThrow({ where: { code: 'DEV-TAG' } })),
    materialPublicId: await one(tx.material.findUniqueOrThrow({ where: { code: 'dev-art-350' } })),
    difficultyLevelPublicId: await one(
      tx.difficultyLevel.findUniqueOrThrow({ where: { code: 'dev-normal' } }),
    ),
    inkColourPublicId: await one(tx.inkColour.findUniqueOrThrow({ where: { code: 'dev-cmyk' } })),
    finishPublicId: await one(tx.finish.findUniqueOrThrow({ where: { code: 'dev-matt' } })),
    foilPublicId: await one(tx.finish.findUniqueOrThrow({ where: { code: 'dev-foil' } })),
    diecutTypePublicId: await one(tx.diecutType.findUniqueOrThrow({ where: { code: 'dev-diecut' } })),
    holePublicId: await one(tx.assembly.findUniqueOrThrow({ where: { code: 'dev-hole-3mm' } })),
    offsetPrintTypePublicId: await one(tx.printType.findUniqueOrThrow({ where: { code: 'dev_tag_offset' } })),
    digitalPrintTypePublicId: await one(
      tx.printType.findUniqueOrThrow({ where: { code: 'dev_tag_digital' } }),
    ),
    catalogProductPublicId: await one(
      tx.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-hang-tag' } }),
    ),
    priceListVersionId: version.id,
  };
}
