import Handlebars from 'handlebars';
import QRCode from 'qrcode';

/**
 * Carton labels (100 × 150 mm, one page per carton) and the packing list (A4) of a shipment. Under the
 * Packio brand only — the producing factory is never named on what reaches the customer (D-050). The QR
 * code opens public tracking (B4.4). Pure apart from the QR encoding; fonts come from the host.
 */
export interface ShipmentDocument {
  shipmentNo: string;
  trackingUrl: string;
  sender: { name: string; phone: string | null };
  recipient: { name: string; phone: string; line1: string; line2: string | null; postcode: string };
  cartons: { seq: number; labelCode: string }[];
  items: { orderCode: string; description: string; quantity: number }[];
  totalWeightKg: string;
  plannedShipOn: string | null;
  note: string | null;
}

const FONT = `'Sarabun', 'TH Sarabun New', 'Loma', 'Garuda', 'Noto Sans Thai', sans-serif`;

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
  .to { font-size: 12pt; line-height: 1.35; } .to strong { font-size: 13pt; }
  .caption { font-size: 7.5pt; text-transform: uppercase; color: #333; }
  .bottom { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; }
  .qr svg { width: 34mm; height: 34mm; }
  .carton { font-size: 20pt; font-weight: 700; text-align: right; } .code { font-size: 9pt; }
</style></head><body>
{{#each cartons}}
<section class="label">
  <div class="top"><span class="brand">Packio</span><span class="no">{{../shipmentNo}}</span></div>
  <div class="block"><div class="caption">ผู้ส่ง / From</div>{{../sender.name}}{{#if ../sender.phone}} · {{../sender.phone}}{{/if}}</div>
  <div class="block to"><div class="caption">ผู้รับ / To</div>
    <strong>{{../recipient.name}}</strong><br>{{../recipient.phone}}<br>{{../recipient.line1}}<br>
    {{#if ../recipient.line2}}{{../recipient.line2}}<br>{{/if}}{{../recipient.postcode}}
  </div>
  <div class="bottom">
    <div class="qr">{{{../qrSvg}}}<div class="caption">สแกนเพื่อติดตามพัสดุ</div></div>
    <div><div class="carton">{{seq}}/{{../cartonsCount}}</div><div class="code">{{labelCode}}</div></div>
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
<header><div class="brand">Packio</div><div>{{shipmentNo}}</div></header>
<h1>ใบกำกับสินค้า / Packing list</h1>
<div class="meta">
  <div><strong>ผู้รับ:</strong> {{recipient.name}} · {{recipient.phone}}</div>
  <div><strong>กำหนดส่ง:</strong> {{#if plannedShipOn}}{{plannedShipOn}}{{else}}—{{/if}}</div>
  <div><strong>ที่อยู่:</strong> {{recipient.line1}}{{#if recipient.line2}} {{recipient.line2}}{{/if}} {{recipient.postcode}}</div>
  <div><strong>จำนวนกล่อง:</strong> {{cartonsCount}} · <strong>น้ำหนักรวม:</strong> {{totalWeightKg}} kg</div>
</div>
<table><thead><tr><th>คำสั่งซื้อ</th><th>รายการ</th><th class="n">จำนวน</th></tr></thead><tbody>
{{#each items}}<tr><td>{{orderCode}}</td><td>{{description}}</td><td class="n">{{quantity}}</td></tr>{{/each}}
</tbody></table>
<table style="margin-top: 12px"><thead><tr><th>กล่อง</th><th>รหัสฉลาก</th></tr></thead><tbody>
{{#each cartons}}<tr><td>{{seq}}/{{../cartonsCount}}</td><td>{{labelCode}}</td></tr>{{/each}}
</tbody></table>
{{#if note}}<p>หมายเหตุ: {{note}}</p>{{/if}}
<div class="sign"><div>ผู้ส่งมอบ / Delivered by</div><div>ผู้รับ / Received by</div><div>วันที่ / Date</div></div>
</body></html>`,
);

export async function renderLabelsHtml(doc: ShipmentDocument): Promise<string> {
  const qrSvg = await QRCode.toString(doc.trackingUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 });
  return LABELS({ ...doc, qrSvg, cartonsCount: doc.cartons.length });
}

export function renderPackingListHtml(doc: ShipmentDocument): string {
  return PACKING_LIST({ ...doc, cartonsCount: doc.cartons.length });
}
