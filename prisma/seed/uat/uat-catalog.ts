import { createHash } from 'node:crypto';

import { type Prisma } from '../../../src/generated/prisma/client';
import { PasswordService } from '../../../src/modules/auth/password.service';
import { type FinalLine } from '../../../src/modules/partners/pricing/price-list-builder';
import {
  type ProductSeed,
  type StockSeedAttribute,
  stockTypeOf,
  UAT_DIECUTS,
  UAT_FAQS,
  UAT_FINISHES,
  UAT_GEOGRAPHY,
  UAT_HERO_PRESETS,
  UAT_MATERIALS,
  UAT_PRODUCTS,
  UAT_RENAMES,
  UAT_SHIPPING_BANDS,
  UAT_STOCK_PRODUCTS,
  UAT_ZONES,
} from './uat-data';
import { cloneFactoryPriceLines, newLine, UAT_EFFECTIVE_FROM } from './uat-prices';

type Tx = Prisma.TransactionClient;
type Report = Record<string, number>;

/** The dev seed's factory serves every type (D-101); in UAT it is the rehearsal launch factory. */
export const UAT_FACTORY_CODE = 'F9001';

/** Product types whose calculator validation document is signed (A-16, D-100 note): instant in UAT. */
export const SIGNED_INSTANT_TYPES = ['corrugated'] as const;

/** Golden-test flute constants for BC (test/golden/corrugate/cases.py, legacy vectors) — no new values. */
const BC_FLUTE = { colA: 6, colC: 8, colDd: 10, colG: 40, colFh: 6, ct: 4, z: 1 };

/** Golden-test geometry bands of the folding tuck-top and lock-bottom cases (test/golden/folding/cases.ts). */
const band = (value: number) => [
  { lower: 0, upper: 100, value },
  { lower: 100.01, upper: 2000, value: value + 5 },
];

async function renameDevData(tx: Tx): Promise<void> {
  const r = UAT_RENAMES;
  const each = async <T>(
    group: Record<string, T> | undefined,
    fn: (code: string, v: T) => Promise<unknown>,
  ) => {
    for (const [code, v] of Object.entries(group ?? {})) await fn(code, v);
  };
  type Names = { nameTh: string; nameEn: string };
  await each(r['material'], (code, v) => tx.material.updateMany({ where: { code }, data: v as Names }));
  await each(r['finish'], (code, v) => tx.finish.updateMany({ where: { code }, data: v as Names }));
  await each(r['inkColour'], (code, v) =>
    tx.inkColour.updateMany({ where: { code }, data: v as { name: string } }),
  );
  await each(r['diecutType'], (code, v) => tx.diecutType.updateMany({ where: { code }, data: v as Names }));
  await each(r['difficultyLevel'], (code, v) =>
    tx.difficultyLevel.updateMany({ where: { code }, data: v as Names }),
  );
  await each(r['assembly'], (code, v) => tx.assembly.updateMany({ where: { code }, data: v as Names }));
  await each(r['pattern'], (code, v) =>
    tx.pattern.updateMany({ where: { code }, data: v as { name: string } }),
  );
  await each(r['printType'], (code, v) => tx.printType.updateMany({ where: { code }, data: v as Names }));
  await each(r['catalogProduct'], (slug, v) =>
    tx.catalogProduct.updateMany({ where: { slug }, data: v as Names }),
  );
  // Groups the rehearsal data hangs from.
  await tx.finishGroup.updateMany({
    where: { code: 'dev-coatings' },
    data: { nameTh: 'เคลือบผิว', nameEn: 'Coatings' },
  });
  await tx.diecutGroup.updateMany({
    where: { code: 'dev-diecut' },
    data: { nameTh: 'ไดคัท', nameEn: 'Die-cut' },
  });
  await tx.inkColourGroup.updateMany({
    where: { code: 'dev-process' },
    data: { nameTh: 'สีพิมพ์', nameEn: 'Process inks' },
  });
  await tx.assemblyGroup.updateMany({
    where: { code: 'dev-pouch-options' },
    data: { nameTh: 'อุปกรณ์ซอง', nameEn: 'Pouch options' },
  });
  // The dev catalogue products and SKUs give way to the rehearsal catalogue; the priced dev services stay.
  const keep = Object.keys(r['catalogProduct'] ?? {});
  await tx.catalogProduct.updateMany({
    where: { slug: { startsWith: 'dev-', notIn: keep } },
    data: { status: 'inactive' },
  });
  await tx.stockProduct.updateMany({ where: { sku: { startsWith: 'DEV-' } }, data: { status: 'inactive' } });
  // RSC sizes of the Thai postal boxes start below the dev rule's 100 mm width (and some are taller than wide).
  await tx.pattern.updateMany({
    where: { code: 'DEV-RSC' },
    data: { constraints: { minW: 80, maxW: 800, minL: 100, maxL: 1200, minH: 50, maxH: 800 } },
  });
  // One launch factory (D-101): the dev engine-B factory is not part of the rehearsal.
  await tx.factory.updateMany({ where: { code: 'F9002' }, data: { status: 'suspended' } });
  await tx.factory.updateMany({
    where: { code: UAT_FACTORY_CODE },
    data: {
      legalName: 'บริษัท โรงงานพาร์ทเนอร์ทดสอบ จำกัด (UAT)',
      tradeName: 'UAT Partner Factory (rehearsal)',
    },
  });
}

async function seedGeographyAndShipping(tx: Tx): Promise<number> {
  const scheme = await tx.zoneScheme.findUniqueOrThrow({ where: { code: 'customer_default' } });
  const factory = await tx.factory.findUniqueOrThrow({ where: { code: UAT_FACTORY_CODE } });
  const zones = new Map<string, bigint>();
  for (const z of UAT_ZONES) {
    const zone = await tx.zone.create({
      data: { schemeId: scheme.id, code: z.code, nameTh: z.nameTh, nameEn: z.nameEn },
    });
    zones.set(z.code, zone.id);
    await tx.factoryDeliveryZone.create({
      data: { factoryId: factory.id, zoneId: zone.id, serves: true, extraLeadDays: z.extraLeadDays },
    });
  }
  for (const g of UAT_GEOGRAPHY) {
    const province =
      (await tx.geoProvince.findUnique({ where: { code: g.province.code } })) ??
      (await tx.geoProvince.create({ data: g.province }));
    const district =
      (await tx.geoDistrict.findUnique({ where: { code: g.district.code } })) ??
      (await tx.geoDistrict.create({ data: { ...g.district, provinceId: province.id } }));
    await tx.geoSubdistrict.create({ data: { ...g.subdistrict, districtId: district.id } });
    await tx.zonePostcode.upsert({
      where: { schemeId_postcode: { schemeId: scheme.id, postcode: g.subdistrict.postcode } },
      create: { schemeId: scheme.id, zoneId: zones.get(g.zone)!, postcode: g.subdistrict.postcode },
      update: { zoneId: zones.get(g.zone)! },
    });
  }

  const card = await tx.customerShippingRateCard.findUniqueOrThrow({ where: { key: 'default' } });
  const last = await tx.customerShippingRateCardVersion.findFirst({
    where: { cardId: card.id },
    orderBy: { versionNo: 'desc' },
  });
  const customer = await tx.customerShippingRateCardVersion.create({
    data: {
      cardId: card.id,
      versionNo: (last?.versionNo ?? 0) + 1,
      schemeId: scheme.id,
      effectiveFrom: UAT_EFFECTIVE_FROM,
      reason: 'UAT rehearsal seed: fake customer shipping rates by zone and weight',
    },
  });
  const payoutCard =
    (await tx.factoryShippingRateCard.findUnique({ where: { factoryId: factory.id } })) ??
    (await tx.factoryShippingRateCard.create({ data: { factoryId: factory.id } }));
  const lastPayout = await tx.factoryShippingRateCardVersion.findFirst({
    where: { cardId: payoutCard.id },
    orderBy: { versionNo: 'desc' },
  });
  const payout = await tx.factoryShippingRateCardVersion.create({
    data: {
      cardId: payoutCard.id,
      versionNo: (lastPayout?.versionNo ?? 0) + 1,
      schemeId: scheme.id,
      effectiveFrom: UAT_EFFECTIVE_FROM,
      reason: 'UAT rehearsal seed: fake factory shipping payout by zone and weight',
    },
  });
  for (const [i, b] of UAT_SHIPPING_BANDS.entries()) {
    // Bands are half-open [min, next min) — the rate cards' exclusion constraints.
    const weightMaxG = UAT_SHIPPING_BANDS[i + 1]?.weightMinG ?? null;
    for (const [code, [price, payoutAmount]] of Object.entries(b.prices)) {
      const zoneId = zones.get(code)!;
      await tx.customerShippingRate.create({
        data: {
          versionId: customer.id,
          schemeId: scheme.id,
          zoneId,
          weightMinG: b.weightMinG,
          weightMaxG,
          priceAmount: price,
        },
      });
      await tx.factoryShippingRate.create({
        data: {
          versionId: payout.id,
          schemeId: scheme.id,
          zoneId,
          weightMinG: b.weightMinG,
          weightMaxG,
          payoutAmount,
          acceptance: 'accepted',
        },
      });
    }
  }
  const now = new Date();
  await tx.customerShippingRateCardVersion.update({
    where: { id: customer.id },
    data: { status: 'approved', decidedAt: now },
  });
  await tx.factoryShippingRateCardVersion.update({
    where: { id: payout.id },
    data: { status: 'approved', sentAt: now, factoryAcceptedAt: now, decidedAt: now },
  });
  return UAT_GEOGRAPHY.length;
}

/** Folding patterns with real box geometry (tuck end, crash-lock bottom) from the golden-test bands. */
async function seedFoldingPatterns(tx: Tx): Promise<void> {
  const folding = await tx.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
  const condition = async (
    code: string,
    slot: 'dw' | 'dl' | 'aux_f',
    variable: string,
    determinant: 'w' | 'l',
    value: number,
  ) => {
    const table = await tx.geometryBandTable.create({
      data: { code, name: `UAT ${code}`, status: 'active', bands: { create: band(value) } },
    });
    return {
      slot,
      condition: await tx.geometryCondition.create({
        data: { code, bandTableId: table.id, variable, determinant, status: 'active' },
      }),
    };
  };
  const tuck = [
    await condition('uat_tuck_dw', 'dw', 'f', 'w', 15),
    await condition('uat_tuck_dl', 'dl', 'g', 'l', 12),
  ];
  const lock = [
    await condition('uat_lock_dw', 'dw', 'b', 'w', 4),
    await condition('uat_lock_aux_f', 'aux_f', 'f', 'l', 13),
    await condition('uat_lock_dl', 'dl', 'g', 'l', 10),
  ];
  const patterns: [string, string, 'tuck_top' | 'lock_bottom_top', typeof tuck][] = [
    ['UAT-RTE', 'กล่องฝาเสียบสลับ (Reverse tuck end)', 'tuck_top', tuck],
    ['UAT-STE', 'กล่องฝาเสียบด้านเดียวกัน (Straight tuck end)', 'tuck_top', tuck],
    ['UAT-CLB', 'กล่องก้นล็อก (Crash-lock bottom)', 'lock_bottom_top', lock],
  ];
  for (const [code, name, geometryFormula, conditions] of patterns) {
    const pattern = await tx.pattern.create({
      data: { productTypeId: folding.id, code, name, constraints: {}, geometryFormula, status: 'active' },
    });
    for (const c of conditions) {
      await tx.patternGeometryCondition.create({
        data: { patternId: pattern.id, slot: c.slot, conditionId: c.condition.id },
      });
    }
  }
}

async function seedMasterData(tx: Tx): Promise<Map<string, string[]>> {
  const alike = new Map<string, string[]>();
  const like = (source: string, target: string) => alike.set(source, [...(alike.get(source) ?? []), target]);

  const bFlute = await tx.fluteType.findUniqueOrThrow({ where: { code: 'DEV-B' } });
  await tx.fluteType.update({ where: { id: bFlute.id }, data: { name: 'ลอน B' } });
  const bcFlute = await tx.fluteType.create({
    data: { code: 'UAT-BC', name: 'ลอน BC (5 ชั้น)', layers: 5, ...BC_FLUTE, status: 'active' },
  });
  like(bFlute.publicId, bcFlute.publicId);
  await tx.pattern.update({
    where: { code: 'DEV-RSC' },
    data: { fluteTypes: { create: { fluteTypeId: bcFlute.id } } },
  });
  // E flute for the homepage hero's mailer and lid boxes (D-310). Rehearsal geometry: B flute's allowances
  // until Prepress gives E's, and priced like B.
  const eFlute = await tx.fluteType.create({
    data: {
      code: 'UAT-E',
      name: 'ลอน E',
      layers: bFlute.layers,
      colA: bFlute.colA,
      colC: bFlute.colC,
      colDd: bFlute.colDd,
      colG: bFlute.colG,
      colFh: bFlute.colFh,
      ct: bFlute.ct,
      z: bFlute.z,
      status: 'active',
    },
  });
  like(bFlute.publicId, eFlute.publicId);
  for (const code of ['DEV-RSC', 'DEV-TELE'])
    await tx.pattern.update({
      where: { code },
      data: { fluteTypes: { create: { fluteTypeId: eFlute.id } } },
    });
  // One spot colour beside the process set, so "1 colour" is a real choice (D-310); priced like CMYK here.
  const cmyk = await tx.inkColour.findUniqueOrThrow({ where: { code: 'dev-cmyk' } });
  const black = await tx.inkColour.create({
    data: {
      groupId: cmyk.groupId,
      code: 'uat-black',
      name: 'ดำ',
      colourKind: 'spot',
      swatchHex: '#1A1A1A',
      status: 'active',
    },
  });
  like(cmyk.publicId, black.publicId);

  const family = async (code: string, nameTh: string, nameEn: string) =>
    tx.materialFamily.create({ data: { code, nameTh, nameEn, indexUnit: 'THB/kg', status: 'active' } });
  const families: Record<string, bigint> = {
    paper: (await family('uat_paperboard', 'กระดาษแข็ง', 'Paperboard')).id,
    board: (await family('uat_board', 'กระดาษกล่อง', 'Carton board')).id,
    corrugated_board: (await family('uat_corrugated', 'กระดาษลูกฟูก', 'Corrugated board')).id,
    label_stock: (await family('uat_label_stock', 'วัสดุสติ๊กเกอร์', 'Label stock')).id,
    film: (await family('uat_flexible_film', 'ฟิล์มลามิเนต', 'Laminated film')).id,
  };
  for (const m of UAT_MATERIALS) {
    const source = await tx.material.findUniqueOrThrow({ where: { code: m.likeCode } });
    const created = await tx.material.create({
      data: {
        code: m.code,
        kind: m.kind,
        familyId: families[m.kind] ?? null,
        nameTh: m.nameTh,
        nameEn: m.nameEn,
        gsm: m.gsm ?? null,
        micron: m.micron ?? null,
        caliperMm: m.caliperMm,
        fluteTypeId:
          m.flute === 'BC' ? bcFlute.id : m.flute === 'E' ? eFlute.id : m.flute === 'B' ? bFlute.id : null,
        insideColour: m.insideColour ?? null,
        outsideColour: m.outsideColour ?? null,
        isFoodGrade: m.isFoodGrade ?? false,
        coatable: m.coatable ?? m.kind !== 'corrugated_board',
        descriptionTh: m.descriptionTh,
        status: 'active',
      },
    });
    like(source.publicId, created.publicId);
  }
  // Calipers on the reused dev materials, so every material shows its other measurement bases (D-182).
  for (const [code, caliperMm] of [
    ['dev-art-350', '0.400'],
    ['dev-kraft-300', '0.420'],
    ['dev-ka125-b', '3.000'],
    ['dev-ka185-b', '3.200'],
    ['dev-ki230-b', '3.300'],
    ['dev-pp-white-80', '0.080'],
    ['dev-pet-lldpe-80', '0.080'],
  ] as const) {
    await tx.material.updateMany({ where: { code, caliperMm: null }, data: { caliperMm } });
  }

  const coatings = await tx.finishGroup.findUniqueOrThrow({ where: { code: 'dev-coatings' } });
  for (const f of UAT_FINISHES) {
    const source = await tx.finish.findUniqueOrThrow({ where: { code: f.likeCode } });
    const created = await tx.finish.create({
      data: {
        groupId: coatings.id,
        code: f.code,
        nameTh: f.nameTh,
        nameEn: f.nameEn,
        finishKind: f.finishKind,
        isSpecial: f.isSpecial ?? false,
        status: 'active',
      },
    });
    like(source.publicId, created.publicId);
  }
  const diecutSource = await tx.diecutType.findUniqueOrThrow({ where: { code: 'dev-diecut' } });
  for (const d of UAT_DIECUTS) {
    const created = await tx.diecutType.create({
      data: {
        groupId: diecutSource.groupId,
        code: d.code,
        nameTh: d.nameTh,
        nameEn: d.nameEn,
        status: 'active',
      },
    });
    like(diecutSource.publicId, created.publicId);
  }
  return alike;
}

/** The calculator configuration a product's starting price is computed from (D-220), or null. */
async function referenceConfiguration(tx: Tx, p: ProductSeed): Promise<Prisma.InputJsonValue | null> {
  const id = async (where: Promise<{ publicId: string } | null>) => (await where)?.publicId;
  const material =
    p.materials?.[0] && (await id(tx.material.findUnique({ where: { code: p.materials[0] } })));
  const pattern = p.patterns?.[0] && (await id(tx.pattern.findUnique({ where: { code: p.patterns[0] } })));
  const finish = p.finishes?.[0] && (await id(tx.finish.findUnique({ where: { code: p.finishes[0] } })));
  const diecut =
    (await id(tx.diecutType.findUnique({ where: { code: p.diecuts?.[0] ?? 'dev-diecut' } }))) ?? undefined;
  const difficulty = await id(tx.difficultyLevel.findUnique({ where: { code: 'dev-normal' } }));
  const cmyk = await id(tx.inkColour.findUnique({ where: { code: 'dev-cmyk' } }));
  const size = p.sizes?.[0];
  const quantity = p.quantities?.presets[1] ?? p.quantities?.min ?? 1000;
  const design = { graphic: false, structure: false };
  if (!size) return null;
  const [, , l, w, h] = size;
  switch (p.type) {
    case 'folding_carton':
      return {
        patternId: pattern!,
        w,
        l,
        d: h,
        materialId: material!,
        difficultyLevelId: difficulty!,
        quantities: [quantity],
        parts: [
          {
            printFront: [1, 2, 3, 4].map(() => ({ inkColourId: cmyk!, percent: 100 })),
            ...(finish && { finish1FrontId: finish }),
            diecutTypeId: diecut,
          },
        ],
        design,
      };
    case 'corrugated': {
      // One part per sub-pattern (a telescope box is a body and a lid); only the first is printed.
      const subPatterns = p.patterns?.[0]
        ? await tx.subPattern.findMany({
            where: { pattern: { code: p.patterns[0] } },
            orderBy: { seq: 'asc' },
          })
        : [];
      const printed = { printFront: [{ inkColourId: cmyk!, area: 'top' }] };
      const parts =
        subPatterns.length === 0
          ? [printed]
          : subPatterns.map((sp, i) => ({
              subPatternId: sp.publicId,
              ...(i === subPatterns.length - 1 && printed),
            }));
      return {
        patternId: pattern!,
        w,
        l,
        d: h,
        materialId: material!,
        difficultyLevelId: difficulty!,
        quantities: [quantity],
        parts,
        design,
      };
    }
    case 'label_sticker':
      return {
        w,
        l,
        materialId: material!,
        difficultyLevelId: difficulty!,
        quantities: [quantity],
        printFront: { inkColourIds: [cmyk!] },
        ...(finish && { finishFrontId: finish }),
        diecutTypeId: diecut,
        design,
      };
    case 'tag_sleeve':
      return {
        patternId: pattern!,
        w,
        l,
        materialId: material!,
        difficultyLevelId: difficulty!,
        quantities: [quantity],
        printFront: [1, 2, 3, 4].map(() => ({ inkColourId: cmyk!, percent: 100 })),
        ...(finish && { finish1FrontId: finish }),
        diecutTypeId: diecut,
        design,
      };
    case 'flexible_pouch': {
      const colour = await id(tx.inkColour.findUnique({ where: { code: 'dev-pouch-cmyk' } }));
      const options = [];
      for (const code of p.assemblies ?? [])
        options.push(await id(tx.assembly.findUnique({ where: { code } })));
      return {
        patternId: pattern!,
        w,
        l,
        ...(h > 0 && { b: h }),
        materialId: material!,
        printColourId: colour!,
        optionIds: options.filter(Boolean) as string[],
        quantities: [quantity],
        design,
      };
    }
    default:
      return null;
  }
}

async function seedProducts(tx: Tx): Promise<number> {
  const types = new Map((await tx.productType.findMany()).map((t) => [t.code, t]));
  const difficulty = await tx.difficultyLevel.findUniqueOrThrow({ where: { code: 'dev-normal' } });
  const optionKind = async (
    kind: 'material' | 'ink_colour' | 'finish' | 'diecut' | 'assembly',
    code: string,
  ) => {
    switch (kind) {
      case 'material':
        return {
          optionKind: 'material' as const,
          optionId: (await tx.material.findUniqueOrThrow({ where: { code } })).id,
        };
      case 'finish': {
        const f = await tx.finish.findUniqueOrThrow({ where: { code } });
        return {
          optionKind: f.finishKind === 'foil' ? ('finish' as const) : ('coating' as const),
          optionId: f.id,
        };
      }
      case 'ink_colour':
        return {
          optionKind: 'ink_colour' as const,
          optionId: (await tx.inkColour.findUniqueOrThrow({ where: { code } })).id,
        };
      case 'diecut':
        return {
          optionKind: 'diecut' as const,
          optionId: (await tx.diecutType.findUniqueOrThrow({ where: { code } })).id,
        };
      case 'assembly':
        return {
          optionKind: 'assembly' as const,
          optionId: (await tx.assembly.findUniqueOrThrow({ where: { code } })).id,
        };
    }
  };
  let sort = 0;
  for (const p of UAT_PRODUCTS) {
    const type = types.get(p.type);
    if (!type) throw new Error(`uat product ${p.slug}: unknown product type ${p.type}`);
    const options: {
      optionKind: 'material' | 'ink_colour' | 'finish' | 'coating' | 'diecut' | 'assembly';
      optionId: bigint;
      isDefault: boolean;
      sort: number;
    }[] = [];
    for (const [kind, codes] of [
      ['material', p.materials],
      ['ink_colour', p.inks],
      ['finish', p.finishes],
      ['diecut', p.diecuts],
      ['assembly', p.assemblies],
    ] as const) {
      for (const [i, code] of (codes ?? []).entries()) {
        options.push({
          ...(await optionKind(kind, code)),
          isDefault: i === 0 && kind !== 'assembly',
          sort: i,
        });
      }
    }
    const patterns = [];
    for (const [i, code] of (p.patterns ?? []).entries()) {
      patterns.push({ patternId: (await tx.pattern.findUniqueOrThrow({ where: { code } })).id, sort: i });
    }
    const instantCapable = type.calculatorKey !== null;
    await tx.catalogProduct.create({
      data: {
        productTypeId: type.id,
        slug: p.slug,
        nameTh: p.nameTh,
        nameEn: p.nameEn,
        descriptionTh: p.descriptionTh,
        templateAvailability: p.template ?? 'none',
        status: 'active',
        sort: sort++,
        ...(instantCapable && { defaultDifficultyLevelId: difficulty.id }),
        ...(p.quantities && {
          quantityMin: p.quantities.min,
          quantityDefault: p.quantities.presets[1] ?? p.quantities.min,
          quantityPresets: p.quantities.presets,
        }),
        ...(instantCapable && {
          referenceConfiguration: (await referenceConfiguration(tx, p)) ?? undefined,
        }),
        patterns: { create: patterns },
        options: { create: options },
        standardSizes: {
          create: (p.sizes ?? []).map(([code, name, l, w, h], i) => ({
            code,
            name,
            lengthMm: l,
            widthMm: w,
            heightMm: h,
            sort: i,
            status: 'active' as const,
          })),
        },
      },
    });
  }
  return UAT_PRODUCTS.length;
}

/** Stock products and their rehearsal buy-price lines (dev tiers, scaled by weight from the dev 18 g bottle). */
async function seedStockProducts(tx: Tx): Promise<{ count: number; inStock: number; lines: FinalLine[] }> {
  const type = await tx.productType.findUniqueOrThrow({ where: { code: 'standard_product' } });
  const printType = await tx.printType.findUniqueOrThrow({ where: { code: 'dev_std_product' } });
  const factory = await tx.factory.findUniqueOrThrow({ where: { code: UAT_FACTORY_CODE } });
  // The dev tiers (prisma/seed/dev-standard-product.ts): bottle 18 g, pouch sold by the pouch.
  const BOTTLE_TIERS: [number, number | null, number, string][] = [
    [100, 499, 2.5, '5'],
    [500, 999, 2.2, '5'],
    [1000, 99999, 2, '7'],
  ];
  const POUCH_TIERS: [number, number | null, number, string][] = [
    [500, 4999, 1.2, '3'],
    [5000, null, 0.95, '3'],
  ];
  const values = new Map<string, bigint>();
  const valueId = async (attribute: StockSeedAttribute, nameTh: string) => {
    const code = `uat-${attribute}-${createHash('sha256').update(nameTh).digest('hex').slice(0, 8)}`;
    if (!values.has(code)) {
      const row =
        (await tx.stockAttributeValue.findFirst({ where: { attribute, code } })) ??
        (await tx.stockAttributeValue.create({
          data: { attribute, code, nameTh, nameEn: nameTh, status: 'active' },
        }));
      values.set(code, row.id);
    }
    return values.get(code)!;
  };
  const lines: FinalLine[] = [];
  let inStock = 0;
  for (const s of UAT_STOCK_PRODUCTS) {
    const attributes = [];
    for (const [attribute, nameTh] of Object.entries({ type: stockTypeOf(s.sku), ...s.attributes })) {
      const key = attribute as StockSeedAttribute;
      attributes.push({ attribute: key, valueId: await valueId(key, nameTh) });
    }
    const product = await tx.stockProduct.create({
      data: {
        productTypeId: type.id,
        sku: s.sku,
        nameTh: s.nameTh,
        nameEn: s.nameEn,
        description: s.description,
        unit: s.unit,
        weightG: s.weightG ?? null,
        capacityMl: s.capacityMl ?? null,
        lengthMm: s.size?.[0] ?? null,
        widthMm: s.size?.[1] ?? null,
        heightMm: s.size?.[2] ?? null,
        minOrderQty: s.minOrderQty,
        isFoodGrade: s.isFoodGrade ?? false,
        status: 'active',
        attributes: { create: attributes },
      },
    });
    // Stock on hand at the launch factory, received once (the store shows `inStock` from it).
    const onHand = s.onHand ?? s.minOrderQty * 200;
    await tx.stockLevel.create({ data: { stockProductId: product.id, factoryId: factory.id, onHand } });
    if (onHand > 0) {
      inStock += 1;
      await tx.stockMovement.create({
        data: {
          stockProductId: product.id,
          factoryId: factory.id,
          kind: 'receipt',
          quantity: onHand,
          balanceAfter: onHand,
          reason: 'UAT rehearsal seed: opening stock (fake)',
        },
      });
    }
    // Price tiers: the dev tiers (scaled by weight for pieces), starting at the SKU's own minimum order.
    const tiers = (s.weightG ? BOTTLE_TIERS : POUCH_TIERS).filter(
      ([, maxQty]) => maxQty === null || maxQty >= s.minOrderQty,
    );
    const scale = s.weightG ? s.weightG / 18 : 1;
    for (const [i, [minQty, maxQty, price, lead]] of tiers.entries()) {
      lines.push(
        newLine('standard_product', 'stock_product_prices', {
          printTypeId: printType.publicId,
          stockProductId: product.publicId,
          minQty: i === 0 ? s.minOrderQty : minQty,
          maxQty,
          unitBuyPrice: Math.max(0.1, price * scale).toFixed(2),
          leadTimeDays: lead,
        }),
      );
    }
  }
  return { count: UAT_STOCK_PRODUCTS.length, inStock, lines };
}

/** `catalog.hero_presets` as the Admin would set it (D-310): a new approved version of the platform setting. */
async function seedHeroPresets(tx: Tx): Promise<number> {
  const setting = await tx.setting.findFirstOrThrow({
    where: { key: 'catalog.hero_presets', scopeType: 'platform', scopeId: null },
    include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
  });
  await tx.settingVersion.create({
    data: {
      settingId: setting.id,
      versionNo: (setting.versions[0]?.versionNo ?? 0) + 1,
      effectiveFrom: UAT_EFFECTIVE_FROM,
      status: 'approved',
      value: UAT_HERO_PRESETS as unknown as Prisma.InputJsonValue,
      reason: 'UAT rehearsal: the homepage Studio hero (D-310)',
      decidedAt: new Date(),
    },
  });
  return 1;
}

async function seedFaqs(tx: Tx): Promise<number> {
  let n = 0;
  for (const [ci, group] of UAT_FAQS.entries()) {
    const category = await tx.faqCategory.create({
      data: { ...group.category, sort: ci, status: 'published' },
    });
    for (const [i, item] of group.items.entries()) {
      await tx.faq.create({
        data: { categoryId: category.id, questionTh: item.q, answerTh: item.a, sort: i, status: 'published' },
      });
      n += 1;
    }
  }
  return n;
}

/**
 * The rehearsal launch factory's users, one per factory role (D-140), and the second people some maker-checker
 * flows need (a second Finance Manager for the close, D-169). `password` comes from `UAT_SEED_PASSWORD`.
 */
async function seedPeople(tx: Tx, passwordHash: string | undefined): Promise<number> {
  const factory = await tx.factory.findUniqueOrThrow({ where: { code: UAT_FACTORY_CODE } });
  const people: { email: string; kind: 'partner' | 'staff'; role: string; name: string }[] = [
    {
      email: 'factory-owner@uat.example.invalid',
      kind: 'partner',
      role: 'factory_owner',
      name: 'เจ้าของโรงงาน ทดสอบ',
    },
    {
      email: 'factory-planner@uat.example.invalid',
      kind: 'partner',
      role: 'factory_planner',
      name: 'ฝ่ายวางแผน ทดสอบ',
    },
    {
      email: 'factory-operator@uat.example.invalid',
      kind: 'partner',
      role: 'factory_operator',
      name: 'พนักงานผลิต ทดสอบ',
    },
    { email: 'factory-qc@uat.example.invalid', kind: 'partner', role: 'factory_qc', name: 'ฝ่าย QC ทดสอบ' },
    {
      email: 'factory-shipping@uat.example.invalid',
      kind: 'partner',
      role: 'factory_shipping',
      name: 'ฝ่ายจัดส่ง ทดสอบ',
    },
    {
      email: 'factory-accountant@uat.example.invalid',
      kind: 'partner',
      role: 'factory_accountant',
      name: 'บัญชีโรงงาน ทดสอบ',
    },
    {
      email: 'finance-manager-2@example.invalid',
      kind: 'staff',
      role: 'finance_manager',
      name: 'ผู้จัดการการเงินคนที่ 2 ทดสอบ',
    },
    { email: 'cs-2@example.invalid', kind: 'staff', role: 'cs', name: 'CS คนที่ 2 ทดสอบ' },
  ];
  const finance = await tx.team.findUnique({ where: { code: 'finance' } });
  const cs = await tx.team.findUnique({ where: { code: 'cs' } });
  for (const p of people) {
    const role = await tx.role.findUniqueOrThrow({ where: { key: p.role } });
    await tx.user.create({
      data: {
        kind: p.kind,
        status: 'active',
        email: p.email,
        emailVerifiedAt: new Date(),
        displayName: p.name,
        ...(passwordHash && { passwordHash, passwordChangedAt: new Date() }),
        ...(p.kind === 'staff' && {
          staffProfile: { create: { teamId: (p.role === 'cs' ? cs : finance)?.id ?? null } },
        }),
        roles: {
          create: {
            roleId: role.id,
            scopeType: p.kind === 'partner' ? 'factory' : 'platform',
            ...(p.kind === 'partner' && { scopeId: factory.id }),
            reason: 'UAT rehearsal seed (fake user)',
          },
        },
      },
    });
  }
  return people.length;
}

/**
 * The rehearsal layer on top of the dev seed: realistic catalogue, prices copied from the dev fake lines,
 * geography, shipping, FAQs, factory users. Runs once (skips when `uat-serum-box` exists).
 */
export async function seedUatCatalog(
  tx: Tx,
  opts: { password?: string; instantTypes: readonly string[] },
): Promise<Report> {
  const report: Report = {};
  if (await tx.catalogProduct.findUnique({ where: { slug: 'uat-serum-box' } })) return report;
  await renameDevData(tx);
  await tx.productType.updateMany({ data: { status: 'active' } });
  await tx.productType.updateMany({
    where: { code: { in: [...opts.instantTypes] } },
    data: { quoteMode: 'instant' },
  });
  report['uat_geography'] = await seedGeographyAndShipping(tx);
  await seedFoldingPatterns(tx);
  const alike = await seedMasterData(tx);
  report['uat_catalog_products'] = await seedProducts(tx);
  const stock = await seedStockProducts(tx);
  report['uat_stock_products'] = stock.count;
  report['uat_stock_products_in_stock'] = stock.inStock;
  const plate = await tx.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-print-plate' } });
  const block = await tx.catalogProduct.findUniqueOrThrow({ where: { slug: 'uat-diecut-block' } });
  alike.set(plate.publicId, [block.publicId]);
  const added = await cloneFactoryPriceLines(tx, UAT_FACTORY_CODE, alike, { standard_product: stock.lines });
  for (const [type, n] of Object.entries(added)) report[`uat_price_lines_${type}`] = n;
  report['uat_faqs'] = await seedFaqs(tx);
  report['uat_hero_presets'] = await seedHeroPresets(tx);
  report['uat_people'] = await seedPeople(
    tx,
    opts.password ? await new PasswordService().hash(opts.password) : undefined,
  );
  return report;
}
