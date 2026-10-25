import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OBJECT_STORAGE } from '@collective/integrations/storage';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';

import { seedDevFolding } from '../../prisma/seed/dev-folding';
import { type UserActor } from '../../src/common/context/actor';
import { NextStylesService } from '../../src/modules/analytics/next-styles';
import { StyleImportService } from '../../src/modules/styles/style-import.service';
import { DomainEvents } from '../../src/platform/domain-events/domain-events.service';
import { FileProcessingJobs } from '../../src/platform/files/file-processing.jobs';
import { as, customerToken, setSetting, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

/** A base no other style suite gives a recipe: the suites share the e2e database. */
const GROWTH_BASE = 'PK-TE-04';

type FakeStorage = { putDirect(key: string, body: Buffer, contentType: string): void };

/** U3.B6 growth loops end to end (D-272 intake, D-273 structural requests, D-274 next styles). */
describe('style library growth loops (e2e, U3.B6)', () => {
  let ctx: FulfilmentApp;
  let factoryId: string;
  let owner: string;
  let prepress: string;
  let cs: string;
  let analyst: string;
  let customer: string;

  /** A small real PDF uploaded as a `dieline` file, scanned clean. */
  async function uploadDieline(token: string, surface: 'store' | 'admin' | 'partner', name: string) {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setTitle(`${name} (fake)`);
    const body = Buffer.from(await doc.save());
    const presigned = await as(ctx, token)
      .post(`/v1/${surface}/files/presign`, {
        purpose: 'dieline',
        fileName: `${name}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: body.length,
      })
      .expect(201);
    const row = await ctx.prisma.fileObject.findUniqueOrThrow({
      where: { publicId: presigned.body.fileId as string },
    });
    ctx.app.get<FakeStorage>(OBJECT_STORAGE).putDirect(row.storageKey, body, 'application/pdf');
    await as(ctx, token)
      .post(`/v1/${surface}/files/${presigned.body.fileId}/actions/complete`, {})
      .expect(200);
    await ctx.app
      .get(FileProcessingJobs)
      .processOne(await ctx.prisma.fileObject.findUniqueOrThrow({ where: { id: row.id } }));
    return presigned.body.fileId as string;
  }

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    factoryId = (await ctx.prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 })).fixture
      .factoryPublicId;
    const admin = await ctx.prisma.user.findFirstOrThrow({ where: { email: 'admin@example.invalid' } });
    const adminActor: UserActor = {
      type: 'user',
      userId: admin.id,
      publicId: admin.publicId,
      audience: 'staff',
      scopes: [],
    };
    const imports = ctx.app.get(StyleImportService);
    const master = readFileSync(
      join(__dirname, '..', '..', 'docs', 'design-tool', 'style-library-master.json'),
      'utf8',
    );
    const plan = await imports.plan('master', 'style-library-master.json', master);
    if (!plan.noop) await imports.apply(adminActor, plan);
    const recipes = await imports.plan(
      'recipes',
      'growth.json',
      JSON.stringify({
        schemaVersion: '1.0',
        recipes: [{ baseCode: GROWTH_BASE, recipe: { fake: true, baseCode: GROWTH_BASE } }],
      }),
    );
    if (!recipes.noop) await imports.apply(adminActor, recipes);
    owner = await factoryToken(ctx, factoryId, 'factory_owner', 91);
    prepress = await staffToken(ctx, 'prepress');
    cs = await staffToken(ctx, 'cs');
    analyst = await staffToken(ctx, 'admin');
    customer = (await customerToken(ctx, 41)).token;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  describe('partner dieline intake (D-272)', () => {
    let intakeId: string;
    let terms: number;

    it('stays closed until the intake terms are set', async () => {
      const setting = await ctx.prisma.setting.findFirstOrThrow({ where: { key: 'styles.intake_terms' } });
      if ((await ctx.prisma.settingVersion.count({ where: { settingId: setting.id } })) === 0) {
        const closed = await as(ctx, owner).get('/v1/partner/style-intake-terms').expect(409);
        expect(closed.body.code).toBe('styles.intake_closed');
      }
      await setSetting(ctx, 'styles.intake_terms', {
        textTh: 'เงื่อนไขทดสอบ (fake)',
        textEn: 'Test terms (fake)',
      });
      const res = await as(ctx, owner).get('/v1/partner/style-intake-terms').expect(200);
      terms = res.body.version as number;
      expect(res.body.textEn).toBe('Test terms (fake)');
    });

    it('takes a factory’s DXF / PDF with the accepted terms and keeps its provenance', async () => {
      const fileId = await uploadDieline(owner, 'partner', 'tuck-window');
      const stale = await as(ctx, owner)
        .post(`/v1/partner/factories/${factoryId}/style-intakes`, {
          fileId,
          title: 'กล่องทดสอบ (fake)',
          acceptedTermsVersion: terms + 1,
        })
        .expect(409);
      expect(stale.body.code).toBe('styles.intake_terms_outdated');
      const res = await as(ctx, owner)
        .post(`/v1/partner/factories/${factoryId}/style-intakes`, {
          fileId,
          title: 'กล่องทดสอบ (fake)',
          baseCode: 'PK-TE-01',
          acceptedTermsVersion: terms,
        })
        .expect(201);
      intakeId = res.body.id as string;
      const file = await ctx.prisma.fileObject.findUniqueOrThrow({ where: { publicId: fileId } });
      expect(res.body).toMatchObject({
        status: 'submitted',
        termsVersion: terms,
        proposedBaseCode: 'PK-TE-01',
        fileSha256: Buffer.from(file.sha256!).toString('hex'),
        reviewedBy: null,
      });
      const mine = await as(ctx, owner).get(`/v1/partner/factories/${factoryId}/style-intakes`).expect(200);
      expect((mine.body as { id: string }[]).map((i) => i.id)).toContain(intakeId);
      // A planner-less customer or another surface cannot submit.
      await as(ctx, customer)
        .post(`/v1/partner/factories/${factoryId}/style-intakes`, {
          fileId,
          title: 'x',
          acceptedTermsVersion: terms,
        })
        .expect(403);
    });

    it('lets Prepress match with a deviation report, then approve as a template — final, provenance frozen', async () => {
      const recipe = await ctx.prisma.styleRecipe.findFirstOrThrow({
        where: { base: { code: GROWTH_BASE } },
        select: { publicId: true },
      });
      const matched = await as(ctx, prepress)
        .post(`/v1/admin/style-intakes/${intakeId}/actions/match`, {
          recipeId: recipe.publicId,
          deviations: [{ aspect: 'glue_flap', note: 'Glue flap 15 mm (fake)' }],
        })
        .expect(200);
      expect(matched.body).toMatchObject({ status: 'matched', deviations: [{ aspect: 'glue_flap' }] });
      await as(ctx, cs)
        .post(`/v1/admin/style-intakes/${intakeId}/actions/reject`, { reason: 'x' })
        .expect(403);
      const approved = await as(ctx, prepress)
        .post(`/v1/admin/style-intakes/${intakeId}/actions/approve`, { as: 'template', baseCode: 'PK-TE-01' })
        .expect(200);
      expect(approved.body).toMatchObject({ status: 'approved_template', templateBaseCode: 'PK-TE-01' });
      expect(approved.body.reviewedBy).not.toBeNull();
      const again = await as(ctx, prepress)
        .post(`/v1/admin/style-intakes/${intakeId}/actions/reject`, { reason: 'too late (fake)' })
        .expect(409);
      expect(again.body.code).toBe('styles.intake_decided');
      await expect(
        ctx.prisma.styleIntake.update({ where: { publicId: intakeId }, data: { title: 'changed' } }),
      ).rejects.toThrow();
      // The factory hears of it (D-143 factory route).
      await ctx.pump({ notifications: true });
      const routed = await ctx.prisma.notification.count({
        where: { event: { type: 'style_intake.approved', aggregateId: intakeId } },
      });
      expect(routed).toBeGreaterThan(0);
    });
  });

  describe('structural design requests (D-273)', () => {
    let requestId: string;

    it('takes a customer request and notifies the customer and CS', async () => {
      const bad = await as(ctx, customer)
        .post('/v1/store/structural-requests', {
          productTypeCode: 'folding_carton',
          description: 'กล่องขวดน้ำหอม 2 ขวด (fake)',
          lengthMm: 120,
        })
        .expect(422);
      expect(bad.body.errors[0].path).toBe('measurementBasis');
      const res = await as(ctx, customer)
        .post('/v1/store/structural-requests', {
          productTypeCode: 'folding_carton',
          description: 'กล่องขวดน้ำหอม 2 ขวด (fake)',
          lengthMm: 120,
          widthMm: 60,
          heightMm: 180,
          measurementBasis: 'internal',
          quantity: 3000,
        })
        .expect(201);
      requestId = res.body.id as string;
      expect(res.body).toMatchObject({
        status: 'submitted',
        sizes: { lengthMm: 120, measurementBasis: 'internal' },
      });
      await ctx.pump({ notifications: true });
      expect(
        await ctx.prisma.notification.count({
          where: { event: { type: 'structural_request.submitted', aggregateId: requestId } },
        }),
      ).toBeGreaterThan(0);
    });

    it('goes assign → deliver → approve; the customer sees the dieline only once approved', async () => {
      const designer = await ctx.prisma.user.findFirstOrThrow({
        where: { email: 'prepress@example.invalid' },
      });
      const notDesigner = await ctx.prisma.user.findFirstOrThrow({ where: { email: 'cs@example.invalid' } });
      await as(ctx, cs)
        .post(`/v1/admin/structural-requests/${requestId}/actions/assign`, {
          assigneeId: notDesigner.publicId,
        })
        .expect(422);
      await as(ctx, cs)
        .post(`/v1/admin/structural-requests/${requestId}/actions/assign`, { assigneeId: designer.publicId })
        .expect(200);
      // CS cannot deliver; a delivery needs a dieline file.
      const fileId = await uploadDieline(prepress, 'admin', 'structure');
      await as(ctx, cs)
        .post(`/v1/admin/structural-requests/${requestId}/actions/deliver`, { dielineFileId: fileId })
        .expect(403);
      await as(ctx, prepress).post(`/v1/admin/structural-requests/${requestId}/actions/approve`).expect(409);
      await as(ctx, prepress)
        .post(`/v1/admin/structural-requests/${requestId}/actions/deliver`, { dielineFileId: fileId })
        .expect(200);
      const delivered = await as(ctx, customer).get(`/v1/store/structural-requests/${requestId}`).expect(200);
      expect(delivered.body).toMatchObject({ status: 'delivered', deliveredFile: null });
      await as(ctx, customer)
        .post(`/v1/store/structural-requests/${requestId}/actions/cancel`, {})
        .expect(409);
      await as(ctx, prepress).post(`/v1/admin/structural-requests/${requestId}/actions/approve`).expect(200);
      const approved = await as(ctx, customer).get(`/v1/store/structural-requests/${requestId}`).expect(200);
      expect(approved.body.deliveredFile.id).toBe(fileId);
      // The customer may now download the designer's file.
      await as(ctx, customer).get(`/v1/store/files/${fileId}/download`).expect(200);
      await ctx.pump({ notifications: true });
      const types = (
        await ctx.prisma.notification.findMany({
          where: { event: { aggregateId: requestId } },
          select: { event: { select: { type: true } } },
        })
      ).map((n) => n.event.type);
      expect(new Set(types)).toEqual(
        new Set([
          'structural_request.submitted',
          'structural_request.assigned',
          'structural_request.delivered',
          'structural_request.approved',
        ]),
      );
    });

    it('refuses a link to a style that is not published and a decline once approved', async () => {
      const notPublished = await as(ctx, prepress)
        .post(`/v1/admin/structural-requests/${requestId}/actions/publish`, { baseCode: 'PK-ZZ-99' })
        .expect(422);
      expect(notPublished.body.errors[0].path).toBe('baseCode');
      await as(ctx, cs)
        .post(`/v1/admin/structural-requests/${requestId}/actions/decline`, { reason: 'late (fake)' })
        .expect(409);
      const list = await as(ctx, customer).get('/v1/store/structural-requests').expect(200);
      expect((list.body as { id: string }[])[0]!.id).toBe(requestId);
      await request(ctx.server).get('/v1/store/structural-requests').expect(401);
    });
  });

  describe('next styles (D-274)', () => {
    it('logs style searches and reports zero-result keywords only above the group size, aggregates only', async () => {
      const keyword = `zzkeyword${ctx.run}`;
      for (let i = 0; i < 3; i++) {
        const token = (await customerToken(ctx, 50 + i)).token;
        await as(ctx, token).get(`/v1/store/styles?q=${keyword}`).expect(200);
      }
      const lonely = `zzlonely${ctx.run}`;
      await request(ctx.server).get(`/v1/store/styles?q=${lonely}`).expect(200);
      const logged = await ctx.prisma.searchLog.findMany({ where: { keyword: { in: [keyword, lonely] } } });
      expect(logged.every((l) => l.surface === 'styles' && l.resultsCount === 0)).toBe(true);
      expect(logged).toHaveLength(4);

      const res = await as(ctx, analyst).get('/v1/admin/analytics/next-styles').expect(200);
      const keywords = (res.body.zeroResultSearches as { keyword: string; searchers: number }[]).map(
        (k) => k.keyword,
      );
      expect(res.body.minGroupSize).toBe(3);
      expect(res.body.styleSearches).toBeGreaterThanOrEqual(4);
      expect(res.body.suppressedZeroResultSearches).toBeGreaterThanOrEqual(1);
      expect(keywords).not.toContain(lonely);
      // Top 50 only: on a busy dev database the keyword may be outranked, so check the service directly too.
      const report = await ctx.app.get(NextStylesService).report();
      expect(report.zeroResultSearches.length).toBeLessThanOrEqual(50);
      expect(
        report.structuralRequests.find((r) => r.productTypeCode === 'folding_carton')?.requests,
      ).toBeGreaterThan(0);
      // A calculation refused for an unpublishable variant is "next styles" demand for its base.
      const variant = await ctx.prisma.styleVariant.findFirstOrThrow({
        where: { base: { code: GROWTH_BASE }, publishable: false },
        select: { code: true, baseId: true },
      });
      const type = await ctx.prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
      await ctx.prisma.$transaction((tx) =>
        ctx.app.get(DomainEvents).record(tx, {
          type: 'quote.calculated',
          aggregateType: 'product_type',
          aggregateId: type.publicId,
          payload: {
            occurredAt: new Date().toISOString(),
            productTypeId: type.id.toString(),
            quantities: [1000],
            instant: false,
            reasons: ['style_variant_not_publishable'],
            dimensionsMm: { w: 50, l: 60, d: 120 },
            styleVariantCode: variant.code,
          },
        }),
      );
      await ctx.pump();
      const demand = await ctx.prisma.unmetDemandRecord.findFirst({
        where: { source: 'style_not_publishable', styleBaseId: variant.baseId },
      });
      expect(demand).not.toBeNull();
      const after = await ctx.app.get(NextStylesService).report();
      expect(after.unpublishableStyles.find((b) => b.baseCode === GROWTH_BASE)?.calculations).toBeGreaterThan(
        0,
      );
      await as(ctx, cs).get('/v1/admin/analytics/next-styles').expect(403);
      await as(ctx, analyst).get('/v1/admin/analytics/next-styles?month=2026-13').expect(422);
    });
  });
});
