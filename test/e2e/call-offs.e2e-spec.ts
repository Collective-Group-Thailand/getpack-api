import { randomUUID } from 'node:crypto';

import { MoneyDecimal } from '@common/money/money';
import { CallOffsService } from '@modules/call-offs/call-offs.service';

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
  staffToken,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

interface Agreement {
  id: string;
  status: string;
  factory: { id: string } | null;
  unitPrice: string | null;
  buyUnitPrice: string | null;
  committedQuantity: number;
  releasedQuantity: number;
  remainingQuantity: number;
  minReleaseQuantity: number;
  expiresAt: string | null;
  lapsedQuantity: number | null;
  releases: {
    quantity: number;
    status: string;
    includesOneOffs: boolean;
    order: { orderId: string } | null;
  }[];
}

/** U2.7 call-off agreements: a locked unit price released in parts (D-290, D-206). */
describe('call-off agreements (e2e, U2.7)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let token: string;
  let owner: string;
  let agreementId: string;
  let quote: Awaited<ReturnType<typeof saveQuote>>;

  const post = (t: string, path: string, body: Record<string, unknown> = {}) =>
    as(ctx, t).post(path, body).set('Idempotency-Key', randomUUID());

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    token = (await customerToken(ctx, 141)).token;
    await addAddress(ctx, token, code);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 141);
    quote = await saveQuote(ctx, token, fixture, [5000]);
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('is asked by the customer and accepted by the quotation’s factory, prices kept to each side', async () => {
    const body = { quoteId: quote.id, quoteOptionId: quote.options[0]!.id };
    await post(token, '/v1/store/call-off-agreements', { ...body, months: 7 }).expect(422);
    const asked = await post(token, '/v1/store/call-off-agreements', { ...body, months: 6 }).expect(201);
    agreementId = asked.body.id as string;
    expect(asked.body).toMatchObject({ status: 'pending_factory', committedQuantity: 5000, factory: null });
    expect(asked.body.buyUnitPrice).toBeNull();
    await post(token, '/v1/store/call-off-agreements', { ...body, months: 3 }).expect(409);
    // Not yet: no release before the factory accepts.
    await post(token, `/v1/store/call-off-agreements/${agreementId}/releases`, { quantity: 1000 }).expect(
      409,
    );

    const listed = await as(ctx, owner)
      .get(`/v1/partner/factories/${fixture.factoryPublicId}/call-off-agreements`)
      .expect(200);
    const seen = (listed.body as Agreement[]).find((a) => a.id === agreementId)!;
    expect(seen.unitPrice).toBeNull(); // D-044: never getpack's sell side
    expect(Number(seen.buyUnitPrice)).toBeGreaterThan(0);

    const accepted = await post(
      owner,
      `/v1/partner/call-off-agreements/${agreementId}/actions/accept`,
    ).expect(200);
    expect(accepted.body.status).toBe('active');
    const months = (Date.parse(accepted.body.expiresAt as string) - Date.now()) / (30.44 * 86_400_000);
    expect(Math.round(months)).toBe(6);
    await post(owner, `/v1/partner/call-off-agreements/${agreementId}/actions/accept`).expect(409);
  });

  it('releases at the locked unit price into normal orders; one-offs once; shipping at checkout (D-290)', async () => {
    const option = await ctx.prisma.quoteOption.findFirstOrThrow({
      where: { publicId: quote.options[0]!.id },
    });
    await post(token, `/v1/store/call-off-agreements/${agreementId}/releases`, { quantity: 6000 }).expect(
      422,
    );

    const cart = await post(token, `/v1/store/call-off-agreements/${agreementId}/releases`, {
      quantity: 2000,
    }).expect(201);
    const item = (cart.body.items as { quoteId: string; source: string }[]).find(
      (i) => i.source === 'call_off',
    )!;
    const releaseOption = await ctx.prisma.quoteOption.findFirstOrThrow({
      where: { quote: { publicId: item.quoteId } },
    });
    const result = option.result as { designFeeAmount: string | null; toolingAmount: string | null };
    const expectedGross = new MoneyDecimal(option.unitPrice.toString())
      .mul(2000)
      .toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_UP)
      .add(result.designFeeAmount ?? '0')
      .add(result.toolingAmount ?? '0');
    expect(releaseOption.grossAmount.toFixed(2)).toBe(expectedGross.toFixed(2));
    expect(releaseOption.shippingAmount).toBeNull();
    // The VAT keeps the option's product-side ratio.
    expect(Number(releaseOption.vatAmount) / Number(releaseOption.grossAmount)).toBeCloseTo(7 / 107, 3);

    const placed = await post(token, '/v1/store/checkout').expect(201);
    const orderId = (placed.body.orders as { id: string }[])[0]!.id;
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: orderId },
      include: { lines: true },
    });
    const product = order.lines.find((l) => l.lineType === 'product')!;
    expect(Number(product.quantity)).toBe(2000);
    expect(order.lines.some((l) => l.lineType === 'shipping')).toBe(true);

    const second = await post(token, `/v1/store/call-off-agreements/${agreementId}/releases`, {
      quantity: 1000,
    }).expect(201);
    expect(second.body.items).toBeDefined();
    const mine = (await as(ctx, token).get(`/v1/store/call-off-agreements/${agreementId}`).expect(200))
      .body as Agreement;
    expect(mine).toMatchObject({ releasedQuantity: 3000, remainingQuantity: 2000 });
    expect(mine.releases.map((r) => [r.quantity, r.status, r.includesOneOffs])).toEqual([
      [2000, 'ordered', true],
      [1000, 'quoted', false],
    ]);
    expect(mine.releases[0]!.order?.orderId).toBe(orderId);
  });

  it('lapses what is not released at expiry, without charge; staff see it without buy prices', async () => {
    const later = new Date(Date.now() + 200 * 86_400_000);
    await ctx.app.get(CallOffsService).lapse(later);
    const ended = (await as(ctx, token).get(`/v1/store/call-off-agreements/${agreementId}`).expect(200))
      .body as Agreement;
    expect(ended).toMatchObject({ status: 'expired', lapsedQuantity: 3000, remainingQuantity: 0 });
    expect(ended.releases[1]!.status).toBe('lapsed');

    const cs = await staffToken(ctx, 'cs');
    const list = await as(ctx, cs)
      .get('/v1/admin/call-off-agreements?status=expired&perPage=100')
      .expect(200);
    const row = (list.body.data as Agreement[]).find((a) => a.id === agreementId)!;
    expect(row.factory?.id).toBe(fixture.factoryPublicId);
    expect(row.buyUnitPrice).toBeNull(); // D-141: CS has no factory_cost.read
  });

  it('can be declined by the factory with a reason, or withdrawn by the customer', async () => {
    const other = await saveQuote(ctx, token, fixture, [4000]);
    const asked = await post(token, '/v1/store/call-off-agreements', {
      quoteId: other.id,
      quoteOptionId: other.options[0]!.id,
      months: 3,
    }).expect(201);
    const declined = await post(
      owner,
      `/v1/partner/call-off-agreements/${asked.body.id as string}/actions/decline`,
      {
        reason: 'Board price is moving',
      },
    ).expect(200);
    expect(declined.body).toMatchObject({ status: 'declined', declineReason: 'Board price is moving' });
    await post(token, `/v1/store/call-off-agreements/${asked.body.id as string}/actions/cancel`).expect(409);

    const again = await post(token, '/v1/store/call-off-agreements', {
      quoteId: other.id,
      quoteOptionId: other.options[0]!.id,
      months: 2,
    }).expect(201);
    const withdrawn = await post(
      token,
      `/v1/store/call-off-agreements/${again.body.id as string}/actions/cancel`,
    ).expect(200);
    expect(withdrawn.body.status).toBe('cancelled');
  });
});
