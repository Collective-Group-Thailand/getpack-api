import { DesignChecksSubscriber } from '@modules/studio/design-checks.subscriber';
import { type DomainEventEnvelope } from '@platform/domain-events/domain-event';
import request from 'supertest';

import { as, bootCommerceApp, type CommerceApp, customerToken } from '../support/commerce-e2e';

/** A studio document (getpack-web designer v2): elements in sheet millimetres. */
const doc = (imagePx: number) => ({
  spec: { styleId: 'tuck-end' },
  content: {
    pattern: { kind: 'none' },
    elements: [
      {
        id: 'logo',
        type: 'image',
        naturalWidth: imagePx,
        naturalHeight: imagePx,
        width: 100,
        height: 100,
        scaleX: 1,
        scaleY: 1,
      },
      { id: 'ean', type: 'code', kind: 'ean13', value: '8851234567898', width: 40, scaleX: 1 },
    ],
  },
});

/** U4.B3 print-check rules shared with the web (D-278, D-279, D-283). */
describe('studio print checks (e2e, U4.B3)', () => {
  let ctx: CommerceApp;
  let token: string;
  let productId: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    token = (await customerToken(ctx, 81)).token;
    productId = (await ctx.prisma.catalogProduct.findFirstOrThrow({ select: { publicId: true } })).publicId;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('serves the rule catalogue and the soft-proof label without signing in', async () => {
    const res = await request(ctx.server).get('/v1/store/studio/rules').expect(200);
    const ids = (res.body.rules as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining(['image_resolution', 'bleed', 'barcode_invalid', 'min_text_size']),
    );
    const rules = res.body.rules as { id: string; thresholds: unknown }[];
    expect(rules.find((r) => r.id === 'min_text_size')!.thresholds).toBeNull();
    expect(res.body.softProof).toEqual({
      label: { th: expect.any(String), en: 'Preview, not a contract proof' },
      profiles: [],
    });
  });

  it('checks a version once per catalogue, blocks low resolution and lets a warning be accepted', async () => {
    const created = await as(ctx, token)
      .post('/v1/store/designs', { catalogProductId: productId, title: 'ตรวจงาน (fake)', document: doc(300) })
      .expect(201);
    const id = created.body.id as string;
    const first = await as(ctx, token).post(`/v1/store/studio/${id}/checks`, {}).expect(200);
    expect(first.body).toMatchObject({
      versionNo: 1,
      source: 'document',
      counts: { block: 1, warn: 0 },
      ready: false,
      findings: [{ ruleId: 'image_resolution', severity: 'block', elementId: 'logo', details: { ppi: 76 } }],
    });
    const refused = await as(ctx, token)
      .post(`/v1/store/studio/${id}/checks/acknowledgements`, {
        ruleId: 'image_resolution',
        elementId: 'logo',
      })
      .expect(409);
    expect(refused.body.code).toBe('studio.block_not_acknowledgeable');
    // Same version, same catalogue: the stored run.
    await as(ctx, token).post(`/v1/store/studio/${id}/checks`, {}).expect(200);
    const version = await ctx.prisma.designDocumentVersion.findFirstOrThrow({
      where: { designDocument: { publicId: id } },
    });
    expect(await ctx.prisma.designCheckRun.count({ where: { versionId: version.id } })).toBe(1);

    // A better image: a warning only, accepted by the customer.
    const fixed = await as(ctx, token)
      .patch(`/v1/store/designs/${id}/document`)
      .set('If-Match', created.headers['etag'] as string)
      .send({
        operations: [
          { op: 'replace', path: '/content/elements/0/naturalWidth', value: 1000 },
          { op: 'replace', path: '/content/elements/0/naturalHeight', value: 1000 },
        ],
      })
      .expect(200);
    expect(fixed.body.versionNo).toBe(2);
    const second = await as(ctx, token).post(`/v1/store/studio/${id}/checks`, {}).expect(200);
    expect(second.body).toMatchObject({
      versionNo: 2,
      counts: { block: 0, warn: 1 },
      ready: false,
      findings: [
        { ruleId: 'image_resolution', severity: 'warn', details: { ppi: 254 }, acknowledged: false },
      ],
    });
    const acked = await as(ctx, token)
      .post(`/v1/store/studio/${id}/checks/acknowledgements`, {
        ruleId: 'image_resolution',
        elementId: 'logo',
      })
      .expect(200);
    expect(acked.body).toMatchObject({ ready: true, findings: [{ acknowledged: true }] });
    const ack = await ctx.prisma.designCheckAcknowledgement.findFirstOrThrow({
      where: { version: { designDocument: { publicId: id } } },
    });
    expect(ack.userId).toBeDefined();
    await expect(ctx.prisma.designCheckAcknowledgement.delete({ where: { id: ack.id } })).rejects.toThrow();
    // The earlier version is still blocked: acknowledgements are per version.
    const v1 = await as(ctx, token).post(`/v1/store/studio/${id}/checks`, { versionNo: 1 }).expect(200);
    expect(v1.body.ready).toBe(false);
  });

  it('tells the design list what still needs checking once the worker checked the save (UX r2 A4)', async () => {
    const created = await as(ctx, token)
      .post('/v1/store/designs', {
        catalogProductId: productId,
        title: 'ตรวจในรายการ (fake)',
        document: doc(300),
      })
      .expect(201);
    const id = created.body.id as string;
    const listed = async () =>
      (
        (await as(ctx, token).get('/v1/store/designs?perPage=100').expect(200)).body.data as {
          id: string;
          issueCount: number | null;
          hasIssues: boolean | null;
          issueSummary: { code: string; severity: string; count: number; messageTh: string }[];
        }[]
      ).find((d) => d.id === id)!;
    expect(await listed()).toMatchObject({ issueCount: null, hasIssues: null, issueSummary: [] });

    const saved = (designId: string) =>
      ctx.app
        .get(DesignChecksSubscriber)
        .onSaved({ payload: { designId } } as unknown as DomainEventEnvelope);
    await saved(id);
    await saved(id); // idempotent: the stored run is kept
    expect(await listed()).toMatchObject({
      issueCount: 1,
      hasIssues: true,
      issueSummary: [
        { code: 'image_resolution', severity: 'block', count: 1, messageTh: expect.any(String) },
      ],
    });
    const detail = await as(ctx, token).get(`/v1/store/designs/${id}`).expect(200);
    expect(detail.body.issueCount).toBe(1);

    const fixed = await as(ctx, token)
      .patch(`/v1/store/designs/${id}/document`)
      .set('If-Match', created.headers['etag'] as string)
      .send({
        operations: [
          { op: 'replace', path: '/content/elements/0/naturalWidth', value: 1000 },
          { op: 'replace', path: '/content/elements/0/naturalHeight', value: 1000 },
        ],
      })
      .expect(200);
    expect(fixed.body.issueCount).toBeNull(); // the new version is not checked yet
    await saved(id);
    expect(await listed()).toMatchObject({ issueCount: 1, issueSummary: [{ severity: 'warn' }] });
    await as(ctx, token)
      .post(`/v1/store/studio/${id}/checks/acknowledgements`, {
        ruleId: 'image_resolution',
        elementId: 'logo',
      })
      .expect(200);
    expect(await listed()).toMatchObject({ issueCount: 0, hasIssues: false, issueSummary: [] });
  });

  it('flags an invalid barcode and refuses acknowledging what is not a finding', async () => {
    const bad = doc(4000);
    (bad.content.elements[1] as { value: string }).value = '8851234567890';
    const created = await as(ctx, token)
      .post('/v1/store/designs', { catalogProductId: productId, title: 'บาร์โค้ด (fake)', document: bad })
      .expect(201);
    const id = created.body.id as string;
    await as(ctx, token)
      .post(`/v1/store/studio/${id}/checks/acknowledgements`, { ruleId: 'hairline' })
      .expect(409);
    const run = await as(ctx, token).post(`/v1/store/studio/${id}/checks`, {}).expect(200);
    expect(run.body.findings).toEqual([
      expect.objectContaining({
        ruleId: 'barcode_invalid',
        severity: 'block',
        details: { problems: ['check_digit'] },
      }),
    ]);
    const missing = await as(ctx, token)
      .post(`/v1/store/studio/${id}/checks/acknowledgements`, { ruleId: 'hairline' })
      .expect(422);
    expect(missing.body.errors[0].path).toBe('ruleId');
    const other = (await customerToken(ctx, 82)).token;
    await as(ctx, other).post(`/v1/store/studio/${id}/checks`, {}).expect(404);
  });

  it('answers two concurrent checks of one version with the same stored run (create-or-return)', async () => {
    // getpack-web integration.md (U4.5): the second of two parallel runs broke the unique key and answered 500.
    const created = await as(ctx, token)
      .post('/v1/store/designs', { catalogProductId: productId, title: 'คู่ขนาน (fake)', document: doc(300) })
      .expect(201);
    const id = created.body.id as string;
    const runs = await Promise.all(
      [1, 2, 3].map(() => as(ctx, token).post(`/v1/store/studio/${id}/checks`, {})),
    );
    expect(runs.map((r) => r.status)).toEqual([200, 200, 200]);
    const stored = await ctx.prisma.designCheckRun.count({
      where: { version: { designDocument: { publicId: id } }, source: 'document' },
    });
    expect(stored).toBe(1);
  });
});
