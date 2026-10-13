import { randomUUID } from 'node:crypto';

import { bangkokDate } from '@common/time/bangkok';
import { addMonths } from '@common/ledger-core/dates';
import { ManualJournalsService } from '@modules/ledger/manual-journals.service';
import { RecurringJournalsService } from '@modules/ledger/recurring-journals.service';

import { as, customerToken, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

interface Journal {
  id: string;
  status: string;
  kind: string;
  entryNo: string | null;
  jvNumber: string | null;
  entryDate: string;
  documentDate: string;
  approvalRequestId: string | null;
  approvedBy: string | null;
  reversedById: string | null;
  postingRule: string | null;
  lines: { accountCode: string; debit: string; credit: string; taxCode: string | null }[];
}

/**
 * B5.1 ledger through the API: manual journals under maker-checker (D-169) with auto-reversal and reversal,
 * period discipline (§1.4), the posting engine on a real loyalty event (P10A), posting rules as data with
 * approved versions, chart-of-accounts and tax-rate changes, recurring journals, and the read-only auditor.
 */
describe('ledger core (e2e, B5.1)', () => {
  let ctx: FulfilmentApp;
  let finance: string;
  let manager: string;
  let auditor: string;
  const today = bangkokDate(new Date());

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
  const approve = async (requestId: string) => {
    await as(ctx, manager)
      .post(`/v1/admin/approvals/${requestId}/actions/approve`, { comment: 'ตรวจแล้ว' })
      .expect(200);
    await ctx.pump();
  };
  const journal = async (id: string) =>
    (await as(ctx, auditor).get(`/v1/admin/ledger/journals/${id}`).expect(200)).body as Journal;
  const accrual = (documentDate: string, amount = '15000.00', extra: object = {}) => ({
    documentDate,
    description: 'ตั้งค่าเช่าคลังค้างจ่าย (fake)',
    lines: [
      { accountCode: '6900', side: 'debit', amount, description: 'ค่าเช่าคลัง' },
      { accountCode: '2410', side: 'credit', amount },
    ],
    ...extra,
  });

  it('posts a manual journal only after another person approves it, then auto-reverses it', async () => {
    const draft = await as(ctx, finance)
      .post('/v1/admin/ledger/journals', accrual(today, '15000.00', { autoReverseOn: addMonths(today, 1) }))
      .expect(201);
    expect(draft.body).toMatchObject({ status: 'draft', kind: 'manual', entryNo: null });
    expect(draft.headers['etag']).toBeTruthy();
    // Edit with If-Match; a stale tag is refused.
    await as(ctx, finance)
      .put(`/v1/admin/ledger/journals/${draft.body.id}`, accrual(today, '16000.00'))
      .set('If-Match', '"stale"')
      .expect(412);
    const edited = await as(ctx, finance)
      .put(
        `/v1/admin/ledger/journals/${draft.body.id}`,
        accrual(today, '16000.00', { autoReverseOn: addMonths(today, 1) }),
      )
      .set('If-Match', draft.headers['etag'] as string)
      .expect(200);
    expect(edited.body.totalDebit).toBe('16000.00');
    // Another staff member cannot edit or submit the maker's draft.
    await post(manager, `/v1/admin/ledger/journals/${draft.body.id}/actions/submit`).expect(403);
    const submitted = await post(finance, `/v1/admin/ledger/journals/${draft.body.id}/actions/submit`).expect(
      200,
    );
    expect(submitted.body.status).toBe('pending_approval');
    // The maker never approves (maker-checker, §8).
    await as(ctx, finance)
      .post(`/v1/admin/approvals/${submitted.body.approvalRequestId}/actions/approve`, {})
      .expect(403);
    await approve(submitted.body.approvalRequestId as string);
    const posted = await journal(draft.body.id as string);
    expect(posted).toMatchObject({ status: 'posted', documentDate: today, entryDate: today });
    expect(posted.entryNo).toMatch(/^JE\d{6}-\d{6}$/);
    expect(posted.jvNumber).toMatch(/^DEVJV-/);
    expect(posted.approvedBy).toBeTruthy();
    // Auto-reversal on the day set (the job, run for that day).
    await ctx.app.get(ManualJournalsService).autoReverseDue(new Date(`${addMonths(today, 1)}T03:00:00Z`));
    const reversed = await journal(draft.body.id as string);
    expect(reversed.reversedById).toBeTruthy();
    const reversal = await journal(reversed.reversedById!);
    expect(reversal).toMatchObject({ kind: 'reversal', status: 'posted', entryDate: addMonths(today, 1) });
    expect(reversal.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['6900', '0.00', '16000.00'],
      ['2410', '16000.00', '0.00'],
    ]);
  });

  it('reverses a posted journal through the same maker-checker path, once', async () => {
    const draft = await as(ctx, finance)
      .post('/v1/admin/ledger/journals', accrual(today, '500.00'))
      .expect(201);
    const submitted = await post(finance, `/v1/admin/ledger/journals/${draft.body.id}/actions/submit`).expect(
      200,
    );
    await approve(submitted.body.approvalRequestId as string);
    const request = await post(finance, `/v1/admin/ledger/journals/${draft.body.id}/actions/reverse`, {
      documentDate: today,
      reason: 'บันทึกผิดบัญชี',
    }).expect(201);
    expect(request.body).toMatchObject({ kind: 'reversal', status: 'pending_approval' });
    await approve(request.body.approvalRequestId as string);
    expect((await journal(request.body.id as string)).status).toBe('posted');
    await post(finance, `/v1/admin/ledger/journals/${draft.body.id}/actions/reverse`, {
      documentDate: today,
      reason: 'ซ้ำ',
    }).expect(409);
  });

  it('refuses control accounts, unbalanced lines and missing dimensions in manual journals', async () => {
    const refused = await as(ctx, finance)
      .post('/v1/admin/ledger/journals', {
        documentDate: today,
        description: 'ตัดลูกหนี้ด้วยมือ',
        lines: [
          { accountCode: '1210', side: 'debit', amount: '10.00' },
          { accountCode: '4990', side: 'credit', amount: '10.00' },
        ],
      })
      .expect(422);
    expect(refused.body.code).toBe('ledger.account_invalid');
    const unbalanced = await as(ctx, finance)
      .post('/v1/admin/ledger/journals', {
        ...accrual(today),
        lines: [
          { accountCode: '6900', side: 'debit', amount: '10.00' },
          { accountCode: '2410', side: 'credit', amount: '9.00' },
        ],
      })
      .expect(422);
    expect(unbalanced.body.code).toBe('ledger.unbalanced');
    const noCustomer = await as(ctx, finance)
      .post('/v1/admin/ledger/journals', {
        ...accrual(today),
        lines: [
          { accountCode: '2320', side: 'debit', amount: '10.00' },
          { accountCode: '4990', side: 'credit', amount: '10.00' },
        ],
      })
      .expect(422);
    expect(noCustomer.body.code).toBe('ledger.account_invalid');
  });

  it('posts late items into the next open period with the document date kept (§1.4)', async () => {
    const month = addMonths(today, 4);
    const years = (await as(ctx, finance).get('/v1/admin/ledger/fiscal-years').expect(200)).body as {
      periods: { id: string; startDate: string; status: string }[];
    }[];
    expect(years.length).toBeGreaterThan(0);
    // The period four months ahead exists once something needs it.
    const draft = await as(ctx, finance)
      .post('/v1/admin/ledger/journals', accrual(`${month.slice(0, 8)}10`, '100.00'))
      .expect(201);
    const target = (
      await ctx.prisma.journalEntry.findUniqueOrThrow({
        where: { publicId: draft.body.id as string },
        include: { fiscalPeriod: true },
      })
    ).fiscalPeriod;
    await post(finance, `/v1/admin/ledger/periods/${target.publicId}/actions/soft-close`).expect(403);
    await as(ctx, manager)
      .post(`/v1/admin/ledger/periods/${target.publicId}/actions/soft-close`, { reason: 'ทดสอบ' })
      .expect(200);
    await as(ctx, manager).post(`/v1/admin/ledger/periods/${target.publicId}/actions/close`, {}).expect(409);
    const submitted = await post(finance, `/v1/admin/ledger/journals/${draft.body.id}/actions/submit`).expect(
      200,
    );
    await approve(submitted.body.approvalRequestId as string);
    const posted = await journal(draft.body.id as string);
    expect(posted).toMatchObject({
      status: 'posted',
      documentDate: `${month.slice(0, 8)}10`,
      entryDate: addMonths(month, 1),
    });
    await as(ctx, manager)
      .post(`/v1/admin/ledger/periods/${target.publicId}/actions/reopen`, { reason: 'ทดสอบเสร็จ' })
      .expect(200);
  });

  it('turns a real loyalty event into a rule-driven journal (P10A) with drill-down to the event', async () => {
    const { token } = await customerToken(ctx, 1);
    const me = await as(ctx, token).get('/v1/store/me').expect(200);
    const cs = await staffToken(ctx, 'cs_lead');
    await post(cs, `/v1/admin/customers/${me.body.id}/loyalty/adjustments`, {
      points: 40,
      reason: 'ชดเชยงานล่าช้า',
    }).expect(201);
    await ctx.pump();
    const list = await as(ctx, auditor)
      .get('/v1/admin/ledger/journals?sourceType=points_entry&perPage=100')
      .expect(200);
    const entry = (list.body.data as Journal[]).find((j) => j.postingRule === 'P10A')!;
    expect(entry).toMatchObject({ kind: 'auto', status: 'posted' });
    expect(entry.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['6120', '100.00', '0.00'],
      ['2330', '0.00', '100.00'],
    ]);
    const byEvent = await as(ctx, auditor)
      .get(
        `/v1/admin/ledger/journals?domainEventId=${((await journal(entry.id)) as unknown as { domainEventId: string }).domainEventId}`,
      )
      .expect(200);
    expect(byEvent.body.meta.total).toBe(1);
  });

  it('keeps posting rules as data: preview, refused and approved versions', async () => {
    const rules = (await as(ctx, auditor).get('/v1/admin/ledger/posting-rules').expect(200)).body as {
      key: string;
    }[];
    expect(rules.map((r) => r.key)).toEqual(expect.arrayContaining(['P01', 'P15', 'P30']));
    const preview = await as(ctx, finance)
      .post('/v1/admin/ledger/posting-rules/P01/actions/preview', {
        payload: {
          docType: 'tr',
          docKind: 'instalment',
          receiptVia: 'scb',
          docNumber: 'TR-1',
          grossAmount: '1070.00',
          netAmount: '1000.00',
          vatAmount: '70.00',
        },
      })
      .expect(200);
    expect(preview.body).toMatchObject({ applies: true, balanced: true, totalDebit: '1070.00' });
    const bad = await as(ctx, finance)
      .post('/v1/admin/ledger/posting-rules/P21/versions', {
        effectiveFrom: new Date(Date.now() + 3_600_000).toISOString(),
        template: {
          description: 'x',
          lines: [
            { account: '9999', side: 'debit', amount: 'amount' },
            { account: '5190', side: 'credit', amount: 'amount' },
          ],
        },
        reason: 'ทดสอบบัญชีที่ไม่มี',
      })
      .expect(422);
    expect(bad.body.code).toBe('ledger.rule_invalid');
    const proposed = await as(ctx, finance)
      .post('/v1/admin/ledger/posting-rules/P21/versions', {
        effectiveFrom: new Date(Date.now() + 3_600_000).toISOString(),
        template: {
          description: 'เรียกเก็บขนส่ง {claimNo}',
          documentDate: 'recordedOn',
          lines: [
            { account: '1270', side: 'debit', amount: 'amount' },
            { account: '5190', side: 'credit', amount: 'amount' },
          ],
        },
        reason: 'ปรับคำอธิบายรายการ',
      })
      .expect(201);
    const version = (
      proposed.body.versions as { versionNo: number; status: string; approvalRequestId: string }[]
    )[0]!;
    expect(version).toMatchObject({ versionNo: 2, status: 'proposed' });
    await as(ctx, finance)
      .post('/v1/admin/ledger/posting-rules/P21/versions', {
        effectiveFrom: new Date(Date.now() + 3_600_000).toISOString(),
        template: { description: 'x', lines: [] },
        reason: 'ซ้ำ',
      })
      .expect(409);
    await approve(version.approvalRequestId);
    const after = (await as(ctx, auditor).get('/v1/admin/ledger/posting-rules/P21').expect(200)).body as {
      versions: { versionNo: number; status: string }[];
    };
    expect(after.versions[0]).toMatchObject({ versionNo: 2, status: 'approved' });
  });

  it('changes the chart of accounts and tax rates only through approval', async () => {
    const code = `9${String(ctx.run).slice(-3)}`;
    const change = await as(ctx, finance)
      .post('/v1/admin/ledger/account-changes', {
        kind: 'create',
        fields: {
          code,
          nameTh: 'บัญชีทดสอบ',
          nameEn: 'Test account (fake)',
          accountType: 'expense',
          normalSide: 'debit',
          parentCode: '6000',
          cashFlowClass: 'operating',
          allowedDimensions: ['cost_centre'],
        },
        reason: 'ทดสอบการเพิ่มบัญชี',
      })
      .expect(201);
    const accounts = async () =>
      (await as(ctx, auditor).get('/v1/admin/ledger/accounts').expect(200)).body as { code: string }[];
    expect((await accounts()).some((a) => a.code === code)).toBe(false);
    await approve(change.body.approvalRequestId as string);
    const account = (await accounts()).find((a) => a.code === code);
    expect(account).toMatchObject({ status: 'active', parentCode: '6000' });
    const deactivate = await as(ctx, finance)
      .post('/v1/admin/ledger/account-changes', { kind: 'deactivate', accountCode: '6900', reason: 'ทดสอบ' })
      .expect(422);
    expect(deactivate.body.code).toBe('ledger.account_invalid');

    const rate = await as(ctx, finance)
      .post('/v1/admin/tax/rates/wht_transport/versions', {
        ratePct: '1',
        effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
        reason: 'ยืนยันอัตราโดยผู้สอบบัญชี',
      })
      .expect(201);
    expect(rate.body.versions[0]).toMatchObject({ versionNo: 2, status: 'proposed' });
    const request = await ctx.prisma.approvalRequest.findFirstOrThrow({
      where: { subjectType: 'tax_rate_version', status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    await approve(request.publicId);
    const rates = (await as(ctx, auditor).get('/v1/admin/tax/rates').expect(200)).body as {
      code: string;
      versions: { status: string }[];
    }[];
    expect(rates.find((r) => r.code === 'wht_transport')!.versions[0]!.status).toBe('approved');
  });

  it('runs an approved recurring journal on its day, auto-reversed next month', async () => {
    const created = await as(ctx, finance)
      .post('/v1/admin/ledger/recurring-journals', {
        name: 'ค่าเช่าสำนักงาน (fake)',
        description: 'ตั้งค้างจ่ายรายเดือน',
        dayOfMonth: 28,
        startOn: today,
        autoReverse: true,
        lines: [
          { accountCode: '6900', side: 'debit', amount: '1000.00' },
          { accountCode: '2410', side: 'credit', amount: '1000.00' },
        ],
      })
      .expect(201);
    expect(created.body.status).toBe('pending_approval');
    await approve(created.body.approvalRequestId as string);
    const runOn = created.body.nextRunOn as string;
    expect(
      await ctx.app.get(RecurringJournalsService).runDue(new Date(`${runOn}T05:00:00Z`)),
    ).toBeGreaterThanOrEqual(1);
    const entry = await ctx.prisma.journalEntry.findFirstOrThrow({
      where: { recurringJournal: { publicId: created.body.id as string } },
    });
    expect(entry).toMatchObject({ kind: 'recurring', status: 'posted' });
    expect(entry.autoReverseOn?.toISOString().slice(0, 10)).toBe(addMonths(runOn, 1));
    const list = (await as(ctx, auditor).get('/v1/admin/ledger/recurring-journals').expect(200)).body as {
      id: string;
      nextRunOn: string;
    }[];
    expect(list.find((r) => r.id === created.body.id)!.nextRunOn > runOn).toBe(true);
  });

  it('lets the auditor read the ledger but change nothing', async () => {
    await as(ctx, auditor).get('/v1/admin/ledger/journals').expect(200);
    await as(ctx, auditor).get('/v1/admin/ledger/accounts').expect(200);
    await as(ctx, auditor).post('/v1/admin/ledger/journals', accrual(today)).expect(403);
    await as(ctx, auditor)
      .post('/v1/admin/ledger/account-changes', { kind: 'deactivate', accountCode: '6900', reason: 'x' })
      .expect(403);
    const cs = await staffToken(ctx, 'cs');
    await as(ctx, cs).get('/v1/admin/ledger/journals').expect(403);
  });
});
