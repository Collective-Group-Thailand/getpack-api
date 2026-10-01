import { randomUUID } from 'node:crypto';

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
});
