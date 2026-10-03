import { type ProspectusContent } from './prospectus.service';

/**
 * HTML of the partner prospectus (B6.1, D-102), rendered to PDF by the host's Chromium with the installed Thai
 * fonts. Only the published (suppressed) figures are passed in; a hidden figure prints as "<k".
 */

const esc = (v: string | number | null | undefined) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const grouped = (v: number | string) => {
  const [int, dec] = String(v).split('.');
  const body = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec === undefined ? body : `${body}.${dec}`;
};

const STYLE = `
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: 'Sarabun', 'TH Sarabun New', 'Noto Sans Thai', sans-serif; font-size: 10.5pt; color: #111; }
  h1 { font-size: 18pt; margin: 0 0 4px; }
  h2 { font-size: 13pt; margin: 18px 0 6px; }
  .meta { color: #444; margin-bottom: 10px; }
  .note { font-size: 9pt; color: #444; border-left: 3px solid #999; padding: 4px 8px; margin: 8px 0 12px; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  th, td { border: 1px solid #bbb; padding: 3px 6px; }
  th { background: #f0f0f0; text-align: left; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.hidden { text-align: right; color: #777; }
  tr.total td { font-weight: 600; background: #fafafa; }
`;

export function renderProspectusHtml(c: ProspectusContent): string {
  const hidden = `&lt;${c.k}`;
  const value = (v: number | string | null) =>
    v === null ? `<td class="hidden">${hidden}</td>` : `<td class="num">${esc(grouped(v))}</td>`;
  const tables = c.tables
    .map((t) => {
      const head = [
        ...t.labels.map((l) => `${esc(l.th)}<br>${esc(l.en)}`),
        ...t.metrics.map((m) => `${esc(m.labelTh)}<br>${esc(m.labelEn)}`),
      ]
        .map((h) => `<th>${h}</th>`)
        .join('');
      const body = t.rows.length
        ? t.rows
            .map(
              (r) =>
                `<tr>${r.labels.map((l) => `<td>${esc(l)}</td>`).join('')}${r.values.map(value).join('')}</tr>`,
            )
            .join('')
        : `<tr><td colspan="${t.labels.length + t.metrics.length}">ไม่มีข้อมูลในช่วงนี้ / No data in this period</td></tr>`;
      const total = `<tr class="total"><td colspan="${t.labels.length}">รวม / Total</td>${t.totals.map(value).join('')}</tr>`;
      return `<h2>${esc(t.titleTh)} · ${esc(t.titleEn)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table>`;
    })
    .join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(c.titleEn)}</title><style>${STYLE}</style></head><body>
<h1>${esc(c.titleTh)}</h1>
<div class="meta">${esc(c.titleEn)}${c.issuer ? ` · ${esc(c.issuer)}` : ''}<br>ช่วงข้อมูล / Period: ${esc(c.from)} – ${esc(c.to)}</div>
<div class="note">ข้อมูลรวมและไม่ระบุตัวตน ไม่มีข้อมูลลูกค้ารายบุคคล ราคาของลูกค้ารายใด หรือชื่อโรงงาน ตัวเลขที่มีผู้เกี่ยวข้องน้อยกว่า ${c.k} ราย แสดงเป็น "${hidden}"<br>
Aggregated and anonymised: no customer identity, individual price or factory name. Figures backed by fewer than ${c.k} contributors show as "${hidden}" (${c.suppressed} cells); the target-price table needs ${c.kTarget} customers per figure.</div>
${tables}
</body></html>`;
}
