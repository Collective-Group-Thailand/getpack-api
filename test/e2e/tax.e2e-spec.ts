import { randomUUID } from 'node:crypto';

import { addMonths } from '@common/ledger-core/dates';
import { MoneyDecimal } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { TaxCalendarService } from '@modules/tax/tax-calendar.service';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  saveQuote,
  seedShipping,
  setFlag,
  staffToken,
} from '../support/commerce-e2e';
import { carrierBill, companyAccount, payVendors } from '../support/finance-e2e';
import { bootFulfilmentApp, type FulfilmentApp, payDue } from '../support/fulfilment-e2e';

const D = (v: { toString(): string }) => new MoneyDecimal(v.toString());

interface Report {
  id: string;
  kind: string;
  status: string;
  totals: Record<string, string>;
  reportAmount: string;
  glAmount: string;
  glDifference: string;
  lineCount: number;
  lines: Record<string, unknown>[];
  fileReady: boolean;
  paidAmount: string | null;
}

/**
 * B5.4 through the API: this month's sales tax report shows the customer's tax invoice, the purchase tax report the
 * carrier's, ภ.ง.ด.53 the 50 ทวิ issued with the carrier payout; every report agrees with its GL control accounts
 * (difference 0). The ภ.พ.30 working paper finalises (P27), is filed (calendar done) and paid (P27P); ภ.ง.ด.53 is
 * remitted (P28). An untagged manual journal on output VAT makes the sales report disagree and it cannot be
 * finalised until the journal is reversed.
 */
describe('tax reports & working papers (e2e, B5.4)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let finance: string;
  let manager: string;
  let chief: string;
  let auditor: string;
  let bank: { id: string; glCode: string };
  const month = bangkokDate(new Date()).slice(0, 7);
  const today = () => bangkokDate(new Date());

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    await seedShipping(ctx, fixture.factoryPublicId, postcodes(ctx, 1));
    await setFlag(ctx, 'payments.scb', true);
    [finance, manager, chief, auditor] = await Promise.all([
      staffToken(ctx, 'finance'),
      staffToken(ctx, 'finance_manager'),
      staffToken(ctx, 'c_level'),
      staffToken(ctx, 'auditor'),
    ]);
    bank = await companyAccount(ctx);
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const post = (token: string, path: string, body: object = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
  const generate = async (kind: string) =>
    (await post(finance, '/v1/admin/tax-reports', { kind, period: month }).expect(201)).body as Report;
  const journalsOf = (sourceId: string) =>
    ctx.prisma.journalEntry.findMany({
      where: { sourceDocumentPublicId: sourceId, status: 'posted' },
      include: { lines: { include: { account: true } } },
    });
  const sum = (
    lines: { debit: { toString(): string }; credit: { toString(): string }; account: { code: string } }[],
    code: string,
  ) =>
    lines
      .filter((l) => l.account.code === code)
      .reduce((a, l) => a.add(D(l.debit)).sub(D(l.credit)), D(0))
      .toFixed(2);

  let trNumber: string;
  let billNo: string;
  let wtNumber: string;

  it('reports the month from the posted documents and reconciles every report to the GL', async () => {
    // A customer pays an instalment: its tax invoice (TR) carries output VAT.
    const { token } = await customerToken(ctx, 1);
    const address = await addAddress(ctx, token, postcodes(ctx, 1)[0]!);
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity: 1000 }],
      })
      .expect(201);
    const group = (await post(token, '/v1/store/checkout').expect(201)).body as {
      id: string;
      orders: { id: string }[];
    };
    await payDue(ctx, token, group.id);
    await ctx.pump();
    const docs = (
      await as(ctx, finance)
        .get(`/v1/admin/customer-documents?orderId=${group.orders[0]!.id}&perPage=50`)
        .expect(200)
    ).body.data as { docType: string; docNumber: string; vatAmount: string }[];
    const tr = docs.find((d) => d.docType === 'tr')!;
    trNumber = tr.docNumber;

    // A carrier bill with a valid tax invoice (input VAT, P25), paid with 1 % withheld (50 ทวิ, P25P).
    billNo = `TX-${ctx.run}`;
    const carrier = await carrierBill(ctx, finance, { net: '1000.00', vat: '70.00', no: billNo });
    await ctx.pump();
    await payVendors(ctx, { finance, chief }, bank.id, [carrier.vendorId]);
    const cert = await ctx.prisma.whtCertificate.findFirstOrThrow({
      where: { vendor: { publicId: carrier.vendorId } },
    });
    wtNumber = cert.wtNumber;
    expect(cert.whtAmount.toFixed(2)).toBe('10.00');

    const sales = await generate('sales_tax');
    expect(sales).toMatchObject({ status: 'draft', glDifference: '0.00' });
    expect(sales.lines.find((l) => l['documentNo'] === trNumber)).toMatchObject({
      vat: tr.vatAmount,
      late: false,
    });
    const purchases = await generate('purchase_tax');
    expect(purchases.glDifference).toBe('0.00');
    expect(purchases.lines.find((l) => l['documentNo'] === billNo)).toMatchObject({
      base: '1000.00',
      vat: '70.00',
      partyName: expect.stringContaining('ขนส่ง'),
    });
    const pnd53 = await generate('pnd53');
    expect(pnd53.glDifference).toBe('0.00');
    expect(pnd53.lines.find((l) => l['wtNumber'] === wtNumber)).toMatchObject({
      paidAmount: '1000.00',
      whtAmount: '10.00',
      ratePct: '1.00',
      condition: 1,
    });
    for (const kind of ['pnd3', 'wht_issued_register', 'wht_received_register'])
      expect((await generate(kind)).glDifference).toBe('0.00');
    const pp30 = await generate('pp30');
    expect(pp30.totals).toMatchObject({ outputVat: sales.totals['vat'], inputVat: purchases.totals['vat'] });
    expect(pp30.reportAmount).toBe(D(sales.totals['vat']!).sub(purchases.totals['vat']!).toFixed(2));
    expect(pp30.glDifference).toBe('0.00');

    // The auditor reads; only Finance generates.
    await as(ctx, auditor).get(`/v1/admin/tax-reports/${pp30.id}`).expect(200);
    await post(auditor, '/v1/admin/tax-reports', { kind: 'pp30', period: month }).expect(403);
  });

  it('refuses to finalise a report that disagrees with the GL until the untagged posting is reversed (§7 step 7)', async () => {
    const draft = (
      await as(ctx, finance)
        .post('/v1/admin/ledger/journals', {
          documentDate: today(),
          description: 'ปรับภาษีขายด้วยมือ (fake)',
          lines: [
            { accountCode: '6900', side: 'debit', amount: '5.00' },
            { accountCode: '2210', side: 'credit', amount: '5.00' },
          ],
        })
        .expect(201)
    ).body as { id: string };
    const submitted = (
      await post(finance, `/v1/admin/ledger/journals/${draft.id}/actions/submit`).expect(200)
    ).body as { approvalRequestId: string };
    await post(manager, `/v1/admin/approvals/${submitted.approvalRequestId}/actions/approve`, {
      comment: 'ok',
    }).expect(200);
    await ctx.pump();

    const sales = await generate('sales_tax');
    expect(sales.glDifference).toBe('5.00');
    const refused = await post(finance, `/v1/admin/tax-reports/${sales.id}/actions/finalise`).expect(422);
    expect(refused.body.code).toBe('tax.gl_difference');

    const reversal = (
      await post(finance, `/v1/admin/ledger/journals/${draft.id}/actions/reverse`, {
        documentDate: today(),
        reason: 'ปรับผิด',
      }).expect(201)
    ).body as { approvalRequestId: string };
    await post(manager, `/v1/admin/approvals/${reversal.approvalRequestId}/actions/approve`, {
      comment: 'ok',
    }).expect(200);
    await ctx.pump();
    expect((await generate('sales_tax')).glDifference).toBe('0.00');
  });

  it('closes, files and pays the ภ.พ.30 (P27, P27P) and remits ภ.ง.ด.53 (P28)', async () => {
    const pp30 = await generate('pp30');
    const final = (await post(finance, `/v1/admin/tax-reports/${pp30.id}/actions/finalise`).expect(200))
      .body as Report;
    expect(final).toMatchObject({ status: 'final', fileReady: true, glDifference: '0.00' });
    await ctx.pump();
    await post(finance, '/v1/admin/tax-reports', { kind: 'pp30', period: month }).expect(409);
    expect(
      (await as(ctx, auditor).get(`/v1/admin/tax-reports/${pp30.id}/export`).expect(200)).body.url,
    ).toEqual(expect.any(String));

    // P27: output VAT against input VAT, the net to 2220; reports of the month still agree (the close is excluded).
    const p27 = (await journalsOf(pp30.id)).flatMap((j) => j.lines);
    expect(sum(p27, '2210')).toBe(final.totals['outputVat']);
    expect(sum(p27, '1241')).toBe(D(final.totals['inputVat']!).neg().toFixed(2));
    expect(sum(p27, '2220')).toBe(D(final.reportAmount).neg().toFixed(2));
    expect((await generate('sales_tax')).glDifference).toBe('0.00');

    // Paying before the return is final or twice is refused; filing marks the calendar item done.
    await ctx.app.get(TaxCalendarService).ensure(addMonths(`${month}-01`, 1));
    await post(finance, `/v1/admin/tax-reports/${pp30.id}/actions/file`, {
      filingRef: `RD-${ctx.run}`,
    }).expect(200);
    const calendar = (await as(ctx, finance).get('/v1/admin/tax-calendar').expect(200)).body as {
      kind: string;
      period: string;
      status: string;
      taxReportId: string | null;
    }[];
    expect(calendar.find((c) => c.kind === 'pp30' && c.period === month)).toMatchObject({
      status: 'done',
      taxReportId: pp30.id,
    });
    await post(finance, `/v1/admin/tax-reports/${pp30.id}/actions/pay`, {
      paidOn: today(),
      companyBankAccountId: bank.id,
    }).expect(403);
    const paid = (
      await post(manager, `/v1/admin/tax-reports/${pp30.id}/actions/pay`, {
        paidOn: today(),
        companyBankAccountId: bank.id,
      }).expect(200)
    ).body as Report;
    expect(paid.paidAmount).toBe(MoneyDecimal.max(D(final.reportAmount), 0).toFixed(2));
    await post(manager, `/v1/admin/tax-reports/${pp30.id}/actions/pay`, {
      paidOn: today(),
      companyBankAccountId: bank.id,
    }).expect(409);
    await ctx.pump();
    if (D(paid.paidAmount!).gt(0)) {
      const p27p = (await journalsOf(pp30.id)).flatMap((j) => j.lines);
      expect(sum(p27p, bank.glCode)).toBe(D(paid.paidAmount!).neg().toFixed(2));
    }

    // ภ.ง.ด.53: final with its attachment, remitted (P28 clears 2231).
    const pnd53 = await generate('pnd53');
    await post(manager, `/v1/admin/tax-reports/${pnd53.id}/actions/pay`, {
      paidOn: today(),
      companyBankAccountId: bank.id,
    }).expect(409);
    await post(finance, `/v1/admin/tax-reports/${pnd53.id}/actions/finalise`).expect(200);
    const remitted = (
      await post(manager, `/v1/admin/tax-reports/${pnd53.id}/actions/pay`, {
        paidOn: today(),
        companyBankAccountId: bank.id,
      }).expect(200)
    ).body as Report;
    expect(remitted.paidAmount).toBe(pnd53.reportAmount);
    await ctx.pump();
    const p28 = (await journalsOf(pnd53.id)).flatMap((j) => j.lines);
    expect(sum(p28, '2231')).toBe(pnd53.reportAmount);
    // Still agrees after the remittance (the report's own postings are not report movement).
    expect((await generate('wht_issued_register')).glDifference).toBe('0.00');
    // A final report's figures never change (DB trigger).
    const row = await ctx.prisma.taxReport.findUniqueOrThrow({ where: { publicId: pnd53.id } });
    await expect(
      ctx.prisma.taxReport.update({ where: { id: row.id }, data: { reportAmount: '1.00' } }),
    ).rejects.toThrow();
  });
});
