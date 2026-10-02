import request from 'supertest';

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
});
