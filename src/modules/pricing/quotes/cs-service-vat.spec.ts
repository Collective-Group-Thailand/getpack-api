import { computeVat } from '@common/money/vat';

import { fromCost, fromGross } from '../calculators/service/service-calculator';
import { serviceVatAmounts } from './cs-service-pricing.service';

/** B-API-6: the CS service pricing endpoint splits VAT with the shared helper (GLOBAL-RULES §5). Fake amounts. */
describe('serviceVatAmounts (B-API-6)', () => {
  it('from a net buy price: VAT = rate % of the net sell amount (half-up), gross = net + VAT', () => {
    const unit = fromCost(1000, 6.5, 7); // net 1,069.52 (legacy margin maths, unchanged)
    const one = serviceVatAmounts(unit, 1, 'buy_price_net', 7);
    expect([one.net.toFixed(2), one.vat.toFixed(2), one.gross.toFixed(2)]).toEqual([
      '1069.52',
      '74.87',
      '1144.39',
    ]);
    // VAT on the quantity's net, not the unit VAT × quantity
    const three = serviceVatAmounts(unit, 3, 'buy_price_net', 7);
    expect(three.net.toFixed(2)).toBe('3208.56');
    expect(three.vat.toFixed(2)).toBe(
      computeVat([{ amount: '3208.56', inclusive: false }], '7').vat.toFixed(2),
    );
    expect(three.vat.toFixed(2)).toBe('224.60');
  });

  it('from a VAT-inclusive sell price: the gross stays, VAT = 7 % of its ex-VAT amount, net = gross − VAT', () => {
    const unit = fromGross(5000, 6.5, 7);
    const r = serviceVatAmounts(unit, 1, 'sell_gross', 7);
    expect([r.net.toFixed(2), r.vat.toFixed(2), r.gross.toFixed(2)]).toEqual([
      '4672.90',
      '327.10',
      '5000.00',
    ]);
  });

  it('follows the helper where legacy rounding differed (฿1.15 incl. VAT → VAT 0.07, not 0.08)', () => {
    const r = serviceVatAmounts({ net: 1.07, gross: 1.15 }, 1, 'sell_gross', 7);
    expect(r.vat.toFixed(2)).toBe('0.07');
    expect(r.net.toFixed(2)).toBe('1.08');
    expect(r.gross.toFixed(2)).toBe('1.15');
  });

  it('uses the dated rate it is given, not a constant', () => {
    expect(serviceVatAmounts({ net: 100, gross: 110 }, 1, 'buy_price_net', 10).vat.toFixed(2)).toBe('10.00');
  });
});
