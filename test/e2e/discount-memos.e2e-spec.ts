import { randomUUID } from 'node:crypto';

import { DiscountMemosService } from '@modules/discount-memos/discount-memos.service';
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

interface Discount {
  source: string;
  amount: string;
}

/** CS discounts, discount memos routed to the matching tier, company discounts (B3.5 slice 5, D-052, D-124, D-162). */
describe('discount memos (e2e, B3.5)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let memos: DiscountMemosService;
  let cs: string;
  let director: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    memos = ctx.app.get(DiscountMemosService);
    cs = await staffToken(ctx, 'cs');
    director = await staffToken(ctx, 'director');
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  /** The customer's quote in CS's cart for them; returns the customer public id. */
  async function csCart(n: number, signedIn?: { token: string; phone: string }) {
    const { token, phone } = signedIn ?? (await customerToken(ctx, n));
    const user = await ctx.prisma.user.findFirstOrThrow({ where: { phone } });
    const address = await addAddress(ctx, token, postcode);
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    await as(ctx, cs)
      .post(`/v1/admin/customers/${user.publicId}/cart/items`, {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity: 1000 }],
      })
      .expect(201);
    return { customerId: user.publicId, token, phone };
  }

  const discountsOf = (body: { orders: { discounts: Discount[] }[] }) =>
    body.orders.flatMap((o) => o.discounts);

  async function approve(approver: string, memoId: string) {
    const memo = await as(ctx, cs).get(`/v1/admin/discount-memos/${memoId}`).expect(200);
    await as(ctx, approver)
      .post(`/v1/admin/approvals/${memo.body.approvalId as string}/actions/approve`, { comment: 'อนุมัติ' })
      .expect(200);
    const outcome = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'approval.approved', aggregateId: memo.body.approvalId as string },
    });
    await ctx.prisma.withTx((tx) => memos.onApprovalOutcome(envelopeFromRow(outcome), tx));
  }

  it('lets CS give up to 5 % and refuses more without a memo', async () => {
    const { customerId } = await csCart(1);
    const url = `/v1/admin/customers/${customerId}/checkout/actions/preview`;
    await as(ctx, cs)
      .post(url, { csDiscountPct: '6' })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('discounts.cs_limit_exceeded'));
    const preview = await as(ctx, cs).post(url, { csDiscountPct: '5' }).expect(200);
    const given = discountsOf(preview.body).filter((d) => d.source === 'cs_discount');
    expect(given.length).toBeGreaterThan(0);
    expect(preview.body.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'discount.applied',
          params: expect.objectContaining({ source: 'cs_discount' }),
        }),
      ]),
    );
    await as(ctx, cs)
      .post('/v1/admin/discount-memos', { customerId, requestedPct: '5', reason: 'ทดสอบ' })
      .expect(422)
      .expect((r) => {
        expect(r.body.code).toBe('discount_memos.within_cs_limit');
      });
  });

  it('routes an 8 % memo to the Director only, applies it once at checkout with its id', async () => {
    const first = await csCart(2);
    const { customerId } = first;
    const raised = await as(ctx, cs)
      .post('/v1/admin/discount-memos', { customerId, requestedPct: '8', reason: 'คู่แข่งเสนอราคาต่ำกว่า' })
      .expect(201);
    expect(raised.body).toMatchObject({
      scope: 'order',
      status: 'pending_approval',
      requestedPct: '8.0000',
      evidence: [],
    });
    const mine = await as(ctx, cs)
      .get(`/v1/admin/discount-memos?requestedBy=${raised.body.requestedBy.id as string}&perPage=100`)
      .expect(200);
    expect((mine.body.data as { id: string }[]).map((m) => m.id)).toContain(raised.body.id);
    expect(
      (await as(ctx, cs).get(`/v1/admin/discount-memos?requestedBy=${randomUUID()}`).expect(200)).body.data,
    ).toEqual([]);
    const approval = await ctx.prisma.approvalRequest.findUniqueOrThrow({
      where: { publicId: raised.body.approvalId as string },
      include: { steps: { include: { approverRole: true } } },
    });
    expect(approval.steps.map((s) => s.approverRole.key)).toEqual(
      raised.body.belowMarginFloor ? ['c_level'] : ['director'],
    );
    const approver = raised.body.belowMarginFloor ? await staffToken(ctx, 'c-level') : director;
    await approve(approver, raised.body.id as string);
    expect(
      (
        await as(ctx, cs)
          .get(`/v1/admin/discount-memos/${raised.body.id as string}`)
          .expect(200)
      ).body,
    ).toMatchObject({ status: 'approved', approvedPct: '8.0000' });

    const url = `/v1/admin/customers/${customerId}/checkout`;
    await as(ctx, cs)
      .post(`${url}/actions/preview`, { discountMemoId: raised.body.id, csDiscountPct: '2' })
      .expect(422);
    const placed = await as(ctx, cs)
      .post(url, { discountMemoId: raised.body.id })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({
      where: { publicId: placed.body.id as string },
      include: { orders: { include: { discounts: true } } },
    });
    const memoDiscounts = group.orders
      .flatMap((o) => o.discounts)
      .filter((d) => d.source === 'discount_memo');
    expect(memoDiscounts.length).toBeGreaterThan(0);
    expect(memoDiscounts.every((d) => d.discountMemoId !== null)).toBe(true);
    expect(group.discountMemoId).not.toBeNull();
    const used = await as(ctx, cs)
      .get(`/v1/admin/discount-memos/${raised.body.id as string}`)
      .expect(200);
    expect(used.body).toMatchObject({ status: 'applied', appliedGroupCode: group.groupCode });

    // Used once: a new cart with the same memo is refused.
    await csCart(2, first);
    await as(ctx, cs)
      .post(`${url}/actions/preview`, { discountMemoId: raised.body.id })
      .expect(409)
      .expect((r) => {
        expect(r.body.code).toBe('discount_memos.not_usable');
      });
  });

  it('sets a company discount through a memo and applies it to company orders (D-124)', async () => {
    const admin = await customerToken(ctx, 3);
    const companyId = await activeCompany(ctx, admin.token, 3);
    const raised = await as(ctx, cs)
      .post(`/v1/admin/companies/${companyId}/discount-memos`, { requestedPct: '7', reason: 'ลูกค้าองค์กร' })
      .expect(201);
    expect(raised.body).toMatchObject({ scope: 'company', companyId, belowMarginFloor: false });
    await approve(director, raised.body.id as string);
    const version = await ctx.prisma.companyDiscountVersion.findFirstOrThrow({
      where: { discount: { company: { publicId: companyId } } },
    });
    expect(version.discountPct.toFixed(4)).toBe('7.0000');

    const address = await addAddress(ctx, admin.token, postcode);
    const quote = await saveQuote(ctx, admin.token, fixture, [1000]);
    await as(ctx, admin.token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.id, quantity: 1000 }],
      })
      .expect(201);
    const preview = await as(ctx, admin.token)
      .post('/v1/store/checkout/actions/preview', { companyId })
      .expect(200);
    expect(discountsOf(preview.body).some((d) => d.source === 'company_discount')).toBe(true);
    // Customers cannot pass staff discounts on the store.
    const plain = await as(ctx, admin.token)
      .post('/v1/store/checkout/actions/preview', { companyId, csDiscountPct: '5' })
      .expect(200);
    expect(discountsOf(plain.body).some((d) => d.source === 'cs_discount')).toBe(false);
  });
});
