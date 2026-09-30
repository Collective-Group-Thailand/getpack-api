import { benefitSummary } from './benefit-summary';

describe('benefitSummary (U-B0.2)', () => {
  it('words each benefit kind in Thai and English', () => {
    expect(benefitSummary({ type: 'percent', pct: '10', maxAmount: '500.00' })).toEqual({
      th: 'ลด 10% สูงสุด 500.00 บาท',
      en: '10% off, up to THB 500.00',
    });
    expect(benefitSummary({ type: 'fixed', amount: '200.00' })).toEqual({ th: 'ลด 200.00 บาท', en: 'THB 200.00 off' });
    expect(
      benefitSummary({ type: 'tiered', basis: 'quantity', tiers: [{ min: '1000', pct: '5' }, { min: '5000', pct: '8' }] }),
    ).toEqual({ th: '1000 ชิ้นขึ้นไป ลด 5%, 5000 ชิ้นขึ้นไป ลด 8%', en: '1000+ pieces: 5% off; 5000+ pieces: 8% off' });
    expect(benefitSummary({ type: 'free_shipping' }).en).toBe('Free shipping');
    expect(benefitSummary({ type: 'bonus_points', points: 50 }).th).toBe('รับคะแนนพิเศษ 50 คะแนน');
    expect(benefitSummary(null)).toEqual({ th: '—', en: '—' });
  });
});
