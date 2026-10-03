import { randomUUID } from 'node:crypto';

import { MoneyDecimal } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { OBJECT_STORAGE, type ObjectStorage } from '@integrations/s3/object-storage.port';
import { CloseService } from '@modules/close/close.service';
import { PeriodsService } from '@modules/ledger/periods.service';
import { readObject } from '@modules/payouts/read-object';
import { TaxReportsService } from '@modules/tax/tax-reports.service';
import ExcelJS from 'exceljs';

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
import { activeVendorAccount, carrierBill, companyAccount, payVendors } from '../support/finance-e2e';
import {
  approveArtwork,
  bootFulfilmentApp,
  factoryToken,
  type FulfilmentApp,
  payDue,
  uploadBytes,
} from '../support/fulfilment-e2e';

const D = (v: { toString(): string }) => new MoneyDecimal(v.toString());

/**
 * B5 quality — a month in a box (prompt "Quality"): a juristic customer pays a deposit with withholding (P01 +
 * P03), the gateway settles with fees (P04), the factory gets its advance (P14), delivers 990 of 1000 (shortage
 * credit to the wallet, P19; GR at 990, P15 / P16), its tax invoice is validated (P17V), a claim deducts from it
 * (P20), the balance is paid with WHT and retention (P17) next to a carrier bill (P25 / P25P), points accrue on
 * the paid order (P10), an asset depreciates (FA02). Then: every posted journal balances, the trial balance,
 * balance sheet and cash flow agree with themselves, every VAT / WHT paper reconciles to its GL accounts and
 * every sub-ledger to its control account with a difference of exactly 0; the auditor's sample is reproducible,
 * the exception reports run and the PBC pack opens.
 */
describe('month simulation: sub-ledgers, tax papers and the trial balance reconcile to zero (e2e, B5 quality)', () => {
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
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
    });
    await activeVendorAccount(ctx, factory.vendorId, `77${String(ctx.run).padStart(8, '0')}`);
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const post = (token: string, path: string, body: object = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
  const photo = (token: string, surface: 'store' | 'partner') =>
    uploadBytes(ctx, token, Buffer.from(`photo ${randomUUID()}`), {
      purpose: 'evidence',
      fileName: 'p.png',
      mimeType: 'image/png',
      surface,
    });

  it('runs the month', async () => {
    // --- sales: a juristic customer who withholds tax pays the deposit by SCB (TR, P01 + P03) --------------
    const { token } = await customerToken(ctx, 1);
    const postcode = postcodes(ctx, 1)[0]!;
    const address = await addAddress(ctx, token, postcode);
    const province = await ctx.prisma.geoProvince.findUniqueOrThrow({ where: { code: 'DEV1' } });
    const profile = (
      await as(ctx, token)
        .post('/v1/store/tax-profiles', {
          taxType: 'juristic',
          name: 'บริษัท ลูกค้าจำลอง จำกัด (fake)',
          taxId: fakeTaxId(ctx, 1),
          branchType: 'head_office',
          line1: '1 ถนนตัวอย่าง',
          provinceId: province.publicId,
          postcode,
          withholdsTax: true,
        })
        .expect(201)
    ).body as { id: string };
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity: 1000 }],
      })
      .expect(201);
    const group = (await post(token, '/v1/store/checkout', { taxProfileId: profile.id }).expect(201))
      .body as { id: string; orders: { id: string }[] };
    const orderId = group.orders[0]!.id;
    const payment = (await payDue(ctx, token, group.id)) as { cashAmount: string; referenceCode: string };
    await approveArtwork(ctx, token, await staffToken(ctx, 'prepress'), orderId);
    await ctx.pump();

    // --- gateway settlement with fees, matched from the bank statement (P04) ------------------------------
    const settlement = (
      await post(finance, '/v1/admin/gateway-settlements', {
        provider: 'scb',
        companyBankAccountId: bank.id,
        settlementDate: today(),
        vatOnFee: '1.40',
        feeTaxInvoiceNo: `SCB-${ctx.run}`,
        lines: [{ providerRef: payment.referenceCode, grossAmount: payment.cashAmount, feeAmount: '20.00' }],
      }).expect(201)
    ).body as { netAmount: string };
    await post(finance, '/v1/admin/bank-statements', {
      companyBankAccountId: bank.id,
      rows: [{ txnDate: today(), amount: settlement.netAmount, description: `SCB SETTLE ${ctx.run}` }],
    }).expect(201);

    // --- the factory: PO at release, accepted, advance paid (P14, VAT pending its tax invoice) -----------------
    const owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 91);
    const job = await ctx.prisma.productionJob.findFirstOrThrow({ where: { order: { publicId: orderId } } });
    await post(owner, `/v1/partner/production-jobs/${job.publicId}/actions/accept`).expect(200);
    await ctx.pump();
    const vendor = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
      include: { vendor: true },
    });
    await payVendors(ctx, { finance, chief }, bank.id, [vendor.vendor.publicId]);

    // --- production, POD 990 / 1000: shortage credit to the wallet (P19), GR at 990 (P15, P16) ------------
    const operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 92);
    const qc = await factoryToken(ctx, fixture.factoryPublicId, 'factory_qc', 93);
    const detail = await as(ctx, owner).get(`/v1/partner/production-jobs/${job.publicId}`).expect(200);
    for (const m of (
      detail.body.milestones as { id: string; seq: number; evidence: string; tracksQuantity: boolean }[]
    ).sort((a, b) => a.seq - b.seq)) {
      const url = `/v1/partner/production-jobs/${job.publicId}/milestones/${m.id}`;
      await post(operator, url, {
        action: 'start',
        clientRef: randomUUID(),
        ...(m.tracksQuantity && { quantityIn: 1000 }),
      }).expect(200);
      const shot = m.evidence.includes('photo') ? [await photo(operator, 'partner')] : [];
      if (m.evidence.includes('qc_form'))
        await post(qc, `/v1/partner/production-jobs/${job.publicId}/qc-checks`, {
          checklistVersion: 'folding-v1',
          checklist: { colour: 'ok' },
          result: 'pass',
          quantityChecked: 80,
          photoFileIds: shot.length ? shot : [await photo(qc, 'partner')],
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
      receiverName: 'ผู้รับ (fake)',
      signatureFileId: await photo(owner, 'partner'),
      photoFileIds: [await photo(owner, 'partner')],
      items: [{ destinationId: destination.id, deliveredQuantity: 990 }],
    }).expect(201);
    await ctx.pump();

    // --- the factory's tax invoice, validated (P17V) -------------------------------------------------------
    const po = await ctx.prisma.purchaseOrder.findUniqueOrThrow({ where: { productionJobId: job.id } });
    const statement = await ctx.prisma.billingStatement.findFirstOrThrow({
      where: { lines: { some: { goodsReceipt: { poId: po.id } } } },
    });
    await post(owner, `/v1/partner/billing-statements/${statement.publicId}/actions/confirm`).expect(200);
    const invoice = (
      await post(owner, `/v1/partner/billing-statements/${statement.publicId}/tax-invoices`, {
        vendorInvoiceNo: `SIM-${ctx.run}`,
        invoiceDate: today(),
        sellerTaxId: vendor.taxId,
        sellerBranchCode: vendor.branchCode,
        netAmount: statement.netAmount.toFixed(2),
        vatAmount: statement.vatAmount.toFixed(2),
        source: 'e_tax',
      }).expect(201)
    ).body as { id: string };
    await post(finance, `/v1/admin/vendor-invoices/${invoice.id}/actions/validate`, { valid: true }).expect(
      200,
    );
    await ctx.pump();

    // --- a claim: the factory is liable, 100.00 deducted from its payable (P20) -----------------------------
    const claim = (
      await post(token, `/v1/store/orders/${orderId}/claims`, {
        type: 'print_defect',
        description: 'สีเพี้ยน 50 ชิ้น (fake)',
        requestedResolution: 'reprint',
        shipmentId: shipment,
        claimedQuantity: 50,
        productPhotoFileIds: [await photo(token, 'store')],
        cartonPhotoFileIds: [await photo(token, 'store')],
      }).expect(201)
    ).body as { id: string };
    const cs = await staffToken(ctx, 'cs');
    const lead = await staffToken(ctx, 'cs_lead');
    await post(cs, `/v1/admin/claims/${claim.id}/actions/review`).expect(200);
    await post(cs, `/v1/admin/claims/${claim.id}/actions/decide`, {
      decision: 'approved',
      severity: 'major',
      note: 'สีไม่ตรง (fake)',
    }).expect(200);
    await post(lead, `/v1/admin/claims/${claim.id}/actions/resolve`, {
      actions: [{ action: 'factory_deduction', amount: '100.00' }],
    }).expect(200);
    await ctx.pump();
    expect(await ctx.prisma.vendorDeduction.count({ where: { claim: { publicId: claim.id } } })).toBe(1);

    // --- the balance with WHT and retention (P17) next to a carrier bill (P25, P25P) ---------------------
    await ctx.prisma.payableItem.updateMany({
      where: { purchaseOrderId: po.id, source: 'goods_receipt', status: 'open' },
      data: { eligibleAt: new Date(Date.now() - 60_000), status: 'eligible' },
    });
    const carrier = await carrierBill(ctx, finance, { net: '500.00', vat: '35.00', no: `SIMC-${ctx.run}` });
    await ctx.pump();
    const run = await payVendors(ctx, { finance, chief }, bank.id, [
      vendor.vendor.publicId,
      carrier.vendorId,
    ]);
    expect(run.items.length).toBe(2);
    // The payout leaves the bank: the statement line matches the run.
    const imported = (
      await post(finance, '/v1/admin/bank-statements', {
        companyBankAccountId: bank.id,
        rows: [
          {
            txnDate: today(),
            amount: D(run.cashAmount).neg().toFixed(2),
            description: `PAYOUT ${run.runNo}`,
            reference: run.runNo,
          },
        ],
      }).expect(201)
    ).body as { matched: number };
    expect(imported.matched).toBe(1);

    // --- a fixed asset and the month's depreciation (FA01, FA02) ---------------------------------------------
    const category = (
      await post(finance, '/v1/admin/asset-categories', {
        code: `sim${ctx.run}`,
        nameTh: 'อุปกรณ์ (fake)',
        nameEn: 'Equipment (fake)',
        usefulLifeMonths: 60,
        assetAccountCode: '1510',
        accumulatedAccountCode: '1511',
        expenseAccountCode: '6150',
        gainLossAccountCode: '6910',
      }).expect(201)
    ).body as { id: string };
    await post(finance, '/v1/admin/fixed-assets', {
      categoryId: category.id,
      name: 'โต๊ะ (fake)',
      acquiredOn: `${month}-01`,
      cost: '6000.00',
      source: 'manual',
      creditAccountCode: '2410',
    }).expect(201);
    await ctx.pump();
    const runs = (await as(ctx, auditor).get('/v1/admin/depreciation-runs').expect(200)).body as {
      period: string;
    }[];
    if (!runs.some((r) => r.period === month))
      await post(finance, '/v1/admin/depreciation-runs', { period: month }).expect(201);
    await ctx.pump();
  });

  it('reconciles: balanced journals, trial balance, balance sheet, cash flow', async () => {
    const unbalanced = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM journal_entries e
      WHERE e.status = 'posted' AND (e.total_debit <> e.total_credit
        OR e.total_debit <> (SELECT coalesce(sum(debit), 0) FROM journal_lines l WHERE l.journal_entry_id = e.id)
        OR e.total_credit <> (SELECT coalesce(sum(credit), 0) FROM journal_lines l WHERE l.journal_entry_id = e.id))`;
    expect(Number(unbalanced[0]!.n)).toBe(0);
    const entity = await ctx.prisma.entity.findFirstOrThrow({ where: { isDefault: true } });
    const first = await ctx.prisma.fiscalPeriod.findFirstOrThrow({
      where: { entityId: entity.id },
      orderBy: { startDate: 'asc' },
    });
    const from = bangkokDate(first.startDate).slice(0, 7);
    expect(
      (
        await as(ctx, auditor)
          .get(`/v1/admin/financial-reports/trial-balance?from=${from}&to=${month}`)
          .expect(200)
      ).body.balanced,
    ).toBe(true);
    expect(
      (await as(ctx, auditor).get(`/v1/admin/financial-reports/balance-sheet?asOf=${today()}`).expect(200))
        .body.difference,
    ).toBe('0.00');
    expect(
      (
        await as(ctx, auditor)
          .get(`/v1/admin/financial-reports/cash-flow?from=${from}&to=${month}`)
          .expect(200)
      ).body.difference,
    ).toBe('0.00');
    const pl = (
      await as(ctx, auditor)
        .get(`/v1/admin/financial-reports/profit-and-loss?from=${month}&to=${month}&dimension=factory`)
        .expect(200)
    ).body as { lines: { dimension: string; revenue: string; costOfSales: string }[] };
    expect(pl.lines.some((l) => l.dimension.includes('F9001') && D(l.costOfSales).gt(0))).toBe(true);
  });

  it('reconciles every VAT / WHT paper and every sub-ledger to the GL with a difference of 0', async () => {
    const entity = await ctx.prisma.entity.findFirstOrThrow({ where: { isDefault: true } });
    const period = await ctx.app.get(PeriodsService).periodOf(entity.id, `${month}-01`);
    const tax = ctx.app.get(TaxReportsService);
    for (const kind of [
      'sales_tax',
      'purchase_tax',
      'pp30',
      'pnd3',
      'pnd53',
      'wht_issued_register',
      'wht_received_register',
    ] as const) {
      const built = await ctx.prisma.withTx((tx) => tax.build(tx, kind, period));
      expect({ kind, difference: built.gl.sub(built.report).toFixed(2) }).toEqual({
        kind,
        difference: '0.00',
      });
    }
    const rows = await ctx.prisma.withTx((tx) => ctx.app.get(CloseService).subledgers(tx, period));
    expect(rows.filter((r) => r.difference !== '0.00')).toEqual([]);
  });

  it('gives the auditor reproducible samples, the exception reports and the PBC pack', async () => {
    const draw = async (seed: string) =>
      (
        await post(auditor, '/v1/admin/audit/samples', {
          period: month,
          population: 'customer_documents',
          method: 'stratified',
          size: 3,
          seed,
        }).expect(201)
      ).body as { selected: { id: string }[]; populationSize: number };
    const a = await draw('424242');
    const b = await draw('424242');
    expect(a.populationSize).toBeGreaterThan(0);
    expect(b.selected.map((s) => s.id)).toEqual(a.selected.map((s) => s.id));
    await post(finance, '/v1/admin/audit/samples', {
      period: month,
      population: 'customer_documents',
      method: 'random',
      size: 3,
    }).expect(403);

    const exceptions = (await as(ctx, auditor).get(`/v1/admin/audit/exceptions?period=${month}`).expect(200))
      .body as { key: string; count: number }[];
    expect(exceptions.map((e) => e.key)).toEqual([
      'series_gaps',
      'outside_business_hours',
      'back_dated_documents',
      'manual_journals_by_user',
      'reversals',
      'duplicate_vendor_bank_accounts',
      'duplicate_slip_references',
      'credit_notes_after_period_end',
      'payouts_without_valid_tax_invoice',
    ]);
    // The advance was paid before the factory's tax invoice existed.
    expect(exceptions.find((e) => e.key === 'payouts_without_valid_tax_invoice')!.count).toBeGreaterThan(0);
    expect(exceptions.find((e) => e.key === 'series_gaps')!.count).toBe(0);

    const pbc = (await post(auditor, '/v1/admin/audit/pbc-exports', { period: month }).expect(201)).body as {
      id: string;
      sha256: string;
    };
    expect(pbc.sha256).toMatch(/^[0-9a-f]{64}$/);
    const row = await ctx.prisma.pbcExport.findUniqueOrThrow({
      where: { publicId: pbc.id },
      include: { file: true },
    });
    const body = await readObject(ctx.app.get<ObjectStorage>(OBJECT_STORAGE), row.file.storageKey);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(body as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(
      expect.arrayContaining(['TrialBalance', 'GLDetail', 'customer_documents', 'TaxReports', 'Exceptions']),
    );
    expect(
      (await as(ctx, auditor).get(`/v1/admin/audit/pbc-exports/${pbc.id}/file`).expect(200)).body.url,
    ).toEqual(expect.any(String));
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'pbc_export.generated', resourcePublicId: pbc.id },
      }),
    ).toBe(1);
    void manager;
  });
});
