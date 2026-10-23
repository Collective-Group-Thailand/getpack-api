import {
  issuerSignatureHtml,
  type RenderBranding,
  SIGN_STYLE,
} from '@modules/documents/branding/render-branding';
import { bahtText, thaiDate } from '@modules/receivables/thai-text';

/**
 * A4 HTML of the factory's own documents (D-368), rendered to PDF by the host's Chromium with the Thai fonts:
 * quotations, order confirmations, delivery notes, invoices / tax invoices (original and copy), receipts,
 * credit / debit notes, billing notes and the 50 ทวิ certificate — under the factory's name, never getpack's.
 */

export interface DocParty {
  name: string;
  address: string | null;
  taxId: string | null;
  branchCode: string | null;
  phone: string | null;
}

export interface DocLine {
  description: string;
  quantity?: string | null;
  unit?: string | null;
  unitPrice?: string | null;
  discountPct?: string | null;
  amount: string;
}

export interface SalesDocView {
  titleTh: string;
  titleEn: string;
  /** Prints an original and a copy (tax documents). */
  copies: boolean;
  docNo: string;
  rows: { label: string; value: string }[];
  seller: DocParty;
  logo: string | null;
  buyer: DocParty | null;
  buyerLabel?: string;
  /** Full-form tax document: the buyer's tax id and branch are printed. */
  fullForm: boolean;
  lines: DocLine[];
  /** Hide prices (a delivery note). */
  quantitiesOnly?: boolean;
  totals: { label: string; value: string; strong?: boolean }[];
  words: string | null;
  notes: { label: string; value: string }[];
  stamp: string | null;
  draft: boolean;
  footer: string | null;
  bankDetails: string | null;
  signatures: string[];
  /** D-429: which of `signatures` is the factory's own (signed and stamped per its rules); default the first. */
  issuerSignature?: number;
  /** D-428/D-429: the factory's logo, seal and signature at the document's issue time. */
  branding?: RenderBranding;
  /** The document's date, printed beside a signature image. */
  signedOn?: string | null;
}

const esc = (v: string | number | null | undefined) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export const money = (v: string | null | undefined) => {
  if (v === null || v === undefined || v === '') return '';
  const neg = v.startsWith('-');
  const [int, dec] = (neg ? v.slice(1) : v).split('.');
  return `${neg ? '-' : ''}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(dec ?? '00').padEnd(2, '0').slice(0, 2)}`;
};
const qty = (v: string | null | undefined) => {
  if (!v) return '';
  const [int, dec] = v.split('.');
  const d = (dec ?? '').replace(/0+$/, '');
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${d ? `.${d}` : ''}`;
};
const price = (v: string | null | undefined) => {
  if (!v) return '';
  const [int, dec] = v.split('.');
  const d = (dec ?? '').replace(/0+$/, '').padEnd(2, '0');
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d}`;
};
export const branchText = (code: string | null) =>
  code === null ? '' : code === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${code}`;

export const UNIT_TH: Record<string, string> = {
  kg: 'กก.',
  g: 'กรัม',
  ton: 'ตัน',
  sheet: 'แผ่น',
  ream: 'รีม',
  roll: 'ม้วน',
  m: 'เมตร',
  m2: 'ตร.ม.',
  pcs: 'ชิ้น',
  box: 'กล่อง',
  pack: 'แพ็ค',
  set: 'ชุด',
  l: 'ลิตร',
  ml: 'มล.',
  pouch: 'ซอง',
  tube: 'หลอด',
  job: 'งาน',
  round: 'รอบ',
  trip: 'เที่ยว',
};

const STYLE = `
  @page { size: A4; margin: 12mm 12mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', 'TH Sarabun New', 'Noto Sans Thai', sans-serif; font-size: 11pt; color: #111; margin: 0; }
  .page { page-break-after: always; position: relative; min-height: 270mm; }
  .page:last-child { page-break-after: auto; }
  .row { display: flex; justify-content: space-between; gap: 14px; }
  .seller { max-width: 60%; }
  .seller img { max-height: 56px; max-width: 160px; margin-bottom: 4px; }
  .seller .name { font-size: 14pt; font-weight: 700; }
  .title { text-align: right; }
  .title h1 { font-size: 17pt; margin: 0; }
  .title .en { font-size: 10pt; color: #555; }
  .copy { display: inline-block; border: 1.5px solid #333; padding: 1px 10px; margin-top: 4px; font-weight: 700; }
  .box { border: 1px solid #999; padding: 6px 9px; border-radius: 4px; }
  .meta td { padding: 1px 4px; border: none; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 10px; }
  table.lines th, table.lines td { border: 1px solid #bbb; padding: 4px 6px; vertical-align: top; }
  table.lines th { background: #f0f2f4; font-weight: 600; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  td.c { text-align: center; }
  .totals { width: 44%; border-collapse: collapse; }
  .totals td { padding: 2px 6px; }
  .totals tr.strong td { font-weight: 700; border-top: 1px solid #333; }
  .words { width: 54%; padding: 6px 8px; background: #f6f6f6; border-radius: 4px; align-self: flex-start; }
  .notes { margin-top: 8px; font-size: 10pt; }
  .sigs { display: flex; justify-content: space-around; margin-top: 34px; }
  .sig { width: 30%; text-align: center; font-size: 10pt; }
  .sig .line { border-bottom: 1px dotted #333; height: 26px; margin-bottom: 4px; }
  .stamp { position: absolute; top: 90mm; left: 25%; transform: rotate(-18deg); color: #b00; border: 4px solid #b00; font-size: 30pt; font-weight: 800; padding: 6px 26px; opacity: .55; }
  .draft { position: absolute; top: 110mm; left: 30%; transform: rotate(-18deg); color: #999; font-size: 54pt; font-weight: 800; opacity: .25; }
  .foot { position: absolute; bottom: 0; left: 0; right: 0; font-size: 8.5pt; color: #666; display: flex; justify-content: space-between; }
${SIGN_STYLE}
`;

function party(p: DocParty, fullForm: boolean): string {
  return `${esc(p.name)}${p.address ? `<br>${esc(p.address)}` : ''}${
    fullForm && p.taxId ? `<br>เลขประจำตัวผู้เสียภาษี ${esc(p.taxId)} ${branchText(p.branchCode)}` : ''
  }${p.phone ? `<br>โทร ${esc(p.phone)}` : ''}`;
}

function page(d: SalesDocView, copy: string | null): string {
  const rows = d.lines
    .map((l, i) =>
      d.quantitiesOnly
        ? `<tr><td class="c">${i + 1}</td><td>${esc(l.description)}</td><td class="n">${qty(l.quantity)}</td><td>${esc(UNIT_TH[l.unit ?? ''] ?? l.unit ?? '')}</td></tr>`
        : `<tr><td class="c">${i + 1}</td><td>${esc(l.description)}</td><td class="n">${qty(l.quantity)}</td><td>${esc(UNIT_TH[l.unit ?? ''] ?? l.unit ?? '')}</td><td class="n">${price(l.unitPrice)}</td><td class="n">${l.discountPct && Number(l.discountPct) > 0 ? `${Number(l.discountPct)}%` : ''}</td><td class="n">${money(l.amount)}</td></tr>`,
    )
    .join('');
  const head = d.quantitiesOnly
    ? '<th style="width:6%">ลำดับ</th><th>รายการ</th><th class="n" style="width:14%">จำนวน</th><th style="width:12%">หน่วย</th>'
    : '<th style="width:5%">ลำดับ</th><th>รายการ</th><th class="n" style="width:11%">จำนวน</th><th style="width:8%">หน่วย</th><th class="n" style="width:13%">ราคา/หน่วย</th><th class="n" style="width:8%">ส่วนลด</th><th class="n" style="width:15%">จำนวนเงิน</th>';
  return `<div class="page">
<div class="row">
  <div class="seller">${d.logo ? `<img src="${d.logo}" alt="">` : ''}
    <div class="name">${esc(d.seller.name)}</div>
    <div>${esc(d.seller.address)}</div>
    ${d.seller.taxId ? `<div>เลขประจำตัวผู้เสียภาษี ${esc(d.seller.taxId)} ${branchText(d.seller.branchCode)}</div>` : ''}
  </div>
  <div class="title"><h1>${esc(d.titleTh)}</h1><div class="en">${esc(d.titleEn)}</div>${copy ? `<div class="copy">${copy}</div>` : ''}</div>
</div>
<div class="row" style="margin-top:10px">
  ${d.buyer ? `<div class="box" style="flex:1"><b>${esc(d.buyerLabel ?? 'ลูกค้า')}</b><br>${party(d.buyer, d.fullForm)}</div>` : '<div></div>'}
  <div class="box" style="min-width:36%"><table class="meta"><tbody>
    <tr><td>เลขที่</td><td><b>${esc(d.docNo)}</b></td></tr>
    ${d.rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join('')}
  </tbody></table></div>
</div>
<table class="lines"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
${
  d.totals.length
    ? `<div class="row" style="margin-top:8px">
  <div class="words">${d.words ? `(${esc(d.words)})` : ''}</div>
  <table class="totals"><tbody>${d.totals
    .map(
      (t) =>
        `<tr${t.strong ? ' class="strong"' : ''}><td>${esc(t.label)}</td><td class="n">${money(t.value)}</td></tr>`,
    )
    .join('')}</tbody></table>
</div>`
    : ''
}
${d.notes.length ? `<div class="notes">${d.notes.map((n) => `<div><b>${esc(n.label)}</b> ${esc(n.value)}</div>`).join('')}</div>` : ''}
${d.bankDetails ? `<div class="notes"><b>การชำระเงิน</b> ${esc(d.bankDetails)}</div>` : ''}
<div class="sigs">${d.signatures
    .map((s, i) =>
      i === (d.issuerSignature ?? 0) && d.branding && (d.branding.signature || d.branding.seal)
        ? `<div class="sig">${issuerSignatureHtml(s, d.branding, d.branding.signature?.image ? (d.signedOn ?? null) : null)}</div>`
        : `<div class="sig"><div class="line"></div>${esc(s)}<br>วันที่ ........./........./.........</div>`,
    )
    .join('')}</div>
${d.stamp ? `<div class="stamp">${esc(d.stamp)}</div>` : ''}
${d.draft ? '<div class="draft">ร่าง</div>' : ''}
<div class="foot"><span>${esc(d.footer)}</span><span>สร้างด้วย getpack Factory</span></div>
</div>`;
}

export function renderSalesDocHtml(d: SalesDocView): string {
  const pages = d.copies ? [page(d, 'ต้นฉบับ'), page(d, 'สำเนา')] : [page(d, null)];
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(d.docNo)}</title><style>${STYLE}</style></head><body>${pages.join('')}</body></html>`;
}

// ------------------------------------------------------------------------------------- 50 ทวิ

export interface WhtCertView {
  certNo: string;
  bookNo: string;
  form: 'pnd3' | 'pnd53';
  payer: DocParty;
  payee: DocParty;
  paidOn: string;
  lines: {
    incomeType: string;
    description: string | null;
    ratePct: string;
    baseAmount: string;
    whtAmount: string;
  }[];
  baseAmount: string;
  whtAmount: string;
  voided: boolean;
  signatory: string | null;
  branding?: RenderBranding;
}

const INCOME_ROW: Record<string, number> = {
  fees_commission: 2,
  rent: 5,
  hire_of_work: 5,
  transport: 5,
  advertising: 5,
  service: 5,
  prize: 5,
  other: 6,
};
const INCOME_TH: Record<string, string> = {
  fees_commission: 'ค่าธรรมเนียม ค่านายหน้า',
  rent: 'ค่าเช่า',
  hire_of_work: 'ค่าจ้างทำของ',
  transport: 'ค่าขนส่ง',
  advertising: 'ค่าโฆษณา',
  service: 'ค่าบริการ',
  prize: 'รางวัล',
  other: 'อื่น ๆ',
};
const ROWS = [
  '1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)',
  '2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)',
  '3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)',
  '4. ดอกเบี้ย เงินปันผล ฯลฯ ตามมาตรา 40 (4)',
  '5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส เช่น รางวัล ส่วนลด ค่าแสดง ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าขนส่ง ค่าบริการ ฯลฯ',
  '6. อื่น ๆ (ระบุ)',
];

/** The 50 ทวิ (s.50 bis) as the Revenue Department lays it out: payer, payee, the return, the income rows, the tax. */
export function renderWhtCertificateHtml(c: WhtCertView): string {
  const byRow = new Map<number, typeof c.lines>();
  for (const l of c.lines)
    byRow.set(INCOME_ROW[l.incomeType] ?? 6, [...(byRow.get(INCOME_ROW[l.incomeType] ?? 6) ?? []), l]);
  const rows = ROWS.map((label, i) => {
    const ls = byRow.get(i + 1) ?? [];
    const what = ls
      .map(
        (l) =>
          `${INCOME_TH[l.incomeType] ?? ''}${l.description ? ` (${l.description})` : ''} ${Number(l.ratePct)}%`,
      )
      .join(', ');
    const base = ls.reduce((a, l) => a + Number(l.baseAmount), 0);
    const wht = ls.reduce((a, l) => a + Number(l.whtAmount), 0);
    return `<tr><td>${esc(label)}${what ? `<br><b>${esc(what)}</b>` : ''}</td><td class="c">${ls.length ? thaiDate(c.paidOn) : ''}</td><td class="n">${ls.length ? money(base.toFixed(2)) : ''}</td><td class="n">${ls.length ? money(wht.toFixed(2)) : ''}</td></tr>`;
  }).join('');
  const box = (on: boolean, label: string) =>
    `<span style="margin-right:14px">${on ? '☒' : '☐'} ${label}</span>`;
  const one = (copy: string) => `<div class="page">
<div class="title" style="text-align:center"><h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1><div class="en">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div><div class="copy">${copy}</div></div>
<div style="text-align:right;margin-top:4px">เล่มที่ ${esc(c.bookNo)} &nbsp; เลขที่ ${esc(c.certNo)}</div>
<div class="box" style="margin-top:6px"><b>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</b><br>${party(c.payer, true)}</div>
<div class="box" style="margin-top:6px"><b>ผู้ถูกหักภาษี ณ ที่จ่าย</b><br>${party(c.payee, true)}
  <div style="margin-top:4px">ลำดับที่ ........ ในแบบ ${box(false, 'ภ.ง.ด.1ก')}${box(false, 'ภ.ง.ด.1ก พิเศษ')}${box(false, 'ภ.ง.ด.2')}${box(c.form === 'pnd3', 'ภ.ง.ด.3')}${box(false, 'ภ.ง.ด.2ก')}${box(false, 'ภ.ง.ด.3ก')}${box(c.form === 'pnd53', 'ภ.ง.ด.53')}</div>
</div>
<table class="lines"><thead><tr><th>ประเภทเงินได้พึงประเมินที่จ่าย</th><th style="width:16%">วัน เดือน หรือปีภาษี ที่จ่าย</th><th class="n" style="width:17%">จำนวนเงินที่จ่าย</th><th class="n" style="width:17%">ภาษีที่หัก และนำส่งไว้</th></tr></thead>
<tbody>${rows}<tr><td colspan="2" class="n"><b>รวมเงินที่จ่ายและภาษีที่หักนำส่ง</b></td><td class="n"><b>${money(c.baseAmount)}</b></td><td class="n"><b>${money(c.whtAmount)}</b></td></tr></tbody></table>
<div class="words" style="width:100%;margin-top:6px">รวมเงินภาษีที่หักนำส่ง (ตัวอักษร) ${esc(bahtText(c.whtAmount))}</div>
<div style="margin-top:8px">ผู้จ่ายเงิน ${box(true, '(1) หัก ณ ที่จ่าย')}${box(false, '(2) ออกให้ตลอดไป')}${box(false, '(3) ออกให้ครั้งเดียว')}${box(false, '(4) อื่น ๆ')}</div>
<div class="sigs"><div class="sig" style="width:60%">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ${
    c.branding?.signature || c.branding?.seal
      ? issuerSignatureHtml('ผู้จ่ายเงิน', c.branding, thaiDate(c.paidOn))
      : `<div class="line"></div>ลงชื่อ ${esc(c.signatory ?? '')} ผู้จ่ายเงิน<br>วันที่ ${thaiDate(c.paidOn)}`
  }</div></div>
${c.voided ? '<div class="stamp">ยกเลิก</div>' : ''}
<div class="foot"><span>ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี) · ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)</span><span>สร้างด้วย getpack Factory</span></div>
</div>`;
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(c.certNo)}</title><style>${STYLE}</style></head><body>${one('ฉบับที่ 1')}${one('ฉบับที่ 2')}</body></html>`;
}

export const thaiDay = thaiDate;

// ------------------------------------------------------------------------- certificate of analysis

export interface CoaView {
  seller: DocParty;
  logo: string | null;
  footer: string | null;
  qcNo: string;
  product: string;
  sku: string | null;
  lotNo: string | null;
  quantity: string | null;
  orderNo: string | null;
  inspectedOn: string;
  inspector: string;
  /** pass or conditional (D-375). */
  result: string;
  points: { name: string; spec: string; reading: string; outcome: string }[];
  remarks: string | null;
}

const OUTCOME_TH: Record<string, string> = { pass: 'ผ่าน', fail: 'ไม่ผ่าน', na: 'ไม่ประเมิน', '': '-' };

/** D-375: the certificate of analysis a passed final check prints for the customer, under the factory's name. */
export function renderCoaHtml(c: CoaView): string {
  const rows = c.points
    .map(
      (p, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.spec)}</td><td class="n">${esc(p.reading)}</td><td class="c">${esc(OUTCOME_TH[p.outcome] ?? p.outcome)}</td></tr>`,
    )
    .join('');
  const meta: [string, string | null][] = [
    ['สินค้า', c.sku ? `${c.product} (${c.sku})` : c.product],
    ['ล็อต', c.lotNo],
    ['จำนวน', c.quantity],
    ['ใบสั่งผลิต', c.orderNo],
    ['วันที่ตรวจ', thaiDate(c.inspectedOn)],
    ['ผู้ตรวจ', c.inspector],
  ];
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(c.qcNo)}</title><style>${STYLE}</style></head><body><div class="page">
<div class="row">
  <div class="seller">${c.logo ? `<img src="${c.logo}" alt="">` : ''}
    <div class="name">${esc(c.seller.name)}</div>
    <div>${esc(c.seller.address)}</div>
  </div>
  <div class="title"><h1>ใบรับรองคุณภาพสินค้า</h1><div class="en">Certificate of Analysis</div></div>
</div>
<div class="row" style="margin-top:10px">
  <div class="box" style="flex:1"><table class="meta"><tbody>${meta
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('')}</tbody></table></div>
  <div class="box" style="min-width:30%"><table class="meta"><tbody>
    <tr><td>เลขที่</td><td><b>${esc(c.qcNo)}</b></td></tr>
    <tr><td>ผลการตรวจ</td><td><b>${c.result === 'pass' ? 'ผ่าน' : 'ผ่านแบบมีเงื่อนไข'}</b></td></tr>
  </tbody></table></div>
</div>
<table class="lines"><thead><tr><th style="width:6%">ลำดับ</th><th>หัวข้อตรวจ</th><th style="width:26%">เกณฑ์</th><th class="n" style="width:14%">ค่าที่วัดได้</th><th style="width:12%">ผล</th></tr></thead><tbody>${rows}</tbody></table>
${c.remarks ? `<div class="notes"><b>หมายเหตุ</b> ${esc(c.remarks)}</div>` : ''}
<div class="sigs"><div class="sig"><div class="line"></div>ผู้ตรวจสอบ<br>วันที่ ........./........./.........</div><div class="sig"><div class="line"></div>ผู้อนุมัติ<br>วันที่ ........./........./.........</div></div>
<div class="foot"><span>${esc(c.footer)}</span><span>สร้างด้วย getpack Factory</span></div>
</div></body></html>`;
}
