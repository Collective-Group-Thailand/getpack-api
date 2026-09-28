import { randomUUID } from 'node:crypto';

import { bangkokDate } from '@common/time/bangkok';
import { PasswordService } from '@modules/auth/password.service';
import { dayOf } from '@modules/ledger/ledger-dates';
import { PeriodsService } from '@modules/ledger/periods.service';
import request from 'supertest';

import { as, staffToken } from '../support/commerce-e2e';
import { E2E_DEV_PASSWORD } from '../support/e2e';
import { companyAccount } from '../support/finance-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

interface Task {
  key: string;
  status: string;
  checkResult: { passed: boolean; summary: string } | null;
}
interface Checklist {
  status: string;
  periodStatus: string;
  tasks: Task[];
}

/**
 * B5.6 period close (§7) and financial reports: the checklist of the first month blocks on an unmatched bank
 * line until it is explained, needs the tax papers final and the sub-ledgers equal to the GL; submitting
 * soft-closes the month, the submitter cannot approve (§8), the ledger's own close is gated, another Finance
 * Manager closes it, it is locked and a late journal lands in the next open month. The trial balance, balance
 * sheet and cash flow agree with themselves; GL detail drills down to the journal and its source.
 */
describe('period close & financial reports (e2e, B5.6)', () => {
  let ctx: FulfilmentApp;
  let finance: string;
  let manager: string;
  let manager2: string;
  let auditor: string;
  let month: string;
  let periodId: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    [finance, manager, auditor] = await Promise.all([
      staffToken(ctx, 'finance'),
      staffToken(ctx, 'finance_manager'),
      staffToken(ctx, 'auditor'),
    ]);
    manager2 = await secondManager();
    const entity = await ctx.prisma.entity.findFirstOrThrow({ where: { isDefault: true } });
    // Make sure the fiscal year of today exists, then take the entity's first month (nothing before it).
    await ctx.app.get(PeriodsService).periodOf(entity.id, bangkokDate(new Date()));
    const first = await ctx.prisma.fiscalPeriod.findFirstOrThrow({
      where: { entityId: entity.id },
      orderBy: { startDate: 'asc' },
    });
    month = dayOf(first.startDate).slice(0, 7);
    periodId = first.publicId;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  /** A second Finance Manager (the reviewer must not be the submitter). */
  async function secondManager(): Promise<string> {
    const role = await ctx.prisma.role.findUniqueOrThrow({ where: { key: 'finance_manager' } });
    const email = `fm2-${ctx.run}@staff.invalid`;
    await ctx.prisma.user.create({
      data: {
        kind: 'staff',
        status: 'active',
        email,
        displayName: 'Finance Manager 2 (fake)',
        passwordHash: await new PasswordService().hash(E2E_DEV_PASSWORD),
        roles: { create: { roleId: role.id, scopeType: 'platform', reason: 'e2e (fake)' } },
      },
    });
    const login = await request(ctx.server)
      .post('/v1/auth/staff/login')
      .send({ email, password: E2E_DEV_PASSWORD })
      .expect(200);
    return login.body.accessToken as string;
  }

  const post = (token: string, path: string, body: object = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
  const task = (c: Checklist, key: string) => c.tasks.find((t) => t.key === key)!;
  const base = () => `/v1/admin/close-checklists/${month}`;

  it('blocks the close on its checks, waives only with a reason, and completes the reviewed steps', async () => {
    const opened = (await post(finance, base()).expect(201)).body as Checklist;
    expect(opened.tasks.map((t) => t.key)).toEqual([
      'statements_imported',
      'slips_and_unidentified',
      'deliveries_received',
      'receivables_reviewed',
      'rollforwards_reviewed',
      'accruals_recorded',
      'tax_papers_reconciled',
      'subledgers_reconciled',
      'review',
    ]);
    await post(auditor, `${base()}/tasks/receivables_reviewed/actions/complete`, { note: 'x' }).expect(403);

    // Step 1: a statement line of the month not matched blocks the task until it is explained.
    const bank = await companyAccount(ctx);
    const end = dayOf(
      (await ctx.prisma.fiscalPeriod.findUniqueOrThrow({ where: { publicId: periodId } })).endDate,
    );
    await post(finance, '/v1/admin/bank-statements', {
      companyBankAccountId: bank.id,
      rows: [{ txnDate: end, amount: '-1.23', description: `CHARGE ${ctx.run}` }],
    }).expect(201);
    const blocked = (await post(finance, `${base()}/tasks/statements_imported/actions/check`).expect(200))
      .body as Checklist;
    expect(task(blocked, 'statements_imported')).toMatchObject({
      status: 'blocked',
      checkResult: { passed: false },
    });
    expect(
      (await post(finance, `${base()}/tasks/statements_imported/actions/complete`, { note: 'x' }).expect(409))
        .body.code,
    ).toBe('close.check_failed');
    const line = (
      (
        await as(ctx, finance)
          .get(
            `/v1/admin/bank-statement-lines?companyBankAccountId=${bank.id}&matchStatus=unmatched&perPage=100`,
          )
          .expect(200)
      ).body.data as { id: string; amount: string }[]
    ).find((l) => l.amount === '-1.23')!;
    await post(finance, `/v1/admin/bank-statement-lines/${line.id}/actions/ignore`, {
      reason: 'ค่าธรรมเนียมบันทึกด้วยสมุดรายวันแล้ว (fake)',
    }).expect(200);
    await post(finance, `${base()}/tasks/statements_imported/actions/complete`, {
      note: 'กระทบยอดแล้ว',
    }).expect(200);

    // Evidence and owners.
    const me = await ctx.prisma.user.findFirstOrThrow({
      where: { roles: { some: { role: { key: 'finance' } } } },
    });
    await post(finance, `${base()}/tasks/receivables_reviewed/actions/assign`, {
      ownerUserId: me.publicId,
    }).expect(200);

    for (const key of [
      'slips_and_unidentified',
      'deliveries_received',
      'receivables_reviewed',
      'rollforwards_reviewed',
      'accruals_recorded',
    ])
      await post(finance, `${base()}/tasks/${key}/actions/complete`, { note: 'ตรวจแล้ว (fake)' }).expect(200);

    // Step 7: the month's tax papers must be final (difference 0).
    expect(
      (await post(finance, `${base()}/tasks/tax_papers_reconciled/actions/complete`, {}).expect(409)).body
        .code,
    ).toBe('close.check_failed');
    for (const kind of ['sales_tax', 'purchase_tax', 'pp30', 'pnd3', 'pnd53']) {
      const report = (await post(finance, '/v1/admin/tax-reports', { kind, period: month }).expect(201))
        .body as { id: string; glDifference: string };
      expect(report.glDifference).toBe('0.00');
      await post(finance, `/v1/admin/tax-reports/${report.id}/actions/finalise`).expect(200);
    }
    await post(finance, `${base()}/tasks/tax_papers_reconciled/actions/complete`, {}).expect(200);

    // Step 8: every sub-ledger equals its GL control account.
    const checked = (await post(finance, `${base()}/tasks/subledgers_reconciled/actions/check`).expect(200))
      .body as Checklist;
    expect(task(checked, 'subledgers_reconciled').checkResult).toMatchObject({ passed: true });
    await post(finance, `${base()}/tasks/subledgers_reconciled/actions/complete`, {
      note: 'ผลต่างเป็นศูนย์',
    }).expect(200);

    // Waiving needs a Finance Manager and a reason; the review is never "completed" by hand.
    await post(finance, `${base()}/tasks/review/actions/waive`, { reason: 'ไม่ได้' }).expect(403);
    expect(
      (await post(manager, `${base()}/tasks/review/actions/waive`, { reason: 'ไม่ได้ (fake)' }).expect(422))
        .body.code,
    ).toBe('close.review_by_approval');
  });

  it('soft-closes on submit, refuses the submitter as approver and the ledger’s own close, then closes and locks (§7 step 9, §8)', async () => {
    const submitted = (await post(manager, `${base()}/actions/submit`).expect(200)).body as Checklist;
    expect(submitted).toMatchObject({ status: 'in_review', periodStatus: 'soft_closed' });
    expect((await post(manager, `${base()}/actions/approve`, { note: 'ตัวเอง' }).expect(409)).body.code).toBe(
      'iam.sod_conflict',
    );
    expect(
      (await as(ctx, manager).post(`/v1/admin/ledger/periods/${periodId}/actions/close`, {}).expect(409)).body
        .code,
    ).toBe('close.checklist_incomplete');
    // Sent back: the month reopens; submitted again by Finance and approved by a Finance Manager.
    const back = (
      await post(manager, `${base()}/actions/return`, { reason: 'ส่งใหม่โดยผู้จัดทำ' }).expect(200)
    ).body as Checklist;
    expect(back).toMatchObject({ status: 'open', periodStatus: 'open' });
    await post(finance, `${base()}/actions/submit`).expect(200);
    await post(finance, `${base()}/actions/approve`, {}).expect(403);
    const closed = (await post(manager2, `${base()}/actions/approve`, { note: 'ตรวจทานแล้ว' }).expect(200))
      .body as Checklist;
    expect(closed).toMatchObject({ status: 'closed', periodStatus: 'closed' });
    expect(task(closed, 'review').status).toBe('done');

    await post(auditor, `${base()}/actions/sign-off`).expect(200);
    const locked = (await post(manager, `${base()}/actions/lock`).expect(200)).body as Checklist;
    expect(locked).toMatchObject({ status: 'locked', periodStatus: 'locked' });
    await as(ctx, manager)
      .post(`/v1/admin/ledger/periods/${periodId}/actions/reopen`, { reason: 'x' })
      .expect(409);

    // A journal dated in the locked month posts to the next open month with its own date (§1.4).
    const draft = (
      await as(ctx, finance)
        .post('/v1/admin/ledger/journals', {
          documentDate: `${month}-15`,
          description: 'ปรับปรุงย้อนหลัง (fake)',
          lines: [
            { accountCode: '6900', side: 'debit', amount: '1.00' },
            { accountCode: '2410', side: 'credit', amount: '1.00' },
          ],
        })
        .expect(201)
    ).body as { id: string };
    const submittedJv = (
      await post(finance, `/v1/admin/ledger/journals/${draft.id}/actions/submit`).expect(200)
    ).body as { approvalRequestId: string };
    await post(manager, `/v1/admin/approvals/${submittedJv.approvalRequestId}/actions/approve`, {
      comment: 'ok',
    }).expect(200);
    await ctx.pump();
    const posted = await ctx.prisma.journalEntry.findUniqueOrThrow({
      where: { publicId: draft.id },
      include: { fiscalPeriod: true },
    });
    expect(dayOf(posted.documentDate)).toBe(`${month}-15`);
    expect(posted.fiscalPeriod.publicId).not.toBe(periodId);
  });

  it('reports a balanced ledger: trial balance, balance sheet, cash flow, P&L by dimension and GL detail with drill-down', async () => {
    const today = bangkokDate(new Date());
    const to = today.slice(0, 7);
    const tb = (
      await as(ctx, auditor)
        .get(`/v1/admin/financial-reports/trial-balance?from=${month}&to=${to}`)
        .expect(200)
    ).body as { balanced: boolean; accounts: unknown[] };
    expect(tb.balanced).toBe(true);
    const bs = (
      await as(ctx, auditor).get(`/v1/admin/financial-reports/balance-sheet?asOf=${today}`).expect(200)
    ).body as { difference: string };
    expect(bs.difference).toBe('0.00');
    const cf = (
      await as(ctx, auditor).get(`/v1/admin/financial-reports/cash-flow?from=${month}&to=${to}`).expect(200)
    ).body as { difference: string };
    expect(cf.difference).toBe('0.00');
    const pl = (
      await as(ctx, auditor)
        .get(`/v1/admin/financial-reports/profit-and-loss?from=${month}&to=${to}&dimension=product_type`)
        .expect(200)
    ).body as { lines: { dimension: string }[]; totals: { netProfit: string } };
    expect(Array.isArray(pl.lines)).toBe(true);
    const gl = (
      await as(ctx, auditor)
        .get(`/v1/admin/financial-reports/gl-detail?accountCode=2410&from=${month}&to=${to}`)
        .expect(200)
    ).body as { lines: { journalEntryId: string; balance: string }[]; closing: string };
    expect(gl.lines.length).toBeGreaterThan(0);
    await as(ctx, auditor).get(`/v1/admin/ledger/journals/${gl.lines[0]!.journalEntryId}`).expect(200);
    expect(gl.lines.at(-1)!.balance).toBe(gl.closing);
    await as(ctx, auditor)
      .get('/v1/admin/financial-reports/trial-balance?from=2026-10&to=2026-01')
      .expect(422);
    await as(ctx, await staffToken(ctx, 'cs'))
      .get(`/v1/admin/financial-reports/trial-balance?from=${month}&to=${to}`)
      .expect(403);
  });
});
