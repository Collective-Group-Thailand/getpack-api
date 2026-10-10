import { Prisma, type PrismaClient } from '../../../src/generated/prisma/client';
import { UAT_FACTORY_CODE } from './uat-catalog';

/**
 * Packio Factory ERP rehearsal data (E1; D-316 – D-327) for the UAT factory: suppliers and a customer, two
 * warehouses, everyday items with opening balances (written the way the stock service writes them: one movement
 * per balance, average cost = the opening cost), one issued purchase order waiting for goods and one draft.
 * Obviously fake names; idempotent — a factory that already has ERP items is left alone.
 */
/** An obviously fake 13-digit tax id (`0000…`) with a valid check digit, so forms accept it. */
function fakeTaxId(code: string): string {
  const twelve = `00005000${code.slice(1).padStart(4, '0')}`.slice(0, 12);
  const sum = [...twelve].reduce((total, digit, index) => total + Number(digit) * (13 - index), 0);
  return `${twelve}${(11 - (sum % 11)) % 10}`;
}

export async function seedUatErp(prisma: PrismaClient): Promise<number> {
  const factory = await prisma.factory.findUnique({ where: { code: UAT_FACTORY_CODE } });
  if (!factory) return 0;
  if (await prisma.erpItem.count({ where: { factoryId: factory.id } })) return 0;
  const owner = await prisma.userRole.findFirst({
    where: { scopeType: 'factory', scopeId: factory.id, role: { key: 'factory_owner' }, revokedAt: null },
  });
  const by = owner?.userId ?? (await prisma.user.findFirstOrThrow({ where: { kind: 'staff' } })).id;

  return prisma.$transaction(
    async (tx) => {
      const partner = (
        code: string,
        kind: 'supplier' | 'customer',
        name: string,
        phone: string,
        days: number,
      ) =>
        tx.erpTradingPartner.create({
          data: {
            factoryId: factory.id,
            code,
            kind,
            name,
            phone,
            contactName: 'คุณทดสอบ (ข้อมูลปลอม)',
            taxId: fakeTaxId(code),
            branchCode: '00000',
            paymentTermDays: days,
            createdById: by,
          },
        });
      const paper = await partner('S0001', 'supplier', 'บจก. กระดาษทดสอบ (ข้อมูลปลอม)', '020000001', 30);
      const ink = await partner('S0002', 'supplier', 'หจก. หมึกพิมพ์ทดสอบ (ข้อมูลปลอม)', '020000002', 30);
      const parts = await partner(
        'S0003',
        'supplier',
        'ร้านอะไหล่เครื่องจักรทดสอบ (ข้อมูลปลอม)',
        '020000003',
        0,
      );
      await partner('C0001', 'customer', 'บจก. ลูกค้าตรงทดสอบ (ข้อมูลปลอม)', '020000010', 30);

      const main = await tx.erpWarehouse.create({
        data: { factoryId: factory.id, code: 'MAIN', name: 'คลังหลัก', isDefault: true, createdById: by },
      });
      await tx.erpWarehouse.create({
        data: { factoryId: factory.id, code: 'LINE', name: 'คลังหน้าเครื่อง', createdById: by },
      });

      type Seed = {
        sku: string;
        name: string;
        kind: 'raw_material' | 'consumable' | 'spare_part' | 'packing';
        base: 'sheet' | 'kg' | 'pcs' | 'roll';
        purchase?: { unit: 'ream' | 'ton' | 'box'; factor: number };
        supplierId: bigint;
        reorderPoint: number;
        reorderQty: number;
        lead: number;
        opening: number;
        cost: string;
        lots?: boolean;
      };
      const items: Seed[] = [
        {
          sku: 'KA-350',
          name: 'กระดาษคราฟท์ 350 แกรม 31×43 นิ้ว',
          kind: 'raw_material',
          base: 'sheet',
          purchase: { unit: 'ream', factor: 500 },
          supplierId: paper.id,
          reorderPoint: 5000,
          reorderQty: 10000,
          lead: 7,
          opening: 12500,
          cost: '2.850000',
        },
        {
          sku: 'ART-300',
          name: 'กระดาษอาร์ตการ์ด 300 แกรม 25×36 นิ้ว',
          kind: 'raw_material',
          base: 'sheet',
          purchase: { unit: 'ream', factor: 500 },
          supplierId: paper.id,
          reorderPoint: 4000,
          reorderQty: 10000,
          lead: 7,
          opening: 3000,
          cost: '3.400000',
        },
        {
          sku: 'DUP-350',
          name: 'กระดาษกล่องแป้งหลังเทา (Duplex) 350 แกรม',
          kind: 'raw_material',
          base: 'kg',
          purchase: { unit: 'ton', factor: 1000 },
          supplierId: paper.id,
          reorderPoint: 800,
          reorderQty: 2000,
          lead: 10,
          opening: 1650,
          cost: '29.500000',
          lots: true,
        },
        {
          sku: 'INK-CMYK-K',
          name: 'หมึกออฟเซ็ต สีดำ',
          kind: 'consumable',
          base: 'kg',
          supplierId: ink.id,
          reorderPoint: 20,
          reorderQty: 50,
          lead: 3,
          opening: 35,
          cost: '320.000000',
        },
        {
          sku: 'GLUE-PVA',
          name: 'กาวน้ำ PVA สำหรับปะกล่อง',
          kind: 'consumable',
          base: 'kg',
          supplierId: ink.id,
          reorderPoint: 40,
          reorderQty: 100,
          lead: 3,
          opening: 18,
          cost: '85.000000',
        },
        {
          sku: 'PLATE-CTP',
          name: 'เพลท CTP 745×605 มม.',
          kind: 'consumable',
          base: 'pcs',
          purchase: { unit: 'box', factor: 50 },
          supplierId: ink.id,
          reorderPoint: 60,
          reorderQty: 100,
          lead: 5,
          opening: 140,
          cost: '160.000000',
        },
        {
          sku: 'BLADE-DC',
          name: 'ใบมีดไดคัท (อะไหล่)',
          kind: 'spare_part',
          base: 'pcs',
          supplierId: parts.id,
          reorderPoint: 5,
          reorderQty: 10,
          lead: 14,
          opening: 8,
          cost: '450.000000',
        },
        {
          sku: 'STRETCH',
          name: 'ฟิล์มยืดพันพาเลท',
          kind: 'packing',
          base: 'roll',
          supplierId: parts.id,
          reorderPoint: 10,
          reorderQty: 24,
          lead: 3,
          opening: 30,
          cost: '210.000000',
        },
      ];
      const created = new Map<string, { id: bigint; factor: number }>();
      const bangkok = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
      const day = bangkok.slice(2, 7).replace('-', '');
      await tx.erpDocumentSeries.create({
        data: { factoryId: factory.id, docType: 'adj', period: day, nextNo: 2 },
      });
      const openingId = '0192f3a0-7c1e-7d2a-9b1f-0000000ee001';
      for (const s of items) {
        const item = await tx.erpItem.create({
          data: {
            factoryId: factory.id,
            sku: s.sku,
            name: `${s.name} (ข้อมูลปลอม)`,
            kind: s.kind,
            baseUnit: s.base,
            purchaseUnit: s.purchase?.unit ?? null,
            purchaseFactor: String(s.purchase?.factor ?? 1),
            reorderPoint: String(s.reorderPoint),
            reorderQty: String(s.reorderQty),
            leadTimeDays: s.lead,
            defaultSupplierId: s.supplierId,
            trackLots: s.lots ?? false,
            lastPurchasePrice: new Prisma.Decimal(s.cost).times(s.purchase?.factor ?? 1).toFixed(6),
            createdById: by,
          },
        });
        created.set(s.sku, { id: item.id, factor: s.purchase?.factor ?? 1 });
        const value = new Prisma.Decimal(s.cost).times(s.opening).toFixed(2);
        await tx.erpStockBalance.create({
          data: {
            factoryId: factory.id,
            itemId: item.id,
            warehouseId: main.id,
            onHand: String(s.opening),
            avgCost: s.cost,
            value,
          },
        });
        await tx.erpStockMovement.create({
          data: {
            factoryId: factory.id,
            itemId: item.id,
            warehouseId: main.id,
            kind: 'opening',
            quantity: String(s.opening),
            unitCost: s.cost,
            value,
            balanceAfter: String(s.opening),
            avgCostAfter: s.cost,
            lotNo: s.lots ? 'LOT-UAT-001' : null,
            sourceType: 'adjustment',
            sourcePublicId: openingId,
            documentNo: `ADJ-${day}-0001`,
            reason: 'ยอดยกมา (ข้อมูลปลอม)',
            createdById: by,
          },
        });
      }

      // An issued order for art card (low) waiting for goods, and a draft for glue.
      await tx.erpDocumentSeries.create({
        data: { factoryId: factory.id, docType: 'po', period: day, nextNo: 2 },
      });
      const art = created.get('ART-300')!;
      const today = new Date(`${bangkok}T00:00:00.000Z`);
      const inAWeek = new Date(today.getTime() + 7 * 86_400_000);
      await tx.erpPurchaseOrder.create({
        data: {
          factoryId: factory.id,
          poNo: `PO-${day}-0001`,
          supplierId: paper.id,
          status: 'issued',
          orderedOn: today,
          expectedOn: inAWeek,
          subtotal: '34000.00',
          vatAmount: '2380.00',
          total: '36380.00',
          issuedAt: new Date(),
          issuedById: by,
          createdById: by,
          lines: {
            create: [
              {
                lineNo: 1,
                itemId: art.id,
                quantity: '20',
                unit: 'ream',
                factor: '500',
                unitPrice: '1700',
                amount: '34000.00',
              },
            ],
          },
        },
      });
      const glue = created.get('GLUE-PVA')!;
      await tx.erpPurchaseOrder.create({
        data: {
          factoryId: factory.id,
          supplierId: ink.id,
          orderedOn: today,
          expectedOn: inAWeek,
          subtotal: '8500.00',
          vatAmount: '595.00',
          total: '9095.00',
          note: 'ร่างไว้ รอเจ้าของอนุมัติ (ข้อมูลปลอม)',
          createdById: by,
          lines: {
            create: [
              {
                lineNo: 1,
                itemId: glue.id,
                quantity: '100',
                unit: 'kg',
                factor: '1',
                unitPrice: '85',
                amount: '8500.00',
              },
            ],
          },
        },
      });
      return items.length;
    },
    { timeout: 60_000 },
  );
}

/**
 * E1.1 + E2 rehearsal data (D-333 – D-342) on top of `seedUatErp`: each item linked to its supplier with a
 * short price history, a second paper supplier selling by the pack (cheaper per sheet, quoted), a finished
 * product with its recipe and one planned production order. Idempotent — skipped once links exist.
 */
export async function seedUatErpE2(prisma: PrismaClient): Promise<number> {
  const factory = await prisma.factory.findUnique({ where: { code: UAT_FACTORY_CODE } });
  if (!factory) return 0;
  if (await prisma.erpItemSupplier.count({ where: { factoryId: factory.id } })) return 0;
  const items = await prisma.erpItem.findMany({
    where: { factoryId: factory.id, defaultSupplierId: { not: null } },
  });
  if (items.length === 0) return 0;
  const owner = await prisma.userRole.findFirst({
    where: { scopeType: 'factory', scopeId: factory.id, role: { key: 'factory_owner' }, revokedAt: null },
  });
  const by = owner?.userId ?? (await prisma.user.findFirstOrThrow({ where: { kind: 'staff' } })).id;
  const bangkok = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const today = new Date(`${bangkok}T00:00:00.000Z`);
  const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000);
  const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

  return prisma.$transaction(
    async (tx) => {
      let n = 0;
      for (const item of items) {
        const factor = D(item.purchaseFactor);
        const unit = item.purchaseUnit ?? item.baseUnit;
        const last = item.lastPurchasePrice ? D(item.lastPurchasePrice) : null;
        await tx.erpItemSupplier.create({
          data: {
            factoryId: factory.id,
            itemId: item.id,
            supplierId: item.defaultSupplierId!,
            purchaseUnit: unit,
            purchaseFactor: factor.toFixed(6),
            leadTimeDays: item.leadTimeDays,
            lastPrice: last?.toFixed(6) ?? null,
            lastPricedOn: last ? daysAgo(12) : null,
            lastPurchasedOn: last ? daysAgo(12) : null,
            preferred: true,
            // D-351: the factory's usual suppliers are on its approved list.
            approval: 'approved',
            approvedAt: new Date(),
            approvedById: by,
            approvalNote: 'ผู้ขายประจำ (ข้อมูลทดสอบ)',
            createdById: by,
          },
        });
        if (last)
          // Three receipts over two months: the price crept up 3 % then 2 %.
          for (const [ago, k] of [
            [70, '0.95'],
            [40, '0.98'],
            [12, '1'],
          ] as const) {
            const price = last.times(k).toDecimalPlaces(2);
            await tx.erpPriceRecord.create({
              data: {
                factoryId: factory.id,
                itemId: item.id,
                supplierId: item.defaultSupplierId!,
                source: 'goods_receipt',
                unit,
                factor: factor.toFixed(6),
                unitPrice: price.toFixed(6),
                baseUnitPrice: price.div(factor).toFixed(6),
                quantity: '10',
                pricedOn: daysAgo(ago),
                documentNo: `GR-UAT-${ago}`,
                note: 'ประวัติราคา (ข้อมูลปลอม)',
                createdById: by,
              },
            });
          }
        n += 1;
      }

      // A second paper supplier for KA-350, by the pack of 250 — cheaper per sheet, quoted for 60 days.
      const kraft = items.find((i) => i.sku === 'KA-350');
      if (kraft) {
        const taken = await tx.erpTradingPartner.findMany({
          where: { factoryId: factory.id, code: { startsWith: 'S' } },
          select: { code: true },
        });
        const altCode = `S${String(Math.max(0, ...taken.map((t) => Number(t.code.slice(1)) || 0)) + 1).padStart(4, '0')}`;
        const alt = await tx.erpTradingPartner.create({
          data: {
            factoryId: factory.id,
            code: altCode,
            kind: 'supplier',
            name: 'บจก. กระดาษทางเลือกทดสอบ (ข้อมูลปลอม)',
            phone: '020000004',
            contactName: 'คุณทดสอบ (ข้อมูลปลอม)',
            taxId: fakeTaxId(altCode),
            branchCode: '00000',
            paymentTermDays: 45,
            createdById: by,
          },
        });
        await tx.erpItemSupplier.create({
          data: {
            factoryId: factory.id,
            itemId: kraft.id,
            supplierId: alt.id,
            supplierSku: 'KF350-P250',
            purchaseUnit: 'pack',
            purchaseFactor: '250.000000',
            minOrderQty: '8',
            leadTimeDays: 10,
            lastPrice: '690.000000',
            lastPricedOn: daysAgo(3),
            createdById: by,
          },
        });
        await tx.erpPriceRecord.create({
          data: {
            factoryId: factory.id,
            itemId: kraft.id,
            supplierId: alt.id,
            source: 'quotation',
            unit: 'pack',
            factor: '250.000000',
            unitPrice: '690.000000',
            baseUnitPrice: '2.760000',
            pricedOn: daysAgo(3),
            validUntil: new Date(today.getTime() + 60 * 86_400_000),
            documentNo: 'QT-UAT-001',
            note: 'ใบเสนอราคา (ข้อมูลปลอม)',
            createdById: by,
          },
        });

        // A finished product, its recipe and one planned production order of 4 000.
        const main = await tx.erpWarehouse.findFirstOrThrow({
          where: { factoryId: factory.id, isDefault: true },
        });
        const glue = items.find((i) => i.sku === 'GLUE-PVA');
        const box = await tx.erpItem.create({
          data: {
            factoryId: factory.id,
            sku: 'FG-CRM-30',
            name: 'กล่องครีม 30 ml (ข้อมูลปลอม)',
            kind: 'finished_good',
            baseUnit: 'pcs',
            createdById: by,
          },
        });
        const machines = await tx.factoryMachine.findMany({
          where: { factoryId: factory.id },
          take: 2,
          orderBy: { id: 'asc' },
        });
        const recipe = await tx.erpRecipe.create({
          data: {
            factoryId: factory.id,
            itemId: box.id,
            name: 'กล่องครีม 30 ml — มาตรฐาน',
            createdById: by,
            materials: {
              create: [
                { lineNo: 1, itemId: kraft.id, quantity: '0.125000', scrapPct: '5.0000' },
                ...(glue ? [{ lineNo: 2, itemId: glue.id, quantity: '0.000400', scrapPct: '0.0000' }] : []),
              ],
            },
            operations: {
              create: [
                {
                  seq: 10,
                  name: 'พิมพ์ออฟเซ็ต 4 สี',
                  machineId: machines[0]?.id ?? null,
                  setupMinutes: 30,
                  runRatePerHour: '3000',
                },
                {
                  seq: 20,
                  name: 'ไดคัท',
                  machineId: machines[1]?.id ?? null,
                  setupMinutes: 20,
                  runRatePerHour: '2500',
                },
                { seq: 30, name: 'ปะกาว', setupMinutes: 15, runRatePerHour: '4000' },
              ],
            },
          },
        });
        const period = bangkok.slice(2, 7).replace('-', '');
        await tx.erpDocumentSeries.create({
          data: { factoryId: factory.id, docType: 'mo', period, nextNo: 2 },
        });
        await tx.erpProductionOrder.create({
          data: {
            factoryId: factory.id,
            moNo: `MO-${period}-0001`,
            source: 'stock',
            itemId: box.id,
            recipeId: recipe.id,
            title: 'กล่องครีม 30 ml (ข้อมูลปลอม)',
            quantity: '4000',
            unit: 'pcs',
            dueOn: new Date(today.getTime() + 10 * 86_400_000),
            plannedStartOn: new Date(today.getTime() + 3 * 86_400_000),
            warehouseId: main.id,
            createdById: by,
            materials: {
              create: [
                { lineNo: 1, itemId: kraft.id, requiredQty: '526.316', origin: 'recipe' },
                ...(glue ? [{ lineNo: 2, itemId: glue.id, requiredQty: '1.600', origin: 'recipe' }] : []),
              ],
            },
            operations: {
              create: [
                {
                  seq: 10,
                  name: 'พิมพ์ออฟเซ็ต 4 สี',
                  machineId: machines[0]?.id ?? null,
                  plannedMinutes: 110,
                },
                { seq: 20, name: 'ไดคัท', machineId: machines[1]?.id ?? null, plannedMinutes: 116 },
                { seq: 30, name: 'ปะกาว', plannedMinutes: 75 },
              ],
            },
          },
        });
      }
      return n;
    },
    { timeout: 60_000 },
  );
}

/**
 * E2.1 + E3 rehearsal data (D-346, D-355): quantity breaks on the first priced supplier link, and a preventive
 * plan on each of the UAT factory's machines (every 30 days or 500,000 impressions), started 25 days ago so one
 * comes due within the week. Idempotent — a factory with maintenance plans is left alone.
 */
export async function seedUatErpE3(prisma: PrismaClient): Promise<number> {
  const factory = await prisma.factory.findUnique({ where: { code: UAT_FACTORY_CODE } });
  if (!factory) return 0;
  if (await prisma.erpMaintenancePlan.count({ where: { factoryId: factory.id } })) return 0;
  const owner = await prisma.userRole.findFirst({
    where: { scopeType: 'factory', scopeId: factory.id, role: { key: 'factory_owner' }, revokedAt: null },
  });
  const by = owner?.userId ?? (await prisma.user.findFirstOrThrow({ where: { kind: 'staff' } })).id;
  const machines = await prisma.factoryMachine.findMany({
    where: { factoryId: factory.id, status: 'active' },
    orderBy: { id: 'asc' },
  });
  const spare = await prisma.erpItem.findFirst({ where: { factoryId: factory.id, kind: 'spare_part' } });
  const link = await prisma.erpItemSupplier.findFirst({
    where: { factoryId: factory.id, lastPrice: { not: null } },
    orderBy: { id: 'asc' },
  });
  return prisma.$transaction(async (tx) => {
    let n = 0;
    if (link) {
      const p = new Prisma.Decimal(link.lastPrice!);
      for (const [min, k] of [
        ['10', '1'],
        ['50', '0.97'],
        ['100', '0.95'],
      ] as const)
        await tx.erpPriceBreak.create({
          data: {
            itemSupplierId: link.id,
            minQty: min,
            unitPrice: p.times(k).toDecimalPlaces(2).toFixed(6),
            createdById: by,
          },
        });
    }
    for (const [i, m] of machines.entries()) {
      await tx.erpMaintenancePlan.create({
        data: {
          factoryId: factory.id,
          machineId: m.id,
          title: i === 0 ? 'ล้างระบบหมึก + อัดจาระบี (ทดสอบ)' : 'ตรวจใบมีด + ทำความสะอาด (ทดสอบ)',
          instructions: '1) ทำความสะอาด 2) ตรวจสภาพ 3) อัดจาระบีตามคู่มือ',
          everyDays: 30,
          everyImpressions: 500_000,
          durationMinutes: 120,
          lastDoneAt: new Date(Date.now() - (i === 0 ? 25 : 10) * 86_400_000),
          createdById: by,
          ...(spare && { parts: { create: [{ itemId: spare.id, quantity: '1' }] } }),
        },
      });
      n += 1;
    }
    return n;
  });
}
