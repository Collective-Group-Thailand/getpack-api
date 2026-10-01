import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { as, bootCommerceApp, type CommerceApp, staffToken } from '../support/commerce-e2e';

/**
 * U-B0.3 slice 1: staff directory (least privilege), segregation-of-duties rules, credit- and debit-note
 * reasons with their direction, the payment filter on customer documents (D-140, D-168, D-092).
 */
describe('admin platform reads (e2e, U-B0.3)', () => {
  let ctx: CommerceApp;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('lists colleagues without contact details, by role or by permission', async () => {
    const cs = await staffToken(ctx, 'cs');
    const all = await as(ctx, cs).get('/v1/admin/staff-directory').expect(200);
    const rows = all.body as { id: string; displayName: string; roles: string[] }[];
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['displayName', 'id', 'roles']);

    const leads = (await as(ctx, cs).get('/v1/admin/staff-directory?role=cs_lead').expect(200)).body as {
      roles: string[];
    }[];
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((r) => r.roles.includes('cs_lead'))).toBe(true);

    const approvers = (
      await as(ctx, cs).get('/v1/admin/staff-directory?permission=payments.verify_slip').expect(200)
    ).body as { roles: string[] }[];
    expect(approvers.some((r) => r.roles.includes('finance'))).toBe(true);
    expect(approvers.some((r) => r.roles.includes('marketing'))).toBe(false);

    await as(ctx, cs).get('/v1/admin/staff-directory?limit=51').expect(422);
    await as(ctx, cs).get('/v1/admin/staff-directory?q=x').expect(422);
  });

  it('reads the segregation-of-duties rules with users.read only', async () => {
    const admin = await staffToken(ctx, 'admin');
    const rules = (await as(ctx, admin).get('/v1/admin/sod-rules').expect(200)).body as {
      kind: string;
      left: string;
      right: string;
      enforcement: string;
    }[];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(['role_pair', 'action_pair']).toContain(rule.kind);
      expect(rule.left).not.toBe('');
      expect(rule.right).not.toBe('');
    }
    await as(ctx, await staffToken(ctx, 'marketing'))
      .get('/v1/admin/sod-rules')
      .expect(403);
  });

  it('lists credit-note reasons with their direction and filters documents by payment', async () => {
    const finance = await staffToken(ctx, 'finance');
    const reasons = (await as(ctx, finance).get('/v1/admin/credit-note-reasons').expect(200)).body as {
      code: string;
      direction: string;
    }[];
    const debit = reasons.filter((r) => r.direction === 'debit').map((r) => r.code);
    expect(debit.sort()).toEqual(['additional_charge', 'price_increase']);
    expect(reasons.find((r) => r.code === 'price_reduction')?.direction).toBe('credit');

    const none = await as(ctx, finance)
      .get(`/v1/admin/customer-documents?paymentId=${randomUUID()}`)
      .expect(200);
    expect(none.body.meta.total).toBe(0);
    await as(ctx, finance).get('/v1/admin/customer-documents?paymentId=nope').expect(422);
  });

  it('takes web vitals by route pattern only and sums them per day (RUM)', async () => {
    const sample = {
      name: 'LCP',
      value: 2000,
      rating: 'poor',
      id: 'v4-1',
      route: '/orders/[orderId]',
      zone: 'store',
    };
    await request(ctx.server).post('/v1/store/rum/web-vitals').send(sample).expect(202);
    await request(ctx.server)
      .post('/v1/store/rum/web-vitals')
      .send({ ...sample, value: 1000, rating: 'good' })
      .expect(202);
    await request(ctx.server)
      .post('/v1/store/rum/web-vitals')
      .send({ ...sample, route: '/orders/PK-2610-0001' })
      .expect(422);
    await request(ctx.server).post('/v1/admin/rum/web-vitals').send(sample).expect(401);
    const admin = await staffToken(ctx, 'admin');
    await as(ctx, admin)
      .post('/v1/admin/rum/web-vitals', { ...sample, zone: 'admin', route: '/orders' })
      .expect(202);

    const day = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const rows = (await as(ctx, admin).get(`/v1/admin/ops/web-vitals?date=${day}`).expect(200)).body as {
      zone: string;
      route: string;
      name: string;
      samples: number;
      poorPct: number;
    }[];
    const store = rows.find(
      (r) => r.zone === 'store' && r.route === '/orders/[orderId]' && r.name === 'LCP',
    )!;
    expect(store.samples).toBeGreaterThanOrEqual(2);
    expect(store.poorPct).toBeGreaterThan(0);
    await as(ctx, await staffToken(ctx, 'cs'))
      .get(`/v1/admin/ops/web-vitals?date=${day}`)
      .expect(403);
  });

  it('saves list views per staff member, shares them, and lets only the owner delete (U-B0.3)', async () => {
    const cs = await staffToken(ctx, 'cs');
    const lead = await staffToken(ctx, 'cs_lead');
    const resource = `orders-${ctx.run}`;
    const mine = await as(ctx, cs)
      .post('/v1/admin/saved-views', { resource, name: 'รอชำระ', query: { status: 'waiting_payment' } })
      .expect(201);
    expect(mine.body).toMatchObject({
      resource,
      columns: null,
      shared: false,
      owner: { id: expect.any(String) },
    });
    await as(ctx, cs).post('/v1/admin/saved-views', { resource, name: 'รอชำระ', query: {} }).expect(409);
    const shared = await as(ctx, cs)
      .post('/v1/admin/saved-views', {
        resource,
        name: 'ทีม',
        query: { status: 'in_production' },
        columns: ['orderCode', 'status'],
        shared: true,
      })
      .expect(201);
    await as(ctx, cs)
      .post('/v1/admin/saved-views', { resource: 'Orders!', name: 'x', query: {} })
      .expect(422);
    await as(ctx, cs)
      .post('/v1/admin/saved-views', { resource, name: 'ยาว', query: { q: 'x'.repeat(501) } })
      .expect(422);

    const forLead = await as(ctx, lead).get(`/v1/admin/saved-views?resource=${resource}`).expect(200);
    expect((forLead.body.data as { id: string }[]).map((v) => v.id)).toEqual([shared.body.id]);
    await as(ctx, lead)
      .delete(`/v1/admin/saved-views/${shared.body.id as string}`)
      .expect(403);
    await as(ctx, lead)
      .delete(`/v1/admin/saved-views/${mine.body.id as string}`)
      .expect(404);
    await as(ctx, cs)
      .delete(`/v1/admin/saved-views/${shared.body.id as string}`)
      .expect(204);
    const left = await as(ctx, cs).get(`/v1/admin/saved-views?resource=${resource}`).expect(200);
    expect(left.body.meta.total).toBe(1);
  });

  it('searches by code within the types I may read, and audits a look-up by e-mail (U-B0.3)', async () => {
    const admin = await staffToken(ctx, 'admin');
    const code = `SRCH${ctx.run}`;
    const vendor = await ctx.prisma.vendor.create({
      data: {
        kind: 'factory',
        legalName: `Search ${code} (fake)`,
        juristicType: 'company',
        taxId: '0000000000019',
      },
    });
    const factory = await ctx.prisma.factory.create({
      data: {
        code,
        vendorId: vendor.id,
        legalName: `Search ${code} (fake)`,
        juristicType: 'company',
        taxId: '0000000000019',
        branchCode: '00003',
        status: 'applied',
      },
    });
    const found = (
      await as(ctx, admin)
        .get(`/v1/admin/search?q=${encodeURIComponent(factory.code)}`)
        .expect(200)
    ).body as { data: { type: string; id: string }[] };
    expect(found.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'factory', id: factory.publicId })]),
    );
    // Marketing reads no factories: the type is left out.
    const marketing = await staffToken(ctx, 'marketing');
    const none = (
      await as(ctx, marketing)
        .get(`/v1/admin/search?q=${encodeURIComponent(factory.code)}`)
        .expect(200)
    ).body as { data: { type: string }[] };
    expect(none.data.some((r) => r.type === 'factory')).toBe(false);

    const before = await ctx.prisma.auditLog.count({ where: { action: 'admin_search.personal_data' } });
    const byEmail = (await as(ctx, admin).get('/v1/admin/search?q=finance@example.invalid').expect(200))
      .body as {
      data: { type: string; title: string }[];
    };
    expect(byEmail.data).toEqual([expect.objectContaining({ type: 'user' })]);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin_search.personal_data' } })).toBe(
      before + 1,
    );
    await as(ctx, admin).get('/v1/admin/search?q=x').expect(422);
  });
});
