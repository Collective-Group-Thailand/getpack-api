/**
 * Liability by rule (D-083), pure: wrong spec and print defects are the factory's; transit damage is the
 * shipper's — the factory on its own fleet, the carrier when getpack booked one (D-114); a short delivery is
 * the factory's (it reported and shipped the quantity, D-021). Late deliveries and anything else are left
 * undetermined for staff. Errors in artwork the customer approved are the customer's: that needs the
 * investigation, so it is an override with a reason, never a rule.
 */
export type ClaimTypeValue = 'damaged' | 'wrong_spec' | 'print_defect' | 'quantity_short' | 'late' | 'other';
export type LiabilityValue = 'factory' | 'customer' | 'carrier' | 'getpack' | 'undetermined';

export function liabilityByRule(
  type: ClaimTypeValue,
  shippedBy: 'factory_fleet' | 'carrier' | null,
): LiabilityValue {
  switch (type) {
    case 'wrong_spec':
    case 'print_defect':
    case 'quantity_short':
      return 'factory';
    case 'damaged':
      return shippedBy === 'carrier' ? 'carrier' : 'factory';
    default:
      return 'undetermined';
  }
}

/** Which D-083 rule gave `liabilityByRule`, for staff to see why (U-B0.2). */
export const LIABILITY_RULES = [
  'factory_production',
  'factory_short_delivery',
  'factory_fleet_transit',
  'carrier_transit',
  'staff_decides',
] as const;
export type LiabilityRuleKey = (typeof LIABILITY_RULES)[number];

/** Derived from the stored rule outcome: for transit damage it names who shipped (D-083, D-114). */
export function liabilityRule(type: ClaimTypeValue, byRule: LiabilityValue): LiabilityRuleKey {
  switch (type) {
    case 'wrong_spec':
    case 'print_defect':
      return 'factory_production';
    case 'quantity_short':
      return 'factory_short_delivery';
    case 'damaged':
      return byRule === 'carrier' ? 'carrier_transit' : 'factory_fleet_transit';
    default:
      return 'staff_decides';
  }
}

/** Claim statuses from which nothing more happens. */
export const FINAL_CLAIM_STATUSES = ['rejected', 'resolved', 'closed'] as const;

/** Allowed status moves (D-082 lifecycle); `approved`/`rejected` only through a decision. */
export const CLAIM_TRANSITIONS: Record<string, readonly string[]> = {
  submitted: ['under_review'],
  under_review: ['need_info', 'factory_review', 'approved', 'rejected'],
  need_info: ['under_review'],
  factory_review: ['under_review'],
  approved: ['resolved'],
  rejected: ['closed'],
  resolved: ['closed'],
  closed: [],
};
