#!/usr/bin/env node
/**
 * UAT seed — partner-portal ERP records for the factory owner's factory (F9001).
 *
 * Creates realistic, clearly-fake test records ONLY through the public HTTP API, exactly as the
 * partner web does: it logs into the partner zone with Playwright and calls the BFF (`/bff/v1/...`)
 * from inside the page, with the CSRF header and an Idempotency-Key. No DB access.
 *
 * Re-runnable: every created record id is kept in a state file; on a re-run a step whose record
 * still exists is skipped. Delete the state file (or set SEED_FRESH=1) to create a fresh set.
 *
 * Usage (on the UAT VM):
 *   LD_LIBRARY_PATH=$HOME/pw/libx/usr/lib/aarch64-linux-gnu GP_PW="$(cat $HOME/.gp_pw)" \
 *     NODE_PATH=$HOME/pw/node_modules node scripts/uat-seed-partner-erp.mjs
 *
 * Env: GP_PW (required), PARTNER_BASE (default http://partner.localhost:3001),
 *      PARTNER_EMAIL (default factory-owner@uat.example.invalid), PW_DIR (default $HOME/pw),
 *      SEED_STATE (default $HOME/.uat-seed-partner-erp.json), SEED_ONLY=sales,planning,... to run some steps.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
const PW_DIR = process.env.PW_DIR ?? `${HOME}/pw`;
const require = createRequire(path.join(PW_DIR, 'package.json'));
const { chromium } = require('playwright');

const BASE = process.env.PARTNER_BASE ?? 'http://partner.localhost:3001';
const EMAIL = process.env.PARTNER_EMAIL ?? 'factory-owner@uat.example.invalid';
const PW = process.env.GP_PW;
const STATE_FILE = process.env.SEED_STATE ?? `${HOME}/.uat-seed-partner-erp.json`;
const SESSION_FILE = `${PW_DIR}/state-partner-owner.json`;
const ONLY = process.env.SEED_ONLY ? new Set(process.env.SEED_ONLY.split(',')) : null;
const TAG = '(ข้อมูลทดสอบ UAT)';
if (!PW) throw new Error('GP_PW is required');

const state = !process.env.SEED_FRESH && fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const report = [];
const skipped = [];

/** Bangkok calendar day, offset by n days. */
const day = (n = 0) => new Date(Date.now() + 7 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

let page;
let FID;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One API call through the BFF, from the logged-in page. Retries while the API hot-restarts. */
async function api(method, url, body, { ifMatch = false, ok = [200, 201, 204] } = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await page.evaluate(
      async ([m, u, b, im]) => {
        const h = { 'content-type': 'application/json', 'x-getpack-csrf': '1', 'idempotency-key': crypto.randomUUID() };
        if (im) {
          const g = await fetch('/bff' + u, { credentials: 'include' });
          const tag = g.headers.get('etag');
          if (tag) h['if-match'] = tag;
        }
        const x = await fetch('/bff' + u, { method: m, credentials: 'include', headers: h, body: b ? JSON.stringify(b) : undefined });
        return { status: x.status, text: await x.text() };
      },
      [method, url, body ?? null, ifMatch],
    );
    if ([502, 503, 504].includes(res.status) && attempt < 8) {
      await sleep(4000);
      continue;
    }
    let json = null;
    try { json = res.text ? JSON.parse(res.text) : null; } catch { json = res.text; }
    if (!ok.includes(res.status)) {
      const e = new Error(`${method} ${url} -> ${res.status} ${res.text.slice(0, 800)}`);
      e.status = res.status; e.body = json;
      throw e;
    }
    return json;
  }
}
const erp = (p) => `/v1/partner/factories/${FID}/erp${p}`;
const exists = async (p) => { try { await api('GET', p); return true; } catch (e) { if (e.status === 404) return false; throw e; } };

/** Runs a named step once; a record already in state that still exists is reused. */
async function once(key, getPath, create) {
  if (state[key] && (await exists(getPath(state[key].id)))) return state[key];
  const rec = await create();
  state[key] = rec; save();
  return rec;
}
const note = (r, label, urlPath) => report.push({ label, no: r.no, id: r.id, url: urlPath });

async function login() {
  const browser = await chromium.launch({
    args: ['--host-resolver-rules=MAP *.localhost 192.168.64.1, MAP localhost 192.168.64.1', '--proxy-server=direct://', '--proxy-bypass-list=*'],
  });
  const ctx = await browser.newContext({ storageState: fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined });
  await ctx.addCookies([{ name: 'pk_consent', value: 'a1m1', domain: new URL(BASE).hostname, path: '/' }]);
  page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(1500);
  if (page.url().includes('/login')) {
    await page.fill('input[type=email],input[name=email]', EMAIL);
    await page.fill('input[type=password]', PW);
    await page.keyboard.press('Enter');
    await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 60_000 });
    await ctx.storageState({ path: SESSION_FILE });
  }
  const me = await api('GET', '/v1/partner/me');
  FID = me.factories[0].factoryId;
  console.log(`logged in as ${me.email}; factory ${me.factories[0].code} ${FID}`);
  return browser;
}

// ---------------------------------------------------------------------------------------------
// Master data lookups
// ---------------------------------------------------------------------------------------------
let M = {};
async function master() {
  const partners = (await api('GET', erp('/partners'))).data;
  const items = (await api('GET', erp('/items'))).data;
  const wh = await api('GET', erp('/warehouses'));
  M.customer1 = partners.find((p) => p.code === 'C0001');
  M.customer2 = partners.find((p) => p.code === 'C0002');
  M.supplier = partners.find((p) => p.code === 'S0001');
  M.fg = items.find((i) => i.sku === 'FG-CRM-30');
  M.paper = items.find((i) => i.sku === 'KA-350');
  M.glue = items.find((i) => i.sku === 'GLUE-PVA');
  M.wh = wh.find((w) => w.isDefault) ?? wh[0];
  // Two more finished goods so documents carry varied lines.
  const fgs = [
    { sku: 'FG-RSC-A4', name: `กล่องลูกฟูก RSC ขนาด A4 3 ชั้น ${TAG}` },
    { sku: 'FG-LBL-5050', name: `ฉลากสติกเกอร์ PP 50×50 มม. ${TAG}` },
  ];
  for (const f of fgs) {
    let it = items.find((i) => i.sku === f.sku);
    if (!it) it = await api('POST', erp('/items'), { sku: f.sku, name: f.name, kind: 'finished_good', baseUnit: 'pcs' });
    M[f.sku] = it;
  }
  if (!M.customer1 || !M.customer2 || !M.fg) throw new Error('expected UAT master data (C0001, C0002, FG-CRM-30) is missing');
}

// ---------------------------------------------------------------------------------------------
// 1. Sales — quotations, sales orders, delivery note
// ---------------------------------------------------------------------------------------------
const line = (item, qty, price, extra = {}) => ({ itemId: item.id, quantity: String(qty), unit: 'pcs', unitPrice: String(price), ...extra });

async function sales() {
  const quote = (customer, lines, noteText) => ({
    customerId: customer.id,
    quoteDate: day(0),
    validUntil: day(30),
    paymentTermDays: 30,
    leadTimeDays: 14,
    vatMode: 'exclusive',
    note: `${noteText} ${TAG}`,
    terms: 'ราคานี้รวมค่าแม่พิมพ์แล้ว ยืนราคา 30 วัน (ข้อมูลทดสอบ)',
    lines,
  });
  const qDraft = await once('quotationDraft', (id) => erp(`/quotations/${id}`), async () => {
    const q = await api('POST', erp('/quotations'), quote(M.customer2, [
      line(M['FG-LBL-5050'], 20000, '0.85', { description: 'ฉลากสติกเกอร์ PP ขาวเงา พิมพ์ 4 สี ไดคัทวงกลม' }),
      line(M['FG-RSC-A4'], 1000, '12.50'),
    ], 'ใบเสนอราคาฉบับร่าง — รอยืนยันสเปก'));
    return { id: q.id, no: q.quoteNo };
  });
  note(qDraft, 'Quotation (draft)', `/quotations/${qDraft.id}`);

  const qSent = await once('quotationSent', (id) => erp(`/quotations/${id}`), async () => {
    const q = await api('POST', erp('/quotations'), quote(M.customer1, [
      line(M.fg, 5000, '3.20', { description: 'กล่องครีม 30 ml กระดาษคราฟท์ 350 แกรม พิมพ์ 4 สี เคลือบด้าน' }),
      line(M['FG-RSC-A4'], 500, '13.00'),
      { description: 'ค่าบล็อกไดคัท (ครั้งเดียว)', quantity: '1', unit: 'job', unitPrice: '2500' },
    ], 'ใบเสนอราคาส่งลูกค้าแล้ว — รอตอบรับ'));
    await api('POST', erp(`/quotations/${q.id}/actions/send`));
    return { id: q.id, no: q.quoteNo };
  });
  note(qSent, 'Quotation (sent)', `/quotations/${qSent.id}`);

  const qAcc = await once('quotationAccepted', (id) => erp(`/quotations/${id}`), async () => {
    const q = await api('POST', erp('/quotations'), quote(M.customer1, [
      line(M.fg, 4000, '3.10'),
      line(M['FG-LBL-5050'], 10000, '0.90', { discountPct: '5' }),
    ], 'ใบเสนอราคาที่ลูกค้าตอบรับแล้ว'));
    await api('POST', erp(`/quotations/${q.id}/actions/send`));
    await api('POST', erp(`/quotations/${q.id}/actions/accept`), { name: 'คุณทดสอบ ยืนยัน (ข้อมูลปลอม)', position: 'ฝ่ายจัดซื้อ', customerPoNo: 'PO-TEST-0001' });
    return { id: q.id, no: q.quoteNo };
  });
  note(qAcc, 'Quotation (accepted → ordered)', `/quotations/${qAcc.id}`);

  const soFromQ = await once('salesOrderFromQuote', (id) => erp(`/sales-orders/${id}`), async () => {
    const r = await api('POST', erp(`/quotations/${qAcc.id}/actions/order`));
    console.log('order from quote ->', JSON.stringify(r).slice(0, 400));
    const so = r.salesOrder ?? r;
    return { id: so.id, no: so.soNo ?? so.orderNo };
  });
  note(soFromQ, 'Sales order (from quotation)', `/sales-orders/${soFromQ.id}`);

  const so2 = await once('salesOrderDirect', (id) => erp(`/sales-orders/${id}`), async () => {
    const so = await api('POST', erp('/sales-orders'), {
      customerId: M.customer2.id,
      customerPoNo: 'PO-TEST-0002',
      orderDate: day(0),
      deliveryDate: day(7),
      paymentTermDays: 30,
      vatMode: 'exclusive',
      warehouseId: M.wh.id,
      shipToAddress: '77/7 ถนนทดสอบ ต.ทดสอบ อ.ทดสอบ จ.นนทบุรี 11000 (ข้อมูลปลอม)',
      note: `สั่งตรงทางโทรศัพท์ ${TAG}`,
      lines: [
        line(M['FG-RSC-A4'], 2000, '12.00', { fulfilment: 'stock' }),
        line(M.fg, 3000, '3.20', { fulfilment: 'stock' }),
      ],
    });
    return { id: so.id, no: so.soNo ?? so.orderNo, created: true };
  });
  note(so2, 'Sales order (direct, partial delivery)', `/sales-orders/${so2.id}`);
  for (const so of [soFromQ, so2]) {
    const cur = await api('GET', erp(`/sales-orders/${so.id}`));
    if (cur.status === 'draft') await api('POST', erp(`/sales-orders/${so.id}/actions/confirm`), { overrideReason: null });
  }
  M.soFromQ = soFromQ; M.so2 = so2;

  // Partial delivery of the direct order: half of the first line only.
  const dn = await once('deliveryNotePartial', (id) => erp(`/delivery-notes/${id}`), async () => {
    const so = await api('GET', erp(`/sales-orders/${so2.id}`));
    const l1 = so.lines[0];
    const d = await api('POST', erp('/delivery-notes'), {
      salesOrderId: so2.id,
      deliverOn: day(0),
      warehouseId: M.wh.id,
      vehicle: 'กท-0000 (ทดสอบ)',
      note: `ส่งบางส่วน งวดที่ 1 ${TAG}`,
      lines: [{ salesOrderLineId: l1.id, quantity: '1000' }],
    });
    return { id: d.id, no: d.dnNo ?? d.deliveryNo ?? d.number };
  });
  note(dn, 'Delivery note (partial)', `/deliveries/${dn.id}`);
  M.dn = dn;
}

/** Issues and delivers the partial delivery note (opening stock is booked first if the shelf is empty). */
async function deliver() {
  const dn = await api('GET', erp(`/delivery-notes/${state.deliveryNotePartial.id}`));
  if (dn.status === 'draft') {
    if (!state.openingStockRsc) {
      await api('POST', erp('/stock/actions/adjust'), {
        kind: 'opening',
        warehouseId: M.wh.id,
        reason: `ยอดยกมาสินค้าสำเร็จรูป ${TAG}`,
        lines: [
          { itemId: M['FG-RSC-A4'].id, quantity: '1500', unitCost: '8.40' },
          { itemId: M.fg.id, quantity: '2000', unitCost: '2.10' },
        ],
      });
      state.openingStockRsc = true; save();
    }
    await api('POST', erp(`/delivery-notes/${dn.id}/actions/issue`));
  }
  const now = await api('GET', erp(`/delivery-notes/${dn.id}`));
  if (now.status === 'issued')
    await api('POST', erp(`/delivery-notes/${dn.id}/actions/deliver`), { receivedBy: 'คุณผู้รับ ทดสอบ (ข้อมูลปลอม)' });
  const fin = await api('GET', erp(`/delivery-notes/${dn.id}`));
  state.deliveryNotePartial.no = fin.doNo; save();
  const r = report.find((x) => x.id === dn.id); if (r) r.no = `${fin.doNo} (${fin.status})`;
}

// ---------------------------------------------------------------------------------------------
// 2. Planning — a released MO from the recipe, then auto-plan the machine board
// ---------------------------------------------------------------------------------------------
async function planning() {
  const recipe = (await api('GET', erp('/recipes'))).data.find((r) => r.status === 'active');
  const mo = await once('productionOrder', (id) => erp(`/production-orders/${id}`), async () => {
    const o = await api('POST', erp('/production-orders'), {
      source: 'stock',
      itemId: recipe.item.id,
      recipeId: recipe.id,
      quantity: '6000',
      dueOn: day(4),
      plannedStartOn: day(0),
      priority: 1,
      warehouseId: M.wh.id,
      title: `ผลิตกล่องครีม 30 ml เติมสต็อก ${TAG}`,
      note: `สร้างจากสูตรการผลิต ${TAG}`,
    });
    return { id: o.id, no: o.moNo };
  });
  const cur = await api('GET', erp(`/production-orders/${mo.id}`));
  if (cur.status === 'draft') await api('POST', erp(`/production-orders/${mo.id}/actions/release`));
  note(mo, 'Production order (from recipe, released)', `/planning/orders/${mo.id}`);
  // The getpack-job MOs arrive with milestone operations and no machine; a planner assigns the
  // press and die-cut steps to machines on the board (the drag/drop "move" action), pinning the
  // urgent job (MO-2610-0006, already late) onto today, then lets auto-plan place the rest.
  const machines = await api('GET', erp('/machines'));
  const mach = (n) => machines.find((m) => m.name === n)?.id;
  const assign = [
    { mo: 'MO-2610-0006', op: 'พิมพ์', machine: '[DEV] Offset press', minutes: 240, start: `${day(0)}T08:30:00+07:00`, locked: true },
    { mo: 'MO-2610-0006', op: 'ไดคัท', machine: '[DEV] Die cutter', minutes: 150, start: `${day(0)}T13:30:00+07:00`, locked: true },
    { mo: 'MO-2610-0002', op: 'พิมพ์', machine: '[DEV] Offset press', minutes: 180, start: `${day(1)}T08:00:00+07:00`, locked: false },
    { mo: 'MO-2610-0002', op: 'ไดคัท', machine: '[DEV] Die cutter', minutes: 120, start: `${day(1)}T08:00:00+07:00`, locked: false },
  ];
  const pre = await api('GET', erp(`/schedule?from=${day(0)}&days=7`));
  for (const a of assign) {
    const u = pre.unassigned.find((x) => x.order.moNo === a.mo && x.name === a.op);
    if (!u || !mach(a.machine)) continue; // already on a machine (re-run) or not present
    await api('PUT', erp(`/production-orders/${u.order.id}/operations/${u.operationId}/schedule`), {
      machineId: mach(a.machine), plannedMinutes: a.minutes, start: a.start, locked: a.locked,
    });
  }
  const plan = await api('POST', erp('/schedule/actions/auto-plan'));
  console.log(`auto-plan: placed ${plan.placed}, kept ${plan.kept}, late ${plan.late?.length}`);
  const board = await api('GET', erp(`/schedule?from=${day(0)}&days=7`));
  const bars = board.machines.reduce((n, m) => n + m.blocks.length + m.slots.length, 0);
  console.log(`schedule ${day(0)}+7d: ${bars} bars on ${board.machines.filter((m) => m.slots.length + m.blocks.length).length} machines, unassigned ${board.unassigned.length}`);
  report.push({ label: `Machine schedule (${bars} bars over 7 days)`, no: '', id: '', url: `/planning/schedule?days=3` });
  M.mo = mo;
}

// ---------------------------------------------------------------------------------------------
// 3. Quality — a passed final check, a failed in-process check, and an NCR on the failure
// ---------------------------------------------------------------------------------------------
async function quality() {
  const orders = (await api('GET', erp('/production-orders'))).data;
  const done = orders.find((o) => o.status === 'completed') ?? orders[0];
  const running = state.productionOrder ? { id: state.productionOrder.id } : orders.find((o) => o.status !== 'completed');
  const points = [
    { name: 'ขนาดกางออก (ความกว้าง)', type: 'measurement', unit: 'mm', targetValue: '120', minValue: '119.5', maxValue: '120.5' },
    { name: 'สีตรงตามปรู๊ฟ (Delta E ≤ 3)', type: 'pass_fail', instruction: 'เทียบกับปรู๊ฟที่ลูกค้าเซ็นอนุมัติ' },
    { name: 'รอยพับ/รอยไดคัทคม ไม่ปริ', type: 'pass_fail' },
  ];
  const mk = async (key, body, record) => once(key, (id) => erp(`/quality-checks/${id}`), async () => {
    const c = await api('POST', erp('/quality-checks'), body);
    const rec = await api('PUT', erp(`/quality-checks/${c.id}`), record, { ifMatch: true });
    return { id: c.id, no: rec.qcNo ?? c.qcNo, result: rec.result };
  });
  const pass = await mk('qcPassed', {
    kind: 'final', productionOrderId: done.id, inspectedAt: new Date().toISOString(), inspectedQty: '500', sampleSize: '32',
    lotNo: 'LOT-TEST-001', remarks: `ตรวจขั้นสุดท้ายก่อนส่ง ${TAG}`, checkpoints: points,
  }, {
    inspectedQty: '500', sampleSize: '32', acceptedQty: '500', rejectedQty: '0', remarks: 'ผ่านทุกหัวข้อ (ข้อมูลทดสอบ)',
    points: [{ seq: 1, measured: '120.1', outcome: 'pass' }, { seq: 2, outcome: 'pass' }, { seq: 3, outcome: 'pass' }],
  });
  note(pass, 'QC check (passed)', `/quality/${pass.id}`);
  const fail = await mk('qcFailed', {
    kind: 'in_process', productionOrderId: running.id, inspectedAt: new Date().toISOString(), inspectedQty: '800', sampleSize: '50',
    lotNo: 'LOT-TEST-002', remarks: `ตรวจระหว่างผลิตหลังพิมพ์ ${TAG}`, checkpoints: points,
  }, {
    inspectedQty: '800', sampleSize: '50', acceptedQty: '650', rejectedQty: '150', remarks: 'สีเพี้ยนเกินเกณฑ์ ขนาดเกินพิกัด (ข้อมูลทดสอบ)',
    points: [{ seq: 1, measured: '121.2', outcome: 'fail' }, { seq: 2, outcome: 'fail', note: 'Delta E ≈ 5.2' }, { seq: 3, outcome: 'pass' }],
  });
  note(fail, 'QC check (failed)', `/quality/${fail.id}`);
  // The failed check may already have raised an NCR automatically; reuse it if so.
  const ncr = await once('ncr', (id) => erp(`/ncrs/${id}`), async () => {
    const auto = (await api('GET', erp('/ncrs'))).data.find((n) => n.check?.id === fail.id);
    if (auto) return { id: auto.id, no: auto.ncrNo };
    const n = await api('POST', erp('/ncrs'), {
      source: 'quality_check', checkId: fail.id, productionOrderId: running.id, severity: 'major',
      title: `สีพิมพ์เพี้ยนและขนาดเกินพิกัด ล็อต LOT-TEST-002 ${TAG}`,
      description: 'พบสีเพี้ยนจากปรู๊ฟ (Delta E ประมาณ 5.2) และความกว้างกางออกเกิน +1.2 มม. จำนวน 150 ชิ้น กักแยกไว้รอพิจารณา (ข้อมูลทดสอบ)',
      quantity: '150', unit: 'pcs', actionDueOn: day(3),
    });
    return { id: n.id, no: n.ncrNo };
  });
  note(ncr, 'NCR (from failed check)', `/quality/ncrs/${ncr.id}`);
}

// ---------------------------------------------------------------------------------------------
// 4. Finance — sales invoices, a receipt, a supplier invoice + payment, a manual journal
// ---------------------------------------------------------------------------------------------
async function finance() {
  const inv1 = await once('salesInvoiceFromSo', (id) => erp(`/sales-invoices/${id}`), async () => {
    const i = await api('POST', erp('/sales-invoices'), {
      customerId: M.customer2.id, salesOrderId: state.salesOrderDirect.id, deliveryNoteIds: [state.deliveryNotePartial.id],
      form: 'invoice', issueDate: day(0), paymentTermDays: 30, vatMode: 'exclusive', customerPoNo: 'PO-TEST-0002',
      note: `วางบิลงวดที่ 1 ตามใบส่งของ ${TAG}`,
    });
    return { id: i.id, no: i.invoiceNo };
  });
  let cur = await api('GET', erp(`/sales-invoices/${inv1.id}`));
  if (cur.status === 'draft') cur = await api('POST', erp(`/sales-invoices/${inv1.id}/actions/issue`), { issueDate: day(0) });
  inv1.no = cur.invoiceNo; inv1.total = cur.total; save();
  note(inv1, 'Sales invoice (from SO / delivery note)', `/invoices/${inv1.id}`);

  const inv2 = await once('salesInvoiceManual', (id) => erp(`/sales-invoices/${id}`), async () => {
    const i = await api('POST', erp('/sales-invoices'), {
      customerId: M.customer1.id, form: 'invoice', issueDate: day(0), paymentTermDays: 30, vatMode: 'exclusive',
      note: `ค่าออกแบบและทำแม่พิมพ์ ${TAG}`,
      lines: [
        { description: 'ค่าออกแบบอาร์ตเวิร์กกล่อง 2 แบบ', quantity: '2', unit: 'job', unitPrice: '3500' },
        { description: 'ค่าทำบล็อกไดคัท', quantity: '1', unit: 'job', unitPrice: '2800' },
      ],
    });
    return { id: i.id, no: i.invoiceNo };
  });
  cur = await api('GET', erp(`/sales-invoices/${inv2.id}`));
  if (cur.status === 'draft') cur = await api('POST', erp(`/sales-invoices/${inv2.id}/actions/issue`), { issueDate: day(0) });
  inv2.no = cur.invoiceNo; inv2.total = cur.total; save();
  note(inv2, 'Sales invoice (manual lines, paid)', `/invoices/${inv2.id}`);

  const rc = await once('receipt', (id) => erp(`/receipts/${id}`), async () => {
    const r = await api('POST', erp('/receipts'), {
      customerId: M.customer1.id, receivedOn: day(0), method: 'transfer', reference: 'TRF-TEST-0001',
      amount: String(inv2.total), allocations: [{ invoiceId: inv2.id, amount: String(inv2.total) }],
      note: `รับชำระเต็มจำนวน ${TAG}`,
    });
    return { id: r.id, no: r.receiptNo };
  });
  note(rc, 'Receipt (against manual invoice)', `/receivables/receipts/${rc.id}`);

  const si = await once('supplierInvoice', (id) => erp(`/supplier-invoices/${id}`), async () => {
    const s = await api('POST', erp('/supplier-invoices'), {
      supplierId: M.supplier.id, invoiceNo: 'INV-TEST-S0001-001', taxInvoiceNo: 'TAX-TEST-001', invoiceDate: day(-2), dueDate: day(28),
      vatMode: 'exclusive', vatRatePct: '7', note: `ค่ากระดาษคราฟท์ ${TAG}`,
      lines: [
        { itemId: M.paper.id, description: 'กระดาษคราฟท์ 350 แกรม 31×43 นิ้ว', quantity: '500', unitPrice: '9.80' },
        { description: 'ค่าขนส่ง', quantity: '1', unitPrice: '600' },
      ],
    });
    return { id: s.id, no: s.siNo ?? s.docNo ?? s.invoiceNo };
  });
  cur = await api('GET', erp(`/supplier-invoices/${si.id}`));
  if (['draft', 'pending', 'pending_approval', 'submitted', 'variance'].includes(cur.status))
    cur = await api('POST', erp(`/supplier-invoices/${si.id}/actions/approve`), { note: 'อนุมัติจ่าย (ทดสอบ)' });
  si.total = cur.total ?? cur.balance; save();
  note(si, `Supplier invoice (${cur.status})`, `/payables/invoices/${si.id}`);

  const sp = await once('supplierPayment', (id) => erp(`/supplier-payments/${id}`), async () => {
    const amt = String(cur.balance ?? cur.payableAmount ?? cur.total);
    const p = await api('POST', erp('/supplier-payments'), {
      supplierId: M.supplier.id, paidOn: day(0), method: 'transfer', reference: 'PAY-TEST-0001',
      allocations: [{ supplierInvoiceId: si.id, amount: amt }], note: `จ่ายค่ากระดาษ ${TAG}`,
    });
    return { id: p.id, no: p.paymentNo ?? p.docNo };
  });
  note(sp, 'Supplier payment', `/payables/payments/${sp.id}`);

  const je = await once('journal', (id) => erp(`/ledger/journals/${id}`), async () => {
    const j = await api('POST', erp('/ledger/journals'), {
      documentDate: day(0), description: `ตั้งค้างจ่ายค่าไฟฟ้าเดือนตุลาคม ${TAG}`, submit: true,
      lines: [
        { accountCode: '6160', side: 'debit', amount: '12500.00', description: 'ค่าไฟฟ้าโรงงาน ต.ค. (ประมาณการ)' },
        { accountCode: '2140', side: 'credit', amount: '12500.00', description: 'ค่าใช้จ่ายค้างจ่าย' },
      ],
    });
    return { id: j.id, no: j.entryNo ?? j.journalNo ?? j.docNo };
  });
  cur = await api('GET', erp(`/ledger/journals/${je.id}`));
  if (cur.status === 'pending_approval' || cur.status === 'submitted') {
    // Maker-checker (erp.ledger_self_approval): the owner cannot approve their own entry, so it is
    // expected to stay pending_approval until another factory user with factory_ledger.approve approves it.
    try { cur = await api('POST', erp(`/ledger/journals/${je.id}/actions/approve`)); }
    catch (e) { console.log('journal approve refused (left pending):', e.message.slice(0, 300)); }
  }
  je.no = cur.entryNo ?? cur.journalNo ?? cur.docNo ?? je.no; save();
  note(je, `Manual journal (${cur.status})`, `/ledger/journals/${je.id}`);
}

// ---------------------------------------------------------------------------------------------
// 6. Shipping — a shipment in "ready" with cartons
// ---------------------------------------------------------------------------------------------
async function shipping() {
  const list = (await api('GET', '/v1/partner/shipments')).data;
  const ready = list.find((s) => s.status === 'ready' && (s.cartons?.length ?? s.cartonsCount) > 0);
  if (ready) report.push({ label: `Shipment (ready, ${ready.cartonsCount} cartons, existing)`, no: ready.shipmentNo, id: ready.id, url: `/ship/${ready.id}` });
  else skipped.push({ step: 'shipping', why: 'no ready shipment with cartons found; none created' });
}

// ---------------------------------------------------------------------------------------------
const STEPS = { sales, deliver, planning, quality, finance, shipping };
const browser = await login();
try {
  await master();
  for (const [name, fn] of Object.entries(STEPS)) {
    if (ONLY && !ONLY.has(name)) continue;
    console.log(`== ${name}`);
    try { await fn(); } catch (e) { console.log(`!! ${name} failed: ${e.message}`); skipped.push({ step: name, why: e.message }); }
  }
} finally {
  await browser.close();
}
console.log('\nRESULT');
for (const r of report) console.log(`${r.label}\t${r.no ?? ''}\t${r.id}\t${r.url}`);
if (skipped.length) { console.log('\nSKIPPED'); for (const s of skipped) console.log(`${s.step}: ${s.why}`); }
