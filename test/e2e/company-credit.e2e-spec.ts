import { randomUUID } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { addCalendarDays, bangkokDate, startOfBangkokDay } from '@common/time/bangkok';
import { CreditService } from '@modules/companies/credit.service';
import { PaymentSchedulesService } from '@modules/payment-schedules/payment-schedules.service';
import { envelopeFromRow } from '@platform/domain-events/domain-event';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  activeCompany,
  addAddress,
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  saveQuote,
  seedShipping,
  staffToken,
} from '../support/commerce-e2e';

const DAY = 86_400_000;

/** B2B credit: eligibility, limit approval, credit orders on the company term, reminders, overdue block (B3.5 slice 4). */
describe('company credit (e2e, B3.5)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let credit: CreditService;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    credit = ctx.app.get(CreditService);
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  async function companyOrder(token: string, companyId: string) {
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
    const preview = await as(ctx, token)
      .post('/v1/store/checkout/actions/preview', { companyId })
      .expect(200);
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', { companyId })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    return {
      preview: preview.body as { notices: { code: string; params?: Record<string, unknown> }[] },
      group: placed.body as { id: string },
    };
  }

  async function payAll(groupPublicId: string) {
    const schedules = ctx.app.get(PaymentSchedulesService);
    await ctx.prisma.withTx(async (tx) => {
      const group = await tx.orderGroup.findUniqueOrThrow({ where: { publicId: groupPublicId } });
      const cash = group.cashAmount.toFixed(2);
      const payment = await tx.payment.create({
        data: {
          entityId: group.entityId,
          orderGroupId: group.id,
          method: 'bank_transfer_slip',
          provider: 'slip',
          status: 'succeeded',
          referenceCode: `E2E${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`,
          amount: cash,
          cashAmount: cash,
          paidAt: new Date(),
        },
      });
      await schedules.applyPayment(tx, group.id, payment.id, cash, systemActor('e2e'));
    });
  }

  const templateOf = async (groupPublicId: string) =>
    await ctx.prisma.paymentSchedule.findFirstOrThrow({
      where: { orderGroup: { publicId: groupPublicId } },
      include: { templateVersion: { include: { template: true } }, instalments: true },
    });

  it('becomes eligible after paid orders, gets a limit approved below the threshold, orders on credit and is blocked when overdue', async () => {
    const admin = await customerToken(ctx, 1);
    const companyId = await activeCompany(ctx, admin.token, 1);
    await ctx.prisma.company.update({ where: { publicId: companyId }, data: { paidOrdersCount: 2 } });

    // A prepaid order paid in full → the third paid order makes the company eligible (D-121).
    const first = await companyOrder(admin.token, companyId);
    expect((await templateOf(first.group.id)).templateVersion.template.key).not.toBe('credit_term');
    await payAll(first.group.id);
    const order = await ctx.prisma.order.findFirstOrThrow({
      where: { orderGroup: { publicId: first.group.id } },
    });
    const fact = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'order.fact_recorded', aggregateId: order.publicId },
    });
    await ctx.prisma.withTx((tx) => credit.onFact(envelopeFromRow(fact), tx));
    const eligible = await ctx.prisma.company.findUniqueOrThrow({ where: { publicId: companyId } });
    expect(eligible).toMatchObject({ creditStatus: 'eligible', paidOrdersCount: 3 });

    // CS Lead requests THB 50,000 / 30 days; at or below the ฿100,000 threshold it is approved at creation (D-121, D-451).
    const csLead = await staffToken(ctx, 'cs-lead');
    await as(ctx, csLead)
      .post(`/v1/admin/companies/${companyId}/credit-limits`, {
        limitAmount: '50000.00',
        termDays: 200,
        basis: 'paid_orders',
        reason: 'ทดสอบ',
      })
      .expect(422);
    const limitKey = randomUUID();
    const limitBody = {
      limitAmount: '50000.00',
      termDays: 30,
      basis: 'paid_orders',
      reason: 'ชำระตรงเวลา 3 ครั้ง',
    };
    const requested = await as(ctx, csLead)
      .post(`/v1/admin/companies/${companyId}/credit-limits`, limitBody)
      .set('Idempotency-Key', limitKey)
      .expect(201);
    expect(requested.body).toMatchObject({
      creditStatus: 'eligible',
      limitAmount: null,
      pendingRequest: { limitAmount: '50000.00', termDays: 30, versionNo: 1, approvalId: expect.any(String) },
      eligibility: { eligible: true, reason: 'paid_orders' },
      versions: [
        expect.objectContaining({ versionNo: 1, status: 'proposed', basis: 'paid_orders', decidedAt: null }),
      ],
    });
    // The same key replays the response instead of a second request (U-B0.2).
    const replayed = await as(ctx, csLead)
      .post(`/v1/admin/companies/${companyId}/credit-limits`, limitBody)
      .set('Idempotency-Key', limitKey)
      .expect(201);
    expect(replayed.body.pendingRequest.approvalId).toBe(requested.body.pendingRequest.approvalId);
    await as(ctx, csLead)
      .post(`/v1/admin/companies/${companyId}/credit-limits`, {
        limitAmount: '60000.00',
        basis: 'paid_orders',
        reason: 'ซ้ำ',
      })
      .expect(409);
    const version = await ctx.prisma.companyCreditLimitVersion.findFirstOrThrow({
      where: { creditLimit: { company: { publicId: companyId } }, status: 'proposed' },
      include: { approvalRequest: true },
    });
    expect(version.approvalRequest).toMatchObject({
      status: 'approved',
      autoApprovedReason: 'below_threshold',
    });
    // Nothing is left for Finance to decide.
    const finance = await staffToken(ctx, 'finance');
    await as(ctx, finance)
      .post(`/v1/admin/approvals/${version.approvalRequest!.publicId}/actions/approve`, {
        comment: 'ตรวจแล้ว',
      })
      .expect(409);
    const outcome = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'approval.approved', aggregateId: version.approvalRequest!.publicId },
    });
    await ctx.prisma.withTx((tx) => credit.onApprovalOutcome(envelopeFromRow(outcome), tx));
    const staffCredit = await as(ctx, csLead).get(`/v1/admin/companies/${companyId}/credit`).expect(200);
    expect(staffCredit.body).toMatchObject({
      creditStatus: 'credit',
      pendingRequest: null,
      versions: [
        expect.objectContaining({
          versionNo: 1,
          status: 'approved',
          approvalId: requested.body.pendingRequest.approvalId,
          requestedBy: expect.objectContaining({ id: expect.any(String) }),
          decidedAt: expect.any(String),
        }),
      ],
    });
    const view = await as(ctx, admin.token).get(`/v1/store/companies/${companyId}/credit`).expect(200);
    expect(view.body).toMatchObject({
      creditStatus: 'credit',
      limitAmount: '50000.00',
      termDays: 30,
      exposureAmount: '0.00',
      availableAmount: '50000.00',
    });

    // A credit order: the credit-term schedule, due 30 days after delivery; exposure grows.
    const onCredit = await companyOrder(admin.token, companyId);
    expect(onCredit.preview.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'company.credit_order',
          params: expect.objectContaining({ termDays: 30 }),
        }),
      ]),
    );
    const schedule = await templateOf(onCredit.group.id);
    expect(schedule.templateVersion.template.key).toBe('credit_term');
    expect(schedule.instalments[0]).toMatchObject({
      dueTrigger: 'days_after_delivery',
      dueOffsetDays: 30,
      requiredBefore: 'none',
    });
    const after = await as(ctx, admin.token).get(`/v1/store/companies/${companyId}/credit`).expect(200);
    expect(after.body.exposureAmount).toBe(schedule.instalments[0]!.cashAmount.toFixed(2));

    // Reminder 7 days before the due date, once (D-122).
    const instalment = schedule.instalments[0]!;
    await ctx.prisma.instalment.update({
      where: { id: instalment.id },
      // Noon of the Bangkok day 7 days ahead: the reminder window is that calendar day, whatever the time now.
      data: {
        dueAt: new Date(
          startOfBangkokDay(addCalendarDays(bangkokDate(new Date()), 7)).getTime() + 12 * 3_600_000,
        ),
        status: 'due',
      },
    });
    await credit.runDunning();
    await credit.runDunning();
    expect(
      await ctx.prisma.domainEvent.count({
        where: { type: 'company.credit_due_soon', aggregateId: companyId },
      }),
    ).toBe(1);

    // More than 7 days overdue → credit orders blocked, prepaid still allowed; paying releases it.
    await ctx.prisma.instalment.update({
      where: { id: instalment.id },
      data: { dueAt: new Date(Date.now() - 10 * DAY), status: 'overdue' },
    });
    const dunning = await credit.runDunning();
    expect(dunning.blocked).toBeGreaterThanOrEqual(1);
    expect(
      (await ctx.prisma.company.findUniqueOrThrow({ where: { publicId: companyId } })).creditStatus,
    ).toBe('blocked_overdue');
    const owing = await as(ctx, csLead).get(`/v1/admin/companies/${companyId}/receivables`).expect(200);
    expect(owing.body).toMatchObject({ creditOrdersBlocked: true });
    const row = await as(ctx, csLead).get(`/v1/admin/companies/${companyId}`).expect(200);
    expect(row.body.receivables).toMatchObject({
      creditOrdersBlocked: true,
      oldestOverdueDays: expect.any(Number),
    });
    const blockedList = await as(ctx, csLead)
      .get('/v1/admin/companies?creditStatus=blocked_overdue')
      .expect(200);
    expect((blockedList.body.data as { id: string }[]).map((c) => c.id)).toContain(companyId);
    const blockedOrder = await companyOrder(admin.token, companyId);
    expect(blockedOrder.preview.notices).toEqual(
      expect.arrayContaining([{ code: 'company.credit_unavailable', params: { reason: 'blocked_overdue' } }]),
    );
    expect((await templateOf(blockedOrder.group.id)).templateVersion.template.key).not.toBe('credit_term');
    await ctx.prisma.instalment.update({
      where: { id: instalment.id },
      data: { status: 'paid', paidAmount: instalment.cashAmount, paidAt: new Date() },
    });
    await credit.runDunning();
    expect(
      (await ctx.prisma.company.findUniqueOrThrow({ where: { publicId: companyId } })).creditStatus,
    ).toBe('credit');

    // Monthly statement data for this month (D-125).
    const month = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
    const statement = await as(ctx, admin.token)
      .get(`/v1/store/companies/${companyId}/statement?month=${month}`)
      .expect(200);
    expect((statement.body.lines as { groupId: string }[]).map((l) => l.groupId)).toEqual(
      expect.arrayContaining([first.group.id, onCredit.group.id, blockedOrder.group.id]),
    );
    await as(ctx, admin.token).get(`/v1/store/companies/${companyId}/statement?month=2026-13`).expect(422);
    // Staff see the issued statements; a month not issued has no PDF (U-B0.2).
    await as(ctx, csLead)
      .get(`/v1/admin/companies/${companyId}/issued-statements`)
      .expect(200)
      .expect((r) => expect(Array.isArray(r.body)).toBe(true));
    await as(ctx, finance).get(`/v1/admin/companies/${companyId}/statements/2020-01/pdf`).expect(404);
  });

  it('D-462: a temporary limit with a custom term, the summary every buyer sees, and the fall-back when it ends', async () => {
    const admin = await customerToken(ctx, 2);
    const companyId = await activeCompany(ctx, admin.token, 2);
    await ctx.prisma.company.update({
      where: { publicId: companyId },
      data: { paidOrdersCount: 3, creditStatus: 'eligible' },
    });
    const csLead = await staffToken(ctx, 'cs-lead');
    const approve = async () => {
      const version = await ctx.prisma.companyCreditLimitVersion.findFirstOrThrow({
        where: { creditLimit: { company: { publicId: companyId } }, status: 'proposed' },
        include: { approvalRequest: true },
      });
      const outcome = await ctx.prisma.domainEvent.findFirstOrThrow({
        where: { type: 'approval.approved', aggregateId: version.approvalRequest!.publicId },
      });
      await ctx.prisma.withTx((tx) => credit.onApprovalOutcome(envelopeFromRow(outcome), tx));
      return version;
    };

    // A permanent THB 20,000 / 30 days first.
    await as(ctx, csLead)
      .post(`/v1/admin/companies/${companyId}/credit-limits`, {
        limitAmount: '20000.00',
        termDays: 30,
        basis: 'paid_orders',
        reason: 'วงเงินถาวร',
      })
      .expect(201);
    await approve();

    // The customer may not pick a custom term; staff may, within b2b.credit_custom_terms.
    await as(ctx, admin.token)
      .post(`/v1/store/companies/${companyId}/credit-applications`, {
        limitAmount: '30000.00',
        termDays: 90,
        basis: 'paid_orders',
        note: 'ขอเทอมยาว',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(422);
    await as(ctx, csLead)
      .post(`/v1/admin/companies/${companyId}/credit-limits`, {
        limitAmount: '80000.00',
        termDays: 90,
        validUntil: new Date(Date.now() + 400 * DAY).toISOString(),
        basis: 'paid_orders',
        reason: 'เกินกำหนด',
      })
      .expect(422);
    const until = new Date(Date.now() + 30 * DAY);
    const temporary = await as(ctx, csLead)
      .post(`/v1/admin/companies/${companyId}/credit-limits`, {
        limitAmount: '80000.00',
        termDays: 90,
        validUntil: until.toISOString(),
        basis: 'paid_orders',
        reason: 'ยอดสั่งช่วงเทศกาล',
      })
      .expect(201);
    expect(temporary.body.versions[0]).toMatchObject({ customTerm: true, validUntil: expect.any(String) });
    const tempVersion = await approve();
    expect(tempVersion.approvalRequest!.payloadSnapshot).toMatchObject({ customTerm: true });

    const during = await as(ctx, admin.token).get(`/v1/store/companies/${companyId}/credit`).expect(200);
    expect(during.body).toMatchObject({
      limitAmount: '80000.00',
      termDays: 90,
      validUntil: expect.any(String),
      fallbackLimitAmount: '20000.00',
      fallbackTermDays: 30,
    });

    // A buyer sees what is available, the term and the end date — not the limit or statements.
    const buyer = await customerToken(ctx, 3);
    await as(ctx, admin.token)
      .post(`/v1/store/companies/${companyId}/members`, {
        phone: buyer.phone,
        roles: ['company_buyer'],
      })
      .expect(201);
    const invitations = await as(ctx, buyer.token).get('/v1/store/company-invitations').expect(200);
    const invitation = (invitations.body as { id: string; companyId: string }[]).find(
      (x) => x.companyId === companyId,
    )!;
    await as(ctx, buyer.token)
      .post(`/v1/store/company-invitations/${invitation.id}/actions/accept`)
      .expect(200);
    const summary = await as(ctx, buyer.token)
      .get(`/v1/store/companies/${companyId}/credit/summary`)
      .expect(200);
    expect(summary.body).toEqual({
      creditStatus: 'credit',
      availableAmount: '80000.00',
      termDays: 90,
      validUntil: expect.any(String),
      currency: 'THB',
    });
    expect(Object.keys(summary.body)).not.toContain('limitAmount');
    await as(ctx, buyer.token).get(`/v1/store/companies/${companyId}/credit`).expect(403);

    // When the temporary limit ends, the permanent one applies again.
    const company = await ctx.prisma.company.findUniqueOrThrow({ where: { publicId: companyId } });
    const after = await credit.currentLimit(ctx.prisma, company.id, new Date(until.getTime() + DAY));
    expect(after).toMatchObject({ termDays: 30, validUntil: null });
    expect(after!.limitAmount.toFixed(2)).toBe('20000.00');
  });
});
