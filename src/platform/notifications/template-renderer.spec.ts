import { assertTemplateCompiles, renderTemplate } from './template-renderer';

describe('renderTemplate', () => {
  const context = {
    payload: { orderCode: 'PK-0001', note: '<b>x</b>' },
    recipient: { displayName: 'ลูกค้า ทดสอบ' },
  };

  it('renders text channels without escaping', async () => {
    const out = await renderTemplate(
      'line',
      { subject: null, body: 'คำสั่งซื้อ {{payload.orderCode}} {{payload.note}}' },
      context,
    );
    expect(out.body).toBe('คำสั่งซื้อ PK-0001 <b>x</b>');
  });

  it('escapes values in e-mail and compiles MJML to HTML', async () => {
    const out = await renderTemplate(
      'email',
      {
        subject: 'คำสั่งซื้อ {{payload.orderCode}}',
        body: '<mjml><mj-body><mj-section><mj-column><mj-text>{{recipient.displayName}} {{payload.note}}</mj-text></mj-column></mj-section></mj-body></mjml>',
      },
      context,
    );
    expect(out.subject).toBe('คำสั่งซื้อ PK-0001');
    expect(out.body).toContain('<!doctype html>');
    expect(out.body).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(out.text).toContain('ลูกค้า ทดสอบ');
  });

  it('rejects templates that do not compile', () => {
    expect(() => assertTemplateCompiles('{{#if}}')).toThrow();
    expect(() => assertTemplateCompiles('{{payload.x}}')).not.toThrow();
  });
});
