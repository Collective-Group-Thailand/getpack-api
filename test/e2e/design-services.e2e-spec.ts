import { randomUUID } from 'node:crypto';

import { MoneyDecimal } from '@common/money/money';
import { PreflightService } from '@modules/artwork/preflight/preflight.service';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  addAddress,
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  saveQuote,
  seedShipping,
  setFlag,
  staffToken,
  uploadFile,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp, makePdf, payDue, uploadPdf } from '../support/fulfilment-e2e';

/**
 * Hired design (B4.1, D-071): the request opens with the order, starts once the brief is in and the order
 * is paid, each delivery goes through preflight and a proof; three revisions are free, the fourth is a paid
 * add-on the customer confirms (own order line + instalment) and pays before it starts. Mockups (D-072).
 */
interface DesignView {
  id: string;
  status: string;
  designFeeNet: string;
  revisionsUsed: number;
  dueState: string;
  nextRevision: {
    revisionNo: number;
    chargeable: boolean;
    feeNet: string | null;
    feeGross: string | null;
  } | null;
  rounds: {
    roundNo: number;
    kind: string;
    chargeable: boolean;
    status: string;
    submissionId: string | null;
  }[];
}

describe('design services and mockups (e2e, B4.1)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  async function hiredDesignOrder(token: string) {
    const address = await addAddress(ctx, token, code);
    const quote = await saveQuote(ctx, token, fixture, [1000], { graphic: true });
    await as(ctx, token)
      .post('/v1/store/cart/items', {
        quoteId: quote.id,
        quoteOptionId: quote.options[0]!.id,
        designOption: 'hired_design',
        destinations: [{ addressId: address.id, quantity: 1000 }],
      })
      .expect(201);
    const placed = await as(ctx, token)
      .post('/v1/store/checkout', {})
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    return placed.body as { id: string; orders: { id: string }[] };
  }

  it('runs free revisions, charges the fourth before it starts, and closes on approval', async () => {
    const { token } = await customerToken(ctx, 1);
    const prepress = await staffToken(ctx, 'prepress');
    const group = await hiredDesignOrder(token);
    const orderId = group.orders[0]!.id;
    await ctx.pump();

    const opened = await as(ctx, token).get(`/v1/store/orders/${orderId}/design-service`).expect(200);
    expect(opened.body).toMatchObject({
      status: 'brief_pending',
      freeRounds: 3,
      dueState: 'not_started',
      rounds: [],
    });
    expect(new MoneyDecimal(opened.body.designFeeNet as string).gt(0)).toBe(true);

    // Brief first (with a logo), then payment → work starts with its business-day due dates.
    const logo = await uploadFile(ctx, token, 'logo', 'evidence');
    const briefed = await as(ctx, token)
      .put(`/v1/store/orders/${orderId}/design-service/brief`, {
        brandName: 'ร้านทดสอบ',
        brandCategory: 'อาหาร',
        description: 'กล่องสีครีม โลโก้ด้านหน้า',
        attachmentFileIds: [logo],
      })
      .expect(200);
    expect(briefed.body.status).toBe('brief_pending');
    await payDue(ctx, token, group.id);
    await ctx.pump();
    const started = await as(ctx, token).get(`/v1/store/orders/${orderId}/design-service`).expect(200);
    expect(started.body).toMatchObject({
      status: 'in_progress',
      dueState: 'on_track',
      rounds: [{ roundNo: 1, kind: 'initial', status: 'in_progress' }],
    });
    expect(started.body.targetDueAt).not.toBeNull();
    expect(Date.parse(started.body.maxDueAt as string)).toBeGreaterThan(
      Date.parse(started.body.targetDueAt as string),
    );
    await as(ctx, token).get(`/v1/store/files/${logo}/download`).expect(200);

    const designId = started.body.id as string;
    const prepressUser = await ctx.prisma.user.findFirstOrThrow({
      where: { email: 'prepress@example.invalid' },
    });
    await as(ctx, prepress)
      .post(`/v1/admin/design-services/${designId}/actions/assign`, { assigneeUserId: prepressUser.publicId })
      .expect(200);
    const mine = await as(ctx, prepress).get('/v1/admin/design-services?assignee=me&perPage=100').expect(200);
    expect((mine.body.data as { id: string }[]).some((d) => d.id === designId)).toBe(true);

    const deliverAndDecide = async (decision: 'request-changes' | 'approve') => {
      const file = await uploadPdf(
        ctx,
        prepress,
        await makePdf({ widthMm: 100, heightMm: 100 }),
        'artwork',
        'admin',
      );
      const delivered = await as(ctx, prepress)
        .post(`/v1/admin/design-services/${designId}/actions/deliver`, { fileIds: [file] })
        .expect(200);
      expect(delivered.body.status).toBe('delivered');
      const submissionId = (delivered.body.rounds as { submissionId: string | null }[]).at(-1)!.submissionId!;
      await ctx.app.get(PreflightService).runDue();
      await as(ctx, prepress)
        .post(`/v1/admin/artwork-submissions/${submissionId}/actions/accept`)
        .expect(200);
      const proofFile = await uploadPdf(
        ctx,
        prepress,
        await makePdf({ widthMm: 100, heightMm: 100 }),
        'proof',
        'admin',
      );
      const proof = await as(ctx, prepress)
        .post(`/v1/admin/orders/${orderId}/proofs`, { proofFileId: proofFile })
        .expect(201);
      if (decision === 'approve')
        await as(ctx, token)
          .post(`/v1/store/proofs/${proof.body.id as string}/actions/approve`)
          .set('Idempotency-Key', randomUUID())
          .expect(200);
      else
        await as(ctx, token)
          .post(`/v1/store/proofs/${proof.body.id as string}/actions/request-changes`, {
            comment: 'ขอปรับสี',
          })
          .expect(200);
      await ctx.pump();
      return (await as(ctx, token).get(`/v1/store/orders/${orderId}/design-service`).expect(200))
        .body as DesignView;
    };

    // Initial design + three free revisions: each change request opens the next round at once.
    for (const expectedRound of [2, 3, 4]) {
      const after = await deliverAndDecide('request-changes');
      expect(after).toMatchObject({ status: 'in_progress', revisionsUsed: expectedRound - 1 });
      expect(after.rounds.at(-1)).toMatchObject({
        roundNo: expectedRound,
        kind: 'revision',
        chargeable: false,
        status: 'in_progress',
      });
    }
    // The third revision's proof sent back: the fourth revision is offered at max(500, 20 % × fee).
    const offered = await deliverAndDecide('request-changes');
    const fee = MoneyDecimal.max(
      new MoneyDecimal(500),
      new MoneyDecimal(offered.designFeeNet).mul(0.2),
    ).toFixed(2);
    expect(offered).toMatchObject({
      status: 'revision_requested',
      nextRevision: { revisionNo: 4, chargeable: true, feeNet: fee },
    });
    const feeGross = offered.nextRevision!.feeGross!;

    await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/design-service/actions/confirm-extra-round`, {
        expectedFeeGross: '1.00',
        changeRequest: 'เปลี่ยนสีตัวอักษร',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    const before = await as(ctx, token).get(`/v1/store/order-groups/${group.id}`).expect(200);
    const confirmed = await as(ctx, token)
      .post(`/v1/store/orders/${orderId}/design-service/actions/confirm-extra-round`, {
        expectedFeeGross: feeGross,
        changeRequest: 'เปลี่ยนสีตัวอักษร',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    const extra = (
      confirmed.body.rounds as {
        roundNo: number;
        chargeable: boolean;
        status: string;
        feeNet: string;
        instalmentId: string;
      }[]
    ).at(-1)!;
    expect(extra).toMatchObject({ roundNo: 5, chargeable: true, status: 'awaiting_payment', feeNet: fee });
    const after = await as(ctx, token).get(`/v1/store/order-groups/${group.id}`).expect(200);
    expect(
      new MoneyDecimal(after.body.totals.grossAmount as string)
        .sub(before.body.totals.grossAmount as string)
        .toFixed(2),
    ).toBe(feeGross);
    const schedule = await as(ctx, token)
      .get(`/v1/store/order-groups/${group.id}/payment-schedule`)
      .expect(200);
    const charge = (schedule.body.instalments as { id: string; status: string; grossAmount: string }[]).find(
      (i) => i.id === extra.instalmentId,
    );
    expect(charge).toMatchObject({ status: 'due', grossAmount: feeGross });
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: orderId },
      include: { lines: true },
    });
    expect(order.lines.map((l) => l.lineType)).toContain('extra_revision');

    // Paying the charge starts the round; its delivery is approved → the design is approved.
    const paid = await payDue(ctx, token, group.id);
    expect(paid.cashAmount).toBe(charge!.grossAmount);
    await ctx.pump();
    const running = await as(ctx, token).get(`/v1/store/orders/${orderId}/design-service`).expect(200);
    expect((running.body as DesignView).rounds.at(-1)).toMatchObject({ roundNo: 5, status: 'in_progress' });
    const done = await deliverAndDecide('approve');
    expect(done).toMatchObject({ status: 'approved', dueState: 'closed' });
    expect(done.rounds.at(-1)!.status).toBe('approved');
  });

  it('lets CS Lead add a paid mockup once, with its own instalment (audited)', async () => {
    const { token } = await customerToken(ctx, 2);
    const csLead = await staffToken(ctx, 'cs_lead');
    const cs = await staffToken(ctx, 'cs');
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    const body = { mockupOption: 'with_print', netAmount: '800.00', reason: 'ลูกค้าขอตัวอย่างจริงก่อนผลิต' };
    await as(ctx, cs)
      .post(`/v1/admin/orders/${orderId}/mockup`, body)
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    const added = await as(ctx, csLead)
      .post(`/v1/admin/orders/${orderId}/mockup`, body)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(added.body).toMatchObject({ netAmount: '800.00', vatAmount: '56.00', grossAmount: '856.00' });
    await as(ctx, csLead)
      .post(`/v1/admin/orders/${orderId}/mockup`, body)
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    const read = await as(ctx, token).get(`/v1/store/orders/${orderId}`).expect(200);
    expect(read.body.mockupOption).toBe('with_print');
    const schedule = await as(ctx, token)
      .get(`/v1/store/order-groups/${group.id}/payment-schedule`)
      .expect(200);
    expect(
      (schedule.body.instalments as { id: string }[]).some((i) => i.id === added.body.instalmentId),
    ).toBe(true);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'mockup.priced', resourcePublicId: orderId } }),
    ).toBe(1);
  });
});
