import { type DevFolding } from '../../prisma/seed/dev-folding';
import { as, foldingBackToRfq, foldingReady } from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

/** U2.9 partner counters (D-294): one read of everything waiting for the factory. */
describe('partner counters (e2e, U2.9)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  it('counts jobs, samples, claims, consultations, statements and price proposals of my factory only', async () => {
    const owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 171);
    const res = await as(ctx, owner)
      .get(`/v1/partner/factories/${fixture.factoryPublicId}/counters`)
      .expect(200);
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
    });
    const factoryId = factory.id;
    const open = { in: ['accepted', 'in_progress', 'on_hold'] as ('accepted' | 'in_progress' | 'on_hold')[] };
    expect(res.body).toMatchObject({
      awaitingAcceptance: await ctx.prisma.productionJob.count({ where: { factoryId, status: 'released' } }),
      sampleJobsAwaitingAcceptance: await ctx.prisma.productionJob.count({
        where: { factoryId, jobKind: 'mockup', status: 'released' },
      }),
      sampleJobsOpen: await ctx.prisma.productionJob.count({
        where: { factoryId, jobKind: 'mockup', status: open },
      }),
      claimsAwaitingResponse: await ctx.prisma.claim.count({
        where: { factoryId, status: 'factory_review', factoryResponse: null },
      }),
      rfqConsultationsToAnswer: await ctx.prisma.rfqFactoryConsultation.count({
        where: { factoryId, status: 'requested' },
      }),
      statementsToConfirm: await ctx.prisma.billingStatement.count({ where: { factoryId, status: 'sent' } }),
      priceProposalsPending: await ctx.prisma.priceProposal.count({
        where: { priceList: { factoryId }, status: { in: ['submitted', 'under_review', 'countered'] } },
      }),
    });
    for (const v of Object.values(res.body as Record<string, unknown>)) expect(typeof v).toBe('number');

    const other = await ctx.prisma.factory.findFirst({ where: { id: { not: factoryId } } });
    if (other) await as(ctx, owner).get(`/v1/partner/factories/${other.publicId}/counters`).expect(404);
  });
});
