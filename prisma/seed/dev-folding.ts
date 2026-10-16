import { type Prisma } from '../../src/generated/prisma/client';
import { ONBOARDING_STEPS } from '../../src/modules/partners/factories/factories.dto';
import {
  lineKeyOf,
  normaliseColumns,
  PriceComponentRegistry,
  type PriceValues,
} from '../../src/modules/partners/pricing/price-component.registry';
import { type FinalLine, PriceListBuilder } from '../../src/modules/partners/pricing/price-list-builder';
import { FOLDING_PRICE_COMPONENTS } from '../../src/modules/pricing/calculators/folding/price-components';

type Tx = Prisma.TransactionClient;

/** Seeded dev versions apply from here (before any activity), like the reference seed. */
const DEV_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00+07:00');

export interface DevFolding {
  factoryPublicId: string;
  patternPublicId: string;
  materialPublicId: string;
  difficultyLevelPublicId: string;
  inkColourPublicId: string;
  finishPublicId: string;
  diecutTypePublicId: string;
  printTypePublicId: string;
  priceListVersionId: bigint;
}

/**
 * An obviously fake folding factory for `pnpm dev` and the tests (D-005): `[DEV]` names, `dev` codes,
 * made-up prices. One active factory with a tier-A offset price list, capacity and getpack sell margins,
 * so a flat blank on art card with CMYK, matt lamination and die-cut can be priced end to end.
 * Idempotent: returns the existing fixture when present. Needs the dev catalogue (`dev-art-350`,
 * `dev-matt`) and the reference seed (product types, `vat_standard`).
 */
export async function seedDevFolding(tx: Tx): Promise<{ created: boolean; fixture: DevFolding }> {
  const folding = await tx.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
  const material = await tx.material.findUniqueOrThrow({ where: { code: 'dev-art-350' } });
  const finish = await tx.finish.findUniqueOrThrow({ where: { code: 'dev-matt' } });
  const existing = await tx.factory.findUnique({ where: { code: 'F9001' } });
  if (existing) return { created: false, fixture: await describe(tx, existing.id) };

  const printType = await tx.printType.create({
    data: {
      code: 'dev_folding_offset',
      productTypeId: folding.id,
      nameTh: '[DEV] ออฟเซ็ท',
      nameEn: '[DEV] Offset',
      status: 'active',
    },
  });
  const inkGroup = await tx.inkColourGroup.create({
    data: { code: 'dev-process', nameTh: '[DEV] สีพิมพ์', nameEn: '[DEV] Process inks', status: 'active' },
  });
  const cmyk = await tx.inkColour.create({
    data: {
      groupId: inkGroup.id,
      code: 'dev-cmyk',
      name: '[DEV] CMYK',
      colourKind: 'process',
      status: 'active',
    },
  });
  const diecutGroup = await tx.diecutGroup.create({
    data: { code: 'dev-diecut', nameTh: '[DEV] ไดคัท', nameEn: '[DEV] Die-cut', status: 'active' },
  });
  const diecut = await tx.diecutType.create({
    data: {
      groupId: diecutGroup.id,
      code: 'dev-diecut',
      nameTh: '[DEV] ไดคัททั่วไป',
      nameEn: '[DEV] Standard die-cut',
      status: 'active',
    },
  });
  const difficultyGroup = await tx.difficultyLevelGroup.create({
    data: { code: 'dev-difficulty', nameTh: '[DEV] ความยาก', nameEn: '[DEV] Difficulty', status: 'active' },
  });
  const difficulty = await tx.difficultyLevel.create({
    data: {
      groupId: difficultyGroup.id,
      code: 'dev-normal',
      nameTh: '[DEV] ปกติ',
      nameEn: '[DEV] Normal',
      status: 'active',
    },
  });
  await tx.pattern.create({
    data: {
      productTypeId: folding.id,
      code: 'DEV-FLAT',
      name: '[DEV] แผ่นเรียบ',
      constraints: {},
      geometryFormula: 'flat',
      status: 'active',
    },
  });

  const vendor = await tx.vendor.create({
    data: {
      kind: 'factory',
      legalName: '[DEV] บริษัท โรงงานทดสอบ จำกัด',
      juristicType: 'company',
      taxId: '0999999999001',
      isVatRegistered: true,
    },
  });
  const factory = await tx.factory.create({
    data: {
      code: 'F9001',
      vendorId: vendor.id,
      legalName: '[DEV] บริษัท โรงงานทดสอบ จำกัด',
      tradeName: '[DEV] Test Factory',
      juristicType: 'company',
      taxId: '0999999999001',
      isVatRegistered: true,
      status: 'active',
      activatedAt: new Date(),
    },
  });
  await seedDevOnboardingSteps(tx, factory.id);
  await tx.factoryCapability.create({
    data: { factoryId: factory.id, productTypeId: folding.id, printTypeId: printType.id, status: 'active' },
  });
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
      productTypeId: folding.id,
      versions: { create: { ...approved, tier: 'A' } },
    },
  });
  await tx.factoryCapacity.create({
    data: {
      factoryId: factory.id,
      productTypeId: folding.id,
      versions: { create: { ...approved, capacityUnit: 'pieces', weeklyCapacity: 1000000 } },
    },
  });
  const press = await tx.factoryMachine.create({
    data: { factoryId: factory.id, name: '[DEV] Offset press', printTypeId: printType.id },
  });
  const cutter = await tx.factoryMachine.create({
    data: { factoryId: factory.id, name: '[DEV] Die cutter', printTypeId: printType.id },
  });

  const list = await tx.priceList.create({ data: { factoryId: factory.id, productTypeId: folding.id } });
  const version = await tx.priceListVersion.create({
    data: {
      priceListId: list.id,
      versionNo: 1,
      origin: 'factory_proposal',
      effectiveFrom: DEV_EFFECTIVE_FROM,
      reason: 'dev seed (fake prices)',
    },
  });
  const pt = printType.publicId;
  const scoped = { difficultyLevelId: difficulty.publicId, printTypeId: pt };
  const all = { minPaperSheetAmount: null, maxPaperSheetAmount: null };
  const rows: [FinalLine['component'], PriceValues][] = [
    [
      'print_type_terms',
      {
        printTypeId: pt,
        engineVariant: 'a_offset',
        wasteMethod: 1,
        finish2StepDownWaste: false,
        canFlipPaperSize: false,
        disableOverlapLayout: false,
        factoryMarginPct: '10',
        minOrderAmount: null,
        minOrderForProduction: 500,
        leadTimeDays: '7',
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
      },
    ],
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
        costPerKg: '30',
        costPerPcs: null,
        costPerM2: null,
      },
    ],
    ['paper_sizes', { materialId: material.publicId, printTypeId: pt, sizeWIn: '31', sizeLIn: '43' }],
    [
      'paper_sheets',
      { sizeWIn: '31', sizeLIn: '43', sheetCut: 1, sheetWIn: '31', sheetLIn: '43', isFixGrain: false },
    ],
    [
      'paper_sheets',
      { sizeWIn: '31', sizeLIn: '43', sheetCut: 2, sheetWIn: '21.5', sheetLIn: '31', isFixGrain: false },
    ],
    ['ink_colours', { inkColourId: cmyk.publicId, printTypeId: pt, isStandard: true }],
    [
      'print_wastes',
      { ...scoped, minPercentPrint: '0', maxPercentPrint: '100', ...all, percentWaste: '10', setupWaste: 50 },
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
    [
      'print_plates',
      {
        ...scoped,
        machineId: press.publicId,
        plateWMinIn: '15',
        plateWMaxIn: '35',
        plateLMinIn: '20',
        plateLMaxIn: '45',
        platePrice: '500',
      },
    ],
    [
      'print_prices',
      {
        ...scoped,
        machineId: press.publicId,
        inkColourId: cmyk.publicId,
        percentColor: '100',
        ...all,
        minBoxAmount: null,
        maxBoxAmount: null,
        materialId: null,
        pricePerSheet: '1',
        pricePerPcs: '0.5',
        flatPriceFourColor: '800',
        flatPriceFourColorPerPcs: '0.2',
        priceColorCombineSpecialColor: '0',
        operationCost: '100',
        priceInkPerM2: null,
        addTwoSidePerSqm: null,
      },
    ],
    [
      'finish_prices',
      {
        ...scoped,
        finishId: finish.publicId,
        machineId: null,
        ...all,
        finishPrice: '0',
        pricePerSheet: '0.5',
        priceByAreaPerIn2: '0.01',
        minPrice: '200',
        toolingPrice: '100',
        blockPricePerIn2: '0',
        materialPricePerIn2: '0',
        operationCost: '30',
        addsDiecutWindow: false,
      },
    ],
    [
      'diecut_prices',
      {
        ...scoped,
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
        ...scoped,
        machineId: cutter.publicId,
        blockWMinIn: '15',
        blockWMaxIn: '35',
        blockLMinIn: '20',
        blockLMaxIn: '45',
        layMin: 1,
        layMax: 40,
        minPcs: null,
        maxPcs: null,
        diecutPrice: '1000',
        pricePerDrawing: '20',
        pricePerPcs: null,
        minDiecutPrice: null,
      },
    ],
  ];
  const registry = new PriceComponentRegistry();
  for (const d of FOLDING_PRICE_COMPONENTS) registry.register(d);
  const lines: FinalLine[] = rows.map(([component, raw]) => {
    const d = registry.get(component)!;
    const { values, errors } = normaliseColumns([...d.dimensions, ...d.values], raw, component);
    if (errors.length > 0) throw new Error(`dev folding ${component}: ${JSON.stringify(errors)}`);
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

  // getpack's sell side for folding (fake values; D-063 admins set the real ones).
  const sellTable = async (
    kind: 'margin' | 'fix_cost' | 'design_fee' | 'structure_design_fee',
    version: Prisma.SellMarginTableVersionCreateWithoutTableInput,
  ) =>
    tx.sellMarginTable.create({
      data: {
        productTypeId: folding.id,
        kind,
        description: `[DEV] ${kind}`,
        decisionRefs: ['D-063'],
        versions: { create: version },
      },
    });
  const sellVersion = { versionNo: 1, effectiveFrom: DEV_EFFECTIVE_FROM, reason: 'dev seed (fake)' };
  const margin = await sellTable('margin', { ...sellVersion, fallbackPct: 30 });
  const marginVersion = await tx.sellMarginTableVersion.findFirstOrThrow({ where: { tableId: margin.id } });
  await tx.sellMarginLine.createMany({
    data: [
      { versionId: marginVersion.id, qtyMin: 1, qtyMax: 999, valuePct: 35 },
      { versionId: marginVersion.id, qtyMin: 1000, qtyMax: null, valuePct: 25 },
    ],
  });
  await tx.sellMarginTableVersion.update({
    where: { id: marginVersion.id },
    data: { status: 'approved', decidedAt: new Date() },
  });
  for (const [kind, amount] of [
    ['fix_cost', 0],
    ['design_fee', 2500],
    ['structure_design_fee', 1500],
  ] as const) {
    await sellTable(kind, {
      ...sellVersion,
      fallbackAmount: amount,
      status: 'approved',
      decidedAt: new Date(),
    });
  }
  return { created: true, fixture: await describe(tx, factory.id) };
}

/**
 * An active dev factory has passed onboarding (D-011): every step approved, as the API leaves a factory it creates
 * and activates. Without the rows, admin edits that record a step (e.g. `admin.factories.replaceDeliveryZones`)
 * found nothing to update and answered 500 (getpack-web contract request `api.dev-seed-launch-path` (a)).
 */
export async function seedDevOnboardingSteps(tx: Tx, factoryId: bigint): Promise<void> {
  const now = new Date();
  await tx.factoryOnboardingStep.createMany({
    data: ONBOARDING_STEPS.map((step) => ({
      factoryId,
      step,
      status: 'approved' as const,
      completedAt: now,
    })),
    skipDuplicates: true,
  });
}

async function describe(tx: Tx, factoryId: bigint): Promise<DevFolding> {
  const factory = await tx.factory.findUniqueOrThrow({ where: { id: factoryId } });
  const version = await tx.priceListVersion.findFirstOrThrow({
    where: { priceList: { factoryId } },
    orderBy: { versionNo: 'desc' },
  });
  const one = async <T extends { publicId: string }>(p: Promise<T>) => (await p).publicId;
  return {
    factoryPublicId: factory.publicId,
    patternPublicId: await one(tx.pattern.findUniqueOrThrow({ where: { code: 'DEV-FLAT' } })),
    materialPublicId: await one(tx.material.findUniqueOrThrow({ where: { code: 'dev-art-350' } })),
    difficultyLevelPublicId: await one(
      tx.difficultyLevel.findUniqueOrThrow({ where: { code: 'dev-normal' } }),
    ),
    inkColourPublicId: await one(tx.inkColour.findUniqueOrThrow({ where: { code: 'dev-cmyk' } })),
    finishPublicId: await one(tx.finish.findUniqueOrThrow({ where: { code: 'dev-matt' } })),
    diecutTypePublicId: await one(tx.diecutType.findUniqueOrThrow({ where: { code: 'dev-diecut' } })),
    printTypePublicId: await one(tx.printType.findUniqueOrThrow({ where: { code: 'dev_folding_offset' } })),
    priceListVersionId: version.id,
  };
}
