import { type PrismaClient } from '../../../src/generated/prisma/client';
import { type PrismaClient as ErpPrismaClient } from '../../../src/generated/prisma-erp/client';
import { PasswordService } from '../../../src/modules/auth/password.service';
import { seedDevPriceLists } from '../dev-price-lists';
import { seedDev } from '../dev-seed';
import { type EntitySeedInput, type SeedReport } from '../reference-seed';
import { seedUatCatalog, SIGNED_INSTANT_TYPES } from './uat-catalog';
import { UAT_CONSENT_TEXT } from './uat-data';
import { seedUatErp, seedUatErpE2, seedUatErpE3, seedUatErpE4, seedUatErpE5 } from './uat-erp';

/**
 * Obviously fake issuing entity for a UAT rehearsal that has no `SEED_ENTITY_*` (UAT.md §0 uses the real legal
 * entity from those variables, D-092; a rehearsal on a laptop does not need it).
 */
export const UAT_FAKE_ENTITY: EntitySeedInput = {
  code: 'UAT',
  displayName: 'UAT rehearsal entity (fake)',
  legalNameTh: 'บริษัท ทดสอบระบบ ยูเอที จำกัด (ข้อมูลปลอม)',
  legalNameEn: 'UAT Rehearsal Co., Ltd. (fake data)',
  taxId: '0000000000000',
  branchCode: '00000',
  addressTh: '99/9 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10000 (ข้อมูลปลอม)',
  phone: '02-000-0000',
  returnAddress: {
    line1: '99/9 ถนนทดสอบ (ข้อมูลปลอม)',
    district: 'เขตทดสอบ',
    province: 'กรุงเทพมหานคร',
    postcode: '10000',
    lat: 13.75,
    lng: 100.5,
  },
};

/**
 * `pnpm db:seed:uat` — the UAT rehearsal data set (docs/launch/UAT-DATA.md): the reference seed, the dev staff
 * (one per role), document series prefixed `UAT`, the dev factories' fake price lists, then the rehearsal layer —
 * a market-like catalogue (folding cartons, postal boxes, labels, tags, pouches, stock bottles and cups, services
 * and every RFQ type), prices copied from the dev fake lines, real-looking geography with shipping zones, FAQs and
 * the factory's users, placeholder consent texts. Customers, companies, quotes, orders and the rest are created through the API by
 * `pnpm uat:populate`. Idempotent. Product types are instant only where their validation document is signed
 * (A-16) unless `instantTypes` says otherwise (a pricing rehearsal).
 */
export async function seedUat(
  prisma: PrismaClient,
  erpPrisma: ErpPrismaClient,
  opts: { password?: string; entity?: EntitySeedInput; instantTypes?: string[] },
): Promise<SeedReport> {
  const report = await seedDev(prisma, opts.password, {
    entity: opts.entity ?? UAT_FAKE_ENTITY,
    seriesPrefix: 'UAT',
  });
  await seedDevPriceLists(prisma, report);
  const instantTypes =
    opts.instantTypes?.[0] === 'all'
      ? (await prisma.productType.findMany({ where: { calculatorKey: { not: null } } })).map((t) => t.code)
      : (opts.instantTypes ?? [...SIGNED_INSTANT_TYPES]);
  const uat = await prisma.$transaction(
    (tx) => seedUatCatalog(tx, { password: opts.password, instantTypes }),
    { timeout: 300_000 },
  );
  const consents = await seedUatConsentTexts(prisma);
  // The factory ERP's tables go through its own client (ADR-0013).
  const erp = await seedUatErp(erpPrisma);
  const erpE2 = await seedUatErpE2(erpPrisma);
  const erpE3 = await seedUatErpE3(erpPrisma);
  const erpE4 = await seedUatErpE4(
    erpPrisma,
    opts.password ? await new PasswordService().hash(opts.password) : undefined,
  );
  const erpE5 = await seedUatErpE5(erpPrisma);
  return {
    ...report,
    ...uat,
    ...(consents && { uat_consent_texts: consents }),
    ...(erp && { uat_erp_items: erp }),
    ...(erpE2 && { uat_erp_supplier_links: erpE2 }),
    ...(erpE3 && { uat_erp_maintenance_plans: erpE3 }),
    ...(erpE4 && { uat_erp_sales: erpE4 }),
    ...(erpE5 && { uat_erp_quality: erpE5 }),
  };
}

/**
 * A fake text for every consent purpose that has none, effective now, so consents can be recorded in the
 * rehearsal. Outside the run-once catalogue so an already-seeded UAT database gets them on the next run; a purpose
 * that already has a version (e.g. one legal published) is left alone.
 */
async function seedUatConsentTexts(prisma: PrismaClient): Promise<number> {
  const purposes = await prisma.consentPurpose.findMany({ where: { versions: { none: {} } } });
  const now = new Date();
  for (const purpose of purposes) {
    await prisma.consentPurposeVersion.create({
      data: {
        purposeId: purpose.id,
        versionNo: 1,
        effectiveFrom: now,
        status: 'approved',
        ...UAT_CONSENT_TEXT,
        decidedAt: now,
      },
    });
  }
  return purposes.length;
}
