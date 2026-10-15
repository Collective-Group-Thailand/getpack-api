import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import request from 'supertest';

import { type DevCorrugate, seedDevCorrugate } from '../../prisma/seed/dev-corrugate';
import { seedDevFolding } from '../../prisma/seed/dev-folding';
import { type UserActor } from '../../src/common/context/actor';
import { StyleImportService } from '../../src/modules/styles/style-import.service';
import { StylesJobs } from '../../src/modules/styles/styles.jobs';
import { as, bootCommerceApp, type CommerceApp, customerToken, staffToken } from '../support/commerce-e2e';
import { factoryToken } from '../support/fulfilment-e2e';

const MASTER = readFileSync(
  join(__dirname, '..', '..', 'docs', 'design-tool', 'style-library-master.json'),
  'utf8',
);

type Card = { code: string; favourite: boolean | null; pricePath: string; variantCount: number };
type Facet = { value: string; count: number };
const codes = (body: unknown) => (body as { data: Card[] }).data.map((c) => c.code);

/** Style library U3.B2 + U3.B3 end to end (D-243–D-246): capability → publishable → store library. */
describe('style library network and store (e2e, U3.B2–B3)', () => {
  let ctx: CommerceApp;
  let corrugate: DevCorrugate;
  const t: Record<string, string> = {};
  const actor: Record<string, UserActor> = {};
  let owner: string;
  let factoryId: string;
  let capabilityId: string;

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    await ctx.prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 });
    corrugate = (await ctx.prisma.$transaction((tx) => seedDevCorrugate(tx), { timeout: 60_000 })).fixture;
    factoryId = corrugate.factoryPublicId;
    for (const role of ['admin', 'prepress', 'marketing', 'partner-manager', 'cs']) {
      t[role] = await staffToken(ctx, role);
      const user = await ctx.prisma.user.findFirstOrThrow({ where: { email: `${role}@example.invalid` } });
      actor[role] = { type: 'user', userId: user.id, publicId: user.publicId, audience: 'staff', scopes: [] };
    }
    t['customer'] = (await customerToken(ctx, 7)).token;
    owner = await factoryToken(ctx, factoryId, 'factory_owner', 81);
    const imports = ctx.app.get(StyleImportService);
    const plan = await imports.plan('master', 'style-library-master.json', MASTER);
    if (!plan.noop) await imports.apply(actor['admin']!, plan);
    const bundle = JSON.stringify({
      schemaVersion: '1.0',
      recipes: ['PK-CS-01', 'PK-CS-02'].map((baseCode) => ({
        baseCode,
        recipe: { fake: true, baseCode },
        sizeRanges: { corrugated: { minW: 100, maxW: 600, minL: 100, maxL: 800, minH: 50, maxH: 600 } },
      })),
    });
    const recipes = await imports.plan('recipes', 'network.json', bundle);
    if (!recipes.noop) await imports.apply(actor['admin']!, recipes);
    for (const code of ['PK-CS-01', 'PK-CS-02']) {
      const base = await ctx.prisma.styleBase.findUniqueOrThrow({
        where: { code },
        include: { recipes: true },
      });
      for (const r of base.recipes.filter((x) => !x.approvedAt))
        await as(ctx, t['prepress']!)
          .post(`/v1/admin/styles/${base.publicId}/recipes/${r.publicId}/actions/approve`)
          .expect(200);
      await as(ctx, t['marketing']!)
        .post(`/v1/admin/styles/${base.publicId}/actions/approve-names`, { as: 'marketing' })
        .expect(200);
      await as(ctx, t['prepress']!)
        .post(`/v1/admin/styles/${base.publicId}/actions/approve-names`, { as: 'prepress' })
        .expect(200);
    }
  });

  afterAll(async () => {
    await ctx?.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'rfq' } });
    await ctx?.app.close();
  });

  const reasons = async (code: string) =>
    (await ctx.prisma.styleVariant.findMany({ where: { base: { code } }, select: { reasons: true } })).map(
      (v) => v.reasons,
    );
  const priceReasons = async (code: string) =>
    (
      await ctx.prisma.styleVariant.findMany({ where: { base: { code } }, select: { priceReasons: true } })
    ).map((v) => v.priceReasons);
  const visit = async (result: 'pass' | 'fail') => {
    const factory = await ctx.prisma.factory.findUniqueOrThrow({ where: { publicId: factoryId } });
    return ctx.prisma.siteVisit.create({
      data: {
        factoryId: factory.id,
        visitedOn: new Date('2026-09-30'),
        checklistVersion: 'e2e',
        checklist: {},
        result,
        recordedById: actor['partner-manager']!.userId,
      },
    });
  };

  it('shows a drawn style nobody can make yet, as a quotation request (D-407)', async () => {
    expect(await reasons('PK-CS-01')).toEqual(Array(9).fill([]));
    expect((await priceReasons('PK-CS-01')).every((r) => r.includes('not_makeable'))).toBe(true);
    const list = await request(ctx.server).get('/v1/store/styles?limit=100').expect(200);
    expect(codes(list.body)).toContain('PK-CS-01');
    const card = (list.body as { data: Card[] }).data.find((c) => c.code === 'PK-CS-01')!;
    expect(card.pricePath).toBe('rfq');
    const detail = await request(ctx.server).get('/v1/store/styles/PK-CS-01').expect(200);
    // D-407: the product type it is quoted as, for the style page's quotation request.
    expect(detail.body).toMatchObject({ leadTime: null, productTypeCode: 'corrugated' });
  });

  it('lets the factory propose a capability that counts only once verified against a passing site visit (D-244)', async () => {
    const types = await as(ctx, owner).get('/v1/partner/process-types').expect(200);
    expect((types.body as { code: string }[]).map((p) => p.code)).toContain('slotter');
    const bad = await as(ctx, owner)
      .post(`/v1/partner/factories/${factoryId}/process-capabilities`, {
        processCode: 'slotter',
        materialClass: 'unobtainium',
        leadTimeMinDays: 5,
        leadTimeMaxDays: 9,
      })
      .expect(422);
    expect(bad.body.errors[0].path).toBe('materialClass');
    const proposed = await as(ctx, owner)
      .post(`/v1/partner/factories/${factoryId}/process-capabilities`, {
        processCode: 'slotter',
        materialClass: 'corrugated',
        maxBlankWMm: 1600,
        maxBlankLMm: 2400,
        leadTimeMinDays: 5,
        leadTimeMaxDays: 9,
      })
      .expect(201);
    capabilityId = proposed.body.id as string;
    expect(proposed.body.status).toBe('proposed');
    expect((await priceReasons('PK-CS-01')).every((r) => r.includes('not_makeable'))).toBe(true);

    await as(ctx, owner)
      .post(`/v1/admin/factories/${factoryId}/process-capabilities/${capabilityId}/actions/verify`, {
        siteVisitId: (await visit('pass')).publicId,
      })
      .expect(403);
    const failed = await as(ctx, t['partner-manager']!)
      .post(`/v1/admin/factories/${factoryId}/process-capabilities/${capabilityId}/actions/verify`, {
        siteVisitId: (await visit('fail')).publicId,
      })
      .expect(409);
    expect(failed.body.code).toBe('styles.site_visit_not_passed');
    const verified = await as(ctx, t['partner-manager']!)
      .post(`/v1/admin/factories/${factoryId}/process-capabilities/${capabilityId}/actions/verify`, {
        siteVisitId: (await visit('pass')).publicId,
      })
      .expect(200);
    expect(verified.body.status).toBe('verified');
    expect((await priceReasons('PK-CS-01')).some((r) => r.includes('not_makeable'))).toBe(false);

    const self = await as(ctx, t['partner-manager']!)
      .post(`/v1/admin/factories/${factoryId}/process-capabilities`, {
        processCode: 'window_patching',
        materialClass: 'paperboard',
        leadTimeMinDays: 3,
        leadTimeMaxDays: 4,
      })
      .expect(201);
    const sod = await as(ctx, t['partner-manager']!)
      .post(`/v1/admin/factories/${factoryId}/process-capabilities/${self.body.id}/actions/verify`, {
        siteVisitId: (await visit('pass')).publicId,
      })
      .expect(403);
    expect(sod.body.code).toBe('partners.maker_checker');
    await as(ctx, t['partner-manager']!)
      .post(`/v1/admin/factories/${factoryId}/process-capabilities/${self.body.id}/actions/reject`, {
        note: 'e2e',
      })
      .expect(200);
  });

  it('lists, searches, filters and facets published styles, without factory data (D-245)', async () => {
    const list = await request(ctx.server).get('/v1/store/styles?limit=100&category=corrugated').expect(200);
    expect(codes(list.body)).toEqual(expect.arrayContaining(['PK-CS-01', 'PK-CS-02']));
    const card = (list.body as { data: Card[] }).data.find((c) => c.code === 'PK-CS-01')!;
    expect(card).toMatchObject({ variantCount: 9, favourite: null, pricePath: 'rfq' });
    const facets = list.body.facets as Record<string, Facet[]>;
    expect(facets['category']).toEqual([{ value: 'corrugated', count: expect.any(Number) }]);
    expect(facets['feature']!.map((f) => f.value)).toContain('hand_holes:end_panels');
    expect(JSON.stringify(list.body)).not.toMatch(/factory|F9001/i);

    const exact = await request(ctx.server).get('/v1/store/styles?q=PK-CS-01').expect(200);
    expect(codes(exact.body)[0]).toBe('PK-CS-01');
    const typo = await request(ctx.server).get('/v1/store/styles?q=sloted').expect(200);
    expect(codes(typo.body)).toEqual(expect.arrayContaining(['PK-CS-01']));
    const base = await ctx.prisma.styleBase.findUniqueOrThrow({ where: { code: 'PK-CS-01' } });
    const thai = await request(ctx.server)
      .get(`/v1/store/styles?q=${encodeURIComponent(base.nameTh.slice(0, 6))}`)
      .expect(200);
    expect(codes(thai.body)).toContain('PK-CS-01');
    const filtered = await request(ctx.server)
      .get('/v1/store/styles?feature=hand_holes:end_panels&limit=100')
      .expect(200);
    expect(codes(filtered.body)).toContain('PK-CS-01');
    expect(
      codes(
        (await request(ctx.server).get('/v1/store/styles?closure=tuck_bottom:crash_lock').expect(200)).body,
      ),
    ).not.toContain('PK-CS-01');
    const paged = await request(ctx.server).get('/v1/store/styles?limit=1&sort=name').expect(200);
    if (paged.body.meta.nextCursor) {
      const next = await request(ctx.server)
        .get(`/v1/store/styles?limit=1&sort=name&cursor=${paged.body.meta.nextCursor}`)
        .expect(200);
      expect(codes(next.body)[0]).not.toBe(codes(paged.body)[0]);
      await request(ctx.server)
        .get(`/v1/store/styles?limit=1&sort=new&cursor=${paged.body.meta.nextCursor}`)
        .expect(422);
    }
  });

  it('lists every shown variant as a card, options filtered with disjunctive facets (D-410)', async () => {
    type VariantCard = { code: string; baseCode: string; options: Record<string, string> };
    type Page = {
      data: VariantCard[];
      facets: { option: Facet[] };
      meta: { nextCursor: string | null; total: number; libraryTotal: number; libraryStyles: number };
    };
    const get = async (qs: string) =>
      (await request(ctx.server).get(`/v1/store/styles/variants?family=slotted&${qs}`).expect(200))
        .body as Page;
    const count = (page: Page, value: string) =>
      page.facets.option.find((f) => f.value === value)?.count ?? 0;

    const all = await get('limit=100');
    const cs01 = all.data.filter((c) => c.baseCode === 'PK-CS-01');
    expect(cs01).toHaveLength(9);
    expect(cs01[0]!.code).toMatch(/^PK-CS-01-[A-Z2-7]{4}$/);
    expect(all.meta.libraryTotal).toBeGreaterThanOrEqual(18);
    expect(all.meta.libraryStyles).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(all)).not.toMatch(/factory|F9001/i);

    const one = await get('limit=100&style=PK-CS-01');
    expect(one.meta.total).toBe(9);
    expect(one.data.every((c) => c.baseCode === 'PK-CS-01')).toBe(true);
    // A variant without an axis counts, and filters, as `none`.
    const plain = await get('limit=100&style=PK-CS-01&option=window:none');
    expect(plain.meta.total).toBe(9);
    expect(count(plain, 'window:none')).toBe(9);

    const end = await get('limit=100&option=hand_holes:end_panels');
    expect(end.data.every((c) => c.options['hand_holes'] === 'end_panels')).toBe(true);
    expect(end.data.filter((c) => c.baseCode === 'PK-CS-01')).toHaveLength(3);
    // Disjunctive: a chosen value keeps its siblings' counts; other axes count the matches.
    expect(count(end, 'hand_holes:side_panels')).toBe(count(all, 'hand_holes:side_panels'));
    expect(count(end, 'joint:tape_joint')).toBe(
      end.data.filter((c) => c.options['joint'] === 'tape_joint').length,
    );
    const either = await get('limit=100&option=hand_holes:end_panels,hand_holes:side_panels');
    expect(either.meta.total).toBe(end.meta.total + count(end, 'hand_holes:side_panels'));
    const both = await get('limit=100&option=hand_holes:end_panels&option=joint:tape_joint');
    expect(both.meta.total).toBeGreaterThan(0);
    expect(
      both.data.every((c) => c.options['hand_holes'] === 'end_panels' && c.options['joint'] === 'tape_joint'),
    ).toBe(true);

    const first = await get('limit=4&sort=name');
    expect(first.data).toHaveLength(4);
    expect(first.meta.total).toBe(all.meta.total);
    const second = await get(`limit=4&sort=name&cursor=${first.meta.nextCursor}`);
    expect(second.data.map((c) => c.code)).not.toContain(first.data[0]!.code);
    await request(ctx.server).get('/v1/store/styles/variants?option=window').expect(422);

    // The style card's option chips.
    const list = await request(ctx.server).get('/v1/store/styles?limit=100&category=corrugated').expect(200);
    const card = (list.body as { data: (Card & { options: string[] })[] }).data.find(
      (c) => c.code === 'PK-CS-01',
    )!;
    expect(card.options).toEqual(expect.arrayContaining(['hand_holes:end_panels', 'joint:tape_joint']));
    expect(card.options).not.toContain('hand_holes:none');
  });

  it('details a style: combinations, size ranges, lead time, no partners count below three factories (D-201)', async () => {
    const res = await request(ctx.server).get('/v1/store/styles/PK-CS-01').expect(200);
    expect(res.body).toMatchObject({
      code: 'PK-CS-01',
      partnersCount: null,
      leadTime: { minDays: 5, maxDays: 9 },
    });
    expect(res.body.variants).toHaveLength(9);
    expect(res.body.sizeRanges).toEqual([
      {
        materialClass: 'corrugated',
        source: 'recipe',
        minWMm: 100,
        maxWMm: 600,
        minLMm: 100,
        maxLMm: 800,
        minHMm: 50,
        maxHMm: 600,
      },
    ]);
    const axes = res.body.axes as { axis: string; values: string[] }[];
    expect(axes.map((a) => a.axis)).toEqual(['joint', 'hand_holes']);
    const compared = await request(ctx.server)
      .get('/v1/store/styles/compare?codes=PK-CS-02,PK-CS-01')
      .expect(200);
    expect((compared.body as { code: string }[]).map((c) => c.code)).toEqual(['PK-CS-02', 'PK-CS-01']);
    await request(ctx.server)
      .get('/v1/store/styles/compare?codes=PK-CS-01,PK-CS-02,PK-CS-03,PK-CS-04')
      .expect(422);
    expect(
      (await request(ctx.server).get('/v1/store/styles/compare?codes=PK-CS-01,PK-ZZ-01').expect(404)).body
        .code,
    ).toBe('styles.variant_not_found');
  });

  it('keeps favourites per customer (D-246)', async () => {
    await request(ctx.server).get('/v1/store/style-favourites').expect(401);
    await as(ctx, t['customer']!).put('/v1/store/style-favourites/PK-CS-01').expect(204);
    await as(ctx, t['customer']!).put('/v1/store/style-favourites/PK-CS-01').expect(204);
    const favs = await as(ctx, t['customer']!).get('/v1/store/style-favourites').expect(200);
    expect((favs.body as { style: Card }[]).map((f) => f.style.code)).toEqual(['PK-CS-01']);
    const list = await as(ctx, t['customer']!)
      .get('/v1/store/styles?category=corrugated&limit=100')
      .expect(200);
    expect((list.body as { data: Card[] }).data.find((c) => c.code === 'PK-CS-01')!.favourite).toBe(true);
    await as(ctx, t['customer']!).delete('/v1/store/style-favourites/PK-CS-01').expect(204);
    expect((await as(ctx, t['customer']!).get('/v1/store/style-favourites').expect(200)).body).toEqual([]);
    await as(ctx, t['customer']!).put('/v1/store/style-favourites/PK-ZZ-01').expect(404);
  });

  it('curates with If-Match: a hidden style leaves the library (D-246, D-243)', async () => {
    const base = await ctx.prisma.styleBase.findUniqueOrThrow({ where: { code: 'PK-CS-02' } });
    const got = await as(ctx, t['marketing']!).get(`/v1/admin/styles/${base.publicId}`).expect(200);
    const etag = got.headers['etag'] as string;
    await as(ctx, t['marketing']!).patch(`/v1/admin/styles/${base.publicId}`, { hidden: true }).expect(428);
    await as(ctx, t['cs']!)
      .patch(`/v1/admin/styles/${base.publicId}`, { hidden: true })
      .set('If-Match', etag)
      .expect(403);
    const hidden = await as(ctx, t['marketing']!)
      .patch(`/v1/admin/styles/${base.publicId}`, { hidden: true, useCases: ['produce', 'shipping'] })
      .set('If-Match', etag)
      .expect(200);
    await as(ctx, t['marketing']!)
      .patch(`/v1/admin/styles/${base.publicId}`, { featured: true })
      .set('If-Match', etag)
      .expect(412);
    expect(
      codes((await request(ctx.server).get('/v1/store/styles?limit=100').expect(200)).body),
    ).not.toContain('PK-CS-02');
    await as(ctx, t['marketing']!)
      .patch(`/v1/admin/styles/${base.publicId}`, { hidden: false })
      .set('If-Match', hidden.headers['etag'] as string)
      .expect(200);
    const back = await request(ctx.server).get('/v1/store/styles?useCase=produce').expect(200);
    expect(codes(back.body)).toContain('PK-CS-02');
  });

  it('prices a publishable variant instantly only with every option priced; RFQ otherwise (D-243, D-266, D-268, D-269)', async () => {
    await ctx.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'instant' } });
    const pattern = await ctx.prisma.pattern.findUniqueOrThrow({
      where: { publicId: corrugate.rscPatternPublicId },
    });
    await ctx.prisma.styleBase.update({ where: { code: 'PK-CS-01' }, data: { patternId: pattern.id } });
    const variant = await ctx.prisma.styleVariant.findFirstOrThrow({
      where: { base: { code: 'PK-CS-01' }, publishable: true },
    });
    const configuration = {
      patternId: corrugate.rscPatternPublicId,
      catalogProductId: corrugate.catalogProductPublicId,
      w: 300,
      l: 400,
      d: 250,
      materialId: corrugate.boardPublicId,
      difficultyLevelId: corrugate.difficultyLevelPublicId,
      quantities: [1000],
      parts: [{ printFront: [{ inkColourId: corrugate.inkColourPublicId, area: 'top' }] }],
      styleVariantCode: variant.code,
    };
    // D-266: no price rule covers its options yet → RFQ (after the recompute that sees the instant type).
    await ctx.app.get(StylesJobs).nightly();
    const rfq = await request(ctx.server)
      .post('/v1/store/quotes/actions/calculate')
      .send({ productTypeCode: 'corrugated', configuration })
      .expect(200);
    expect(rfq.body.steps[0]).toMatchObject({ instant: false, reason: 'rfq_required' });
    let row = await ctx.prisma.styleVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(row).toMatchObject({ pricePath: 'rfq', priceReasons: ['option_not_priced'] });

    // D-268: Prepress prices each option value of the variant (neutral here); the price path follows at once.
    const values = Object.entries(variant.options as Record<string, unknown>).flatMap(([axis, v]) =>
      (Array.isArray(v) ? v.map(String) : [String(v)])
        .filter((x) => x !== 'none')
        .map((value) => ({ axis, value })),
    );
    await as(ctx, t['cs']!)
      .post('/v1/admin/style-price-rules', {
        calculatorKey: 'corrugate',
        axis: 'x',
        value: 'y',
        effect: 'neutral',
        note: 'fake',
      })
      .expect(403);
    const created: string[] = [];
    for (const v of values) {
      const res = await as(ctx, t['prepress']!)
        .post('/v1/admin/style-price-rules', {
          calculatorKey: 'corrugate',
          ...v,
          effect: 'neutral',
          note: 'ไม่กระทบราคา (fake)',
        })
        .expect(201);
      created.push(res.body.id as string);
    }
    if (values.length > 0) {
      const dup = await as(ctx, t['prepress']!)
        .post('/v1/admin/style-price-rules', {
          calculatorKey: 'corrugate',
          ...values[0]!,
          effect: 'neutral',
          note: 'fake',
        })
        .expect(409);
      expect(dup.body.code).toBe('styles.price_rule_exists');
    }
    row = await ctx.prisma.styleVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(row).toMatchObject({ pricePath: 'instant', priceReasons: [] });
    const ok = await request(ctx.server)
      .post('/v1/store/quotes/actions/calculate')
      .send({ productTypeCode: 'corrugated', configuration })
      .expect(200);
    expect(ok.body.steps[0].instant).toBe(true);
    const detail = await request(ctx.server).get('/v1/store/styles/PK-CS-01').expect(200);
    expect(
      (detail.body.variants as { code: string; pricePath: string }[]).find((v) => v.code === variant.code),
    ).toMatchObject({
      pricePath: 'instant',
    });

    // D-269: an RFQ names the published variant; staff and the request carry the style.
    const submitted = await as(ctx, t['customer']!)
      .post('/v1/store/rfqs', {
        productTypeCode: 'corrugated',
        spec: {},
        quantities: [500],
        deliveryPostcode: '10110',
        styleVariantCode: variant.code,
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(submitted.body.style).toMatchObject({ variantCode: variant.code, baseCode: 'PK-CS-01' });
    await as(ctx, t['customer']!)
      .post('/v1/store/rfqs', {
        productTypeCode: 'folding_carton',
        spec: {},
        quantities: [500],
        deliveryPostcode: '10110',
        styleVariantCode: variant.code,
      })
      .set('Idempotency-Key', randomUUID())
      .expect(422);

    // Retiring a rule sends the variant back to RFQ.
    if (created.length > 0) {
      await as(ctx, t['prepress']!)
        .post(`/v1/admin/style-price-rules/${created[0]}/actions/retire`, { reason: 'ทดสอบ (fake)' })
        .expect(200);
      row = await ctx.prisma.styleVariant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(row.pricePath).toBe('rfq');
      for (const id of created.slice(1))
        await as(ctx, t['prepress']!)
          .post(`/v1/admin/style-price-rules/${id}/actions/retire`, { reason: 'cleanup (fake)' })
          .expect(200);
    }
    const other = await ctx.prisma.styleVariant.findFirstOrThrow({
      where: { base: { code: 'PK-CS-02' }, publishable: true },
    });
    const mismatch = await request(ctx.server)
      .post('/v1/store/quotes/actions/calculate')
      .send({
        productTypeCode: 'corrugated',
        configuration: { ...configuration, styleVariantCode: other.code },
      })
      .expect(200);
    expect(mismatch.body.steps[0]).toMatchObject({ instant: false, reason: 'style_variant_not_publishable' });
    await ctx.prisma.styleBase.update({ where: { code: 'PK-CS-01' }, data: { patternId: null } });
  });

  it('reports coverage and recomputes nightly; a withdrawn capability turns the style to a quotation request at once (D-244, D-407)', async () => {
    const coverage = await as(ctx, t['cs']!).get('/v1/admin/style-coverage').expect(200);
    const corrugated = (coverage.body.categories as { category: string; makeable: number }[]).find(
      (c) => c.category === 'corrugated',
    )!;
    expect(corrugated.makeable).toBeGreaterThanOrEqual(18);
    const slotter = (
      coverage.body.processes as { code: string; factories: number; variantsNeeding: number }[]
    ).find((p) => p.code === 'slotter')!;
    expect(slotter.factories).toBeGreaterThanOrEqual(1);
    expect(await ctx.app.get(StylesJobs).nightly()).toBeGreaterThanOrEqual(18);

    const mine = await as(ctx, owner)
      .get(`/v1/partner/factories/${factoryId}/process-capabilities?status=verified`)
      .expect(200);
    expect((mine.body as { id: string }[]).map((c) => c.id)).toContain(capabilityId);
    await as(ctx, owner)
      .post(`/v1/partner/factories/${factoryId}/process-capabilities/${capabilityId}/actions/withdraw`, {
        note: 'e2e',
      })
      .expect(200);
    const still = await request(ctx.server).get('/v1/store/styles/PK-CS-01').expect(200);
    expect(still.body).toMatchObject({ leadTime: null });
    expect((await priceReasons('PK-CS-01')).every((r) => r.includes('not_makeable'))).toBe(true);
  });
});
