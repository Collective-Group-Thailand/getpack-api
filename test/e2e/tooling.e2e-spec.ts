import { randomUUID } from 'node:crypto';

import { systemActor } from '@common/context/actor';
import { MoneyDecimal } from '@common/money/money';
import { OrdersService } from '@modules/orders/orders.service';
import { DomainEvents } from '@platform/domain-events/domain-events.service';

import { type DevCorrugate, seedDevCorrugate } from '../../prisma/seed/dev-corrugate';
import {
  addAddress,
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  postcodes,
  seedShipping,
  setFlag,
  staffToken,
} from '../support/commerce-e2e';
import {
  approveArtwork,
  bootFulfilmentApp,
  factoryToken,
  type FulfilmentApp,
  payDue,
} from '../support/fulfilment-e2e';

interface Waiver {
  waivedAmount: string;
  reason: string;
  tooling: { id: string; kind: string }[];
}

/** U2.7 tooling register and the reorder waiver (D-205, D-289, finding F1). */
describe('tooling register and reorder waiver (e2e, U2.7)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevCorrugate;
  let code: string;
  let token: string;
  let orderId: string;

  const post = (t: string, path: string, body: Record<string, unknown> = {}) =>
    as(ctx, t).post(path, body).set('Idempotency-Key', randomUUID());

  /** Facts the production and delivery flows record (covered by their own suites), recorded directly. */
  async function deliver(publicId: string) {
    const orders = ctx.app.get(OrdersService);
    const actor = systemActor('e2e');
    const order = await ctx.prisma.order.findUniqueOrThrow({ where: { publicId } });
    await ctx.prisma.withTx(async (tx) => {
      await orders.applyFact(tx, order.id, { kind: 'production_started', mode: 'auto' }, actor);
      await orders.applyFact(tx, order.id, { kind: 'shipped' }, actor);
      await orders.applyFact(tx, order.id, { kind: 'delivered' }, actor);
    });
    await ctx.pump();
  }

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    await foldingReady(ctx);
    fixture = (await ctx.prisma.$transaction((tx) => seedDevCorrugate(tx), { timeout: 60_000 })).fixture;
    await ctx.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'instant' } });
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    token = (await customerToken(ctx, 121)).token;
    await addAddress(ctx, token, code);
    const saved = await post(token, '/v1/store/quotes', {
      productTypeCode: 'corrugated',
      configuration: {
        patternId: fixture.rscPatternPublicId,
        catalogProductId: fixture.catalogProductPublicId,
        w: 300,
        l: 400,
        d: 250,
        materialId: fixture.boardPublicId,
        difficultyLevelId: fixture.difficultyLevelPublicId,
        quantities: [1000],
        parts: [{ printFront: [{ inkColourId: fixture.inkColourPublicId, area: 'top' }] }],
      },
    }).expect(201);
    const option = (saved.body.options as { id: string; toolingAmount: string }[])[0]!;
    expect(Number(option.toolingAmount)).toBeGreaterThan(0);
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: saved.body.id,
        quoteOptionId: option.id,
        designOption: 'own_file',
      })
      .expect(201);
    const placed = await post(token, '/v1/store/checkout').expect(201);
    orderId = (placed.body.orders as { id: string }[])[0]!.id;
    await payDue(ctx, token, placed.body.id as string);
    await approveArtwork(ctx, token, await staffToken(ctx, 'prepress'), orderId);
    await ctx.pump();
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await ctx?.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'rfq' } });
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('registers the plates of a delivered order at its factory, bound to the specification and artwork', async () => {
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: orderId },
      include: { proofs: { where: { status: 'approved' } } },
    });
    expect(await ctx.prisma.toolingItem.count({ where: { sourceOrderId: order.id } })).toBe(0);
    await deliver(orderId);
    const items = await ctx.prisma.toolingItem.findMany({ where: { sourceOrderId: order.id } });
    expect(items.map((i) => i.kind)).toEqual(['plates']); // RSC: no die block
    expect(Buffer.from(items[0]!.artworkSha256!)).toEqual(Buffer.from(order.proofs[0]!.approvedFileSha256!));

    const admin = await staffToken(ctx, 'admin');
    const list = await as(ctx, admin)
      .get(`/v1/admin/tooling?factoryId=${fixture.factoryPublicId}`)
      .expect(200);
    const row = (list.body.data as { id: string; status: string; sourceOrder: { orderId: string } }[]).find(
      (r) => r.id === items[0]!.publicId,
    );
    expect(row).toMatchObject({ status: 'active', sourceOrder: { orderId } });
    const owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 121);
    const mine = await as(ctx, owner)
      .get(`/v1/partner/factories/${fixture.factoryPublicId}/tooling`)
      .expect(200);
    expect((mine.body as { id: string }[]).map((r) => r.id)).toContain(items[0]!.publicId);
  });

  it('waives the plates on a reorder with the artwork unchanged, sale and buy (D-289)', async () => {
    const plain = await as(ctx, token)
      .get(`/v1/store/orders/${orderId}/reorder?reuseArtwork=false`)
      .expect(200);
    expect(plain.body.toolingWaiver).toBeNull();
    expect(Number(plain.body.toolingAmount)).toBeGreaterThan(0);

    const reused = await as(ctx, token).get(`/v1/store/orders/${orderId}/reorder`).expect(200);
    const waiver = reused.body.toolingWaiver as Waiver;
    expect(waiver).toMatchObject({ reason: 'tooling_reuse', tooling: [{ kind: 'plates' }] });
    expect(waiver.waivedAmount).toBe(plain.body.toolingAmount);
    expect(reused.body.toolingAmount).toBe('0.00');
    expect(
      new MoneyDecimal(plain.body.grossAmount as string).sub(reused.body.grossAmount as string).toFixed(2),
    ).toBe(waiver.waivedAmount);

    await post(token, `/v1/store/orders/${orderId}/actions/reorder`, {
      previewToken: reused.body.previewToken,
    }).expect(201);
    const placed = await post(token, '/v1/store/checkout').expect(201);
    const reorderId = (placed.body.orders as { id: string }[])[0]!.id;
    const [original, reorder] = await Promise.all(
      [orderId, reorderId].map((id) =>
        ctx.prisma.order.findUniqueOrThrow({ where: { publicId: id }, include: { quoteOption: true } }),
      ),
    );
    const result = reorder!.quoteOption.result as unknown as { toolingWaiver: Waiver };
    expect(result.toolingWaiver).toEqual(waiver);
    const internal = reorder!.quoteOption.internalBreakdown as {
      tooling: { charged: { platesBuy: string }; waived: { platesBuy: string } };
    };
    expect(internal.tooling.charged.platesBuy).toBe('0.00');
    expect(Number(internal.tooling.waived.platesBuy)).toBeGreaterThan(0);
    // The factory's buy price excludes the plates it keeps.
    const originalInternal = original!.quoteOption.internalBreakdown as { buyPrice: string };
    expect(
      new MoneyDecimal(originalInternal.buyPrice)
        .sub((reorder!.quoteOption.internalBreakdown as { buyPrice: string }).buyPrice)
        .toFixed(2),
    ).toBe(internal.tooling.waived.platesBuy);

    // Delivering the reorder refreshes the same register entry (last use), no new one.
    await payDue(ctx, token, placed.body.id as string);
    await ctx.pump();
    await deliver(reorderId);
    const items = await ctx.prisma.toolingItem.findMany({ where: { sourceOrderId: original!.id } });
    expect(items).toHaveLength(1);
    expect(items[0]!.lastOrderId).toBe(reorder!.id);
  });

  it('lets the factory report a reused tool unusable before accepting; getpack absorbs the remake (D-205)', async () => {
    const reused = await as(ctx, token).get(`/v1/store/orders/${orderId}/reorder`).expect(200);
    await post(token, `/v1/store/orders/${orderId}/actions/reorder`, {
      previewToken: reused.body.previewToken,
    }).expect(201);
    const placed = await post(token, '/v1/store/checkout').expect(201);
    const reorderId = (placed.body.orders as { id: string }[])[0]!.id;
    await payDue(ctx, token, placed.body.id as string);
    await ctx.pump();
    const job = await ctx.prisma.productionJob.findFirstOrThrow({
      where: { order: { publicId: reorderId }, jobKind: 'production' },
      include: { factory: true },
    });
    expect(job.status).toBe('released');
    const owner = await factoryToken(ctx, job.factory.publicId, 'factory_owner', 122);
    const reusedTools = await as(ctx, owner)
      .get(`/v1/partner/production-jobs/${job.publicId}/tooling`)
      .expect(200);
    const tool = (reusedTools.body as { id: string; kind: string }[])[0]!;
    expect(tool.kind).toBe('plates');

    const report = await post(
      owner,
      `/v1/partner/production-jobs/${job.publicId}/actions/report-tooling-unusable`,
      {
        toolingId: tool.id,
        reason: 'Plates cracked in storage',
      },
    ).expect(200);
    const waived = (
      (
        await ctx.prisma.order.findUniqueOrThrow({
          where: { publicId: reorderId },
          include: { quoteOption: true },
        })
      ).quoteOption.internalBreakdown as { tooling: { waived: { platesBuy: string } } }
    ).tooling.waived.platesBuy;
    expect(report.body).toMatchObject({ toolingId: tool.id, buyNetAmount: waived });
    await post(owner, `/v1/partner/production-jobs/${job.publicId}/actions/report-tooling-unusable`, {
      toolingId: tool.id,
      reason: 'again',
    }).expect(409);
    await ctx.pump();

    // Reported, then accepted; the purchase order keeps its snapshot and the goods receipt pays the remake
    // (delivery itself: its own suites).
    await post(owner, `/v1/partner/production-jobs/${job.publicId}/actions/accept`).expect(200);
    await ctx.pump();
    const po = await ctx.prisma.purchaseOrder.findUniqueOrThrow({ where: { productionJobId: job.id } });
    await ctx.prisma.withTx((tx) =>
      ctx.app.get(DomainEvents).record(
        tx,
        {
          type: 'delivery.reconciled',
          aggregateType: 'order',
          aggregateId: reorderId,
          payload: { orderId: reorderId, deliveredQuantity: 1000, payableQuantity: 1000 },
        },
        systemActor('e2e'),
      ),
    );
    await ctx.pump();
    const gr = await ctx.prisma.goodsReceipt.findFirstOrThrow({
      where: { poId: po.id },
      include: { lines: true },
    });
    const line = gr.lines.find((l) => l.lineType === 'tooling')!;
    expect(line.netAmount.toFixed(2)).toBe(waived);
    expect(gr.netAmount.toFixed(2)).toBe(
      gr.lines.reduce((a, l) => a.add(l.netAmount.toString()), new MoneyDecimal(0)).toFixed(2),
    );
    const item = await ctx.prisma.toolingItem.findFirstOrThrow({ where: { publicId: tool.id } });
    expect(item.status).toBe('unusable');
    // The customer price is unchanged: the order still carries the waiver.
    const after = await as(ctx, token).get(`/v1/store/orders/${orderId}/reorder`).expect(200);
    expect(after.body.toolingWaiver).toBeNull();
  });
});
