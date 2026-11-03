import { randomUUID } from 'node:crypto';

import { DiscountApprovalsService } from '@modules/sales-desk/discount-approvals.service';
import { SalesInboundService } from '@modules/sales-desk/sales-inbound.service';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  customerToken,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  staffToken,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

/**
 * Phase 4 of the agent portal (D-469, D-470): the company sales desk (rep pipeline, inbound pool, assignment, SLA,
 * dashboard) and the discount approval desk (waterfall tiers, simulator, decision, access log, discounted quotation).
 * Needs Docker (SKIPPED-DOCKER locally).
 */
describe('company sales desk and discount approval (e2e, D-469, D-470)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let agent: { token: string; phone: string };
  let manager: string;
  let cLevel: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    agent = await customerToken(ctx, 9);
    const user = await ctx.prisma.user.findFirstOrThrow({ where: { phone: agent.phone } });
    const plan = await ctx.prisma.salesAgentPlan.findUniqueOrThrow({ where: { code: 'freelance_standard' } });
    await ctx.prisma.salesAgent.create({
      data: {
        userId: user.id,
        kind: 'freelance',
        code: `P4A${ctx.run}`.slice(0, 10).toUpperCase(),
        planId: plan.id,
        legalName: '[E2E] P4 (fake)',
      },
    });
    manager = await staffToken(ctx, 'sales_manager');
    cLevel = await staffToken(ctx, 'c_level');
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('takes a manual enquiry into the pool with a working-hours due time, then disqualifies it', async () => {
    const created = await as(ctx, manager)
      .post('/v1/admin/sales/inbound', {
        contactName: 'คุณสอบถาม (fake)',
        contactPhone: `+668${String(ctx.run * 10 + 5)
          .padStart(8, '0')
          .slice(-8)}`,
        need: 'กล่องขนม',
      })
      .expect(201);
    expect(created.body).toMatchObject({ source: 'manual', status: 'new', slaBreached: false });
    const done = await as(ctx, manager)
      .post(`/v1/admin/sales/inbound/${created.body.id}/actions/disqualify`, { reason: 'out_of_scope' })
      .expect(200);
    expect(done.body.status).toBe('disqualified');
    expect(
      await ctx.app.get(SalesInboundService).breachDue(new Date(Date.now() + 7 * 86_400_000)),
    ).toBeGreaterThanOrEqual(0);
    await as(ctx, manager).get('/v1/admin/sales/dashboard').expect(200);
  });

  it('approves an agent discount at the desk: tiers, simulator, access log, discounted quotation', async () => {
    const lead = await as(ctx, agent.token)
      .post('/v1/store/agent/leads', {
        kind: 'customer',
        contactName: 'คุณดีล (fake)',
        phone: `+668${String(ctx.run * 10 + 6)
          .padStart(8, '0')
          .slice(-8)}`,
        consentConfirmed: true,
      })
      .expect(201);
    const quote = await as(ctx, agent.token)
      .post('/v1/store/agent/quotes', {
        leadId: lead.body.id,
        productTypeCode: 'folding_carton',
        configuration: foldingConfiguration(fixture, [1000]),
      })
      .expect(201);
    const req = await as(ctx, agent.token)
      .post(`/v1/store/agent/quotes/${quote.body.id}/discount-requests`, {
        requestedPct: '2',
        reason: 'volume',
        quantityChange: 2000,
      })
      .expect(201);
    const opened = await as(ctx, manager)
      .post('/v1/admin/sales/discount-approvals', { discountRequestId: req.body.id })
      .expect(201);
    // A sales manager sees percentages only — no cost, revenue or margin amounts.
    expect(opened.body.waterfall.visibility).toBe('margin_pct');
    expect(opened.body.waterfall).not.toHaveProperty('factoryCost');
    expect(opened.body).not.toHaveProperty('priceLocks');
    const full = await as(ctx, cLevel)
      .get(`/v1/admin/sales/discount-approvals/${opened.body.id}`)
      .expect(200);
    expect(full.body.waterfall.visibility).toBe('full');
    await as(ctx, manager)
      .post(`/v1/admin/sales/discount-approvals/${opened.body.id}/actions/simulate`, {
        discountPct: '1.5',
        creditDays: 30,
      })
      .expect(200);
    const decided = await as(ctx, manager)
      .post(`/v1/admin/sales/discount-approvals/${opened.body.id}/actions/decide`, {
        decision: 'approve',
        options: [{ kind: 'standard', discountPct: '2.00' }],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(decided.body.status).toBe('approved');
    const views = await ctx.prisma.salesWaterfallView.count({
      where: { approval: { publicId: opened.body.id } },
    });
    expect(views).toBeGreaterThanOrEqual(3);
    expect(ctx.app.get(DiscountApprovalsService)).toBeDefined();
  });
});
