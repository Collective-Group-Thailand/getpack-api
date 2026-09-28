import { bahtText, thaiDate, thaiMonth } from './thai-text';

/**
 * HTML of customer documents and company statements (B5.2), rendered to PDF by the host's Chromium with the
 * installed Thai fonts. Seller data comes from the entity's settings snapshot (D-092); Packio is the brand.
 */

const esc = (v: string | number | null | undefined) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const money = (v: string) => {
  const [int, dec] = v.split('.');
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec ?? '00'}`;
};

export interface RenderableDocument {
  docType: string;
  docKind: string;
  docNumber: string;
  documentDate: string;
  dueDate: string | null;
  isTaxInvoice: boolean;
  isFullForm: boolean;
  status: string;
  voidReason: string | null;
  seller: {
    legalNameTh: string | null;
    legalNameEn: string | null;
    taxId: string | null;
    branchCode: string | null;
    addressTh: string | null;
    phone: string | null;
  };
  buyer: { name: string; taxId: string | null; branchCode: string | null; address: string | null };
  reference: { docNumber: string; reason: string | null } | null;
  lines: { description: string; quantity: string; unitPrice: string; net: string; discount: string; vat: string; gross: string }[];
  net: string;
  discount: string;
  vat: string;
  vatRatePct: string;
  gross: string;
  deductedPrior: string;
  amountDue: string;
  wht: string;
  cash: string;
  receiptVia: string | null;
}

export function documentTitle(d: Pick<RenderableDocument, 'docType' | 'docKind' | 'isTaxInvoice' | 'amountDue'>): { th: string; en: string } {
  switch (d.docType) {
    case 'tr':
      return Number(d.amountDue) > 0
        ? { th: 'ใบกำกับภาษี/ใบแจ้งหนี้', en: 'Tax invoice / Invoice' }
        : { th: 'ใบกำกับภาษี/ใบเสร็จรับเงิน', en: 'Tax invoice / Receipt' };
    case 'iv':
      return d.isTaxInvoice ? { th: 'ใบแจ้งหนี้/ใบกำกับภาษี', en: 'Invoice / Tax invoice' } : { th: 'ใบแจ้งหนี้', en: 'Invoice' };
    case 'rc':
      return d.isTaxInvoice ? { th: 'ใบเสร็จรับเงิน/ใบกำกับภาษี', en: 'Receipt / Tax invoice' } : { th: 'ใบเสร็จรับเงิน', en: 'Receipt' };
    case 'cn':
      return { th: 'ใบลดหนี้/ใบกำกับภาษี', en: 'Credit note' };
    default:
      return { th: 'ใบเพิ่มหนี้/ใบกำกับภาษี', en: 'Debit note' };
  }
}

const STYLE = `
  @page { size: A4; margin: 14mm 12mm; }
  body { font-family: 'Sarabun', 'TH Sarabun New', 'Noto Sans Thai', sans-serif; font-size: 12pt; color: #111; }
  .brand { font-size: 20pt; font-weight: 700; color: #1f4e79; }
  .row { display: flex; justify-content: space-between; gap: 16px; }
  .box { border: 1px solid #999; padding: 8px 10px; border-radius: 4px; }
  h1 { font-size: 16pt; margin: 0; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #bbb; padding: 4px 6px; }
  th { background: #eef3f8; }
  td.n { text-align: right; white-space: nowrap; }
  .totals td { border: none; padding: 2px 6px; }
  .void { color: #b00; font-size: 18pt; font-weight: 700; border: 3px solid #b00; padding: 4px 12px; display: inline-block; }
  .sign { margin-top: 40px; text-align: center; width: 40%; }
`;

export function renderDocumentHtml(d: RenderableDocument): string {
  const title = documentTitle(d);
  const sellerName = d.seller.legalNameTh ?? d.seller.legalNameEn ?? '';
  const branch = (code: string | null) => (code === null ? '' : code === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${code}`);
  const rows = d.lines
    .map(
      (l, i) =>
        `<tr><td class="n">${i + 1}</td><td>${esc(l.description)}</td><td class="n">${esc(l.quantity)}</td><td class="n">${money(l.unitPrice)}</td><td class="n">${money(l.discount)}</td><td class="n">${money((Number(l.net) - Number(l.discount)).toFixed(2))}</td></tr>`,
    )
    .join('');
  const total = (label: string, value: string, bold = false) =>
    `<tr><td>${label}</td><td class="n">${bold ? `<b>${money(value)}</b>` : money(value)}</td></tr>`;
  const taxable = (Number(d.net) - Number(d.discount)).toFixed(2);
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(d.docNumber)}</title><style>${STYLE}</style></head><body>
<div class="row">
  <div><div class="brand">Packio</div>
    <div><b>${esc(sellerName)}</b>${d.seller.legalNameEn ? `<br>${esc(d.seller.legalNameEn)}` : ''}</div>
    <div>${esc(d.seller.addressTh)}</div>
    <div>เลขประจำตัวผู้เสียภาษี ${esc(d.seller.taxId)} ${branch(d.seller.branchCode)}</div>
    ${d.seller.phone ? `<div>โทร ${esc(d.seller.phone)}</div>` : ''}
  </div>
  <div><h1>${title.th}<br><small>${title.en}</small></h1>
    <div class="box">เลขที่ ${esc(d.docNumber)}<br>วันที่ ${thaiDate(d.documentDate)}${d.dueDate ? `<br>ครบกำหนด ${thaiDate(d.dueDate)}` : ''}</div>
  </div>
</div>
${d.status === 'void' ? `<p><span class="void">ยกเลิก</span> ${esc(d.voidReason)}</p>` : ''}
<div class="box" style="margin-top:10px">
  <b>ลูกค้า</b> ${esc(d.buyer.name)}<br>${esc(d.buyer.address)}
  ${d.isFullForm && d.buyer.taxId ? `<br>เลขประจำตัวผู้เสียภาษี ${esc(d.buyer.taxId)} ${branch(d.buyer.branchCode)}` : ''}
</div>
${d.reference ? `<p>อ้างอิงเอกสาร ${esc(d.reference.docNumber)}${d.reference.reason ? ` — เหตุผล: ${esc(d.reference.reason)}` : ''}</p>` : ''}
<table><thead><tr><th>#</th><th>รายการ</th><th>จำนวน</th><th>ราคาต่อหน่วย</th><th>ส่วนลด</th><th>จำนวนเงิน</th></tr></thead><tbody>${rows}</tbody></table>
<div class="row" style="margin-top:8px">
  <div style="width:55%">(${bahtText(Number(d.amountDue) > 0 && d.docType !== 'rc' ? d.amountDue : d.gross)})</div>
  <table class="totals" style="width:45%"><tbody>
    ${total('รวมเป็นเงิน', d.net)}
    ${Number(d.discount) > 0 ? total('ส่วนลด', d.discount) : ''}
    ${total('มูลค่าก่อนภาษี', taxable)}
    ${total(`ภาษีมูลค่าเพิ่ม ${Number(d.vatRatePct)}%`, d.vat)}
    ${total('รวมทั้งสิ้น', d.gross, true)}
    ${Number(d.deductedPrior) > 0 ? total('หัก ชำระแล้วตามใบกำกับภาษีงวดก่อน', d.deductedPrior) + total('ยอดคงค้างชำระ', d.amountDue, true) : ''}
    ${Number(d.wht) > 0 ? total('หัก ภาษีหัก ณ ที่จ่าย', d.wht) + total('รับชำระสุทธิ', d.cash, true) : ''}
  </tbody></table>
</div>
<div class="row"><div class="sign">......................................<br>ผู้รับเงิน / ผู้มีอำนาจลงนาม</div><div class="sign">......................................<br>วันที่</div></div>
</body></html>`;
}

export interface RenderableStatement {
  companyName: string;
  companyCode: string | null;
  month: string;
  seller: RenderableDocument['seller'];
  opening: string;
  invoiced: string;
  paid: string;
  credited: string;
  closing: string;
  lines: { date: string; docNumber: string; description: string; debit: string; credit: string }[];
}

export function renderStatementHtml(s: RenderableStatement): string {
  const rows = s.lines
    .map((l) => `<tr><td>${thaiDate(l.date)}</td><td>${esc(l.docNumber)}</td><td>${esc(l.description)}</td><td class="n">${money(l.debit)}</td><td class="n">${money(l.credit)}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Statement ${esc(s.month)}</title><style>${STYLE}</style></head><body>
<div class="row"><div><div class="brand">Packio</div><b>${esc(s.seller.legalNameTh ?? '')}</b><br>${esc(s.seller.addressTh)}</div>
<div><h1>ใบแจ้งยอด<br><small>Statement of account</small></h1><div class="box">ประจำเดือน ${thaiMonth(s.month)}</div></div></div>
<div class="box" style="margin-top:10px"><b>บริษัท</b> ${esc(s.companyName)} ${s.companyCode ? `(${esc(s.companyCode)})` : ''}</div>
<table><thead><tr><th>วันที่</th><th>เอกสาร</th><th>รายการ</th><th>เพิ่ม</th><th>ลด</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals" style="width:45%;margin-left:55%"><tbody>
<tr><td>ยอดยกมา</td><td class="n">${money(s.opening)}</td></tr>
<tr><td>ใบแจ้งหนี้</td><td class="n">${money(s.invoiced)}</td></tr>
<tr><td>รับชำระ</td><td class="n">${money(s.paid)}</td></tr>
<tr><td>ลดหนี้</td><td class="n">${money(s.credited)}</td></tr>
<tr><td><b>ยอดคงเหลือ</b></td><td class="n"><b>${money(s.closing)}</b></td></tr>
</tbody></table></body></html>`;
}

/**
 * e-Tax invoice XML (D-091: generated in R1, sent from R2) following the element names of the Revenue
 * Department / ETDA cross-industry invoice (ขมธอ. 3-2560); validation against the ETDA schema is part of the R2
 * registration work.
 */
export function renderETaxXml(d: RenderableDocument & { typeCode: string; issuedAt: string }): string {
  const x = (tag: string, value: string | null | undefined) => (value ? `<${tag}>${esc(value)}</${tag}>` : '');
  const lines = d.lines
    .map(
      (l, i) => `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument>${x('ram:LineID', String(i + 1))}</ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct>${x('ram:Name', l.description)}</ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:GrossPriceProductTradePrice>${x('ram:ChargeAmount', l.unitPrice)}</ram:GrossPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery>${x('ram:BilledQuantity', l.quantity)}</ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax>${x('ram:TypeCode', 'VAT')}${x('ram:CalculatedRate', d.vatRatePct)}${x('ram:CalculatedAmount', l.vat)}</ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation>${x('ram:NetLineTotalAmount', (Number(l.net) - Number(l.discount)).toFixed(2))}${x('ram:NetIncludingTaxesLineTotalAmount', l.gross)}</ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:TaxInvoice_CrossIndustryInvoice xmlns:rsm="urn:etda:uncefact:data:standard:TaxInvoice_CrossIndustryInvoice:2" xmlns:ram="urn:etda:uncefact:data:standard:TaxInvoice_ReusableAggregateBusinessInformationEntity:2">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter>${x('ram:ID', 'ER3-2560')}</ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>${x('ram:ID', d.docNumber)}${x('ram:Name', documentTitle(d).th)}${x('ram:TypeCode', d.typeCode)}${x('ram:IssueDateTime', d.issuedAt)}${d.reference ? `<ram:IncludedNote>${x('ram:Subject', d.reference.reason)}</ram:IncludedNote>` : ''}</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
<ram:ApplicableHeaderTradeAgreement>
<ram:SellerTradeParty>${x('ram:Name', d.seller.legalNameTh)}<ram:SpecifiedTaxRegistration>${x('ram:ID', `${d.seller.taxId ?? ''}${d.seller.branchCode ?? ''}`)}</ram:SpecifiedTaxRegistration><ram:PostalTradeAddress>${x('ram:LineOne', d.seller.addressTh)}${x('ram:CountryID', 'TH')}</ram:PostalTradeAddress></ram:SellerTradeParty>
<ram:BuyerTradeParty>${x('ram:Name', d.buyer.name)}${d.buyer.taxId ? `<ram:SpecifiedTaxRegistration>${x('ram:ID', `${d.buyer.taxId}${d.buyer.branchCode ?? ''}`)}</ram:SpecifiedTaxRegistration>` : ''}<ram:PostalTradeAddress>${x('ram:LineOne', d.buyer.address)}${x('ram:CountryID', 'TH')}</ram:PostalTradeAddress></ram:BuyerTradeParty>
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeSettlement>${x('ram:InvoiceCurrencyCode', 'THB')}<ram:ApplicableTradeTax>${x('ram:TypeCode', 'VAT')}${x('ram:CalculatedRate', d.vatRatePct)}${x('ram:BasisAmount', (Number(d.net) - Number(d.discount)).toFixed(2))}${x('ram:CalculatedAmount', d.vat)}</ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementHeaderMonetarySummation>${x('ram:LineTotalAmount', d.net)}${x('ram:AllowanceTotalAmount', d.discount)}${x('ram:TaxBasisTotalAmount', (Number(d.net) - Number(d.discount)).toFixed(2))}${x('ram:TaxTotalAmount', d.vat)}${x('ram:GrandTotalAmount', d.gross)}</ram:SpecifiedTradeSettlementHeaderMonetarySummation></ram:ApplicableHeaderTradeSettlement>
${lines}
</rsm:SupplyChainTradeTransaction>
</rsm:TaxInvoice_CrossIndustryInvoice>
`;
}

/** ETDA document type codes: 388 tax invoice, T02 invoice/tax invoice, T03 receipt/tax invoice, 81 credit note, 80 debit note. */
export function eTaxTypeCode(d: Pick<RenderableDocument, 'docType' | 'amountDue'>): string {
  return { tr: Number(d.amountDue) > 0 ? 'T02' : 'T03', iv: 'T02', rc: 'T03', cn: '81', dn: '80' }[d.docType] ?? '388';
}
