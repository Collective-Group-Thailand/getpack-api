import { Prisma, type PrismaClient } from '../../../src/generated/prisma/client';
import { UAT_FACTORY_CODE } from './uat-catalog';

/**
 * Packio Factory ERP rehearsal data (E1; D-316 – D-327) for the UAT factory: suppliers and a customer, two
 * warehouses, everyday items with opening balances (written the way the stock service writes them: one movement
 * per balance, average cost = the opening cost), one issued purchase order waiting for goods and one draft.
 * Obviously fake names; idempotent — a factory that already has ERP items is left alone.
 */
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
            taxId: `000050000${code.slice(1)}`.slice(0, 13).padEnd(13, '0'),
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
      const day = new Date().toISOString().slice(2, 7).replace('-', '');
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
      const today = new Date(new Date().toISOString().slice(0, 10));
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
