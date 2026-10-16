import Handlebars from 'handlebars';

/**
 * The quotation document (ใบเสนอราคา, accounting-design §4 QT): issued by the legal entity (D-010,
 * D-092) under the getpack brand, Thai first. Pure: the caller passes every value; issuer fields that
 * are not configured are left out, never invented. Fonts come from the host (Thai fonts in the image).
 */
export interface QuoteDocument {
  issuer: {
    legalNameTh: string | null;
    legalNameEn: string | null;
    taxId: string | null;
    branchCode: string | null;
    addressTh: string | null;
    phone: string | null;
  };
  quoteCode: string;
  issuedOn: string;
  validUntil: string;
  customerName: string | null;
  productTypeName: string;
  specification: string;
  deliveryPostcode: string | null;
  lines: {
    quantity: number;
    unitPrice: string;
    productAmount: string;
    designFeeAmount: string;
    shippingAmount: string | null;
    vatAmount: string;
    grossAmount: string;
    leadTimeDays: number | null;
    tolerance: string | null;
    /** D-186: ± mm and ΔE2000, when published for the line. */
    dimensionalMm?: string | null;
    colourDeltaE?: string | null;
  }[];
  validityDays: number;
}

const money = (value: string | null): string =>
  value === null
    ? '—'
    : Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TEMPLATE = Handlebars.compile(
  `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>{{quoteCode}}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: 'Sarabun', 'TH Sarabun New', 'Loma', 'Garuda', 'Noto Sans Thai', sans-serif; font-size: 11pt; color: #1b1f24; }
  header { display: flex; justify-content: space-between; border-bottom: 2px solid #1b1f24; padding-bottom: 8px; }
  .brand { font-size: 18pt; font-weight: 700; } .tag { font-size: 9pt; color: #5b6470; }
  .issuer { text-align: right; font-size: 9.5pt; line-height: 1.4; }
  h1 { font-size: 15pt; margin: 14px 0 4px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; font-size: 10pt; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { border-bottom: 1px solid #d0d5db; padding: 5px 6px; text-align: right; }
  th:first-child, td:first-child { text-align: left; } th { background: #f1f3f5; }
  .notes { margin-top: 14px; font-size: 9pt; color: #3d444d; line-height: 1.5; }
</style></head><body>
<header>
  <div><div class="brand">getpack</div><div class="tag">Your Packaging Production Partner</div></div>
  <div class="issuer">
    {{#if issuer.legalNameTh}}<strong>{{issuer.legalNameTh}}</strong><br>{{/if}}
    {{#if issuer.legalNameEn}}{{issuer.legalNameEn}}<br>{{/if}}
    {{#if issuer.addressTh}}{{issuer.addressTh}}<br>{{/if}}
    {{#if issuer.taxId}}เลขประจำตัวผู้เสียภาษี {{issuer.taxId}}{{#if issuer.branchCode}} สาขา {{issuer.branchCode}}{{/if}}<br>{{/if}}
    {{#if issuer.phone}}โทร {{issuer.phone}}{{/if}}
  </div>
</header>
<h1>ใบเสนอราคา / Quotation</h1>
<div class="meta">
  <div>เลขที่ / No.: <strong>{{quoteCode}}</strong></div>
  <div>วันที่ / Date: {{issuedOn}}</div>
  <div>ลูกค้า / Customer: {{#if customerName}}{{customerName}}{{else}}—{{/if}}</div>
  <div>ยืนราคาถึง / Valid until: {{validUntil}}</div>
  <div>สินค้า / Product: {{productTypeName}}</div>
  <div>จัดส่ง / Delivery postcode: {{#if deliveryPostcode}}{{deliveryPostcode}}{{else}}—{{/if}}</div>
</div>
<p>{{specification}}</p>
<table>
  <thead><tr><th>จำนวน / Qty</th><th>ราคาต่อชิ้น</th><th>ค่าสินค้า</th><th>ค่าออกแบบ</th><th>ค่าขนส่ง</th><th>VAT</th><th>รวม / Total</th><th>ระยะผลิต (วัน)</th></tr></thead>
  <tbody>
  {{#each lines}}<tr><td>{{quantity}}{{#if tolerance}} (±{{tolerance}}%){{/if}}{{#if dimensionalMm}}<br>±{{dimensionalMm}} mm{{/if}}{{#if colourDeltaE}}<br>ΔE ≤ {{colourDeltaE}}{{/if}}</td><td>{{unitPrice}}</td><td>{{productAmount}}</td><td>{{designFeeAmount}}</td><td>{{shippingAmount}}</td><td>{{vatAmount}}</td><td><strong>{{grossAmount}}</strong></td><td>{{leadTimeDays}}</td></tr>{{/each}}
  </tbody>
</table>
<div class="notes">
  ราคาเป็นเงินบาท รวมภาษีมูลค่าเพิ่มแล้ว · ใบเสนอราคานี้มีอายุ {{validityDays}} วัน ราคาไม่เปลี่ยนแปลงภายในระยะเวลาดังกล่าว หลังจากนั้นจะคำนวณราคาใหม่<br>
  Prices in THB including VAT · valid for {{validityDays}} days with the price locked; re-priced after expiry.
</div>
</body></html>`,
  { strict: false },
);

export function renderQuoteDocument(doc: QuoteDocument): string {
  return TEMPLATE({
    ...doc,
    lines: doc.lines.map((l) => ({
      ...l,
      unitPrice: money(l.unitPrice),
      productAmount: money(l.productAmount),
      designFeeAmount: money(l.designFeeAmount),
      shippingAmount: money(l.shippingAmount),
      vatAmount: money(l.vatAmount),
      grossAmount: money(l.grossAmount),
      leadTimeDays: l.leadTimeDays ?? '—',
      tolerance: l.tolerance,
      dimensionalMm: l.dimensionalMm ? String(Number(l.dimensionalMm)) : null,
      colourDeltaE: l.colourDeltaE ? String(Number(l.colourDeltaE)) : null,
    })),
  });
}
