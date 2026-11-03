import { randomUUID } from 'node:crypto';

import { AgentDiscountsService } from '@modules/agents/agent-discounts.service';
import { AgentLeadsService } from '@modules/agents/agent-leads.service';
import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  customerToken,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  staffToken,
  uploadFile,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

/**
 * Phase 3 of the agent portal (D-468): pipeline, timeline, CSV, neutral duplicate check, quote on behalf with the
 * agent's code on `/q/{token}`, discount request with give-get and an agent-accepted co-fund option, deal
 * registration, playbook, card scan (fake OCR) and the commission forecast. Needs Docker (SKIPPED-DOCKER locally).
 */
describe('agent lead management (e2e, D-468)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let agent: { token: string; phone: string };
  let other: { token: string; phone: string };
  let leadId: string;

  async function makeAgent(account: { phone: string }, code: string) {
    const user = await ctx.prisma.user.findFirstOrThrow({ where: { phone: account.phone } });
    const plan = await ctx.prisma.salesAgentPlan.findUniqueOrThrow({ where: { code: 'freelance_standard' } });
    await ctx.prisma.salesAgent.create({
      data: { userId: user.id, kind: 'freelance', code, planId: plan.id, legalName: `[E2E] ${code} (fake)` },
    });
  }

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    agent = await customerToken(ctx, 7);
    other = await customerToken(ctx, 8);
    await makeAgent(agent, `P3A${ctx.run}`.slice(0, 10).toUpperCase());
    await makeAgent(other, `P3B${ctx.run}`.slice(0, 10).toUpperCase());
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('registers a lead, refuses the same contact neutrally to another agent, and works the pipeline', async () => {
    const phone = `+668${String(ctx.run * 10 + 3)
      .padStart(8, '0')
      .slice(-8)}`;
    const lead = await as(ctx, agent.token)
      .post('/v1/store/agent/leads', {
        kind: 'customer',
        contactName: 'คุณผู้มุ่งหวัง (fake)',
        phone,
        consentConfirmed: true,
        expectedValue: '45000.00',
        tags: ['เบเกอรี่'],
      })
      .expect(201);
    leadId = lead.body.id;
    expect(lead.body).toMatchObject({ stage: 'new', source: 'manual', expectedValue: '45000.00' });
    const check = await as(ctx, other.token)
      .post('/v1/store/agent/leads/actions/check', { phone })
      .expect(200);
    expect(check.body).toEqual({ available: false, reason: 'unavailable', leadId: null });
    const own = await as(ctx, agent.token).post('/v1/store/agent/leads/actions/check', { phone }).expect(200);
    expect(own.body).toMatchObject({ available: false, reason: 'own_lead', leadId });

    await as(ctx, agent.token)
      .post(`/v1/store/agent/leads/${leadId}/activities`, { kind: 'call', body: 'โทรครั้งแรก' })
      .expect(201);
    const got = await as(ctx, agent.token).get(`/v1/store/agent/leads/${leadId}`).expect(200);
    expect(got.body.stage).toBe('contacted');
    await as(ctx, agent.token)
      .patch(`/v1/store/agent/leads/${leadId}`, { industry: 'ร้านกาแฟ' })
      .set('If-Match', got.headers['etag'] as string)
      .expect(200);
    await as(ctx, agent.token)
      .post(`/v1/store/agent/leads/${leadId}/actions/change-stage`, { stage: 'won' })
      .expect(422);
    const list = await as(ctx, agent.token).get('/v1/store/agent/leads/pipeline?view=open').expect(200);
    expect((list.body.data as { id: string }[]).map((l) => l.id)).toContain(leadId);
    const timeline = await as(ctx, agent.token).get(`/v1/store/agent/leads/${leadId}/activities`).expect(200);
    expect(timeline.body.data[0]).toMatchObject({ kind: 'call', author: 'agent' });
  });

  it('imports a CSV after a dry run and exports formula-safe', async () => {
    const csv = `contact_name,phone\nคุณนำเข้า (fake),08${String(ctx.run * 10 + 4)
      .padStart(8, '0')
      .slice(-8)}\nไม่มีเบอร์,\n`;
    const preview = await as(ctx, agent.token)
      .post('/v1/store/agent/leads/imports', { csv, consentConfirmed: true })
      .expect(201);
    expect(preview.body).toMatchObject({ rowCount: 2, validCount: 1 });
    const committed = await as(ctx, agent.token)
      .post(`/v1/store/agent/leads/imports/${preview.body.id}/actions/commit`, {})
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(committed.body.createdCount).toBe(1);
    await as(ctx, agent.token).get('/v1/store/agent/leads/export').expect(200);
  });

  it('sends a quote on behalf: the link carries the agent code and the first open reaches the timeline', async () => {
    const created = await as(ctx, agent.token)
      .post('/v1/store/agent/quotes', {
        leadId,
        productTypeCode: 'folding_carton',
        configuration: foldingConfiguration(fixture, [1000]),
      })
      .expect(201);
    expect(created.body.status).toBe('sent');
    const token = /\/q\/([A-Za-z0-9_-]{43})$/.exec(created.body.shareUrl as string)![1]!;
    const opened = await request(ctx.server).get(`/v1/store/quotes/shared/${token}`).expect(200);
    expect(opened.body.agentCode).toMatch(/^P3A/);
    expect(JSON.stringify(created.body)).not.toMatch(/buyCost|marginPct|selectedFactory|internal"/);
    const after = await as(ctx, agent.token).get(`/v1/store/agent/quotes/${created.body.id}`).expect(200);
    expect(after.body.status).toBe('opened');

    // Discount: give-get required, one round per quote unless the give-get changes.
    const ask = { requestedPct: '5', reason: 'volume', quantityChange: 2000 };
    await as(ctx, agent.token)
      .post(`/v1/store/agent/quotes/${created.body.id}/discount-requests`, {
        requestedPct: '5',
        reason: 'budget',
      })
      .expect(422);
    const req = await as(ctx, agent.token)
      .post(`/v1/store/agent/quotes/${created.body.id}/discount-requests`, ask)
      .expect(201);
    await as(ctx, agent.token)
      .post(`/v1/store/agent/quotes/${created.body.id}/discount-requests`, ask)
      .expect(409);
    // Phase 4's desk answers through the internal service: standard (full rate) first, then a co-fund option.
    const answered = await ctx.app
      .get(AgentDiscountsService)
      .offerOptions({ type: 'system', name: 'e2e' }, req.body.id, [
        { kind: 'standard', discountPct: '3' },
        { kind: 'co_fund', discountPct: '5', ratePct: '4' },
      ]);
    const coFund = answered.options.find((o) => o.kind === 'co_fund')!;
    const accepted = await as(ctx, agent.token)
      .post(
        `/v1/store/agent/quotes/${created.body.id}/discount-options/${coFund.publicId}/actions/accept`,
        {},
      )
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(accepted.body.status).toBe('accepted');
    const option = await ctx.prisma.salesAgentDiscountOption.findUniqueOrThrow({ where: { id: coFund.id } });
    expect(option.acceptedSha256).not.toBeNull();

    const registered = await as(ctx, agent.token)
      .post(`/v1/store/agent/quotes/${created.body.id}/actions/register-deal`, {})
      .expect(200);
    expect(registered.body.dealRegistration).toMatchObject({ status: 'registered', origin: 'requested' });
  });

  it('reads the playbook, scans a card (fake OCR) and forecasts commission', async () => {
    const cards = await as(ctx, agent.token)
      .get('/v1/store/agent/playbook?context=discount_request')
      .expect(200);
    expect(cards.body.data.length).toBeGreaterThan(0);
    const fileId = await uploadFile(ctx, agent.token, 'fake-card', 'agent_card_scan');
    const scanned = await as(ctx, agent.token)
      .post('/v1/store/agent/leads/actions/scan-card', { fileId })
      .expect(200);
    expect(scanned.body).toMatchObject({ engine: 'fake', phone: { value: '+66890001234' } });
    const forecast = await as(ctx, agent.token).get('/v1/store/agent/commissions/forecast').expect(200);
    expect(forecast.body).toMatchObject({ paymentTermsDays: expect.any(Number) });
  });

  it('reminds follow-ups only outside the quiet hours', async () => {
    const sales = await staffToken(ctx, 'sales_manager');
    expect(sales).toBeTruthy();
    expect(await ctx.app.get(AgentLeadsService).remindFollowUps(new Date('2026-11-03T15:00:00Z'))).toBe(0);
  });
});
