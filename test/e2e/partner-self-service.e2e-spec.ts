import { randomUUID } from 'node:crypto';

import { addCalendarDays, bangkokDate } from '@common/time/bangkok';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import { as, foldingBackToRfq, foldingReady, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp, uploadBytes } from '../support/fulfilment-e2e';

interface ChangeRequest {
  id: string;
  topic: string;
  status: string;
  response: string | null;
  respondedBy: { id: string } | null;
  preferredDates: string[];
}

/**
 * U-B0.3 slice 12b: a factory's change requests answered by the Partner team, its site visits (date and result
 * only), the catalogue names behind its price lines, its capacity calendar with closures, and evidence on its own
 * price proposals — own factory only.
 */
describe('partner self-service (e2e, U-B0.3)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let owner: string;
  let qc: string;
  let partnerManager: string;
  let f: string;

  const post = (token: string, path: string, body: object = {}) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 91);
    qc = await factoryToken(ctx, fixture.factoryPublicId, 'factory_qc', 92);
    partnerManager = await staffToken(ctx, 'partner_manager');
    f = `/v1/partner/factories/${fixture.factoryPublicId}`;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('records a change request the Partner team answers', async () => {
    const tomorrow = addCalendarDays(bangkokDate(new Date()), 1);
    await post(owner, `${f}/change-requests`, { topic: 'site_visit', message: 'ขอนัดตรวจโรงงาน' }).expect(
      422,
    );
    await post(owner, `${f}/change-requests`, {
      topic: 'site_visit',
      message: 'ขอนัดตรวจโรงงาน',
      preferredDates: [bangkokDate(new Date())],
    }).expect(422);
    await post(qc, `${f}/change-requests`, { topic: 'capacity', message: 'ขอเพิ่มกำลังผลิต' }).expect(403);
    const created = (
      await post(owner, `${f}/change-requests`, {
        topic: 'site_visit',
        message: `ขอนัดตรวจโรงงานหลังติดตั้งเครื่องใหม่ ${ctx.run}`,
        preferredDates: [tomorrow, tomorrow],
      }).expect(201)
    ).body as ChangeRequest;
    expect(created).toMatchObject({ topic: 'site_visit', status: 'open', preferredDates: [tomorrow] });
    expect(
      await ctx.prisma.domainEvent.count({
        where: { type: 'factory_change_request.created', aggregateId: created.id },
      }),
    ).toBe(1);

    const queue = (
      await as(ctx, partnerManager)
        .get(`/v1/admin/factory-change-requests?status=open&factoryId=${fixture.factoryPublicId}&perPage=100`)
        .expect(200)
    ).body.data as ChangeRequest[];
    expect(queue.map((r) => r.id)).toContain(created.id);
    const answer = `/v1/admin/factory-change-requests/${created.id}/actions/answer`;
    await post(await staffToken(ctx, 'cs'), answer, { status: 'in_progress' }).expect(403);
    await post(partnerManager, answer, { status: 'in_progress' }).expect(200);
    await post(partnerManager, answer, { status: 'done' }).expect(422);
    const done = (
      await post(partnerManager, answer, { status: 'done', response: 'นัดตรวจแล้ว (fake)' }).expect(200)
    ).body as ChangeRequest;
    expect(done).toMatchObject({
      status: 'done',
      response: 'นัดตรวจแล้ว (fake)',
      respondedBy: { id: expect.any(String) },
    });
    await post(partnerManager, answer, { status: 'declined', response: 'x' }).expect(409);

    const mine = (await as(ctx, qc).get(`${f}/change-requests?status=done&perPage=100`).expect(200)).body
      .data as ChangeRequest[];
    expect(mine.find((r) => r.id === created.id)?.response).toBe('นัดตรวจแล้ว (fake)');
    expect(
      await ctx.prisma.domainEvent.count({
        where: { type: 'factory_change_request.answered', aggregateId: created.id },
      }),
    ).toBe(2);
  });

  it('shows the factory its site visits, price references and capacity calendar', async () => {
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
    });
    const recorder = await ctx.prisma.user.findFirstOrThrow({ where: { kind: 'staff' } });
    const visit = await ctx.prisma.siteVisit.create({
      data: {
        factoryId: factory.id,
        visitedOn: new Date('2026-09-20T00:00:00Z'),
        checklistVersion: 'e2e-v1',
        checklist: { safety: 'ok' },
        result: 'pass',
        notes: 'ภายใน: ไม่แสดงต่อโรงงาน',
        recordedById: recorder.id,
      },
    });
    const visits = (await as(ctx, owner).get(`${f}/site-visits`).expect(200)).body as Record<
      string,
      unknown
    >[];
    const shown = visits.find((v) => v['id'] === visit.publicId)!;
    expect(shown).toEqual({
      id: visit.publicId,
      visitedOn: '2026-09-20',
      result: 'pass',
      createdAt: expect.any(String),
    });

    const refs = (await as(ctx, owner).get(`${f}/references`).expect(200)).body as {
      productTypes: { code: string }[];
      items: { catalogue: string; id: string; code: string | null; nameTh: string | null }[];
    };
    expect(refs.productTypes.map((t) => t.code)).toContain('folding_carton');
    expect(refs.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          catalogue: 'materials',
          id: fixture.materialPublicId,
          nameTh: expect.any(String),
        }),
        expect.objectContaining({ catalogue: 'print_types', id: fixture.printTypePublicId }),
      ]),
    );
    expect(JSON.stringify(refs)).not.toMatch(/rate|price"/);

    // A closure of the factory (from tomorrow on, D-209) shows on its calendar. The dev factory gets the own
    // calendar a registered factory has (factories.service).
    if (factory.calendarId === null) {
      const national = await ctx.prisma.businessCalendar.findUniqueOrThrow({ where: { code: 'th_public' } });
      const own = await ctx.prisma.businessCalendar.create({
        data: {
          code: `factory_${factory.code.toLowerCase()}`,
          name: `${factory.code} closures`,
          kind: 'factory',
          factoryId: factory.id,
          weekendDays: national.weekendDays,
          baseCalendarId: national.id,
        },
      });
      await ctx.prisma.factory.update({ where: { id: factory.id }, data: { calendarId: own.id } });
    }
    const day = addCalendarDays(bangkokDate(new Date()), 10);
    await as(ctx, partnerManager)
      .put(`/v1/admin/factories/${fixture.factoryPublicId}/closures/${day}`, { nameTh: 'ปิดซ่อมบำรุง (e2e)' })
      .set('Idempotency-Key', randomUUID())
      .expect((r) => expect([200, 201]).toContain(r.status));
    try {
      await as(ctx, owner).get(`${f}/capacity-calendar?weeks=27`).expect(422);
      const calendar = (await as(ctx, owner).get(`${f}/capacity-calendar?weeks=4`).expect(200)).body as {
        from: string;
        to: string;
        productTypes: { productTypeCode: string; weeks: { weekStart: string; free: string }[] }[];
        days: { day: string; kind: string; source: string }[];
      };
      expect(new Date(`${calendar.from}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(calendar.to).toBe(addCalendarDays(calendar.from, 27));
      const folding = calendar.productTypes.find((t) => t.productTypeCode === 'folding_carton');
      expect(folding?.weeks.length).toBeGreaterThan(0);
      expect(folding?.weeks[0]?.free).toMatch(/^\d+\.\d{3}$/);
      expect(calendar.days).toContainEqual(
        expect.objectContaining({ day, kind: 'closure', source: 'factory' }),
      );
    } finally {
      await as(ctx, partnerManager)
        .delete(`/v1/admin/factories/${fixture.factoryPublicId}/closures/${day}`)
        .set('Idempotency-Key', randomUUID());
    }
  });

  it('keeps evidence on the factory’s own open proposal', async () => {
    const list = await ctx.prisma.priceList.findFirstOrThrow({
      where: { factory: { publicId: fixture.factoryPublicId } },
    });
    const open =
      (await ctx.prisma.priceProposal.findFirst({
        where: { priceListId: list.id, status: { in: ['draft', 'submitted', 'under_review', 'countered'] } },
      })) ??
      (await ctx.prisma.priceProposal.create({
        data: { priceListId: list.id, direction: 'factory_to_packio', proposedEffectiveFrom: new Date() },
      }));
    const closed = await ctx.prisma.priceProposal.create({
      data: {
        priceListId: list.id,
        direction: 'factory_to_packio',
        status: 'withdrawn',
        proposedEffectiveFrom: new Date(),
      },
    });
    const upload = (token: string) =>
      uploadBytes(ctx, token, Buffer.from(`quote ${randomUUID()}`), {
        purpose: 'document',
        fileName: 'supplier-quote.pdf',
        mimeType: 'application/pdf',
        surface: 'partner',
      });
    const file = await upload(owner);
    const url = `${f}/price-proposals/${open.publicId}/evidence`;
    await post(owner, url, { fileId: await upload(qc), note: 'ไม่ใช่ไฟล์ของฉัน' }).expect(422);
    const added = (await post(owner, url, { fileId: file, note: 'ใบเสนอราคากระดาษ (fake)' }).expect(201))
      .body as { fileId: string; note: string; fileName: string }[];
    expect(added).toContainEqual(
      expect.objectContaining({
        fileId: file,
        note: 'ใบเสนอราคากระดาษ (fake)',
        fileName: 'supplier-quote.pdf',
      }),
    );
    await post(owner, url, { fileId: file }).expect(409);
    await post(owner, `${f}/price-proposals/${closed.publicId}/evidence`, {
      fileId: await upload(owner),
    }).expect(409);
    expect(
      ((await as(ctx, owner).get(url).expect(200)).body as { fileId: string }[]).map((e) => e.fileId),
    ).toContain(file);
    const review = (
      await as(ctx, await staffToken(ctx, 'partner_manager'))
        .get(`/v1/admin/price-proposals/${open.publicId}/evidence`)
        .expect(200)
    ).body as { fileId: string }[];
    expect(review.map((e) => e.fileId)).toContain(file);
    // Another factory's id on the path is 404.
    await as(ctx, owner)
      .get(`/v1/partner/factories/${randomUUID()}/price-proposals/${open.publicId}/evidence`)
      .expect(404);
  });
});
