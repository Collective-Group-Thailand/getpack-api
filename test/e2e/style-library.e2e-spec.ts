import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type FakeObjectStorage } from '@integrations/s3/fake-object-storage';
import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import { FileProcessingJobs } from '@platform/files/file-processing.jobs';
import request from 'supertest';

import { type UserActor } from '../../src/common/context/actor';
import { StyleImportService } from '../../src/modules/styles/style-import.service';
import {
  as,
  bootCommerceApp,
  type CommerceApp,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  staffToken,
} from '../support/commerce-e2e';

const MASTER_PATH = join(__dirname, '..', '..', 'docs', 'design-tool', 'style-library-master.json');

type Base = { id: string; code: string; productTypeCode: string | null; referenceCode: string | null };
type Variant = { code: string; publishable: boolean; reasons: string[] };

/** Style library U3.B1 end to end (D-241–D-243): import, recipes, sign-offs, approvals, quote guard. */
describe('style library (e2e, U3.B1)', () => {
  let ctx: CommerceApp;
  let imports: StyleImportService;
  const tokens: Record<string, string> = {};
  const actors: Record<string, UserActor> = {};
  const master = readFileSync(MASTER_PATH, 'utf8');

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    imports = ctx.app.get(StyleImportService);
    for (const role of ['admin', 'prepress', 'marketing', 'cs']) {
      tokens[role] = await staffToken(ctx, role);
      const user = await ctx.prisma.user.findFirstOrThrow({ where: { email: `${role}@example.invalid` } });
      actors[role] = {
        type: 'user',
        userId: user.id,
        publicId: user.publicId,
        audience: 'staff',
        scopes: [],
      };
    }
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  const base = async (code: string) => {
    const row = await ctx.prisma.styleBase.findUniqueOrThrow({ where: { code } });
    return (await as(ctx, tokens['admin']!).get(`/v1/admin/styles/${row.publicId}`).expect(200))
      .body as Base & {
      nameEn: string;
      recipes: { id: string; approvedAt: string | null }[];
      reasonCounts: { reason: string; count: number }[];
      namesApproval: { marketingAt: string | null; prepressAt: string | null };
      referenceVerifiedAt: string | null;
    };
  };
  const variants = async (id: string) =>
    (await as(ctx, tokens['admin']!).get(`/v1/admin/styles/${id}/variants?perPage=100`).expect(200)).body as {
      data: Variant[];
      meta: { total: number };
    };
  const bundle = (code: string, tag: string) =>
    JSON.stringify({
      schemaVersion: '1.0',
      recipes: [
        {
          baseCode: code,
          recipe: { fake: true, tag },
          processes: ['die_cut_flatbed', 'folder_gluer_straight_line'],
        },
      ],
    });

  it('imports the master file: 122 bases and 986 variants, nothing written on a dry run', async () => {
    const plan = await imports.plan('master', 'style-library-master.json', master);
    if (!plan.noop) {
      expect(plan.summary).toMatchObject({ basesCreated: 122, variantsCreated: 986 });
      expect(await ctx.prisma.styleBase.count()).toBe(0);
      const run = await imports.apply(actors['admin']!, plan);
      expect(run?.status).toBe('applied');
    }
    expect(await ctx.prisma.styleBase.count()).toBe(122);
    expect(await ctx.prisma.styleVariant.count()).toBe(986);
    const list = await as(ctx, tokens['cs']!).get('/v1/admin/styles?category=folding_carton').expect(200);
    expect(list.body.meta.total).toBe(49);
    const te = await base('PK-TE-01');
    expect(te.productTypeCode).toBe('folding_carton');
    const v = await variants(te.id);
    expect(v.meta.total).toBe(183);
    expect(v.data[0]!.code).toMatch(/^PK-TE-01-[A-Z2-7]{4}$/);
    // D-407: makeability is an order path, not a publish gate.
    expect(v.data[0]!.reasons).toEqual(['no_recipe', 'names_not_approved']);
    const mailer = await ctx.prisma.styleBase.findFirstOrThrow({
      where: { sourceProductType: 'mailer' },
      include: { productType: true },
    });
    expect(mailer.productType?.code).toBe('flexible_pouch');
    const runs = await as(ctx, tokens['admin']!).get('/v1/admin/style-imports').expect(200);
    expect(
      (runs.body.data as { kind: string; status: string }[]).find((r) => r.kind === 'master'),
    ).toMatchObject({
      status: 'applied',
    });
  });

  it('is idempotent: the same file, or one that changes nothing, writes nothing (D-242)', async () => {
    expect((await imports.plan('master', 'm.json', master)).noopReason).toBe('same_checksum');
    const reformatted = JSON.stringify(JSON.parse(master));
    const plan = await imports.plan('master', 'm.json', reformatted);
    expect(plan).toMatchObject({ noop: true, noopReason: 'no_changes' });
    expect(await imports.apply(actors['admin']!, plan)).toBeNull();
  });

  it('imports from the admin: an uploaded file is previewed, then confirmed only as previewed (D-411)', async () => {
    const upload = async (content: string) => {
      const body = Buffer.from(content, 'utf8');
      const presigned = await as(ctx, tokens['admin']!)
        .post('/v1/admin/files/presign', {
          purpose: 'import',
          fileName: 'style-library-master.json',
          mimeType: 'application/json',
          sizeBytes: body.length,
        })
        .expect(201);
      const row = await ctx.prisma.fileObject.findUniqueOrThrow({
        where: { publicId: presigned.body.fileId as string },
      });
      ctx.app.get<FakeObjectStorage>(OBJECT_STORAGE).putDirect(row.storageKey, body, 'application/json');
      await as(ctx, tokens['admin']!)
        .post(`/v1/admin/files/${presigned.body.fileId}/actions/complete`, {})
        .expect(200);
      await ctx.app.get(FileProcessingJobs).processUploaded();
      return presigned.body.fileId as string;
    };
    const preview = (fileId: string, token = tokens['admin']!) =>
      as(ctx, token).post('/v1/admin/style-imports/actions/preview', { kind: 'master', fileId });

    const same = await upload(JSON.stringify(JSON.parse(master), null, 1));
    expect((await preview(same).expect(200)).body).toMatchObject({ noop: true, noopReason: 'no_changes' });
    await preview(same, tokens['cs']!).expect(403);

    const renamed = JSON.parse(master) as { styles: { code: string; name_en: string }[] };
    renamed.styles.find((s) => s.code === 'PK-SP-26')!.name_en = 'Pentagonal carton (admin import)';
    const fileId = await upload(JSON.stringify(renamed));
    const plan = (await preview(fileId).expect(200)).body as { checksum: string; direct: { code: string }[] };
    expect(plan.direct.map((c) => c.code)).toEqual(['PK-SP-26']);
    expect(await ctx.prisma.styleBase.findUniqueOrThrow({ where: { code: 'PK-SP-26' } })).toMatchObject({
      nameEn: 'Pentagonal carton',
    });
    const stale = await as(ctx, tokens['admin']!)
      .post('/v1/admin/style-imports', { kind: 'master', fileId, checksum: '0'.repeat(64) })
      .expect(409);
    expect(stale.body.code).toBe('styles.import_stale');
    const done = await as(ctx, tokens['admin']!)
      .post('/v1/admin/style-imports', { kind: 'master', fileId, checksum: plan.checksum })
      .expect(201);
    expect(done.body.run).toMatchObject({ status: 'applied', fileName: 'style-library-master.json' });
    expect((await base('PK-SP-26')).nameEn).toBe('Pentagonal carton (admin import)');

    // The library's own file again puts the name back; JSON that is not a master file is refused.
    const back = await upload(JSON.stringify(JSON.parse(master), null, 3));
    const again = (await preview(back).expect(200)).body as { checksum: string };
    await as(ctx, tokens['admin']!)
      .post('/v1/admin/style-imports', { kind: 'master', fileId: back, checksum: again.checksum })
      .expect(201);
    expect((await base('PK-SP-26')).nameEn).toBe('Pentagonal carton');
    const junk = await preview(await upload('{"styles": 3}')).expect(422);
    expect(junk.body.code).toBe('styles.import_unreadable');
  });

  it('lists the style library and its neighbours in the admin menu of those who may open them (D-411)', async () => {
    const menu = async (role: string) =>
      ((await as(ctx, tokens[role]!).get('/v1/admin/me').expect(200)).body.menu as { key: string }[]).map(
        (e) => e.key,
      );
    expect(await menu('prepress')).toEqual(expect.arrayContaining(['style_library', 'style_intakes']));
    expect(await menu('marketing')).toEqual(expect.arrayContaining(['style_library', 'cms']));
  });

  it('takes recipes from a bundle; Prepress approves one, never the person who imported it (D-243)', async () => {
    await imports.apply(actors['admin']!, await imports.plan('recipes', 'r1.json', bundle('PK-TE-01', 'v1')));
    let te = await base('PK-TE-01');
    expect(te.reasonCounts.map((r) => r.reason)).toContain('recipe_not_approved');
    await as(ctx, tokens['marketing']!)
      .post(`/v1/admin/styles/${te.id}/recipes/${te.recipes[0]!.id}/actions/approve`)
      .expect(403);
    await as(ctx, tokens['prepress']!)
      .post(`/v1/admin/styles/${te.id}/recipes/${te.recipes[0]!.id}/actions/approve`)
      .expect(200);
    te = await base('PK-TE-01');
    expect(te.recipes[0]!.approvedAt).not.toBeNull();
    expect(te.reasonCounts.map((r) => r.reason)).not.toContain('recipe_not_approved');
    expect((await imports.plan('recipes', 'r1.json', bundle('PK-TE-01', 'v1'))).noop).toBe(true);

    await imports.apply(
      actors['prepress']!,
      await imports.plan('recipes', 'r2.json', bundle('PK-TE-01', 'v2')),
    );
    te = await base('PK-TE-01');
    const self = await as(ctx, tokens['prepress']!)
      .post(`/v1/admin/styles/${te.id}/recipes/${te.recipes[0]!.id}/actions/approve`)
      .expect(403);
    expect(self.body.code).toBe('styles.maker_checker');
  });

  it('needs both name approvals, each by its own role (D-212), and verifies references (D-211)', async () => {
    const te = await base('PK-TE-01');
    const wrong = await as(ctx, tokens['marketing']!)
      .post(`/v1/admin/styles/${te.id}/actions/approve-names`, { as: 'prepress' })
      .expect(403);
    expect(wrong.body.code).toBe('styles.role_required');
    await as(ctx, tokens['marketing']!)
      .post(`/v1/admin/styles/${te.id}/actions/approve-names`, { as: 'marketing' })
      .expect(200);
    const both = (
      await as(ctx, tokens['prepress']!)
        .post(`/v1/admin/styles/${te.id}/actions/approve-names`, { as: 'prepress' })
        .expect(200)
    ).body as { reasonCounts: { reason: string }[] };
    expect(both.reasonCounts.map((r) => r.reason)).toEqual([]);

    const ref = await ctx.prisma.styleBase.findFirstOrThrow({ where: { referenceCode: { not: null } } });
    const mismatch = await as(ctx, tokens['prepress']!)
      .post(`/v1/admin/styles/${ref.publicId}/actions/verify-reference`, { referenceCode: 'FEFCO 9999' })
      .expect(409);
    expect(mismatch.body.code).toBe('styles.reference_mismatch');
    const verified = await as(ctx, tokens['prepress']!)
      .post(`/v1/admin/styles/${ref.publicId}/actions/verify-reference`, { referenceCode: ref.referenceCode })
      .expect(200);
    expect(verified.body.referenceVerifiedAt).not.toBeNull();
    await as(ctx, tokens['cs']!)
      .post(`/v1/admin/styles/${ref.publicId}/actions/verify-reference`, { referenceCode: ref.referenceCode })
      .expect(403);
  });

  it('holds a change to a published base for Prepress then Marketing, and applies it once approved (D-242)', async () => {
    // A published base (U3.B3 makes bases publishable; here the first publication is stamped directly).
    await ctx.prisma.styleBase.update({ where: { code: 'PK-TE-02' }, data: { publishedAt: new Date() } });
    const changed = JSON.parse(master) as { styles: { code: string; name_en: string }[] };
    changed.styles.find((s) => s.code === 'PK-TE-02')!.name_en = 'Tuck-end carton (e2e rename)';
    changed.styles.find((s) => s.code === 'PK-TE-03')!.name_en = 'Unpublished rename (e2e)';
    const plan = await imports.plan('master', 'm2.json', JSON.stringify(changed));
    expect(plan.pending.map((c) => c.code)).toEqual(['PK-TE-02']);
    expect(plan.direct.map((c) => c.code)).toEqual(['PK-TE-03']);
    const run = (await imports.apply(actors['admin']!, plan))!;
    expect(run.status).toBe('pending_approval');
    expect((await base('PK-TE-02')).nameEn).not.toBe('Tuck-end carton (e2e rename)');
    expect((await base('PK-TE-03')).nameEn).toBe('Unpublished rename (e2e)');

    const approval = await ctx.prisma.approvalRequest.findUniqueOrThrow({
      where: { id: run.approvalRequestId! },
    });
    await as(ctx, tokens['marketing']!)
      .post(`/v1/admin/approvals/${approval.publicId}/actions/approve`, {})
      .expect(403);
    await as(ctx, tokens['prepress']!)
      .post(`/v1/admin/approvals/${approval.publicId}/actions/approve`, {})
      .expect(200);
    await as(ctx, tokens['marketing']!)
      .post(`/v1/admin/approvals/${approval.publicId}/actions/approve`, {})
      .expect(200);
    const outcome = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { type: 'approval.approved', aggregateId: approval.publicId },
    });
    await ctx.prisma.withTx((tx) => imports.onApprovalOutcome(envelopeFromRow(outcome), tx));
    const after = await base('PK-TE-02');
    expect(after.nameEn).toBe('Tuck-end carton (e2e rename)');
    expect(after.namesApproval).toEqual({ marketingAt: null, prepressAt: null });
    const done = await as(ctx, tokens['admin']!).get(`/v1/admin/style-imports/${run.publicId}`).expect(200);
    expect(done.body.status).toBe('applied');
    await expect(
      ctx.prisma.styleBase.update({ where: { code: 'PK-TE-02' }, data: { code: 'PK-TE-99' } }),
    ).rejects.toThrow();
  });

  it('never prices an unpublishable variant instantly, so it cannot be saved (D-243)', async () => {
    const fixture = await foldingReady(ctx);
    const variant = await ctx.prisma.styleVariant.findFirstOrThrow({ where: { base: { code: 'PK-TE-01' } } });
    const configuration = { ...foldingConfiguration(fixture, [1000]), styleVariantCode: variant.code };
    const res = await request(ctx.server)
      .post('/v1/store/quotes/actions/calculate')
      .send({ productTypeCode: 'folding_carton', configuration })
      .expect(200);
    expect(res.body.steps[0]).toMatchObject({ instant: false, reason: 'style_variant_not_publishable' });
    const saved = await request(ctx.server)
      .post('/v1/store/quotes')
      .send({
        productTypeCode: 'folding_carton',
        configuration,
        anonymousId: '0192f3a0-7c1e-7d2a-9b1f-0000000ae0ff',
      })
      .expect(422);
    expect(saved.body.code).toBe('quotes.nothing_to_save');
    const control = await request(ctx.server)
      .post('/v1/store/quotes/actions/calculate')
      .send({ productTypeCode: 'folding_carton', configuration: foldingConfiguration(fixture, [1000]) })
      .expect(200);
    expect(control.body.steps[0].instant).toBe(true);
    await request(ctx.server)
      .post('/v1/store/quotes/actions/calculate')
      .send({
        productTypeCode: 'folding_carton',
        configuration: { ...configuration, styleVariantCode: 'TE-01' },
      })
      .expect(422);
  });
});
