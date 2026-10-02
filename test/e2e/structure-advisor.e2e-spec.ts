import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { type DevAdvisory, seedDevAdvisory } from '../../prisma/seed/dev-advisory';
import { type DevCorrugate, seedDevCorrugate } from '../../prisma/seed/dev-corrugate';
import { seedDevFolding } from '../../prisma/seed/dev-folding';
import { ADVISOR_FLAG } from '../../src/modules/advisory/advisory.service';
import {
  as,
  bootCommerceApp,
  type CommerceApp,
  customerToken,
  setFlag,
  staffToken,
  uploadFile,
} from '../support/commerce-e2e';
import { factoryToken } from '../support/fulfilment-e2e';

type Option = {
  board: { id: string };
  passes: boolean;
  warnings: string[];
  bct: { low: number; high: number };
  unitPrice: string | null;
};
const options = (body: unknown) => (body as { options: Option[] }).options;
const boardIds = (body: unknown) => options(body).map((o) => o.board.id);
const option = (body: unknown, id: string) => options(body).find((o) => o.board.id === id)!;
type Sheet = { material: { id: string }; ectKnPerM: number };
const sheets = (body: unknown) => (body as { data: Sheet[] }).data;

/** Structure Advisor end to end (U2.2, D-188, D-189, D-235–D-240) on the fake dev factory F9001. */
describe('Structure Advisor (e2e, U2.2)', () => {
  let ctx: CommerceApp;
  let corrugate: DevCorrugate;
  let advisory: DevAdvisory;
  let cs: string;
  let pm: string;
  let customer: string;
  let owner: string;
  const anon = randomUUID();

  beforeAll(async () => {
    ctx = await bootCommerceApp();
    await ctx.prisma.$transaction((tx) => seedDevFolding(tx), { timeout: 60_000 });
    corrugate = (await ctx.prisma.$transaction((tx) => seedDevCorrugate(tx), { timeout: 60_000 })).fixture;
    advisory = (await ctx.prisma.$transaction((tx) => seedDevAdvisory(tx), { timeout: 60_000 })).fixture;
    await ctx.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'instant' } });
    await setFlag(ctx, ADVISOR_FLAG, false);
    cs = await staffToken(ctx, 'cs');
    pm = await staffToken(ctx, 'partner-manager');
    customer = (await customerToken(ctx, 1)).token;
    owner = await factoryToken(ctx, corrugate.factoryPublicId, 'factory_owner', 71);
  });

  afterAll(async () => {
    // Other suites expect corrugate to stay RFQ (A-16) and the advisor off.
    await ctx?.prisma.productType.update({ where: { code: 'corrugated' }, data: { quoteMode: 'rfq' } });
    if (ctx) await setFlag(ctx, ADVISOR_FLAG, false);
    await ctx?.app.close();
  });

  const configuration = (over: Record<string, unknown> = {}) => ({
    patternId: corrugate.rscPatternPublicId,
    catalogProductId: corrugate.catalogProductPublicId,
    w: 300,
    l: 400,
    d: 250,
    materialId: corrugate.boardPublicId,
    difficultyLevelId: corrugate.difficultyLevelPublicId,
    quantities: [1000],
    parts: [{ printFront: [{ inkColourId: corrugate.inkColourPublicId, area: 'top' }] }],
    ...over,
  });
  const light = {
    productWeightG: 500,
    unitsPerBox: 10,
    stackLayers: 4,
    pallet: { pattern: 'column', overhang: false },
    fragility: 'low',
    transportMode: 'pallet_domestic',
    humidity: 'normal',
    storage: 'up_to_30_days',
  };
  const heavy = {
    ...light,
    productWeightG: 900,
    stackLayers: 6,
    pallet: null,
    transportMode: 'parcel_domestic',
    fragility: 'medium',
  };
  const body = (load: object, over: Record<string, unknown> = {}) => ({
    productTypeCode: 'corrugated',
    configuration: configuration(over),
    load,
  });
  const ka185 = () => corrugate.heavierBoardPublicIds[0];
  const ki230 = () => corrugate.heavierBoardPublicIds[1];

  it('publishes the method from the rule set in force and stays closed to customers while the flag is off', async () => {
    const method = await request(ctx.server).get('/v1/store/advisory/method').expect(200);
    expect(method.body).toMatchObject({
      available: false,
      noticeCode: 'advisory.indicative',
      engineVersion: '1.0.0',
    });
    expect(method.body.ruleSet.mckeeConstant).toBe('5.87');
    const refused = await request(ctx.server)
      .post('/v1/store/advisory/recommendations')
      .send({ ...body(light), anonymousId: anon })
      .expect(409);
    expect(refused.body.code).toBe('advisory.disabled');
  });

  it('lets staff evaluate while the flag is off, with the board data and the boards excluded for missing data', async () => {
    const res = await as(ctx, cs).post('/v1/admin/advisory/actions/evaluate', body(light)).expect(200);
    expect(res.body).toMatchObject({
      outcome: 'recommended',
      channel: 'cs',
      recommendedBoardId: corrugate.boardPublicId,
    });
    expect((res.body as { excluded: { board: { id: string } }[] }).excluded.map((e) => e.board.id)).toEqual([
      ki230(),
    ]);
    expect(res.body.boardData).toEqual(
      expect.arrayContaining([
        {
          boardId: corrugate.boardPublicId,
          sheetId: advisory.sheets[corrugate.boardPublicId],
          factoryId: corrugate.factoryPublicId,
          sheetSource: 'priced_factory',
        },
      ]),
    );
    await as(ctx, owner).post('/v1/admin/advisory/actions/evaluate', body(light)).expect(403);
    await request(ctx.server).post('/v1/admin/advisory/actions/evaluate').send(body(light)).expect(401);
  });

  it('refuses styles the rule set does not cover (D-235)', async () => {
    const res = await as(ctx, cs)
      .post(
        '/v1/admin/advisory/actions/evaluate',
        body(light, { patternId: corrugate.openTopPatternPublicId }),
      )
      .expect(422);
    expect(res.body.code).toBe('advisory.not_supported');
  });

  describe('with the advisor open to customers', () => {
    let lightId: string;
    let heavyId: string;

    beforeAll(async () => setFlag(ctx, ADVISOR_FLAG, true));

    it('recommends the cheapest passing board to an anonymous session, priced, with no factory data (D-050)', async () => {
      const res = await request(ctx.server)
        .post('/v1/store/advisory/recommendations')
        .send({ ...body(light), anonymousId: anon })
        .expect(201);
      lightId = res.body.id as string;
      expect(res.body).toMatchObject({
        outcome: 'recommended',
        recommendedBoardId: corrugate.boardPublicId,
        noticeCode: 'advisory.indicative',
        warnings: [],
      });
      const rec = option(res.body, corrugate.boardPublicId);
      expect(rec).toMatchObject({
        passes: true,
        instant: true,
        currency: 'THB',
        roles: expect.arrayContaining(['recommended']),
      });
      expect(rec.bct.low).toBeLessThan(rec.bct.high);
      expect(rec.unitPrice).toMatch(/^\d+\.\d{2}$/);
      expect(boardIds(res.body)).not.toContain(ki230());
      expect(
        (res.body as { reasons: { code: string }[] }).reasons.filter((r) => r.code === 'factor'),
      ).toHaveLength(6);
      expect(JSON.stringify(res.body)).not.toMatch(/factory|sheetId|buyPrice|marginAmount|excluded/i);
      expect(JSON.stringify(res.body)).not.toMatch(/\bAI\b/);
    });

    it('shows a recommendation only to its owner', async () => {
      await request(ctx.server)
        .get(`/v1/store/advisory/recommendations/${lightId}?anonymousId=${anon}`)
        .expect(200);
      await request(ctx.server)
        .get(`/v1/store/advisory/recommendations/${lightId}?anonymousId=${randomUUID()}`)
        .expect(404);
      await as(ctx, customer).get(`/v1/store/advisory/recommendations/${lightId}`).expect(404);
    });

    it('recommends the stronger board for a heavier stack and records a choice against a warning on record (D-189)', async () => {
      const res = await as(ctx, customer).post('/v1/store/advisory/recommendations', body(heavy)).expect(201);
      heavyId = res.body.id as string;
      expect(res.body.recommendedBoardId).toBe(ka185());
      const weak = option(res.body, corrugate.boardPublicId);
      expect(weak).toMatchObject({ passes: false, warnings: ['below_requirement'] });
      const missing = await as(ctx, customer)
        .post(`/v1/store/advisory/recommendations/${heavyId}/actions/choose`, {
          materialId: corrugate.boardPublicId,
          acknowledgedWarnings: [],
        })
        .expect(422);
      expect(missing.body.code).toBe('advisory.acknowledgement_required');
      const unknown = await as(ctx, customer)
        .post(`/v1/store/advisory/recommendations/${heavyId}/actions/choose`, {
          materialId: ki230(),
          acknowledgedWarnings: [],
        })
        .expect(422);
      expect(unknown.body.code).toBe('advisory.option_unknown');
      const chosen = await as(ctx, customer)
        .post(`/v1/store/advisory/recommendations/${heavyId}/actions/choose`, {
          materialId: corrugate.boardPublicId,
          acknowledgedWarnings: ['below_requirement'],
        })
        .expect(200);
      expect(chosen.body.choice).toMatchObject({
        boardId: corrugate.boardPublicId,
        acknowledgedWarnings: ['below_requirement'],
      });
    });

    it('stores the recommendation and the choice on the saved quotation, refusing a different board (D-240)', async () => {
      const save = (recommendationId: string, materialId: string) =>
        as(ctx, customer).post('/v1/store/quotes', {
          productTypeCode: 'corrugated',
          configuration: configuration({ materialId }),
          advisoryRecommendationId: recommendationId,
        });
      expect((await save(heavyId, ka185()).expect(409)).body.code).toBe('advisory.choice_mismatch');
      const other = await as(ctx, customer)
        .post('/v1/store/advisory/recommendations', body(light))
        .expect(201);
      expect((await save(other.body.id as string, corrugate.boardPublicId).expect(409)).body.code).toBe(
        'advisory.choice_required',
      );
      expect((await save(lightId, corrugate.boardPublicId).expect(422)).body.code).toBe('validation.failed');
      const saved = await save(heavyId, corrugate.boardPublicId).expect(201);
      expect(saved.body.advisory).toMatchObject({ recommendationId: heavyId });

      const staff = await as(ctx, cs).get(`/v1/admin/advisory/recommendations/${heavyId}`).expect(200);
      expect(staff.body.quoteIds).toEqual([saved.body.id]);
      expect(staff.body.choices).toHaveLength(1);
      const quote = await ctx.prisma.quote.findUniqueOrThrow({
        where: { publicId: saved.body.id as string },
      });
      await expect(
        ctx.prisma.quote.update({ where: { id: quote.id }, data: { advisoryChoiceId: null } }),
      ).rejects.toThrow();
    });

    it('replays every logged recommendation exactly, and the log is write-once (D-240)', async () => {
      for (const id of [lightId, heavyId]) {
        const replay = await as(ctx, cs)
          .post(`/v1/admin/advisory/recommendations/${id}/actions/replay`)
          .expect(200);
        expect(replay.body).toEqual({ identical: true, differences: [], engineVersion: '1.0.0' });
      }
      const listed = await as(ctx, cs)
        .get('/v1/admin/advisory/recommendations?outcome=recommended')
        .expect(200);
      expect(listed.body.meta.total).toBeGreaterThanOrEqual(3);
      await as(ctx, owner).get('/v1/admin/advisory/recommendations').expect(403);
      await expect(
        ctx.prisma.advisoryRecommendation.updateMany({
          where: { publicId: lightId },
          data: { warningCodes: [] },
        }),
      ).rejects.toThrow();
    });
  });

  describe('board strength sheets (D-236)', () => {
    let fileId: string;

    beforeAll(async () => {
      fileId = await uploadFile(ctx, pm, 'FAKE-SHEET-KI230', 'document', 'admin');
    });

    const sheet = (over: Record<string, unknown> = {}) => ({
      factoryId: corrugate.factoryPublicId,
      materialId: ki230(),
      ectKnPerM: 9.5,
      caliperMm: 3.4,
      grammageGsm: 700,
      testMethod: 'ISO 3037',
      dataSheetFileId: fileId,
      signedOn: '2026-10-01',
      ...over,
    });

    it('records a signed sheet as a new version for the Partner team only, never backdated', async () => {
      await as(ctx, cs).post('/v1/admin/board-strength-sheets', sheet()).expect(403);
      expect(
        (
          await as(ctx, pm)
            .post('/v1/admin/board-strength-sheets', sheet({ effectiveFrom: '2026-01-01T00:00:00+07:00' }))
            .expect(422)
        ).body.code,
      ).toBe('partners.backdated');
      const folding = await ctx.prisma.material.findFirstOrThrow({
        where: { kind: { not: 'corrugated_board' } },
      });
      expect(
        (
          await as(ctx, pm)
            .post('/v1/admin/board-strength-sheets', sheet({ materialId: folding.publicId }))
            .expect(422)
        ).body.code,
      ).toBe('advisory.material_not_board');
      const created = await as(ctx, pm).post('/v1/admin/board-strength-sheets', sheet()).expect(201);
      expect(created.body).toMatchObject({
        versionNo: 1,
        current: true,
        ectKnPerM: 9.5,
        material: { id: ki230() },
      });
      const second = await as(ctx, pm)
        .post('/v1/admin/board-strength-sheets', sheet({ ectKnPerM: 9.8 }))
        .expect(201);
      expect(second.body.versionNo).toBe(2);
      const first = await as(ctx, pm).get(`/v1/admin/board-strength-sheets/${created.body.id}`).expect(200);
      expect(first.body.current).toBe(false);
      const event = await ctx.prisma.domainEvent.findFirst({
        where: { type: 'factory.board_strength_sheet_recorded', aggregateId: corrugate.factoryPublicId },
        orderBy: { occurredAt: 'desc' },
      });
      expect(event).not.toBeNull();
    });

    it('shows the factory its own sheets and lets it read the signed file', async () => {
      const list = await as(ctx, owner).get('/v1/partner/board-strength-sheets?currentOnly=true').expect(200);
      expect(
        sheets(list.body)
          .map((x) => x.material.id)
          .sort(),
      ).toEqual([corrugate.boardPublicId, ...corrugate.heavierBoardPublicIds].sort());
      const mine = sheets(list.body).find((x) => x.material.id === ki230())!;
      expect(mine.ectKnPerM).toBe(9.8);
      await as(ctx, owner).get(`/v1/partner/files/${fileId}`).expect(200);
    });

    it('lets a board with a sheet in force join the recommendation', async () => {
      const res = await as(ctx, cs).post('/v1/admin/advisory/actions/evaluate', body(heavy)).expect(200);
      expect(res.body.excluded).toEqual([]);
      expect(boardIds(res.body)).toContain(ki230());
    });
  });
});
