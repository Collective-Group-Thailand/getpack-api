import { randomUUID } from 'node:crypto';

import { CompanyCheckout } from '@modules/companies/company-checkout.extension';
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
  setFlag,
} from '../support/commerce-e2e';

/** Ordering for a company: branch invoice, PO rule, approval above the company threshold (B3.5 slice 3, D-123, D-125). */
describe('company orders (e2e, B3.5)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let checkoutExt: CompanyCheckout;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    await setFlag(ctx, 'payments.scb', true);
    checkoutExt = ctx.app.get(CompanyCheckout);
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  async function cart(token: string) {
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
  }

  const place = (token: string, body: Record<string, unknown>) =>
    as(ctx, token).post('/v1/store/checkout', body).set('Idempotency-Key', randomUUID());

  async function decide(approver: string, companyId: string, decision: 'approve' | 'reject') {
    const pending = await as(ctx, approver).get(`/v1/store/companies/${companyId}/approvals`).expect(200);
    const approval = (pending.body as { id: string }[])[0]!;
    await as(ctx, approver)
      .post(`/v1/store/companies/${companyId}/approvals/${approval.id}/actions/${decision}`, {
        comment: 'ตรวจแล้ว',
      })
      .expect(200);
    const outcome = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: {
        type: decision === 'approve' ? 'approval.approved' : 'approval.rejected',
        aggregateId: approval.id,
      },
    });
    await ctx.prisma.withTx((tx) => checkoutExt.onApprovalOutcome(envelopeFromRow(outcome), tx));
  }

  it('invoices the company branch, requires a PO, and holds orders above the threshold for the approver', async () => {
    const admin = await customerToken(ctx, 1);
    const buyer = await customerToken(ctx, 2);
    const approver = await customerToken(ctx, 3);
    const outsider = await customerToken(ctx, 4);
    const companyId = await activeCompany(
      ctx,
      admin.token,
      1,
      [
        { ...buyer, roles: ['company_buyer'] },
        { ...approver, roles: ['company_approver'] },
      ],
      { poNumberPolicy: 'required', orderApprovalThreshold: '100.00' },
    );

    await cart(outsider.token);
    await place(outsider.token, { companyId, poNumber: 'PO-1' }).expect(404);

    await cart(buyer.token);
    const preview = await as(ctx, buyer.token)
      .post('/v1/store/checkout/actions/preview', { companyId, poNumber: 'PO-1' })
      .expect(200);
    expect(preview.body.withholding).toBe(true);
    expect(preview.body.notices).toEqual(
      expect.arrayContaining([{ code: 'company.approval_required', params: { threshold: '100.00' } }]),
    );
    expect(preview.body.company).toMatchObject({
      companyId,
      approvalThreshold: '100.00',
      approvalRequired: true,
      onCredit: false,
    });
    await place(buyer.token, { companyId })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('companies.po_required'));
    const placed = await place(buyer.token, { companyId, poNumber: 'PO-1' }).expect(201);
    expect(placed.body.status).toBe('pending_company_approval');
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({
      where: { publicId: placed.body.id as string },
      include: { company: true, orders: true },
    });
    expect(group.company?.publicId).toBe(companyId);
    expect(group.expiresAt).toBeNull();
    expect(group.orders.every((o) => o.companyId === group.companyId)).toBe(true);
    expect(group.taxProfileSnapshot).toMatchObject({
      taxType: 'juristic',
      branchCode: '00000',
      withholdsTax: true,
      companyId,
    });
    await as(ctx, buyer.token)
      .post(`/v1/store/order-groups/${group.publicId}/payments`, { method: 'scb_qr' })
      .set('Idempotency-Key', randomUUID())
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('payments.group_not_payable'));

    // The buyer cannot decide; the approver approves → waiting for payment with the expiry clock started.
    await as(ctx, buyer.token).get(`/v1/store/companies/${companyId}/approvals`).expect(403);
    await decide(approver.token, companyId, 'approve');
    const approved = await ctx.prisma.orderGroup.findUniqueOrThrow({ where: { id: group.id } });
    expect(approved.status).toBe('waiting_payment');
    expect(approved.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    // A second order is rejected → cancelled with the company reason.
    await cart(buyer.token);
    const second = await place(buyer.token, { companyId, poNumber: 'PO-2' }).expect(201);
    await decide(approver.token, companyId, 'reject');
    const rejected = await ctx.prisma.orderGroup.findUniqueOrThrow({
      where: { publicId: second.body.id as string },
      include: { orders: { include: { cancelReason: true } } },
    });
    expect(rejected.status).toBe('cancelled');
    expect(rejected.orders[0]!.cancelReason!.code).toBe('company_approval_rejected');

    // U-B0.1: the decided history with who decided, the threshold and the invoice branch.
    const history = (
      await as(ctx, approver.token)
        .get(`/v1/store/companies/${companyId}/approvals?status=decided`)
        .expect(200)
    ).body as {
      groupId: string;
      status: string;
      threshold: string | null;
      decidedBy: { id: string } | null;
      decidedAt: string | null;
      branchName: string | null;
      ordersCount: number;
    }[];
    expect(history.map((h) => h.status)).toEqual(['rejected', 'approved']);
    expect(history[0]).toMatchObject({
      threshold: '100.00',
      ordersCount: 1,
      branchName: expect.any(String),
      decidedAt: expect.any(String),
      decidedBy: expect.objectContaining({ id: expect.any(String) }),
    });
    expect(
      (await as(ctx, approver.token).get(`/v1/store/companies/${companyId}/approvals`).expect(200)).body,
    ).toEqual([]);
    expect(
      (
        await as(ctx, approver.token)
          .get(`/v1/store/companies/${companyId}/approvals?status=all&limit=1`)
          .expect(200)
      ).body,
    ).toHaveLength(1);
    const spend = (
      await as(ctx, admin.token).get(`/v1/store/companies/${companyId}/spend?months=2`).expect(200)
    ).body;
    expect(spend.byMonth).toHaveLength(2);
    expect(spend.total.orders).toBe(1);
    expect(spend.byMember[0].user.displayName).toEqual(expect.any(String));
    expect(Number(spend.total.netAmount) + Number(spend.total.vatAmount)).toBeCloseTo(
      Number(spend.total.grossAmount),
      2,
    );
  });

  it('places orders below the threshold directly', async () => {
    const admin = await customerToken(ctx, 5);
    const companyId = await activeCompany(ctx, admin.token, 2, [], { orderApprovalThreshold: '99999999.00' });
    await cart(admin.token);
    const placed = await place(admin.token, { companyId }).expect(201);
    expect(placed.body.status).toBe('waiting_payment');
  });
});
