import { bahtText, thaiDate } from '@modules/receivables/thai-text';

/** 50 ทวิ (หนังสือรับรองการหักภาษี ณ ที่จ่าย) issued by Packio's entity to a factory / vendor (§4 WT). */
export interface WhtCertificateView {
  wtNumber: string;
  paidOn: string;
  form: 'pnd3' | 'pnd53';
  payer: { name: string; taxId: string; address: string };
  payee: { name: string; taxId: string; branchCode: string };
  incomeTypeCode: string;
  paidAmount: string;
  whtAmount: string;
}

const esc = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const INCOME: Record<string, string> = {
  hire_of_work: 'ค่าจ้างทำของ (มาตรา 40(8) / 3 เตรส)',
  transport: 'ค่าขนส่ง',
  service: 'ค่าบริการ',
};

export function renderWhtCertificateHtml(v: WhtCertificateView): string {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(v.wtNumber)}</title>
<style>@page{size:A4;margin:14mm}body{font-family:'Sarabun','TH Sarabun New',sans-serif;font-size:12pt}
table{width:100%;border-collapse:collapse}td,th{border:1px solid #999;padding:4px 6px}.n{text-align:right}</style></head><body>
<h2 style="text-align:center">หนังสือรับรองการหักภาษี ณ ที่จ่าย<br><small>ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</small></h2>
<p>เล่มที่/เลขที่ ${esc(v.wtNumber)} · แบบ ${v.form === 'pnd53' ? 'ภ.ง.ด.53' : 'ภ.ง.ด.3'}</p>
<p><b>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</b> ${esc(v.payer.name)} เลขประจำตัวผู้เสียภาษี ${esc(v.payer.taxId)}<br>${esc(v.payer.address)}</p>
<p><b>ผู้ถูกหักภาษี ณ ที่จ่าย</b> ${esc(v.payee.name)} เลขประจำตัวผู้เสียภาษี ${esc(v.payee.taxId)} สาขา ${esc(v.payee.branchCode)}</p>
<table><thead><tr><th>ประเภทเงินได้</th><th>วันที่จ่าย</th><th>จำนวนเงินที่จ่าย</th><th>ภาษีที่หักและนำส่งไว้</th></tr></thead>
<tbody><tr><td>${esc(INCOME[v.incomeTypeCode] ?? v.incomeTypeCode)}</td><td>${thaiDate(v.paidOn)}</td><td class="n">${v.paidAmount}</td><td class="n">${v.whtAmount}</td></tr></tbody></table>
<p>รวมภาษีที่หักนำส่ง (ตัวอักษร) ${bahtText(v.whtAmount)}</p>
<p>ผู้จ่ายเงิน: (1) หัก ณ ที่จ่าย</p>
<p style="margin-top:40px;text-align:right">ลงชื่อ ...................................... ผู้จ่ายเงิน</p>
</body></html>`;
}
