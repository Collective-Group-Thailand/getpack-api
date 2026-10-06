import { type Prisma, type PrismaClient } from '../../src/generated/prisma/client';
import { PasswordService } from '../../src/modules/auth/password.service';
import { ROLES } from '../../src/modules/iam/roles.catalog';
import { type EntitySeedInput, seedReference, type SeedReport } from './reference-seed';

/** Obviously fake entity for development and tests — never used outside them (CLAUDE.md). */
export const DEV_ENTITY: EntitySeedInput = {
  code: 'DEV',
  displayName: 'Dev entity (fake)',
  legalNameTh: 'บริษัท ตัวอย่างเพื่อการพัฒนา จำกัด (ข้อมูลปลอม)',
  legalNameEn: 'Example Development Co., Ltd. (fake data)',
  taxId: '0000000000000',
  branchCode: '00000',
  addressTh: '99/9 ถนนตัวอย่าง แขวงทดสอบ เขตทดสอบ กรุงเทพฯ 10000 (ข้อมูลปลอม)',
  phone: '02-000-0000',
};

/** Staff role → team for notification routing (D-143). */
const TEAM_OF: Record<string, string> = {
  cs: 'cs',
  cs_lead: 'cs',
  prepress: 'prepress',
  finance: 'finance',
  finance_manager: 'finance',
  logistics: 'logistics',
  partner_manager: 'partner',
  marketing: 'marketing',
  superadmin: 'management',
  c_level: 'management',
  vp: 'management',
  director: 'management',
};

/**
 * `pnpm db:seed:dev` — the reference seed plus one fake staff user per staff role
 * (`<role>@example.invalid`) and one fake customer. Staff users get `devPassword`
 * (`DEV_SEED_PASSWORD`, argon2id) when given; users that already have a password keep it.
 * Partner and company users need factories/companies (B2.2 / B3.5) and are added there.
 */
const DEV_SERIES = [
  {
    docType: 'qt',
    prefix: 'DEVQT',
    format: '{prefix}-{yyyy}-{seq:6}',
    resetPeriod: 'yearly',
    isGapless: true,
    description: '[DEV] fake quotation series',
  },
  {
    docType: 'rfq',
    prefix: 'DEVRFQ',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: false,
    description: '[DEV] fake RFQ series',
  },
  {
    docType: 'order_group',
    prefix: 'DEVOG',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: false,
    description: '[DEV] fake order group series',
  },
  {
    docType: 'order',
    prefix: 'DEVOR',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: false,
    description: '[DEV] fake order series',
  },
  {
    docType: 'customer',
    prefix: 'DEVCU',
    format: '{prefix}-{seq:6}',
    resetPeriod: 'never',
    isGapless: false,
    description: '[DEV] fake customer code series',
  },
  {
    docType: 'company',
    prefix: 'DEVCO',
    format: '{prefix}-{seq:5}',
    resetPeriod: 'never',
    isGapless: false,
    description: '[DEV] fake company code series',
  },
  {
    docType: 'job',
    prefix: 'DEVJOB',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: false,
    description: '[DEV] fake production job series',
  },
  {
    docType: 'shipment',
    prefix: 'DEVSH',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: false,
    description: '[DEV] fake shipment series',
  },
  {
    docType: 'claim',
    prefix: 'DEVCL',
    format: '{prefix}-{yy}{mm}-{seq:4}',
    resetPeriod: 'monthly',
    isGapless: false,
    description: '[DEV] fake claim series',
  },
  {
    docType: 'support_ticket',
    prefix: 'DEVCS',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: false,
    description: '[DEV] fake support ticket series',
  },
  {
    docType: 'rfq_basket',
    prefix: 'DEVRB',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: false,
    description: '[DEV] fake RFQ basket series',
  },
  {
    docType: 'iv',
    prefix: 'DEVIV',
    format: '{prefix}-{yy}-{seq:5}',
    resetPeriod: 'yearly',
    isGapless: true,
    description: '[DEV] fake invoice series (B5)',
  },
  {
    docType: 'tr',
    prefix: 'DEVTR',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: true,
    description: '[DEV] fake tax invoice / receipt series (B5)',
  },
  {
    docType: 'rc',
    prefix: 'DEVRC',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: true,
    description: '[DEV] fake receipt series (B5)',
  },
  {
    docType: 'cn',
    prefix: 'DEVCN',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: true,
    description: '[DEV] fake credit note series (B5)',
  },
  {
    docType: 'dn',
    prefix: 'DEVDN',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: true,
    description: '[DEV] fake debit note series (B5)',
  },
  {
    docType: 'po',
    prefix: 'DEVPO',
    format: '{prefix}-{yy}-{seq:5}',
    resetPeriod: 'yearly',
    isGapless: true,
    description: '[DEV] fake factory purchase order series (B5)',
  },
  {
    docType: 'gr',
    prefix: 'DEVGR',
    format: '{prefix}-{yy}-{seq:5}',
    resetPeriod: 'yearly',
    isGapless: true,
    description: '[DEV] fake goods receipt series (B5)',
  },
  {
    docType: 'bs',
    prefix: 'DEVBS',
    format: '{prefix}-{yy}-{seq:5}',
    resetPeriod: 'yearly',
    isGapless: true,
    description: '[DEV] fake billing statement series (B5)',
  },
  {
    docType: 'pv',
    prefix: 'DEVPV',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: true,
    description: '[DEV] fake payment voucher series (B5)',
  },
  {
    docType: 'wt',
    prefix: 'DEVWT',
    format: '{prefix}-{yy}-{seq:5}',
    resetPeriod: 'yearly',
    isGapless: true,
    description: '[DEV] fake 50 ทวิ certificate series (B5)',
  },
  {
    docType: 'jv',
    prefix: 'DEVJV',
    format: '{prefix}-{yy}{mm}-{seq:5}',
    resetPeriod: 'monthly',
    isGapless: true,
    description: '[DEV] fake journal voucher series (B5)',
  },
  {
    docType: 'fa',
    prefix: 'DEVFA',
    format: '{prefix}-{seq:5}',
    resetPeriod: 'never',
    isGapless: true,
    description: '[DEV] fake fixed-asset number series (B5.5)',
  },
] as const;

/** What the UAT rehearsal seed (`prisma/seed/uat/`) changes in the dev seed: its entity and series prefix. */
export interface DevSeedOptions {
  entity?: EntitySeedInput;
  /** Replaces `DEV` in the document-series prefixes and descriptions (e.g. `UAT`). */
  seriesPrefix?: string;
}

export async function seedDev(
  prisma: PrismaClient,
  devPassword?: string,
  options: DevSeedOptions = {},
): Promise<SeedReport> {
  const report = await seedReference(prisma, options.entity ?? DEV_ENTITY);
  const prefix = options.seriesPrefix ?? 'DEV';
  const count = (what: string) => (report[what] = (report[what] ?? 0) + 1);
  const passwordHash = devPassword ? await new PasswordService().hash(devPassword) : undefined;

  await prisma.$transaction(async (tx) => {
    const teams = new Map((await tx.team.findMany()).map((t) => [t.code, t.id]));
    for (const role of ROLES.filter((r) => r.audience === 'staff')) {
      const email = `${role.key.replaceAll('_', '-')}@example.invalid`;
      const existing = await tx.user.findFirst({ where: { kind: 'staff', email } });
      if (existing) {
        if (passwordHash && !existing.passwordHash) {
          await tx.user.update({
            where: { id: existing.id },
            data: { passwordHash, passwordChangedAt: new Date() },
          });
          count('dev_staff_passwords');
        }
        continue;
      }
      const roleRow = await tx.role.findUniqueOrThrow({ where: { key: role.key } });
      const teamCode = TEAM_OF[role.key];
      await tx.user.create({
        data: {
          kind: 'staff',
          status: 'active',
          email,
          emailVerifiedAt: new Date(),
          displayName: `Dev ${role.nameEn}`,
          ...(passwordHash && { passwordHash, passwordChangedAt: new Date() }),
          staffProfile: { create: { teamId: teamCode ? (teams.get(teamCode) ?? null) : null } },
          roles: { create: { roleId: roleRow.id, scopeType: 'platform', reason: 'dev seed (fake user)' } },
        },
      });
      count('dev_staff_users');
    }

    if (await seedDevCatalog(tx)) count('dev_catalog');

    // Obviously fake numbering for `pnpm dev` and the tests: real formats are not decided (schema-design
    // Q-2) and are created by a Finance Manager (D-169).
    const entity = await tx.entity.findFirstOrThrow({ where: { isDefault: true } });
    for (const series of DEV_SERIES) {
      if (
        await tx.documentSeries.findUnique({
          where: { entityId_docType: { entityId: entity.id, docType: series.docType } },
        })
      )
        continue;
      await tx.documentSeries.create({
        data: {
          entityId: entity.id,
          ...series,
          prefix: series.prefix.replace(/^DEV/, prefix),
          description: series.description.replace('[DEV]', `[${prefix}]`),
          decisionRefs: ['D-092'],
        },
      });
      count('dev_document_series');
    }

    const customerEmail = 'customer@example.invalid';
    if (!(await tx.user.findFirst({ where: { kind: 'customer', email: customerEmail } }))) {
      await tx.user.create({
        data: {
          kind: 'customer',
          status: 'active',
          email: customerEmail,
          emailVerifiedAt: new Date(),
          displayName: 'Dev Customer (fake)',
        },
      });
      count('dev_customer_users');
    }
  });
  return report;
}

/**
 * A small, obviously fake catalogue for `pnpm dev` (D-005: real catalogue data is created by admins):
 * every name starts with `[DEV]`, codes with `dev`. Created once; skipped when present.
 */
async function seedDevCatalog(tx: Prisma.TransactionClient): Promise<boolean> {
  if (await tx.material.findUnique({ where: { code: 'dev-art-350' } })) return false;
  const folding = await tx.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
  const standard = await tx.productType.findUniqueOrThrow({ where: { code: 'standard_product' } });

  const family = await tx.materialFamily.create({
    data: {
      code: 'dev_paper',
      nameTh: '[DEV] กระดาษทดสอบ',
      nameEn: '[DEV] Test paper',
      indexUnit: 'THB/kg',
      status: 'active',
    },
  });
  const art = await tx.material.create({
    data: {
      code: 'dev-art-350',
      kind: 'paper',
      familyId: family.id,
      nameTh: '[DEV] อาร์ตการ์ด 350 แกรม',
      nameEn: '[DEV] Art card 350 gsm',
      gsm: 350,
      status: 'active',
    },
  });
  const kraft = await tx.material.create({
    data: {
      code: 'dev-kraft-300',
      kind: 'paper',
      familyId: family.id,
      nameTh: '[DEV] คราฟท์ 300 แกรม',
      nameEn: '[DEV] Kraft 300 gsm',
      gsm: 300,
      status: 'active',
    },
  });
  const group = await tx.finishGroup.create({
    data: { code: 'dev-coatings', nameTh: '[DEV] เคลือบ', nameEn: '[DEV] Coatings', status: 'active' },
  });
  const matt = await tx.finish.create({
    data: {
      groupId: group.id,
      code: 'dev-matt',
      nameTh: '[DEV] เคลือบด้าน',
      nameEn: '[DEV] Matt lamination',
      finishKind: 'lamination',
      status: 'active',
    },
  });
  const pattern = await tx.pattern.create({
    data: {
      productTypeId: folding.id,
      code: 'DEV-RTE',
      name: '[DEV] ฝาเสียบกลับด้าน',
      constraints: {},
      status: 'active',
    },
  });
  await tx.catalogProduct.create({
    data: {
      productTypeId: folding.id,
      slug: 'dev-tuck-end-box',
      nameTh: '[DEV] กล่องฝาเสียบทดสอบ',
      nameEn: '[DEV] Test tuck-end box',
      templateAvailability: 'drawing',
      status: 'active',
      patterns: { create: { patternId: pattern.id } },
      options: {
        create: [
          { optionKind: 'material', optionId: art.id, isDefault: true },
          { optionKind: 'material', optionId: kraft.id, sort: 1 },
          { optionKind: 'coating', optionId: matt.id },
        ],
      },
      standardSizes: {
        create: {
          code: 'S',
          name: '[DEV] 10×10×5 ซม.',
          lengthMm: 100,
          widthMm: 100,
          heightMm: 50,
          status: 'active',
        },
      },
    },
  });
  const clear = await tx.stockAttributeValue.create({
    data: {
      attribute: 'colour',
      code: 'dev-clear',
      nameTh: '[DEV] ใส',
      nameEn: '[DEV] Clear',
      status: 'active',
    },
  });
  await tx.stockProduct.create({
    data: {
      productTypeId: standard.id,
      sku: 'DEV-BTL-0001',
      nameTh: '[DEV] ขวดทดสอบ 250 มล.',
      nameEn: '[DEV] Test bottle 250 ml',
      unit: 'piece',
      capacityMl: 250,
      minOrderQty: 100,
      status: 'active',
      attributes: { create: { attribute: 'colour', valueId: clear.id } },
    },
  });
  const province = await tx.geoProvince.create({
    data: { code: 'DEV1', nameTh: '[DEV] จังหวัดทดสอบ', nameEn: '[DEV] Test province' },
  });
  const district = await tx.geoDistrict.create({
    data: {
      provinceId: province.id,
      code: 'DEV101',
      nameTh: '[DEV] อำเภอทดสอบ',
      nameEn: '[DEV] Test district',
    },
  });
  await tx.geoSubdistrict.create({
    data: {
      districtId: district.id,
      code: 'DEV10101',
      nameTh: '[DEV] ตำบลทดสอบ',
      nameEn: '[DEV] Test subdistrict',
      postcode: '99999',
    },
  });
  const faqCategory = await tx.faqCategory.create({
    data: {
      code: 'dev_ordering',
      nameTh: '[DEV] การสั่งซื้อ',
      nameEn: '[DEV] Ordering',
      status: 'published',
    },
  });
  await tx.faq.create({
    data: {
      categoryId: faqCategory.id,
      questionTh: '[DEV] คำถามทดสอบ',
      answerTh: '[DEV] คำตอบทดสอบ',
      status: 'published',
    },
  });
  return true;
}
