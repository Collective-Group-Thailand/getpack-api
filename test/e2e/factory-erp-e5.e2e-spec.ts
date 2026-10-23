/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- loose response bodies (see Rec) */
import { createHash, randomUUID } from 'node:crypto';

import { type DevFolding } from '../../prisma/seed/dev-folding';
import { as, foldingBackToRfq, foldingReady, staffToken } from '../support/commerce-e2e';
import { bootFulfilmentApp, factoryToken, type FulfilmentApp } from '../support/fulfilment-e2e';

/**
 * getpack Factory ERP E5 (docs/prompts/E1-factory-erp.md §12, D-372 – D-383): an inspection template, a final
 * check that fails and opens an NCR worked to close, one that passes with its certificate of analysis, machine
 * rates and the job cost, OEE, the owner's dashboard, shifts and skills, getpack support's grant and read, and
 * who may do what (D-382).
 */
describe('getpack Factory ERP E5 (e2e)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let owner: string;
  let qc: string;
  let operator: string;
  let accountant: string;
  let planner: string;
  let base: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 701);
    qc = await factoryToken(ctx, fixture.factoryPublicId, 'factory_qc', 702);
    operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 703);
    accountant = await factoryToken(ctx, fixture.factoryPublicId, 'factory_accountant', 704);
    planner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_planner', 705);
    base = `/v1/partner/factories/${fixture.factoryPublicId}/erp`;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const post = async (token: string, path: string, body: object = {}, status = 200) =>
    (
      await as(ctx, token)
        .post(`${base}${path}`)
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(status)
    ).body as Rec;
  const put = async (token: string, path: string, body: object, id: string, version: number, status = 200) =>
    (await as(ctx, token).put(`${base}${path}`).set('If-Match', etag(id, version)).send(body).expect(status))
      .body as Rec;
  const get = async (path: string, token = owner, status = 200) =>
    (await as(ctx, token).get(`${base}${path}`).expect(status)).body as Rec;
  const etag = (id: string, version: number) =>
    `"${createHash('sha256').update(`${id}|${version}`).digest('base64url').slice(0, 27)}"`;

  it('checks quality, works an NCR to close and prints a COA (D-372 – D-375)', async () => {
    const item = (
      await as(ctx, owner)
        .post(`${base}/items`, {
          sku: `E5-BOX-${ctx.run}`,
          name: 'กล่อง E5 (ทดสอบ)',
          kind: 'finished_good',
          baseUnit: 'pcs',
        })
        .expect(201)
    ).body as Rec;
    const template = (
      await as(ctx, owner)
        .post(`${base}/inspection-templates`, {
          name: 'ตรวจขั้นสุดท้าย E5',
          kind: 'final',
          itemId: item.id,
          checkpoints: [
            { name: 'ความกว้าง', type: 'measurement', unit: 'mm', minValue: '298', maxValue: '302' },
            { name: 'สีตรงตัวอย่าง', type: 'pass_fail' },
            { name: 'หมายเหตุ', type: 'note' },
          ],
        })
        .expect(201)
    ).body as Rec;
    expect(template.checkpoints).toHaveLength(3);
    // QC records; the operator may not keep templates (D-382).
    await as(ctx, operator)
      .post(`${base}/inspection-templates`, {
        name: 'x',
        kind: 'final',
        checkpoints: [{ name: 'x', type: 'note' }],
      })
      .expect(403);

    const bad = (
      await as(ctx, qc)
        .post(`${base}/quality-checks`, {
          kind: 'final',
          templateId: template.id,
          itemId: item.id,
          lotNo: 'L1',
        })
        .expect(201)
    ).body as Rec;
    expect(bad).toMatchObject({ result: 'pending', qcNo: expect.stringMatching(/^QC-\d{4}-\d{4}$/) });
    const failed = await put(
      qc,
      `/quality-checks/${bad.id}`,
      {
        points: [
          { seq: 1, measured: '305' },
          { seq: 2, outcome: 'pass' },
        ],
        rejectedQty: '20',
      },
      bad.id,
      bad.version,
    );
    expect(failed.result).toBe('fail');
    expect(failed.checkpoints[0]).toMatchObject({ outcome: 'fail', measured: '305.0000' });
    expect(failed.ncrs).toHaveLength(1);

    // D-374: the NCR is worked — cause and action, a rework, verified and closed by quality.manage.
    let ncr = await get(`/ncrs/${failed.ncrs[0].id}`, qc);
    expect(ncr).toMatchObject({ status: 'open', source: 'quality_check', quantity: '20.000' });
    await post(qc, `/ncrs/${ncr.id}/actions/verify`, { note: 'ok' }, 422);
    ncr = await put(
      qc,
      `/ncrs/${ncr.id}`,
      { rootCause: 'ตั้งใบมีดผิด', correctiveAction: 'ตัดใหม่ 20 ใบ' },
      ncr.id,
      ncr.version,
    );
    expect(ncr.status).toBe('in_progress');
    await as(ctx, operator)
      .post(`${base}/ncrs/${ncr.id}/actions/dispose`)
      .set('Idempotency-Key', randomUUID())
      .send({ disposition: 'rework' })
      .expect(403);
    ncr = await post(qc, `/ncrs/${ncr.id}/actions/dispose`, { disposition: 'rework' });
    ncr = await post(qc, `/ncrs/${ncr.id}/actions/verify`, { note: 'ล็อตใหม่ผ่าน' });
    expect(ncr.status).toBe('verified');
    ncr = await post(owner, `/ncrs/${ncr.id}/actions/close`);
    expect(ncr).toMatchObject({ status: 'closed', nextActions: [] });

    const good = (
      await as(ctx, qc)
        .post(`${base}/quality-checks`, { kind: 'final', templateId: template.id, itemId: item.id })
        .expect(201)
    ).body as Rec;
    const passed = await put(
      qc,
      `/quality-checks/${good.id}`,
      {
        points: [
          { seq: 1, measured: '300.5' },
          { seq: 2, outcome: 'pass' },
        ],
        inspectedQty: '500',
      },
      good.id,
      good.version,
    );
    expect(passed.result).toBe('pass');
    expect(passed.nextActions.map((a: Rec) => a.key)).toContain('erp_qc.coa');
    const coa = await get(`/quality-checks/${good.id}/coa`, qc);
    expect(coa.fileName).toMatch(/^COA-QC-/);
    await get(`/quality-checks/${bad.id}/coa`, qc, 409);
    // The accountant reads quality but does not record it (D-382).
    await get('/quality-checks', accountant);
    await as(ctx, accountant).post(`${base}/quality-checks`, { kind: 'other' }).expect(403);
  });

  it('keeps rates, shows OEE, costs and the dashboard to who reads insight (D-376 – D-378)', async () => {
    const machines = await get('/machine-rates');
    if (machines.length) {
      const saved = (
        await as(ctx, owner)
          .put(`${base}/machine-rates/${machines[0].machine.id}`)
          .send({ hourlyRate: '850' })
          .expect(200)
      ).body as Rec[];
      expect(saved[0]!.hourlyRate).toBe('850.00');
    }
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const oee = await get(`/insight/oee?from=${today}&to=${today}`);
    expect(oee).toMatchObject({ from: today, to: today });
    const month = today.slice(0, 7);
    expect(await get(`/insight/costs?month=${month}`)).toMatchObject({ month });
    expect(await get(`/insight/profitability?month=${month}&by=item`)).toMatchObject({ month, by: 'item' });
    expect(await get(`/insight/profitability?month=${month}&by=getpack_job`)).toMatchObject({
      month,
      by: 'getpack_job',
      rows: expect.any(Array),
    }); // D-402
    const dash = await get('/dashboard', accountant);
    expect(dash).toMatchObject({
      month,
      quality: { openNcrs: expect.any(Number) },
      getpack: { confirmedNet: expect.any(String), toConfirm: expect.any(Number) },
    });
    await get('/dashboard', qc, 403);
    await get('/dashboard', operator, 403);
  });

  it('keeps shifts and skills, and lets support read only under a grant (D-380, D-381)', async () => {
    const shift = (
      await as(ctx, planner)
        .post(`${base}/shifts`, {
          name: `กะ E5 ${ctx.run}`,
          startTime: '20:00',
          endTime: '05:00',
          days: [1, 2, 3],
        })
        .expect(201)
    ).body as Rec;
    expect(shift.minutes).toBe(540);
    await as(ctx, operator)
      .post(`${base}/shifts`, { name: 'x', startTime: '08:00', endTime: '09:00', days: [1] })
      .expect(403);
    expect(await get('/work-log?from=2026-10-01&to=2026-10-02', planner)).toMatchObject({
      rows: expect.any(Array),
    });

    const staff = await staffToken(ctx, 'partner_manager');
    const view = `/v1/admin/factories/${fixture.factoryPublicId}/erp/support-view`;
    await as(ctx, staff).get(view).expect(403);
    await as(ctx, planner)
      .post(`${base}/support-grants`)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'ตรวจต้นทุน', days: 2 })
      .expect(403);
    const grant = await post(owner, '/support-grants', { reason: 'ตรวจต้นทุน', days: 2 }, 201);
    await post(owner, '/support-grants', { reason: 'อีกครั้ง', days: 1 }, 409);
    const seen = (await as(ctx, staff).get(view).expect(200)).body as Rec;
    expect(seen).toMatchObject({
      reason: 'ตรวจต้นทุน',
      dashboard: { month: expect.any(String) },
      settings: { version: expect.any(Number) },
    });
    const listed = await get('/support-grants');
    expect(listed[0]).toMatchObject({ id: grant.id, active: true, viewCount: 1 });
    await post(owner, `/support-grants/${grant.id}/actions/revoke`, { reason: 'เสร็จแล้ว' });
    await as(ctx, staff).get(view).expect(403);
  });
});
