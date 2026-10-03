import { randomUUID } from 'node:crypto';

import { addCalendarDays, bangkokDate } from '@common/time/bangkok';
import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  activeCompany,
  addAddress,
  as,
  customerToken,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  postcodes,
  seedShipping,
  staffToken,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, type FulfilmentApp } from '../support/fulfilment-e2e';

const DOC = { content: { pattern: { kind: 'none' }, elements: [] } };

/** U4.B6 collaboration, studio funnel and design-service hand-off (D-285, D-286). */
describe('studio collaboration (e2e, U4.B6)', () => {
  let ctx: FulfilmentApp;
  let productId: string;
  let owner: Awaited<ReturnType<typeof customerToken>>;
  let member: Awaited<ReturnType<typeof customerToken>>;
  let outsider: Awaited<ReturnType<typeof customerToken>>;
  let companyId: string;
  let designId: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    productId = (await ctx.prisma.catalogProduct.findFirstOrThrow({ select: { publicId: true } })).publicId;
    owner = await customerToken(ctx, 101);
    member = await customerToken(ctx, 102);
    outsider = await customerToken(ctx, 103);
    companyId = await activeCompany(ctx, owner.token, 101, [{ ...member, roles: ['company_buyer'] }]);
    designId = (
      await as(ctx, owner.token)
        .post('/v1/store/designs', {
          catalogProductId: productId,
          companyId,
          title: 'ทีมออกแบบ (fake)',
          document: DOC,
        })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const share = async (scope: string) =>
    (await as(ctx, owner.token).post(`/v1/store/studio/${designId}/share-links`, { scope }).expect(201))
      .body as {
      id: string;
      token: string;
    };

  it('keeps a design of my company only for its members', async () => {
    const res = await as(ctx, outsider.token)
      .post('/v1/store/designs', { catalogProductId: productId, companyId, title: 'x', document: DOC })
      .expect(422);
    expect(res.body.errors[0].path).toBe('companyId');
  });

  it('shares with scopes: view reads, comment lets signed-in users comment, revoked links stop at once', async () => {
    const view = await share('view');
    const comment = await share('comment');
    const opened = await request(ctx.server).get(`/v1/store/shared-designs/${comment.token}`).expect(200);
    expect(opened.body).toMatchObject({ scope: 'comment', title: 'ทีมออกแบบ (fake)' });
    const links = await as(ctx, owner.token).get(`/v1/store/studio/${designId}/share-links`).expect(200);
    expect(JSON.stringify(links.body)).not.toContain(comment.token);

    await request(ctx.server)
      .post(`/v1/store/studio/shared/${comment.token}/comments`)
      .send({ body: 'x' })
      .expect(401);
    const refused = await as(ctx, outsider.token)
      .post(`/v1/store/studio/shared/${view.token}/comments`, { body: 'ดูได้อย่างเดียว' })
      .expect(403);
    expect(refused.body.code).toBe('designs.share_scope');
    const added = await as(ctx, outsider.token)
      .post(`/v1/store/studio/shared/${comment.token}/comments`, {
        body: 'ขอโลโก้ใหญ่ขึ้น (fake)',
        anchor: { faceId: 'front', u: 0.5, v: 0.25 },
      })
      .expect(201);
    expect(added.body).toMatchObject({ anchor: { faceId: 'front', u: 0.5, v: 0.25 }, versionNo: 1 });

    await as(ctx, owner.token)
      .post(`/v1/store/studio/${designId}/share-links/${comment.id}/actions/revoke`)
      .expect(204);
    await request(ctx.server).get(`/v1/store/shared-designs/${comment.token}`).expect(404);
    await ctx.pump({ notifications: true });
    expect(
      await ctx.prisma.notification.count({
        where: { event: { type: 'design.commented', aggregateId: designId } },
      }),
    ).toBeGreaterThan(0);
  });

  it('threads, mentions company members and resolves; edit links work for members only', async () => {
    const memberUser = await ctx.prisma.user.findFirstOrThrow({
      where: { phone: { endsWith: member.phone.slice(-8) } },
    });
    const outsiderUser = await ctx.prisma.user.findFirstOrThrow({
      where: { phone: { endsWith: outsider.phone.slice(-8) } },
    });
    const bad = await as(ctx, owner.token)
      .post(`/v1/store/studio/${designId}/comments`, { body: 'ดูหน่อย', mentions: [outsiderUser.publicId] })
      .expect(422);
    expect(bad.body.errors[0].path).toBe('mentions[0]');
    const thread = await as(ctx, owner.token)
      .post(`/v1/store/studio/${designId}/comments`, {
        body: 'ช่วยดูสีหน่อย (fake)',
        anchor: { xMm: 120, yMm: 40 },
        mentions: [memberUser.publicId],
      })
      .expect(201);
    expect(thread.body.mentions).toEqual([memberUser.publicId]);
    const reply = await as(ctx, member.token)
      .post(`/v1/store/studio/${designId}/comments`, { body: 'โอเค (fake)', parentId: thread.body.id })
      .expect(201);
    expect(reply.body.parentId).toBe(thread.body.id);
    await as(ctx, member.token)
      .post(`/v1/store/studio/${designId}/comments/${reply.body.id}/actions/resolve`)
      .expect(409);
    const resolved = await as(ctx, member.token)
      .post(`/v1/store/studio/${designId}/comments/${thread.body.id}/actions/resolve`)
      .expect(200);
    expect(resolved.body.resolvedBy.id).toBe(memberUser.publicId);
    await as(ctx, outsider.token).get(`/v1/store/studio/${designId}/comments`).expect(404);
    await ctx.pump({ notifications: true });
    const mentioned = await ctx.prisma.notification.count({
      where: { recipientUserId: memberUser.id, event: { type: 'design.comment_mentioned' } },
    });
    expect(mentioned).toBeGreaterThan(0);

    const edit = await share('edit');
    const opened = await request(ctx.server).get(`/v1/store/shared-designs/${edit.token}`).expect(200);
    const etag = opened.headers['etag'] as string;
    expect(etag).toBeTruthy();
    const ops = { operations: [{ op: 'add', path: '/note', value: 'member edit (fake)' }] };
    const denied = await as(ctx, outsider.token)
      .patch(`/v1/store/studio/shared/${edit.token}/document`)
      .set('If-Match', etag)
      .send(ops)
      .expect(403);
    expect(denied.body.code).toBe('designs.share_scope');
    const saved = await as(ctx, member.token)
      .patch(`/v1/store/studio/shared/${edit.token}/document`)
      .set('If-Match', etag)
      .send(ops)
      .expect(200);
    expect(saved.body.document).toMatchObject({ note: 'member edit (fake)' });
  });

  it('reports the studio funnel against the spec targets (D-286)', async () => {
    // The analytics-cookie text in force (legal content is entered by admins, never seeded — D-005).
    await as(ctx, await staffToken(ctx, 'superadmin')).post(
      '/v1/admin/consent-purposes/analytics_cookies/versions',
      {
        textTh: 'ยินยอมให้ใช้คุกกี้เพื่อการวิเคราะห์ (ทดสอบ)',
        textEn: 'Analytics cookies (test text)',
        effectiveFrom: new Date(Date.now() - 1000).toISOString(),
        reason: 'e2e studio funnel',
      },
    );
    const anonymousId = randomUUID();
    const sessionId = `s-${randomUUID().slice(0, 12)}`;
    await request(ctx.server)
      .post('/v1/store/analytics/consent')
      .send({ anonymousId, granted: true })
      .expect(200);
    const at = (minutes: number) => new Date(Date.now() - (30 - minutes) * 60_000).toISOString();
    const events = [
      ['studio_started', 0, {}],
      ['studio_box_confirmed', 2, { printMethod: 'digital' }],
      ['studio_first_artwork', 4, {}],
      ['studio_checks_clean', 6, {}],
      ['studio_add_to_cart', 8, { quantity: 1000 }],
    ].map(([name, minutes, properties]) => ({
      eventId: randomUUID(),
      name,
      occurredAt: at(minutes as number),
      anonymousId,
      sessionId,
      deviceClass: 'desktop',
      properties,
    }));
    const ingested = await request(ctx.server).post('/v1/store/analytics/events').send({ events });
    expect(ingested.status).toBeLessThan(300);
    const admin = await staffToken(ctx, 'admin');
    // Bangkok days: the UTC date is yesterday before 07:00 in Bangkok.
    const day = bangkokDate(new Date());
    const yesterday = addCalendarDays(day, -1);
    const report = await as(ctx, admin)
      .get(`/v1/admin/analytics/studio-funnel?from=${yesterday}&to=${day}`)
      .expect(200);
    expect(report.body.steps[0]).toMatchObject({ step: 'studio_started', sessions: expect.any(Number) });
    expect(report.body.steps[0].sessions).toBeGreaterThanOrEqual(1);
    expect(report.body.medianMinutesToCart).toMatchObject({ target: '10', basis: expect.any(Number) });
    expect(Number(report.body.medianMinutesToCart.value)).toBeGreaterThan(0);
    expect(report.body.priceParityPct.target).toBe('100');
  });

  it('hands a studio design to the design service; the assigned designer edits that document only (D-286)', async () => {
    const fixture: DevFolding = await foldingReady(ctx);
    const [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    const { quantities: _q, ...spec } = foldingConfiguration(fixture, [1000], true);
    void _q;
    const studioProduct = (
      await ctx.prisma.catalogProduct.findUniqueOrThrow({ where: { slug: 'dev-tuck-end-box' } })
    ).publicId;
    const design = await as(ctx, owner.token)
      .post('/v1/store/designs', {
        catalogProductId: studioProduct,
        patternId: fixture.patternPublicId,
        title: 'ให้ทีมออกแบบ (fake)',
        document: DOC,
        lengthMm: spec.l,
        widthMm: spec.w,
        heightMm: spec.d,
        measurementBasis: 'product',
        materialId: fixture.materialPublicId,
        printSides: 'outside',
        spec,
      })
      .expect(201);
    const quote = await as(ctx, owner.token)
      .post(`/v1/store/studio/${design.body.id}/quote/actions/save`, {
        quantities: [1000],
        deliveryPostcode: code,
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const address = await addAddress(ctx, owner.token, code);
    const handed = await as(ctx, owner.token)
      .post(`/v1/store/studio/${design.body.id}/design-service`, {
        quoteId: quote.body.id,
        quoteOptionId: quote.body.options[0].id,
        destinations: [{ addressId: address.id, quantity: 1000 }],
      })
      .expect(201);
    expect(handed.body.designVersionNo).toBe(1);
    const placed = await as(ctx, owner.token)
      .post('/v1/store/checkout', {})
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await ctx.pump();
    const orderId = (placed.body.orders as { id: string }[]).at(-1)!.id;
    const dsr = await ctx.prisma.designServiceRequest.findFirstOrThrow({
      where: { order: { publicId: orderId } },
      include: { designDocument: true },
    });
    expect(dsr.designDocument?.publicId).toBe(design.body.id);
    expect((dsr.brief as { description: string }).description).toContain('ให้ทีมออกแบบ (fake)');

    const prepress = await staffToken(ctx, 'prepress');
    const designer = await ctx.prisma.user.findFirstOrThrow({ where: { email: 'prepress@example.invalid' } });
    const save = (token: string, etag: string, id: string) =>
      as(ctx, token)
        .put(`/v1/admin/designs/${id}`)
        .set('If-Match', etag)
        .send({ schemaVersion: 1, document: { ...DOC, note: 'designer' } });
    const before = await as(ctx, prepress).get(`/v1/admin/designs/${design.body.id}`).expect(200);
    expect(before.body.editable).toBe(false);
    await save(prepress, before.headers['etag'] as string, design.body.id as string).expect(409);
    const manager = await staffToken(ctx, 'admin');
    await as(ctx, manager)
      .post(`/v1/admin/design-services/${dsr.publicId}/actions/assign`, { assigneeUserId: designer.publicId })
      .expect(200);
    const after = await as(ctx, prepress).get(`/v1/admin/designs/${design.body.id}`).expect(200);
    expect(after.body.editable).toBe(true);
    await save(prepress, after.headers['etag'] as string, design.body.id as string).expect(200);
    // Another customer design stays read-only for the designer.
    const other = await as(ctx, prepress).get(`/v1/admin/designs/${designId}`).expect(200);
    await save(prepress, other.headers['etag'] as string, designId).expect(409);
  });
});
