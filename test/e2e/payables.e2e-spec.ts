import { randomUUID } from 'node:crypto';

import { FieldEncryption } from '@common/crypto/field-encryption';
import { LookupHasher } from '@common/crypto/lookup-hasher';
import { MoneyDecimal, type MoneyValue } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';

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
import {
  approveArtwork,
  bootFulfilmentApp,
  factoryToken,
  type FulfilmentApp,
  makePdf,
  payDue,
  uploadBytes,
  uploadPdf,
} from '../support/fulfilment-e2e';

const D = (v: { toString(): string }) => new MoneyDecimal(v.toString());
const r2 = (v: MoneyValue) => v.toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP);

interface Item {
  id: string;
  vendorId: string;
  kind: string;
  apNetAmount: string;
  vatAmount: string;
  vatClaimable: boolean;
  whtAmount: string;
  whtBase: string;
  retentionAmount: string;
  cashAmount: string;
  pvNumber: string | null;
  status: string;
}
interface Run {
  id: string;
  runNo: string;
  status: string;
  approvalRequestId: string | null;
  bankFileReady: boolean;
  cashAmount: string;
  items: Item[];
}

/**
 * B5.3 through the API and the event chain: the factory PO at release (P13), the advance on acceptance paid by
 * an approved run (proposer ≠ approver, bank file, confirmation, PV, 50 ทวิ, P14 with VAT pending), POD → GR
 * (P15) with the paid advance applied (P16) and a billing statement the factory disputes then confirms, its
 * tax invoice rejected then validated (P17V), the balance paid with WHT and retention next to a carrier bill
 * (P25 / P25P) whose transfer fails into the exceptions queue, a vendor bank-account change refused to the bill
 * recorder (SoD), and banking: a gateway settlement (P04) and the payout matched from a statement import, a
 * duplicate import refused, an unknown receipt parked (P29) and identified into a payment.
 */
describe('payables, payouts & banking (e2e, B5.3)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let postcode: string;
  let finance: string;
  let manager: string;
  let chief: string;
  let admin: string;
  let owner: string;
  let factoryVendorId: string;
  let companyAccountId: string;
  let bankGlCode: string;
  let order: { token: string; groupId: string; orderId: string; paymentRef: string; paymentCash: string };
  let advanceRun: Run;
  let advanceVat: string;

  const post = (token: string, path: string, body: object = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
  const today = () => bangkokDate(new Date());
  const approve = async (token: string, requestId: string) => {
    await post(token, `/v1/admin/approvals/${requestId}/actions/approve`, {
      comment: 'ตรวจแล้ว (fake)',
    }).expect(200);
    await ctx.pump();
  };
  const journalsOf = (sourceId: string) =>
    ctx.prisma.journalEntry.findMany({
      where: { sourceDocumentPublicId: sourceId, status: 'posted' },
      include: { lines: { include: { account: true } }, postingRule: true },
      orderBy: { id: 'asc' },
    });
  const sum = (
    lines: { debit: { toString(): string }; credit: { toString(): string }; account: { code: string } }[],
    code: string,
  ) =>
    lines
      .filter((l) => l.account.code === code)
      .reduce((a, l) => a.add(D(l.debit)).sub(D(l.credit)), D(0))
      .toFixed(2);

  /**
   * An active, verified account for a vendor (fixture: the dual approval is covered by the partners suites).
   * Encrypted with this app's key — test apps generate one per process, so earlier suites' accounts are superseded.
   */
  async function activeVendorAccount(vendorPk: bigint, digits: string) {
    await ctx.prisma.vendorBankAccount.updateMany({
      where: { vendorId: vendorPk, status: 'active' },
      data: { status: 'superseded' },
    });
    await ctx.prisma.vendorBankAccount.create({
      data: {
        vendorId: vendorPk,
        bankCode: '014',
        accountName: '[E2E] บัญชีผู้ขาย (fake)',
        accountNoEnc: ctx.app.get(FieldEncryption).encrypt(digits),
        accountNoLast4: digits.slice(-4),
        accountNoHash: ctx.app.get(LookupHasher).hash(digits, 'vendor_bank_account'),
        status: 'active',
        effectiveFrom: new Date(),
        decidedAt: new Date(),
      },
    });
  }

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    await setFlag(ctx, 'payments.scb', true);
    [finance, manager, chief, admin] = await Promise.all([
      staffToken(ctx, 'finance'),
      staffToken(ctx, 'finance_manager'),
      staffToken(ctx, 'c_level'),
      staffToken(ctx, 'superadmin'),
    ]);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 81);
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
      include: { vendor: true },
    });
    factoryVendorId = factory.vendor.publicId;
    await activeVendorAccount(factory.vendorId, `99${String(ctx.run).padStart(8, '0')}`);
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('activates a company bank account only after two other people approve it (§8)', async () => {
    const linked = (
      await ctx.prisma.companyBankAccount.findMany({
        where: { status: { in: ['active', 'pending_approval'] } },
        include: { glAccount: true },
      })
    ).map((a) => a.glAccount.code);
    bankGlCode = ['1121', '1122', '1123'].find((c) => !linked.includes(c)) ?? '';
    if (!bankGlCode) {
      const existing = await ctx.prisma.companyBankAccount.findFirstOrThrow({
        where: { status: 'active', purpose: { in: ['payout', 'both'] } },
        include: { glAccount: true },
      });
      companyAccountId = existing.publicId;
      bankGlCode = existing.glAccount.code;
      return;
    }
    // A clearing account is never a bank account.
    const bad = await post(admin, '/v1/admin/company-bank-accounts', {
      bankCode: '014',
      accountName: '[E2E] (fake)',
      accountNo: '000-0-00000-1',
      glAccountCode: '1132',
      purpose: 'both',
    }).expect(422);
    expect(bad.body.code).toBe('banking.gl_account_invalid');
    const proposed = await post(admin, '/v1/admin/company-bank-accounts', {
      bankCode: '014',
      accountName: '[E2E] บริษัท คอลเลคทีฟ (fake)',
      accountNo: `100-${String(ctx.run).padStart(7, '0')}`,
      glAccountCode: bankGlCode,
      purpose: 'both',
    }).expect(201);
    expect(proposed.body).toMatchObject({ status: 'pending_approval', glAccountCode: bankGlCode });
    expect(JSON.stringify(proposed.body)).not.toContain(String(ctx.run).padStart(7, '0'));
    companyAccountId = proposed.body.id as string;
    const requestId = proposed.body.approvalRequestId as string;
    await approve(finance, requestId);
    const statusOf = async () =>
      (
        (await as(ctx, finance).get('/v1/admin/company-bank-accounts').expect(200)).body as {
          id: string;
          status: string;
        }[]
      ).find((a) => a.id === companyAccountId)?.status;
    expect(await statusOf()).toBe('pending_approval');
    await approve(manager, requestId);
    expect(await statusOf()).toBe('active');
  });

  it('issues the PO at release and pays the advance through an approved run (P13, P14)', async () => {
    const { token } = await customerToken(ctx, 1);
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
    const group = (await post(token, '/v1/store/checkout').expect(201)).body as {
      id: string;
      orders: { id: string }[];
    };
    const payment = (await payDue(ctx, token, group.id)) as { cashAmount: string; referenceCode: string };
    order = {
      token,
      groupId: group.id,
      orderId: group.orders[0]!.id,
      paymentRef: payment.referenceCode,
      paymentCash: payment.cashAmount,
    };
    await approveArtwork(ctx, token, await staffToken(ctx, 'prepress'), order.orderId);
    await ctx.pump();

    // The PO at release, with the buy price and payout policy frozen; the factory sees it, no one else.
    const job = await ctx.prisma.productionJob.findFirstOrThrow({
      where: { order: { publicId: order.orderId } },
    });
    const pos = (await as(ctx, owner).get('/v1/partner/purchase-orders?perPage=100').expect(200)).body
      .data as {
      id: string;
      poNumber: string;
      jobNo: string;
      status: string;
      netAmount: string;
      vatAmount: string;
    }[];
    const po = pos.find((p) => p.jobNo === job.jobNo)!;
    expect(po).toMatchObject({ status: 'issued' });
    expect(D(po.netAmount).gt(0)).toBe(true);
    expect(D(po.vatAmount).gt(0)).toBe(true);
    const vendor = await ctx.prisma.vendor.create({
      data: {
        kind: 'factory',
        legalName: `[E2E] โรงงานอื่น ${ctx.run}`,
        juristicType: 'company',
        taxId: `08${String(ctx.run).padStart(11, '0').slice(-11)}`,
      },
    });
    const other = await ctx.prisma.factory.create({
      data: {
        code: `P${ctx.run}`,
        vendorId: vendor.id,
        legalName: vendor.legalName,
        juristicType: 'company',
        taxId: vendor.taxId,
      },
    });
    const stranger = await factoryToken(ctx, other.publicId, 'factory_owner', 82);
    await as(ctx, stranger).get(`/v1/partner/purchase-orders/${po.id}`).expect(404);

    // Accepted → the advance is payable at once (D-022).
    await post(owner, `/v1/partner/production-jobs/${job.publicId}/actions/accept`).expect(200);
    await ctx.pump();
    const payables = (
      await as(ctx, finance)
        .get(`/v1/admin/payables?vendorId=${factoryVendorId}&status=eligible&perPage=100`)
        .expect(200)
    ).body.data as {
      id: string;
      source: string;
      poNumber: string;
      openNetAmount: string;
      openVatAmount: string;
    }[];
    const advance = payables.find((p) => p.source === 'advance' && p.poNumber === po.poNumber)!;
    expect(advance).toBeDefined();
    advanceVat = advance.openVatAmount;

    // The run: WHT 3 % on the advance (hire of work), VAT pending (no tax invoice yet), no retention.
    const created = await post(finance, '/v1/admin/payout-runs', {
      companyBankAccountId: companyAccountId,
      payOn: today(),
      vendorIds: [factoryVendorId],
    }).expect(201);
    advanceRun = created.body as Run;
    const item = advanceRun.items.find((i) => i.kind === 'advance')!;
    // The item pays every eligible advance of the factory (other suites' orders too): WHT is per payable.
    const allocated = await ctx.prisma.payoutItemAllocation.findMany({
      where: { payoutItem: { publicId: item.id } },
      include: { payableItem: true },
    });
    expect(allocated.map((x) => x.payableItem.publicId)).toContain(advance.id);
    const wht = allocated.reduce((acc, x) => acc.add(r2(D(x.payableItem.whtBaseHire).mul(3).div(100))), D(0));
    expect(item).toMatchObject({
      status: 'included',
      vatClaimable: false,
      retentionAmount: '0.00',
      whtAmount: wht.toFixed(2),
    });
    expect(item.cashAmount).toBe(D(item.apNetAmount).add(item.vatAmount).sub(item.whtAmount).toFixed(2));

    // Maker-checker: the proposer cannot approve; a C-Level approves.
    const proposed = (
      await post(finance, `/v1/admin/payout-runs/${advanceRun.id}/actions/propose`).expect(200)
    ).body as Run;
    expect(proposed.status).toBe('proposed');
    const self = await post(finance, `/v1/admin/approvals/${proposed.approvalRequestId}/actions/approve`, {
      comment: 'ตัวเอง',
    });
    expect(self.status).toBeGreaterThanOrEqual(400);
    await post(finance, `/v1/admin/payout-runs/${advanceRun.id}/actions/generate-bank-file`).expect(409);
    await approve(chief, proposed.approvalRequestId!);
    expect(
      (await as(ctx, finance).get(`/v1/admin/payout-runs/${advanceRun.id}`).expect(200)).body.status,
    ).toBe('approved');

    // The bank file by the adapter (an audited export), then the bank's confirmation.
    const filed = (
      await post(finance, `/v1/admin/payout-runs/${advanceRun.id}/actions/generate-bank-file`).expect(200)
    ).body as Run;
    expect(filed).toMatchObject({ status: 'file_generated', bankFileReady: true });
    expect(
      (await as(ctx, finance).get(`/v1/admin/payout-runs/${advanceRun.id}/bank-file`).expect(200)).body.url,
    ).toEqual(expect.any(String));
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'payout_run.bank_file', resourcePublicId: advanceRun.id },
      }),
    ).toBe(1);
    const confirmed = (
      await post(finance, `/v1/admin/payout-runs/${advanceRun.id}/actions/confirm`, {
        confirmations: [{ reference: item.id, status: 'paid', bankRef: `B${ctx.run}` }],
      }).expect(200)
    ).body as Run;
    await ctx.pump();
    expect(confirmed.status).toBe('confirmed');
    const paid = confirmed.items.find((i) => i.id === item.id)!;
    expect(paid.status).toBe('paid');
    expect(paid.pvNumber).toEqual(expect.any(String));
    advanceRun = confirmed;

    // P14: advance to 1250, VAT parked in 1242, WHT to ภ.ง.ด.53, cash out of the bank account.
    const journals = await journalsOf(item.id);
    expect(journals.length).toBeGreaterThan(0);
    const lines = journals.flatMap((j) => j.lines);
    expect(sum(lines, '1250')).toBe(item.apNetAmount);
    expect(sum(lines, '1242')).toBe(item.vatAmount);
    expect(sum(lines, '2231')).toBe(D(item.whtAmount).neg().toFixed(2));
    expect(sum(lines, bankGlCode)).toBe(D(item.cashAmount).neg().toFixed(2));

    // The factory sees the payout and downloads its 50 ทวิ.
    const statement = (
      await as(ctx, owner).get(`/v1/partner/factories/${fixture.factoryPublicId}/payouts`).expect(200)
    ).body as { id: string; whtCertificates: { id: string; whtAmount: string }[] }[];
    const mine = statement.find((s) => s.id === item.id)!;
    expect(mine.whtCertificates).toHaveLength(1);
    expect(mine.whtCertificates[0]!.whtAmount).toBe(item.whtAmount);
    await as(ctx, owner)
      .get(
        `/v1/partner/factories/${fixture.factoryPublicId}/wht-certificates/${mine.whtCertificates[0]!.id}/pdf`,
      )
      .expect(200);
    await as(ctx, stranger).get(`/v1/partner/factories/${fixture.factoryPublicId}/payouts`).expect(404);

    // U-B0.3: the back office downloads the remittance advice and the 50 ทวิ of the paid item.
    const docs = (
      await as(ctx, finance)
        .get(`/v1/admin/payout-runs/${advanceRun.id}/items/${item.id}/documents`)
        .expect(200)
    ).body as {
      remittanceAdvice: { url: string };
      whtCertificates: { wtNumber: string; download: unknown }[];
    };
    expect(docs.remittanceAdvice.url).toEqual(expect.any(String));
    expect(docs.whtCertificates).toEqual([expect.objectContaining({ download: expect.any(Object) })]);
    const again = (
      await as(ctx, finance)
        .get(`/v1/admin/payout-runs/${advanceRun.id}/items/${item.id}/documents`)
        .expect(200)
    ).body as { remittanceAdvice: { url: string } };
    expect(again.remittanceAdvice.url).toEqual(expect.any(String));
    expect(
      (await ctx.prisma.payoutItem.findUniqueOrThrow({ where: { publicId: item.id } })).remittanceFileId,
    ).not.toBeNull();
  });

  it('receives the goods at POD, applies the advance and validates the factory tax invoice (P15, P16, P17V)', async () => {
    const operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 83);
    const qc = await factoryToken(ctx, fixture.factoryPublicId, 'factory_qc', 84);
    const photo = (token: string) =>
      uploadBytes(ctx, token, Buffer.from(`photo ${randomUUID()}`), {
        purpose: 'evidence',
        fileName: 'p.png',
        mimeType: 'image/png',
        surface: 'partner',
      });
    const job = await ctx.prisma.productionJob.findFirstOrThrow({
      where: { order: { publicId: order.orderId } },
    });
    const detail = await as(ctx, owner).get(`/v1/partner/production-jobs/${job.publicId}`).expect(200);
    const milestones = (
      detail.body.milestones as { id: string; seq: number; evidence: string; tracksQuantity: boolean }[]
    ).sort((a, b) => a.seq - b.seq);
    for (const m of milestones) {
      const url = `/v1/partner/production-jobs/${job.publicId}/milestones/${m.id}`;
      await post(operator, url, {
        action: 'start',
        clientRef: randomUUID(),
        ...(m.tracksQuantity && { quantityIn: 1000 }),
      }).expect(200);
      const shot = m.evidence.includes('photo') ? [await photo(operator)] : [];
      if (m.evidence.includes('qc_form'))
        await post(qc, `/v1/partner/production-jobs/${job.publicId}/qc-checks`, {
          checklistVersion: 'folding-v1',
          checklist: { colour: 'ok' },
          result: 'pass',
          quantityChecked: 80,
          photoFileIds: shot.length ? shot : [await photo(qc)],
        }).expect(201);
      await post(operator, url, {
        action: 'complete',
        clientRef: randomUUID(),
        ...(m.tracksQuantity && { quantityOut: 1000, quantityScrap: 0 }),
        ...(shot.length && { photoFileIds: shot }),
      }).expect(200);
    }
    const destination = (detail.body.destinations as { id: string }[])[0]!;
    const shipment = (
      await post(owner, '/v1/partner/shipments', {
        items: [{ jobId: job.publicId, destinationId: destination.id, quantity: 1000 }],
        cartonsCount: 1,
        weightG: 6000,
      }).expect(201)
    ).body.id as string;
    await post(owner, `/v1/partner/shipments/${shipment}/actions/ready`).expect(200);
    const inspection = await ctx.prisma.inspection.findFirst({
      where: { jobId: job.id, status: { in: ['planned', 'in_progress'] } },
    });
    if (inspection)
      await as(ctx, await staffToken(ctx, 'partner_manager'))
        .post(`/v1/admin/inspections/${inspection.publicId}/actions/record`, {
          foundCritical: 0,
          foundMajor: 0,
          foundMinor: 0,
        })
        .expect(200);
    await post(owner, `/v1/partner/shipments/${shipment}/proof-of-delivery`, {
      receiverName: 'ผู้รับ ทดสอบ',
      signatureFileId: await photo(owner),
      photoFileIds: [await photo(owner)],
      items: [{ destinationId: destination.id, deliveredQuantity: 1000 }],
    }).expect(201);
    await ctx.pump();

    // GR at min(delivered, ordered) (D-165), the paid advance applied (P16), the balance open until the claim window ends.
    const grs = (await as(ctx, owner).get('/v1/partner/goods-receipts?perPage=100').expect(200)).body
      .data as {
      id: string;
      grNumber: string;
      poNumber: string;
      payableQuantity: number;
      netAmount: string;
      vatAmount: string;
    }[];
    const po = await ctx.prisma.purchaseOrder.findUniqueOrThrow({ where: { productionJobId: job.id } });
    const gr = grs.find((g) => g.poNumber === po.poNumber)!;
    expect(gr.payableQuantity).toBe(1000);
    const applied = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'advance.applied', aggregateId: po.publicId },
    });
    expect(D((applied.payload as { amount: string }).amount).gt(0)).toBe(true);
    expect(
      (await ctx.prisma.journalEntry.count({ where: { sourceDocumentPublicId: gr.id, status: 'posted' } })) >
        0,
    ).toBe(true);
    const balance = await ctx.prisma.payableItem.findFirstOrThrow({
      where: { purchaseOrderId: po.id, source: 'goods_receipt' },
    });
    expect(balance.status).toBe('open');

    // The statement: disputed (a note is required), then confirmed.
    const statements = (await as(ctx, owner).get('/v1/partner/billing-statements?perPage=100').expect(200))
      .body.data as {
      id: string;
      status: string;
      netAmount: string;
      vatAmount: string;
      lines: { description: string }[];
    }[];
    const bs = statements.find((s) => s.lines.some((l) => l.description.startsWith(gr.grNumber)))!;
    expect(bs).toMatchObject({ status: 'sent', netAmount: gr.netAmount, vatAmount: gr.vatAmount });
    await post(owner, `/v1/partner/billing-statements/${bs.id}/actions/dispute`, {}).expect(422);
    await post(owner, `/v1/partner/billing-statements/${bs.id}/actions/dispute`, {
      note: 'ยอดขนส่งไม่ตรง (fake)',
    }).expect(200);
    expect(
      (await post(owner, `/v1/partner/billing-statements/${bs.id}/actions/confirm`).expect(200)).body.status,
    ).toBe('confirmed');

    // A tax invoice from the wrong seller is refused, then rejected; the right one is validated.
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
    });
    const file = await uploadPdf(
      ctx,
      owner,
      await makePdf({ widthMm: 210, heightMm: 297 }),
      'document',
      'partner',
    );
    const invoice = (no: string, taxId: string) => ({
      vendorInvoiceNo: no,
      invoiceDate: today(),
      sellerTaxId: taxId,
      sellerBranchCode: factory.branchCode,
      netAmount: bs.netAmount,
      vatAmount: bs.vatAmount,
      source: 'pdf_upload',
      fileId: file,
    });
    const wrong = (
      await post(
        owner,
        `/v1/partner/billing-statements/${bs.id}/tax-invoices`,
        invoice(`IV-X-${ctx.run}`, '0000000000009'),
      ).expect(201)
    ).body as { id: string };
    expect(
      (
        await post(finance, `/v1/admin/vendor-invoices/${wrong.id}/actions/validate`, { valid: true }).expect(
          422,
        )
      ).body.code,
    ).toBe('payables.invoice_mismatch');
    expect(
      (
        await post(finance, `/v1/admin/vendor-invoices/${wrong.id}/actions/validate`, {
          valid: false,
          reason: 'ผู้ขายไม่ตรง',
        }).expect(200)
      ).body.status,
    ).toBe('rejected');
    await post(
      owner,
      `/v1/partner/billing-statements/${bs.id}/tax-invoices`,
      invoice(`IV-X-${ctx.run}`, factory.taxId),
    ).expect(409);
    const right = (
      await post(
        owner,
        `/v1/partner/billing-statements/${bs.id}/tax-invoices`,
        invoice(`IV-${ctx.run}`, factory.taxId),
      ).expect(201)
    ).body as { id: string };
    const validated = (
      await post(finance, `/v1/admin/vendor-invoices/${right.id}/actions/validate`, { valid: true }).expect(
        200,
      )
    ).body;
    expect(validated).toMatchObject({ status: 'validated', inputVatStatus: 'claimable' });
    await ctx.pump();

    // P17V: the advance's VAT paid while the document was missing moves from 1242 to input VAT.
    const lines = (await journalsOf(right.id)).flatMap((j) => j.lines);
    expect(sum(lines, '1241')).toBe(advanceVat);
    expect(sum(lines, '1242')).toBe(D(advanceVat).neg().toFixed(2));
  });

  it('pays the balance with WHT and retention next to a carrier bill; a failed transfer returns to the queue (P17, P25, P25P, SoD)', async () => {
    const po = await ctx.prisma.purchaseOrder.findFirstOrThrow({
      where: { order: { publicId: order.orderId } },
    });
    const balance = await ctx.prisma.payableItem.findFirstOrThrow({
      where: { purchaseOrderId: po.id, source: 'goods_receipt' },
    });
    // Time travel: the claim window is over.
    await ctx.prisma.payableItem.update({
      where: { id: balance.id },
      data: { eligibleAt: new Date(Date.now() - 60_000), status: 'eligible' },
    });

    // A fallback carrier with a bill (P25): its recorder cannot then change its bank account (SoD, §8).
    const carrier = (
      await post(finance, '/v1/admin/vendors', {
        kind: 'carrier',
        legalName: `[E2E] ขนส่ง ${ctx.run} (fake)`,
        juristicType: 'company',
        taxId: `05${String(ctx.run).padStart(11, '0').slice(-11)}`,
        isVatRegistered: true,
        defaultWhtCategory: 'transport',
        paymentTermsDays: 0,
      }).expect(201)
    ).body as { id: string };
    const bill = (
      await post(finance, `/v1/admin/vendors/${carrier.id}/bills`, {
        vendorInvoiceNo: `FL-${ctx.run}`,
        invoiceDate: today(),
        isTaxInvoice: true,
        lines: [
          {
            description: 'ค่าขนส่ง (fake)',
            accountCode: '5130',
            netAmount: '100.00',
            vatAmount: '7.00',
            whtCategory: 'transport',
          },
        ],
      }).expect(201)
    ).body as { id: string; inputVatStatus: string };
    expect(bill.inputVatStatus).toBe('claimable');
    await post(finance, `/v1/admin/vendors/${carrier.id}/bills`, {
      vendorInvoiceNo: `FL-${ctx.run}`,
      invoiceDate: today(),
      isTaxInvoice: true,
      lines: [
        {
          description: 'x',
          accountCode: '5130',
          netAmount: '1.00',
          vatAmount: '0.07',
          whtCategory: 'transport',
        },
      ],
    }).expect(409);
    await ctx.pump();
    const billLines = (await journalsOf(bill.id)).flatMap((j) => j.lines);
    expect(sum(billLines, '5130')).toBe('100.00');
    expect(sum(billLines, '1241')).toBe('7.00');
    expect(sum(billLines, '2120')).toBe('-107.00');
    const sod = await post(finance, `/v1/admin/vendors/${carrier.id}/bank-accounts`, {
      bankCode: '014',
      accountName: 'x',
      accountNo: '000-0-00000-5',
    });
    expect(sod.status).toBe(409);
    expect(sod.body.code).toBe('iam.sod_conflict');
    const carrierPk = (await ctx.prisma.vendor.findUniqueOrThrow({ where: { publicId: carrier.id } })).id;
    await activeVendorAccount(carrierPk, `55${String(ctx.run).padStart(8, '0')}`);

    const run = (
      await post(finance, '/v1/admin/payout-runs', {
        companyBankAccountId: companyAccountId,
        payOn: today(),
        vendorIds: [factoryVendorId, carrier.id],
      }).expect(201)
    ).body as Run;
    const factoryItem = run.items.find((i) => i.kind === 'balance')!;
    const carrierItem = run.items.find((i) => i.kind === 'vendor_bill')!;
    const pct = D(balance.retentionPct);
    const hire = D(balance.whtBaseHire);
    const transport = D(balance.whtBaseTransport);
    expect(factoryItem).toMatchObject({
      vatClaimable: true,
      apNetAmount: balance.openNetAmount.toFixed(2),
      whtAmount: r2(hire.mul(3).div(100))
        .add(r2(transport.mul(1).div(100)))
        .toFixed(2),
      retentionAmount: r2(D(balance.openNetAmount).add(D(balance.openVatAmount)).mul(pct).div(100)).toFixed(
        2,
      ),
    });
    expect(
      D(factoryItem.cashAmount).eq(
        D(factoryItem.apNetAmount)
          .add(factoryItem.vatAmount)
          .sub(factoryItem.whtAmount)
          .sub(factoryItem.retentionAmount),
      ),
    ).toBe(true);
    expect(carrierItem).toMatchObject({
      apNetAmount: '100.00',
      vatAmount: '7.00',
      whtAmount: '1.00',
      cashAmount: '106.00',
    });

    const proposed = (await post(finance, `/v1/admin/payout-runs/${run.id}/actions/propose`).expect(200))
      .body as Run;
    await approve(chief, proposed.approvalRequestId!);
    await post(finance, `/v1/admin/payout-runs/${run.id}/actions/generate-bank-file`).expect(200);
    // Every item must be answered.
    await post(finance, `/v1/admin/payout-runs/${run.id}/actions/confirm`, {
      confirmations: [{ reference: randomUUID(), status: 'paid' }],
    }).expect(422);
    const done = (
      await post(finance, `/v1/admin/payout-runs/${run.id}/actions/confirm`, {
        confirmations: [
          { reference: factoryItem.id, status: 'paid', bankRef: `B2${ctx.run}` },
          { reference: carrierItem.id, status: 'failed', reason: 'บัญชีปิดแล้ว' },
        ],
      }).expect(200)
    ).body as Run;
    await ctx.pump();
    expect(done.status).toBe('partially_failed');

    // P17: AP cleared, VAT to input VAT (a validated invoice), WHT split by form, retention kept in 2130.
    const lines = (await journalsOf(factoryItem.id)).flatMap((j) => j.lines);
    expect(sum(lines, '2110')).toBe(factoryItem.apNetAmount);
    expect(sum(lines, '1241')).toBe(factoryItem.vatAmount);
    expect(sum(lines, '2130')).toBe(D(factoryItem.retentionAmount).neg().toFixed(2));
    expect(sum(lines, bankGlCode)).toBe(D(factoryItem.cashAmount).neg().toFixed(2));
    const retention = await ctx.prisma.payableItem.findFirst({
      where: { purchaseOrderId: po.id, source: 'retention' },
    });
    if (D(factoryItem.retentionAmount).gt(0))
      expect(retention?.openNetAmount.toFixed(2)).toBe(factoryItem.retentionAmount);

    // The failed carrier transfer is an exception and its bill is payable again; nothing posted for it.
    const exceptions = (await as(ctx, finance).get('/v1/admin/payout-exceptions').expect(200)).body as {
      id: string;
      failureReason: string;
    }[];
    expect(exceptions.find((e) => e.id === carrierItem.id)?.failureReason).toBe('บัญชีปิดแล้ว');
    expect(await ctx.prisma.journalEntry.count({ where: { sourceDocumentPublicId: carrierItem.id } })).toBe(
      0,
    );
    const again = (await as(ctx, finance).get(`/v1/admin/payables?vendorId=${carrier.id}`).expect(200)).body
      .data as { status: string }[];
    expect(again.map((p) => p.status)).toContain('eligible');
  });

  it('matches a statement to the payout and a gateway settlement, parks and identifies an unknown receipt (P04, P29, P02)', async () => {
    // The SCB settlement for the customer's payment: fee and VAT on the fee (P04 when matched).
    const settlement = (
      await post(finance, '/v1/admin/gateway-settlements', {
        provider: 'scb',
        companyBankAccountId: companyAccountId,
        settlementDate: today(),
        vatOnFee: '0.70',
        feeTaxInvoiceNo: `SCB-TI-${ctx.run}`,
        lines: [{ providerRef: order.paymentRef, grossAmount: order.paymentCash, feeAmount: '10.00' }],
      }).expect(201)
    ).body as { id: string; netAmount: string; status: string; unmatchedLines: number };
    expect(settlement).toMatchObject({
      status: 'imported',
      unmatchedLines: 0,
      netAmount: D(order.paymentCash).sub('10.70').toFixed(2),
    });

    const unknown = `${(1000 + (ctx.run % 900)).toString()}.37`;
    const rows = [
      {
        txnDate: today(),
        amount: D(advanceRun.cashAmount).neg().toFixed(2),
        description: `TRF OUT ${advanceRun.runNo}`,
        reference: advanceRun.runNo,
      },
      {
        txnDate: today(),
        amount: settlement.netAmount,
        description: 'SCB SETTLEMENT',
        reference: `S${ctx.run}`,
      },
      { txnDate: today(), amount: unknown, description: `TRF IN UNKNOWN ${ctx.run}` },
    ];
    const imported = (
      await post(finance, '/v1/admin/bank-statements', {
        companyBankAccountId: companyAccountId,
        rows,
      }).expect(201)
    ).body as { lines: number; matched: number };
    expect(imported).toMatchObject({ lines: 3, matched: 2 });
    expect(
      (
        await post(finance, '/v1/admin/bank-statements', {
          companyBankAccountId: companyAccountId,
          rows,
        }).expect(409)
      ).body.code,
    ).toBe('banking.duplicate_import');
    await ctx.pump();

    const s = await ctx.prisma.gatewaySettlement.findUniqueOrThrow({ where: { publicId: settlement.id } });
    expect(s.status).toBe('posted');
    const p04 = (await journalsOf(settlement.id)).flatMap((j) => j.lines);
    expect(sum(p04, bankGlCode)).toBe(settlement.netAmount);
    expect(sum(p04, '6110')).toBe('10.00');
    expect(sum(p04, '1241')).toBe('0.70');
    expect(sum(p04, '1132')).toBe(D(order.paymentCash).neg().toFixed(2));

    const lines = (
      await as(ctx, finance)
        .get(`/v1/admin/bank-statement-lines?companyBankAccountId=${companyAccountId}&perPage=100`)
        .expect(200)
    ).body.data as {
      id: string;
      amount: string;
      matchStatus: string;
      matches: { targetType: string; targetId: string }[];
    }[];
    const out = lines.find(
      (l) => l.amount === D(advanceRun.cashAmount).neg().toFixed(2) && l.matchStatus === 'matched',
    )!;
    expect(out.matches[0]).toMatchObject({ targetType: 'payout_run', targetId: advanceRun.id });
    const stray = lines.find((l) => l.amount === unknown)!;
    expect(stray.matchStatus).toBe('unmatched');
    // U-B0.3: candidates of the stray line (none fits) and the settlement in the list.
    const suggested = await as(ctx, finance)
      .get(`/v1/admin/bank-statement-lines/${stray.id}/suggestions`)
      .expect(200);
    expect(Array.isArray(suggested.body)).toBe(true);
    const settlements = (await as(ctx, finance).get('/v1/admin/gateway-settlements?perPage=100').expect(200))
      .body.data as { id: string; status: string; companyBankAccountId: string }[];
    expect(settlements.find((x) => x.id === settlement.id)).toMatchObject({
      status: 'posted',
      companyBankAccountId: companyAccountId,
    });

    // Parked in 1140 (P29), then identified as a payment of another order group (P02 on its receipt).
    await post(finance, `/v1/admin/bank-statement-lines/${stray.id}/actions/mark-unidentified`).expect(200);
    await ctx.pump();
    const receipts = (await as(ctx, finance).get('/v1/admin/unidentified-receipts?status=open').expect(200))
      .body as { id: string; amount: string }[];
    const receipt = receipts.find((r) => r.amount === unknown)!;
    const p29 = (await journalsOf(receipt.id)).flatMap((j) => j.lines);
    expect(sum(p29, bankGlCode)).toBe(unknown);
    expect(sum(p29, '1140')).toBe(D(unknown).neg().toFixed(2));
    await post(finance, `/v1/admin/bank-statement-lines/${stray.id}/actions/ignore`, {
      reason: 'ทดสอบ (fake)',
    }).expect(409);

    const { token } = await customerToken(ctx, 2);
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
    const group = (await post(token, '/v1/store/checkout').expect(201)).body as { id: string };
    const identified = (
      await post(finance, `/v1/admin/unidentified-receipts/${receipt.id}/actions/identify`, {
        orderGroupId: group.id,
      }).expect(200)
    ).body as { status: string };
    expect(identified.status).toBe('matched');
    await ctx.pump();
    const payment = await ctx.prisma.payment.findFirstOrThrow({
      where: { provider: 'bank', amount: unknown },
    });
    expect(payment.status).toBe('succeeded');
    await post(finance, `/v1/admin/unidentified-receipts/${receipt.id}/actions/identify`, {
      orderGroupId: group.id,
    }).expect(409);

    const cash = (await as(ctx, finance).get('/v1/admin/cash-position').expect(200)).body as {
      banks: { companyBankAccountId: string; glBalance: string }[];
    };
    expect(cash.banks.map((b) => b.companyBankAccountId)).toContain(companyAccountId);
  });

  it('splits one deposit over several targets whose parts add up to the line (U-B0.3, §6)', async () => {
    const amount = `${(2000 + (ctx.run % 900)).toString()}.50`;
    await post(finance, '/v1/admin/bank-statements', {
      companyBankAccountId: companyAccountId,
      rows: [{ txnDate: today(), amount: `-${amount}`, description: `TAX PAYMENTS ${ctx.run}` }],
    }).expect(201);
    const line = (
      (
        await as(ctx, finance)
          .get(`/v1/admin/bank-statement-lines?companyBankAccountId=${companyAccountId}&perPage=100`)
          .expect(200)
      ).body.data as { id: string; amount: string; matchStatus: string }[]
    ).find((l) => l.amount === `-${amount}`)!;
    const half = D(amount).div(2).toDecimalPlaces(2);
    const parts = [
      { targetType: 'tax_payment', targetId: randomUUID(), amount: half.toFixed(2) },
      { targetType: 'tax_payment', targetId: randomUUID(), amount: D(amount).sub(half).toFixed(2) },
    ];
    expect(
      (
        await post(finance, `/v1/admin/bank-statement-lines/${line.id}/actions/split`, {
          parts: [parts[0], { ...parts[1]!, amount: '1.00' }],
        }).expect(422)
      ).body.code,
    ).toBe('banking.match_amount_mismatch');
    await post(finance, `/v1/admin/bank-statement-lines/${line.id}/actions/split`, {
      parts: [parts[0], { ...parts[1]!, targetType: 'gateway_settlement' }],
    }).expect(422);
    const split = await post(finance, `/v1/admin/bank-statement-lines/${line.id}/actions/split`, {
      parts,
    }).expect(200);
    expect(split.body).toMatchObject({ matchStatus: 'matched' });
    expect(split.body.matches).toHaveLength(2);
    await post(finance, `/v1/admin/bank-statement-lines/${line.id}/actions/split`, { parts }).expect(409);
  });

  it('keeps the new surfaces behind their permissions', async () => {
    const cs = await staffToken(ctx, 'cs');
    await as(ctx, cs).get('/v1/admin/payout-runs').expect(403);
    await post(cs, '/v1/admin/bank-statements', { companyBankAccountId: companyAccountId, rows: [] }).expect(
      403,
    );
    const auditor = await staffToken(ctx, 'auditor');
    await as(ctx, auditor).get('/v1/admin/payout-runs').expect(200);
    await post(auditor, '/v1/admin/payout-runs', {
      companyBankAccountId: companyAccountId,
      payOn: today(),
    }).expect(403);
  });
});
