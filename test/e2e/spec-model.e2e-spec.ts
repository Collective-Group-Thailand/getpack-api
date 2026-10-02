import { ConfigurationDraftsService } from '@modules/quotes/configuration-drafts.service';
import request from 'supertest';

import { type DevCorrugate, seedDevCorrugate } from '../../prisma/seed/dev-corrugate';
import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  customerToken,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  staffToken,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

/** Specification model v2 (U2.1): millimetre-only requests and the display unit (D-183). */
describe('specification model v2 (e2e, U2.1)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let customer: string;
  let cs: string;
  let owner: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    customer = (await customerToken(ctx, 61)).token;
    cs = await staffToken(ctx, 'cs');
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 61);
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('refuses any unit in a size, and keeps the display unit per user (D-183)', async () => {
    const withUnit = { ...foldingConfiguration(fixture, [1000]), unit: 'cm' };
    const store = await request(ctx.server)
      .post('/v1/store/quotes/actions/calculate')
      .send({ productTypeCode: 'folding_carton', configuration: withUnit })
      .expect(422);
    expect(store.body.code).toBe('specs.unit_not_accepted');
    expect(store.body.errors[0].path).toBe('configuration.unit');
    const csCalc = await as(ctx, cs).post('/v1/admin/cs/folding/calculate', withUnit).expect(422);
    expect(csCalc.body.code).toBe('specs.unit_not_accepted');
    const path = await request(ctx.server)
      .post('/v1/store/catalog/quote-path')
      .send({ productTypeCode: 'folding_carton', configuration: { widthMm: 60, sizeUnit: 'in' } })
      .expect(422);
    expect(path.body.code).toBe('specs.unit_not_accepted');

    const me = await as(ctx, customer).get('/v1/store/me').expect(200);
    expect(me.body.displayUnit).toBe('mm');
    const set = await as(ctx, customer).patch('/v1/store/me/preferences', { displayUnit: 'in' }).expect(200);
    expect(set.body.displayUnit).toBe('in');
    await as(ctx, customer).patch('/v1/store/me/preferences', { displayUnit: 'ft' }).expect(422);
    expect(
      (await as(ctx, cs).patch('/v1/admin/me/preferences', { displayUnit: 'cm' }).expect(200)).body
        .displayUnit,
    ).toBe('cm');
    expect(
      (await as(ctx, owner).patch('/v1/partner/me/preferences', { displayUnit: 'cm' }).expect(200)).body
        .displayUnit,
    ).toBe('cm');
  });

  it('shows a size on every measurement basis from the material caliper (D-182)', async () => {
    const convert = (body: object) =>
      request(ctx.server).post('/v1/store/specs/actions/convert-dimensions').send(body);
    // Without a style the size is a closed box; DEV-FLAT (geometry `flat`) is a flat blank.
    const base = {
      productTypeCode: 'folding_carton',
      w: 100,
      l: 150,
      d: 50,
    };
    await ctx.prisma.material.update({ where: { code: 'dev-art-350' }, data: { caliperMm: null } });
    const unknown = await convert({
      ...base,
      materialId: fixture.materialPublicId,
      basis: 'external',
    }).expect(200);
    expect(unknown.body).toMatchObject({
      caliperMm: null,
      sizes: { internal: null, external: { w: 100, l: 150, d: 50 } },
    });
    await ctx.prisma.material.update({ where: { code: 'dev-art-350' }, data: { caliperMm: 0.5 } });
    try {
      const res = await convert({ ...base, materialId: fixture.materialPublicId, basis: 'internal' }).expect(
        200,
      );
      expect(res.body).toMatchObject({
        caliperMm: 0.5,
        conversionVersion: '1.0.0',
        sizes: {
          internal: { w: 100, l: 150, d: 50 },
          external: { w: 101, l: 151, d: 51 },
          overCrease: { w: 100.5, l: 150.5, d: 51 },
        },
      });
      const flat = await convert({ ...base, patternId: fixture.patternPublicId, basis: 'product' }).expect(
        200,
      );
      expect(flat.body).toMatchObject({
        family: 'flat',
        bases: ['product'],
        sizes: { product: { w: 100, l: 150, d: 50 } },
      });
      const wrong = await convert({ ...base, patternId: fixture.patternPublicId, basis: 'internal' }).expect(
        422,
      );
      expect(wrong.body.code).toBe('specs.basis_not_accepted');
      expect((await convert({ ...base, basis: 'internal', unit: 'in' }).expect(422)).body.code).toBe(
        'specs.unit_not_accepted',
      );
    } finally {
      await ctx.prisma.material.update({ where: { code: 'dev-art-350' }, data: { caliperMm: null } });
    }
  });

  it('prices a box on its inside size whatever basis it was measured on, and freezes it (D-182)', async () => {
    const corrugate: DevCorrugate = (
      await ctx.prisma.$transaction((tx) => seedDevCorrugate(tx), { timeout: 60_000 })
    ).fixture;
    const box = (over: Record<string, unknown>) => ({
      patternId: corrugate.rscPatternPublicId,
      catalogProductId: corrugate.catalogProductPublicId,
      materialId: corrugate.boardPublicId,
      difficultyLevelId: corrugate.difficultyLevelPublicId,
      quantities: [1000],
      parts: [{ printFront: [{ inkColourId: corrugate.inkColourPublicId, area: 'top' }] }],
      design: { graphic: false, structure: false },
      ...over,
    });
    const board = await ctx.prisma.material.findUniqueOrThrow({
      where: { publicId: corrugate.boardPublicId },
    });
    const calc = (cfg: object) => as(ctx, cs).post('/v1/admin/cs/corrugate/calculate', cfg);
    try {
      await ctx.prisma.material.update({ where: { id: board.id }, data: { caliperMm: null } });
      const noCaliper = await calc(box({ basis: 'external', w: 304, l: 404, d: 254 })).expect(422);
      expect(noCaliper.body.code).toBe('specs.caliper_missing');
      const assumed = await calc(box({ w: 300, l: 400, d: 250 })).expect(200);
      expect(assumed.body.dimensions).toMatchObject({ basis: 'internal', basisAssumed: true, family: 'box' });

      await ctx.prisma.material.update({ where: { id: board.id }, data: { caliperMm: 2 } });
      const inside = await calc(box({ basis: 'internal', w: 300, l: 400, d: 250 })).expect(200);
      const outside = await calc(box({ basis: 'external', w: 304, l: 404, d: 254 })).expect(200);
      expect(outside.body.dimensions).toMatchObject({
        basis: 'external',
        basisAssumed: false,
        entered: { w: 304, l: 404, d: 254 },
        priced: { w: 300, l: 400, d: 250 },
        pricedBasis: 'internal',
        caliperMm: 2,
        sizes: { overCrease: { w: 302, l: 402, d: 254 } },
      });
      expect(outside.body.steps[0].grossAmount).toBe(inside.body.steps[0].grossAmount);
      // D-186: corrugated is ± 3 mm; colour ≤ 5 ΔE on flexo, ≤ 3 otherwise.
      const internal = inside.body.steps[0].internal as { printTypeId: string; priceListVersionId: string };
      const terms = await ctx.prisma.plCorrugatePrintTypeTerm.findFirstOrThrow({
        where: {
          printType: { publicId: internal.printTypeId },
          priceListVersion: { publicId: internal.priceListVersionId },
        },
      });
      expect(inside.body.steps[0]).toMatchObject({
        toleranceDimensionalMm: '3.00',
        toleranceColourDeltaE: terms.engineVariant === 'flexo' ? '5.00' : '3.00',
      });
      await calc(box({ basis: 'product', w: 300, l: 400, d: 250 })).expect(422);

      const rsc = await ctx.prisma.pattern.findUniqueOrThrow({
        where: { publicId: corrugate.rscPatternPublicId },
      });
      const rscCode = rsc.styleCode ?? 'PK-DEVRSC-01';
      if (!rsc.styleCode)
        await ctx.prisma.pattern.update({ where: { id: rsc.id }, data: { styleCode: rscCode } });
      await ctx.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'instant' } });
      const saved = await as(ctx, customer)
        .post('/v1/store/quotes', {
          productTypeCode: 'corrugated',
          configuration: box({ basis: 'external', w: 304, l: 404, d: 254 }),
        })
        .expect(201);
      expect(saved.body.dimensions).toMatchObject({ basis: 'external', priced: { w: 300, l: 400, d: 250 } });
      const size = (saved.body.summary.specs as { key: string; valueEn: string }[]).filter((l) =>
        ['size', 'priced_size'].includes(l.key),
      );
      expect(size.map((l) => l.valueEn)).toEqual(['304 × 404 × 254 mm (outside)', '300 × 400 × 250 mm']);
      expect(saved.body.summary.specs).toContainEqual(
        expect.objectContaining({ key: 'style_code', valueEn: rscCode }),
      );
      // A later caliper change never changes what the saved quote means.
      await ctx.prisma.material.update({ where: { id: board.id }, data: { caliperMm: 3 } });
      const again = await as(ctx, customer).get(`/v1/store/quotes/${saved.body.id}`).expect(200);
      expect(again.body.dimensions).toEqual(saved.body.dimensions);
    } finally {
      await ctx.prisma.material.update({ where: { id: board.id }, data: { caliperMm: null } });
      await ctx.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'rfq' } });
    }
  });

  it('measures a flat product on its finished size and an RFQ on the basis it names (D-182)', async () => {
    const flat = await as(ctx, cs)
      .post('/v1/admin/cs/folding/calculate', { ...foldingConfiguration(fixture, [1000]), basis: 'internal' })
      .expect(422);
    expect(flat.body.code).toBe('specs.basis_not_accepted');
    const product = await as(ctx, cs)
      .post('/v1/admin/cs/folding/calculate', { ...foldingConfiguration(fixture, [1000]), basis: 'product' })
      .expect(200);
    expect(product.body.dimensions).toMatchObject({
      family: 'flat',
      basis: 'product',
      pricedBasis: 'product',
    });
  });

  it('publishes a style only with its public style code, and never changes it afterwards (D-184, F6)', async () => {
    const admin = await staffToken(ctx, 'admin');
    const type = await ctx.prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
    const run = `${Date.now() % 1_000_000}`;
    const patch = (id: string, body: object, etag: string) =>
      as(ctx, admin).patch(`/v1/admin/catalog/patterns/${id}`, body).set('If-Match', etag);
    const created = await as(ctx, admin)
      .post('/v1/admin/catalog/patterns', {
        productTypeId: type.publicId,
        code: `E2E-SC-${run}`,
        name: 'ทดสอบรหัสแบบ',
      })
      .expect(201);
    expect(created.body).toMatchObject({ styleCode: null, publishedAt: null });
    let etag = created.headers['etag'] as string;
    const noCode = await patch(created.body.id, { status: 'active' }, etag).expect(422);
    expect(noCode.body.code).toBe('catalog.style_code_required');
    await patch(created.body.id, { styleCode: 'RTE-01' }, etag).expect(422);
    const styleCode = `PK-E2E-${run.slice(-2).padStart(2, '0')}`;
    await ctx.prisma.pattern
      .updateMany({ where: { styleCode }, data: { styleCode: null } })
      .catch(() => undefined);
    const published = await patch(created.body.id, { styleCode, status: 'active' }, etag).expect(200);
    expect(published.body.styleCode).toBe(styleCode);
    expect(published.body.publishedAt).toEqual(expect.any(String));
    etag = published.headers['etag'] as string;
    expect((await patch(created.body.id, { styleCode: 'PK-E2E-99' }, etag).expect(409)).body.code).toBe(
      'catalog.style_code_immutable',
    );
    await patch(created.body.id, { code: `E2E-SC2-${run}` }, etag).expect(409);
    // The database refuses it too, whoever writes the row (import, seed).
    await expect(
      ctx.prisma.pattern.update({ where: { publicId: created.body.id }, data: { code: `E2E-SC3-${run}` } }),
    ).rejects.toThrow();
    const named = await patch(created.body.id, { internationalName: 'RTE' }, etag).expect(200);
    expect(named.body).toMatchObject({
      internationalName: 'RTE',
      internationalNameVerifiedAt: expect.any(String),
    });
    await ctx.prisma.pattern.update({ where: { publicId: created.body.id }, data: { status: 'archived' } });
  });

  it('publishes dimensional and colour tolerances before purchase and freezes them (D-186)', async () => {
    const tolerances = async (code: string) => {
      const type = await ctx.prisma.productType.findUniqueOrThrow({ where: { code } });
      return request(ctx.server).get(`/v1/store/catalog/types/${type.publicId}/tolerances`).expect(200);
    };
    expect((await tolerances('folding_carton')).body).toMatchObject({
      productTypeCode: 'folding_carton',
      quantityShortagePct: '5.0000',
      dimensionalMm: '1.00',
      colourDeltaE: { standard: '3.00', flexo: '3.00' },
    });
    expect((await tolerances('corrugated')).body).toMatchObject({
      dimensionalMm: '3.00',
      colourDeltaE: { standard: '3.00', flexo: '5.00' },
    });
    // No calculator: nothing published beyond the quantity.
    expect((await tolerances('paper_bag')).body).toMatchObject({
      dimensionalMm: null,
      colourDeltaE: null,
    });
    await request(ctx.server)
      .get('/v1/store/catalog/types/0192f3a0-7c1e-7d2a-9b1f-00000000ffff/tolerances')
      .expect(404);

    const priced = await as(ctx, customer)
      .post('/v1/store/quotes/actions/calculate', {
        productTypeCode: 'folding_carton',
        configuration: foldingConfiguration(fixture, [1000]),
      })
      .expect(200);
    expect(priced.body.steps[0]).toMatchObject({
      toleranceDimensionalMm: '1.00',
      toleranceColourDeltaE: '3.00',
    });
    const saved = await as(ctx, customer)
      .post('/v1/store/quotes', {
        productTypeCode: 'folding_carton',
        configuration: foldingConfiguration(fixture, [1000]),
      })
      .expect(201);
    expect(saved.body.options[0]).toMatchObject({
      toleranceDimensionalMm: '1.00',
      toleranceColourDeltaE: '3.00',
    });
    const option = await ctx.prisma.quoteOption.findFirstOrThrow({
      where: { quote: { publicId: saved.body.id as string } },
    });
    expect(option.toleranceDimensionalMm?.toFixed(2)).toBe('1.00');
    expect(option.toleranceColourDeltaE?.toFixed(2)).toBe('3.00');
  });

  it('expires and revokes quotation share links (D-185, F5)', async () => {
    const saved = await as(ctx, customer)
      .post('/v1/store/quotes', {
        productTypeCode: 'folding_carton',
        configuration: foldingConfiguration(fixture, [1000]),
      })
      .expect(201);
    const share = () => as(ctx, customer).post(`/v1/store/quotes/${saved.body.id}/actions/share`).expect(200);
    const open = (path: string) => request(ctx.server).get(path);
    const first = await share();
    const days = (new Date(first.body.expiresAt as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(14.9);
    expect(days).toBeLessThanOrEqual(15);
    expect(first.body.quote.shareExpiresAt).toEqual(expect.any(String));
    await open(first.body.sharePath as string).expect(200);
    const revoked = await as(ctx, customer).delete(`/v1/store/quotes/${saved.body.id}/share`).expect(200);
    expect(revoked.body).toMatchObject({ status: 'saved', shareExpiresAt: null });
    await open(first.body.sharePath as string).expect(404);
    const second = await share();
    await open(second.body.sharePath as string).expect(200);
    await ctx.prisma.quote.update({
      where: { publicId: saved.body.id },
      data: { shareExpiresAt: new Date(Date.now() - 1000) },
    });
    await open(second.body.sharePath as string).expect(404);
  });

  it('keeps, completes, shares and converts draft configurations (D-185)', async () => {
    const other = (await customerToken(ctx, 62)).token;
    const drafts = '/v1/store/configurations';
    const partial = await as(ctx, customer)
      .post(drafts, {
        productTypeCode: 'folding_carton',
        title: 'กล่องทดสอบ',
        configuration: { patternId: fixture.patternPublicId },
      })
      .expect(201);
    expect(partial.body).toMatchObject({ status: 'open', complete: false, title: 'กล่องทดสอบ' });
    expect(partial.body.completenessPct).toBeGreaterThan(0);
    expect(partial.body.completenessPct).toBeLessThan(100);
    expect(partial.body.missingFields).toEqual(
      expect.arrayContaining(['basis', 'materialId', 'quantities', 'w']),
    );
    const days = (new Date(partial.body.expiresAt as string).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(90);
    const id = partial.body.id as string;
    await as(ctx, other).get(`${drafts}/${id}`).expect(404);
    expect(
      (
        await as(ctx, customer)
          .post(drafts, { productTypeCode: 'folding_carton', configuration: { unit: 'cm' } })
          .expect(422)
      ).body.code,
    ).toBe('specs.unit_not_accepted');
    const incomplete = await as(ctx, customer)
      .post(`${drafts}/${id}/actions/convert-to-quote`, {})
      .expect(422);
    expect(incomplete.body.code).toBe('configurations.incomplete');

    const full = { ...foldingConfiguration(fixture, [1000]), basis: 'product' };
    const done = await as(ctx, customer).patch(`${drafts}/${id}`, { configuration: full }).expect(200);
    expect(done.body).toMatchObject({
      complete: true,
      completenessPct: 100,
      missingFields: [],
      invalidFields: [],
    });
    expect((await as(ctx, customer).get(`${drafts}?perPage=100`).expect(200)).body.data).toContainEqual(
      expect.objectContaining({ id }),
    );

    const shared = await as(ctx, customer).post(`${drafts}/${id}/actions/share`, {}).expect(200);
    const opened = await request(ctx.server)
      .get(shared.body.sharePath as string)
      .expect(200);
    expect(opened.body).toMatchObject({ productTypeCode: 'folding_carton', completenessPct: 100 });
    expect(JSON.stringify(opened.body)).not.toMatch(/owner|customer/i);
    await as(ctx, customer).delete(`${drafts}/${id}/share`).expect(200);
    await request(ctx.server)
      .get(shared.body.sharePath as string)
      .expect(404);

    const converted = await as(ctx, customer)
      .post(`${drafts}/${id}/actions/convert-to-quote`, {})
      .expect(200);
    expect(converted.body.draft).toMatchObject({
      status: 'converted',
      convertedQuoteId: converted.body.quote.id,
    });
    expect(converted.body.quote.dimensions).toMatchObject({ basis: 'product' });
    expect((await as(ctx, customer).patch(`${drafts}/${id}`, { title: 'x' }).expect(409)).body.code).toBe(
      'configurations.converted',
    );

    const second = await as(ctx, customer)
      .post(drafts, {
        productTypeCode: 'folding_carton',
        configuration: { ...full, quantities: [500, 2000] },
      })
      .expect(201);
    const rfq = await as(ctx, customer)
      .post(`${drafts}/${second.body.id}/actions/convert-to-rfq`, { deliveryPostcode: '99999' })
      .expect(200);
    expect(rfq.body.rfqCode).toEqual(expect.any(String));
    expect(rfq.body.draft).toMatchObject({ status: 'converted', convertedRfqId: rfq.body.rfqId });
    const row = await ctx.prisma.rfq.findUniqueOrThrow({
      where: { publicId: rfq.body.rfqId },
      include: { tiers: true },
    });
    expect(row.measurementBasis).toBe('product');
    expect(row.tiers.map((x) => x.quantity).sort((a, b) => a - b)).toEqual([500, 2000]);

    const stale = await as(ctx, customer)
      .post(drafts, { productTypeCode: 'folding_carton', configuration: {} })
      .expect(201);
    await ctx.prisma.configurationDraft.update({
      where: { publicId: stale.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await ctx.app.get(ConfigurationDraftsService).purgeExpired()).toBeGreaterThanOrEqual(1);
    await as(ctx, customer).get(`${drafts}/${stale.body.id}`).expect(404);
  });
});
