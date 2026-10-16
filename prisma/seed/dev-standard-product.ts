import { type Prisma } from '../../src/generated/prisma/client';
import {
  lineKeyOf,
  normaliseColumns,
  PriceComponentRegistry,
  type PriceValues,
} from '../../src/modules/partners/pricing/price-component.registry';
import { type FinalLine, PriceListBuilder } from '../../src/modules/partners/pricing/price-list-builder';
import { STANDARD_PRODUCT_PRICE_COMPONENTS } from '../../src/modules/pricing/calculators/standard-product/price-components';

type Tx = Prisma.TransactionClient;

const DEV_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00+07:00');

export interface DevStandardProduct {
  factoryPublicId: string;
  bottlePublicId: string;
  pouchPublicId: string;
  printTypePublicId: string;
  priceListVersionId: bigint;
}

/**
 * An obviously fake standard-product setup for `pnpm dev` and the tests (D-005, U-B6 standard product): `[DEV]` names,
 * made-up prices. It extends the dev folding factory F9001 (one launch factory serves every type, D-101) with a tier-A
 * `standard_product` price list: buy-price tiers for a bottle (sold by the piece, 18 g) and a stock pouch (sold by the
 * pouch), capacity and getpack sell margins (a flat 30 % fallback, fix cost 0.50 per piece, as legacy's single
 * `locopack_margin`). Idempotent. Needs `seedDevFolding` (factory F9001).
 */
export async function seedDevStandardProduct(
  tx: Tx,
): Promise<{ created: boolean; fixture: DevStandardProduct }> {
  const type = await tx.productType.findUniqueOrThrow({ where: { code: 'standard_product' } });
  const factory = await tx.factory.findUniqueOrThrow({ where: { code: 'F9001' } });
  if (await tx.printType.findUnique({ where: { code: 'dev_std_product' } })) {
    return { created: false, fixture: await describe(tx, factory.id) };
  }
  if (type.status !== 'active')
    await tx.productType.update({ where: { id: type.id }, data: { status: 'active' } });
  const printType = await tx.printType.create({
    data: {
      code: 'dev_std_product',
      productTypeId: type.id,
      nameTh: '[DEV] สินค้ามาตรฐาน',
      nameEn: '[DEV] Standard product',
      status: 'active',
    },
  });
  const stock = (
    sku: string,
    nameTh: string,
    nameEn: string,
    unit: 'piece' | 'pouch',
    weightG: number | null,
  ) =>
    tx.stockProduct.create({
      data: {
        productTypeId: type.id,
        sku,
        nameTh,
        nameEn,
        unit,
        weightG,
        minOrderQty: 100,
        status: 'active',
      },
    });
  const bottle = await stock('DEV-BTL-100', '[DEV] ขวด PET 100 มล.', '[DEV] PET bottle 100 ml', 'piece', 18);
  const pouch = await stock('DEV-POUCH-STD', '[DEV] ซองซิปใส', '[DEV] Clear zip pouch', 'pouch', null);
  await tx.factoryCapability.create({
    data: { factoryId: factory.id, productTypeId: type.id, printTypeId: printType.id, status: 'active' },
  });
  const approved = {
    versionNo: 1,
    effectiveFrom: DEV_EFFECTIVE_FROM,
    status: 'approved' as const,
    reason: 'dev seed (fake)',
    decidedAt: new Date(),
  };
  await tx.factoryParticipation.create({
    data: { factoryId: factory.id, productTypeId: type.id, versions: { create: { ...approved, tier: 'A' } } },
  });
  await tx.factoryCapacity.create({
    data: {
      factoryId: factory.id,
      productTypeId: type.id,
      versions: { create: { ...approved, capacityUnit: 'pieces', weeklyCapacity: 1000000 } },
    },
  });
  const list = await tx.priceList.create({ data: { factoryId: factory.id, productTypeId: type.id } });
  const version = await tx.priceListVersion.create({
    data: {
      priceListId: list.id,
      versionNo: 1,
      origin: 'factory_proposal',
      effectiveFrom: DEV_EFFECTIVE_FROM,
      reason: 'dev seed (fake prices)',
    },
  });
  const line = (
    stockProductId: string,
    minQty: number,
    maxQty: number | null,
    price: string,
    lead: string,
  ) => ({
    printTypeId: printType.publicId,
    stockProductId,
    minQty,
    maxQty,
    unitBuyPrice: price,
    leadTimeDays: lead,
  });
  const rows: [FinalLine['component'], PriceValues][] = [
    ['stock_product_prices', line(bottle.publicId, 100, 499, '2.5', '5')],
    ['stock_product_prices', line(bottle.publicId, 500, 999, '2.2', '5')],
    ['stock_product_prices', line(bottle.publicId, 1000, 99999, '2', '7')],
    ['stock_product_prices', line(pouch.publicId, 500, 4999, '1.2', '3')],
    ['stock_product_prices', line(pouch.publicId, 5000, null, '0.95', '3')],
  ];
  const registry = new PriceComponentRegistry();
  for (const d of STANDARD_PRODUCT_PRICE_COMPONENTS) registry.register(d);
  const lines: FinalLine[] = rows.map(([component, raw]) => {
    const d = registry.get(component)!;
    const { values, errors } = normaliseColumns([...d.dimensions, ...d.values], raw, component);
    if (errors.length > 0) throw new Error(`dev standard product ${component}: ${JSON.stringify(errors)}`);
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

  // getpack's sell side for standard products (fake values; D-063 admins set the real ones).
  const sellVersion = { versionNo: 1, effectiveFrom: DEV_EFFECTIVE_FROM, reason: 'dev seed (fake)' };
  await tx.sellMarginTable.create({
    data: {
      productTypeId: type.id,
      kind: 'margin',
      description: '[DEV] margin',
      decisionRefs: ['D-063'],
      versions: { create: { ...sellVersion, fallbackPct: 30, status: 'approved', decidedAt: new Date() } },
    },
  });
  for (const [kind, amount] of [
    ['fix_cost', 0.5],
    ['design_fee', 900],
  ] as const) {
    await tx.sellMarginTable.create({
      data: {
        productTypeId: type.id,
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

async function describe(tx: Tx, factoryId: bigint): Promise<DevStandardProduct> {
  const factory = await tx.factory.findUniqueOrThrow({ where: { id: factoryId } });
  const version = await tx.priceListVersion.findFirstOrThrow({
    where: { priceList: { factoryId, productType: { code: 'standard_product' } } },
    orderBy: { versionNo: 'desc' },
  });
  const one = async <T extends { publicId: string }>(p: Promise<T>) => (await p).publicId;
  return {
    factoryPublicId: factory.publicId,
    bottlePublicId: await one(tx.stockProduct.findUniqueOrThrow({ where: { sku: 'DEV-BTL-100' } })),
    pouchPublicId: await one(tx.stockProduct.findUniqueOrThrow({ where: { sku: 'DEV-POUCH-STD' } })),
    printTypePublicId: await one(tx.printType.findUniqueOrThrow({ where: { code: 'dev_std_product' } })),
    priceListVersionId: version.id,
  };
}
