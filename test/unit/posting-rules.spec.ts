import { accountCodesOf, renderJournal, ruleApplies, validateTemplate } from '@common/ledger-core/template';
import { formatMoney, MoneyDecimal } from '@common/money/money';
import fc from 'fast-check';

import { CHART_OF_ACCOUNTS } from '../../prisma/seed/data/finance-accounts';
import { CUSTOMER_POSTING_RULES } from '../../prisma/seed/data/posting-rules-customer';
import { type PostingRuleSeed } from '../../prisma/seed/data/posting-rules-shared';
import { VENDOR_POSTING_RULES } from '../../prisma/seed/data/posting-rules-vendor';

/**
 * Fixture test per default posting rule (B5.1, accounting-design §5): the event fixture produces a balanced
 * entry on the expected accounts with the expected tax-report lines. Plus a property test: every fixture
 * shape with random amounts balances.
 */
const RULES: PostingRuleSeed[] = [...CUSTOMER_POSTING_RULES, ...VENDOR_POSTING_RULES];
const rule = (key: string) => RULES.find((r) => r.key === key)!;

const IDS = {
  doc: '0192f3a0-0000-7000-8000-000000000001',
  order: '0192f3a0-0000-7000-8000-000000000002',
  customer: '0192f3a0-0000-7000-8000-000000000003',
  vendor: '0192f3a0-0000-7000-8000-000000000004',
};

type Line = [account: string, side: 'dr' | 'cr', amount: string, taxCode?: string, taxBase?: string];

interface Fixture {
  payload: Record<string, unknown>;
  lines: Line[];
}

const doc = (extra: Record<string, unknown>) => ({
  documentId: IDS.doc,
  docNumber: 'TR256910-00001',
  documentDate: '2026-10-05',
  orderId: IDS.order,
  customerId: IDS.customer,
  channel: 'web',
  ...extra,
});
const instalment = (receiptVia: string) =>
  doc({
    docType: 'tr',
    docKind: 'instalment',
    receiptVia,
    netAmount: '1000.00',
    vatAmount: '70.00',
    grossAmount: '1070.00',
    whtAmount: '30.00',
    whtBase: '1000.00',
    cashAmount: '1040.00',
  });
const payout = (kind: string, extra: Record<string, unknown>) => ({
  kind,
  payoutItemId: IDS.doc,
  pvNumber: 'PV256911-0001',
  paidOn: '2026-11-20',
  vendorId: IDS.vendor,
  bankAccountCode: '1121',
  whtForm: 'pnd53',
  ...extra,
});

const FIXTURES: Record<string, Fixture> = {
  P01: {
    payload: instalment('scb'),
    lines: [
      ['1132', 'dr', '1070.00'],
      ['2310', 'cr', '1000.00'],
      ['2210', 'cr', '70.00', 'output_vat', '1000.00'],
    ],
  },
  P02: {
    payload: instalment('slip'),
    lines: [
      ['1133', 'dr', '1070.00'],
      ['2310', 'cr', '1000.00'],
      ['2210', 'cr', '70.00', 'output_vat', '1000.00'],
    ],
  },
  P03: {
    payload: instalment('scb'),
    lines: [
      ['1230', 'dr', '30.00', 'wht_receivable', '1000.00'],
      ['1132', 'cr', '30.00'],
    ],
  },
  P04: {
    payload: {
      provider: 'scb',
      settlementId: IDS.doc,
      settlementDate: '2026-10-06',
      grossAmount: '10000.00',
      feeAmount: '150.00',
      vatOnFee: '10.50',
      feeVatClaimable: true,
      netAmount: '9839.50',
      bankAccountCode: '1121',
    },
    lines: [
      ['1121', 'dr', '9839.50'],
      ['6110', 'dr', '150.00'],
      ['1241', 'dr', '10.50', 'input_vat', '150.00'],
      ['1132', 'cr', '10000.00'],
    ],
  },
  P05: {
    payload: {
      matchKind: 'slip',
      statementLineId: IDS.doc,
      txnDate: '2026-10-06',
      reference: 'X1',
      amount: '500.00',
      bankAccountCode: '1121',
    },
    lines: [
      ['1121', 'dr', '500.00'],
      ['1133', 'cr', '500.00'],
    ],
  },
  P06: {
    payload: doc({
      docType: 'tr',
      docKind: 'final',
      appliedAdvanceNet: '500.00',
      remainingNet: '500.00',
      remainingVat: '35.00',
      remainingGross: '535.00',
      revenue: [
        { category: 'made_to_order', net: '900.00' },
        { category: 'shipping', net: '100.00' },
      ],
      discountTotal: '0.00',
    }),
    lines: [
      ['2310', 'dr', '500.00'],
      ['1210', 'dr', '535.00'],
      ['4110', 'cr', '900.00'],
      ['4150', 'cr', '100.00'],
      ['2210', 'cr', '35.00', 'output_vat', '500.00'],
    ],
  },
  P07: {
    payload: doc({
      docType: 'iv',
      docKind: 'delivery',
      vatDue: false,
      appliedAdvanceNet: '0.00',
      remainingNet: '1000.00',
      remainingVat: '70.00',
      remainingGross: '1070.00',
      revenue: [{ category: 'made_to_order', net: '1000.00' }],
      discountTotal: '0.00',
    }),
    lines: [
      ['1210', 'dr', '1070.00'],
      ['4110', 'cr', '1000.00'],
      ['2211', 'cr', '70.00', 'output_vat_not_due', '1000.00'],
    ],
  },
  P07D: {
    payload: doc({ docType: 'dn', netAmount: '100.00', vatAmount: '7.00', grossAmount: '107.00' }),
    lines: [
      ['1210', 'dr', '107.00'],
      ['4160', 'cr', '100.00'],
      ['2210', 'cr', '7.00', 'output_vat', '100.00'],
    ],
  },
  P08: {
    payload: doc({
      docType: 'rc',
      receiptVia: 'bank',
      grossAmount: '1070.00',
      whtAmount: '0.00',
      vatNotDueAmount: '70.00',
      vatNotDueBase: '1000.00',
    }),
    lines: [
      ['1133', 'dr', '1070.00'],
      ['1210', 'cr', '1070.00'],
      ['2211', 'dr', '70.00', 'output_vat_not_due', '1000.00'],
      ['2210', 'cr', '70.00', 'output_vat', '1000.00'],
    ],
  },
  P09: {
    payload: doc({
      docType: 'tr',
      docKind: 'final',
      discountTotal: '150.00',
      discounts: [
        { source: 'coupon', category: 'made_to_order', amount: '100.00' },
        { source: 'points_redemption', category: 'made_to_order', amount: '50.00' },
      ],
    }),
    lines: [
      ['4910', 'dr', '100.00'],
      ['4930', 'dr', '50.00'],
      ['4110', 'cr', '100.00'],
      ['4110', 'cr', '50.00'],
    ],
  },
  P10: {
    payload: {
      userId: IDS.customer,
      entryId: IDS.doc,
      points: 4,
      bahtValue: '10.00',
      expectedRedemptionRatePct: '80',
    },
    lines: [
      ['6120', 'dr', '8.00'],
      ['2330', 'cr', '8.00'],
    ],
  },
  P10A: {
    payload: {
      userId: IDS.customer,
      entryId: IDS.doc,
      points: -2,
      signedBahtValue: '-5.00',
      expectedRedemptionRatePct: '100',
    },
    lines: [
      ['6120', 'cr', '5.00'],
      ['2330', 'dr', '5.00'],
    ],
  },
  P10R: {
    payload: {
      userId: IDS.customer,
      entryId: IDS.doc,
      points: 2,
      earningStatus: 'available',
      bahtValue: '5.00',
      expectedRedemptionRatePct: '100',
    },
    lines: [
      ['2330', 'dr', '5.00'],
      ['6120', 'cr', '5.00'],
    ],
  },
  P11: {
    payload: { userId: IDS.customer, entryId: IDS.doc, points: 8, bahtValue: '20.00' },
    lines: [
      ['2330', 'dr', '20.00'],
      ['4930', 'cr', '20.00'],
    ],
  },
  P11R: {
    payload: { userId: IDS.customer, entryId: IDS.doc, points: 8, bahtValue: '20.00', orderId: IDS.order },
    lines: [
      ['4930', 'dr', '20.00'],
      ['2330', 'cr', '20.00'],
    ],
  },
  P12: {
    payload: {
      userId: IDS.customer,
      entryId: IDS.doc,
      points: 4,
      bahtValue: '10.00',
      expectedRedemptionRatePct: '100',
    },
    lines: [
      ['2330', 'dr', '10.00'],
      ['4990', 'cr', '10.00'],
    ],
  },
  P13: { payload: { poKind: 'production', poNumber: 'PO2026-0001' }, lines: [] },
  P14: {
    payload: payout('advance', {
      apNet: '300.00',
      vatAmount: '21.00',
      vatClaimable: false,
      cashAmount: '312.00',
      whtAmount: '9.00',
      whtBase: '300.00',
    }),
    lines: [
      ['1250', 'dr', '300.00'],
      ['1242', 'dr', '21.00', 'input_vat_pending', '300.00'],
      ['1121', 'cr', '312.00'],
      ['2231', 'cr', '9.00', 'wht_pnd53', '300.00'],
    ],
  },
  P15: {
    payload: {
      goodsReceiptId: IDS.doc,
      grNumber: 'GR2026-0001',
      receivedOn: '2026-11-10',
      vendorId: IDS.vendor,
      productionNet: '800.00',
      shippingNet: '40.00',
      otherNet: '0.00',
    },
    lines: [
      ['5110', 'dr', '800.00'],
      ['5120', 'dr', '40.00'],
      ['2110', 'cr', '840.00'],
    ],
  },
  P16: {
    payload: {
      purchaseOrderId: IDS.doc,
      poNumber: 'PO2026-0001',
      appliedOn: '2026-11-10',
      vendorId: IDS.vendor,
      amount: '300.00',
    },
    lines: [
      ['2110', 'dr', '300.00'],
      ['1250', 'cr', '300.00'],
    ],
  },
  P17: {
    payload: payout('balance', {
      apNet: '540.00',
      vatAmount: '37.80',
      vatClaimable: true,
      whtAmount: '16.20',
      whtBase: '540.00',
      retentionAmount: '44.94',
      cashAmount: '516.66',
    }),
    lines: [
      ['2110', 'dr', '540.00'],
      ['1241', 'dr', '37.80', 'input_vat', '540.00'],
      ['1121', 'cr', '516.66'],
      ['2231', 'cr', '16.20', 'wht_pnd53', '540.00'],
      ['2130', 'cr', '44.94'],
    ],
  },
  P17V: {
    payload: {
      vendorInvoiceId: IDS.doc,
      vendorInvoiceNo: 'INV-9',
      invoiceDate: '2026-11-12',
      vendorId: IDS.vendor,
      pendingVatToClaim: '21.00',
      pendingVatBase: '300.00',
    },
    lines: [
      ['1241', 'dr', '21.00', 'input_vat', '300.00'],
      ['1242', 'cr', '21.00', 'input_vat_pending', '300.00'],
    ],
  },
  P18: {
    payload: payout('retention_release', { retentionAmount: '44.94', cashAmount: '44.94' }),
    lines: [
      ['2130', 'dr', '44.94'],
      ['1121', 'cr', '44.94'],
    ],
  },
  P19: {
    payload: doc({
      docType: 'cn',
      cnKind: 'shortage',
      revenueStage: 'recognised',
      vatStage: 'due',
      settleTo: 'store_credit',
      netAmount: '10.00',
      vatAmount: '0.70',
      grossAmount: '10.70',
    }),
    lines: [
      ['4920', 'dr', '10.00'],
      ['2210', 'dr', '0.70', 'output_vat', '10.00'],
      ['2320', 'cr', '10.70'],
    ],
  },
  P20: {
    payload: {
      deductionId: IDS.doc,
      claimNo: 'CL-1',
      recordedOn: '2026-11-15',
      vendorId: IDS.vendor,
      offsetAgainst: 'payable',
      amount: '200.00',
    },
    lines: [
      ['2110', 'dr', '200.00'],
      ['5190', 'cr', '200.00'],
    ],
  },
  P21: {
    payload: { claimId: IDS.doc, claimNo: 'CL-2', recordedOn: '2026-11-15', amount: '150.00' },
    lines: [
      ['1270', 'dr', '150.00'],
      ['5190', 'cr', '150.00'],
    ],
  },
  P22: {
    payload: {
      refundId: IDS.doc,
      reference: 'RF-1',
      paidOn: '2026-11-16',
      refundFrom: 'credit_balance',
      paidVia: 'twoc2p',
      amount: '10.70',
      customerId: IDS.customer,
    },
    lines: [
      ['2320', 'dr', '10.70'],
      ['1131', 'cr', '10.70'],
    ],
  },
  P23: {
    payload: doc({
      docType: 'cn',
      cnKind: 'cancellation',
      netAmount: '500.00',
      vatAmount: '35.00',
      grossAmount: '535.00',
    }),
    lines: [
      ['2310', 'dr', '500.00'],
      ['2210', 'dr', '35.00', 'output_vat', '500.00'],
      ['2320', 'cr', '535.00'],
    ],
  },
  P23F: {
    payload: {
      orderId: IDS.order,
      orderCode: 'O-1',
      documentDate: '2026-10-20',
      customerId: IDS.customer,
      netAmount: '100.00',
    },
    lines: [
      ['2310', 'dr', '100.00'],
      ['4990', 'cr', '100.00'],
    ],
  },
  P24: { payload: { poKind: 'reproduction', poNumber: 'PO2026-0002' }, lines: [] },
  P25: {
    payload: {
      vendorKind: 'carrier',
      vendorInvoiceId: IDS.doc,
      vendorInvoiceNo: 'FL-1',
      invoiceDate: '2026-11-01',
      vendorId: IDS.vendor,
      lines: [{ accountCode: '5130', net: '100.00' }],
      netAmount: '100.00',
      vatAmount: '7.00',
      grossAmount: '107.00',
      vatClaimable: true,
    },
    lines: [
      ['5130', 'dr', '100.00'],
      ['1241', 'dr', '7.00', 'input_vat', '100.00'],
      ['2120', 'cr', '107.00'],
    ],
  },
  P25P: {
    payload: payout('vendor_bill', {
      apNet: '100.00',
      vatAmount: '7.00',
      cashAmount: '106.00',
      whtAmount: '1.00',
      whtBase: '100.00',
    }),
    lines: [
      ['2120', 'dr', '107.00'],
      ['1121', 'cr', '106.00'],
      ['2231', 'cr', '1.00', 'wht_pnd53', '100.00'],
    ],
  },
  P26: {
    payload: {
      vendorKind: 'freelancer',
      vendorInvoiceId: IDS.doc,
      vendorInvoiceNo: 'DS-1',
      invoiceDate: '2026-11-01',
      vendorId: IDS.vendor,
      lines: [{ accountCode: '5140', net: '1000.00' }],
      netAmount: '1000.00',
      vatAmount: '0.00',
      grossAmount: '1000.00',
      vatClaimable: false,
    },
    lines: [
      ['5140', 'dr', '1000.00'],
      ['2120', 'cr', '1000.00'],
    ],
  },
  P27: {
    payload: {
      taxReportId: IDS.doc,
      periodLabel: '2026-10',
      closedOn: '2026-10-31',
      outputVat: '700.00',
      outputBase: '10000.00',
      inputVat: '560.00',
      inputBase: '8000.00',
    },
    lines: [
      ['2210', 'dr', '700.00', 'output_vat', '10000.00'],
      ['1241', 'cr', '560.00', 'input_vat', '8000.00'],
      ['2220', 'cr', '140.00'],
    ],
  },
  P27P: {
    payload: {
      taxReportId: IDS.doc,
      periodLabel: '2026-10',
      paidOn: '2026-11-15',
      amount: '140.00',
      bankAccountCode: '1121',
    },
    lines: [
      ['2220', 'dr', '140.00'],
      ['1121', 'cr', '140.00'],
    ],
  },
  P28: {
    payload: {
      taxReportId: IDS.doc,
      periodLabel: '2026-11',
      paidOn: '2026-12-07',
      whtForm: 'pnd53',
      amount: '9.00',
      base: '300.00',
      bankAccountCode: '1121',
    },
    lines: [
      ['2231', 'dr', '9.00', 'wht_pnd53', '300.00'],
      ['1121', 'cr', '9.00'],
    ],
  },
  P29: {
    payload: {
      receiptId: IDS.doc,
      reference: 'BANK-77',
      receivedOn: '2026-10-07',
      receivedVia: 'statement',
      receivedIntoAccountCode: '1121',
      amount: '500.00',
    },
    lines: [
      ['1121', 'dr', '500.00'],
      ['1140', 'cr', '500.00'],
    ],
  },
  AG01: {
    payload: {
      statementId: IDS.doc,
      statementNo: 'AG2610-K7QX2MAP',
      agentKind: 'employee',
      approvedOn: '2026-11-01',
      totalAmount: '2350.00',
    },
    lines: [
      ['6160', 'dr', '2350.00'],
      ['2410', 'cr', '2350.00'],
    ],
  },
  P01X: {
    payload: {
      paymentId: IDS.doc,
      reference: 'PAY-1',
      receivedOn: '2026-10-05',
      receiptVia: 'scb',
      amount: '50.00',
      customerId: IDS.customer,
    },
    lines: [
      ['1132', 'dr', '50.00'],
      ['2340', 'cr', '50.00'],
    ],
  },
  P30: {
    payload: { provisionId: IDS.doc, periodLabel: '2026-12', provisionedOn: '2026-12-31', amount: '1000.00' },
    lines: [
      ['6130', 'dr', '1000.00'],
      ['1219', 'cr', '1000.00'],
    ],
  },
  P30W: {
    payload: {
      receivableItemId: IDS.doc,
      docNumber: 'IV-1',
      writtenOffOn: '2027-01-31',
      customerId: IDS.customer,
      amount: '500.00',
    },
    lines: [
      ['1219', 'dr', '500.00'],
      ['1210', 'cr', '500.00'],
    ],
  },
  FA01: {
    payload: {
      source: 'manual',
      assetId: IDS.doc,
      assetNo: 'FA-0001',
      acquiredOn: '2026-10-01',
      assetAccountCode: '1520',
      creditAccountCode: '2410',
      cost: '30000.00',
    },
    lines: [
      ['1520', 'dr', '30000.00'],
      ['2410', 'cr', '30000.00'],
    ],
  },
  FA02: {
    payload: {
      runId: IDS.doc,
      periodLabel: '2026-10',
      runOn: '2026-10-31',
      lines: [{ expenseAccountCode: '6150', accumulatedAccountCode: '1521', amount: '833.33' }],
    },
    lines: [
      ['6150', 'dr', '833.33'],
      ['1521', 'cr', '833.33'],
    ],
  },
  FA03: {
    payload: {
      assetId: IDS.doc,
      assetNo: 'FA-0001',
      disposedOn: '2027-06-30',
      cost: '30000.00',
      accumulated: '20000.00',
      proceeds: '15000.00',
      assetAccountCode: '1520',
      accumulatedAccountCode: '1521',
      proceedsAccountCode: '1121',
      gainLossAccountCode: '6910',
    },
    lines: [
      ['1521', 'dr', '20000.00'],
      ['1121', 'dr', '15000.00'],
      ['6910', 'cr', '5000.00'],
      ['1520', 'cr', '30000.00'],
    ],
  },
};

const rendered = (key: string, payload: Record<string, unknown>) =>
  renderJournal(rule(key).template, payload).lines.map((l): Line => {
    const out: Line = [l.accountCode, l.side === 'debit' ? 'dr' : 'cr', formatMoney(l.amount)];
    if (l.taxCode) out.push(l.taxCode, l.taxBase ? formatMoney(l.taxBase) : '');
    return out;
  });

describe('default posting rules (B5.1, accounting-design §5)', () => {
  it('seed P01–P30 plus the supplementary rules, each with a valid template on known accounts', () => {
    const keys = RULES.map((r) => r.key);
    for (let n = 1; n <= 30; n++) expect(keys).toContain(`P${String(n).padStart(2, '0')}`);
    expect(new Set(keys).size).toBe(keys.length);
    const codes = new Set(CHART_OF_ACCOUNTS.filter((a) => a.postable !== false).map((a) => a.code));
    for (const r of RULES) {
      expect({ key: r.key, problems: validateTemplate(r.template) }).toEqual({ key: r.key, problems: [] });
      for (const code of accountCodesOf(r.template))
        expect({ key: r.key, code, known: codes.has(code) }).toEqual({ key: r.key, code, known: true });
    }
  });

  it('has a fixture for every rule', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(RULES.map((r) => r.key).sort());
  });

  it.each(Object.keys(FIXTURES))(
    '%s: its event fixture applies and posts the expected balanced lines',
    (key) => {
      const fixture = FIXTURES[key]!;
      expect(ruleApplies(rule(key).conditions, fixture.payload)).toBe(true);
      const journal = renderJournal(rule(key).template, fixture.payload);
      expect(journal.totalDebit.eq(journal.totalCredit)).toBe(true);
      expect(rendered(key, fixture.payload)).toEqual(fixture.lines);
    },
  );

  it('routes each customer document to the right rules only', () => {
    const applying = (payload: Record<string, unknown>) =>
      RULES.filter(
        (r) => r.eventType === 'customer_document.issued' && ruleApplies(r.conditions, payload),
      ).map((r) => r.key);
    expect(applying(FIXTURES['P01']!.payload)).toEqual(['P01', 'P03']);
    expect(applying({ ...FIXTURES['P02']!.payload, whtAmount: '0.00' })).toEqual(['P02']);
    expect(applying(FIXTURES['P06']!.payload)).toEqual(['P06']);
    // A final TR of a withholding customer restates earlier withholding; it is not a receipt (no P03).
    expect(applying({ ...FIXTURES['P06']!.payload, whtAmount: '30.00', receiptVia: null })).toEqual(['P06']);
    expect(applying(FIXTURES['P09']!.payload)).toEqual(['P06', 'P09']);
    expect(applying(FIXTURES['P07']!.payload)).toEqual(['P07']);
    expect(applying(FIXTURES['P08']!.payload)).toEqual(['P08']);
    expect(applying({ ...FIXTURES['P08']!.payload, whtAmount: '30.00' })).toEqual(['P03', 'P08']);
    expect(applying(FIXTURES['P19']!.payload)).toEqual(['P19']);
    expect(applying(FIXTURES['P23']!.payload)).toEqual(['P23']);
    expect(applying(FIXTURES['P07D']!.payload)).toEqual(['P07D']);
    // Payouts: one rule per kind.
    const payoutRules = (kind: string) =>
      RULES.filter((r) => r.eventType === 'payout_item.paid' && ruleApplies(r.conditions, { kind })).map(
        (r) => r.key,
      );
    expect(['advance', 'balance', 'retention_release', 'vendor_bill'].map(payoutRules)).toEqual([
      ['P14'],
      ['P17'],
      ['P18'],
      ['P25P'],
    ]);
  });

  it('accrues employee commission only (AG01); freelance statements post through their bill (D-420)', () => {
    expect(
      ruleApplies(rule('AG01').conditions, { ...FIXTURES['AG01']!.payload, agentKind: 'freelance' }),
    ).toBe(false);
  });

  it('credits ภ.ง.ด.1 withholding on agent commission to 2233 (P25P, D-421)', () => {
    const payload = { ...FIXTURES['P25P']!.payload, whtForm: 'pnd1' };
    expect(rendered('P25P', payload).find((l) => l[1] === 'cr' && l[3] === 'wht_pnd1')?.[0]).toBe('2233');
  });

  it('posts a sample credit as a sales discount (P09 → 4910, D-257)', () => {
    const payload = {
      ...FIXTURES['P09']!.payload,
      discountTotal: '856.00',
      discounts: [{ source: 'sample_credit', category: 'made_to_order', amount: '856.00' }],
    };
    const journal = renderJournal(rule('P09').template, payload);
    expect(journal.totalDebit.eq(journal.totalCredit)).toBe(true);
    expect(rendered('P09', payload)).toEqual([
      ['4910', 'dr', '856.00'],
      ['4110', 'cr', '856.00'],
    ]);
  });

  it('never posts pending points or memo commitments', () => {
    expect(ruleApplies(rule('P10R').conditions, { earningStatus: 'pending' })).toBe(false);
    expect(renderJournal(rule('P13').template, FIXTURES['P13']!.payload).lines).toEqual([]);
    expect(ruleApplies(rule('P13').conditions, { poKind: 'reproduction' })).toBe(false);
  });

  it('posts a VAT credit (input above output) on the debit side of 2220', () => {
    const lines = rendered('P27', {
      outputVat: '100.00',
      outputBase: '1428.57',
      inputVat: '300.00',
      inputBase: '4285.71',
    });
    expect(lines).toContainEqual(['2220', 'dr', '200.00']);
  });
});

// --- property test: every fixture shape balances for any amounts ---------------------------------------------

const cents = fc.integer({ min: 0, max: 50_000_000 }).map((c) => new MoneyDecimal(c).div(100));
const pct = fc.constantFrom('0', '1', '3', '5', '7');
const m = (v: InstanceType<typeof MoneyDecimal>) => formatMoney(v);
const vatOf = (net: InstanceType<typeof MoneyDecimal>, rate: string) =>
  new MoneyDecimal(m(net.mul(rate).div(100)));

describe('posting rules balance for any amounts (property)', () => {
  const balanced = (key: string, payload: Record<string, unknown>) => {
    const j = renderJournal(rule(key).template, payload);
    return j.totalDebit.eq(j.totalCredit);
  };

  it('instalment receipts with withholding (P01, P02, P03)', () => {
    fc.assert(
      fc.property(
        cents,
        pct,
        pct,
        fc.constantFrom('scb', 'twoc2p', 'slip', 'bank', 'unidentified', 'store_credit'),
        (net, vat, wht, via) => {
          const v = vatOf(net, vat);
          const w = new MoneyDecimal(m(net.mul(wht).div(100)));
          const payload = instalment(via);
          Object.assign(payload, {
            netAmount: m(net),
            vatAmount: m(v),
            grossAmount: m(net.add(v)),
            whtAmount: m(w),
            whtBase: m(net),
          });
          return ['P01', 'P02', 'P03'].every((k) => balanced(k, payload));
        },
      ),
    );
  });

  it('delivery documents with any split of instalments, remainder and discounts (P06, P07, P09)', () => {
    fc.assert(
      fc.property(
        fc.array(cents, { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 100 }),
        pct,
        fc.boolean(),
        (nets, paidPct, vat, vatDue) => {
          const total = nets.reduce((a, n) => a.add(n), new MoneyDecimal(0));
          const applied = new MoneyDecimal(m(total.mul(paidPct).div(100)));
          const remainingNet = total.sub(applied);
          const remainingVat = vatOf(remainingNet, vat);
          const revenue = nets.map((n, i) => ({ category: i % 2 ? 'shipping' : 'made_to_order', net: m(n) }));
          const discounts = nets.map((n, i) => ({
            source: i % 2 ? 'coupon' : 'points_redemption',
            category: 'made_to_order',
            amount: m(n.div(10)),
          }));
          const payload = doc({
            appliedAdvanceNet: m(applied),
            remainingNet: m(remainingNet),
            remainingVat: m(remainingVat),
            remainingGross: m(remainingNet.add(remainingVat)),
            revenue,
            discounts,
            discountTotal: '1.00',
            vatDue,
          });
          return ['P06', 'P07', 'P09'].every((k) => balanced(k, payload));
        },
      ),
    );
  });

  it('factory payouts: advance, balance with retention, vendor bills (P14, P17, P25P)', () => {
    fc.assert(
      fc.property(
        cents,
        pct,
        pct,
        fc.integer({ min: 0, max: 10 }),
        fc.boolean(),
        (net, vat, wht, retPct, claimable) => {
          const v = vatOf(net, vat);
          const w = new MoneyDecimal(m(net.mul(wht).div(100)));
          const r = new MoneyDecimal(m(net.add(v).mul(retPct).div(100)));
          const cash = net.add(v).sub(w).sub(r);
          const base = {
            apNet: m(net),
            vatAmount: m(v),
            whtAmount: m(w),
            whtBase: m(net),
            vatClaimable: claimable,
          };
          return (
            balanced('P14', payout('advance', { ...base, cashAmount: m(net.add(v).sub(w)) })) &&
            balanced('P17', payout('balance', { ...base, retentionAmount: m(r), cashAmount: m(cash) })) &&
            balanced('P25P', payout('vendor_bill', { ...base, cashAmount: m(net.add(v).sub(w)) }))
          );
        },
      ),
    );
  });

  it('every other rule balances on its fixture with amounts scaled', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), (factor) => {
        const scale = (value: unknown): unknown => {
          if (typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value))
            return m(new MoneyDecimal(value).mul(factor));
          if (Array.isArray(value)) return value.map(scale);
          if (value && typeof value === 'object')
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scale(v)]));
          return value;
        };
        return Object.entries(FIXTURES).every(([key, f]) =>
          balanced(key, scale(f.payload) as Record<string, unknown>),
        );
      }),
      { numRuns: 50 },
    );
  });
});
