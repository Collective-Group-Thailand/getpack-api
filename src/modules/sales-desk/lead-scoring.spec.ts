import { SCORING_RULES_SEED } from '../../../prisma/seed/data/settings';
import { emailDomain, scoreLead, type ScoringInput, type ScoringRules } from './lead-scoring';

const now = new Date('2026-11-10T03:00:00Z');
const day = 86_400_000;

const rules: ScoringRules = {
  base: 10,
  inboundSource: { rfq: 20, contact_form: 15, studio_idle: 10, dieline_download: 5 },
  leadSource: { link: 15, manual: 5 },
  companyEmailDomain: 15,
  freeEmailDomain: -5,
  freeEmailDomains: ['gmail.com', 'Hotmail.com'],
  taxIdPresent: 15,
  quantityBands: [
    { min: 1000, points: 5 },
    { min: 20000, points: 15 },
    { min: 5000, points: 10 },
  ],
  valueBands: [
    { min: '20000.00', points: 5 },
    { min: '100000.00', points: 10 },
    { min: '500000.00', points: 15 },
  ],
  recencyBands: [
    { maxDays: 30, points: 5 },
    { maxDays: 1, points: 15 },
    { maxDays: 7, points: 10 },
  ],
  repeatSignals: { min: 3, points: 5 },
};

const input = (over: Partial<ScoringInput> = {}): ScoringInput => ({
  kind: 'inbound',
  source: 'dieline_download',
  email: null,
  taxIdPresent: false,
  quantity: null,
  estimatedValue: null,
  lastSignalAt: new Date(now.getTime() - 60 * day),
  signalCount: 1,
  now,
  ...over,
});

/** D-471 item 2: the lead score 0–100 and its top 3 reasons. */
describe('scoreLead (D-471)', () => {
  it('starts from the base and the source', () => {
    expect(scoreLead(rules, input())).toEqual({ score: 15, reasons: [{ reason: 'source', points: 5 }] });
    expect(scoreLead(rules, input({ kind: 'lead', source: 'link' })).score).toBe(25);
    // An unknown source adds nothing.
    expect(scoreLead(rules, input({ source: 'line_chat' }))).toEqual({ score: 10, reasons: [] });
  });

  it('tells a company domain from free webmail (case-insensitive)', () => {
    expect(scoreLead(rules, input({ email: 'buyer@bakery.co.th' })).reasons).toContainEqual({
      reason: 'company_email_domain',
      points: 15,
    });
    expect(scoreLead(rules, input({ email: 'Someone@HOTMAIL.com' })).reasons).toContainEqual({
      reason: 'free_email_domain',
      points: -5,
    });
    expect(emailDomain('no-at-sign')).toBeNull();
    expect(emailDomain('a@')).toBeNull();
  });

  it('takes the highest quantity and value band reached, whatever their order', () => {
    const r = scoreLead(rules, input({ quantity: 6000, estimatedValue: '120000.00' }));
    expect(r.reasons).toEqual(
      expect.arrayContaining([
        { reason: 'quantity_band', points: 10 },
        { reason: 'value_band', points: 10 },
      ]),
    );
    expect(scoreLead(rules, input({ quantity: 999, estimatedValue: '19999.99' })).reasons).toEqual([
      { reason: 'source', points: 5 },
    ]);
  });

  it('rewards recency by the first band the days fall in', () => {
    const at = (d: number) => scoreLead(rules, input({ lastSignalAt: new Date(now.getTime() - d * day) }));
    expect(at(0.5).reasons).toContainEqual({ reason: 'recency', points: 15 });
    expect(at(3).reasons).toContainEqual({ reason: 'recency', points: 10 });
    expect(at(30).reasons).toContainEqual({ reason: 'recency', points: 5 });
    expect(at(31).reasons.some((r) => r.reason === 'recency')).toBe(false);
  });

  it('clamps to 0–100 and keeps the top 3 reasons by absolute points', () => {
    const top = scoreLead(
      rules,
      input({
        source: 'rfq',
        email: 'buyer@bakery.co.th',
        taxIdPresent: true,
        quantity: 50000,
        estimatedValue: '900000.00',
        lastSignalAt: now,
        signalCount: 4,
      }),
    );
    expect(top.score).toBe(100);
    // 20 (source) beats the 15s; ties keep the reason order: company e-mail, tax id, then quantity, value, recency.
    expect(top.reasons).toEqual([
      { reason: 'source', points: 20 },
      { reason: 'company_email_domain', points: 15 },
      { reason: 'tax_id_present', points: 15 },
    ]);
    expect(scoreLead({ ...rules, base: -50 }, input()).score).toBe(0);
  });

  it('counts repeat signals', () => {
    expect(scoreLead(rules, input({ signalCount: 3 })).reasons).toContainEqual({
      reason: 'repeat_signals',
      points: 5,
    });
  });

  it('scores a seeded value within range with the seed rules', () => {
    const r = scoreLead(SCORING_RULES_SEED, input({ email: 'a@gmail.com', lastSignalAt: now }));
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.reasons.length).toBeLessThanOrEqual(3);
  });
});
