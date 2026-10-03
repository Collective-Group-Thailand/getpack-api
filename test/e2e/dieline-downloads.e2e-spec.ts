import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type FakeObjectStorage } from '@integrations/s3/fake-object-storage';
import { OBJECT_STORAGE } from '@integrations/s3/object-storage.port';
import request from 'supertest';

import { type UserActor } from '../../src/common/context/actor';
import { StyleAssetsService } from '../../src/modules/styles/style-assets.service';
import { StyleImportService } from '../../src/modules/styles/style-import.service';
import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  setFlag,
  staffToken,
} from '../support/commerce-e2e';
import { inspectDesignerPdf } from '../support/designer-pdf-inspect';

const MASTER = readFileSync(
  join(__dirname, '..', '..', 'docs', 'design-tool', 'style-library-master.json'),
  'utf8',
);
/** A base no other style suite uses: the suites share the e2e database (style-library, style-network). */
const BASE = 'PK-TE-05';
const RANGES = { paperboard: { minL: 20, maxL: 300, minW: 15, maxW: 200, minH: 20, maxH: 400 } };

/** U3.B5 drawing v2, free dieline downloads and style assets end to end (D-270, D-271, D-203; fake engine). */
describe('dieline downloads and style assets (e2e, U3.B5)', () => {
  let ctx: CommerceApp;
  let customer: string;
  let other: string;
  let prepress: string;
  let published: string;
  let unpublished: string;
  /** A size unique to this run, so the first render of the run is not a cache hit of a previous run. */
  let length: number;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    length = 100 + (ctx.run % 90);
    const user = await ctx.prisma.user.findFirstOrThrow({ where: { email: 'admin@example.invalid' } });
    const admin: UserActor = {
      type: 'user',
      userId: user.id,
      publicId: user.publicId,
      audience: 'staff',
      scopes: [],
    };
    const imports = ctx.app.get(StyleImportService);
    const plan = await imports.plan('master', 'style-library-master.json', MASTER);
    if (!plan.noop) await imports.apply(admin, plan);
    const recipes = await imports.plan(
      'recipes',
      'downloads.json',
      JSON.stringify({
        schemaVersion: '1.0',
        recipes: [{ baseCode: BASE, recipe: { fake: true, baseCode: BASE }, sizeRanges: RANGES }],
      }),
    );
    if (!recipes.noop) await imports.apply(admin, recipes);
    prepress = await staffToken(ctx, 'prepress');
    const base = await ctx.prisma.styleBase.findUniqueOrThrow({
      where: { code: BASE },
      include: { recipes: { include: { importRun: true } } },
    });
    for (const r of base.recipes.filter((x) => !x.approvedAt && x.importRun?.createdById === user.id))
      await as(ctx, prepress)
        .post(`/v1/admin/styles/${base.publicId}/recipes/${r.publicId}/actions/approve`)
        .expect(200);
    // Publishability itself is covered by style-network; here one variant is published and one is not.
    const variants = await ctx.prisma.styleVariant.findMany({
      where: { baseId: base.id },
      orderBy: { code: 'asc' },
      take: 2,
    });
    published = variants[0]!.code;
    unpublished = variants[1]!.code;
    await ctx.prisma.styleVariant.update({
      where: { code: published },
      data: { publishable: true, reasons: [], status: 'active' },
    });
    await ctx.prisma.styleVariant.update({
      where: { code: unpublished },
      data: { publishable: false, reasons: ['not_makeable'] },
    });
    await ctx.prisma.styleBase.update({ where: { id: base.id }, data: { status: 'active', hidden: false } });
    customer = (await customerToken(ctx, 31)).token;
    other = (await customerToken(ctx, 32)).token;
    await setFlag(ctx, 'drawing.engine', true);
  });

  afterAll(async () => {
    await setFlag(ctx, 'drawing.engine', false);
    await ctx?.app.close();
  });

  const body = (over: Record<string, unknown> = {}) => ({
    variantCode: published,
    lengthMm: length,
    widthMm: 50,
    heightMm: 120,
    materialClass: 'paperboard',
    format: 'pdf',
    ...over,
  });

  it('answers 501 while the drawing engine is off and refuses guests', async () => {
    await setFlag(ctx, 'drawing.engine', false);
    const off = await as(ctx, customer).post('/v1/store/dielines/downloads', body()).expect(501);
    expect(off.body.code).toBe('drawing.engine_unavailable');
    await setFlag(ctx, 'drawing.engine', true);
    await request(ctx.server).post('/v1/store/dielines/downloads').send(body()).expect(401);
  });

  it('downloads a published variant within its range, then serves the cached drawing (D-270, D-271)', async () => {
    const first = await as(ctx, customer).post('/v1/store/dielines/downloads', body()).expect(201);
    expect(first.body).toMatchObject({
      variantCode: published,
      format: 'pdf',
      materialClass: 'paperboard',
      measurementBasis: 'internal',
      drawn: { lengthMm: length, widthMm: 50, heightMm: 120 },
      cached: false,
      remainingToday: 19,
      violations: [],
      engineVersion: 'fake-dieline@0',
    });
    expect(first.body.url).toMatch(/^https?:\/\//);
    expect(first.body.quantities.blankWidthMm).toBe(2 * length + 2 * 50);
    // D-302 / T12: the PDF opens with the layers and swatches a designer expects, the style code in its metadata.
    const render = await ctx.prisma.dielineDownload.findUniqueOrThrow({
      where: { publicId: first.body.id as string },
      include: { render: { include: { file: true } } },
    });
    const stored = ctx.app.get<FakeObjectStorage>(OBJECT_STORAGE).objects.get(render.render.file.storageKey)!;
    const pdf = await inspectDesignerPdf(stored.body);
    expect(pdf.layers).toEqual(
      expect.arrayContaining(['CutContour', 'Crease', 'Perf', 'Bleed', 'Safe', 'Glue']),
    );
    expect(pdf.swatches).toEqual(pdf.layers);
    expect(pdf).toMatchObject({ styleCode: published, subject: published });
    expect(pdf.title).toContain(published);
    expect(pdf.xmp).toContain(`<packio:styleCode>${published}</packio:styleCode>`);
    // Same request by someone else: same file, from the cache.
    const again = await as(ctx, other).post('/v1/store/dielines/downloads', body()).expect(201);
    expect(again.body).toMatchObject({
      cached: true,
      fileName: first.body.fileName,
      sizeBytes: first.body.sizeBytes,
    });
    const logged = await ctx.prisma.dielineDownload.findUniqueOrThrow({
      where: { publicId: first.body.id as string },
      include: { render: true },
    });
    expect(logged).toMatchObject({ staff: false, measurementBasis: 'internal' });
    // Append-only log (A-93).
    await expect(ctx.prisma.dielineDownload.delete({ where: { id: logged.id } })).rejects.toThrow();
  });

  it('converts outside sizes to inside sizes before drawing (D-182)', async () => {
    const res = await as(ctx, other)
      .post('/v1/store/dielines/downloads', body({ measurementBasis: 'external', format: 'svg' }))
      .expect(201);
    expect(res.body.entered).toEqual({ lengthMm: length, widthMm: 50, heightMm: 120 });
    expect(res.body.drawn.lengthMm).toBeLessThan(length);
  });

  it('refuses an unpublished variant, a class the style does not offer and a size out of range', async () => {
    const hidden = await as(ctx, other)
      .post('/v1/store/dielines/downloads', body({ variantCode: unpublished }))
      .expect(404);
    expect(hidden.body.code).toBe('styles.variant_not_found');
    const cls = await as(ctx, other)
      .post('/v1/store/dielines/downloads', body({ materialClass: 'corrugated' }))
      .expect(422);
    expect(cls.body.code).toBe('dielines.material_class_not_offered');
    const big = await as(ctx, other)
      .post('/v1/store/dielines/downloads', body({ heightMm: 450 }))
      .expect(422);
    expect(big.body.code).toBe('dielines.size_out_of_range');
    expect(big.body.errors[0].path).toBe('heightMm');
  });

  it('limits a customer to 5 a minute with Retry-After (D-203)', async () => {
    const limited = (await customerToken(ctx, 33)).token;
    for (let i = 0; i < 5; i++)
      await as(ctx, limited)
        .post('/v1/store/dielines/downloads', body({ widthMm: 60 + i }))
        .expect(201);
    const sixth = await as(ctx, limited).post('/v1/store/dielines/downloads', body()).expect(429);
    expect(sixth.body.code).toBe('dielines.rate_limited');
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('lets staff download any variant with an approved recipe, unlimited, still logged', async () => {
    for (let i = 0; i < 6; i++)
      await as(ctx, prepress)
        .post('/v1/admin/dielines/downloads', body({ variantCode: unpublished, heightMm: 450 }))
        .expect(201);
    const res = await as(ctx, prepress)
      .post('/v1/admin/dielines/downloads', body({ variantCode: unpublished, format: 'dxf' }))
      .expect(201);
    expect(res.body.remainingToday).toBeNull();
    expect(
      await ctx.prisma.dielineDownload.count({ where: { publicId: res.body.id as string, staff: true } }),
    ).toBe(1);
    await as(ctx, customer).post('/v1/admin/dielines/downloads', body()).expect(403);
  });

  it('renders style assets of publishable variants and shows them signed on the style (D-270)', async () => {
    const assets = ctx.app.get(StyleAssetsService);
    await assets.renderDue(500);
    const rows = await ctx.prisma.styleAsset.findMany({ where: { variant: { code: published } } });
    expect(rows.map((r) => r.kind).sort()).toEqual(['dieline_svg', 'thumbnail_2d']);
    expect(rows.every((r) => r.engineVersion === 'fake-dieline@0' && r.recipeVersion !== null)).toBe(true);
    // Nothing left to render for that variant until its recipe or the engine changes.
    expect(await ctx.prisma.styleAsset.count({ where: { variant: { code: unpublished } } })).toBe(0);
    await assets.renderDue(500);
    expect(await ctx.prisma.styleAsset.count({ where: { variant: { code: published } } })).toBe(2);

    const detail = await request(ctx.server).get(`/v1/store/styles/${BASE}`).expect(200);
    const shown = (detail.body.assets as { variantCode: string; url: string }[]).filter(
      (a) => a.variantCode === published,
    );
    expect(shown.length).toBe(2);
    expect(shown.every((a) => /^https?:\/\//.test(a.url))).toBe(true);
  });
});
