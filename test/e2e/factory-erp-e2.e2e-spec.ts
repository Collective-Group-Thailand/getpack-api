import { randomUUID } from 'node:crypto';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  seedShipping,
  setFlag,
  staffToken,
} from '../support/commerce-e2e';
import {
  approveArtwork,
  bootFulfilmentApp,
  factoryToken,
  type FulfilmentApp,
  payDue,
} from '../support/fulfilment-e2e';

/**
 * getpack Factory ERP E1.1 + E2 (docs/prompts/E1-factory-erp.md, D-333 – D-342): supplier links and price
 * history, MRP → purchase request → purchase order → receipt, production orders with reservations, issues
 * and completion at cost, supplier invoices matched 3-way, payments and reversals, and a getpack job that
 * becomes a production order when the factory accepts it.
 */
describe('getpack Factory ERP E2 (e2e)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let owner: string;
  let base: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 401);
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
  type Rec = Record<string, unknown>;
  interface Link {
    supplier: { id: string };
    lastPrice: string;
    cheapest: boolean;
  }
  const get = async <T = Rec>(path: string, token = owner): Promise<T> =>
    (await as(ctx, token).get(`${base}${path}`).expect(200)).body as T;

  it('prices, plans, buys, makes and pays end to end', async () => {
    const run = ctx.run;
    const supplierA = (
      await as(ctx, owner)
        .post(`${base}/partners`, { kind: 'supplier', name: 'ผู้ขาย ก (ทดสอบ)', paymentTermDays: 30 })
        .expect(201)
    ).body;
    const supplierB = (
      await as(ctx, owner)
        .post(`${base}/partners`, { kind: 'supplier', name: 'ผู้ขาย ข (ทดสอบ)' })
        .expect(201)
    ).body;
    const paper = (
      await as(ctx, owner)
        .post(`${base}/items`, {
          sku: `E2P-${run}`,
          name: 'กระดาษ (ทดสอบ E2)',
          kind: 'raw_material',
          baseUnit: 'sheet',
          purchaseUnit: 'ream',
          purchaseFactor: '500',
          defaultSupplierId: supplierA.id,
        })
        .expect(201)
    ).body;
    const box = (
      await as(ctx, owner)
        .post(`${base}/items`, {
          sku: `E2B-${run}`,
          name: 'กล่อง (ทดสอบ E2)',
          kind: 'finished_good',
          baseUnit: 'pcs',
        })
        .expect(201)
    ).body;

    // E1.1: the default supplier is the preferred link; a second supplier sells by the pack of 250.
    let links = await get<Link[]>(`/items/${paper.id}/suppliers`);
    expect(links).toEqual([
      expect.objectContaining({
        supplier: expect.objectContaining({ id: supplierA.id }),
        preferred: true,
        purchaseUnit: 'ream',
      }),
    ]);
    const linkB = (
      await as(ctx, owner)
        .post(`${base}/items/${paper.id}/suppliers`, {
          supplierId: supplierB.id,
          purchaseUnit: 'pack',
          purchaseFactor: '250',
          minOrderQty: '4',
          price: '700',
          validUntil: '2099-12-31',
        })
        .expect(201)
    ).body;
    expect(linkB).toMatchObject({
      lastPrice: '700.000000',
      lastBaseUnitPrice: '2.800000',
      cheapest: true,
      preferred: false,
      quoteValidUntil: '2099-12-31',
    });
    await as(ctx, owner)
      .post(`${base}/items/${paper.id}/suppliers`, { supplierId: supplierB.id })
      .expect(409);
    await as(ctx, owner)
      .post(`${base}/items/${paper.id}/prices`, {
        supplierId: supplierA.id,
        source: 'quotation',
        unitPrice: '1425',
        documentNo: 'QT-1',
      })
      .expect(201);
    links = await get<Link[]>(`/items/${paper.id}/suppliers`);
    expect(links.map((l) => [l.supplier.id, l.lastPrice, l.cheapest])).toEqual([
      [supplierA.id, '1425.000000', false],
      [supplierB.id, '700.000000', true],
    ]);
    expect((await get(`/partners/${supplierB.id}/items`))[0]).toMatchObject({ item: { id: paper.id } });

    await post(owner, '/stock/actions/adjust', {
      kind: 'opening',
      lines: [{ itemId: paper.id, quantity: '1000', unitCost: '2.8' }],
    }).expect(200);

    // A recipe: half a sheet per box, printed at 1 000 an hour after a 30-minute setup.
    const recipe = (
      await as(ctx, owner)
        .post(`${base}/recipes`, {
          itemId: box.id,
          name: 'กล่องมาตรฐาน',
          materials: [{ itemId: paper.id, quantity: '0.5' }],
          operations: [{ name: 'พิมพ์', setupMinutes: 30, runRatePerHour: '1000' }],
        })
        .expect(201)
    ).body;
    expect(recipe.materials[0]).toMatchObject({ quantity: '0.500000' });

    // 4 000 boxes → 2 000 sheets; release reserves the 1 000 on hand, the rest is short.
    const mo = (
      await post(
        owner,
        '/production-orders',
        { source: 'stock', itemId: box.id, quantity: '4000', dueOn: '2099-01-31' },
        null,
      ).expect(201)
    ).body;
    expect(mo.moNo).toMatch(/^MO-\d{4}-\d{4}$/);
    expect(mo.materials[0]).toMatchObject({ requiredQty: '2000.000', origin: 'recipe' });
    expect(mo.operations[0]).toMatchObject({ plannedMinutes: 270, status: 'pending' });
    const released = (await post(owner, `/production-orders/${mo.id}/actions/release`, {}).expect(200)).body;
    expect(released).toMatchObject({
      status: 'released',
      short: true,
      materials: [{ reservedQty: '1000.000', shortQty: '1000.000' }],
    });
    expect((await get(`/items/${paper.id}`)).stock).toMatchObject({
      onHand: '1000.000',
      reserved: '1000.000',
      available: '0.000',
    });

    // MRP: 1 000 short → 2 reams from the preferred supplier; one purchase request.
    const mrp = (await get<{ item: { id: string } }[]>('/planning/mrp')).find((r) => r.item.id === paper.id);
    expect(mrp).toMatchObject({
      shortage: '1000.000',
      toOrderQty: '1000.000',
      toOrderPurchaseQty: '2.000',
      purchaseUnit: 'ream',
      supplier: { id: supplierA.id },
    });
    const pr = (await post(owner, '/planning/mrp/actions/request', { itemIds: [paper.id] }).expect(201)).body;
    expect(pr).toMatchObject({
      source: 'mrp',
      status: 'draft',
      lines: [{ quantity: '1000.000', estimatedUnitCost: '2.850000' }],
    });
    expect((await get<{ item: { id: string } }[]>('/planning/mrp')).some((r) => r.item.id === paper.id)).toBe(
      false,
    );

    // A storekeeper's request waits for approval; the owner's is approved on submit.
    const storekeeper = await factoryToken(ctx, fixture.factoryPublicId, 'factory_storekeeper', 402);
    const asked = (
      await as(ctx, storekeeper)
        .post(`${base}/purchase-requests`, { lines: [{ itemId: paper.id, quantity: '10' }] })
        .expect(201)
    ).body;
    expect(
      (await post(storekeeper, `/purchase-requests/${asked.id}/actions/submit`, {}).expect(200)).body.status,
    ).toBe('submitted');
    await post(storekeeper, `/purchase-requests/${asked.id}/actions/approve`, {}).expect(403);
    expect(
      (
        await post(owner, `/purchase-requests/${asked.id}/actions/reject`, { reason: 'ยังมีของพอ' }).expect(
          200,
        )
      ).body.status,
    ).toBe('rejected');
    expect(
      (await post(owner, `/purchase-requests/${pr.id}/actions/submit`, {}).expect(200)).body.status,
    ).toBe('approved');
    const converted = (await post(owner, `/purchase-requests/${pr.id}/actions/convert`, {}).expect(201)).body;
    expect(converted.created).toHaveLength(1);
    const prAfter = await get(`/purchase-requests/${pr.id}`);
    expect(prAfter).toMatchObject({
      status: 'ordered',
      lines: [{ purchaseOrder: { id: converted.created[0].id } }],
    });
    const poId = converted.created[0].id as string;
    let po = await get<{ lines: { id: string }[] }>(`/purchase-orders/${poId}`);
    expect(po).toMatchObject({
      supplier: { id: supplierA.id },
      lines: [{ quantity: '2.000', unit: 'ream', unitPrice: '1425.000000' }],
    });

    // Issue and receive: both prices go into the history; the link remembers the purchase.
    po = (await post(owner, `/purchase-orders/${poId}/actions/issue`, {}).expect(200)).body as typeof po;
    await post(owner, '/goods-receipts', {
      purchaseOrderId: poId,
      lines: [{ purchaseOrderLineId: po.lines[0]!.id, quantity: '2' }],
    }).expect(201);
    const history = await get(`/items/${paper.id}/prices?supplierId=${supplierA.id}`);
    expect((history.data as { source: string }[]).map((h) => h.source).sort()).toEqual([
      'goods_receipt',
      'purchase_order',
      'quotation',
    ]);
    links = await get<Link[]>(`/items/${paper.id}/suppliers`);
    expect(links[0]).toMatchObject({
      preferred: true,
      lastPurchasedOn: expect.any(String),
      stats: { purchases: 1, minBaseUnitPrice: '2.850000' },
    });

    // Issue everything to the order: reserved first, the newly received free stock next.
    const operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 403);
    await post(operator, `/production-orders/${mo.id}/actions/issue`, {}).expect(403);
    const issued = (await post(owner, `/production-orders/${mo.id}/actions/issue`, {}).expect(200)).body;
    expect(issued).toMatchObject({
      status: 'in_progress',
      short: false,
      materialCost: '5650.00',
      materials: [{ issuedQty: '2000.000', reservedQty: '0.000' }],
    });
    expect((issued.nextActions as { key: string }[]).map((a) => a.key)).not.toContain('erp_mo.issue');
    expect((await get(`/items/${paper.id}`)).stock).toMatchObject({ onHand: '0.000', reserved: '0.000' });

    // The floor: the operator starts and finishes the step, but cannot complete the order.
    const queue = await get<{ order: { id: string }; operation: { id: string } }[]>(
      '/planning/queue',
      operator,
    );
    const op = queue.find((q) => q.order.id === mo.id)!.operation;
    await post(operator, `/production-orders/${mo.id}/operations/${op.id}/actions/start`, {}).expect(200);
    await post(operator, `/production-orders/${mo.id}/operations/${op.id}/actions/finish`, {
      goodQty: '3900',
      scrapQty: '100',
    }).expect(200);
    await post(operator, `/production-orders/${mo.id}/actions/complete`, { goodQty: '3900' }).expect(403);
    await post(owner, `/production-orders/${mo.id}/actions/cancel`, { reason: 'ทดสอบ' }).expect(409);
    const done = (
      await post(owner, `/production-orders/${mo.id}/actions/complete`, {
        goodQty: '3900',
        scrapQty: '100',
      }).expect(200)
    ).body;
    expect(done).toMatchObject({ status: 'completed', progressPct: '100.00', unitCost: '1.448718' });
    expect((await get(`/items/${box.id}`)).stock).toMatchObject({ onHand: '3900.000', value: '5650.00' });

    // AP: the invoice that matches is payable; one priced above the tolerance waits for approval.
    const invoice = (
      await as(ctx, owner)
        .post(`${base}/supplier-invoices`, {
          supplierId: supplierA.id,
          purchaseOrderId: poId,
          invoiceNo: `IV-${run}`,
          invoiceDate: '2026-10-12',
          whtRatePct: '3',
          lines: [{ purchaseOrderLineId: po.lines[0]!.id, quantity: '2', unitPrice: '1425' }],
        })
        .expect(201)
    ).body;
    expect(invoice).toMatchObject({
      status: 'matched',
      dueDate: '2026-11-11',
      subtotal: '2850.00',
      vatAmount: '199.50',
      whtAmount: '85.50',
      payableAmount: '2964.00',
      lines: [{ variance: null, receivedQty: '2.000' }],
    });
    const dup = await as(ctx, owner)
      .post(`${base}/supplier-invoices`, {
        supplierId: supplierA.id,
        invoiceNo: `IV-${run}`,
        invoiceDate: '2026-10-12',
        lines: [{ description: 'x', quantity: '1', unitPrice: '1' }],
      })
      .expect(409);
    expect(dup.body.code).toBe('erp.invoice_duplicate');
    const off = (
      await as(ctx, owner)
        .post(`${base}/supplier-invoices`, {
          supplierId: supplierA.id,
          purchaseOrderId: poId,
          invoiceNo: `IV-${run}-B`,
          invoiceDate: '2026-10-12',
          lines: [{ purchaseOrderLineId: po.lines[0]!.id, quantity: '1', unitPrice: '1500' }],
        })
        .expect(201)
    ).body;
    expect(off).toMatchObject({ status: 'variance', lines: [{ variance: 'price_quantity' }] });
    const accountant = await factoryToken(ctx, fixture.factoryPublicId, 'factory_accountant', 404);
    await post(accountant, `/supplier-invoices/${off.id}/actions/approve`, {}).expect(403);
    const notPayable = await post(accountant, '/supplier-payments', {
      supplierId: supplierA.id,
      method: 'transfer',
      allocations: [{ supplierInvoiceId: off.id, amount: '1' }],
    }).expect(409);
    expect(notPayable.body.code).toBe('erp.invoice_not_payable');
    expect(
      (
        await post(owner, `/supplier-invoices/${off.id}/actions/approve`, { note: 'ตกลงราคาใหม่' }).expect(
          200,
        )
      ).body.status,
    ).toBe('approved');

    // Pay in two parts; more than is open is refused; a reversal opens the invoice again.
    const over = await post(accountant, '/supplier-payments', {
      supplierId: supplierA.id,
      method: 'transfer',
      allocations: [{ supplierInvoiceId: invoice.id, amount: '3000' }],
    }).expect(422);
    expect(over.body.code).toBe('erp.overpayment');
    const p1 = (
      await post(accountant, '/supplier-payments', {
        supplierId: supplierA.id,
        method: 'transfer',
        allocations: [{ supplierInvoiceId: invoice.id, amount: '1000' }],
      }).expect(201)
    ).body;
    expect(p1.paymentNo).toMatch(/^PV-\d{4}-\d{4}$/);
    expect((await get(`/supplier-invoices/${invoice.id}`)).status).toBe('partially_paid');
    const p2 = (
      await post(accountant, '/supplier-payments', {
        supplierId: supplierA.id,
        method: 'cash',
        allocations: [{ supplierInvoiceId: invoice.id, amount: '1964' }],
      }).expect(201)
    ).body;
    expect(await get(`/supplier-invoices/${invoice.id}`)).toMatchObject({
      status: 'paid',
      outstanding: '0.00',
      nextActions: [],
    });
    const reversal = (
      await post(accountant, `/supplier-payments/${p2.id}/actions/reverse`, { reason: 'จ่ายผิด' }).expect(201)
    ).body;
    expect(reversal).toMatchObject({ amount: '-1964.00', reverses: { id: p2.id } });
    await post(accountant, `/supplier-payments/${p2.id}/actions/reverse`, { reason: 'ซ้ำ' }).expect(409);
    expect(await get(`/supplier-invoices/${invoice.id}`)).toMatchObject({
      status: 'partially_paid',
      outstanding: '1964.00',
    });
    const aging = await get<{ suppliers: { supplier: { id: string } }[] }>('/supplier-invoices/aging');
    expect(aging.suppliers.find((s) => s.supplier.id === supplierA.id)).toMatchObject({ invoices: 2 });

    // Append-only at the database (D-334, D-338).
    await expect(
      ctx.prisma.erpPriceRecord.updateMany({ where: { itemId: { gt: 0n } }, data: { note: 'x' } }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.erpSupplierPayment.updateMany({ where: { id: { gt: 0n } }, data: { note: 'x' } }),
    ).rejects.toThrow();
  });

  it('turns an accepted getpack job into a production order with its board material (D-340)', async () => {
    const [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    try {
      const board = (
        await as(ctx, owner)
          .post(`${base}/items`, {
            sku: `E2J-${ctx.run}`,
            name: 'อาร์ตการ์ด 350 (ทดสอบ)',
            kind: 'raw_material',
            baseUnit: 'sheet',
            materialId: fixture.materialPublicId,
          })
          .expect(201)
      ).body;
      const { token } = await customerToken(ctx, 451);
      const prepress = await staffToken(ctx, 'prepress');
      const group = await placeOrder(ctx, token, fixture, code);
      const orderId = group.orders[0]!.id;
      await payDue(ctx, token, group.id);
      await approveArtwork(ctx, token, prepress, orderId);
      await ctx.pump();
      const order = await ctx.prisma.order.findUniqueOrThrow({
        where: { publicId: orderId },
        include: { productionJobs: true },
      });
      const job = order.productionJobs[0]!;
      await as(ctx, owner)
        .post(`/v1/partner/production-jobs/${job.publicId}/actions/accept`)
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      await ctx.pump();
      const list = await get<{ data: { id: string }[] }>(
        `/production-orders?source=getpack_job&q=${job.jobNo}`,
      );
      expect(list.data).toHaveLength(1);
      const mo = await get<{ materials: { requiredQty: string }[] }>(
        `/production-orders/${list.data[0]!.id}`,
      );
      expect(mo).toMatchObject({
        source: 'getpack_job',
        status: 'planned',
        job: { id: job.publicId, code: job.jobNo },
        quantity: `${job.quantityOrdered}.000`,
      });
      expect(mo.materials).toEqual([
        expect.objectContaining({ item: expect.objectContaining({ id: board.id }), origin: 'getpack_spec' }),
      ]);
      expect(Number(mo.materials[0]!.requiredQty)).toBeGreaterThan(0);
    } finally {
      await setFlag(ctx, 'payments.scb', false);
    }
  });

  it('keeps E2 to the right roles (D-319)', async () => {
    const operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 405);
    await as(ctx, operator).get(`${base}/production-orders`).expect(200);
    await as(ctx, operator).get(`${base}/supplier-invoices`).expect(403);
    await as(ctx, operator).post(`${base}/recipes`, {}).expect(403);
    const purchaser = await factoryToken(ctx, fixture.factoryPublicId, 'factory_purchaser', 406);
    await as(ctx, purchaser).get(`${base}/supplier-invoices`).expect(200);
    await post(purchaser, '/supplier-payments', {
      supplierId: randomUUID(),
      method: 'cash',
      allocations: [],
    }).expect(403);
  });
});
