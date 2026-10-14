import { accountCodesOf, renderJournal, validateTemplate } from '@common/ledger-core/template';
import { MoneyDecimal } from '@common/money/money';

import {
  CHART_TEMPLATE,
  ERP_GL_DIMENSIONS,
  ITEM_KIND_ACCOUNTS,
  METHOD_ACCOUNTS,
  POSTING_EVENT_TYPES,
  REVERSING_EVENTS,
  RULE_VARIABLES,
  RULES_TEMPLATE,
  STATEMENT_LINES,
  SYNC_EVENT_TYPES,
} from './erp-ledger.template';
import { depreciationDue, lineHash, monthlyDepreciation } from './erp-ledger-assets.service';
import { templateFromDto, templateIssues, templateToDto } from './erp-ledger-rules.service';

const d = (v: string | number) => new MoneyDecimal(v);
const accounts = { ...METHOD_ACCOUNTS };
const rule = (key: string) => RULES_TEMPLATE.find((r) => r.key === key)!.template;
const mv = (value: string, inventoryAccount = '1141') => ({ itemId: 'i', warehouseId: 'w', kind: 'x', value, inventoryAccount, expenseAccount: '5230' });

describe('E6 chart template (D-386)', () => {
  const codes = new Set(CHART_TEMPLATE.map((a) => a.code));

  it('has unique codes, known parents and statement lines', () => {
    expect(codes.size).toBe(CHART_TEMPLATE.length);
    for (const a of CHART_TEMPLATE) {
      if (a.parent) expect(codes.has(a.parent)).toBe(true);
      expect(STATEMENT_LINES).toContain(a.line);
    }
  });

  it('maps every item kind and purpose to a postable account', () => {
    const postable = new Set(CHART_TEMPLATE.filter((a) => a.postable !== false).map((a) => a.code));
    for (const code of Object.values(ITEM_KIND_ACCOUNTS)) expect(postable.has(code)).toBe(true);
    for (const [key, code] of Object.entries(METHOD_ACCOUNTS)) {
      if (key === 'bank') expect(codes.has(code)).toBe(true); // the parent of each bank sub-account
      else expect([key, postable.has(code)]).toEqual([key, true]);
    }
  });
});

describe('E6 posting rules (D-388)', () => {
  it('every template is valid against the factory dimensions and posts to known accounts', () => {
    const codes = new Set(CHART_TEMPLATE.map((a) => a.code));
    for (const r of RULES_TEMPLATE) {
      expect([r.key, validateTemplate(r.template, ERP_GL_DIMENSIONS)]).toEqual([r.key, []]);
      for (const c of accountCodesOf(r.template)) expect(codes.has(c)).toBe(true);
    }
  });

  it('subscribes to document events only; ledger-own events post in the request', () => {
    for (const t of SYNC_EVENT_TYPES) expect(POSTING_EVENT_TYPES).not.toContain(t);
    for (const t of Object.keys(REVERSING_EVENTS)) expect(POSTING_EVENT_TYPES).toContain(t);
  });

  it('F01 goods receipt: inventory = GR/IR + landed charges', () => {
    const j = renderJournal(rule('F01'), {
      documentId: 'gr', documentNo: 'GR-2610-0001', documentDate: '2026-10-13', partnerName: 'S', accounts,
      movements: [mv('10000.00'), mv('2600.00', '1146')], goodsValue: '12000.00', chargesValue: '600.00',
    });
    expect(j.totalDebit.eq(j.totalCredit)).toBe(true);
    expect(j.totalDebit.toFixed(2)).toBe('12600.00');
    expect(j.lines.map((l) => `${l.side} ${l.accountCode} ${l.amount.toFixed(2)}`)).toEqual([
      'debit 1141 10000.00', 'debit 1146 2600.00', 'credit 2115 12000.00', 'credit 2140 600.00',
    ]);
  });

  it('F02 supplier invoice with a tax invoice: GR/IR, variance, input VAT against AP', () => {
    const j = renderJournal(rule('F02'), {
      documentId: 'ap', documentNo: 'AP-1', documentDate: '2026-10-14', invoiceNo: 'INV1', partnerName: 'S', accounts, taxInvoice: true,
      subtotal: '12100.00', vatAmount: '847.00', total: '12947.00', grirValue: '12000.00', varianceValue: '100.00', expenseValue: '0.00',
    });
    expect(j.totalDebit.eq(j.totalCredit)).toBe(true);
    expect(j.lines.find((l) => l.accountCode === '1151')?.taxCode).toBe('input_vat');
    expect(j.lines.find((l) => l.accountCode === '1152')).toBeUndefined();
  });

  it('F02 without a tax invoice posts undue input VAT', () => {
    const j = renderJournal(rule('F02'), {
      documentId: 'ap', documentNo: 'AP-1', documentDate: '2026-10-14', invoiceNo: 'INV1', partnerName: 'S', accounts, taxInvoice: false,
      subtotal: '1000.00', vatAmount: '70.00', total: '1070.00', grirValue: '1000.00', varianceValue: '0.00', expenseValue: '0.00',
    });
    expect(j.lines.find((l) => l.accountCode === '1152')?.amount.toFixed(2)).toBe('70.00');
  });

  it('F03 payment withholds at payment; a reversal mirrors', () => {
    const payload = { documentId: 'pv', documentNo: 'PV-1', documentDate: '2026-10-15', partnerName: 'S', accounts, cashAccount: '1121', amount: '9700.00', wht3: '0.00', wht53: '300.00', whtBase3: '0.00', whtBase53: '10000.00' };
    const j = renderJournal(rule('F03'), payload);
    expect(j.lines.map((l) => `${l.side} ${l.accountCode} ${l.amount.toFixed(2)}`)).toEqual(['debit 2111 10000.00', 'credit 1121 9700.00', 'credit 2132 300.00']);
    const r = renderJournal(rule('F03'), { ...payload, amount: '-9700.00', wht53: '-300.00' });
    expect(r.lines.map((l) => `${l.side} ${l.accountCode}`)).toEqual(['credit 2111', 'debit 1121', 'debit 2132']);
  });

  it('F07 / F08 production: WIP in, finished goods out with the variance', () => {
    const issue = renderJournal(rule('F07'), { documentId: 'mo', documentNo: 'MO-1', documentDate: '2026-10-15', accounts, movements: [mv('-5000.00')], movementsValue: '-5000.00' });
    expect(issue.lines.map((l) => `${l.side} ${l.accountCode} ${l.amount.toFixed(2)}`)).toEqual(['debit 1142 5000.00', 'credit 1141 5000.00']);
    const done = renderJournal(rule('F08'), { documentId: 'mo', documentNo: 'MO-1', documentDate: '2026-10-16', accounts, receivedValue: '6200.00', materialsValue: '5000.00', labourValue: '600.00', overheadValue: '550.00' });
    expect(done.totalDebit.eq(done.totalCredit)).toBe(true);
    expect(done.lines.find((l) => l.accountCode === '5150')?.amount.toFixed(2)).toBe('50.00');
  });

  it('F10 / F11 / F12 / F13 sales cycle balance', () => {
    const base = { documentId: 'x', documentNo: 'X', documentDate: '2026-10-20', partnerName: 'C', accounts };
    const checks = [
      renderJournal(rule('F10'), { ...base, subtotal: '10000.00', vatAmount: '700.00', total: '10700.00' }),
      renderJournal(rule('F11'), { ...base, movements: [mv('-4000.00', '1143')], movementsValue: '-4000.00' }),
      renderJournal(rule('F12'), { ...base, cashAccount: '1110', amount: '10400.00', whtAmount: '300.00', whtBase: '10700.00' }),
      renderJournal(rule('F13'), { ...base, noteKindLabel: 'ใบลดหนี้', difference: '1000.00', vatAmount: '70.00', total: '1070.00', movements: [], movementsValue: '0.00' }),
    ];
    for (const j of checks) expect(j.totalDebit.eq(j.totalCredit) && j.totalDebit.gt(0)).toBe(true);
  });

  it('F16D disposal: gain or loss balances the entry', () => {
    const j = renderJournal(rule('F16D'), {
      documentId: 'fa', documentNo: 'FA-1', documentDate: '2026-10-31', assetName: 'M', accounts,
      assetAccount: '1230', accumulatedAccount: '1239', gainLossAccount: '4920', cashAccount: '1110', cost: '100000.00', accumulated: '60000.00', proceeds: '50000.00',
    });
    expect(j.totalDebit.eq(j.totalCredit)).toBe(true);
    expect(j.lines.find((l) => l.accountCode === '4920')?.side).toBe('credit'); // a 10,000 gain
  });
});

describe('E6 Packio revenue F14 / F15 (D-397)', () => {
  const base = { documentId: 'bs', documentNo: 'BS-2610-0001', documentDate: '2026-10-20', accounts };

  it('F14 a confirmed statement: receivable from Packio = job revenue + output VAT', () => {
    const j = renderJournal(rule('F14'), { ...base, net: '100000.00', vat: '7000.00', gross: '107000.00' });
    expect(j.totalDebit.toFixed(2)).toBe('107000.00');
    expect(j.totalDebit.eq(j.totalCredit)).toBe(true);
    expect(j.lines.find((l) => l.taxCode === 'output_vat')?.taxBase?.toFixed(2)).toBe('100000.00');
  });

  it('F15 a payout: bank + WHT withheld settle the receivable; a retention is not cash yet', () => {
    const j = renderJournal(rule('F15'), { ...base, kind: 'balance', cashAccount: '1112', cash: '97000.00', wht: '3000.00', whtBase: '100000.00', retention: '5000.00' });
    expect(j.totalDebit.eq(j.totalCredit)).toBe(true);
    expect(j.totalCredit.toFixed(2)).toBe('100000.00');
    expect(j.lines.find((l) => l.taxCode === 'wht_receivable')?.amount.toFixed(2)).toBe('3000.00');
  });
});

describe('E6 rule editor (D-398)', () => {
  const chart = new Map(CHART_TEMPLATE.map((a) => [a.code, { isPostable: a.postable !== false, status: 'active' }]));

  it('every template round-trips through the editor shape and has no problems', () => {
    for (const r of RULES_TEMPLATE) {
      const dto = templateToDto(r.template);
      expect([r.key, templateIssues(dto, RULE_VARIABLES[r.eventType] ?? [], chart)]).toEqual([r.key, []]);
      expect([r.key, templateFromDto(dto, r.template)]).toEqual([r.key, r.template]);
    }
  });

  it('every posting event names what its payload carries', () => {
    for (const r of RULES_TEMPLATE) expect([r.key, (RULE_VARIABLES[r.eventType] ?? []).length > 0]).toEqual([r.key, true]);
  });

  it('flags unknown accounts, paths, lists and bad formulas', () => {
    const issues = templateIssues(
      {
        description: 'x',
        lines: [
          { accountCode: '9999', side: 'debit', amount: 'goodsValue' },
          { accountPath: 'accounts.nope', side: 'credit', amount: 'goodsValue +' },
          { accountPath: 'item.inventoryAccount', side: 'credit', amount: 'unknownValue' },
          { forEach: 'lines', accountCode: '1141', accountPath: 'accounts.grir', side: 'debit', amount: '1' },
        ],
      },
      RULE_VARIABLES['erp_goods_receipt.posted']!,
      chart,
    );
    expect(issues).toEqual([
      'บรรทัด 1: ไม่มีบัญชี 9999 ในผังบัญชี',
      'บรรทัด 2: "accounts.nope" ไม่ใช่บัญชีที่เอกสารนี้ระบุ',
      expect.stringContaining('บรรทัด 2: จำนวนเงิน — สูตรไม่ถูกต้อง'),
      'บรรทัด 3: "item.inventoryAccount" ไม่ใช่บัญชีที่เอกสารนี้ระบุ',
      'บรรทัด 3: จำนวนเงิน อ่าน "unknownValue" ซึ่งเอกสารนี้ไม่มี',
      'บรรทัด 4: "lines" ไม่ใช่รายการที่เอกสารนี้มี',
      'บรรทัด 4: เลือกบัญชีคงที่ หรือบัญชีจากเอกสาร อย่างใดอย่างหนึ่ง',
    ]);
  });

  it('stores a condition with its payload prefix and typed value', () => {
    const t = templateFromDto({ description: 'd', lines: [{ when: { field: 'taxInvoice', op: 'eq', value: 'true' }, accountCode: '1150', side: 'debit', amount: 'vatAmount' }] }, null);
    expect(t.lines[0]!.when).toEqual({ field: 'payload.taxInvoice', op: 'eq', value: true });
  });
});

describe('E6 depreciation (D-393)', () => {
  const asset = { cost: d('120000'), salvage: d('0'), lifeMonths: 60, start: '2026-02-01', opening: d('0'), accumulated: d('0'), monthsDone: 0 };

  it('charges a straight-line month', () => {
    expect(monthlyDepreciation(d('120000'), d('0'), 60).toFixed(2)).toBe('2000.00');
    expect(depreciationDue({ ...asset, month: '2026-02' })).toEqual({ months: 1, amount: d('2000') });
  });

  it('catches up missed months and never starts early', () => {
    expect(depreciationDue({ ...asset, month: '2026-01' }).months).toBe(0);
    const due = depreciationDue({ ...asset, month: '2026-04' });
    expect([due.months, due.amount.toFixed(2)]).toEqual([3, '6000.00']);
  });

  it('the last month takes the remainder and stops at the base', () => {
    const odd = { ...asset, cost: d('1000'), lifeMonths: 3 };
    const first = depreciationDue({ ...odd, month: '2026-03' });
    expect(first.amount.toFixed(2)).toBe('666.66');
    const last = depreciationDue({ ...odd, accumulated: first.amount, monthsDone: 2, month: '2026-04' });
    expect(last.amount.toFixed(2)).toBe('333.34');
    expect(depreciationDue({ ...odd, accumulated: d('1000'), monthsDone: 3, month: '2026-09' }).months).toBe(0);
  });

  it('respects depreciation taken before the ledger (opening accumulated)', () => {
    const due = depreciationDue({ ...asset, opening: d('118000'), monthsDone: 59, month: '2031-01' });
    expect(due.amount.toFixed(2)).toBe('2000.00');
  });
});

describe('E6 bank lines (D-394)', () => {
  it('hashes the same line the same way and distinguishes repeats', () => {
    const r = { txnDate: '2026-10-12', amount: '-12500', description: 'โอน', reference: null };
    expect(Buffer.from(lineHash('b', r, 0)).equals(Buffer.from(lineHash('b', { ...r, amount: '-12500.00' }, 0)))).toBe(true);
    expect(Buffer.from(lineHash('b', r, 0)).equals(Buffer.from(lineHash('b', r, 1)))).toBe(false);
  });
});
