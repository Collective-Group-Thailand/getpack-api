import { randomUUID } from 'node:crypto';

import { LoyaltyService } from '@modules/loyalty/loyalty.service';
import { ReferralsService } from '@modules/promotions/referrals.service';
import { envelopeFromRow } from '@platform/domain-events/domain-event';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  saveQuote,
  seedShipping,
  setSetting,
  staffToken,
} from '../support/commerce-e2e';

/** Referral codes, the referee discount, qualification with fraud rules and Marketing review (B3.3 slice 4, D-136). */
describe('referrals (e2e, B3.3)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let referrals: ReferralsService;
  let marketing: string;
  let rules: Record<string, unknown>;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    referrals = ctx.app.get(ReferralsService);
    marketing = await staffToken(ctx, 'marketing');
    const setting = await ctx.prisma.setting.findFirstOrThrow({
      where: { key: 'referral.rules', scopeType: 'platform' },
    });
    const version = await ctx.prisma.settingVersion.findFirstOrThrow({
      where: { settingId: setting.id, status: 'approved' },
      orderBy: { versionNo: 'desc' },
    });
    rules = version.value as Record<string, unknown>;
  });

  afterAll(async () => {
    await setSetting(ctx, 'referral.rules', rules);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  /** Places an order delivered to the customer's own address line (fingerprints differ per customer). */
  async function order(token: string, line1: string) {
    const province = await ctx.prisma.geoProvince.findUniqueOrThrow({ where: { code: 'DEV1' } });
    const address = await as(ctx, token)
      .post('/v1/store/addresses', {
        kind: 'delivery',
        label: 'บ้าน',
        recipientName: 'ผู้รับ ทดสอบ',
        phone: '0810001234',
        line1,
        provinceId: province.publicId,
        postcode,
      })
      .expect(201);
    const quote = await saveQuote(ctx, token, fixture, [1000]);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'own_file',
        destinations: [{ addressId: address.body.id as string, quantity: 1000 }],
      })
      .expect(201);
    const preview = await as(ctx, token).post('/v1/store/checkout/actions/preview', {}).expect(200);
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', {})
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    return { preview: preview.body, group: placed.body as { id: string } };
  }

  /** Completes the group and closes its claim window (B4 does this in production). */
  async function complete(groupPublicId: string) {
    const group = await ctx.prisma.orderGroup.findUniqueOrThrow({ where: { publicId: groupPublicId } });
    await ctx.prisma.order.updateMany({
      where: { orderGroupId: group.id },
      data: {
        status: 'completed',
        productionStartedAt: new Date(Date.now() - 20 * 86_400_000),
        startMode: 'auto',
        completedAt: new Date(Date.now() - 8 * 86_400_000),
        claimWindowEndsAt: new Date(Date.now() - 1000),
      },
    });
    await ctx.prisma.orderGroup.update({ where: { id: group.id }, data: { status: 'completed' } });
  }

  const referralOf = async (phone: string) => {
    const user = await ctx.prisma.user.findFirstOrThrow({ where: { phone } });
    return ctx.prisma.referralAttribution.findUniqueOrThrow({ where: { refereeUserId: user.id } });
  };

  it('shares a code, gives the referee the first-order discount and qualifies after the claim window', async () => {
    const referrer = await customerToken(ctx, 1);
    const mine = await as(ctx, referrer.token).get('/v1/store/referral').expect(200);
    expect(mine.body).toMatchObject({
      code: expect.stringMatching(/^[A-Z0-9]{8}$/),
      link: expect.stringContaining('/r/'),
    });
    const code = mine.body.code as string;
    expect((await as(ctx, referrer.token).get('/v1/store/referral').expect(200)).body.code).toBe(code);
    await as(ctx, referrer.token)
      .post('/v1/store/referral/attribution', { code })
      .expect(422)
      .expect((r) => {
        expect(r.body.code).toBe('referrals.self_referral');
      });

    const referee = await customerToken(ctx, 2);
    await as(ctx, referee.token).post('/v1/store/referral/attribution', { code: 'ZZZZZZZZ' }).expect(422);
    await as(ctx, referee.token)
      .post('/v1/store/referral/attribution', { code: code.toLowerCase() })
      .expect(201)
      .expect((r) => {
        expect(r.body).toMatchObject({ code, status: 'pending' });
      });
    await as(ctx, referee.token).post('/v1/store/referral/attribution', { code }).expect(409);

    const { preview, group } = await order(referee.token, `${ctx.run} ถนนผู้ถูกแนะนำ 2`);
    expect(preview.orders[0].discounts).toEqual([
      expect.objectContaining({ source: 'referral', code: null }),
    ]);
    const referral = await referralOf(referee.phone);
    const placed = await ctx.prisma.orderGroup.findUniqueOrThrow({ where: { publicId: group.id } });
    expect(referral.firstOrderGroupId).toBe(placed.id);
    expect(
      await ctx.prisma.promotionRedemption.count({
        where: { orderGroupId: placed.id, promotion: { kind: 'referral' } },
      }),
    ).toBe(1);

    // A second customer can no longer use a code after ordering.
    await as(ctx, referee.token).post('/v1/store/referral/attribution', { code }).expect(409);

    expect(await referrals.qualifyDue()).toBe(0);
    await complete(group.id);
    expect(await referrals.qualifyDue()).toBe(1);
    const qualified = await ctx.prisma.referralAttribution.findUniqueOrThrow({ where: { id: referral.id } });
    expect(qualified).toMatchObject({ status: 'qualified', fraudFlags: [] });
    const event = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'referral.qualified', aggregateId: referral.publicId },
    });
    expect(event.payload).toMatchObject({ rewardBaht: rules['referrerRewardBaht'] });
    const counts = await as(ctx, referrer.token).get('/v1/store/referral').expect(200);
    expect(counts.body.referrals).toMatchObject({ qualified: 1 });

    // Loyalty (B3.4) pays the referrer THB 500 = 200 points and marks the referral rewarded (D-136, D-131).
    await ctx.prisma.withTx((tx) =>
      ctx.app.get(LoyaltyService).onReferralQualified(envelopeFromRow(event), tx),
    );
    expect(
      (await ctx.prisma.referralAttribution.findUniqueOrThrow({ where: { id: referral.id } })).status,
    ).toBe('rewarded');
    const points = await as(ctx, referrer.token).get('/v1/store/loyalty').expect(200);
    expect(points.body.availablePoints).toBe(200);

    // The referee discount is a system promotion: its values are the referral settings, not editable.
    const system = await ctx.prisma.promotion.findFirstOrThrow({ where: { kind: 'referral' } });
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${system.publicId}/actions/pause`)
      .expect(409)
      .expect((r) => {
        expect(r.body.code).toBe('promotions.system_managed');
      });
  });

  it('gives no reward when the referee shares an address with the referrer (D-136)', async () => {
    const referrer = await customerToken(ctx, 3);
    await order(referrer.token, `${ctx.run} ถนนบ้านเดียวกัน 3`);
    const code = (await as(ctx, referrer.token).get('/v1/store/referral').expect(200)).body.code as string;
    const referee = await customerToken(ctx, 4);
    await as(ctx, referee.token).post('/v1/store/referral/attribution', { code }).expect(201);
    const { group } = await order(referee.token, `${ctx.run} ถนนบ้านเดียวกัน 3`);
    await complete(group.id);
    await referrals.qualifyDue();
    const referral = await referralOf(referee.phone);
    expect(referral.status).toBe('rejected_fraud');
    expect(referral.fraudFlags).toContain('address_match');
  });

  it('sends a referrer over the monthly cap to Marketing, who approves it', async () => {
    await setSetting(ctx, 'referral.rules', { ...rules, maxRewardedReferralsPerMonth: 1 });
    const referrer = await customerToken(ctx, 5);
    const code = (await as(ctx, referrer.token).get('/v1/store/referral').expect(200)).body.code as string;
    const first = await customerToken(ctx, 6);
    const second = await customerToken(ctx, 7);
    for (const [i, c] of [first, second].entries()) {
      await as(ctx, c.token).post('/v1/store/referral/attribution', { code }).expect(201);
      const { group } = await order(c.token, `${ctx.run} ถนนเพื่อน ${i + 6}`);
      await complete(group.id);
      await referrals.qualifyDue();
    }
    expect((await referralOf(first.phone)).status).toBe('qualified');
    const held = await referralOf(second.phone);
    expect(held).toMatchObject({ status: 'under_review', fraudFlags: ['monthly_cap'] });

    const queue = await as(ctx, marketing).get('/v1/admin/referrals?status=under_review').expect(200);
    const item = (queue.body.data as { id: string; approvalId: string }[]).find(
      (r) => r.id === held.publicId,
    )!;
    expect(item.approvalId).toBeTruthy();
    await as(ctx, marketing)
      .post(`/v1/admin/approvals/${item.approvalId}/actions/approve`, { comment: 'ลูกค้าแนะนำจริง' })
      .expect(200);
    const outcome = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'approval.approved', aggregateId: item.approvalId },
    });
    await ctx.prisma.withTx((tx) => referrals.onApprovalOutcome(envelopeFromRow(outcome), tx));
    expect((await referralOf(second.phone)).status).toBe('qualified');
  });
});
