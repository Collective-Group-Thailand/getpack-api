import { type Prisma } from '../../src/generated/prisma/client';
import {
  lineKeyOf,
  normaliseColumns,
  PriceComponentRegistry,
  type PriceValues,
} from '../../src/modules/partners/pricing/price-component.registry';
import { type FinalLine, PriceListBuilder } from '../../src/modules/partners/pricing/price-list-builder';
import { POUCH_PRICE_COMPONENTS } from '../../src/modules/pricing/calculators/pouch/price-components';

type Tx = Prisma.TransactionClient;

const DEV_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00+07:00');

export interface DevPouch {
  factoryPublicId: string;
  standUpPatternPublicId: string;
  threeSidePatternPublicId: string;
  filmPublicId: string;
  printColourPublicId: string;
  zipperPublicId: string;
  tearNotchPublicId: string;
  printTypePublicId: string;
  catalogProductPublicId: string;
  priceListVersionId: bigint;
}

/**
 * An obviously fake pouch setup for `pnpm dev` and the tests (D-005, U-B6 pouch): `[DEV]` names, made-up prices. It
 * extends the dev folding factory F9001 (one launch factory serves every type, D-101) with a tier-A `flexible_pouch`
 * price list for one roll-fed digital print type, a stand-up and a 3-side-seal pattern, a laminated film, a CMYK print
 * set, a zipper and a tear notch, capacity and getpack sell margins, so a stand-up pouch can be priced end to end.
 * Idempotent. Needs `seedDevFolding` (factory F9001, ink group `dev-process`).
 */
export async function seedDevPouch(tx: Tx): Promise<{ created: boolean; fixture: DevPouch }> {
  const pouch = await tx.productType.findUniqueOrThrow({ where: { code: 'flexible_pouch' } });
  const factory = await tx.factory.findUniqueOrThrow({ where: { code: 'F9001' } });
  const inkGroup = await tx.inkColourGroup.findUniqueOrThrow({ where: { code: 'dev-process' } });
  if (await tx.printType.findUnique({ where: { code: 'dev_pouch_digital' } })) {
    return { created: false, fixture: await describe(tx, factory.id) };
  }
  if (pouch.status !== 'active')
    await tx.productType.update({ where: { id: pouch.id }, data: { status: 'active' } });

  const printType = await tx.printType.create({
    data: {
      code: 'dev_pouch_digital',
      productTypeId: pouch.id,
      nameTh: '[DEV] ดิจิทัล ซอง',
      nameEn: '[DEV] Digital pouch',
      status: 'active',
    },
  });
  const pattern = (
    code: string,
    name: string,
    pouchFormula: 'stand_up' | 'three_side_seal',
    constraints: object,
  ) =>
    tx.pattern.create({
      // C7 (D-455): the engine drawing that opens these patterns in the Studio (`pouch`, @getpack/dieline aliases).
      data: {
        productTypeId: pouch.id,
        code,
        name,
        constraints,
        pouchFormula,
        dielineKey: pouchFormula === 'stand_up' ? 'pouch-standing' : 'pouch-3-seal',
        status: 'active',
      },
    });
  const standUp = await pattern('DEV-POUCH-STAND', '[DEV] ซองตั้งได้', 'stand_up', {
    minW: 80,
    maxW: 300,
    minL: 100,
    maxL: 350,
    minB: 40,
    maxB: 120,
  });
  const threeSide = await pattern('DEV-POUCH-3SS', '[DEV] ซองซีล 3 ด้าน', 'three_side_seal', {
    minW: 60,
    maxW: 300,
    minL: 80,
    maxL: 350,
  });
  const film = await tx.material.create({
    data: {
      code: 'dev-pet-lldpe-80',
      kind: 'film',
      nameTh: '[DEV] PET/LLDPE 80 ไมครอน',
      nameEn: '[DEV] PET/LLDPE 80 micron',
      micron: 80,
      status: 'active',
    },
  });
  const cmyk = await tx.inkColour.create({
    data: {
      groupId: inkGroup.id,
      code: 'dev-pouch-cmyk',
      name: '[DEV] CMYK digital (เงา)',
      colourKind: 'process',
      status: 'active',
    },
  });
  const optionGroup = await tx.assemblyGroup.create({
    data: {
      code: 'dev-pouch-options',
      nameTh: '[DEV] อุปกรณ์ซอง',
      nameEn: '[DEV] Pouch options',
      status: 'active',
    },
  });
  const option = (code: string, nameTh: string, nameEn: string) =>
    tx.assembly.create({ data: { groupId: optionGroup.id, code, nameTh, nameEn, status: 'active' } });
  const zipper = await option('dev-zipper', '[DEV] ซิป', '[DEV] Zipper');
  const notch = await option('dev-tear-notch', '[DEV] รอยฉีก', '[DEV] Tear notch');
  await tx.catalogProduct.create({
    data: {
      productTypeId: pouch.id,
      slug: 'dev-stand-up-pouch',
      nameTh: '[DEV] ซองตั้งได้ทดสอบ',
      nameEn: '[DEV] Test stand-up pouch',
      templateAvailability: 'drawing',
      status: 'active',
      patterns: { create: [{ patternId: standUp.id, sort: 0 }] },
      options: { create: [{ optionKind: 'material', optionId: film.id, isDefault: true }] },
    },
  });
  await tx.factoryCapability.create({
    data: { factoryId: factory.id, productTypeId: pouch.id, printTypeId: printType.id, status: 'active' },
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
      productTypeId: pouch.id,
      versions: { create: { ...approved, tier: 'A' } },
    },
  });
  await tx.factoryCapacity.create({
    data: {
      factoryId: factory.id,
      productTypeId: pouch.id,
      versions: { create: { ...approved, capacityUnit: 'pieces', weeklyCapacity: 500000 } },
    },
  });

  const list = await tx.priceList.create({ data: { factoryId: factory.id, productTypeId: pouch.id } });
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
  const band = { minQty: null, maxQty: null };
  const rows: [FinalLine['component'], PriceValues][] = [
    [
      'pouch_print_type_terms',
      {
        printTypeId: pt,
        toleranceMm: '25',
        minDlMm: '350',
        maxDlMm: '760',
        minMaterialLengthM: '250',
        setupLengthM: '120',
        webWidthMm: '760',
        minMaterialCost: '3000',
        bridgeMm: '5',
        factoryMarginPct: '18',
        leadTimeDays: '21',
        laminationRatePerM2: '4',
        laminationWebWidthM: '0.8',
        makingQtyThreshold: 10000,
        makingPricePerPcs: '0.2',
      },
    ],
    ['pouch_material_prices', { printTypeId: pt, materialId: film.publicId, pricePerCm2: '0.0012' }],
    ['pouch_print_prices', { printTypeId: pt, inkColourId: cmyk.publicId, pricePerCm2: '0.0045' }],
    [
      'pouch_option_prices',
      {
        printTypeId: pt,
        assemblyId: zipper.publicId,
        ...band,
        priceMode: 'zipper',
        pricePerPcs: null,
        pricePerCm: '0.25',
        pricePerCm2: null,
      },
    ],
    [
      'pouch_option_prices',
      {
        printTypeId: pt,
        assemblyId: notch.publicId,
        ...band,
        priceMode: 'per_piece',
        pricePerPcs: '0',
        pricePerCm: null,
        pricePerCm2: null,
      },
    ],
    ['pouch_process_prices', { printTypeId: pt, process: 'lamination', ...band, minPrice: '2500' }],
    ['pouch_process_prices', { printTypeId: pt, process: 'making', ...band, minPrice: '2500' }],
    ['pouch_min_quantities', { printTypeId: pt, minSqcm: null, maxSqcm: null, minQty: 1000 }],
    ['pouch_factory_margins', { printTypeId: pt, minQty: 1, maxQty: 2999, marginPct: '22' }],
    ['pouch_factory_margins', { printTypeId: pt, minQty: 3000, maxQty: null, marginPct: '15' }],
    ...[standUp, threeSide].flatMap((p) =>
      [zipper, notch].map((o): [FinalLine['component'], PriceValues] => [
        'pouch_option_rules',
        { printTypeId: pt, patternId: p.publicId, materialId: film.publicId, assemblyId: o.publicId },
      ]),
    ),
  ];
  const registry = new PriceComponentRegistry();
  for (const d of POUCH_PRICE_COMPONENTS) registry.register(d);
  const lines: FinalLine[] = rows.map(([component, raw]) => {
    const d = registry.get(component)!;
    const { values, errors } = normaliseColumns([...d.dimensions, ...d.values], raw, component);
    if (errors.length > 0) throw new Error(`dev pouch ${component}: ${JSON.stringify(errors)}`);
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

  // getpack's sell side for pouches (fake values; D-063 admins set the real ones). No structure fee.
  const sellVersion = { versionNo: 1, effectiveFrom: DEV_EFFECTIVE_FROM, reason: 'dev seed (fake)' };
  const margin = await tx.sellMarginTable.create({
    data: {
      productTypeId: pouch.id,
      kind: 'margin',
      description: '[DEV] margin',
      decisionRefs: ['D-063'],
      versions: { create: { ...sellVersion, fallbackPct: 20 } },
    },
    include: { versions: true },
  });
  await tx.sellMarginLine.createMany({
    data: [
      { versionId: margin.versions[0]!.id, qtyMin: 1, qtyMax: 4999, valuePct: 18 },
      { versionId: margin.versions[0]!.id, qtyMin: 5000, qtyMax: null, valuePct: 24 },
    ],
  });
  await tx.sellMarginTableVersion.update({
    where: { id: margin.versions[0]!.id },
    data: { status: 'approved', decidedAt: new Date() },
  });
  for (const [kind, amount] of [
    ['fix_cost', 0],
    ['design_fee', 1500],
  ] as const) {
    await tx.sellMarginTable.create({
      data: {
        productTypeId: pouch.id,
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

async function describe(tx: Tx, factoryId: bigint): Promise<DevPouch> {
  const factory = await tx.factory.findUniqueOrThrow({ where: { id: factoryId } });
  const version = await tx.priceListVersion.findFirstOrThrow({
    where: { priceList: { factoryId, productType: { code: 'flexible_pouch' } } },
    orderBy: { versionNo: 'desc' },
  });
  const one = async <T extends { publicId: string }>(p: Promise<T>) => (await p).publicId;
  return {
    factoryPublicId: factory.publicId,
    standUpPatternPublicId: await one(tx.pattern.findUniqueOrThrow({ where: { code: 'DEV-POUCH-STAND' } })),
    threeSidePatternPublicId: await one(tx.pattern.findUniqueOrThrow({ where: { code: 'DEV-POUCH-3SS' } })),
    filmPublicId: await one(tx.material.findUniqueOrThrow({ where: { code: 'dev-pet-lldpe-80' } })),
    printColourPublicId: await one(tx.inkColour.findUniqueOrThrow({ where: { code: 'dev-pouch-cmyk' } })),
    zipperPublicId: await one(tx.assembly.findUniqueOrThrow({ where: { code: 'dev-zipper' } })),
    tearNotchPublicId: await one(tx.assembly.findUniqueOrThrow({ where: { code: 'dev-tear-notch' } })),
    printTypePublicId: await one(tx.printType.findUniqueOrThrow({ where: { code: 'dev_pouch_digital' } })),
    catalogProductPublicId: await one(
      tx.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-stand-up-pouch' } }),
    ),
    priceListVersionId: version.id,
  };
}
