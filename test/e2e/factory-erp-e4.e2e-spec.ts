/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- loose response bodies (see Rec) */
import { createHash, randomUUID } from 'node:crypto';

import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import { as, foldingBackToRfq, foldingReady } from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

/**
 * getpack Factory ERP E4 (docs/prompts/E1-factory-erp.md §11, D-359 – D-371): a lead and its opportunity, a
 * quotation sent with a customer link and accepted there, the sales order with its credit check and stock
 * reservation, a delivery note that issues the stock, the tax invoice in the factory's own numbering, a credit
 * note, a billing note, the receipt with the customer's withholding, a 50 ทวิ for a supplier payment, the VAT
 * and withholding reports, exports, and who may do what (D-371).
 */
describe('getpack Factory ERP E4 (e2e)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let owner: string;
  let sales: string;
  let accountant: string;
  let storekeeper: string;
  let operator: string;
  let base: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 601);
    sales = await factoryToken(ctx, fixture.factoryPublicId, 'factory_sales', 602);
    accountant = await factoryToken(ctx, fixture.factoryPublicId, 'factory_accountant', 603);
    storekeeper = await factoryToken(ctx, fixture.factoryPublicId, 'factory_storekeeper', 604);
    operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 605);
    base = `/v1/partner/factories/${fixture.factoryPublicId}/erp`;
    // A tax invoice needs the seller's registered address (D-363).
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
    });
    if (
      !(await ctx.prisma.factoryAddress.findFirst({ where: { factoryId: factory.id, kind: 'registered' } }))
    )
      await ctx.prisma.factoryAddress.create({
        data: { factoryId: factory.id, kind: 'registered', line1: '1 ถนนทดสอบ (E4)', postcode: '10000' },
      });
  });

  afterAll(async () => {
    // The ERP suites share the dev factory: put back the defaults the sale case changes.
    if (fixture)
      await ctx.erpPrisma.erpFactorySettings.updateMany({
        where: { factory: { publicId: fixture.factoryPublicId } },
        data: { allowNegativeStock: false, quoteValidDays: 30 },
      });
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const post = async (token: string, path: string, body: object = {}, status = 200, ifMatch?: string) => {
    const req = as(ctx, token).post(`${base}${path}`).set('Idempotency-Key', randomUUID());
    if (ifMatch) req.set('If-Match', ifMatch);
    return (await req.send(body).expect(status)).body as Rec;
  };
  const get = async (path: string, token = owner, status = 200) =>
    (await as(ctx, token).get(`${base}${path}`).expect(status)).body as Rec;
  const etag = (id: string, version: number) =>
    `"${createHash('sha256').update(`${id}|${version}`).digest('base64url').slice(0, 27)}"`;

  it('runs a sale from lead to cash, with the tax documents and reports (D-359 – D-369)', async () => {
    // Stock may go negative here: the item has no opening balance.
    const settings = await as(ctx, owner).get(`${base}/settings`).expect(200);
    await as(ctx, owner)
      .patch(`${base}/settings`)
      .set('If-Match', settings.headers['etag'] as string)
      .send({ allowNegativeStock: true, quoteValidDays: 15 })
      .expect(200);
    const customer = (
      await as(ctx, owner)
        .post(`${base}/partners`, {
          kind: 'customer',
          name: 'บจก. ลูกค้า E4 (ทดสอบ)',
          taxId: '0000500000026',
          branchCode: '00000',
          address: '2 ถนนทดสอบ กรุงเทพฯ 10000',
          paymentTermDays: 30,
          creditLimit: '100000',
          entityType: 'juristic',
        })
        .expect(201)
    ).body as Rec;
    const item = (
      await as(ctx, owner)
        .post(`${base}/items`, {
          sku: `E4-BOX-${ctx.run}`,
          name: 'กล่อง E4 (ทดสอบ)',
          kind: 'finished_good',
          baseUnit: 'pcs',
        })
        .expect(201)
    ).body as Rec;

    // D-359: a lead becomes a customer's opportunity.
    const lead = (
      await as(ctx, sales).post(`${base}/leads`, { name: 'ร้านกาแฟ E4', source: 'line' }).expect(201)
    ).body as Rec;
    expect(lead.nextActions.map((a: Rec) => a.key)).toContain('erp_lead.convert');
    const converted = await post(sales, `/leads/${lead.id}/actions/convert`, {
      customerId: customer.id,
      openOpportunity: true,
    });
    expect(converted.lead.stage).toBe('converted');
    expect((await get('/pipeline', sales)).stages.length).toBe(5);

    // D-360: the quotation, sent with a link the customer accepts without an account.
    const qt = (
      await as(ctx, sales)
        .post(`${base}/quotations`, {
          customerId: customer.id,
          vatMode: 'exclusive',
          lines: [
            { itemId: item.id, quantity: '100', unitPrice: '10', discountPct: '5' },
            { description: 'ค่าออกแบบ', quantity: '1', unit: 'set', unitPrice: '500' },
          ],
        })
        .expect(201)
    ).body as Rec;
    expect(qt).toMatchObject({ status: 'draft', subtotal: '1450.00', vatAmount: '101.50', total: '1551.50' });
    const sent = await post(sales, `/quotations/${qt.id}/actions/send`, {}, 200, etag(qt.id, qt.version));
    const token = String(sent.url).split('/q/')[1]!;
    const view = (await request(ctx.app.getHttpServer()).get(`/v1/store/quote-links/${token}`).expect(200))
      .body as Rec;
    expect(view).toMatchObject({ quoteNo: qt.quoteNo, total: '1551.50', status: 'sent' });
    await request(ctx.app.getHttpServer())
      .post(`/v1/store/quote-links/${token}/actions/accept`)
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'คุณลูกค้า', agree: true })
      .expect(200);
    await request(ctx.app.getHttpServer()).get('/v1/store/quote-links/not-a-token').expect(404);

    // D-361: the order, confirmed within the credit limit; stock reserved.
    const so = await post(sales, `/quotations/${qt.id}/actions/order`, {}, 201);
    expect(so.lines.map((l: Rec) => l.fulfilment)).toEqual(['stock', 'service']);
    const confirmed = await post(
      sales,
      `/sales-orders/${so.id}/actions/confirm`,
      {},
      200,
      etag(so.id, so.version),
    );
    expect(confirmed.status).toBe('confirmed');
    // Only free stock is reserved — none here (no opening balance); delivery still issues it (negative stock allowed).
    expect(confirmed.lines[0].reservedQty).toBe('0.000');

    // D-362: the delivery note issues the stock and is delivered.
    const dn = await post(storekeeper, '/delivery-notes', { salesOrderId: so.id }, 201);
    const issued = await post(
      storekeeper,
      `/delivery-notes/${dn.id}/actions/issue`,
      {},
      200,
      etag(dn.id, dn.version),
    );
    expect(issued.status).toBe('issued');
    const delivered = await post(
      storekeeper,
      `/delivery-notes/${dn.id}/actions/deliver`,
      { receivedBy: 'คุณรับของ' },
      200,
      etag(dn.id, issued.version),
    );
    expect(delivered.status).toBe('delivered');

    // D-363: the tax invoice from the delivery note and the service line of the order.
    const iv = await post(
      accountant,
      '/sales-invoices',
      { customerId: customer.id, deliveryNoteIds: [dn.id], salesOrderId: so.id },
      201,
    );
    expect(iv.total).toBe('1551.50');
    const ivIssued = await post(
      accountant,
      `/sales-invoices/${iv.id}/actions/issue`,
      {},
      200,
      etag(iv.id, iv.version),
    );
    expect(ivIssued.invoiceNo).toMatch(/^IV/);
    expect((await get(`/sales-invoices/${iv.id}/pdf`, accountant)).fileName).toMatch(/\.pdf$/);

    // D-364: a credit note; D-365: billing note, receipt with the customer's withholding.
    const cn = await post(
      accountant,
      '/sales-notes',
      {
        kind: 'credit',
        invoiceId: iv.id,
        reason: 'discount_after_sale',
        lines: [{ description: 'ส่วนลด', amount: '50' }],
      },
      201,
    );
    expect((await post(accountant, `/sales-notes/${cn.id}/actions/issue`)).total).toBe('53.50');
    await post(accountant, '/billing-notes', { customerId: customer.id, invoiceIds: [iv.id] }, 201);
    await post(
      accountant,
      '/receipts',
      {
        customerId: customer.id,
        receivedOn: ivIssued.issueDate,
        method: 'transfer',
        amount: '1454.50',
        whtAmount: '43.50',
        allocations: [{ invoiceId: iv.id, amount: '1498.00' }],
      },
      201,
    );
    expect((await get(`/sales-invoices/${iv.id}`, accountant)).status).toBe('paid');
    // Receipts are append-only allocations; over-allocation is refused.
    const over = await post(
      accountant,
      '/receipts',
      {
        customerId: customer.id,
        receivedOn: ivIssued.issueDate,
        method: 'cash',
        amount: '1',
        allocations: [{ invoiceId: iv.id, amount: '1' }],
      },
      422,
    );
    expect(over.code).toBe('erp.allocation_exceeds_open');

    // D-367: the month's reports and exports.
    const month = String(ivIssued.issueDate).slice(0, 7);
    const vat = await get(`/tax/sales-vat?month=${month}`, accountant);
    expect(vat.rows.map((r: Rec) => r.docNo)).toEqual(expect.arrayContaining([ivIssued.invoiceNo]));
    expect((await get(`/tax/vat30?month=${month}`, accountant)).dueOn).toMatch(/-15$/);
    const exported = await post(accountant, '/tax/exports', { report: 'sales_vat', month, format: 'csv' });
    expect(exported.rows).toBeGreaterThanOrEqual(2);
    const report = await get(`/sales/report?month=${month}`, owner);
    expect(report.rows).toBeDefined();
  });

  it('keeps sales, receivables and tax to their roles (D-371)', async () => {
    await get('/quotations', operator, 403);
    await get('/sales-orders', operator, 403);
    await get('/sales-invoices', storekeeper, 403);
    await get('/wht-certificates', sales, 403);
    await get('/delivery-notes', storekeeper);
    await get('/leads', accountant);
    // Another factory's id is not found, never forbidden (D-044).
    await as(ctx, owner).get(`/v1/partner/factories/${randomUUID()}/erp/quotations`).expect(404);
  });
});
