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
});
