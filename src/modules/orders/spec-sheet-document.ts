import Handlebars from 'handlebars';

/**
 * D-287 the packaging spec sheet: what the box is, measured on every basis, made of what, printed and finished how,
 * to which tolerances, packed how, from which approved artwork. Pure: the caller passes every value; anything not
 * known is left out, never invented. Thai or English; fonts come from the host (as every getpack PDF).
 */
export interface SpecSheetDocument {
  lang: 'th' | 'en';
  orderCode: string;
  generatedOn: string;
  productType: string;
  quantity: string;
  style: { code: string | null; internationalName: string | null; referenceCode: string | null } | null;
  /** Each basis of the sizes (L × W × H, mm); the priced one marked. */
  sizes: { basis: string; length: number; width: number; height: number | null; priced: boolean }[];
  material: { name: string; caliperMm: string | null } | null;
  specLines: { label: string; value: string }[];
  tolerances: { label: string; value: string }[];
  packing: { cartons: { label: string; weightKg: string | null }[]; note: string | null };
  artwork: { fileName: string; sha256: string | null; thumbnailDataUri: string | null } | null;
  qrSvg: string;
  qrUrl: string;
}

const LABELS = {
  th: {
    title: 'ข้อมูลจำเพาะบรรจุภัณฑ์',
    order: 'คำสั่งซื้อ',
    generated: 'ออกเมื่อ',
    product: 'ประเภทสินค้า',
    quantity: 'จำนวน',
    style: 'รูปทรง',
    reference: 'รหัสอ้างอิงสากล',
    sizes: 'ขนาด (มม.)',
    basis: 'ฐานการวัด',
    priced: 'ขนาดที่ใช้คิดราคา',
    material: 'วัสดุ',
    caliper: 'ความหนา',
    spec: 'การพิมพ์และงานหลังพิมพ์',
    tolerances: 'ค่าความคลาดเคลื่อนที่ยอมรับ',
    packing: 'การบรรจุ',
    artwork: 'ไฟล์งานที่อนุมัติ',
    scan: 'สแกนเพื่อดูคำสั่งซื้อและการจัดส่ง',
  },
  en: {
    title: 'Packaging specification',
    order: 'Order',
    generated: 'Issued',
    product: 'Product type',
    quantity: 'Quantity',
    style: 'Style',
    reference: 'Industry reference',
    sizes: 'Sizes (mm)',
    basis: 'Basis',
    priced: 'Size priced',
    material: 'Material',
    caliper: 'Caliper',
    spec: 'Print and finishing',
    tolerances: 'Accepted tolerances',
    packing: 'Packing',
    artwork: 'Approved artwork',
    scan: 'Scan for the order and its delivery',
  },
} as const;

const TEMPLATE = Handlebars.compile(
  `<!doctype html>
<html lang="{{lang}}"><head><meta charset="utf-8"><title>{{orderCode}}</title>
<style>
  @page { size: A4; margin: 14mm 14mm; }
  body { font-family: 'Sarabun', 'TH Sarabun New', 'Loma', 'Garuda', 'Noto Sans Thai', sans-serif; font-size: 10.5pt; color: #1b1f24; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1b1f24; padding-bottom: 8px; }
  .brand { font-size: 18pt; font-weight: 700; } h1 { font-size: 14pt; margin: 2px 0 0; }
  .meta { font-size: 9.5pt; text-align: right; line-height: 1.5; }
  h2 { font-size: 11pt; margin: 14px 0 4px; border-bottom: 1px solid #d0d5db; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { padding: 4px 6px; text-align: left; border-bottom: 1px solid #eceff2; vertical-align: top; }
  th { width: 34%; color: #3d444d; font-weight: 600; }
  .grid { display: grid; grid-template-columns: 1fr 120px; gap: 16px; }
  .qr svg { width: 110px; height: 110px; } .qr p { font-size: 8pt; color: #5b6470; margin: 4px 0 0; }
  .thumb { max-width: 160px; max-height: 160px; border: 1px solid #d0d5db; }
  .hash { font-family: monospace; font-size: 8pt; word-break: break-all; color: #5b6470; }
</style></head>
<body>
<header>
  <div><div class="brand">getpack</div><h1>{{l.title}}</h1></div>
  <div class="meta">{{l.order}} {{orderCode}}<br>{{l.generated}} {{generatedOn}}</div>
</header>
<div class="grid">
<div>
<table>
  <tr><th>{{l.product}}</th><td>{{productType}}</td></tr>
  <tr><th>{{l.quantity}}</th><td>{{quantity}}</td></tr>
  {{#if style}}<tr><th>{{l.style}}</th><td>{{style.code}}{{#if style.internationalName}} · {{style.internationalName}}{{/if}}</td></tr>
  {{#if style.referenceCode}}<tr><th>{{l.reference}}</th><td>{{style.referenceCode}}</td></tr>{{/if}}{{/if}}
  {{#if material}}<tr><th>{{l.material}}</th><td>{{material.name}}{{#if material.caliperMm}} · {{l.caliper}} {{material.caliperMm}} mm{{/if}}</td></tr>{{/if}}
</table>
</div>
<div class="qr">{{{qrSvg}}}<p>{{l.scan}}</p><p class="hash">{{qrUrl}}</p></div>
</div>
{{#if sizes.length}}<h2>{{l.sizes}}</h2>
<table>
  <tr><th>{{l.basis}}</th><td>L × W × H</td></tr>
  {{#each sizes}}<tr><th>{{basis}}{{#if priced}} ({{../l.priced}}){{/if}}</th><td>{{length}} × {{width}}{{#if height}} × {{height}}{{/if}}</td></tr>{{/each}}
</table>{{/if}}
{{#if specLines.length}}<h2>{{l.spec}}</h2>
<table>{{#each specLines}}<tr><th>{{label}}</th><td>{{value}}</td></tr>{{/each}}</table>{{/if}}
{{#if tolerances.length}}<h2>{{l.tolerances}}</h2>
<table>{{#each tolerances}}<tr><th>{{label}}</th><td>{{value}}</td></tr>{{/each}}</table>{{/if}}
<h2>{{l.packing}}</h2>
<table>
  {{#each packing.cartons}}<tr><th>{{label}}</th><td>{{#if weightKg}}{{weightKg}} kg{{/if}}</td></tr>{{/each}}
  {{#if packing.note}}<tr><td colspan="2">{{packing.note}}</td></tr>{{/if}}
</table>
{{#if artwork}}<h2>{{l.artwork}}</h2>
<table><tr><th>{{artwork.fileName}}</th><td>{{#if artwork.thumbnailDataUri}}<img class="thumb" src="{{artwork.thumbnailDataUri}}" alt="">{{/if}}
{{#if artwork.sha256}}<div class="hash">sha256 {{artwork.sha256}}</div>{{/if}}</td></tr></table>{{/if}}
</body></html>`,
);

export function renderSpecSheet(doc: SpecSheetDocument): string {
  return TEMPLATE({ ...doc, l: LABELS[doc.lang] });
}

export const specSheetLabels = (lang: 'th' | 'en') => LABELS[lang];
