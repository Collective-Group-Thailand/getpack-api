import Handlebars from 'handlebars';
import QRCode from 'qrcode';

/**
 * Shipment documents (D-462, "sealed carrier label"; supersedes D-142 for partner-facing documents).
 *
 * - **Carton labels** (100 × 150 mm, one page per carton) and the **packing list** (A4) are made for the partner
 *   factory, which downloads and prints them. They carry **no recipient identity**: shipment code, job numbers,
 *   carton n/m, the destination code within the job (`D1` …), its province and postcode prefix (`830xx`), and a QR
 *   that encodes only the opaque public-tracking URL (`/track/<token>`, no personal data, B4.4). Their input type has
 *   no recipient fields, so nothing can be printed by mistake.
 * - The **carrier waybill** is the full address label (recipient name, phone, address). getpack generates it for the
 *   carrier / driver only — staff download it, the driver sees the same data through the handover link; it is never
 *   stored as a factory-owned file nor offered on the partner surface.
 *
 * Under the getpack brand only — the producing factory is never named on what reaches the customer (D-050). PDF
 * metadata (Title, Author, Subject, Keywords, Creator, Producer) is removed by the renderer (D-442), and the page
 * `<title>` is the shipment code only. Pure apart from the QR encoding; fonts come from the host.
 */

/** Where a partner-facing document says the goods go: never the recipient, only the area (P4-D1). */
export interface PartnerDestination {
  /** `D1`, `D2` … — the destination's code within the job. */
  code: string;
  provinceNameTh: string;
  provinceNameEn: string;
  /** First three digits of the postcode, printed as `830xx`. */
  postcodePrefix: string;
}

/** Carton labels and packing list — the partner factory's documents (D-462). No recipient fields by design. */
export interface PartnerShipmentDocument {
  shipmentNo: string;
  /** The public tracking URL (`<web>/track/<opaque token>`) the carton QR encodes. */
  trackingUrl: string;
  /** getpack under its legal entity (settings), never the factory (D-050). */
  sender: { name: string; phone: string | null };
  destination: PartnerDestination;
  jobNos: string[];
  cartons: { seq: number; labelCode: string }[];
  items: { jobNo: string; description: string; quantity: number }[];
  totalWeightKg: string;
  plannedShipOn: string | null;
  note: string | null;
}

/** The carrier waybill — the full address label for the carrier / driver only (D-462). */
export interface WaybillDocument {
  shipmentNo: string;
  sender: { name: string; phone: string | null; address: string | null };
  recipient: {
    name: string;
    phone: string;
    line1: string;
    line2: string | null;
    postcode: string;
    province: string;
  };
  jobNos: string[];
  cartonsCount: number;
  totalWeightKg: string;
  plannedShipOn: string | null;
}

/** The recipient fields a partner-facing document must never contain (asserted in tests and at render time). */
export interface RecipientIdentity {
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  email?: string | null;
  company?: string | null;
}

const FONT = `'Sarabun', 'TH Sarabun New', 'Loma', 'Garuda', 'Noto Sans Thai', sans-serif`;

/** `830` → `830xx`. */
export const maskedPostcode = (prefix: string): string =>
  `${prefix}${'x'.repeat(Math.max(0, 5 - prefix.length))}`;

const LABELS = Handlebars.compile(
  `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>{{shipmentNo}}</title>
<style>
  @page { size: 100mm 150mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ${FONT}; color: #000; }
  .label { width: 100mm; height: 150mm; padding: 5mm; display: flex; flex-direction: column; page-break-after: always; }
  .label:last-child { page-break-after: auto; }
  .top { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1.5pt solid #000; padding-bottom: 2mm; }
  .brand { font-size: 16pt; font-weight: 700; } .no { font-size: 10pt; font-weight: 700; }
  .block { margin-top: 3mm; font-size: 9pt; line-height: 1.35; }
  .dest { margin-top: 4mm; display: flex; align-items: center; gap: 4mm; }
  .dest .code { font-size: 34pt; font-weight: 700; border: 2pt solid #000; padding: 0 3mm; line-height: 1.1; }
  .dest .area { font-size: 12pt; line-height: 1.35; } .dest .area strong { font-size: 14pt; }
  .caption { font-size: 7.5pt; text-transform: uppercase; color: #333; }
  .jobs { font-size: 10pt; font-weight: 700; }
  .bottom { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; }
  .qr svg { width: 34mm; height: 34mm; }
  .carton { font-size: 20pt; font-weight: 700; text-align: right; } .lcode { font-size: 9pt; text-align: right; }
</style></head><body>
{{#each cartons}}
<section class="label">
  <div class="top"><span class="brand">getpack</span><span class="no">{{../shipmentNo}}</span></div>
  <div class="block"><div class="caption">งาน / Job</div><span class="jobs">{{#each ../jobNos}}{{#if @index}}, {{/if}}{{this}}{{/each}}</span></div>
  <div class="dest">
    <div class="code">{{../destination.code}}</div>
    <div class="area"><div class="caption">ปลายทาง / Destination</div>
      <strong>{{../destination.provinceNameTh}}</strong> · {{../destination.provinceNameEn}}<br>{{../postcodeMasked}}
    </div>
  </div>
  <div class="block"><div class="caption">ผู้ส่ง / From</div>{{../sender.name}}{{#if ../sender.phone}} · {{../sender.phone}}{{/if}}</div>
  <div class="block"><div class="caption">ใบปะหน้าผู้ขนส่ง / Carrier waybill</div>ที่อยู่ผู้รับอยู่บนใบปะหน้าของผู้ขนส่ง</div>
  <div class="bottom">
    <div class="qr">{{{../qrSvg}}}<div class="caption">สแกนเพื่อติดตามพัสดุ</div></div>
    <div><div class="carton">{{seq}}/{{../cartonsCount}}</div><div class="lcode">{{labelCode}}</div></div>
  </div>
</section>
{{/each}}
</body></html>`,
);

const PACKING_LIST = Handlebars.compile(
  `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>{{shipmentNo}}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: ${FONT}; font-size: 11pt; color: #1b1f24; }
  header { display: flex; justify-content: space-between; border-bottom: 2px solid #1b1f24; padding-bottom: 8px; }
  .brand { font-size: 18pt; font-weight: 700; } h1 { font-size: 15pt; margin: 14px 0 6px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; font-size: 10pt; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { border-bottom: 1px solid #d0d5db; padding: 5px 6px; text-align: left; } th { background: #f1f3f5; }
  td.n, th.n { text-align: right; } .sign { margin-top: 28px; display: flex; gap: 40px; font-size: 10pt; }
  .sign div { flex: 1; border-top: 1px solid #1b1f24; padding-top: 4px; }
</style></head><body>
<header><div class="brand">getpack</div><div>{{shipmentNo}}</div></header>
<h1>ใบกำกับสินค้า / Packing list</h1>
<div class="meta">
  <div><strong>ปลายทาง:</strong> {{destination.code}} · {{destination.provinceNameTh}} ({{destination.provinceNameEn}}) · {{postcodeMasked}}</div>
  <div><strong>กำหนดส่ง:</strong> {{#if plannedShipOn}}{{plannedShipOn}}{{else}}—{{/if}}</div>
  <div><strong>งาน:</strong> {{#each jobNos}}{{#if @index}}, {{/if}}{{this}}{{/each}}</div>
  <div><strong>จำนวนกล่อง:</strong> {{cartonsCount}} · <strong>น้ำหนักรวม:</strong> {{totalWeightKg}} kg</div>
</div>
<table><thead><tr><th>งาน / Job</th><th>รายการ</th><th class="n">จำนวน</th></tr></thead><tbody>
{{#each items}}<tr><td>{{jobNo}}</td><td>{{description}}</td><td class="n">{{quantity}}</td></tr>{{/each}}
</tbody></table>
<table style="margin-top: 12px"><thead><tr><th>กล่อง</th><th>รหัสฉลาก</th><th>ปลายทาง</th></tr></thead><tbody>
{{#each cartons}}<tr><td>{{seq}}/{{../cartonsCount}}</td><td>{{labelCode}}</td><td>{{../destination.code}} · {{../postcodeMasked}}</td></tr>{{/each}}
</tbody></table>
{{#if note}}<p>หมายเหตุ: {{note}}</p>{{/if}}
<div class="sign"><div>ผู้ส่งมอบ / Handed over by</div><div>ผู้ขนส่ง / Carrier</div><div>วันที่ / Date</div></div>
</body></html>`,
);

const WAYBILL = Handlebars.compile(
  `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>{{shipmentNo}}</title>
<style>
  @page { size: 100mm 150mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ${FONT}; color: #000; }
  .label { width: 100mm; height: 150mm; padding: 5mm; display: flex; flex-direction: column; }
  .top { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1.5pt solid #000; padding-bottom: 2mm; }
  .brand { font-size: 16pt; font-weight: 700; } .no { font-size: 10pt; font-weight: 700; }
  .block { margin-top: 3mm; font-size: 9pt; line-height: 1.35; }
  .to { font-size: 12pt; line-height: 1.35; } .to strong { font-size: 13pt; }
  .caption { font-size: 7.5pt; text-transform: uppercase; color: #333; }
  .bottom { margin-top: auto; display: flex; justify-content: space-between; font-size: 10pt; }
</style></head><body>
<section class="label">
  <div class="top"><span class="brand">getpack</span><span class="no">{{shipmentNo}}</span></div>
  <div class="block"><div class="caption">ผู้ส่ง / From</div>{{sender.name}}{{#if sender.phone}} · {{sender.phone}}{{/if}}{{#if sender.address}}<br>{{sender.address}}{{/if}}</div>
  <div class="block to"><div class="caption">ผู้รับ / To</div>
    <strong>{{recipient.name}}</strong><br>{{recipient.phone}}<br>{{recipient.line1}}<br>
    {{#if recipient.line2}}{{recipient.line2}}<br>{{/if}}{{recipient.province}} {{recipient.postcode}}
  </div>
  <div class="block"><div class="caption">งาน / Job</div>{{#each jobNos}}{{#if @index}}, {{/if}}{{this}}{{/each}}</div>
  <div class="bottom">
    <div>{{cartonsCount}} กล่อง · {{totalWeightKg}} kg</div>
    <div>{{#if plannedShipOn}}{{plannedShipOn}}{{/if}}</div>
  </div>
</section>
</body></html>`,
);

export async function renderLabelsHtml(doc: PartnerShipmentDocument): Promise<string> {
  const qrSvg = await QRCode.toString(doc.trackingUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 });
  return LABELS({
    ...doc,
    qrSvg,
    cartonsCount: doc.cartons.length,
    postcodeMasked: maskedPostcode(doc.destination.postcodePrefix),
  });
}

export function renderPackingListHtml(doc: PartnerShipmentDocument): string {
  return PACKING_LIST({
    ...doc,
    cartonsCount: doc.cartons.length,
    postcodeMasked: maskedPostcode(doc.destination.postcodePrefix),
  });
}

/** The carrier waybill (full recipient) — staff download and the driver's handover only, never the partner. */
export function renderWaybillHtml(doc: WaybillDocument): string {
  return WAYBILL(doc);
}

/** File names of the partner documents: by shipment code only (D-462), never a customer or company name. */
export const partnerDocumentFileName = (shipmentNo: string, kind: 'labels' | 'packing'): string =>
  `${shipmentNo.replace(/[^A-Za-z0-9_-]/g, '_')}-${kind}.pdf`;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** HTML entities back to text, so an escaped value is found like a plain one. */
const decodeEntities = (html: string): string =>
  html.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] !== '#') return ENTITIES[ref.toLowerCase()] ?? whole;
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });

/**
 * Defence in depth (D-462): the recipient fields found in a partner document's HTML. Entities are decoded first;
 * values shorter than four characters are skipped (they would match ordinary text); the phone is compared by its
 * digits (E.164 and the local `0…` form). The QR's SVG path is numbers only and is left out of the phone check.
 */
export function leakedRecipientFields(html: string, recipient: RecipientIdentity): string[] {
  const text = decodeEntities(html.replace(/<svg[\s\S]*?<\/svg>/g, ''));
  const digits = text.replace(/\D/g, '');
  const found: string[] = [];
  const check = (field: string, value: string | null | undefined) => {
    const v = value?.trim();
    if (v && v.length >= 4 && text.includes(v)) found.push(field);
  };
  check('name', recipient.name);
  check('line1', recipient.line1);
  check('line2', recipient.line2);
  check('email', recipient.email);
  check('company', recipient.company);
  const phoneDigits = recipient.phone.replace(/\D/g, '');
  // +66 81 000 1234 → 0810001234: the national number without its leading 0 is in both forms.
  const national = phoneDigits.startsWith('66') ? phoneDigits.slice(2) : phoneDigits.replace(/^0/, '');
  if (national.length >= 8 && digits.includes(national)) found.push('phone');
  return found;
}
