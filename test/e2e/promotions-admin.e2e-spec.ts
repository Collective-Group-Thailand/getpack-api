import { randomUUID } from 'node:crypto';

import { OBJECT_STORAGE } from '@collective/integrations/storage';
import { type FakeObjectStorage } from '@integrations/storage/fake-object-storage';

import { as, bootCommerceApp, type CommerceApp, customerToken, staffToken } from '../support/commerce-e2e';

/** Marketing admin: campaigns, promotions, coupon codes, CSV export and the report (B3.3 slice 2, D-053, D-154). */
describe('promotions admin (e2e, B3.3)', () => {
  let ctx: CommerceApp;
  let marketing: string;
  let cs: string;
  let csLead: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    marketing = await staffToken(ctx, 'marketing');
    cs = await staffToken(ctx, 'cs');
    csLead = await staffToken(ctx, 'cs-lead');
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('runs a campaign: create with the alert snapshot, budget update, activate, pause, end', async () => {
    const code = `launch-${ctx.run}`;
    const created = await as(ctx, marketing)
      .post('/v1/admin/campaigns', {
        code,
        name: 'เปิดตัว',
        startsAt: '2026-01-01T00:00:00+07:00',
        budgetAmount: '50000.00',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'draft',
      budgetAmount: '50000.00',
      spentAmount: '0.00',
      alertThresholdPct: '80.0000',
    });
    const id = created.body.id as string;
    await as(ctx, marketing)
      .post('/v1/admin/campaigns', { code, name: 'x', startsAt: '2026-01-01T00:00:00+07:00' })
      .expect(409);
    await as(ctx, cs)
      .post('/v1/admin/campaigns', { code: `${code}-cs`, name: 'x', startsAt: '2026-01-01T00:00:00+07:00' })
      .expect(403);

    // Updates are guarded by If-Match.
    await as(ctx, marketing).patch(`/v1/admin/campaigns/${id}`, { budgetAmount: '60000.00' }).expect(428);
    const got = await as(ctx, marketing).get(`/v1/admin/campaigns/${id}`).expect(200);
    const updated = await as(ctx, marketing)
      .patch(`/v1/admin/campaigns/${id}`, { budgetAmount: '60000.00', endsAt: '2025-01-01T00:00:00+07:00' })
      .set('If-Match', got.headers['etag'] as string)
      .expect(422);
    expect(updated.body.errors[0].path).toBe('endsAt');
    await as(ctx, marketing)
      .patch(`/v1/admin/campaigns/${id}`, { budgetAmount: '60000.00' })
      .set('If-Match', got.headers['etag'] as string)
      .expect(200)
      .expect((r) => expect(r.body.budgetAmount).toBe('60000.00'));

    await as(ctx, marketing)
      .post(`/v1/admin/campaigns/${id}/actions/activate`)
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('active'));
    await as(ctx, marketing)
      .post(`/v1/admin/campaigns/${id}/actions/pause`, { reason: 'รอปรับงบ (fake)' })
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('paused'));
    // U-B0.2: the reason goes with the event; the view carries owner, spent % and counts.
    const paused = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'campaign.paused', aggregateId: id },
    });
    expect(paused.payload).toMatchObject({ reason: 'รอปรับงบ (fake)' });
    const view = (await as(ctx, marketing).get(`/v1/admin/campaigns/${id}`).expect(200)).body;
    expect(view).toMatchObject({
      owner: { id: expect.any(String) },
      spentPct: '0.00',
      promotionsCount: 0,
      createdAt: expect.any(String),
    });
    await as(ctx, marketing)
      .post(`/v1/admin/campaigns/${id}/actions/end`)
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('ended'));
    await as(ctx, marketing).post(`/v1/admin/campaigns/${id}/actions/activate`).expect(409);

    const listed = await as(ctx, csLead).get('/v1/admin/campaigns?status=ended').expect(200);
    expect((listed.body.data as { id: string }[]).map((c) => c.id)).toContain(id);
    const event = await ctx.prisma.domainEvent.findFirst({
      where: { type: 'campaign.ended', aggregateId: id },
    });
    expect(event).not.toBeNull();
  });

  it('validates promotions against schema v1, needs codes before activating a coupon promotion', async () => {
    const campaign = await as(ctx, marketing)
      .post('/v1/admin/campaigns', {
        code: `promo-${ctx.run}`,
        name: 'โปร',
        startsAt: '2026-01-01T00:00:00+07:00',
      })
      .expect(201);
    const base = {
      name: 'ลด 10%',
      campaignId: campaign.body.id,
      kind: 'coupon',
      priority: 100,
      stacking: 'stackable',
      startsAt: '2026-01-01T00:00:00+07:00',
      conditions: { segments: ['new'], minOrderValue: '1000.00' },
      benefit: { type: 'percent', pct: '10', maxAmount: '500.00' },
      usageLimitPerCustomer: 1,
    };
    const bad = await as(ctx, marketing)
      .post('/v1/admin/promotions', {
        ...base,
        conditions: { segments: ['vip'] },
        benefit: { type: 'percent' },
      })
      .expect(422);
    expect((bad.body.errors as { path: string }[]).map((e) => e.path)).toEqual(
      expect.arrayContaining(['benefit']),
    );

    const promo = await as(ctx, marketing).post('/v1/admin/promotions', base).expect(201);
    expect(promo.body).toMatchObject({
      status: 'draft',
      kind: 'coupon',
      campaignId: campaign.body.id,
      benefit: base.benefit,
    });
    const id = promo.body.id as string;
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${id}/actions/activate`)
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('promotions.no_codes'));

    // Coupons: a single shared code, then 20 unique codes; codes are unique regardless of case.
    const single = `W${ctx.run}`;
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${id}/coupons`, { kind: 'single', code: single })
      .expect(400);
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${id}/coupons`, { kind: 'single', code: single })
      .set('Idempotency-Key', randomUUID())
      .expect(201)
      .expect((r) => expect(r.body.count).toBe(1));
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${id}/coupons`, { kind: 'single', code: single.toLowerCase() })
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    const bulk = await as(ctx, marketing)
      .post(`/v1/admin/promotions/${id}/coupons`, { kind: 'bulk_unique', count: 20, prefix: 'pk' })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(bulk.body.count).toBe(20);

    const { phone } = await customerToken(ctx, 1);
    const user = await ctx.prisma.user.findFirstOrThrow({ where: { phone } });
    const customer = { body: { id: user.publicId } };
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${id}/coupons`, { kind: 'per_customer', customerIds: [customer.body.id] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);

    const codes = await as(ctx, marketing).get(`/v1/admin/promotions/${id}/coupons?perPage=100`).expect(200);
    expect(codes.body.meta.total).toBe(22);
    const rows = codes.body.data as {
      id: string;
      code: string;
      usageLimit: number;
      assignedCustomerId: string | null;
    }[];
    const generated = rows.filter((c) => c.code.startsWith('PK'));
    expect(generated).toHaveLength(20);
    expect(generated.every((c) => c.usageLimit === 1 && /^PK[A-HJ-NP-Z2-9]{8}$/.test(c.code))).toBe(true);
    expect(rows.find((c) => c.assignedCustomerId === customer.body.id)).toBeDefined();

    // U-B0.2: batches, filters and the refs on the rows.
    expect(bulk.body).toMatchObject({
      kind: 'bulk_unique',
      prefix: 'PK',
      usageLimit: 1,
      generatedBy: expect.any(Object),
    });
    const batches = (await as(ctx, marketing).get(`/v1/admin/promotions/${id}/coupon-batches`).expect(200))
      .body as {
      id: string;
      kind: string;
    }[];
    expect(batches.map((b) => b.kind)).toEqual(
      expect.arrayContaining(['single', 'bulk_unique', 'per_customer']),
    );
    const ofBulk = await as(ctx, marketing)
      .get(`/v1/admin/promotions/${id}/coupons?batchId=${bulk.body.batchId as string}&perPage=100`)
      .expect(200);
    expect(ofBulk.body.meta.total).toBe(20);
    expect(ofBulk.body.data[0]).toMatchObject({ batchId: bulk.body.batchId });
    expect(rows.find((c) => c.assignedCustomerId === customer.body.id)).toMatchObject({
      assignedCustomer: { id: customer.body.id },
    });
    const promoView = (await as(ctx, marketing).get(`/v1/admin/promotions/${id}`).expect(200)).body;
    expect(promoView).toMatchObject({
      benefitSummaryTh: expect.any(String),
      benefitSummaryEn: expect.any(String),
      usage: { redemptions: 0, discountAmount: '0.00', cappedAmount: '0.00' },
      updatedAt: expect.any(String),
    });

    // Disable (with a reason) and re-enable one code.
    const first = rows[0]!.id;
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${id}/coupons/${first}/actions/disable`, { reason: 'รหัสรั่วไหล (fake)' })
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('disabled'));
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${id}/coupons/${first}/actions/enable`)
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('active'));

    // CSV export of one batch, audited; read roles cannot export.
    const exported = await as(ctx, marketing)
      .post(`/v1/admin/promotions/${id}/coupons/exports`, { batchId: bulk.body.batchId })
      .expect(200);
    expect(exported.body.codes).toBe(20);
    const file = await ctx.prisma.fileObject.findUniqueOrThrow({
      where: { publicId: exported.body.fileId as string },
    });
    expect(file.retentionClass).toBe('transient');
    const csv = ctx.app
      .get<FakeObjectStorage>(OBJECT_STORAGE)
      .objects.get(file.storageKey)!
      .body.toString('utf8');
    expect(csv.split('\r\n')[0]).toContain('code,status,usage_limit');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(21);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'export.generated', resourcePublicId: id },
    });
    expect(audit.category).toBe('export');
    await as(ctx, csLead).post(`/v1/admin/promotions/${id}/coupons/exports`, {}).expect(403);

    // Activate, update with If-Match, pause, end; an ended promotion is read-only.
    const active = await as(ctx, marketing).post(`/v1/admin/promotions/${id}/actions/activate`).expect(200);
    expect(active.body.status).toBe('active');
    const etag = (await as(ctx, marketing).get(`/v1/admin/promotions/${id}`).expect(200)).headers[
      'etag'
    ] as string;
    await as(ctx, marketing)
      .patch(`/v1/admin/promotions/${id}`, { priority: 50, benefit: { type: 'fixed', amount: '300.00' } })
      .set('If-Match', etag)
      .expect(200)
      .expect((r) =>
        expect(r.body).toMatchObject({ priority: 50, benefit: { type: 'fixed', amount: '300.00' } }),
      );
    await as(ctx, marketing).post(`/v1/admin/promotions/${id}/actions/end`).expect(200);
    const etag2 = (await as(ctx, marketing).get(`/v1/admin/promotions/${id}`).expect(200)).headers[
      'etag'
    ] as string;
    await as(ctx, marketing)
      .patch(`/v1/admin/promotions/${id}`, { priority: 10 })
      .set('If-Match', etag2)
      .expect(409);

    const listed = await as(ctx, csLead)
      .get(`/v1/admin/promotions?campaignId=${campaign.body.id as string}`)
      .expect(200);
    expect(listed.body.data).toHaveLength(1);
    await as(ctx, cs).get('/v1/admin/promotions').expect(403);
  });

  it('coupon codes only belong to coupon promotions; the report starts empty', async () => {
    const auto = await as(ctx, marketing)
      .post('/v1/admin/promotions', {
        name: 'ส่งฟรี',
        kind: 'automatic',
        priority: 200,
        stacking: 'stackable',
        startsAt: '2026-01-01T00:00:00+07:00',
        conditions: { zoneCodes: ['bkk'] },
        benefit: { type: 'free_shipping' },
      })
      .expect(201);
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${auto.body.id as string}/coupons`, { kind: 'bulk_unique', count: 2 })
      .set('Idempotency-Key', randomUUID())
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('promotions.not_a_coupon'));
    await as(ctx, marketing)
      .post(`/v1/admin/promotions/${auto.body.id as string}/actions/activate`)
      .expect(200);

    const report = await as(ctx, csLead)
      .get(`/v1/admin/promotions/report?promotionId=${auto.body.id as string}`)
      .expect(200);
    expect(report.body).toEqual({
      redemptions: 0,
      appliedRedemptions: 0,
      discountAmount: '0.00',
      cappedAmount: '0.00',
      orderGroups: 0,
      grossAmount: '0.00',
      customers: 0,
      currency: 'THB',
    });
  });

  it('rewrites the evaluation order in one call (D-053)', async () => {
    const listed = (await as(ctx, marketing).get('/v1/admin/promotions?perPage=100').expect(200)).body
      .data as {
      id: string;
      kind: string;
      priority: number;
    }[];
    const mine = listed.filter((p) => p.kind !== 'referral').slice(0, 2);
    expect(mine).toHaveLength(2);
    const order = [mine[1]!.id, mine[0]!.id];
    const done = await as(ctx, marketing)
      .put('/v1/admin/promotions/priority', { promotionIds: order })
      .expect(200);
    expect(done.body.updated).toBeGreaterThanOrEqual(1);
    const after = await Promise.all(
      order.map(
        async (id) =>
          (await as(ctx, marketing).get(`/v1/admin/promotions/${id}`).expect(200)).body as {
            priority: number;
          },
      ),
    );
    expect(after.map((p) => p.priority)).toEqual([10, 20]);
    await as(ctx, cs).put('/v1/admin/promotions/priority', { promotionIds: order }).expect(403);
  });
});
