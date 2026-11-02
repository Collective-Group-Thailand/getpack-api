import * as deals from './agent-deals.service';
import {
  buildOptions,
  commissionAt,
  conditionsLine,
  discountedBase,
  type GiveGet,
  giveGetSha256,
  givesSomething,
  OfferError,
  quotedBase,
  roundRefusal,
} from './agent-discount-rules';

const NONE: GiveGet = {
  quantityChange: null,
  commitment: 'one_off',
  commitmentMonths: null,
  depositPct: null,
  cashWithinDays: null,
  leadTimeFlexDays: null,
  specChange: null,
};
const CTX = { base: '1000000.00', standardRatePct: '6.0000', minBase: '0.00' };
const problem = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as OfferError).problem;
  }
  return null;
};

describe('give-get (D-468, PLAN A-10)', () => {
  it('needs the customer to give something', () => {
    expect(givesSomething(NONE)).toBe(false);
    expect(givesSomething({ ...NONE, depositPct: '50' })).toBe(true);
    expect(givesSomething({ ...NONE, commitment: 'call_off', commitmentMonths: 6 })).toBe(true);
    expect(givesSomething({ ...NONE, specChange: '  ' })).toBe(false);
  });

  it('hashes the same terms the same way (decimals and spacing normalised)', () => {
    const a = giveGetSha256({ ...NONE, depositPct: '50', specChange: 'ลด  สี' });
    const b = giveGetSha256({ ...NONE, depositPct: '50.0000', specChange: 'ลด สี' });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(giveGetSha256({ ...NONE, depositPct: '40' }))).toBe(false);
  });

  it('allows one round per quote unless the give-get changed, never two open', () => {
    const first = giveGetSha256({ ...NONE, quantityChange: 8000 });
    expect(roundRefusal([], first)).toBeNull();
    expect(roundRefusal([{ status: 'open', giveGetSha256: first }], first)).toBe(
      'quotes.discount_request_open',
    );
    expect(roundRefusal([{ status: 'offered', giveGetSha256: first }], first)).toBe(
      'quotes.discount_round_limit',
    );
    expect(roundRefusal([{ status: 'rejected', giveGetSha256: first }], first)).toBe(
      'quotes.discount_round_limit',
    );
    const changed = giveGetSha256({ ...NONE, quantityChange: 8000, cashWithinDays: 7 });
    expect(roundRefusal([{ status: 'offered', giveGetSha256: first }], changed)).toBeNull();
  });
});

describe('commission at a discounted price (decimal.js)', () => {
  it('takes shipping off the quoted net and rounds half-up', () => {
    expect(quotedBase({ netAmount: '10530.00', shippingNetAmount: '530.00' })).toBe('10000.00');
    expect(quotedBase({ netAmount: '100.00', shippingNetAmount: null })).toBe('100.00');
    expect(discountedBase('1000000.00', '6')).toBe('940000.00');
    expect(discountedBase('333.33', '3.3333')).toBe('322.22');
    expect(commissionAt('940000.00', '6', '0')).toBe('56400.00');
    expect(commissionAt('1234.56', '2.5', '0')).toBe('30.86');
    expect(commissionAt('900.00', '5', '1000.00')).toBe('0.00');
  });

  it('offers the full standard rate first, co-fund lower, spiff higher (A-05)', () => {
    const options = buildOptions(
      [
        { kind: 'standard', discountPct: '6', ratePct: '1' },
        { kind: 'co_fund', discountPct: '8', ratePct: '4.5' },
        { kind: 'spiff', discountPct: '3', ratePct: '7' },
      ],
      CTX,
    );
    expect(options.map((o) => [o.kind, o.ratePct, o.netAmount, o.commissionAmount])).toEqual([
      // The standard rate is forced: a submitted lower rate is ignored.
      ['standard', '6.0000', '940000.00', '56400.00'],
      ['co_fund', '4.5000', '920000.00', '41400.00'],
      ['spiff', '7.0000', '970000.00', '67900.00'],
    ]);
    expect(options.every((o) => o.standardRatePct === '6.0000')).toBe(true);
  });

  it('refuses answers that would cut the rate silently or break the shape', () => {
    expect(problem(() => buildOptions([], CTX))).toBe('count');
    expect(problem(() => buildOptions([{ kind: 'co_fund', discountPct: '8', ratePct: '4' }], CTX))).toBe(
      'first_not_standard',
    );
    expect(
      problem(() =>
        buildOptions(
          [
            { kind: 'standard', discountPct: '6' },
            { kind: 'co_fund', discountPct: '8', ratePct: '6' },
          ],
          CTX,
        ),
      ),
    ).toBe('co_fund_not_lower');
    expect(
      problem(() =>
        buildOptions(
          [
            { kind: 'standard', discountPct: '6' },
            { kind: 'spiff', discountPct: '6', ratePct: '5' },
          ],
          CTX,
        ),
      ),
    ).toBe('spiff_not_higher');
    expect(
      problem(() =>
        buildOptions(
          [
            { kind: 'standard', discountPct: '6' },
            { kind: 'standard', discountPct: '7' },
          ],
          CTX,
        ),
      ),
    ).toBe('standard_twice');
    expect(problem(() => buildOptions([{ kind: 'standard', discountPct: '100' }], CTX))).toBe(
      'discount_range',
    );
    expect(
      problem(() =>
        buildOptions(
          [
            { kind: 'standard', discountPct: '1' },
            { kind: 'spiff', discountPct: '1' },
          ],
          CTX,
        ),
      ),
    ).toBe('rate_missing');
  });

  it('prints the price conditions (PLAN §7)', () => {
    const line = conditionsLine(
      { ...NONE, quantityChange: 8000, depositPct: '50', cashWithinDays: 7 },
      5000,
      '2026-10-25',
    );
    expect(line.th).toBe('ราคานี้สำหรับ 8,000 ชิ้น · มัดจำ 50% · ชำระภายใน 7 วัน · สั่งภายใน 25/10/2569');
    expect(line.en).toBe(
      'This price is for 8,000 pieces · a 50% deposit · payment within 7 days · order by 2026-10-25',
    );
  });
});

describe('deal registration (D-468, PLAN A-11)', () => {
  it('registers automatically from the threshold on the largest quantity’s base', () => {
    const options = [
      { netAmount: { toFixed: () => '300000.00' }, result: { shippingNetAmount: '1000.00' } },
      { netAmount: { toFixed: () => '501000.00' }, result: { shippingNetAmount: '1000.00' } },
    ];
    expect(deals.largestBase(options).toFixed(2)).toBe('500000.00');
    expect(deals.reachesThreshold('500000.00', '500000.00')).toBe(true);
    expect(deals.reachesThreshold('499999.99', '500000.00')).toBe(false);
  });

  it('locks the accepted option first, then a live registration, never an ended one', () => {
    const reg = { status: 'registered', lockedFirstRatePct: '5.0000', lockedRepeatRatePct: '3.0000' };
    expect(deals.lockOf({ acceptedOption: { ratePct: '4.5000' }, registration: reg })).toEqual({
      firstOrderPct: '4.5000',
      repeatOrderPct: '4.5000',
      source: 'accepted_option',
    });
    expect(deals.lockOf({ acceptedOption: null, registration: reg })).toEqual({
      firstOrderPct: '5.0000',
      repeatOrderPct: '3.0000',
      source: 'deal_registration',
    });
    expect(deals.lockOf({ acceptedOption: null, registration: { ...reg, status: 'won' } })?.source).toBe(
      'deal_registration',
    );
    for (const status of ['lost', 'expired'])
      expect(deals.lockOf({ acceptedOption: null, registration: { ...reg, status } })).toBeNull();
    expect(deals.lockOf({ acceptedOption: null, registration: null })).toBeNull();
  });
});
