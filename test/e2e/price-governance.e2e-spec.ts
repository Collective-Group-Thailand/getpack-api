import { randomUUID } from 'node:crypto';

import { PrismaService } from '@database/prisma.service';
import { PriceComponentRegistry } from '@modules/partners/pricing/price-component.registry';
import { PriceListsService } from '@modules/partners/pricing/price-lists.service';
import { PriceProposalsService } from '@modules/partners/pricing/price-proposals.service';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { envelopeFromRow } from '@platform/domain-events/domain-event';
import request from 'supertest';

import { seedDev } from '../../prisma/seed/dev-seed';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { E2E_DEV_PASSWORD } from '../support/e2e';
import { PL_TEST_PRICES, PL_TEST_PRICES_SQL } from '../support/price-test-component';

function taxId(seed: number): string {
  const body = `0000${String(seed).padStart(8, '0')}`;
  const sum = [...body].map(Number).reduce((acc, d, i) => acc + d * (13 - i), 0);
  return `${body}${(11 - (sum % 11)) % 10}`;
}

interface Proposal {
  id: string;
  status: string;
  approvalRequestId: string | null;
  resultingVersion: { id: string; versionNo: number; status: string } | null;
  lines: {
    id: string;
    lineKey: string;
    decision: string;
    action: string;
    proposedValues: { qtyFrom: number } | null;
    currentValues: { rate: string } | null;
  }[];
}

/** Price lists, proposals and rate cards (B2.2, D-040, D-042, D-043, D-044, D-100). */
describe('price governance (e2e, B2.2)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const run = (Date.now() % 1_000_000) + 200_000;
  let productTypeId: string;
  let materialId: string;
  const own = { a: { id: '', token: '' }, b: { id: '', token: '' } };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    await seedDev(prisma, E2E_DEV_PASSWORD);
    for (const sql of PL_TEST_PRICES_SQL) await prisma.$executeRawUnsafe(sql);
    app.get(PriceComponentRegistry).register(PL_TEST_PRICES);
    for (const role of ['superadmin', 'partner-manager']) {
      const res = await request(server)
        .post('/v1/auth/staff/login')
        .send({ email: `${role}@example.invalid`, password: E2E_DEV_PASSWORD })
        .expect(200);
      tokens[role] = res.body.accessToken as string;
    }
    productTypeId = (await prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } }))
      .publicId;
    materialId = (
      await prisma.material.create({
        data: {
          code: `e2e-board-${run}`,
          kind: 'paper',
          nameTh: 'กระดาษทดสอบ',
          nameEn: 'Test board',
          status: 'active',
        },
      })
    ).publicId;
    own.a = await factory('a', 'factory_price_list');
    own.b = await factory('b', 'platform_rate_card');
  });

  afterAll(async () => {
    app?.get(PriceComponentRegistry).unregister('material_prices');
    await app?.close();
  });

  function as(token: string) {
    const auth = <T extends request.Test>(r: T) => r.auth(token, { type: 'bearer' });
    return {
      get: (url: string) => auth(request(server).get(url)),
      post: (url: string, body: object = {}) =>
        auth(request(server).post(url)).set('Idempotency-Key', randomUUID()).send(body),
      put: (url: string, body: object) => auth(request(server).put(url)).send(body),
    };
  }
  const pm = () => as(tokens['partner-manager']!);
  const sa = () => as(tokens['superadmin']!);

  async function factory(tag: string, mode: 'factory_price_list' | 'platform_rate_card') {
    const created = await pm()
      .post('/v1/admin/factories', {
        legalName: `บริษัท โรงงานราคา ${tag} ${run} จำกัด`,
        juristicType: 'company',
        taxId: taxId(run + (tag === 'a' ? 1 : 2)),
        isVatRegistered: true,
        onboardingMode: 'assisted',
      })
      .expect(201);
    const id = created.body.id as string;
    const email = `price-${tag}-${run}@factory.example`;
    await pm()
      .post(`/v1/admin/factories/${id}/owner-account`, {
        email,
        displayName: 'เจ้าของ',
        initialPassword: E2E_DEV_PASSWORD,
      })
      .expect(201);
    await pm().post(`/v1/admin/factories/${id}/capabilities`, { productTypeId }).expect(201);
    await pm()
      .post(`/v1/admin/factories/${id}/participations`, { productTypeId, tier: 'A', reason: 'Full list' })
      .expect(201);
    await pm()
      .post(`/v1/admin/factories/${id}/pricing-arrangement-versions`, {
        ownershipMode: mode,
        reason: 'Onboarding',
      })
      .expect(201);
    const token = (
      await request(server)
        .post('/v1/auth/partner/login')
        .send({ email, password: E2E_DEV_PASSWORD })
        .expect(200)
    ).body.accessToken as string;
    return { id, token };
  }

  /** Runs the worker's approval-outcome subscriber for `approvalId`. */
  async function approve(approvalId: string) {
    await pm().post(`/v1/admin/approvals/${approvalId}/actions/approve`, { comment: 'OK' }).expect(200);
    const event = await prisma.domainEvent.findFirstOrThrow({
      where: { type: 'approval.approved', aggregateId: approvalId },
    });
    await prisma.withTx((tx) => app.get(PriceProposalsService).onApprovalOutcome(envelopeFromRow(event), tx));
  }

  const line = (qtyFrom: number, rate: string, action = 'add') => ({
    component: 'material_prices',
    action,
    values: { materialId, qtyFrom, qtyTo: qtyFrom * 10 - 1, rate },
  });
  const partner = (f: { id: string }) => `/v1/partner/factories/${f.id}`;
  const readAudits = () =>
    prisma.auditLog.count({ where: { action: 'price.read_other_factory', category: 'data_access' } });

  let firstVersionId: string;
  const byQty = (lines: Proposal['lines']) =>
    [...lines].sort((x, y) => (x.proposedValues?.qtyFrom ?? 0) - (y.proposedValues?.qtyFrom ?? 0));

  it('runs a factory proposal through review, counter and approval into version 1 (D-040, D-042 b)', async () => {
    const owner = as(own.a.token);
    const draft = await owner
      .post(`${partner(own.a)}/price-proposals`, { productTypeId, comment: 'First list' })
      .expect(201);
    const proposalId = draft.body.id as string;
    expect(draft.body).toMatchObject({
      status: 'draft',
      direction: 'factory_to_packio',
      origin: 'factory_proposal',
    });
    await owner.post(`${partner(own.a)}/price-proposals`, { productTypeId }).expect(409);

    const bad = await owner
      .put(`${partner(own.a)}/price-proposals/${proposalId}/lines`, {
        lines: [
          {
            component: 'material_prices',
            action: 'add',
            values: { materialId, qtyFrom: 5, qtyTo: 1, rate: '-1', x: 1 },
          },
        ],
      })
      .expect(422);
    expect((bad.body.errors as { path: string }[]).map((e) => e.path).sort()).toEqual(
      ['lines[0].values.rate', 'lines[0].values.x'].sort(),
    );
    const lines = await owner
      .put(`${partner(own.a)}/price-proposals/${proposalId}/lines`, {
        lines: [line(100, '12.5'), line(1000, '10.25')],
      })
      .expect(200);
    const [small, large] = byQty((lines.body as Proposal).lines);
    expect(small!.lineKey).toMatch(/^[0-9a-f]{64}$/);

    const submitted = await owner
      .post(`${partner(own.a)}/price-proposals/${proposalId}/actions/submit`)
      .expect(200);
    expect(submitted.body.status).toBe('submitted');

    const before = await readAudits();
    const detail = await pm().get(`/v1/admin/price-proposals/${proposalId}`).expect(200);
    expect(await readAudits()).toBe(before + 1);
    const byKey = new Map((detail.body as Proposal).lines.map((l) => [l.lineKey, l.id]));

    const decided = await pm()
      .post(`/v1/admin/price-proposals/${proposalId}/actions/decide`, {
        lines: [
          { lineId: byKey.get(small!.lineKey), decision: 'accept' },
          { lineId: byKey.get(large!.lineKey), decision: 'counter', counterValues: { rate: '9.5' } },
        ],
      })
      .expect(200);
    expect(decided.body.status).toBe('countered');
    const answered = await owner
      .post(`${partner(own.a)}/price-proposals/${proposalId}/actions/answer-counters`, {
        lines: [{ lineId: byKey.get(large!.lineKey), response: 'accept' }],
      })
      .expect(200);
    expect(answered.body.status).toBe('under_review');

    await approve(submitted.body.approvalRequestId as string);
    const approved = (await owner.get(`${partner(own.a)}/price-proposals/${proposalId}`).expect(200))
      .body as Proposal;
    expect(approved.status).toBe('approved');
    expect(approved.resultingVersion).toMatchObject({ versionNo: 1, status: 'approved' });
    firstVersionId = approved.resultingVersion!.id;

    const listed = await owner.get(`${partner(own.a)}/price-lists`).expect(200);
    expect(listed.body[0].current).toMatchObject({ versionNo: 1, lineCount: 2, origin: 'factory_proposal' });
    expect(listed.body[0].current.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    const rows = await owner
      .get(`${partner(own.a)}/price-list-versions/${firstVersionId}/lines?component=material_prices`)
      .expect(200);
    expect(
      (rows.body.data as { values: { qtyFrom: number; rate: string } }[])
        .map((r) => [r.values.qtyFrom, r.values.rate])
        .sort(),
    ).toEqual([
      [100, '12.500000'],
      [1000, '9.500000'],
    ]);
    expect(JSON.stringify(rows.body)).not.toMatch(/suggest|benchmark/i);
  });

  it('freezes the rows of an approved version (copy-on-write, A-7)', async () => {
    const version = await prisma.priceListVersion.findUniqueOrThrow({ where: { publicId: firstVersionId } });
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE pl_test_prices SET rate = 1 WHERE price_list_version_id = $1`,
        version.id,
      ),
    ).rejects.toThrow(/cannot be changed/);
  });

  it('builds version 2 from version 1 plus the accepted lines, leaving version 1 intact', async () => {
    const owner = as(own.a.token);
    const draft = await owner.post(`${partner(own.a)}/price-proposals`, { productTypeId }).expect(201);
    const current = await owner
      .get(`${partner(own.a)}/price-list-versions/${firstVersionId}/lines?component=material_prices`)
      .expect(200);
    const [small, large] = (current.body.data as { lineKey: string; values: { qtyFrom: number } }[]).sort(
      (x, y) => x.values.qtyFrom - y.values.qtyFrom,
    );
    const edited = await owner
      .put(`${partner(own.a)}/price-proposals/${draft.body.id}/lines`, {
        lines: [
          line(100, '13', 'change'),
          { component: 'material_prices', action: 'remove', lineKey: large!.lineKey },
        ],
      })
      .expect(200);
    const change = (edited.body as Proposal).lines.find((l) => l.lineKey === small!.lineKey);
    expect(change?.currentValues?.rate).toBe('12.500000');
    const submitted = await owner
      .post(`${partner(own.a)}/price-proposals/${draft.body.id}/actions/submit`)
      .expect(200);
    const detail = (await pm().get(`/v1/admin/price-proposals/${draft.body.id}`).expect(200))
      .body as Proposal;
    await pm()
      .post(`/v1/admin/price-proposals/${draft.body.id}/actions/decide`, {
        lines: detail.lines.map((l) => ({ lineId: l.id, decision: 'accept' })),
      })
      .expect(200);
    await approve(submitted.body.approvalRequestId as string);

    const lists = await owner.get(`${partner(own.a)}/price-lists`).expect(200);
    expect(lists.body[0].current).toMatchObject({ versionNo: 2, basedOnVersionNo: 1, lineCount: 1 });
    const v2 = await owner
      .get(
        `${partner(own.a)}/price-list-versions/${lists.body[0].current.id}/lines?component=material_prices`,
      )
      .expect(200);
    expect(v2.body.data).toEqual([
      expect.objectContaining({
        lineKey: small!.lineKey,
        values: expect.objectContaining({ rate: '13.000000' }),
      }),
    ]);
    const v1 = await owner
      .get(`${partner(own.a)}/price-list-versions/${firstVersionId}/lines?component=material_prices`)
      .expect(200);
    expect(v1.body.meta.total).toBe(2);

    const factory = await prisma.factory.findUniqueOrThrow({ where: { publicId: own.a.id } });
    const type = await prisma.productType.findUniqueOrThrow({ where: { publicId: productTypeId } });
    const resolved = await app.get(PriceListsService).versionAt(factory.id, type.id);
    expect(resolved?.versionNo).toBe(2);
  });

  it('keeps each factory’s prices to itself and audits every staff read (D-044)', async () => {
    const intruder = as(own.b.token);
    await intruder.get(`${partner(own.a)}/price-lists`).expect(404);
    await intruder
      .get(`${partner(own.b)}/price-list-versions/${firstVersionId}/lines?component=material_prices`)
      .expect(404);
    const proposal = await prisma.priceProposal.findFirstOrThrow({
      where: { priceList: { factory: { publicId: own.a.id } } },
    });
    await intruder.get(`${partner(own.b)}/price-proposals/${proposal.publicId}`).expect(404);
    const before = await readAudits();
    await pm()
      .get(`/v1/admin/price-list-versions/${firstVersionId}/lines?component=material_prices`)
      .expect(200);
    expect(await readAudits()).toBe(before + 1);
  });

  it('sends a Packio rate card the factory negotiates per line; counters are decided by a checker (D-042 a)', async () => {
    const owner = as(own.b.token);
    const refused = await owner.post(`${partner(own.b)}/price-proposals`, { productTypeId }).expect(409);
    expect(refused.body.code).toBe('partners.wrong_pricing_mode');

    const card = await sa()
      .post(`/v1/admin/factories/${own.b.id}/price-proposals`, { productTypeId })
      .expect(201);
    expect(card.body).toMatchObject({ direction: 'packio_to_factory', origin: 'platform_rate_card' });
    await sa()
      .put(`/v1/admin/price-proposals/${card.body.id}/lines`, { lines: [line(100, '11'), line(1000, '9')] })
      .expect(200);
    const submitted = await sa().post(`/v1/admin/price-proposals/${card.body.id}/actions/submit`).expect(200);
    // The factory does not see a card Packio has not sent.
    await owner.get(`${partner(own.b)}/price-proposals/${card.body.id}`).expect(404);

    await approve(submitted.body.approvalRequestId as string);
    const sent = (await owner.get(`${partner(own.b)}/price-proposals/${card.body.id}`).expect(200))
      .body as Proposal;
    expect(sent.status).toBe('approved');
    expect(sent.resultingVersion?.status).toBe('pending_acceptance');
    const [first, second] = byQty(sent.lines);
    const answered = await owner
      .post(`${partner(own.b)}/price-proposals/${card.body.id}/actions/respond`, {
        lines: [
          { lineId: first!.id, response: 'accept' },
          {
            lineId: second!.id,
            response: 'counter',
            counterValues: { rate: '9.8' },
            comment: 'Paper cost rose',
          },
        ],
      })
      .expect(200);
    expect(answered.body.status).toBe('countered');

    const self = await sa()
      .post(`/v1/admin/price-proposals/${card.body.id}/actions/decide`, {
        lines: [{ lineId: second!.id, decision: 'accept' }],
      })
      .expect(403);
    expect(self.body.code).toBe('partners.maker_checker');
    const settled = await pm()
      .post(`/v1/admin/price-proposals/${card.body.id}/actions/decide`, {
        lines: [{ lineId: second!.id, decision: 'accept' }],
      })
      .expect(200);
    expect(settled.body.status).toBe('accepted_by_factory');
    expect(settled.body.resultingVersion.status).toBe('approved');

    const lists = await owner.get(`${partner(own.b)}/price-lists`).expect(200);
    expect(lists.body[0].current).toMatchObject({ origin: 'platform_rate_card', lineCount: 2 });
    expect(lists.body[0].current.factoryAcceptedAt).not.toBeNull();
    const rows = await owner
      .get(
        `${partner(own.b)}/price-list-versions/${lists.body[0].current.id}/lines?component=material_prices`,
      )
      .expect(200);
    expect((rows.body.data as { values: { rate: string } }[]).map((r) => r.values.rate).sort()).toEqual([
      '11.000000',
      '9.800000',
    ]);
  });

  it('applies prices Packio entered for a factory only after the factory signs them off (D-100 note)', async () => {
    const assisted = await sa()
      .post(`/v1/admin/factories/${own.a.id}/price-proposals`, { productTypeId })
      .expect(201);
    expect(assisted.body.origin).toBe('assisted_entry');
    await sa()
      .put(`/v1/admin/price-proposals/${assisted.body.id}/lines`, { lines: [line(5000, '8')] })
      .expect(200);
    // The factory cannot edit what Packio drafted for it.
    await as(own.a.token)
      .put(`${partner(own.a)}/price-proposals/${assisted.body.id}/lines`, { lines: [] })
      .expect(403);
    const submitted = await sa()
      .post(`/v1/admin/price-proposals/${assisted.body.id}/actions/submit`)
      .expect(200);
    const detail = (await pm().get(`/v1/admin/price-proposals/${assisted.body.id}`).expect(200))
      .body as Proposal;
    await pm()
      .post(`/v1/admin/price-proposals/${assisted.body.id}/actions/decide`, {
        lines: detail.lines.map((l) => ({ lineId: l.id, decision: 'accept' })),
      })
      .expect(200);
    await approve(submitted.body.approvalRequestId as string);

    const pending = (
      await as(own.a.token)
        .get(`${partner(own.a)}/price-proposals/${assisted.body.id}`)
        .expect(200)
    ).body as Proposal;
    expect(pending.resultingVersion).toMatchObject({ versionNo: 3, status: 'pending_acceptance' });
    let lists = await as(own.a.token)
      .get(`${partner(own.a)}/price-lists`)
      .expect(200);
    expect(lists.body[0].current.versionNo).toBe(2);

    const signed = await as(own.a.token)
      .post(`${partner(own.a)}/price-list-versions/${pending.resultingVersion!.id}/actions/sign-off`)
      .expect(200);
    expect(signed.body).toMatchObject({ status: 'approved', origin: 'assisted_entry', lineCount: 2 });
    await as(own.a.token)
      .post(`${partner(own.a)}/price-list-versions/${pending.resultingVersion!.id}/actions/sign-off`)
      .expect(409);
    lists = await as(own.a.token)
      .get(`${partner(own.a)}/price-lists`)
      .expect(200);
    expect(lists.body[0].current.versionNo).toBe(3);
  });

  it('withdraws a submitted proposal together with its approval', async () => {
    const owner = as(own.a.token);
    const draft = await owner.post(`${partner(own.a)}/price-proposals`, { productTypeId }).expect(201);
    await owner
      .put(`${partner(own.a)}/price-proposals/${draft.body.id}/lines`, { lines: [line(20000, '7')] })
      .expect(200);
    const submitted = await owner
      .post(`${partner(own.a)}/price-proposals/${draft.body.id}/actions/submit`)
      .expect(200);
    const withdrawn = await owner
      .post(`${partner(own.a)}/price-proposals/${draft.body.id}/actions/withdraw`, {
        reason: 'Prices not final',
      })
      .expect(200);
    expect(withdrawn.body.status).toBe('withdrawn');
    const approval = await prisma.approvalRequest.findUniqueOrThrow({
      where: { publicId: submitted.body.approvalRequestId as string },
    });
    expect(approval.status).toBe('withdrawn');
    // A new proposal can open again.
    await owner.post(`${partner(own.a)}/price-proposals`, { productTypeId }).expect(201);
  });
});
