import { randomBytes, randomUUID } from 'node:crypto';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  seedShipping,
  staffToken,
} from '../support/commerce-e2e';

const DAY_MS = 86_400_000;

/** U-B0.1 slice 8: profile prompt signal, removing a sign-in method, PDPA requests (D-222). */
describe('account & privacy (e2e, U-B0.1)', () => {
  let ctx: CommerceApp;
  let fixture: DevFolding;
  let postcode: string;
  let dpo: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    fixture = await foldingReady(ctx);
    postcode = postcodes(ctx, 1)[0]!;
    await seedShipping(ctx, fixture.factoryPublicId, [postcode]);
    dpo = await staffToken(ctx, 'dpo');
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const userOf = (phone: string) => ctx.prisma.user.findFirstOrThrow({ where: { phone } });

  it('tells the storefront whether the customer has saved their profile', async () => {
    const { token } = await customerToken(ctx, 1);
    const before = await as(ctx, token).get('/v1/store/customer-profile').expect(200);
    expect(before.body.profileCompletedAt).toBeNull();
    const after = await as(ctx, token)
      .patch('/v1/store/customer-profile', { customerType: 'juristic', firstName: 'Somchai' })
      .set('If-Match', before.headers['etag'] as string)
      .expect(200);
    expect(after.body.profileCompletedAt).not.toBeNull();
  });

  it('removes a sign-in method, never the phone or the last one, and signs out its sessions', async () => {
    const { token, phone } = await customerToken(ctx, 2);
    const user = await userOf(phone);
    const api = as(ctx, token);
    expect((await api.delete('/v1/store/me/identities/phone_otp').expect(409)).body.code).toBe(
      'auth.identity_not_unlinkable',
    );
    await api.delete('/v1/store/me/identities/line').expect(404);
    await api.delete('/v1/store/me/identities/nope').expect(404);

    const line = await ctx.prisma.userIdentity.create({
      data: { userId: user.id, provider: 'line', providerSubject: `U${ctx.run}fake` },
    });
    const session = await ctx.prisma.authSession.create({
      data: {
        userId: user.id,
        audience: 'customer',
        familyId: randomUUID(),
        refreshTokenHash: randomBytes(32),
        loginMethod: 'line',
        expiresAt: new Date(Date.now() + DAY_MS),
        idleExpiresAt: new Date(Date.now() + DAY_MS),
      },
    });
    const me = await api.delete('/v1/store/me/identities/line').expect(200);
    expect((me.body.identities as { provider: string }[]).map((i) => i.provider)).toEqual(['phone_otp']);
    expect(
      (await ctx.prisma.userIdentity.findUniqueOrThrow({ where: { id: line.id } })).unlinkedAt,
    ).not.toBeNull();
    expect(
      (await ctx.prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt,
    ).not.toBeNull();
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'customer.identity_unlinked', resourcePublicId: user.publicId },
      }),
    ).toBe(1);

    // Only a LINE sign-in left: it cannot go.
    await ctx.prisma.userIdentity.create({
      data: { userId: user.id, provider: 'line', providerSubject: `U${ctx.run}fake2` },
    });
    await ctx.prisma.userIdentity.updateMany({
      where: { userId: user.id, provider: 'phone_otp' },
      data: { unlinkedAt: new Date() },
    });
    expect((await api.delete('/v1/store/me/identities/line').expect(409)).body.code).toBe(
      'auth.identity_last_method',
    );
  });

  it('exports my data to a file I can download for a week, one open request per kind (D-222)', async () => {
    const { token, phone } = await customerToken(ctx, 3);
    const api = as(ctx, token);
    const created = await api
      .post('/v1/store/me/privacy-requests', { kind: 'export' })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(created.body).toMatchObject({ kind: 'export', status: 'submitted', export: null });
    expect(Date.parse(created.body.dueAt) - Date.parse(created.body.requestedAt)).toBeGreaterThanOrEqual(
      30 * DAY_MS - 1000,
    );
    expect(
      (
        await api
          .post('/v1/store/me/privacy-requests', { kind: 'export' })
          .set('Idempotency-Key', randomUUID())
          .expect(409)
      ).body.code,
    ).toBe('privacy.request_open');

    await api.get('/v1/admin/privacy-requests').expect(403);
    const queue = await as(ctx, dpo)
      .get('/v1/admin/privacy-requests?status=submitted&perPage=100')
      .expect(200);
    expect(queue.body.data).toContainEqual(expect.objectContaining({ id: created.body.id, overdue: false }));
    const done = await as(ctx, dpo)
      .post(`/v1/admin/privacy-requests/${created.body.id}/actions/complete`, { answer: 'ส่งแล้ว' })
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect(done.body).toMatchObject({ status: 'completed', answer: 'ส่งแล้ว' });

    const mine = (await api.get('/v1/store/me/privacy-requests').expect(200)).body as {
      export: { fileId: string; expiresAt: string } | null;
    }[];
    const file = await ctx.prisma.fileObject.findUniqueOrThrow({
      where: { publicId: mine[0]!.export!.fileId },
    });
    const owner = await userOf(phone);
    expect(file).toMatchObject({ ownerUserId: owner.id, mimeType: 'application/json' });
    expect(Date.parse(mine[0]!.export!.expiresAt) - Date.parse(done.body.decidedAt)).toBe(7 * DAY_MS);
    await as(ctx, dpo)
      .post(`/v1/admin/privacy-requests/${created.body.id}/actions/reject`, { answer: 'late (fake)' })
      .expect(409);
  });

  it('refuses a deletion while an order is open, anonymises once nothing is (D-222)', async () => {
    const busy = await customerToken(ctx, 4);
    await placeOrder(ctx, busy.token, fixture, postcode);
    const blocked = await as(ctx, busy.token)
      .post('/v1/store/me/privacy-requests', { kind: 'deletion', note: 'please (fake)' })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const refused = await as(ctx, dpo)
      .post(`/v1/admin/privacy-requests/${blocked.body.id}/actions/complete`, {})
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    expect(refused.body.code).toBe('privacy.deletion_blocked');
    await as(ctx, dpo)
      .post(`/v1/admin/privacy-requests/${blocked.body.id}/actions/reject`, {
        answer: 'มีคำสั่งซื้อค้างอยู่ (fake)',
      })
      .expect(200);

    const quiet = await customerToken(ctx, 5);
    const user = await userOf(quiet.phone);
    const request = await as(ctx, quiet.token)
      .post('/v1/store/me/privacy-requests', { kind: 'deletion' })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await as(ctx, dpo)
      .post(`/v1/admin/privacy-requests/${request.body.id}/actions/complete`, {})
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    const gone = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(gone).toMatchObject({
      phone: null,
      email: null,
      status: 'inactive',
      displayName: 'ลูกค้าที่ลบข้อมูลแล้ว',
    });
    expect(gone.anonymisedAt).not.toBeNull();
    expect(await ctx.prisma.userIdentity.count({ where: { userId: user.id, unlinkedAt: null } })).toBe(0);
    expect(await ctx.prisma.authSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    // Sign-ins are removed and sessions revoked: no refresh works; a live access token stops at the principal
    // cache's next check (≤ 30 s), as for a suspended user.
  });
});
