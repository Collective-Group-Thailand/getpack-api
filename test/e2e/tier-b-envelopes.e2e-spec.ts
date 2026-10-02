import { randomUUID } from 'node:crypto';

import { ENGINE_B_FLAG } from '@modules/pricing/calculators/folding/folding.adapter';
import { FeatureFlagsService } from '@platform/feature-flags/feature-flags.service';
import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import { type DevFoldingB, seedDevFoldingB } from '../../prisma/seed/dev-folding-b';
import {
  as,
  foldingBackToRfq,
  foldingConfiguration,
  foldingReady,
  staffToken,
} from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

/**
 * Tier-B envelopes (U-B6 tail, D-043, D-234) end to end. The type-B factory F9002 becomes the only folding path (the
 * launch factory F9001 is suspended for the suite) at tier B with an envelope: staff set it, the factory reads it and
 * asks for a change, quotes are instant only inside it, and the store sees `partial` availability without a factory.
 */
describe('tier-B envelopes (e2e, U-B6 tail)', () => {
  let ctx: FulfilmentApp;
  let flags: FeatureFlagsService;
  let a: DevFolding;
  let b: DevFoldingB;
  let pm: string;
  let cs: string;
  let owner: string;
  let typeId: string;

  const setFlag = async (enabled: boolean) => {
    await ctx.prisma.featureFlag.update({ where: { key: ENGINE_B_FLAG }, data: { enabled } });
    flags.invalidate();
  };
  const post = (token: string, path: string, body: object) =>
    as(ctx, token).post(path, body).set('Idempotency-Key', randomUUID());
  const envelope = () => ({ materialIds: [a.materialPublicId], quantity: { min: 500, max: 5000 } });

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    flags = ctx.app.get(FeatureFlagsService);
    a = await foldingReady(ctx);
    b = (await ctx.prisma.$transaction((tx) => seedDevFoldingB(tx), { timeout: 60_000 })).fixture;
    await ctx.prisma.factory.update({ where: { code: 'F9001' }, data: { status: 'suspended' } });
    await ctx.prisma.factory.update({ where: { code: 'F9002' }, data: { status: 'active' } });
    await setFlag(true);
    typeId = (await ctx.prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } })).publicId;
    pm = await staffToken(ctx, 'partner_manager');
    cs = await staffToken(ctx, 'cs');
    owner = await factoryToken(ctx, b.factoryPublicId, 'factory_owner', 95);
  });

  afterAll(async () => {
    // Other folding suites price the launch factory alone with engine B off.
    await ctx?.prisma.factory.update({ where: { code: 'F9001' }, data: { status: 'active' } });
    await ctx?.prisma.factory.update({ where: { code: 'F9002' }, data: { status: 'suspended' } });
    if (flags) await setFlag(false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('lets staff set a tier-B envelope, checked per calculator and against the catalogue (D-234)', async () => {
    const url = `/v1/admin/factories/${b.factoryPublicId}/participations`;
    const base = { productTypeId: typeId, reason: 'Art card only, 500–5,000 pieces' };
    const missing = await post(pm, url, { ...base, tier: 'B' }).expect(422);
    expect(missing.body.errors[0].path).toBe('envelope');
    await post(pm, url, { ...base, tier: 'A', envelope: envelope() }).expect(422);
    const notCarried = await post(pm, url, {
      ...base,
      tier: 'B',
      envelope: { stockProductIds: [randomUUID()] },
    }).expect(422);
    expect(notCarried.body.errors[0].path).toBe('envelope.stockProductIds');
    const unknown = await post(pm, url, {
      ...base,
      tier: 'B',
      envelope: { materialIds: [randomUUID()] },
    }).expect(422);
    expect(unknown.body.errors[0].message).toMatch(/not in the catalogue/);
    await post(pm, url, { ...base, tier: 'B', envelope: envelope(), envelopeNote: 'Art card only' }).expect(
      201,
    );

    const config = await as(ctx, pm)
      .get(`/v1/admin/factories/${b.factoryPublicId}/configuration`)
      .expect(200);
    const folding = (config.body.participations as { productTypeId: string; current: object }[]).find(
      (p) => p.productTypeId === typeId,
    )!;
    expect(folding.current).toMatchObject({ tier: 'B', envelope: envelope(), envelopeNote: 'Art card only' });
    // The factory reads its own envelope, never another factory's configuration (D-044).
    const mine = await as(ctx, owner)
      .get(`/v1/partner/factories/${b.factoryPublicId}/configuration`)
      .expect(200);
    expect(JSON.stringify(mine.body)).toContain(a.materialPublicId);
    await as(ctx, owner).get(`/v1/partner/factories/${a.factoryPublicId}/configuration`).expect(404);
  });

  it('prices instantly only inside the envelope, per quantity (D-043, D-234)', async () => {
    const res = await as(ctx, cs)
      .post('/v1/admin/cs/folding/calculate', foldingConfiguration(a, [1000, 10000]))
      .expect(200);
    expect(res.body.steps[0]).toMatchObject({ quantity: 1000, instant: true });
    expect(res.body.steps[0].internal.factoryId).toBe(b.factoryPublicId);
    expect(res.body.steps[1]).toMatchObject({
      quantity: 10000,
      instant: false,
      reason: 'envelope_not_covered',
    });

    const path = await request(ctx.server)
      .post('/v1/store/catalog/quote-path')
      .send({ productTypeCode: 'folding_carton', configuration: foldingConfiguration(a, [1000]) })
      .expect(200);
    expect(path.body).toEqual({
      productTypeCode: 'folding_carton',
      mode: 'instant',
      reason: 'instant_available',
    });
    const outside = await request(ctx.server)
      .post('/v1/store/catalog/quote-path')
      .send({ productTypeCode: 'folding_carton', configuration: foldingConfiguration(a, [20000]) })
      .expect(200);
    expect(outside.body.reason).toBe('envelope_not_covered');
    // A partial configurator state cannot be matched against an envelope yet.
    const loose = await request(ctx.server)
      .post('/v1/store/catalog/quote-path')
      .send({ productTypeCode: 'folding_carton', configuration: { quantity: 1000 } })
      .expect(200);
    expect(loose.body).toMatchObject({ mode: 'rfq', reason: 'envelope_not_covered' });
  });

  it('tells the store the type is partial with what the paths cover, never which factory (D-050, D-044)', async () => {
    const res = await request(ctx.server).get(`/v1/store/catalog/types/${typeId}/availability`).expect(200);
    expect(res.body).toEqual({
      productTypeId: typeId,
      productTypeCode: 'folding_carton',
      availability: 'partial',
      envelope: envelope(),
    });
    expect(JSON.stringify(res.body)).not.toContain(b.factoryPublicId);
    expect(JSON.stringify(res.body)).not.toMatch(/factory/i);
    await request(ctx.server).get(`/v1/store/catalog/types/${randomUUID()}/availability`).expect(404);

    const coverage = await as(ctx, pm).get(`/v1/admin/partners/coverage?productTypeId=${typeId}`).expect(200);
    expect(coverage.body[0].availability).toBe('partial');
    expect(
      (coverage.body[0].factories as { factoryId: string; envelope: object | null }[]).find(
        (f) => f.factoryId === b.factoryPublicId,
      )?.envelope,
    ).toEqual(envelope());
  });

  it('lets the factory ask for a tier-B envelope as a structured change request', async () => {
    const url = `/v1/partner/factories/${b.factoryPublicId}/change-requests`;
    const ask = {
      topic: 'participation_tier',
      message: 'ขอเพิ่มกระดาษคราฟท์ในราคาทันที',
      productTypeId: typeId,
      proposedTier: 'B',
      proposedEnvelope: { materialIds: [a.materialPublicId] },
    };
    const created = await post(owner, url, ask).expect(201);
    expect(created.body).toMatchObject({
      topic: 'participation_tier',
      productTypeId: typeId,
      proposedTier: 'B',
      proposedEnvelope: { materialIds: [a.materialPublicId] },
      status: 'open',
    });
    await post(owner, url, { ...ask, topic: 'other' }).expect(422);
    await post(owner, url, { ...ask, proposedEnvelope: undefined }).expect(422);
    await post(owner, url, { ...ask, proposedTier: 'A' }).expect(422);
    const plain = await post(owner, url, { topic: 'capacity', message: 'ขอเพิ่มกำลังผลิต' }).expect(201);
    expect(plain.body).toMatchObject({ productTypeId: null, proposedTier: null, proposedEnvelope: null });
  });
});
