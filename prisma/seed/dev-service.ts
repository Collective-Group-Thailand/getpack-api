import { type Prisma } from '../../src/generated/prisma/client';
import {
  lineKeyOf,
  normaliseColumns,
  PriceComponentRegistry,
  type PriceValues,
} from '../../src/modules/partners/pricing/price-component.registry';
import { type FinalLine, PriceListBuilder } from '../../src/modules/partners/pricing/price-list-builder';
import { SERVICE_PRICE_COMPONENTS } from '../../src/modules/pricing/calculators/service/price-components';

type Tx = Prisma.TransactionClient;

const DEV_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00+07:00');

export interface DevService {
  factoryPublicId: string;
  platePublicId: string;
  designPublicId: string;
  printTypePublicId: string;
}

/**
 * An obviously fake service setup for `pnpm dev` and the tests (D-005, U-B6 service): `[DEV]` names, a made-up price. It
 * extends the dev folding factory F9001 with a tier-A `service` price list holding one line (a print plate at 1,000 net)
 * and no line for graphic design (priced by CS from an amount, D-194), capacity and Packio's `service` sell table (a dev
 * fallback margin of 6.5 %, legacy's `service_locopack_margin`). Idempotent. Needs `seedDevFolding` (factory F9001).
 */
export async function seedDevService(tx: Tx): Promise<{ created: boolean; fixture: DevService }> {
  const type = await tx.productType.findUniqueOrThrow({ where: { code: 'service' } });
  const factory = await tx.factory.findUniqueOrThrow({ where: { code: 'F9001' } });
  if (await tx.printType.findUnique({ where: { code: 'dev_service' } })) {
    return { created: false, fixture: await describe(tx, factory.id) };
  }
  if (type.status !== 'active')
    await tx.productType.update({ where: { id: type.id }, data: { status: 'active' } });
  const printType = await tx.printType.create({
    data: {
      code: 'dev_service',
      productTypeId: type.id,
      nameTh: '[DEV] บริการ',
      nameEn: '[DEV] Service',
      status: 'active',
    },
  });
  const item = (slug: string, nameTh: string, nameEn: string) =>
    tx.catalogProduct.create({
      data: { productTypeId: type.id, slug, nameTh, nameEn, templateAvailability: 'none', status: 'active' },
    });
  const plate = await item('dev-print-plate', '[DEV] ค่า Plate พิมพ์', '[DEV] Print plate');
  await item('dev-graphic-design', '[DEV] ค่าออกแบบ', '[DEV] Graphic design');
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
      versions: { create: { ...approved, capacityUnit: 'pieces', weeklyCapacity: 1000 } },
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
  const rows: [FinalLine['component'], PriceValues][] = [
    [
      'service_prices',
      {
        printTypeId: printType.publicId,
        catalogProductId: plate.publicId,
        unitCost: '1000',
        leadTimeDays: '7',
      },
    ],
  ];
  const registry = new PriceComponentRegistry();
  for (const d of SERVICE_PRICE_COMPONENTS) registry.register(d);
  const lines: FinalLine[] = rows.map(([component, raw]) => {
    const d = registry.get(component)!;
    const { values, errors } = normaliseColumns([...d.dimensions, ...d.values], raw, component);
    if (errors.length > 0) throw new Error(`dev service ${component}: ${JSON.stringify(errors)}`);
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
  const sellVersion = { versionNo: 1, effectiveFrom: DEV_EFFECTIVE_FROM, reason: 'dev seed (fake)' };
  await tx.sellMarginTable.create({
    data: {
      productTypeId: type.id,
      kind: 'margin',
      description: '[DEV] margin',
      decisionRefs: ['D-063'],
      versions: { create: { ...sellVersion, fallbackPct: 6.5, status: 'approved', decidedAt: new Date() } },
    },
  });
  await tx.sellMarginTable.create({
    data: {
      productTypeId: type.id,
      kind: 'fix_cost',
      description: '[DEV] fix_cost',
      decisionRefs: ['D-063'],
      versions: { create: { ...sellVersion, fallbackAmount: 0, status: 'approved', decidedAt: new Date() } },
    },
  });
  return { created: true, fixture: await describe(tx, factory.id) };
}

async function describe(tx: Tx, factoryId: bigint): Promise<DevService> {
  const factory = await tx.factory.findUniqueOrThrow({ where: { id: factoryId } });
  const one = async <T extends { publicId: string }>(p: Promise<T>) => (await p).publicId;
  return {
    factoryPublicId: factory.publicId,
    platePublicId: await one(tx.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-print-plate' } })),
    designPublicId: await one(tx.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-graphic-design' } })),
    printTypePublicId: await one(tx.printType.findUniqueOrThrow({ where: { code: 'dev_service' } })),
  };
}
