import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import {
  as,
  customerToken,
  foldingBackToRfq,
  foldingReady,
  placeOrder,
  postcodes,
  seedShipping,
  setFlag,
  staffToken,
} from '../support/commerce-e2e';
import { E2E_DEV_PASSWORD } from '../support/e2e';
import {
  approveArtwork,
  bootFulfilmentApp,
  factoryToken,
  type FulfilmentApp,
  payDue,
  uploadBytes,
} from '../support/fulfilment-e2e';

interface Milestone {
  id: string;
  key: string;
  status: string;
  quantityOut: number | null;
  onTime: boolean | null;
  photoFileIds: string[];
}
interface Job {
  id: string;
  status: string;
  quantityGood: number | null;
  quantityScrap: number | null;
  milestones: Milestone[];
}

/**
 * Factory progress (B4.2, D-075, D-076, D-155): milestones in route order with quantities and evidence,
 * idempotent and server-wins updates, QC with photos, completion; issues, holds, route versions, the
 * owner's users and capacity overrides.
 */
describe('production milestones and the partner surface (e2e, B4.2)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let code: string;
  let owner: string;
  let operator: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 11);
    operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 12);
  });

  afterAll(async () => {
    await setFlag(ctx, 'payments.scb', false);
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  async function acceptedJob(n: number): Promise<{ job: Job; orderId: string; customer: string }> {
    const { token } = await customerToken(ctx, n);
    const prepress = await staffToken(ctx, 'prepress');
    const group = await placeOrder(ctx, token, fixture, code);
    const orderId = group.orders[0]!.id;
    await payDue(ctx, token, group.id);
    await approveArtwork(ctx, token, prepress, orderId);
    await ctx.pump();
    const jobs = await as(ctx, owner)
      .get('/v1/partner/production-jobs?queue=awaiting_acceptance&perPage=100')
      .expect(200);
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { publicId: orderId },
      include: { productionJobs: true },
    });
    const jobId = order.productionJobs[0]!.publicId;
    expect((jobs.body.data as Job[]).some((j) => j.id === jobId)).toBe(true);
    await as(ctx, operator)
      .post(`/v1/partner/production-jobs/${jobId}/actions/accept`)
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    const accepted = await as(ctx, owner)
      .post(`/v1/partner/production-jobs/${jobId}/actions/accept`)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    return { job: accepted.body as Job, orderId, customer: token };
  }

  const photo = (token: string) =>
    uploadBytes(ctx, token, Buffer.from(`photo ${randomUUID()}`), {
      purpose: 'evidence',
      fileName: 'photo.png',
      mimeType: 'image/png',
      surface: 'partner',
    });

  function update(
    token: string,
    job: Job,
    key: string,
    body: Record<string, unknown>,
    clientRef = randomUUID(),
  ) {
    const milestone = job.milestones.find((m) => m.key === key)!;
    return as(ctx, token)
      .post(`/v1/partner/production-jobs/${job.id}/milestones/${milestone.id}`, { clientRef, ...body })
      .set('Idempotency-Key', randomUUID());
  }

  it('runs the route in order with quantities, evidence, QC and idempotent updates to completion', async () => {
    const { job, orderId } = await acceptedJob(1);
    // Accepting the job completed its job_received step (ca63113); the route goes on in order from prepress_ready.
    await update(operator, job, 'materials_ready', { action: 'start' }).expect(409);

    const ref = randomUUID();
    const started = await update(operator, job, 'prepress_ready', { action: 'start' }, ref).expect(200);
    expect(started.body).toMatchObject({ applied: true, job: { status: 'in_progress' } });
    expect(
      (await update(operator, job, 'prepress_ready', { action: 'start' }, ref).expect(200)).body,
    ).toMatchObject({ applied: false, reason: 'duplicate' });
    expect(
      (await update(operator, job, 'prepress_ready', { action: 'start' }).expect(200)).body,
    ).toMatchObject({ applied: false, reason: 'already_started' });
    await update(operator, job, 'prepress_ready', { action: 'complete' }).expect(200);
    await update(operator, job, 'materials_ready', { action: 'start' }).expect(200);
    await update(operator, job, 'materials_ready', { action: 'complete' }).expect(200);

    // Printing needs a photo and its quantities; out + scrap never exceed the ordered quantity + overage.
    await update(operator, job, 'printing', { action: 'start', quantityIn: 1050 }).expect(200);
    expect(
      (await update(operator, job, 'printing', { action: 'complete', quantityOut: 1020 }).expect(409)).body
        .code,
    ).toBe('production.evidence_missing');
    const shot = await photo(operator);
    await update(operator, job, 'printing', { action: 'complete', photoFileIds: [shot] }).expect(422);
    expect(
      (
        await update(operator, job, 'printing', {
          action: 'complete',
          quantityOut: 1050,
          quantityScrap: 5,
          photoFileIds: [shot],
        }).expect(422)
      ).body.code,
    ).toBe('production.quantity_invalid');
    const printed = await update(operator, job, 'printing', {
      action: 'complete',
      quantityOut: 1020,
      quantityScrap: 30,
      photoFileIds: [shot],
      shareWithCustomer: true,
    }).expect(200);
    const printing = (printed.body.job as Job).milestones.find((m) => m.key === 'printing')!;
    expect(printing).toMatchObject({ status: 'completed', quantityOut: 1020, photoFileIds: [shot] });
    expect(
      await ctx.prisma.attachment.count({
        where: { fileObject: { publicId: shot }, customerShareable: true },
      }),
    ).toBe(1);
    const reached = await ctx.prisma.domainEvent.findMany({
      where: { type: 'production.milestone_reached', aggregateId: orderId },
      orderBy: { occurredAt: 'asc' },
    });
    // job_received closed with acceptance (ca63113), which records no milestone_reached of its own.
    expect(reached.map((e) => e.payload)).toEqual([
      expect.objectContaining({ stepKey: 'printing', labelTh: 'กำลังพิมพ์' }),
    ]);

    for (const [key, out] of [
      ['finishing', 1015],
      ['die_cut', 1010],
      ['gluing', 1005],
    ] as const) {
      await update(operator, job, key, { action: 'start' }).expect(200);
      await update(operator, job, key, { action: 'complete', quantityOut: out, quantityScrap: 5 }).expect(
        200,
      );
    }
    // QC needs its photos and a passing QC form.
    await update(operator, job, 'qc', { action: 'start' }).expect(200);
    const qcShot = await photo(operator);
    expect(
      (
        await update(operator, job, 'qc', {
          action: 'complete',
          quantityOut: 1000,
          photoFileIds: [qcShot],
        }).expect(409)
      ).body.code,
    ).toBe('production.evidence_missing');
    const qcToken = await factoryToken(ctx, fixture.factoryPublicId, 'factory_qc', 13);
    await as(ctx, operator)
      .post(`/v1/partner/production-jobs/${job.id}/qc-checks`, {
        checklistVersion: 'folding-v1',
        checklist: {},
        result: 'pass',
        photoFileIds: [qcShot],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    await as(ctx, qcToken)
      .post(`/v1/partner/production-jobs/${job.id}/qc-checks`, {
        checklistVersion: 'folding-v1',
        checklist: {},
        result: 'pass',
        photoFileIds: [],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(422);
    const qc = await as(ctx, qcToken)
      .post(`/v1/partner/production-jobs/${job.id}/qc-checks`, {
        checklistVersion: 'folding-v1',
        checklist: { colour: 'ok' },
        result: 'pass',
        quantityChecked: 80,
        photoFileIds: [qcShot],
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(qc.body).toMatchObject({ result: 'pass', isFirstPass: true, photoFileIds: [qcShot] });
    await update(operator, job, 'qc', {
      action: 'complete',
      quantityOut: 1000,
      quantityScrap: 5,
      photoFileIds: [qcShot],
    }).expect(200);
    await update(operator, job, 'packing', { action: 'start' }).expect(200);
    await update(operator, job, 'packing', {
      action: 'complete',
      quantityOut: 1000,
      photoFileIds: [await photo(operator)],
    }).expect(200);
    await update(operator, job, 'ready_to_ship', { action: 'start' }).expect(200);
    const done = await update(operator, job, 'ready_to_ship', { action: 'complete' }).expect(200);
    expect(done.body.job).toMatchObject({ status: 'completed', quantityGood: 1000 });
    expect(
      await ctx.prisma.domainEvent.count({
        where: { type: 'production_job.completed', aggregateId: job.id },
      }),
    ).toBe(1);
    expect((await update(operator, job, 'ready_to_ship', { action: 'complete' }).expect(409)).body.code).toBe(
      'production.invalid_status',
    );
  });

  it('handles issues, holds, route versions, factory users and capacity overrides', async () => {
    const { job } = await acceptedJob(2);
    const lead = await staffToken(ctx, 'cs_lead');
    const issue = await as(ctx, operator)
      .post(`/v1/partner/production-jobs/${job.id}/issues`, {
        kind: 'material_shortage',
        description: 'กระดาษขาดสต็อก รอของ 2 วัน',
      })
      .expect(201);
    const resolved = await as(ctx, lead)
      .post(`/v1/admin/job-issues/${issue.body.id as string}/actions/resolve`, {
        note: 'เลื่อนวันส่งกับลูกค้าแล้ว',
      })
      .expect(200);
    expect(resolved.body.status).toBe('resolved');
    expect(
      (await as(ctx, owner).get(`/v1/partner/production-jobs/${job.id}/issues`).expect(200)).body[0].status,
    ).toBe('resolved');

    // U-B0.3 (D-232): named kinds; the factory closes an issue its own people raised, not one it did not.
    await as(ctx, operator)
      .post(`/v1/partner/production-jobs/${job.id}/issues`, { kind: 'paper_jam', description: 'ไม่รู้จัก' })
      .expect(422);
    const own = await as(ctx, operator)
      .post(`/v1/partner/production-jobs/${job.id}/issues`, {
        kind: 'machine_down',
        description: 'เครื่องตัดเสีย',
      })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(own.body).toMatchObject({ raisedBy: { id: expect.any(String) }, photoFileIds: [] });
    const closed = await as(ctx, owner)
      .post(`/v1/partner/production-jobs/${job.id}/issues/${own.body.id as string}/actions/resolve`, {
        note: 'ซ่อมเสร็จแล้ว',
      })
      .expect(200);
    expect(closed.body).toMatchObject({ status: 'resolved', resolvedBy: { id: expect.any(String) } });
    await as(ctx, owner)
      .post(`/v1/partner/production-jobs/${job.id}/issues/${own.body.id as string}/actions/resolve`, {
        note: 'ซ้ำ',
      })
      .expect(409);

    // U-B0.3: the job carries its refs; lookup by job number; my factory's day; scorecard months.
    const detail = (await as(ctx, owner).get(`/v1/partner/production-jobs/${job.id}`).expect(200)).body as {
      jobNo: string;
      productTypeCode: string;
      title: string;
      atRisk: boolean;
      artwork: { versionNo: number } | null;
      destinations: { provinceNameTh: string; shippedQuantity: number }[];
    };
    expect(detail).toMatchObject({
      productTypeCode: expect.any(String),
      title: expect.any(String),
      atRisk: false,
    });
    expect(detail.artwork?.versionNo).toEqual(expect.any(Number));
    expect(detail.destinations[0]).toMatchObject({ provinceNameTh: expect.any(String), shippedQuantity: 0 });
    const found = await as(ctx, owner)
      .get(`/v1/partner/production-jobs/lookup?code=${encodeURIComponent(detail.jobNo.toLowerCase())}`)
      .expect(200);
    expect(found.body).toEqual({ jobId: job.id, jobNo: detail.jobNo });
    await as(ctx, owner).get('/v1/partner/production-jobs/lookup?code=NO-SUCH-JOB').expect(404);
    const inProduction = (
      await as(ctx, owner).get('/v1/partner/production-jobs?view=in_production&perPage=100').expect(200)
    ).body.data as { id: string }[];
    expect(inProduction.map((j) => j.id)).toContain(job.id);
    const today = (
      await as(ctx, owner).get(`/v1/partner/factories/${fixture.factoryPublicId}/today`).expect(200)
    ).body as { counters: Record<string, number>; queue: unknown[]; alerts: unknown[] };
    expect(Object.keys(today.counters).sort()).toEqual([
      'acceptanceOverdue',
      'atRisk',
      'awaitingAcceptance',
      'inspectionsPlanned',
      'milestonesDueToday',
      'onHold',
    ]);
    expect(today.queue.length).toBeLessThanOrEqual(20);
    await as(ctx, owner)
      .get(`/v1/partner/factories/${fixture.factoryPublicId}/scorecards?months=3`)
      .expect(200);
    await as(ctx, owner)
      .get(`/v1/partner/factories/${fixture.factoryPublicId}/scorecards?months=25`)
      .expect(422);

    await as(ctx, lead)
      .post(`/v1/admin/production-jobs/${job.id}/actions/hold`, { reason: 'ลูกค้าขอพักงาน' })
      .expect(200);
    expect((await update(operator, job, 'prepress_ready', { action: 'start' }).expect(409)).body.code).toBe(
      'production.invalid_status',
    );
    const resumed = await as(ctx, lead)
      .post(`/v1/admin/production-jobs/${job.id}/actions/resume`)
      .expect(200);
    expect(resumed.body.status).toBe('accepted');

    // Routes are versioned data (D-075).
    const partnerManager = await staffToken(ctx, 'partner_manager');
    const route = await as(ctx, partnerManager)
      .post('/v1/admin/milestone-routes', {
        productTypeCode: 'folding_carton',
        variant: `e2e${ctx.run}`,
        name: 'ทดสอบ',
      })
      .expect(201);
    const steps = [
      { key: 'job_received', nameTh: 'รับงาน', nameEn: 'Job received', customerLabelTh: 'รับงานแล้ว' },
      { key: 'ready_to_ship', nameTh: 'พร้อมส่ง', nameEn: 'Ready' },
    ];
    await as(ctx, partnerManager)
      .post(`/v1/admin/milestone-routes/${route.body.id as string}/versions`, {
        effectiveFrom: '2020-01-01T00:00:00+07:00',
        reason: 'ย้อนหลัง',
        steps,
      })
      .expect(422);
    const version = await as(ctx, partnerManager)
      .post(`/v1/admin/milestone-routes/${route.body.id as string}/versions`, {
        effectiveFrom: new Date().toISOString(),
        reason: 'ทดสอบเส้นทาง',
        steps,
      })
      .expect(201);
    expect(version.body.versions[0]).toMatchObject({
      versionNo: 1,
      status: 'approved',
      steps: [{ key: 'job_received', customerVisible: true }, { key: 'ready_to_ship' }],
    });
    await as(ctx, lead)
      .post(`/v1/admin/milestone-routes/${route.body.id as string}/versions`, {
        effectiveFrom: new Date().toISOString(),
        reason: 'x',
        steps,
      })
      .expect(403);

    // The owner manages the factory's users (never owners) and its capacity.
    const email = `planner-${ctx.run}@factory.invalid`;
    const factoryUrl = `/v1/partner/factories/${fixture.factoryPublicId}`;
    await as(ctx, owner)
      .post(`${factoryUrl}/users`, {
        email,
        displayName: 'ผู้วางแผน',
        initialPassword: E2E_DEV_PASSWORD,
        roles: ['factory_owner'],
      })
      .expect(422);
    const created = await as(ctx, owner)
      .post(`${factoryUrl}/users`, {
        email,
        displayName: 'ผู้วางแผน',
        initialPassword: E2E_DEV_PASSWORD,
        roles: ['factory_planner'],
      })
      .expect(201);
    await as(ctx, operator).get(`${factoryUrl}/users`).expect(403);
    const listed = await as(ctx, owner).get(`${factoryUrl}/users`).expect(200);
    expect(
      (listed.body as { id: string; roles: string[] }[]).find((u) => u.id === created.body.id)?.roles,
    ).toEqual(['factory_planner']);
    const planner = await request(ctx.server)
      .post('/v1/auth/partner/login')
      .send({ email, password: E2E_DEV_PASSWORD })
      .expect(200);
    await as(ctx, planner.body.accessToken as string)
      .get(`/v1/partner/production-jobs/${job.id}`)
      .expect(200);
    await as(ctx, owner)
      .post(`${factoryUrl}/users/${created.body.id as string}/actions/deactivate`)
      .expect(204);
    expect(
      ((await as(ctx, owner).get(`${factoryUrl}/users`).expect(200)).body as { id: string }[]).some(
        (u) => u.id === created.body.id,
      ),
    ).toBe(false);

    // U-B0.3: deactivated users are listed apart with the roles they held; setting roles reactivates them.
    type FactoryUser = {
      id: string;
      roles: string[];
      status: string;
      isSelf: boolean;
      lastSignInAt: string | null;
    };
    const plannerId = created.body.id as string;
    const gone = (
      (await as(ctx, owner).get(`${factoryUrl}/users?status=deactivated`).expect(200)).body as FactoryUser[]
    ).find((u) => u.id === plannerId);
    expect(gone).toMatchObject({ status: 'deactivated', roles: ['factory_planner'], isSelf: false });
    expect(gone!.lastSignInAt).toEqual(expect.any(String));
    await as(ctx, owner)
      .put(`${factoryUrl}/users/${plannerId}/roles`, { roles: ['factory_owner'] })
      .expect(422);
    await as(ctx, owner)
      .put(`${factoryUrl}/users/${randomUUID()}/roles`, { roles: ['factory_qc'] })
      .expect(404);
    const back = (
      await as(ctx, owner)
        .put(`${factoryUrl}/users/${plannerId}/roles`, { roles: ['factory_planner', 'factory_qc'] })
        .expect(200)
    ).body as FactoryUser;
    expect(back).toMatchObject({ status: 'active', roles: ['factory_planner', 'factory_qc'] });
    await as(ctx, owner)
      .put(`${factoryUrl}/users/${plannerId}/roles`, { roles: ['factory_qc'] })
      .expect(200);
    const active = (await as(ctx, owner).get(`${factoryUrl}/users`).expect(200)).body as FactoryUser[];
    expect(active.find((u) => u.id === plannerId)?.roles).toEqual(['factory_qc']);
    const self = active.find((u) => u.isSelf)!;
    expect(self.roles).toContain('factory_owner');
    const selfGrant = await as(ctx, owner).put(`${factoryUrl}/users/${self.id}/roles`, {
      roles: ['factory_qc'],
    });
    expect(selfGrant.body.code).toBe('iam.self_grant');
    await as(ctx, owner).post(`${factoryUrl}/users/${plannerId}/actions/deactivate`).expect(204);

    const folding = await ctx.prisma.productType.findUniqueOrThrow({ where: { code: 'folding_carton' } });
    const override = {
      productTypeId: folding.publicId,
      weekStart: '2027-01-04',
      capacity: 5000,
      reason: 'ปิดซ่อมเครื่องจักร',
    };
    await as(ctx, operator).put(`${factoryUrl}/capacity-overrides`, override).expect(403);
    const week = await as(ctx, owner).put(`${factoryUrl}/capacity-overrides`, override).expect(200);
    expect(week.body[0]).toMatchObject({ weekStart: '2027-01-04', source: 'override' });
  });
});
