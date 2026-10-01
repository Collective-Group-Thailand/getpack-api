import { type Prisma } from '../../src/generated/prisma/client';
import {
  lineKeyOf,
  normaliseColumns,
  PriceComponentRegistry,
  type PriceValues,
} from '../../src/modules/partners/pricing/price-component.registry';
import { type FinalLine, PriceListBuilder } from '../../src/modules/partners/pricing/price-list-builder';
import { FOLDING_PRICE_COMPONENTS } from '../../src/modules/pricing/calculators/folding/price-components';
import { LABEL_PRICE_COMPONENTS } from '../../src/modules/pricing/calculators/label/price-components';

type Tx = Prisma.TransactionClient;

const DEV_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00+07:00');

export interface DevLabel {
  factoryPublicId: string;
  labelStockPublicId: string;
  difficultyLevelPublicId: string;
  inkColourPublicId: string;
  coatingPublicId: string;
  diecutTypePublicId: string;
  digitalPrintTypePublicId: string;
  offsetPrintTypePublicId: string;
  catalogProductPublicId: string;
  priceListVersionId: bigint;
}

/**
 * An obviously fake label setup for `pnpm dev` and the tests (D-005, U-B6 label): `[DEV]` names, made-up prices.
 * It extends the dev folding factory F9001 (one launch factory serves every type, D-101) with a tier-A label price
 * list for a digital print type (sheets 13 × 19″ and a 13″ roll) and an offset print type that is not priced
 * (quirk L2), capacity and Packio sell margins, so a sticker on a fake PP label stock can be priced end to end.
 * Idempotent. Needs `seedDevFolding` (factory, `dev-cmyk`, `dev-normal`, `dev-diecut`) and the dev catalogue
 * (`dev-matt`).
 */
export async function seedDevLabel(tx: Tx): Promise<{ created: boolean; fixture: DevLabel }> {
  const label = await tx.productType.findUniqueOrThrow({ where: { code: 'label_sticker' } });
  const factory = await tx.factory.findUniqueOrThrow({ where: { code: 'F9001' } });
  const cmyk = await tx.inkColour.findUniqueOrThrow({ where: { code: 'dev-cmyk' } });
  const matt = await tx.finish.findUniqueOrThrow({ where: { code: 'dev-matt' } });
  const difficulty = await tx.difficultyLevel.findUniqueOrThrow({ where: { code: 'dev-normal' } });
  const diecut = await tx.diecutType.findUniqueOrThrow({ where: { code: 'dev-diecut' } });
  if (await tx.printType.findUnique({ where: { code: 'dev_label_digital' } })) {
    return { created: false, fixture: await describe(tx, factory.id) };
  }
  if (label.status !== 'active')
    await tx.productType.update({ where: { id: label.id }, data: { status: 'active' } });

  const printType = (code: string, nameTh: string, nameEn: string) =>
    tx.printType.create({ data: { code, productTypeId: label.id, nameTh, nameEn, status: 'active' } });
  const digital = await printType('dev_label_digital', '[DEV] ดิจิทัล สติ๊กเกอร์', '[DEV] Digital label');
  const offset = await printType('dev_label_offset', '[DEV] ออฟเซ็ต สติ๊กเกอร์', '[DEV] Offset label');
  const stock = await tx.material.create({
    data: {
      code: 'dev-pp-white-80',
      kind: 'label_stock',
      nameTh: '[DEV] สติ๊กเกอร์ PP ขาว',
      nameEn: '[DEV] White PP label stock',
      gsm: 80,
      status: 'active',
    },
  });
  const press = await tx.factoryMachine.create({
    data: { factoryId: factory.id, name: '[DEV] Digital label press', printTypeId: digital.id },
  });
  const cutter = await tx.factoryMachine.create({
    data: { factoryId: factory.id, name: '[DEV] Label die cutter', printTypeId: digital.id },
  });
  await tx.catalogProduct.create({
    data: {
      productTypeId: label.id,
      slug: 'dev-sticker',
      nameTh: '[DEV] สติ๊กเกอร์ทดสอบ',
      nameEn: '[DEV] Test sticker',
      templateAvailability: 'drawing',
      status: 'active',
      defaultDifficultyLevelId: difficulty.id,
      options: { create: [{ optionKind: 'material', optionId: stock.id, isDefault: true }] },
    },
  });
  for (const pt of [digital, offset]) {
    await tx.factoryCapability.create({
      data: { factoryId: factory.id, productTypeId: label.id, printTypeId: pt.id, status: 'active' },
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
      productTypeId: label.id,
      versions: { create: { ...approved, tier: 'A' } },
    },
  });
  await tx.factoryCapacity.create({
    data: {
      factoryId: factory.id,
      productTypeId: label.id,
      versions: { create: { ...approved, capacityUnit: 'pieces', weeklyCapacity: 5000000 } },
    },
  });
  const list = await tx.priceList.create({ data: { factoryId: factory.id, productTypeId: label.id } });
  const version = await tx.priceListVersion.create({
    data: {
      priceListId: list.id,
      versionNo: 1,
      origin: 'factory_proposal',
      effectiveFrom: DEV_EFFECTIVE_FROM,
      reason: 'dev seed (fake prices)',
    },
  });
  const dg = digital.publicId;
  const scoped = { difficultyLevelId: difficulty.publicId, printTypeId: dg };
  const all = { minPaperSheetAmount: null, maxPaperSheetAmount: null };
  const terms = (printTypeId: string, engineVariant: 'digital' | 'offset'): PriceValues => ({
    printTypeId,
    engineVariant,
    factoryMarginPct: '15',
    minOrderAmount: 100,
    minSheetPerJob: 0,
    leadTimeDays: '4',
    bulkLeadTimeMinQty: null,
    bulkLeadTimeDays: null,
    wasteMethod: 1,
    diecutAvailable: true,
    minRollLengthM: '300',
  });
  const rows: [FinalLine['component'], PriceValues][] = [
    ['label_print_type_terms', terms(dg, 'digital')],
    ['label_print_type_terms', terms(offset.publicId, 'offset')],
    [
      'paper_trims',
      {
        printTypeId: dg,
        gapMm: '3',
        trimWMm: '5',
        trimLMm: '5',
        edgeTrimMm: '2',
        trimFoilMm: '0',
        trimFinishPlateMm: '0',
        endJobTrimMm: '10',
      },
    ],
    [
      'material_prices',
      {
        materialId: stock.publicId,
        printTypeId: dg,
        minPaperAmount: null,
        maxPaperAmount: null,
        costPerKg: null,
        costPerPcs: null,
        costPerM2: '14',
      },
    ],
    ['paper_sizes', { materialId: stock.publicId, printTypeId: dg, sizeWIn: '13', sizeLIn: '19' }],
    ['paper_sizes', { materialId: stock.publicId, printTypeId: dg, sizeWIn: '13', sizeLIn: '0' }],
    [
      'label_paper_sheets',
      { sizeWIn: '13', sizeLIn: '19', sheetCut: 1, sheetWIn: '13', sheetLIn: '19', sheetCutLengthIn: '0' },
    ],
    [
      'label_paper_sheets',
      { sizeWIn: '13', sizeLIn: '0', sheetCut: 1, sheetWIn: '13', sheetLIn: '0', sheetCutLengthIn: '0' },
    ],
    ['ink_colours', { inkColourId: cmyk.publicId, printTypeId: dg, isStandard: true }],
    [
      'print_wastes',
      { ...scoped, minPercentPrint: null, maxPercentPrint: null, ...all, percentWaste: '8', setupWaste: 10 },
    ],
    ['finish_wastes', { ...scoped, finishId: null, ...all, percentWaste: '3', setupWaste: 4 }],
    [
      'diecut_wastes',
      {
        ...scoped,
        diecutTypeId: diecut.publicId,
        ...all,
        minBoxAmount: null,
        maxBoxAmount: null,
        percentWaste: '2',
        setupWaste: 6,
      },
    ],
    [
      'print_prices',
      {
        ...scoped,
        machineId: press.publicId,
        inkColourId: cmyk.publicId,
        percentColor: null,
        ...all,
        minBoxAmount: null,
        maxBoxAmount: null,
        materialId: null,
        pricePerSheet: null,
        pricePerPcs: null,
        flatPriceFourColor: null,
        flatPriceFourColorPerPcs: null,
        priceColorCombineSpecialColor: null,
        operationCost: null,
        priceInkPerM2: '35',
        addTwoSidePerSqm: null,
      },
    ],
    ['label_roll_print_prices', { ...scoped, inkColourId: cmyk.publicId, pricePerM2: '26' }],
    [
      'finish_prices',
      {
        ...scoped,
        finishId: matt.publicId,
        machineId: null,
        ...all,
        finishPrice: null,
        pricePerSheet: null,
        priceByAreaPerIn2: '0.015',
        minPrice: null,
        toolingPrice: null,
        blockPricePerIn2: null,
        materialPricePerIn2: null,
        operationCost: null,
        addsDiecutWindow: false,
      },
    ],
    [
      'label_diecut_prices',
      {
        ...scoped,
        diecutTypeId: diecut.publicId,
        ...all,
        minBoxAmount: null,
        maxBoxAmount: null,
        diecutPrice: '350',
        pricePerM2: null,
      },
    ],
    [
      'label_diecut_prices',
      {
        ...scoped,
        diecutTypeId: null,
        ...all,
        minBoxAmount: null,
        maxBoxAmount: null,
        diecutPrice: null,
        pricePerM2: '7',
      },
    ],
    [
      'diecut_block_prices',
      {
        ...scoped,
        machineId: cutter.publicId,
        blockWMinIn: '0',
        blockWMaxIn: '20',
        blockLMinIn: '0',
        blockLMaxIn: '20',
        layMin: null,
        layMax: null,
        minPcs: null,
        maxPcs: null,
        diecutPrice: '450',
        pricePerDrawing: '0',
        pricePerPcs: null,
        minDiecutPrice: null,
      },
    ],
  ];
  const registry = new PriceComponentRegistry();
  for (const d of [...FOLDING_PRICE_COMPONENTS, ...LABEL_PRICE_COMPONENTS]) registry.register(d);
  const lines: FinalLine[] = rows.map(([component, raw]) => {
    const d = registry.get(component)!;
    const { values, errors } = normaliseColumns([...d.dimensions, ...d.values], raw, component);
    if (errors.length > 0) throw new Error(`dev label ${component}: ${JSON.stringify(errors)}`);
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

  // Packio's sell side for labels (fake values; D-063 admins set the real ones).
  const sellVersion = { versionNo: 1, effectiveFrom: DEV_EFFECTIVE_FROM, reason: 'dev seed (fake)' };
  const margin = await tx.sellMarginTable.create({
    data: {
      productTypeId: label.id,
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
      { versionId: margin.versions[0]!.id, qtyMin: 1000, qtyMax: null, valuePct: 28 },
    ],
  });
  await tx.sellMarginTableVersion.update({
    where: { id: margin.versions[0]!.id },
    data: { status: 'approved', decidedAt: new Date() },
  });
  for (const [kind, amount] of [
    ['fix_cost', 0],
    ['design_fee', 800],
  ] as const) {
    await tx.sellMarginTable.create({
      data: {
        productTypeId: label.id,
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

async function describe(tx: Tx, factoryId: bigint): Promise<DevLabel> {
  const factory = await tx.factory.findUniqueOrThrow({ where: { id: factoryId } });
  const version = await tx.priceListVersion.findFirstOrThrow({
    where: { priceList: { factoryId, productType: { code: 'label_sticker' } } },
    orderBy: { versionNo: 'desc' },
  });
  const one = async <T extends { publicId: string }>(p: Promise<T>) => (await p).publicId;
  return {
    factoryPublicId: factory.publicId,
    labelStockPublicId: await one(tx.material.findUniqueOrThrow({ where: { code: 'dev-pp-white-80' } })),
    difficultyLevelPublicId: await one(
      tx.difficultyLevel.findUniqueOrThrow({ where: { code: 'dev-normal' } }),
    ),
    inkColourPublicId: await one(tx.inkColour.findUniqueOrThrow({ where: { code: 'dev-cmyk' } })),
    coatingPublicId: await one(tx.finish.findUniqueOrThrow({ where: { code: 'dev-matt' } })),
    diecutTypePublicId: await one(tx.diecutType.findUniqueOrThrow({ where: { code: 'dev-diecut' } })),
    digitalPrintTypePublicId: await one(
      tx.printType.findUniqueOrThrow({ where: { code: 'dev_label_digital' } }),
    ),
    offsetPrintTypePublicId: await one(
      tx.printType.findUniqueOrThrow({ where: { code: 'dev_label_offset' } }),
    ),
    catalogProductPublicId: await one(
      tx.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-sticker' } }),
    ),
    priceListVersionId: version.id,
  };
}
