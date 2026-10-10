import { nextActions } from '@common/next-actions/next-actions';

import { dec } from './erp.math';
import { STAGE_PROBABILITY } from './erp-crm.service';
import { renderSalesDocHtml, renderWhtCertificateHtml, type SalesDocView } from './erp-documents.render';
import { IV_ACTIONS, openOf } from './erp-receivables.service';
import { LINE, lineId, lineIdOf, totalsOf } from './erp-sales.shared';
import { WHT_RATE } from './erp-tax.service';

const PARTY = { name: 'บจก. ทดสอบ', address: '1 ถนนทดสอบ', taxId: '0105500000001', branchCode: '00000', phone: null };

describe('Factory ERP E4 arithmetic and documents', () => {
  it('totals a document in each VAT mode (D-363)', () => {
    const lines = [{ amount: '1000.00' }, { amount: '70.00' }];
    expect(totalsOf(lines, 'exclusive', '7')).toEqual({ subtotal: '1070.00', vatAmount: '74.90', total: '1144.90' });
    expect(totalsOf(lines, 'inclusive', '7')).toEqual({ subtotal: '1000.00', vatAmount: '70.00', total: '1070.00' });
    expect(totalsOf(lines, 'none', '7')).toEqual({ subtotal: '1070.00', vatAmount: '0.00', total: '1070.00' });
  });

  it('keeps line ids stable and scoped to their document kind', () => {
    const id = lineId(LINE.iv, 4242n);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lineIdOf(LINE.iv, id)).toBe(4242n);
    expect(lineIdOf(LINE.so, id)).toBeNull();
    expect(lineIdOf(LINE.iv, 'not-a-uuid')).toBeNull();
  });

  it('nets debit and credit notes and receipts into what is still open (D-364, D-365)', () => {
    const open = openOf({
      total: dec('1070.00'),
      debitedAmount: dec('107.00'),
      creditedAmount: dec('53.50'),
      receivedAmount: dec('500.00'),
    });
    expect(open.toFixed(2)).toBe('623.50');
  });

  it('offers invoice actions by status and permission', () => {
    const keys = (status: 'draft' | 'issued', perms: string[], settled = false) =>
      nextActions({ status, open: dec(status === 'draft' ? 0 : 100), settled }, IV_ACTIONS, new Set(perms)).map(
        (a) => a.key,
      );
    const manage = ['factory_receivables.manage', 'factory_receivables.read'];
    expect(keys('draft', manage)).toEqual(expect.arrayContaining(['erp_iv.issue', 'erp_iv.delete']));
    expect(keys('draft', manage)).not.toContain('erp_iv.pdf');
    expect(keys('issued', manage)).toEqual(expect.arrayContaining(['erp_iv.receive', 'erp_iv.credit', 'erp_iv.pdf']));
    expect(keys('issued', ['factory_receivables.read'])).toEqual(['erp_iv.pdf']);
  });

  it('uses the usual withholding rates and stage probabilities', () => {
    expect(WHT_RATE.transport).toBe('1');
    expect(WHT_RATE.advertising).toBe('2');
    expect(WHT_RATE.hire_of_work).toBe('3');
    expect(WHT_RATE.rent).toBe('5');
    expect(STAGE_PROBABILITY.won).toBe(100);
    expect(STAGE_PROBABILITY.lost).toBe(0);
  });

  it('prints a tax invoice as original and copy, in words, under the factory name (D-368)', () => {
    const view: SalesDocView = {
      titleTh: 'ใบแจ้งหนี้/ใบกำกับภาษี',
      titleEn: 'Invoice / Tax invoice',
      copies: true,
      docNo: 'IV2610-0001',
      rows: [{ label: 'วันที่', value: '10 ต.ค. 2569' }],
      seller: PARTY,
      logo: null,
      buyer: { ...PARTY, name: 'ลูกค้า <ทดสอบ>' },
      fullForm: true,
      lines: [{ description: 'กล่อง', quantity: '1000.0000', unit: 'pcs', unitPrice: '1.07', amount: '1070.00' }],
      totals: [{ label: 'รวมทั้งสิ้น', value: '1144.90', strong: true }],
      words: '1144.90',
      notes: [],
      stamp: null,
      draft: false,
      footer: null,
      bankDetails: null,
      signatures: ['ผู้รับสินค้า', 'ผู้มีอำนาจลงนาม'],
    };
    const html = renderSalesDocHtml(view);
    expect(html).toContain('ต้นฉบับ');
    expect(html).toContain('สำเนา');
    expect(html).toContain('ลูกค้า &lt;ทดสอบ&gt;');
    expect(html).toContain('สร้างด้วย Packio Factory');
  });

  it('prints the 50 ทวิ with the right form ticked and rows summed', () => {
    const html = renderWhtCertificateHtml({
      certNo: 'WHT2610-0001',
      bookNo: '2569',
      form: 'pnd53',
      payer: PARTY,
      payee: { ...PARTY, name: 'ผู้รับจ้าง' },
      paidOn: '2026-10-10',
      lines: [
        { incomeType: 'hire_of_work', description: null, ratePct: '3', baseAmount: '10000.00', whtAmount: '300.00' },
        { incomeType: 'transport', description: null, ratePct: '1', baseAmount: '2000.00', whtAmount: '20.00' },
      ],
      baseAmount: '12000.00',
      whtAmount: '320.00',
      voided: false,
      signatory: 'ผู้มีอำนาจ',
    });
    expect(html).toContain('☒ ภ.ง.ด.53');
    expect(html).toContain('☐ ภ.ง.ด.3');
    expect(html).toContain('12,000.00');
    expect(html).toContain('สามร้อยยี่สิบบาทถ้วน');
  });
});
