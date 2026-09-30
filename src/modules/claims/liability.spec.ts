import { CLAIM_TRANSITIONS, liabilityByRule, liabilityRule } from './liability';

describe('claim liability by rule (D-083)', () => {
  it.each([
    ['wrong_spec', 'factory_fleet', 'factory'],
    ['print_defect', 'factory_fleet', 'factory'],
    ['quantity_short', 'carrier', 'factory'],
    ['damaged', 'factory_fleet', 'factory'],
    ['damaged', null, 'factory'],
    ['damaged', 'carrier', 'carrier'],
    ['late', 'factory_fleet', 'undetermined'],
    ['other', 'factory_fleet', 'undetermined'],
  ] as const)('%s shipped by %s → %s', (type, shippedBy, expected) => {
    expect(liabilityByRule(type, shippedBy)).toBe(expected);
  });

  it.each([
    ['wrong_spec', 'factory_fleet', 'factory_production'],
    ['print_defect', 'carrier', 'factory_production'],
    ['quantity_short', 'carrier', 'factory_short_delivery'],
    ['damaged', 'factory_fleet', 'factory_fleet_transit'],
    ['damaged', null, 'factory_fleet_transit'],
    ['damaged', 'carrier', 'carrier_transit'],
    ['late', 'factory_fleet', 'staff_decides'],
    ['other', null, 'staff_decides'],
  ] as const)('names the rule: %s shipped by %s → %s', (type, shippedBy, rule) => {
    expect(liabilityRule(type, liabilityByRule(type, shippedBy))).toBe(rule);
  });

  it('decides only from review and never reopens a final claim', () => {
    expect(CLAIM_TRANSITIONS['submitted']).not.toContain('approved');
    expect(CLAIM_TRANSITIONS['under_review']).toEqual(expect.arrayContaining(['approved', 'rejected']));
    expect(CLAIM_TRANSITIONS['closed']).toEqual([]);
    expect(CLAIM_TRANSITIONS['rejected']).toEqual(['closed']);
  });
});
