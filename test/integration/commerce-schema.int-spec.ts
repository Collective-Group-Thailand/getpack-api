import { createHash } from 'node:crypto';

import { type AppConfig } from '@config/app-config';
import { PrismaService } from '@database/prisma.service';
import { Client } from 'pg';

import { seedDev } from '../../prisma/seed/dev-seed';
import { startTestInfra, stopTestInfra, type TestInfra } from '../support/containers';
import { migrateDeploy, SQLSTATE } from '../support/database';

const sha = (s: string) => createHash('sha256').update(s).digest();

/** Guards of the B3.1 commerce tables (schema-design §3.6, A-31; PostgreSQL 18). */
describe('commerce schema — customers, carts, orders (PostgreSQL 18)', () => {
  let infra: TestInfra;
  let prisma: PrismaService;
  let client: Client;
  let fx: {
    entityId: bigint;
    customerId: bigint;
    staffId: bigint;
    provinceId: bigint;
    productTypeId: bigint;
    quoteId: bigint;
    optionId: bigint;
    reasonId: bigint;
  };

  beforeAll(async () => {
    infra = await startTestInfra();
    migrateDeploy(infra.env.DATABASE_URL!);
    prisma = new PrismaService({ get: () => infra.env.DATABASE_URL } as unknown as AppConfig);
    client = new Client({ connectionString: infra.env.DATABASE_URL });
    await client.connect();
    await seedDev(prisma);
    const entity = await prisma.entity.findFirstOrThrow({ where: { isDefault: true } });
    const customer = await prisma.user.findFirstOrThrow({ where: { kind: 'customer' } });
    const staff = await prisma.user.findFirstOrThrow({ where: { kind: 'staff' } });
    const province = await prisma.geoProvince.create({
      data: { code: 'INT-P1', nameTh: '[INT] จังหวัด', nameEn: '[INT] Province' },
    });
    const type = await prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
    const quote = await prisma.quote.create({
      data: {
        entityId: entity.id,
        channel: 'web',
        source: 'instant',
        customerUserId: customer.id,
        productTypeId: type.id,
        input: {},
        inputSchemaVersion: 1,
        calculatorVersion: 'int',
        configRefs: {},
        status: 'saved',
        validUntil: new Date(Date.now() + 86_400_000),
        snapshotSha256: sha('quote'),
        options: {
          create: {
            quantity: 1000,
            unit: 'piece',
            result: {},
            netAmount: '1000.00',
            vatAmount: '70.00',
            grossAmount: '1070.00',
            unitPrice: '1.070000',
          },
        },
      },
      include: { options: true },
    });
    const reason = await prisma.orderCancelReason.findUniqueOrThrow({ where: { code: 'customer_request' } });
    fx = {
      entityId: entity.id,
      customerId: customer.id,
      staffId: staff.id,
      provinceId: province.id,
      productTypeId: type.id,
      quoteId: quote.id,
      optionId: quote.options[0]!.id,
      reasonId: reason.id,
    };
  });

  afterAll(async () => {
    await client?.end();
    await prisma?.$disconnect();
    await stopTestInfra(infra);
  });

  /** SQLSTATE of a statement (null when it succeeds). */
  async function state(sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await client.query(sql, params);
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? 'unknown';
    }
  }

  let seq = 0;
  async function order(status: 'waiting_payment' | 'in_production' = 'waiting_payment') {
    seq += 1;
    const group = await prisma.orderGroup.create({
      data: {
        groupCode: `INT-OG-${seq}`,
        entityId: fx.entityId,
        customerUserId: fx.customerId,
        placedByUserId: fx.customerId,
        channel: 'web',
        status: 'waiting_payment',
        netAmount: '1000.00',
        vatAmount: '70.00',
        grossAmount: '1070.00',
        cashAmount: '1070.00',
      },
    });
    const created = await prisma.order.create({
      data: {
        orderCode: `INT-OR-${seq}`,
        entityId: fx.entityId,
        orderGroupId: group.id,
        customerUserId: fx.customerId,
        productTypeId: fx.productTypeId,
        quoteId: fx.quoteId,
        quoteOptionId: fx.optionId,
        artworkStatus: 'awaiting_upload',
        designOption: 'own_file',
        quantityOrdered: 1000,
        unit: 'piece',
        taxNature: 'hire_of_work',
        pricingSnapshot: { v: 1 },
        configRefs: {},
        snapshotSha256: sha(`order-${seq}`),
        netAmount: '1000.00',
        vatAmount: '70.00',
        grossAmount: '1070.00',
        cashAmount: '1070.00',
        lines: {
          create: {
            lineNo: 1,
            lineType: 'product',
            descriptionTh: 'สินค้า',
            descriptionEn: 'Product',
            quantity: '1000',
            unit: 'piece',
            unitPrice: '1.000000',
            netAmount: '1000.00',
            vatRatePct: '7',
            vatAmount: '70.00',
            grossAmount: '1070.00',
            whtCategory: 'hire_of_work',
            revenueCategory: 'made_to_order',
            taxNature: 'hire_of_work',
          },
        },
      },
      include: { lines: true },
    });
    if (status === 'waiting_payment') return created;
    await prisma.order.update({
      where: { id: created.id },
      data: { status, productionStartedAt: new Date(), startMode: 'auto' },
    });
    return created;
  }

  it('keeps the order snapshot write-once and re-prices only before production with a revision bump', async () => {
    const o = await order();
    expect(await state(`UPDATE orders SET order_code = 'CHANGED' WHERE id = $1`, [o.id])).toBe(
      SQLSTATE.restrictViolation,
    );
    expect(await state(`UPDATE orders SET pricing_snapshot = '{"v":2}' WHERE id = $1`, [o.id])).toBe(
      SQLSTATE.restrictViolation,
    );
    await prisma.order.update({
      where: { id: o.id },
      data: {
        pricingSnapshot: { v: 2 },
        netAmount: '900.00',
        vatAmount: '63.00',
        grossAmount: '963.00',
        cashAmount: '963.00',
        pricingRevision: 2,
      },
    });
    await prisma.order.update({ where: { id: o.id }, data: { artworkStatus: 'approved' } });
    expect(await state('DELETE FROM orders WHERE id = $1', [o.id])).toBe(SQLSTATE.restrictViolation);
  });

  it('freezes pricing, lines and destinations once production started', async () => {
    const o = await order('in_production');
    expect(
      await state(`UPDATE orders SET pricing_snapshot = '{"v":9}', pricing_revision = 2 WHERE id = $1`, [o.id]),
    ).toBe(SQLSTATE.restrictViolation);
    expect(await state(`UPDATE order_lines SET description_en = 'x' WHERE id = $1`, [o.lines[0]!.id])).toBe(
      SQLSTATE.restrictViolation,
    );
    expect(
      await state(
        `INSERT INTO order_destinations (order_id, recipient_name, phone, line1, postcode, province_id, quantity)
         VALUES ($1, '[INT] ผู้รับ', '+66800000001', '[INT] 1', '10110', $2, 1000)`,
        [o.id, fx.provinceId],
      ),
    ).toBe(SQLSTATE.restrictViolation);
  });

  it('keeps notes and price revisions append-only and groups undeletable', async () => {
    const o = await order();
    const note = await prisma.orderNote.create({
      data: { orderId: o.id, authorUserId: fx.staffId, body: 'หมายเหตุ' },
    });
    expect(await state(`UPDATE order_notes SET body = 'x' WHERE id = $1`, [note.id])).toBe(
      SQLSTATE.restrictViolation,
    );
    expect(await state('DELETE FROM order_groups WHERE id = $1', [o.orderGroupId])).toBe(
      SQLSTATE.restrictViolation,
    );
  });

  it('checks the §2.9 arithmetic and the cancel columns', async () => {
    await expect(
      prisma.orderGroup.create({
        data: {
          groupCode: 'INT-BAD',
          entityId: fx.entityId,
          customerUserId: fx.customerId,
          placedByUserId: fx.customerId,
          channel: 'web',
          status: 'waiting_payment',
          netAmount: '1000.00',
          vatAmount: '70.00',
          grossAmount: '1000.00',
          cashAmount: '1000.00',
        },
      }),
    ).rejects.toThrow(/ck_order_groups__gross/);
    const o = await order();
    await expect(
      prisma.orderGroup.update({ where: { id: o.orderGroupId }, data: { status: 'cancelled' } }),
    ).rejects.toThrow(/ck_order_groups__cancelled/);
    await prisma.orderGroup.update({
      where: { id: o.orderGroupId },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelReasonId: fx.reasonId },
    });
  });

  it('allows one active cart per customer and channel and one default address and tax profile', async () => {
    const cart = { entityId: fx.entityId, customerUserId: fx.customerId, channel: 'cs' as const };
    await prisma.cart.create({ data: cart });
    await expect(prisma.cart.create({ data: cart })).rejects.toThrow();
    await prisma.cart.create({ data: { ...cart, status: 'abandoned' } });

    const address = {
      userId: fx.customerId,
      kind: 'delivery' as const,
      label: 'บ้าน',
      recipientName: '[INT] ผู้รับ',
      phone: '+66800000002',
      line1: '[INT] 1',
      postcode: '10110',
      provinceId: fx.provinceId,
      isDefault: true,
    };
    const first = await prisma.customerAddress.create({ data: address });
    await expect(prisma.customerAddress.create({ data: address })).rejects.toThrow();
    await prisma.customerAddress.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    await prisma.customerAddress.create({ data: address });
    await expect(
      prisma.customerAddress.create({ data: { ...address, isDefault: false, phone: '0812345678' } }),
    ).rejects.toThrow(/phone_e164/);

    const profile = {
      userId: fx.customerId,
      taxType: 'juristic' as const,
      name: '[INT] บริษัท ทดสอบ จำกัด',
      taxId: '0000000000001',
      line1: '[INT] 1',
      postcode: '10110',
      provinceId: fx.provinceId,
    };
    await expect(
      prisma.taxProfile.create({ data: { ...profile, branchType: 'head_office', branchCode: '00001' } }),
    ).rejects.toThrow(/ck_tax_profiles__branch/);
    await prisma.taxProfile.create({ data: { ...profile, branchType: 'branch', branchCode: '00001' } });
  });

  it('keeps a pending re-price complete (option, quote and diff together)', async () => {
    const cart = await prisma.cart.create({
      data: { entityId: fx.entityId, customerUserId: fx.customerId, channel: 'line' },
    });
    const item = {
      cartId: cart.id,
      quoteId: fx.quoteId,
      quoteOptionId: fx.optionId,
      quantity: 1000,
      designOption: 'own_file' as const,
      netAmount: '1000.00',
      vatAmount: '70.00',
      grossAmount: '1070.00',
      unitPrice: '1.070000',
      priceLockedUntil: new Date(),
    };
    await expect(prisma.cartItem.create({ data: { ...item, pendingQuoteId: fx.quoteId } })).rejects.toThrow(
      /ck_cart_items__pending/,
    );
    await expect(prisma.cartItem.create({ data: { ...item, grossAmount: '1.00' } })).rejects.toThrow(
      /ck_cart_items__gross/,
    );
    await prisma.cartItem.create({ data: item });
  });
});
