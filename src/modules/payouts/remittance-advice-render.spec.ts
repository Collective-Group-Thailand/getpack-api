import { renderRemittanceAdviceHtml } from './remittance-advice-render';

describe('remittance advice (U-B0.3)', () => {
  const html = renderRemittanceAdviceHtml({
    pvNumber: 'PV-2610-0001',
    paidOn: '2026-10-15',
    payer: { name: 'Packio (fake)', taxId: '0000000000019' },
    payee: { name: 'โรงงาน <ทดสอบ>', taxId: '0000000000027', branchCode: '00000' },
    bankAccountLast4: '1234',
    bankRef: 'BR-1',
    lines: [{ label: 'PO-2610-0001', netAmount: '1000.00', vatAmount: '70.00' }],
    apNetAmount: '1000.00',
    vatAmount: '70.00',
    whtAmount: '30.00',
    retentionAmount: '50.00',
    cashAmount: '990.00',
  });

  it('shows the paid lines, the deductions and the net transfer', () => {
    expect(html).toContain('PV-2610-0001');
    expect(html).toContain('PO-2610-0001');
    expect(html).toContain('-30.00');
    expect(html).toContain('<b>990.00</b>');
  });

  it('escapes names and shows only the last four digits of the account', () => {
    expect(html).toContain('โรงงาน &lt;ทดสอบ&gt;');
    expect(html).toContain('xxxx1234');
  });
});
