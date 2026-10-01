import { randomUUID } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { MoneyDecimal } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { type FakeScbGateway } from '@integrations/payments/fake-payment-gateways';
import { SCB_GATEWAY } from '@integrations/payments/payment-gateways.port';
import { OrdersService } from '@modules/orders/orders.service';
import { DocumentFilesService } from '@modules/receivables/document-files.service';
import { ReceivablesService } from '@modules/receivables/receivables.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';
import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  customerToken,
  fakeTaxId,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  saveQuote,
  seedShipping,
  setFlag,
  staffToken,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp, payDue } from '../support/fulfilment-e2e';

const D = (v: { toString(): string }) => new MoneyDecimal(v.toString());

interface Doc {
  id: string;
  docType: string;
  docKind: string;
  docNumber: string;
  status: string;
  isTaxInvoice: boolean;
  netAmount: string;
  discountAmount: string;
  vatAmount: string;
  grossAmount: string;
  whtAmount: string;
  cashAmount: string;
  deductedPriorAmount: string;
  amountDue: string;
  receiptVia: string | null;
  cnKind: string | null;
  originalDocument: { id: string; docNumber: string } | null;
  receivable: { id: string; openAmount: string; status: string } | null;
  pdfReady: boolean;
}

/**
 * B5.2 receivables through the API and the event chain: tax point at payment (instalment TR, P01), revenue at
 * POD (final TR deducting the instalments, P06), a hire-of-work credit order invoiced at delivery (IV, VAT not
 * yet due, P07) and collected with a withholding customer (RC, P08 + P03, 50 ทวิ), a shortage within
 * tolerance credited at once (P19), a cancellation after the deposit (P23), a credit note under maker-checker,
 * a debit note voided with its journals reversed, a write-off and the allowance (P30), an unidentified receipt
 * allocated later (P29 → P02), and what the customer sees.
 */
describe('receivables & customer documents (e2e, B5.2)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let postcode: string;
  let finance: string;
  let manager: string;
  let csLead: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    await setFlag(ctx, 'payments.scb', true);
    [finance, manager, csLead] = await Promise.all([
      staffToken(ctx, 'finance'),
      staffToken(ctx, 'finance_manager'),
      staffToken(ctx, 'cs_lead'),
    ]);
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const post = (token: string, path: string, body: object = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
  const docsOf = async (orderId: string) =>
    (await as(ctx, finance).get(`/v1/admin/customer-documents?orderId=${orderId}&perPage=100`).expect(200))
      .body.data as Doc[];
  const approve = async (requestId: string) => {
    await as(ctx, manager)
      .post(`/v1/admin/approvals/${requestId}/actions/approve`, { comment: 'ตรวจแล้ว' })
      .expect(200);
    await ctx.pump();
  };
  /** Σ debit − credit of an account over the journals of an order (via the order dimension). */
  const balance = async (code: string, orderId: string) => {
    const rows = await ctx.prisma.journalLine.findMany({
      where: { account: { code }, order: { publicId: orderId }, journalEntry: { status: 'posted' } },
    });
    return rows.reduce((a, l) => a.add(l.debit.toString()).sub(l.credit.toString()), D(0)).toFixed(2);
  };
  const journalsOf = (sourceId: string) =>
    ctx.prisma.journalEntry.findMany({
      where: { sourceDocumentPublicId: sourceId, status: 'posted' },
      include: { lines: { include: { account: true }, orderBy: { lineNo: 'asc' } }, postingRule: true },
      orderBy: { id: 'asc' },
    });

  async function place(n: number, opts: { withholding?: boolean; template?: string } = {}) {
    const { token } = await customerToken(ctx, n);
    const address = await addAddress(ctx, token, postcode);
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity: 1000 }],
      })
      .expect(201);
    let taxProfileId: string | undefined;
    if (opts.withholding) {
      const province = await ctx.prisma.geoProvince.findUniqueOrThrow({ where: { code: 'DEV1' } });
      const profile = await as(ctx, token)
        .post('/v1/store/tax-profiles', {
          taxType: 'juristic',
          name: 'บริษัท ตัวอย่าง จำกัด (fake)',
          taxId: fakeTaxId(ctx, n),
          branchType: 'head_office',
          line1: '99/9 ถนนตัวอย่าง',
          provinceId: province.publicId,
          postcode,
          withholdsTax: true,
        })
        .expect(201);
      taxProfileId = profile.body.id as string;
    }
    const group = (await post(token, '/v1/store/checkout', taxProfileId ? { taxProfileId } : {}).expect(201))
      .body as { id: string; orders: { id: string }[] };
    if (opts.template) {
      const cs = await staffToken(ctx, 'cs_lead');
      const schedule = await as(ctx, cs)
        .get(`/v1/admin/order-groups/${group.id}/payment-schedule`)
        .expect(200);
      await as(ctx, cs)
        .post(`/v1/admin/order-groups/${group.id}/payment-schedule/actions/override`, {
          templateKey: opts.template,
          reason: 'ทดสอบ (fake)',
        })
        .set('If-Match', schedule.headers['etag'] as string)
        .expect(200);
    }
    return { token, groupId: group.id, orderId: group.orders[0]!.id };
  }

  async function facts(
    orderId: string,
    kinds: ('paid_for_production' | 'artwork_approved' | 'production_started' | 'shipped' | 'delivered')[],
  ) {
    const orders = ctx.app.get(OrdersService);
    await ctx.prisma.withTx(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { publicId: orderId } });
      for (const kind of kinds)
        await orders.applyFact(
          tx,
          order.id,
          (kind === 'production_started' ? { kind, mode: 'auto' } : { kind }) as never,
          systemActor('e2e'),
        );
    });
    await ctx.pump();
  }

  let paidOrder: { token: string; groupId: string; orderId: string };

  it('issues an instalment tax invoice at payment (P01) and the final tax invoice at POD deducting it (P06)', async () => {
    paidOrder = await place(1);
    const paid = await payDue(ctx, paidOrder.token, paidOrder.groupId);
    await ctx.pump();
    const [tr] = await docsOf(paidOrder.orderId);
    expect(tr).toMatchObject({
      docType: 'tr',
      docKind: 'instalment',
      isTaxInvoice: true,
      receiptVia: 'scb',
      grossAmount: paid.cashAmount,
      whtAmount: '0.00',
    });
    expect(tr!.docNumber).toMatch(/^DEVTR-/);
    expect(D(tr!.netAmount).add(tr!.vatAmount).toFixed(2)).toBe(tr!.grossAmount);
    const [p01] = await journalsOf(tr!.id);
    expect(p01!.postingRule!.key).toBe('P01');
    expect(p01!.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ['1132', tr!.grossAmount, '0.00'],
      ['2310', '0.00', tr!.netAmount],
      ['2210', '0.00', tr!.vatAmount],
    ]);

    await facts(paidOrder.orderId, ['artwork_approved', 'production_started', 'shipped', 'delivered']);
    const docs = await docsOf(paidOrder.orderId);
    const final = docs.find((d) => d.docKind === 'final')!;
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: paidOrder.orderId } });
    expect(final).toMatchObject({
      docType: 'tr',
      isTaxInvoice: true,
      grossAmount: order.grossAmount.toFixed(2),
      deductedPriorAmount: tr!.grossAmount,
      amountDue: '0.00',
    });
    // The advance is used up and the revenue is the order's net (gross before discounts via P09).
    expect(await balance('2310', paidOrder.orderId)).toBe('0.00');
    const revenue = D(await balance('4110', paidOrder.orderId))
      .add(await balance('4150', paidOrder.orderId))
      .add(await balance('4160', paidOrder.orderId))
      .neg();
    const discounts = D(await balance('4910', paidOrder.orderId)).add(
      await balance('4930', paidOrder.orderId),
    );
    expect(revenue.sub(discounts).toFixed(2)).toBe(
      D(order.netAmount).sub(order.discountAmount.toString()).toFixed(2),
    );
    expect((await journalsOf(final.id)).map((j) => j.postingRule!.key)).toContain('P06');
  });

  it('credits a shortage within tolerance at once to the customer’s credit balance (D-021, P19)', async () => {
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: paidOrder.orderId } });
    await ctx.prisma.withTx((tx) =>
      ctx.app.get(DomainEvents).record(tx, {
        type: 'delivery.reconciled',
        aggregateType: 'order',
        aggregateId: order.publicId,
        entityId: order.entityId,
        payload: {
          orderId: order.publicId,
          outcome: 'shortage_within',
          orderedQuantity: 1000,
          deliveredQuantity: 990,
          payableQuantity: 990,
          credit: { net: '10.00', vat: '0.70', gross: '10.70' },
        },
      }),
    );
    await ctx.pump();
    const cn = (await docsOf(paidOrder.orderId)).find((d) => d.docType === 'cn')!;
    expect(cn).toMatchObject({
      cnKind: 'shortage',
      netAmount: '10.00',
      vatAmount: '0.70',
      grossAmount: '10.70',
    });
    expect(cn.originalDocument).toBeTruthy();
    const [p19] = await journalsOf(cn.id);
    expect(
      p19!.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2), l.taxCode]),
    ).toEqual([
      ['4920', '10.00', '0.00', null],
      ['2210', '0.70', '0.00', 'output_vat'],
      ['2320', '0.00', '10.70', null],
    ]);
    const wallet = await as(ctx, paidOrder.token).get('/v1/store/store-credit').expect(200);
    expect(wallet.body).toMatchObject({
      balance: '10.70',
      entries: [expect.objectContaining({ source: 'shortage_credit', amount: '10.70' })],
    });
  });

  it('invoices a hire-of-work credit order at delivery and collects it with withholding (P07, P08, P03, 50 ทวิ)', async () => {
    const credit = await place(2, { withholding: true, template: 'credit_term' });
    await facts(credit.orderId, [
      'paid_for_production',
      'artwork_approved',
      'production_started',
      'shipped',
      'delivered',
    ]);
    const iv = (await docsOf(credit.orderId)).find((d) => d.docType === 'iv')!;
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId: credit.orderId } });
    expect(iv).toMatchObject({
      docKind: 'delivery',
      isTaxInvoice: false,
      grossAmount: order.grossAmount.toFixed(2),
      amountDue: order.grossAmount.toFixed(2),
    });
    expect(iv.receivable).toMatchObject({ status: 'open', openAmount: order.grossAmount.toFixed(2) });
    const [p07] = await journalsOf(iv.id);
    expect(p07!.postingRule!.key).toBe('P07');
    expect(p07!.lines.find((l) => l.account.code === '2211')?.credit.toFixed(2)).toBe(
      order.vatAmount.toFixed(2),
    );
    const aging = await as(ctx, finance).get('/v1/admin/receivables/aging').expect(200);
    expect(D(aging.body.totals.current).add(aging.body.totals.d1_30).gte(order.grossAmount.toString())).toBe(
      true,
    );

    // U-B0.3: the dunning log shows the reminder; staff send the invoice again and see where it went.
    const receivable = await ctx.prisma.receivableItem.findFirstOrThrow({
      where: { customerDocument: { publicId: iv.id } },
    });
    await ctx.app.get(ReceivablesService).dunning(new Date(receivable.dueDate.getTime() + 2 * 86_400_000));
    await ctx.pump({ notifications: true });
    const log = await as(ctx, finance).get(`/v1/admin/dunning-log?documentId=${iv.id}`).expect(200);
    expect(log.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ documentId: iv.id, stage: 'overdue' })]),
    );
    await as(ctx, await staffToken(ctx, 'cs'))
      .post(`/v1/admin/customer-documents/${iv.id}/actions/resend`)
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    await as(ctx, finance)
      .post(`/v1/admin/customer-documents/${iv.id}/actions/resend`)
      .set('Idempotency-Key', randomUUID())
      .expect(202);
    await ctx.pump({ notifications: true });
    const deliveries = await as(ctx, finance)
      .get(`/v1/admin/customer-documents/${iv.id}/deliveries`)
      .expect(200);
    expect(deliveries.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ channel: 'email', kind: 'resent' })]),
    );

    // The customer pays the credit-term instalment, withholding tax: an RC collects the invoice.
    const paid = await payDue(ctx, credit.token, credit.groupId);
    await ctx.pump();
    const rc = (await docsOf(credit.orderId)).find((d) => d.docType === 'rc')!;
    expect(rc).toMatchObject({
      docKind: 'collection',
      isTaxInvoice: true,
      receiptVia: 'scb',
      grossAmount: order.grossAmount.toFixed(2),
      whtAmount: order.whtAmount.toFixed(2),
      cashAmount: paid.cashAmount,
    });
    expect(D(order.whtAmount).gt(0)).toBe(true);
    const rules = (await journalsOf(rc.id)).map((j) => j.postingRule!.key);
    expect(rules).toEqual(['P03', 'P08']);
    expect(await balance('2211', credit.orderId)).toBe('0.00');
    expect(await balance('1210', credit.orderId)).toBe('0.00');
    expect(await balance('1230', credit.orderId)).toBe(order.whtAmount.toFixed(2));
    const item = await ctx.prisma.receivableItem.findFirstOrThrow({
      where: { order: { publicId: credit.orderId } },
    });
    expect(item.status).toBe('paid');

    // The 50 ทวิ is chased until Finance records it.
    const pending = await as(ctx, finance)
      .get('/v1/admin/customer-wht-certificates?status=pending&perPage=100')
      .expect(200);
    const cert = (pending.body.data as { id: string; receipt: { id: string }; whtAmount: string }[]).find(
      (c) => c.receipt.id === rc.id,
    )!;
    expect(cert.whtAmount).toBe(order.whtAmount.toFixed(2));
    await as(ctx, finance)
      .post(`/v1/admin/customer-wht-certificates/${cert.id}/actions/record`, {
        certificateNo: 'WT-FAKE-1',
        certificateDate: bangkokDate(new Date()),
      })
      .expect(200);
    await as(ctx, finance)
      .post(`/v1/admin/customer-wht-certificates/${cert.id}/actions/waive`, { reason: 'ซ้ำ' })
      .expect(409);
  });

  it('credits the deposit of an order cancelled before production (P23)', async () => {
    const deposit = await place(3, { template: 'deposit_50_before_shipping_50' });
    await payDue(ctx, deposit.token, deposit.groupId);
    await ctx.pump();
    const [tr] = await docsOf(deposit.orderId);
    expect(tr!.docKind).toBe('instalment');
    const cs = await staffToken(ctx, 'cs_lead');
    await as(ctx, cs)
      .post(`/v1/admin/orders/${deposit.orderId}/actions/cancel`, { reasonCode: 'customer_request' })
      .expect(200);
    await ctx.pump();
    const cn = (await docsOf(deposit.orderId)).find((d) => d.docType === 'cn')!;
    expect(cn).toMatchObject({
      cnKind: 'cancellation',
      grossAmount: tr!.grossAmount,
      vatAmount: tr!.vatAmount,
    });
    expect((await journalsOf(cn.id))[0]!.postingRule!.key).toBe('P23');
    expect(await balance('2310', deposit.orderId)).toBe('0.00');
    const wallet = await as(ctx, deposit.token).get('/v1/store/store-credit').expect(200);
    expect(wallet.body.balance).toBe(tr!.grossAmount);
  });

  it('issues a requested credit note only after another person approves it (maker-checker, D-169)', async () => {
    const requested = await post(csLead, `/v1/admin/orders/${paidOrder.orderId}/credit-notes`, {
      amount: '107.00',
      cnKind: 'price_reduction',
      note: 'ลดราคาตามข้อตกลง (fake)',
    }).expect(201);
    expect(requested.body).toMatchObject({ status: 'pending_approval', reasonCode: 'price_reduction' });
    await as(ctx, csLead)
      .post(`/v1/admin/approvals/${requested.body.approvalRequestId}/actions/approve`, {})
      .expect(403);
    const tooMuch = await post(csLead, `/v1/admin/orders/${paidOrder.orderId}/credit-notes`, {
      amount: '99999999.00',
      cnKind: 'price_reduction',
      note: 'เกิน',
    }).expect(201);
    await approve(requested.body.approvalRequestId as string);
    await approve(tooMuch.body.approvalRequestId as string);
    const list = await as(ctx, finance).get('/v1/admin/credit-note-requests?perPage=100').expect(200);
    const byId = new Map(
      (list.body.data as { id: string; status: string; creditNote: { docNumber: string } | null }[]).map(
        (r) => [r.id, r],
      ),
    );
    expect(byId.get(requested.body.id as string)).toMatchObject({
      status: 'issued',
      creditNote: expect.anything(),
    });
    expect(byId.get(tooMuch.body.id as string)).toMatchObject({ status: 'rejected', creditNote: null });
    const cn = (await docsOf(paidOrder.orderId)).find((d) => d.cnKind === 'price_reduction')!;
    expect(cn).toMatchObject({ grossAmount: '107.00', vatAmount: '7.00', netAmount: '100.00' });
    const wallet = await as(ctx, paidOrder.token).get('/v1/store/store-credit').expect(200);
    expect(wallet.body.balance).toBe('117.70');
  });

  it('adds a debit note, voids it with its journals reversed, and refuses to void a tax invoice', async () => {
    // U-B0.3: a debit note takes a debit reason only.
    expect(
      (
        await post(manager, `/v1/admin/orders/${paidOrder.orderId}/debit-notes`, {
          net: '500.00',
          reasonCode: 'price_reduction',
          note: 'เหตุผลผิดประเภท (fake)',
        }).expect(422)
      ).body.code,
    ).toBe('receivables.reason_invalid');
    const dn = (
      await post(manager, `/v1/admin/orders/${paidOrder.orderId}/debit-notes`, {
        net: '500.00',
        reasonCode: 'additional_charge',
        note: 'ค่าบริการเพิ่ม (fake)',
      }).expect(201)
    ).body as Doc;
    expect(dn).toMatchObject({
      docType: 'dn',
      vatAmount: '35.00',
      grossAmount: '535.00',
      amountDue: '535.00',
    });
    await ctx.pump();
    expect(await balance('1210', paidOrder.orderId)).toBe('535.00');
    await post(finance, `/v1/admin/customer-documents/${dn.id}/actions/void`, { reason: 'ออกผิด' }).expect(
      200,
    );
    await ctx.pump();
    expect(await balance('1210', paidOrder.orderId)).toBe('0.00');
    const journals = await journalsOf(dn.id);
    expect(journals.map((j) => j.kind)).toEqual(['auto', 'reversal']);
    const tr = (await docsOf(paidOrder.orderId)).find((d) => d.docKind === 'final')!;
    expect(
      (
        await post(finance, `/v1/admin/customer-documents/${tr.id}/actions/void`, {
          reason: 'ทดสอบยกเลิก',
        }).expect(409)
      ).body.code,
    ).toBe('receivables.document_not_voidable');
  });

  it('writes off a receivable after approval and updates the allowance (P30)', async () => {
    const dn = (
      await post(manager, `/v1/admin/orders/${paidOrder.orderId}/debit-notes`, {
        net: '100.00',
        reasonCode: 'additional_charge',
        note: 'ค่าบริการ (fake)',
      }).expect(201)
    ).body as Doc;
    await ctx.pump();
    const provision = await post(finance, '/v1/admin/receivables/allowance', {
      asOf: bangkokDate(new Date()),
      amount: '107.00',
    }).expect(200);
    expect(provision.body.method).toBe('manual');
    const requested = await post(
      finance,
      `/v1/admin/receivables/${dn.receivable!.id}/actions/request-write-off`,
      { reason: 'ลูกค้าปฏิเสธชำระ (fake)' },
    ).expect(200);
    await post(finance, `/v1/admin/receivables/${dn.receivable!.id}/actions/request-write-off`, {
      reason: 'ซ้ำ',
    }).expect(409);
    await approve(requested.body.writeOffApprovalId as string);
    const item = await ctx.prisma.receivableItem.findFirstOrThrow({ where: { publicId: dn.receivable!.id } });
    expect(item).toMatchObject({ status: 'written_off' });
    expect(await balance('1210', paidOrder.orderId)).toBe('0.00');
    const writeOff = await ctx.prisma.journalEntry.findFirstOrThrow({
      where: { postingRule: { key: 'P30W' }, sourceDocumentPublicId: dn.receivable!.id },
    });
    expect(writeOff.totalDebit.toFixed(2)).toBe('107.00');
  });

  it('parks an unidentified receipt (P29) and taxes it when Finance allocates it (P02 from 1140)', async () => {
    const pending = await place(4);
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({ where: { publicId: pending.groupId } });
    const scb = ctx.app.get<FakeScbGateway>(SCB_GATEWAY);
    await request(ctx.server)
      .post('/webhooks/scb/payment-confirmation')
      .send(scb.settle(`UNKNOWN${ctx.run}`, group.cashAmount.toFixed(2)))
      .expect(200);
    await ctx.pump();
    const unidentified = await ctx.prisma.payment.findFirstOrThrow({
      where: { orderGroupId: null, status: 'succeeded' },
      orderBy: { createdAt: 'desc' },
    });
    const [p29] = await journalsOf(unidentified.publicId);
    expect(p29!.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ['1132', group.cashAmount.toFixed(2), '0.00'],
      ['1140', '0.00', group.cashAmount.toFixed(2)],
    ]);
    await post(finance, `/v1/admin/payments/${unidentified.publicId}/actions/allocate`, {
      groupId: pending.groupId,
    }).expect(200);
    await ctx.pump();
    const [tr] = await docsOf(pending.orderId);
    expect(tr).toMatchObject({ docKind: 'instalment', receiptVia: 'unidentified' });
    const [p02] = await journalsOf(tr!.id);
    expect(p02!.postingRule!.key).toBe('P02');
    expect(p02!.lines[0]!.account.code).toBe('1140');
  });

  it('shows the customer their own documents only, with PDFs and e-Tax XML', async () => {
    expect(await ctx.app.get(DocumentFilesService).renderPending(500)).toBeGreaterThan(0);
    const mine = await as(ctx, paidOrder.token).get('/v1/store/documents').expect(200);
    const docs = mine.body.data as Doc[];
    expect(docs.map((d) => d.docType).sort()).toEqual(expect.arrayContaining(['tr', 'cn']));
    expect(docs.every((d) => d.pdfReady)).toBe(true);
    // U-B0.1: `orderId` narrows the list to one order; another order id gives nothing.
    const orderIds = [
      ...new Set(docs.map((d) => (d as unknown as { orderId: string | null }).orderId)),
    ].filter((id): id is string => !!id);
    const forOrder = await as(ctx, paidOrder.token)
      .get(`/v1/store/documents?orderId=${orderIds[0]}`)
      .expect(200);
    expect((forOrder.body.data as { orderId: string }[]).every((d) => d.orderId === orderIds[0])).toBe(true);
    expect(forOrder.body.meta.total).toBeGreaterThan(0);
    const none = await as(ctx, paidOrder.token)
      .get('/v1/store/documents?orderId=0192f3a0-7c1e-7d2a-9b1f-000000000000')
      .expect(200);
    expect(none.body.meta.total).toBe(0);
    const pdf = await as(ctx, paidOrder.token).get(`/v1/store/documents/${docs[0]!.id}/pdf`).expect(200);
    expect(pdf.body.url).toBeTruthy();
    const stored = await ctx.prisma.customerDocument.findUniqueOrThrow({ where: { publicId: docs[0]!.id } });
    expect(stored.eTaxXmlFileId).not.toBeNull();
    expect(stored.eTaxStatus).toBe('not_applicable');
    const { token: other } = await customerToken(ctx, 9);
    await as(ctx, other).get(`/v1/store/documents/${docs[0]!.id}`).expect(404);
    await as(ctx, other).get(`/v1/store/documents/${docs[0]!.id}/pdf`).expect(404);
    // The seller is the entity's registered data, never code (D-092); every issued number is unique.
    const numbers = await ctx.prisma.customerDocument.findMany({
      select: { docType: true, docNumber: true },
    });
    expect(new Set(numbers.map((n) => `${n.docType}:${n.docNumber}`)).size).toBe(numbers.length);
  });
});
