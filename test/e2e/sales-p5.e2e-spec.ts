import { SalesCaptureService } from '@modules/sales-desk/sales-capture.service';
import { SalesScoringService } from '@modules/sales-desk/sales-scoring.service';

import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  setSetting,
  staffToken,
} from '../support/commerce-e2e';

/**
 * Phase 5 of the agent portal (D-471): automatic lead capture (studio designs not ordered, dieline downloads by
 * signed-in non-customers) behind flags and marketing consent, the lead score with its reasons for staff and the
 * score only for agents, and the attribution precedence (an agent's contact never enters the company pool).
 * Needs Docker (SKIPPED-DOCKER locally).
 */
describe('automatic lead capture and scoring (e2e, D-471)', () => {
  let ctx: CommerceApp;
  let manager: string;
  let buyer: { token: string; phone: string };
  let buyerId: bigint;

  async function grantMarketing(userId: bigint, granted: boolean) {
    const purpose = await ctx.prisma.consentPurpose.findUniqueOrThrow({ where: { key: 'marketing_email' } });
    let version = await ctx.prisma.consentPurposeVersion.findFirst({
      where: { purposeId: purpose.id, status: 'approved' },
    });
    version ??= await ctx.prisma.consentPurposeVersion.create({
      data: {
        purposeId: purpose.id,
        versionNo: 1,
        effectiveFrom: new Date(Date.now() - 86_400_000),
        status: 'approved',
        textTh: '[E2E] ข้อความทดสอบ (fake)',
        textEn: '[E2E] test text (fake)',
        reason: 'e2e (fake)',
      },
    });
    await ctx.prisma.consentRecord.create({
      data: { userId, purposeId: purpose.id, purposeVersionId: version.id, granted, source: 'web' },
    });
  }

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    manager = await staffToken(ctx, 'sales_manager');
    buyer = await customerToken(ctx, 51);
    buyerId = (await ctx.prisma.user.findFirstOrThrow({ where: { phone: buyer.phone } })).id;
  });

  afterAll(async () => {
    await setSetting(ctx, 'capture.dieline_download_enabled', false);
    await setSetting(ctx, 'capture.studio_idle_enabled', false);
    await ctx?.app.close();
  });

  it('captures nothing while the flags are off or without marketing consent', async () => {
    const capture = ctx.app.get(SalesCaptureService);
    await setSetting(ctx, 'capture.dieline_download_enabled', false);
    await expect(capture.captureStudioIdle()).resolves.toEqual({ captured: 0, skipped: { flag_off: 1 } });
    await setSetting(ctx, 'capture.dieline_download_enabled', true);
    await grantMarketing(buyerId, false);
    const outcome = await ctx.prisma.withTx((tx) => capture.captureDieline(tx, buyerId, 'PK-TE-05-E2E'));
    expect(outcome).toBe('no_consent');
  });

  it('captures a dieline download once, refreshes it on the next, scores it with reasons for staff', async () => {
    const capture = ctx.app.get(SalesCaptureService);
    await grantMarketing(buyerId, true);
    expect(await ctx.prisma.withTx((tx) => capture.captureDieline(tx, buyerId, 'PK-TE-05-A'))).toBe(
      'captured',
    );
    expect(await ctx.prisma.withTx((tx) => capture.captureDieline(tx, buyerId, 'PK-TE-05-B'))).toBe(
      'refreshed',
    );
    const list = await as(ctx, manager)
      .get('/v1/admin/sales/inbound?source=dieline_download&sort=score&perPage=100')
      .expect(200);
    const item = (list.body.data as Record<string, unknown>[]).find((i) => i['customerId'] !== null);
    expect(item).toMatchObject({
      source: 'dieline_download',
      consentBasis: 'marketing_consent',
      signalCount: 2,
    });
    expect(typeof item!['score']).toBe('number');
    expect((item!['scoreReasons'] as unknown[]).length).toBeLessThanOrEqual(3);
  });

  it('keeps an agent’s contact out of the company pool and gives the agent the score only', async () => {
    const agentUser = await customerToken(ctx, 52);
    const user = await ctx.prisma.user.findFirstOrThrow({ where: { phone: agentUser.phone } });
    const plan = await ctx.prisma.salesAgentPlan.findUniqueOrThrow({ where: { code: 'freelance_standard' } });
    await ctx.prisma.salesAgent.create({
      data: {
        userId: user.id,
        kind: 'freelance',
        code: `P5A${ctx.run}`.slice(0, 10).toUpperCase(),
        planId: plan.id,
        legalName: '[E2E] P5 (fake)',
      },
    });
    const contact = await customerToken(ctx, 53);
    const contactId = (await ctx.prisma.user.findFirstOrThrow({ where: { phone: contact.phone } })).id;
    await as(ctx, agentUser.token)
      .post('/v1/store/agent/leads', {
        kind: 'customer',
        contactName: 'คุณผู้มุ่งหวัง (fake)',
        phone: contact.phone,
      })
      .expect(201);
    await grantMarketing(contactId, true);
    const capture = ctx.app.get(SalesCaptureService);
    expect(await ctx.prisma.withTx((tx) => capture.captureDieline(tx, contactId, 'PK-TE-05-C'))).toBe(
      'attributed',
    );

    await ctx.app.get(SalesScoringService).rescoreDue();
    const leads = await as(ctx, agentUser.token).get('/v1/store/agent/leads?sort=score').expect(200);
    const lead = (leads.body.data as Record<string, unknown>[])[0]!;
    expect(typeof lead['score']).toBe('number');
    expect(lead).not.toHaveProperty('scoreReasons');
  });
});
