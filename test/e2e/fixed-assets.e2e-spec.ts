import { randomUUID } from 'node:crypto';

import { MoneyDecimal } from '@common/money/money';
import { bangkokDate } from '@common/time/bangkok';
import { addMonths } from '@modules/ledger/ledger-dates';

import { as, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

const D = (v: { toString(): string }) => new MoneyDecimal(v.toString());

interface Asset {
  id: string;
  assetNo: string;
  cost: string;
  accumulatedDepreciation: string;
  netBookValue: string;
  status: string;
  depreciationStartOn: string;
}

/**
 * B5.5 (D-150): a category with its accounts, an asset registered manually (FA01) and one from a vendor bill
 * that capitalised it (P25, never more than the bill), monthly runs (FA02) with the rounding taken by the last
 * month and missed months caught up, one run per month, a disposal refused until depreciation is current then
 * posted with its loss (FA03), and the roll-forward agreeing with the GL.
 */
describe('fixed assets (e2e, B5.5)', () => {
  let ctx: FulfilmentApp;
  let finance: string;
  let manager: string;
  let auditor: string;
  // Months no other suite depreciates (the month simulation runs the current month).
  const month = addMonths(`${bangkokDate(new Date()).slice(0, 7)}-01`, 7).slice(0, 7);
  const m = (offset: number) => addMonths(`${month}-01`, offset).slice(0, 7);

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    [finance, manager, auditor] = await Promise.all([
      staffToken(ctx, 'finance'),
      staffToken(ctx, 'finance_manager'),
      staffToken(ctx, 'auditor'),
    ]);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  const post = (token: string, path: string, body: object = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
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
  const asset = async (id: string) =>
    (await as(ctx, auditor).get(`/v1/admin/fixed-assets/${id}`).expect(200)).body as Asset;

  let categoryId: string;
  let laptop: Asset;
  let small: Asset;

  it('registers assets manually (FA01) and from a vendor bill, never above what the bill capitalised', async () => {
    const code = `comp${ctx.run}`;
    const bad = await post(finance, '/v1/admin/asset-categories', {
      code: `${code}x`,
      nameTh: 'x',
      nameEn: 'x',
      usefulLifeMonths: 36,
      assetAccountCode: '1210',
      accumulatedAccountCode: '1521',
      expenseAccountCode: '6150',
      gainLossAccountCode: '6910',
    }).expect(422);
    expect(bad.body.code).toBe('fixed_assets.account_invalid');
    const created = await post(finance, '/v1/admin/asset-categories', {
      code,
      nameTh: 'คอมพิวเตอร์ (fake)',
      nameEn: 'Computers (fake)',
      usefulLifeMonths: 36,
      assetAccountCode: '1520',
      accumulatedAccountCode: '1521',
      expenseAccountCode: '6150',
      gainLossAccountCode: '6910',
    }).expect(201);
    categoryId = created.body.id as string;
    await post(finance, '/v1/admin/asset-categories', { ...created.body, code }).expect(422);

    // Life changes apply to new assets only; guarded by If-Match.
    await as(ctx, finance)
      .patch(`/v1/admin/asset-categories/${categoryId}`)
      .send({ usefulLifeMonths: 3 })
      .expect(428);
    const updated = await as(ctx, finance)
      .patch(`/v1/admin/asset-categories/${categoryId}`)
      .set('If-Match', created.headers['etag'] as string)
      .send({ usefulLifeMonths: 3 })
      .expect(200);
    expect(updated.body.usefulLifeMonths).toBe(3);

    small = (
      await post(finance, '/v1/admin/fixed-assets', {
        categoryId,
        name: 'เครื่องสแกนเนอร์ (fake)',
        acquiredOn: `${month}-05`,
        cost: '1000.00',
        source: 'manual',
        creditAccountCode: '2410',
      }).expect(201)
    ).body as Asset;
    expect(small).toMatchObject({ depreciationStartOn: `${month}-01`, status: 'active' });
    await as(ctx, finance)
      .patch(`/v1/admin/asset-categories/${categoryId}`)
      .set('If-Match', updated.headers['etag'] as string)
      .send({ usefulLifeMonths: 36 })
      .expect(200);
    laptop = (
      await post(finance, '/v1/admin/fixed-assets', {
        categoryId,
        name: 'โน้ตบุ๊ก (fake)',
        acquiredOn: `${month}-01`,
        cost: '36000.00',
        source: 'manual',
        creditAccountCode: '2410',
        location: 'สำนักงาน (fake)',
      }).expect(201)
    ).body as Asset;
    await ctx.pump();
    const fa01 = (await journalsOf(laptop.id)).flatMap((j) => j.lines);
    expect(sum(fa01, '1520')).toBe('36000.00');
    expect(sum(fa01, '2410')).toBe('-36000.00');
    // A control account is never credited by hand.
    expect(
      (
        await post(finance, '/v1/admin/fixed-assets', {
          categoryId,
          name: 'x',
          acquiredOn: `${month}-01`,
          cost: '1.00',
          source: 'manual',
          creditAccountCode: '2110',
        }).expect(422)
      ).body.code,
    ).toBe('fixed_assets.account_invalid');

    // A service vendor's bill capitalises 10,000 on 1520 (P25): at most that is registered from it.
    const vendor = (
      await post(finance, '/v1/admin/vendors', {
        kind: 'service',
        legalName: `[E2E] ร้านไอที ${ctx.run} (fake)`,
        juristicType: 'company',
        taxId: `04${String(ctx.run).padStart(11, '0').slice(-11)}`,
        isVatRegistered: true,
        defaultWhtCategory: 'none',
        paymentTermsDays: 30,
      }).expect(201)
    ).body as { id: string };
    const bill = (
      await post(finance, `/v1/admin/vendors/${vendor.id}/bills`, {
        vendorInvoiceNo: `IT-${ctx.run}`,
        invoiceDate: `${month}-01`,
        isTaxInvoice: true,
        lines: [
          {
            description: 'เครื่องพิมพ์ (fake)',
            accountCode: '1520',
            netAmount: '10000.00',
            vatAmount: '700.00',
            whtCategory: 'none',
          },
        ],
      }).expect(201)
    ).body as { id: string };
    await post(finance, '/v1/admin/fixed-assets', {
      categoryId,
      name: 'เครื่องพิมพ์ (fake)',
      acquiredOn: `${month}-01`,
      cost: '10000.00',
      source: 'vendor_bill',
      vendorInvoiceId: bill.id,
    }).expect(201);
    const over = await post(finance, '/v1/admin/fixed-assets', {
      categoryId,
      name: 'เกิน',
      acquiredOn: `${month}-01`,
      cost: '0.01',
      source: 'vendor_bill',
      vendorInvoiceId: bill.id,
    }).expect(422);
    expect(over.body.code).toBe('fixed_assets.cost_exceeds_bill');
    await ctx.pump();
  });

  it('depreciates month by month (FA02), once per month, the last month taking the rounding', async () => {
    // U-B0.3: the preview is what the run posts.
    const preview = (
      await as(ctx, auditor).get(`/v1/admin/depreciation-runs/preview?period=${month}`).expect(200)
    ).body as { alreadyRun: boolean; totalAmount: string; assetCount: number };
    expect(preview.alreadyRun).toBe(false);
    const run = (await post(finance, '/v1/admin/depreciation-runs', { period: month }).expect(201)).body as {
      id: string;
      totalAmount: string;
      assetCount: number;
    };
    await post(finance, '/v1/admin/depreciation-runs', { period: month }).expect(409);
    expect({ total: preview.totalAmount, assets: preview.assetCount }).toEqual({
      total: run.totalAmount,
      assets: run.assetCount,
    });
    expect(
      (await as(ctx, auditor).get(`/v1/admin/depreciation-runs/preview?period=${month}`).expect(200)).body,
    ).toMatchObject({ alreadyRun: true, lines: [] });
    await ctx.pump();
    expect((await asset(laptop.id)).accumulatedDepreciation).toBe('1000.00');
    expect((await asset(small.id)).accumulatedDepreciation).toBe('333.33');
    const fa02 = (await journalsOf(run.id)).flatMap((j) => j.lines);
    // The run covers every active asset (other suites' too): one journal, expense = the run total; this
    // category's accumulated depreciation is this suite's three assets (1000.00 + 333.33 + 277.78).
    expect(sum(fa02, '6150')).toBe(run.totalAmount);
    expect(sum(fa02, '1521')).toBe('-1611.11');

    // Two months later without the month in between: caught up in one run.
    await post(finance, '/v1/admin/depreciation-runs', { period: m(2) }).expect(201);
    expect((await asset(laptop.id)).accumulatedDepreciation).toBe('3000.00');
    const done = await asset(small.id);
    expect(done).toMatchObject({
      accumulatedDepreciation: '1000.00',
      status: 'fully_depreciated',
      netBookValue: '0.00',
    });
    const schedule = (
      await as(ctx, auditor).get(`/v1/admin/fixed-assets/${small.id}/depreciation`).expect(200)
    ).body as { period: string; amount: string }[];
    expect(schedule.map((l) => [l.period, l.amount])).toEqual([
      [month, '333.33'],
      [m(2), '666.67'],
    ]);
    await post(auditor, '/v1/admin/depreciation-runs', { period: m(3) }).expect(403);
  });

  it('disposes of an asset only with current depreciation (FA03) and reconciles the register to the GL', async () => {
    const pending = await post(manager, `/v1/admin/fixed-assets/${laptop.id}/actions/dispose`, {
      kind: 'sold',
      disposedOn: `${m(4)}-10`,
      proceeds: '30000.00',
      proceedsAccountCode: '1270',
      reason: 'ขาย (fake)',
    }).expect(409);
    expect(pending.body.code).toBe('fixed_assets.depreciation_pending');
    await post(finance, `/v1/admin/fixed-assets/${laptop.id}/actions/dispose`, {
      kind: 'sold',
      disposedOn: `${m(3)}-10`,
      proceeds: '30000.00',
      proceedsAccountCode: '1270',
      reason: 'ขาย (fake)',
    }).expect(403);
    const sold = (
      await post(manager, `/v1/admin/fixed-assets/${laptop.id}/actions/dispose`, {
        kind: 'sold',
        disposedOn: `${m(3)}-10`,
        proceeds: '30000.00',
        proceedsAccountCode: '1270',
        reason: 'ขาย (fake)',
      }).expect(200)
    ).body as Asset;
    expect(sold.status).toBe('disposed');
    await post(manager, `/v1/admin/fixed-assets/${laptop.id}/actions/dispose`, {
      kind: 'written_off',
      disposedOn: `${m(3)}-10`,
      reason: 'ซ้ำ',
    }).expect(409);
    await ctx.pump();
    const fa03 = (await journalsOf(laptop.id)).flatMap((j) => j.lines);
    // FA01 + FA03 on the asset: 1520 back to zero; accumulated 3000 out; proceeds 30000; loss 3000.
    expect(sum(fa03, '1520')).toBe('0.00');
    expect(sum(fa03, '1521')).toBe('3000.00');
    expect(sum(fa03, '1270')).toBe('30000.00');
    expect(sum(fa03, '6910')).toBe('3000.00');
    // The row is final (DB trigger).
    const row = await ctx.prisma.fixedAsset.findUniqueOrThrow({ where: { publicId: laptop.id } });
    await expect(
      ctx.prisma.fixedAsset.update({ where: { id: row.id }, data: { location: 'x' } }),
    ).rejects.toThrow();

    const roll = (
      await as(ctx, auditor)
        .get(`/v1/admin/fixed-assets-reports/roll-forward?from=${month}&to=${m(3)}`)
        .expect(200)
    ).body as {
      categories: {
        category: string;
        additions: string;
        disposalsCost: string;
        closingCost: string;
        depreciation: string;
        closingAccumulated: string;
      }[];
      reconciliation: { accountCode: string; difference: string }[];
    };
    const mine = roll.categories.find((c) => c.category === `comp${ctx.run}`)!;
    expect(mine).toMatchObject({ additions: '47000.00', disposalsCost: '36000.00', closingCost: '11000.00' });
    expect(roll.reconciliation.map((r) => r.difference)).toEqual(roll.reconciliation.map(() => '0.00'));
  });
});
