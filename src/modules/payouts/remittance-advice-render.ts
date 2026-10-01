import { thaiDate } from '@modules/receivables/thai-text';

/**
 * Factory remittance advice (ใบแจ้งการโอนเงิน) of a paid payout item (U-B0.3, D-022, D-166): what was paid, for
 * which payables, less withholding and retention, to which account (last four digits only).
 */
export interface RemittanceAdviceView {
  pvNumber: string;
  paidOn: string;
  payer: { name: string; taxId: string };
  payee: { name: string; taxId: string; branchCode: string };
  bankAccountLast4: string | null;
  bankRef: string | null;
  lines: { label: string; netAmount: string; vatAmount: string }[];
  apNetAmount: string;
  vatAmount: string;
  whtAmount: string;
  retentionAmount: string;
  cashAmount: string;
}

const esc = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function renderRemittanceAdviceHtml(v: RemittanceAdviceView): string {
  const rows = v.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.label)}</td><td class="n">${l.netAmount}</td><td class="n">${l.vatAmount}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(v.pvNumber)}</title>
<style>@page{size:A4;margin:14mm}body{font-family:'Sarabun','TH Sarabun New',sans-serif;font-size:12pt}
table{width:100%;border-collapse:collapse}td,th{border:1px solid #999;padding:4px 6px}.n{text-align:right}</style></head><body>
<h2 style="text-align:center">ใบแจ้งการโอนเงิน<br><small>Remittance advice</small></h2>
<p>เลขที่ใบสำคัญจ่าย ${esc(v.pvNumber)} · วันที่โอน ${thaiDate(v.paidOn)}</p>
<p><b>ผู้จ่าย</b> ${esc(v.payer.name)} เลขประจำตัวผู้เสียภาษี ${esc(v.payer.taxId)}</p>
<p><b>ผู้รับ</b> ${esc(v.payee.name)} เลขประจำตัวผู้เสียภาษี ${esc(v.payee.taxId)} สาขา ${esc(v.payee.branchCode)}</p>
<p>บัญชีปลายทาง ${v.bankAccountLast4 ? `xxxx${esc(v.bankAccountLast4)}` : '-'}${v.bankRef ? ` · อ้างอิงธนาคาร ${esc(v.bankRef)}` : ''}</p>
<table><thead><tr><th>รายการ</th><th>ก่อน VAT</th><th>VAT</th></tr></thead><tbody>${rows}</tbody></table>
<table style="margin-top:8px"><tbody>
<tr><td>รวมก่อน VAT</td><td class="n">${v.apNetAmount}</td></tr>
<tr><td>ภาษีมูลค่าเพิ่ม</td><td class="n">${v.vatAmount}</td></tr>
<tr><td>หัก ภาษี ณ ที่จ่าย</td><td class="n">-${v.whtAmount}</td></tr>
<tr><td>หัก เงินประกันผลงาน</td><td class="n">-${v.retentionAmount}</td></tr>
<tr><td><b>ยอดโอนสุทธิ</b></td><td class="n"><b>${v.cashAmount}</b></td></tr>
</tbody></table>
</body></html>`;
}
