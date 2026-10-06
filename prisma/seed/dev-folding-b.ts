import { type Prisma } from '../../src/generated/prisma/client';
import {
  lineKeyOf,
  normaliseColumns,
  PriceComponentRegistry,
  type PriceValues,
} from '../../src/modules/partners/pricing/price-component.registry';
import { type FinalLine, PriceListBuilder } from '../../src/modules/partners/pricing/price-list-builder';
import { FOLDING_PRICE_COMPONENTS } from '../../src/modules/pricing/calculators/folding/price-components';
import { seedDevOnboardingSteps } from './dev-folding';

type Tx = Prisma.TransactionClient;

const DEV_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00+07:00');

export interface DevFoldingB {
  factoryPublicId: string;
  printTypePublicId: string;
  priceListVersionId: bigint;
}

/**
 * An obviously fake **type-B** folding factory for `pnpm dev` and the tests (D-005, U-B6 tail, D-233): `[DEV]` names, a
 * `dev` code, made-up prices. Factory F9002 holds one print type with engine `b` and a complete B price list (its own
 * components, schema-design A-76, plus the folding lines engine B reads), so the dev folding configuration (flat blank on
 * art card, CMYK, matt lamination, die-cut) is priced by engine B once `pricing.folding_engine_b` is on. A separate
 * factory keeps the tier-A launch factory F9001 untouched. Idempotent. Needs `seedDevFolding` (pattern `DEV-FLAT`,
 * `dev-cmyk`, `dev-normal`, `dev-diecut`) and the dev catalogue (`dev-art-350`, `dev-matt`); Packio's folding sell
 * margins come from `seedDevFolding`.
 */
export async function seedDevFoldingB(tx: Tx): Promise<{ created: boolean; fixture: DevFoldingB }> {
  const folding = await tx.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
  const existing = await tx.factory.findUnique({ where: { code: 'F9002' } });
  if (existing) return { created: false, fixture: await describe(tx, existing.id) };
  const material = await tx.material.findUniqueOrThrow({ where: { code: 'dev-art-350' } });
  const matt = await tx.finish.findUniqueOrThrow({ where: { code: 'dev-matt' } });
  const cmyk = await tx.inkColour.findUniqueOrThrow({ where: { code: 'dev-cmyk' } });
  const difficulty = await tx.difficultyLevel.findUniqueOrThrow({ where: { code: 'dev-normal' } });
  const diecut = await tx.diecutType.findUniqueOrThrow({ where: { code: 'dev-diecut' } });

  const printType = await tx.printType.create({
    data: {
      code: 'dev_folding_b',
      productTypeId: folding.id,
      nameTh: '[DEV] ออฟเซ็ท โรงงานแบบ B',
      nameEn: '[DEV] Offset (type-B factory)',
      status: 'active',
    },
  });
  const vendor = await tx.vendor.create({
    data: {
      kind: 'factory',
      legalName: '[DEV] บริษัท โรงงานทดสอบ บี จำกัด',
      juristicType: 'company',
      taxId: '0999999999002',
      isVatRegistered: true,
    },
  });
  const factory = await tx.factory.create({
    data: {
      code: 'F9002',
      vendorId: vendor.id,
      legalName: '[DEV] บริษัท โรงงานทดสอบ บี จำกัด',
      tradeName: '[DEV] Type-B Test Factory',
      juristicType: 'company',
      taxId: '0999999999002',
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
    data: { factoryId: factory.id, name: '[DEV] B offset press', printTypeId: printType.id },
  });
  const cutter = await tx.factoryMachine.create({
    data: { factoryId: factory.id, name: '[DEV] B die cutter', printTypeId: printType.id },
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
        engineVariant: 'b',
        wasteMethod: 1,
        finish2StepDownWaste: false,
        canFlipPaperSize: false,
        disableOverlapLayout: false,
        factoryMarginPct: '12',
        minOrderAmount: null,
        minOrderForProduction: 500,
        leadTimeDays: '8',
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
        costPerKg: '31',
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
      'b_print_wastes',
      { ...scoped, inkColourId: cmyk.publicId, colourCount: 4, percentWaste: '3', setupWaste: 60 },
    ],
    ['finish_wastes', { ...scoped, finishId: matt.publicId, ...all, percentWaste: '2', setupWaste: 20 }],
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
        platePrice: '450',
      },
    ],
    [
      'b_print_prices',
      {
        ...scoped,
        machineId: press.publicId,
        inkColourId: cmyk.publicId,
        colourCount: 4,
        priceInkPerM2: '1.8',
        priceColorCombineSpecialColor: '0',
      },
    ],
    [
      'finish_prices',
      {
        ...scoped,
        finishId: matt.publicId,
        machineId: null,
        ...all,
        finishPrice: '0',
        pricePerSheet: '0',
        priceByAreaPerIn2: '0.004',
        minPrice: '1200',
        toolingPrice: '200',
        blockPricePerIn2: '0',
        materialPricePerIn2: '0',
        operationCost: '0',
        addsDiecutWindow: false,
      },
    ],
    [
      'diecut_prices',
      {
        ...scoped,
        machineId: cutter.publicId,
        ...all,
        diecutPrice: '6.5',
        pricePerSheet: '0',
        operationCost: '0',
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
        layMin: null,
        layMax: null,
        minPcs: null,
        maxPcs: null,
        diecutPrice: '1800',
        pricePerDrawing: '0',
        pricePerPcs: null,
        minDiecutPrice: null,
      },
    ],
    [
      'code_margins',
      { printTypeId: pt, maxRangeContPct: '20', codeName: '[DEV] C2', minContBahtPerLot: '800' },
    ],
    [
      'code_margins',
      { printTypeId: pt, maxRangeContPct: '35', codeName: '[DEV] C3', minContBahtPerLot: '1500' },
    ],
  ];
  const registry = new PriceComponentRegistry();
  for (const d of FOLDING_PRICE_COMPONENTS) registry.register(d);
  const lines: FinalLine[] = rows.map(([component, raw]) => {
    const d = registry.get(component)!;
    const { values, errors } = normaliseColumns([...d.dimensions, ...d.values], raw, component);
    if (errors.length > 0) throw new Error(`dev folding B ${component}: ${JSON.stringify(errors)}`);
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
  return { created: true, fixture: await describe(tx, factory.id) };
}

async function describe(tx: Tx, factoryId: bigint): Promise<DevFoldingB> {
  const factory = await tx.factory.findUniqueOrThrow({ where: { id: factoryId } });
  const version = await tx.priceListVersion.findFirstOrThrow({
    where: { priceList: { factoryId } },
    orderBy: { versionNo: 'desc' },
  });
  const printType = await tx.printType.findUniqueOrThrow({ where: { code: 'dev_folding_b' } });
  return {
    factoryPublicId: factory.publicId,
    printTypePublicId: printType.publicId,
    priceListVersionId: version.id,
  };
}
