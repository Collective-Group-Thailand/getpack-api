import { renderQuoteDocument } from '@modules/quotes/quote-document';

import {
  approvalLevel,
  type ApprovalSnapshot,
  authorityColour,
  deciderLevel,
  type DiscountAuthority,
  negotiationHeavy,
  serializeWaterfall,
  snapshotKeeps,
  tierOf,
  waterfall,
  type WaterfallInput,
} from './discount-approval-rules';

const AUTH: DiscountAuthority = {
  repMaxPct: '3.00',
  managerMaxPct: '8.00',
  repMaxAmount: null,
  managerMaxAmount: null,
};
const level = (pct: string, margin: string, heavy = false, authority = AUTH, amount = '0') =>
  approvalLevel({
    discountPct: pct,
    discountAmount: amount,
    grossMarginPct: margin,
    floorPct: '10.00',
    authority,
    negotiationHeavy: heavy,
  });

const BASE: WaterfallInput = {
  listRevenue: '1080000.00',
  discountPct: '5',
  factoryCost: '936000.00',
  shippingCharged: '12000.00',
  shippingPaid: '9000.00',
  vatPct: '7',
  paymentFee: { method: 'bank_transfer', pct: null, fixedAmount: null, status: 'not_set' },
  freeServices: '0',
  commissionRatePct: '3.0000',
  minBase: '0.00',
  creditCost: '11399.00',
  badDebt: { pct: null, status: 'not_set' },
  floorPct: '10.00',
};

describe('discount approval rules (D-470)', () => {
  it('routes by discount % and the margin floor', () => {
    expect(level('3.00', '20')).toEqual({ baseLevel: 'rep', level: 'rep' });
    expect(level('3.01', '20').level).toBe('sales_manager');
    expect(level('8.00', '20').level).toBe('sales_manager');
    expect(level('8.01', '20').level).toBe('c_level');
    // Below the floor is always C-Level.
    expect(level('1.00', '9.99').level).toBe('c_level');
  });

  it('moves a negotiation-heavy customer one level up and keeps C-Level at the top', () => {
    expect(level('2.00', '20', true)).toEqual({ baseLevel: 'rep', level: 'sales_manager' });
    expect(level('5.00', '20', true).level).toBe('c_level');
    expect(level('9.00', '20', true).level).toBe('c_level');
  });

  it('applies the optional amount caps', () => {
    const capped = { ...AUTH, repMaxAmount: '1000.00', managerMaxAmount: '50000.00' };
    expect(level('2.00', '20', false, capped, '1000.00').level).toBe('rep');
    expect(level('2.00', '20', false, capped, '1000.01').level).toBe('sales_manager');
    expect(level('2.00', '20', false, capped, '50000.01').level).toBe('c_level');
  });

  it('maps levels to colours and roles to deciding levels', () => {
    expect(['rep', 'sales_manager', 'c_level'].map((l) => authorityColour(l as 'rep'))).toEqual([
      'green',
      'amber',
      'red',
    ]);
    expect(deciderLevel(['superadmin'])).toBe('c_level');
    expect(deciderLevel(['vp'])).toBeNull();
    expect(deciderLevel(['sales_manager', 'sales_rep'])).toBe('sales_manager');
    expect(deciderLevel(['sales_rep'])).toBe('rep');
  });

  it('flags negotiation-heavy on ≥ 2 rounds in ≥ 2 of the last 5 quotes', () => {
    const rule = { minRounds: 2, minQuotes: 2, lastQuotes: 5 };
    expect(negotiationHeavy([2, 1, 3, 1, 1], rule)).toBe(true);
    expect(negotiationHeavy([2, 1, 1, 1, 1, 3], rule)).toBe(false);
    expect(negotiationHeavy([], rule)).toBe(false);
  });

  it('computes the waterfall down to the contribution after commission', () => {
    const w = waterfall(BASE);
    expect(w).toMatchObject({
      listRevenue: '1080000.00',
      discountAmount: '54000.00',
      netRevenue: '1026000.00',
      factoryCost: '936000.00',
      shippingDifference: '3000.00',
      grossMargin: '93000.00',
      grossMarginPct: '9.06',
      commissionAmount: '30780.00',
      creditCost: '11399.00',
      creditCostPct: '1.11',
      contributionAfterCommission: '50821.00',
      contributionPct: '4.95',
      floorCheck: 'fail',
    });
    expect(w.paymentFee).toEqual({ method: 'bank_transfer', amount: '0.00', status: 'not_set' });
    const fee = waterfall({
      ...BASE,
      discountPct: '0',
      paymentFee: { method: 'card', pct: '2.00', fixedAmount: '5.00', status: 'set' },
    });
    // 2 % of the gross (1,092,000 × 1.07 = 1,168,440) + 5.
    expect(fee.paymentFee.amount).toBe('23373.80');
  });

  describe('field-level visibility', () => {
    const w = waterfall(BASE);
    const COST_OR_MARGIN = [
      'listRevenue',
      'discountAmount',
      'netRevenue',
      'factoryCost',
      'shippingDifference',
      'paymentFee',
      'freeServices',
      'grossMargin',
      'grossMarginPct',
      'commissionAmount',
      'commissionRatePct',
      'creditCost',
      'creditCostPct',
      'badDebtProvision',
      'contributionAfterCommission',
      'contributionPct',
    ];

    it('gives a rep only the authority colour — every cost and margin field is ABSENT', () => {
      const v = serializeWaterfall(w, 'sales_manager', tierOf(new Set(['sales.pipeline.self'])));
      expect(v).toEqual({ visibility: 'authority', authorityLevel: 'amber' });
      for (const key of [...COST_OR_MARGIN, 'floorPct', 'floorCheck']) expect(v).not.toHaveProperty(key);
    });

    it('gives a sales manager margin % only — no amounts', () => {
      const v = serializeWaterfall(w, 'rep', tierOf(new Set(['discount_approvals.margin_pct'])));
      expect(Object.keys(v).sort()).toEqual([
        'authorityLevel',
        'contributionPct',
        'discountPct',
        'floorCheck',
        'floorPct',
        'grossMarginPct',
        'visibility',
      ]);
      for (const key of COST_OR_MARGIN.filter((k) => !k.endsWith('Pct'))) expect(v).not.toHaveProperty(key);
    });

    it('gives the full waterfall to holders of discount_approvals.waterfall_full', () => {
      const v = serializeWaterfall(
        w,
        'c_level',
        tierOf(new Set(['discount_approvals.margin_pct', 'discount_approvals.waterfall_full'])),
      );
      expect(v).toMatchObject({ visibility: 'full', authorityLevel: 'red', factoryCost: '936000.00' });
    });
  });

  it('voids on a change of lines, quantities or terms; keeps a re-quote after expiry above the floor', () => {
    const snap: ApprovalSnapshot = {
      quoteId: 'q',
      lines: [{ optionId: 'o', quantity: 5000, buyCost: '900.00', shippingPaid: '10.00', net: '1500.00' }],
      terms: { requestedPct: '5.0000', giveGetSha256: 'ab', paymentTemplate: null, creditDays: null },
    };
    const ctx = { requoteAfterExpiry: false, marginAtTodayPct: '20', floorPct: '10' };
    expect(snapshotKeeps(snap, { ...snap }, ctx)).toBe(true);
    const costUp = { ...snap, lines: [{ ...snap.lines[0]!, buyCost: '950.00' }] };
    expect(snapshotKeeps(snap, costUp, ctx)).toBe(false);
    expect(snapshotKeeps(snap, costUp, { ...ctx, requoteAfterExpiry: true })).toBe(true);
    expect(snapshotKeeps(snap, costUp, { ...ctx, requoteAfterExpiry: true, marginAtTodayPct: '9' })).toBe(
      false,
    );
    const qty = { ...snap, lines: [{ ...snap.lines[0]!, quantity: 6000 }] };
    expect(snapshotKeeps(snap, qty, { ...ctx, requoteAfterExpiry: true })).toBe(false);
    const terms = { ...snap, terms: { ...snap.terms, creditDays: 30 } };
    expect(snapshotKeeps(snap, terms, { ...ctx, requoteAfterExpiry: true })).toBe(false);
  });
});

describe('discounted quotation PDF (D-470)', () => {
  it('prints the discount and the conditions line', () => {
    const html = renderQuoteDocument({
      issuer: {
        legalNameTh: null,
        legalNameEn: null,
        taxId: null,
        branchCode: null,
        addressTh: null,
        phone: null,
      },
      quoteCode: 'QT-1',
      issuedOn: '2026-11-03',
      validUntil: '2026-11-10',
      customerName: null,
      productTypeName: 'กล่อง',
      specification: '',
      deliveryPostcode: null,
      lines: [],
      validityDays: 7,
      conditions: {
        discountPct: '5.00',
        discountAmount: '54000.00',
        th: 'ราคานี้สำหรับ 8,000 ชิ้น · มัดจำ 50% · สั่งภายใน 10/11/2569',
        en: 'This price is for 8,000 pieces',
      },
    });
    expect(html).toContain('ส่วนลด 5% (54,000.00 บาท ก่อน VAT)');
    expect(html).toContain('มัดจำ 50%');
  });
});
