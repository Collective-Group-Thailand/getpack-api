import { randomUUID } from 'node:crypto';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import { as, foldingBackToRfq, foldingReady, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

/**
 * Packio Factory ERP, phase E1 (docs/prompts/E1-factory-erp.md): trading partners, items, warehouses, the
 * stock ledger at moving average cost, purchase orders and goods receipts — factory-private (D-316 – D-327).
 */
describe('Packio Factory ERP E1 (e2e)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let owner: string;
  let base: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 301);
    base = `/v1/partner/factories/${fixture.factoryPublicId}/erp`;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const post = (token: string, path: string, body: object, key: string | null = randomUUID()) => {
    const req = as(ctx, token).post(`${base}${path}`, body);
    return key ? req.set('Idempotency-Key', key) : req;
  };

  it('runs stock and purchasing end to end at moving average cost', async () => {
    const sku = `PAP-${ctx.run}`;

    // Supplier with a generated code; warehouses start with MAIN.
    const supplier = (
      await as(ctx, owner)
        .post(`${base}/partners`, { kind: 'supplier', name: 'บจก. กระดาษ (ทดสอบ)', paymentTermDays: 30 })
        .expect(201)
    ).body;
    expect(supplier.code).toMatch(/^S\d{4}$/);
    const warehouses = (await as(ctx, owner).get(`${base}/warehouses`).expect(200)).body;
    expect(warehouses).toEqual([expect.objectContaining({ code: 'MAIN', isDefault: true })]);

    // An item bought by the ream (500 sheets), stocked by the sheet.
    const item = (
      await as(ctx, owner)
        .post(`${base}/items`, {
          sku,
          name: 'กระดาษคราฟท์ 350 แกรม (ทดสอบ)',
          kind: 'raw_material',
          baseUnit: 'sheet',
          purchaseUnit: 'ream',
          purchaseFactor: '500',
          reorderPoint: '5000',
          reorderQty: '10000',
          leadTimeDays: 7,
          defaultSupplierId: supplier.id,
        })
        .expect(201)
    ).body;
    expect(item).toMatchObject({ sku, purchaseFactor: '500.000000', stock: { onHand: '0.000', low: true } });
    await as(ctx, owner)
      .post(`${base}/items`, { sku, name: 'ซ้ำ', kind: 'consumable', baseUnit: 'pcs' })
      .expect(409);

    // Opening balance: 1 000 sheets at 2.80.
    const opening = (
      await post(owner, '/stock/actions/adjust', {
        kind: 'opening',
        lines: [{ itemId: item.id, quantity: '1000', unitCost: '2.8' }],
      }).expect(200)
    ).body;
    expect(opening.documentNo).toMatch(/^ADJ-\d{4}-\d{4}$/);
    expect(opening.movements[0]).toMatchObject({ kind: 'opening', quantity: '1000.000', value: '2800.00' });

    // Reorder: available 1 000 ≤ 5 000 → 10 000 sheets = 20 reams from the default supplier.
    const reorder = (await as(ctx, owner).get(`${base}/stock/reorder`).expect(200)).body as {
      item: { id: string };
    }[];
    expect(reorder.find((r) => r.item.id === item.id)).toMatchObject({
      supplier: { id: supplier.id },
      toOrderQty: '10000.000',
      toOrderPurchaseQty: '20.000',
      purchaseUnit: 'ream',
    });

    // A draft from the reorder list, priced and issued.
    const drafted = (
      await as(ctx, owner)
        .post(`${base}/purchase-orders/actions/from-reorder`, { itemIds: [item.id] })
        .expect(201)
    ).body;
    expect(drafted.created).toHaveLength(1);
    const draftId = drafted.created[0].id as string;
    const draft = await as(ctx, owner).get(`${base}/purchase-orders/${draftId}`).expect(200);
    expect(draft.body).toMatchObject({ status: 'draft', poNo: null });
    expect((draft.body.nextActions as { key: string }[]).map((a) => a.key)).toEqual([
      'erp_po.edit',
      'erp_po.issue',
      'erp_po.cancel',
    ]);
    const edited = await as(ctx, owner)
      .put(`${base}/purchase-orders/${draftId}`, {
        supplierId: supplier.id,
        vatMode: 'exclusive',
        lines: [{ itemId: item.id, quantity: '20', unit: 'ream', unitPrice: '1425' }],
      })
      .set('If-Match', draft.headers['etag'] as string)
      .expect(200);
    expect(edited.body).toMatchObject({ subtotal: '28500.00', vatAmount: '1995.00', total: '30495.00' });
    await as(ctx, owner)
      .put(`${base}/purchase-orders/${draftId}`, {
        supplierId: supplier.id,
        lines: [{ itemId: item.id, quantity: '1', unitPrice: '1' }],
      })
      .set('If-Match', draft.headers['etag'] as string)
      .expect(412);

    // A purchaser drafts but cannot issue (D-319); the owner issues.
    const purchaser = await factoryToken(ctx, fixture.factoryPublicId, 'factory_purchaser', 302);
    await post(purchaser, `/purchase-orders/${draftId}/actions/issue`, {}).expect(403);
    const issued = (await post(owner, `/purchase-orders/${draftId}/actions/issue`, {}).expect(200)).body;
    expect(issued).toMatchObject({ status: 'issued' });
    expect(issued.poNo).toMatch(/^PO-\d{4}-\d{4}$/);
    await as(ctx, owner)
      .put(`${base}/purchase-orders/${draftId}`, {
        supplierId: supplier.id,
        lines: [{ itemId: item.id, quantity: '1', unitPrice: '1' }],
      })
      .set('If-Match', '*')
      .expect(409);

    // Receive half: 10 reams = 5 000 sheets at 2.85 → average (2 800 + 14 250) / 6 000 = 2.841667.
    const line = issued.lines[0].id as string;
    const gr1 = (
      await post(owner, '/goods-receipts', {
        purchaseOrderId: draftId,
        deliveryNoteNo: 'DO-1',
        lines: [{ purchaseOrderLineId: line, quantity: '10' }],
      }).expect(201)
    ).body;
    expect(gr1.grNo).toMatch(/^GR-\d{4}-\d{4}$/);
    expect(gr1.lines[0]).toMatchObject({
      baseQuantity: '5000.000',
      unitCost: '2.850000',
      amount: '14250.00',
    });
    let po = (await as(ctx, owner).get(`${base}/purchase-orders/${draftId}`).expect(200)).body;
    expect(po).toMatchObject({
      status: 'partially_received',
      lines: [{ receivedQty: '10.000', remainingQty: '10.000' }],
    });
    let stock = (await as(ctx, owner).get(`${base}/items/${item.id}`).expect(200)).body.stock;
    expect(stock).toMatchObject({
      onHand: '6000.000',
      onOrder: '5000.000',
      avgCost: '2.841667',
      value: '17050.00',
    });

    // Over the 10 % tolerance: 10 left + 2 allowed = 12 at most.
    const over = await post(owner, '/goods-receipts', {
      purchaseOrderId: draftId,
      lines: [{ purchaseOrderLineId: line, quantity: '12.5' }],
    }).expect(422);
    expect(over.body.code).toBe('erp.over_receipt');
    await post(owner, '/goods-receipts', {
      purchaseOrderId: draftId,
      lines: [{ purchaseOrderLineId: line, quantity: '10' }],
    }).expect(201);
    po = (await as(ctx, owner).get(`${base}/purchase-orders/${draftId}`).expect(200)).body;
    expect(po).toMatchObject({ status: 'received', nextActions: [] });
    await post(owner, '/goods-receipts', {
      purchaseOrderId: draftId,
      lines: [{ purchaseOrderLineId: line, quantity: '1' }],
    }).expect(409);

    // Issue to production at the average; beyond the stock is refused (D-322); a replay returns the same posting.
    const key = randomUUID();
    const issuedStock = (
      await post(
        owner,
        '/stock/actions/issue',
        { kind: 'issue', reference: 'JOB-TEST', lines: [{ itemId: item.id, quantity: '7000' }] },
        key,
      ).expect(200)
    ).body;
    expect(issuedStock.documentNo).toMatch(/^ISS-\d{4}-\d{4}$/);
    const replay = (
      await post(
        owner,
        '/stock/actions/issue',
        { kind: 'issue', reference: 'JOB-TEST', lines: [{ itemId: item.id, quantity: '7000' }] },
        key,
      ).expect(200)
    ).body;
    expect(replay.documentNo).toBe(issuedStock.documentNo);
    const short = await post(owner, '/stock/actions/issue', {
      kind: 'issue',
      lines: [{ itemId: item.id, quantity: '99999' }],
    }).expect(409);
    expect(short.body.code).toBe('erp.stock_insufficient');

    // A count: 4 000 on the books, 3 990 counted → −10; a matching count posts nothing.
    const counted = (
      await post(owner, '/stock/actions/adjust', {
        kind: 'count',
        reason: 'นับสิ้นเดือน',
        lines: [{ itemId: item.id, quantity: '3990' }],
      }).expect(200)
    ).body;
    expect(counted.movements[0]).toMatchObject({
      kind: 'count',
      quantity: '-10.000',
      balanceAfter: '3990.000',
    });
    const same = (
      await post(owner, '/stock/actions/adjust', {
        kind: 'count',
        reason: 'นับซ้ำ',
        lines: [{ itemId: item.id, quantity: '3990' }],
      }).expect(200)
    ).body;
    expect(same).toMatchObject({ documentNo: null, movements: [] });
    await post(owner, '/stock/actions/adjust', {
      kind: 'adjustment',
      lines: [{ itemId: item.id, quantity: '5' }],
    }).expect(422);

    // Transfer to a second warehouse at the same cost.
    const wh2 = (
      await as(ctx, owner).post(`${base}/warehouses`, { code: 'wh2', name: 'คลังหน้าเครื่อง' }).expect(201)
    ).body;
    expect(wh2.code).toBe('WH2');
    const trf = (
      await post(owner, '/stock/actions/transfer', {
        fromWarehouseId: warehouses[0].id,
        toWarehouseId: wh2.id,
        lines: [{ itemId: item.id, quantity: '500' }],
      }).expect(200)
    ).body;
    expect((trf.movements as { kind: string; quantity: string }[]).map((m) => [m.kind, m.quantity])).toEqual([
      ['transfer_out', '-500.000'],
      ['transfer_in', '500.000'],
    ]);
    expect(trf.movements[0].unitCost).toBe(trf.movements[1].unitCost);

    // The ledger adds up to the balances, and the value is unchanged by the transfer.
    const ledger = (
      await as(ctx, owner).get(`${base}/stock/movements?itemId=${item.id}&perPage=100`).expect(200)
    ).body;
    const sum = (ledger.data as { quantity: string }[]).reduce((a, m) => a + Number(m.quantity), 0);
    stock = (await as(ctx, owner).get(`${base}/items/${item.id}`).expect(200)).body.stock;
    expect(sum).toBeCloseTo(Number(stock.onHand), 3);
    expect(stock.onHand).toBe('3990.000');
    const balances = (await as(ctx, owner).get(`${base}/stock?q=${sku}`).expect(200)).body.data;
    expect(
      (balances as { warehouse: { code: string }; onHand: string }[])
        .map((b) => [b.warehouse.code, b.onHand])
        .sort(),
    ).toEqual([
      ['MAIN', '3490.000'],
      ['WH2', '500.000'],
    ]);
    const overview = (await as(ctx, owner).get(`${base}/stock/overview`).expect(200)).body;
    expect(overview).toMatchObject({ items: expect.any(Number), currency: 'THB' });

    // Append-only ledger at the database (D-324).
    await expect(
      ctx.prisma.erpStockMovement.updateMany({ where: { itemId: { gt: 0n } }, data: { reason: 'x' } }),
    ).rejects.toThrow();
  });

  it('keeps the ERP private to the factory (D-317, D-319)', async () => {
    const other = await ctx.prisma.factory.findFirst({
      where: { publicId: { not: fixture.factoryPublicId } },
    });
    if (other) await as(ctx, owner).get(`/v1/partner/factories/${other.publicId}/erp/items`).expect(404);

    const staff = await staffToken(ctx, 'superadmin');
    await as(ctx, staff).get(`${base}/items`).expect(403);

    const storekeeper = await factoryToken(ctx, fixture.factoryPublicId, 'factory_storekeeper', 303);
    await as(ctx, storekeeper).get(`${base}/items`).expect(200);
    await post(storekeeper, '/stock/actions/adjust', { kind: 'opening', lines: [] }).expect(403);
    await as(ctx, storekeeper).post(`${base}/partners`, { kind: 'supplier', name: 'x' }).expect(403);

    const operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 304);
    await as(ctx, operator).get(`${base}/partners`).expect(403);
  });
});
