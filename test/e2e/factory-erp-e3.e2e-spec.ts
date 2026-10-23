/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- loose response bodies (see Rec) */
import { createHash, randomUUID } from 'node:crypto';

import { ErpAlertsService } from '@modules/factory-erp/erp-alerts.service';
import { ErpDocsService } from '@modules/factory-erp/erp-docs.service';
import { ErpMaintenanceService } from '@modules/factory-erp/erp-maintenance.service';

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
import {
  approveArtwork,
  bootFulfilmentApp,
  factoryToken,
  type FulfilmentApp,
  payDue,
} from '../support/fulfilment-e2e';

/**
 * getpack Factory ERP E2.1 + E3 (docs/prompts/E1-factory-erp.md §10, D-346 – D-358): quantity breaks, the
 * approved supplier list, receiving inspection and landed cost, price-rise alerts, requests for quotation;
 * machines, auto-planning and moving on the schedule, the kiosk (pause / resume), breakdowns that stop a
 * machine, preventive plans and spare parts, documents with versions and expiry, getpack job steps on the floor,
 * and the new roles.
 */
describe('getpack Factory ERP E2.1 + E3 (e2e)', () => {
  let ctx: FulfilmentApp;
  let fixture: DevFolding;
  let owner: string;
  let base: string;

  beforeAll(async () => {
    ctx = await bootFulfilmentApp();
    fixture = await foldingReady(ctx);
    owner = await factoryToken(ctx, fixture.factoryPublicId, 'factory_owner', 501);
    base = `/v1/partner/factories/${fixture.factoryPublicId}/erp`;
  });

  afterAll(async () => {
    await foldingBackToRfq(ctx);
    await ctx?.app.close();
  });

  // Response bodies read loosely: the contract test and the DTOs pin their shapes.
  type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const post = (token: string, path: string, body: object = {}, status = 200) =>
    as(ctx, token).post(`${base}${path}`, body).set('Idempotency-Key', randomUUID()).expect(status);
  const get = async <T = Rec>(path: string, token = owner): Promise<T> =>
    (await as(ctx, token).get(`${base}${path}`).expect(200)).body as T;

  const etag = (id: string, version: number) =>
    `"${createHash('sha256').update(`${id}|${version}`).digest('base64url').slice(0, 27)}"`;

  async function supplier(name: string) {
    return (await as(ctx, owner).post(`${base}/partners`, { kind: 'supplier', name }).expect(201))
      .body as Rec;
  }

  async function item(sku: string, extra: object = {}) {
    return (
      await as(ctx, owner)
        .post(`${base}/items`, {
          sku: `${sku}-${ctx.run}`,
          name: `${sku} (ทดสอบ E3)`,
          kind: 'raw_material',
          baseUnit: 'sheet',
          purchaseUnit: 'ream',
          purchaseFactor: '500',
          ...extra,
        })
        .expect(201)
    ).body as Rec;
  }

  it('sources: breaks, approval, inspection, landed cost, alerts and quotations (D-346 – D-351)', async () => {
    const a = await supplier('ผู้ขาย ก (E3)');
    const b = await supplier('ผู้ขาย ข (E3)');
    const paper = await item('E3P', { defaultSupplierId: a.id });

    // D-351: a link made now is pending; the policy is "warn" by default.
    let [link] = await get<Rec[]>(`/items/${paper.id}/suppliers`);
    expect(link).toMatchObject({ approval: 'pending', priceBreaks: [], score: { grade: null } });

    // D-346: quantity breaks; the reorder / PR price follows the quantity.
    link = (
      await as(ctx, owner)
        .put(`${base}/items/${paper.id}/suppliers/${link!.id}/price-breaks`)
        .set('If-Match', etag(link!.id, link!.version))
        .send({
          breaks: [
            { minQty: '1', unitPrice: '1500' },
            { minQty: '20', unitPrice: '1400' },
          ],
        })
        .expect(200)
    ).body;
    expect(link!.priceBreaks.map((x: Rec) => [x.minQty, x.baseUnitPrice])).toEqual([
      ['1.000', '3.000000'],
      ['20.000', '2.800000'],
    ]);
    const pr = (
      await as(ctx, owner)
        .post(`${base}/purchase-requests`, { lines: [{ itemId: paper.id, quantity: '10000' }] })
        .expect(201)
    ).body;
    expect(pr.lines[0]).toMatchObject({ estimatedUnitCost: '2.800000' });

    // A draft PO warns about the pending supplier; with "enforce" issuing it is refused until approved.
    const po = (
      await as(ctx, owner)
        .post(`${base}/purchase-orders`, {
          supplierId: a.id,
          expectedOn: '2099-12-31',
          vatMode: 'none',
          lines: [{ itemId: paper.id, quantity: '20', unit: 'ream', unitPrice: '1400' }],
        })
        .expect(201)
    ).body;
    expect(po.warnings).toEqual([{ lineNo: 1, code: 'supplier_not_approved', changePct: null }]);
    const settings = await as(ctx, owner).get(`${base}/settings`).expect(200);
    await as(ctx, owner)
      .patch(`${base}/settings`)
      .set('If-Match', settings.headers['etag'] as string)
      .send({ supplierApproval: 'enforce', priceAlertPct: '5' })
      .expect(200);
    const refused = await post(owner, `/purchase-orders/${po.id}/actions/issue`, {}, 422);
    expect(refused.body.code).toBe('erp.supplier_not_approved');
    link = (
      await post(owner, `/items/${paper.id}/suppliers/${link!.id}/actions/approve`, {
        note: 'ผ่านการตรวจ',
        reviewOn: '2099-01-01',
      })
    ).body;
    expect(link).toMatchObject({ approval: 'approved', approvalNote: 'ผ่านการตรวจ' });
    await post(owner, `/purchase-orders/${po.id}/actions/issue`);

    // D-349, D-350: 2 reams refused at inspection; freight carried into the stock cost of what was accepted.
    const poFull = await get(`/purchase-orders/${po.id}`);
    const missingReason = await post(
      owner,
      '/goods-receipts',
      {
        purchaseOrderId: po.id,
        lines: [{ purchaseOrderLineId: poFull.lines[0].id, quantity: '18', rejectedQuantity: '2' }],
      },
      422,
    );
    expect(missingReason.body.code).toBe('validation.failed');
    const gr = (
      await post(
        owner,
        '/goods-receipts',
        {
          purchaseOrderId: po.id,
          lines: [
            {
              purchaseOrderLineId: poFull.lines[0].id,
              quantity: '18',
              rejectedQuantity: '2',
              rejectReason: 'ชื้น',
            },
          ],
          charges: [{ kind: 'freight', amount: '900', reference: 'TR-1' }],
        },
        201,
      )
    ).body;
    expect(gr).toMatchObject({
      total: '25200.00',
      chargesTotal: '900.00',
      lines: [
        {
          quantity: '18.000',
          rejectedQuantity: '2.000',
          rejectReason: 'ชื้น',
          landedAmount: '900.00',
          unitCost: '2.800000',
          landedUnitCost: '2.900000',
        },
      ],
      charges: [{ kind: 'freight', atReceipt: true, absorbed: '900.00', notAbsorbed: '0.00' }],
    });
    // Only the accepted 18 reams were received: the order stays open for 2.
    expect((await get(`/purchase-orders/${po.id}`)).status).toBe('partially_received');
    const [balance] = (await get<{ data: Rec[] }>(`/stock?q=${encodeURIComponent(paper.sku)}`)).data;
    expect(balance).toMatchObject({ onHand: '9000.000', avgCost: '2.900000' });

    // A later charge: half of the stock issued first → half is absorbed into what is left.
    await post(owner, '/stock/actions/issue', {
      kind: 'issue',
      reason: 'ใช้ผลิต',
      lines: [{ itemId: paper.id, quantity: '4500' }],
    });
    const later = (
      await post(owner, `/goods-receipts/${gr.id}/charges`, { kind: 'duty', amount: '1000' }, 201)
    ).body;
    expect(later.charges[1]).toMatchObject({
      kind: 'duty',
      atReceipt: false,
      absorbed: '500.00',
      notAbsorbed: '500.00',
    });
    const moves = await get<{ data: Rec[] }>(`/stock/movements?itemId=${paper.id}`);
    expect(moves.data[0]).toMatchObject({ kind: 'landed_cost', quantity: '0.000', value: '500.00' });

    // D-349: the scorecard counts the rejection; D-347: a pricier receipt raises an alert.
    const card = await get(`/partners/${a.id}/scorecard`);
    expect(card).toMatchObject({ receipts: 1, rejectedLines: 1, qualityPct: '90.00', approvedItems: 1 });
    expect(card.rejections[0]).toMatchObject({ reason: 'ชื้น', rejectedQuantity: '2.000' });
    await post(
      owner,
      '/goods-receipts',
      {
        supplierId: a.id,
        lines: [{ itemId: paper.id, quantity: '1', unit: 'ream', unitPrice: '1500' }],
      },
      201,
    );
    const alerts = await get<{ data: Rec[] }>('/alerts?status=open&kind=price_rise');
    expect(alerts.data[0]).toMatchObject({
      kind: 'price_rise',
      subjectId: paper.id,
      payload: expect.objectContaining({ changePct: '7.14', supplier: a.name }),
    });
    expect((await get('/alerts/count')).byKind.price_rise).toBeGreaterThanOrEqual(1);
    await post(owner, `/alerts/${alerts.data[0]!.id}/actions/acknowledge`);

    // D-348: ask both suppliers, record their answers, compare and award line by line.
    const rfq = (
      await as(ctx, owner)
        .post(`${base}/rfqs`, {
          title: 'กระดาษ Q4',
          lines: [{ itemId: paper.id, quantity: '25000' }],
          supplierIds: [a.id, b.id],
        })
        .expect(201)
    ).body;
    expect(rfq.rfqNo).toMatch(/^RFQ-\d{4}-\d{4}$/);
    await post(owner, `/rfqs/${rfq.id}/actions/send`);
    const sa = rfq.suppliers.find((s: Rec) => s.supplier.id === a.id);
    const sb = rfq.suppliers.find((s: Rec) => s.supplier.id === b.id);
    await as(ctx, owner)
      .put(`${base}/rfqs/${rfq.id}/suppliers/${sa.id}/quote`)
      .send({ quotes: [{ rfqLineId: rfq.lines[0].id, unitPrice: '1390', leadTimeDays: 7 }] })
      .expect(200);
    await as(ctx, owner)
      .put(`${base}/rfqs/${rfq.id}/suppliers/${sb.id}/quote`)
      .send({
        reference: 'QB-9',
        quotes: [
          {
            rfqLineId: rfq.lines[0].id,
            unit: 'pack',
            factor: '250',
            unitPrice: '680',
            minOrderQty: '120',
            leadTimeDays: 3,
          },
        ],
      })
      .expect(200);
    const cmp = await get(`/rfqs/${rfq.id}/comparison`);
    expect(
      cmp.lines[0].offers.map((o: Rec) => [
        o.supplier.id,
        o.baseUnitPrice,
        o.orderQty,
        o.cheapest,
        o.fastest,
        o.approval,
      ]),
    ).toEqual([
      [b.id, '2.720000', '120.000', true, true, 'pending'],
      [a.id, '2.780000', '50.000', false, false, 'approved'],
    ]);
    // The quote went into the price history of the new supplier link.
    expect(
      (await get<Rec[]>(`/items/${paper.id}/suppliers`)).find((l) => l.supplier.id === b.id),
    ).toMatchObject({
      purchaseUnit: 'pack',
      lastPrice: '680.000000',
    });
    const awarded = (
      await post(
        owner,
        `/rfqs/${rfq.id}/actions/award`,
        {
          awards: [{ rfqLineId: rfq.lines[0].id, quoteId: cmp.lines[0].offers[1].quoteId }],
        },
        201,
      )
    ).body;
    expect(awarded.created).toHaveLength(1);
    const after = await get(`/rfqs/${rfq.id}`);
    expect(after.status).toBe('awarded');
    expect(after.suppliers.find((s: Rec) => s.id === sa.id).quotes[0]).toMatchObject({
      awarded: true,
      purchaseOrder: { id: awarded.created[0].id },
    });
    const draft = await get(`/purchase-orders/${awarded.created[0].id}`);
    expect(draft.lines[0]).toMatchObject({ quantity: '50.000', unit: 'ream', unitPrice: '1390.000000' });

    // Daily sourcing check: the approval review date is far away → nothing; append-only charges.
    await ctx.app.get(ErpAlertsService).sourcingCheck();
    await expect(
      ctx.erpPrisma.erpLandedCharge.updateMany({ where: { id: { gt: 0n } }, data: { reference: 'x' } }),
    ).rejects.toThrow();
  });

  it('plans machines, runs the kiosk, stops on breakdowns and maintains (D-352 – D-355)', async () => {
    const press = (
      await as(ctx, owner)
        .post(`${base}/machines`, { name: `Press E3 ${ctx.run}` })
        .expect(201)
    ).body;
    expect(press).toMatchObject({ state: 'idle', queued: 0, plans: [] });
    const box = (
      await as(ctx, owner)
        .post(`${base}/items`, {
          sku: `E3B-${ctx.run}`,
          name: 'กล่อง E3',
          kind: 'finished_good',
          baseUnit: 'pcs',
        })
        .expect(201)
    ).body;
    const recipe = (
      await as(ctx, owner)
        .post(`${base}/recipes`, {
          itemId: box.id,
          name: 'มาตรฐาน',
          batchQty: '1000',
          materials: [{ itemId: (await item('E3M')).id, quantity: '1' }],
          operations: [
            { name: 'พิมพ์', machineId: press.id, setupMinutes: 30, runRatePerHour: '1000' },
            { name: 'ไดคัท', setupMinutes: 0, runRatePerHour: '2000' },
          ],
        })
        .expect(201)
    ).body;
    const mo = (
      await as(ctx, owner)
        .post(`${base}/production-orders`, {
          source: 'stock',
          itemId: box.id,
          recipeId: recipe.id,
          quantity: '1000',
          dueOn: '2099-12-31',
        })
        .expect(201)
    ).body;
    await post(owner, `/production-orders/${mo.id}/actions/release`);

    // D-352: auto-plan gives every operation a slot; the second follows the first.
    const planned = (await post(owner, '/schedule/actions/auto-plan')).body;
    expect(planned.placed).toBeGreaterThanOrEqual(2);
    let order = await get(`/production-orders/${mo.id}`);
    const [print, cut] = order.operations;
    expect(print.scheduledStart).toBeTruthy();
    expect(new Date(cut.scheduledStart).getTime()).toBeGreaterThanOrEqual(
      new Date(print.scheduledEnd).getTime(),
    );
    const board = await get(`/schedule?days=31`);
    expect(board.machines.find((m: Rec) => m.machine.id === press.id).slots[0]).toMatchObject({
      operationId: print.id,
      order: { id: mo.id },
    });
    // Moving by hand locks it; auto-plan keeps it.
    const moved = (
      await as(ctx, owner)
        .put(`${base}/production-orders/${mo.id}/operations/${print.id}/schedule`)
        .send({ start: '2099-01-05T09:00:00+07:00' })
        .expect(200)
    ).body;
    expect(moved).toMatchObject({ locked: true, start: '2099-01-05T09:00:00+07:00' });
    await post(owner, '/schedule/actions/auto-plan');
    order = await get(`/production-orders/${mo.id}`);
    expect(order.operations[0]).toMatchObject({ locked: true, scheduledStart: '2099-01-05T09:00:00+07:00' });
    expect(new Date(order.operations[1].scheduledStart).getTime()).toBeGreaterThanOrEqual(
      new Date(order.operations[0].scheduledEnd).getTime(),
    );
    await post(owner, `/production-orders/${mo.id}/operations/${print.id}/actions/lock`, { locked: false });

    // D-353: the kiosk — start, pause with a reason, resume, finish; events and actual times kept.
    const operator = await factoryToken(ctx, fixture.factoryPublicId, 'factory_operator', 502);
    let dispatch = await get(`/machines/${press.id}/dispatch`, operator);
    expect(dispatch.current).toBeNull();
    expect(dispatch.next[0].operation.id).toBe(print.id);
    await post(operator, `/production-orders/${mo.id}/operations/${print.id}/actions/start`);
    await post(operator, `/production-orders/${mo.id}/operations/${print.id}/actions/pause`, {
      reason: 'machine_breakdown',
    });
    dispatch = await get(`/machines/${press.id}/dispatch`, operator);
    expect(dispatch.current.operation).toMatchObject({ status: 'paused', pauseReason: 'machine_breakdown' });

    // D-355: a breakdown takes the machine down; it cannot resume until the repair is done.
    const mt = (
      await post(
        operator,
        '/maintenance/orders/breakdowns',
        { machineId: press.id, title: 'ลูกกลิ้งมีเสียงดัง' },
        201,
      )
    ).body;
    expect(mt).toMatchObject({ kind: 'breakdown', status: 'open', priority: 'high' });
    expect(mt.mtNo).toMatch(/^MT-\d{4}-\d{4}$/);
    expect((await get(`/machines/${press.id}`)).state).toBe('down');
    const down = await post(
      operator,
      `/production-orders/${mo.id}/operations/${print.id}/actions/resume`,
      {},
      409,
    );
    expect(down.body.code).toBe('erp.machine_down');
    expect((await get('/alerts?kind=machine_breakdown')).data[0]).toMatchObject({ subjectId: mt.id });
    // The operator may report but not manage maintenance.
    await post(operator, `/maintenance/orders/${mt.id}/actions/start`, {}, 403);

    const tech = await factoryToken(ctx, fixture.factoryPublicId, 'factory_maintenance', 503);
    const spare = await item('E3S', {
      kind: 'spare_part',
      baseUnit: 'pcs',
      purchaseUnit: 'pcs',
      purchaseFactor: '1',
    });
    await post(owner, '/stock/actions/adjust', {
      kind: 'opening',
      reason: 'ยอดยกมา',
      lines: [{ itemId: spare.id, quantity: '5', unitCost: '350' }],
    });
    await post(tech, `/maintenance/orders/${mt.id}/actions/start`);
    const withParts = (
      await post(tech, `/maintenance/orders/${mt.id}/actions/parts`, {
        lines: [{ itemId: spare.id, quantity: '2' }],
      })
    ).body;
    expect(withParts).toMatchObject({
      partsValue: '700.00',
      parts: [{ quantity: '2.000', unitCost: '350.000000' }],
    });
    const done = (
      await post(tech, `/maintenance/orders/${mt.id}/actions/finish`, {
        resolution: 'เปลี่ยนลูกปืน',
        downtimeMinutes: 40,
      })
    ).body;
    expect(done).toMatchObject({ status: 'done', downtimeMinutes: 40, nextActions: [] });

    // D-355: a preventive plan every 1,000 impressions — due once 1,000 are printed; the daily check opens it.
    const plan = (
      await as(ctx, tech)
        .post(`${base}/maintenance/plans`, {
          machineId: press.id,
          title: 'ล้างระบบหมึก',
          everyImpressions: 1000,
          parts: [{ itemId: spare.id, quantity: '1' }],
        })
        .expect(201)
    ).body;
    expect(plan).toMatchObject({ impressionsLeft: 1000, due: false });
    await post(operator, `/production-orders/${mo.id}/operations/${print.id}/actions/resume`);
    order = (
      await post(operator, `/production-orders/${mo.id}/operations/${print.id}/actions/finish`, {
        goodQty: '990',
        scrapQty: '10',
      })
    ).body;
    expect(order.operations[0]).toMatchObject({ status: 'done', goodQty: '990.000', scrapQty: '10.000' });
    expect(order.operations[0].actualMinutes).not.toBeNull();
    const events = await get<Rec[]>(`/production-orders/${mo.id}/operations/${print.id}/events`, operator);
    expect(events.map((e) => e.kind)).toEqual(['start', 'pause', 'resume', 'finish']);
    expect(events[1]).toMatchObject({ reason: 'machine_breakdown' });

    expect(await get(`/maintenance/plans/${plan.id}`, tech)).toMatchObject({
      impressionsLeft: 0,
      due: true,
      openOrder: null,
    });
    await ctx.app.get(ErpMaintenanceService).dueCheck();
    const opened = (await get<Rec[]>('/maintenance/plans')).find((p) => p.id === plan.id)!;
    expect(opened.openOrder).toMatchObject({ status: 'open' });
    const pm = await get(`/maintenance/orders/${opened.openOrder.id}`, tech);
    expect(pm).toMatchObject({ kind: 'preventive', plannedParts: [{ quantity: '1.000' }] });
    await post(tech, `/maintenance/orders/${pm.id}/actions/schedule`, {
      start: '2099-01-06T13:00:00+07:00',
      end: '2099-01-06T15:00:00+07:00',
    });
    const windowed = await get('/schedule?from=2099-01-06&days=1');
    expect(windowed.machines.find((m: Rec) => m.machine.id === press.id).blocks).toEqual([
      expect.objectContaining({
        kind: 'preventive',
        maintenanceOrder: expect.objectContaining({ id: pm.id }),
      }),
    ]);
    expect((await get('/alerts?kind=maintenance_due')).data[0]).toMatchObject({ subjectId: plan.id });
    await expect(
      ctx.erpPrisma.erpOperationEvent.updateMany({ where: { id: { gt: 0n } }, data: { note: 'x' } }),
    ).rejects.toThrow();
  });

  it('keeps documents with versions, links and expiry reminders (D-356)', async () => {
    const factory = await ctx.prisma.factory.findUniqueOrThrow({
      where: { publicId: fixture.factoryPublicId },
    });
    const file = async (name: string) =>
      (
        await ctx.prisma.fileObject.create({
          data: {
            bucket: 'test',
            storageKey: `test/${randomUUID()}`,
            originalName: name,
            mimeType: 'application/pdf',
            sizeBytes: 1000,
            uploadStatus: 'uploaded',
            retentionClass: 'financial_record',
            ownerFactoryId: factory.id,
          },
        })
      ).publicId;
    const folder = (
      await as(ctx, owner)
        .post(`${base}/documents/folders`, { name: `ใบรับรอง ${ctx.run}` })
        .expect(201)
    ).body;
    await as(ctx, owner)
      .post(`${base}/documents/folders`, { name: `ใบรับรอง ${ctx.run}` })
      .expect(409);
    const a = await supplier('ผู้ขาย เอกสาร (E3)');
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const doc = (
      await as(ctx, owner)
        .post(`${base}/documents`, {
          title: 'FSC',
          category: 'certificate',
          folderId: folder.id,
          linkType: 'trading_partner',
          linkId: a.id,
          expiresOn: soon,
          fileId: await file('fsc.pdf'),
        })
        .expect(201)
    ).body;
    expect(doc).toMatchObject({
      currentVersion: 1,
      expiry: 'expiring',
      link: { type: 'trading_partner', id: a.id },
      folder: { id: folder.id },
    });
    expect((await get(`/documents?linkType=trading_partner&linkId=${a.id}`)).data).toHaveLength(1);
    expect((await get('/documents?expiry=expiring')).data.map((d: Rec) => d.id)).toContain(doc.id);
    await ctx.app.get(ErpDocsService).expiryCheck();
    expect((await get('/alerts?kind=document_expiring')).data[0]).toMatchObject({ subjectId: doc.id });
    // A renewal: a new version with its expiry; the alert closes.
    const renewed = (
      await post(
        owner,
        `/documents/${doc.id}/versions`,
        { fileId: await file('fsc-2.pdf'), expiresOn: '2099-12-31' },
        201,
      )
    ).body;
    expect(renewed).toMatchObject({ currentVersion: 2, expiry: 'valid' });
    expect(renewed.versions.map((v: Rec) => v.version)).toEqual([2, 1]);
    expect(
      (await get('/alerts?kind=document_expiring&status=open')).data.map((x: Rec) => x.subjectId),
    ).not.toContain(doc.id);
    await as(ctx, owner).delete(`${base}/documents/folders/${folder.id}`).expect(409);
    // Another factory's file cannot be used.
    const foreign = await ctx.prisma.fileObject.create({
      data: {
        bucket: 'test',
        storageKey: `test/${randomUUID()}`,
        originalName: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        uploadStatus: 'uploaded',
        retentionClass: 'financial_record',
      },
    });
    const refused = await as(ctx, owner)
      .post(`${base}/documents`, { title: 'X', fileId: foreign.publicId })
      .expect(422);
    expect(refused.body.code).toBe('erp.file_not_usable');
  });

  it('works a getpack job’s steps on the floor and completes its milestones (D-354)', async () => {
    const [code] = postcodes(ctx, 1) as [string];
    await seedShipping(ctx, fixture.factoryPublicId, [code]);
    await setFlag(ctx, 'payments.scb', true);
    try {
      const { token } = await customerToken(ctx, 551);
      const prepress = await staffToken(ctx, 'prepress');
      const group = await placeOrder(ctx, token, fixture, code);
      const orderId = group.orders[0]!.id;
      await payDue(ctx, token, group.id);
      await approveArtwork(ctx, token, prepress, orderId);
      await ctx.pump();
      const job = (
        await ctx.prisma.order.findUniqueOrThrow({
          where: { publicId: orderId },
          include: { productionJobs: true },
        })
      ).productionJobs[0]!;
      await as(ctx, owner)
        .post(`/v1/partner/production-jobs/${job.publicId}/actions/accept`)
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      await ctx.pump();
      const list = await get<{ data: Rec[] }>(`/production-orders?source=getpack_job&q=${job.jobNo}`);
      const mo = await get(`/production-orders/${list.data[0]!.id}`);
      const milestones = await ctx.prisma.jobMilestone.findMany({
        where: { jobId: job.id },
        orderBy: { seq: 'asc' },
      });
      expect(mo.operations).toHaveLength(milestones.length);
      // Steps already done on the job (received on acceptance) come in done.
      mo.operations.forEach((o: Rec, i: number) =>
        expect(o).toMatchObject({
          milestone: { stepKey: milestones[i]!.stepKey },
          status: milestones[i]!.status === 'completed' ? 'done' : 'pending',
        }),
      );
      await post(owner, `/production-orders/${mo.id}/actions/release`);
      const index = mo.operations.findIndex((o: Rec) => o.status === 'pending');
      const first = mo.operations[index];
      await post(owner, `/production-orders/${mo.id}/operations/${first.id}/actions/start`);
      const after = (
        await post(owner, `/production-orders/${mo.id}/operations/${first.id}/actions/finish`, {})
      ).body;
      const step = await ctx.prisma.jobMilestone.findUniqueOrThrow({ where: { id: milestones[index]!.id } });
      if (milestones[index]!.evidence === 'none') {
        expect(step.status).toBe('completed');
        expect(after.operations[index]).toMatchObject({
          milestoneSync: 'synced',
          milestone: { status: 'completed' },
        });
      } else expect(after.operations[index].milestoneSync).toBe('failed');
      // A getpack step cannot be skipped from the ERP.
      await post(
        owner,
        `/production-orders/${mo.id}/operations/${mo.operations[index + 1].id}/actions/skip`,
        {},
        409,
      );
    } finally {
      await setFlag(ctx, 'payments.scb', false);
    }
  });

  it('keeps E2.1 / E3 to the right roles (D-357)', async () => {
    const tech = await factoryToken(ctx, fixture.factoryPublicId, 'factory_maintenance', 504);
    await as(ctx, tech).get(`${base}/maintenance/orders`).expect(200);
    await as(ctx, tech).get(`${base}/machines`).expect(200);
    await as(ctx, tech).get(`${base}/rfqs`).expect(403);
    await as(ctx, tech).post(`${base}/documents`, {}).expect(403);
    const purchaser = await factoryToken(ctx, fixture.factoryPublicId, 'factory_purchaser', 505);
    await as(ctx, purchaser).get(`${base}/rfqs`).expect(200);
    await as(ctx, purchaser).get(`${base}/documents`).expect(200);
    await post(purchaser, '/schedule/actions/auto-plan', {}, 403);
    await as(ctx, purchaser)
      .post(`${base}/maintenance/orders/breakdowns`, {})
      .set('Idempotency-Key', randomUUID())
      .expect(403);
    const accountant = await factoryToken(ctx, fixture.factoryPublicId, 'factory_accountant', 506);
    await as(ctx, accountant).get(`${base}/documents`).expect(200);
    await as(ctx, accountant).get(`${base}/alerts`).expect(200);
    await as(ctx, accountant).get(`${base}/schedule`).expect(403);
  });
});
