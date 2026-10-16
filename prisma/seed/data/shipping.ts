/**
 * Shipping reference data (B2.4, D-013, D-114). Structure only: the zone scheme the customer rate card
 * uses, the rate-card identity and the delivery methods. Zones, postcodes and every rate are entered
 * by admins (D-005, D-161, D-170) — nothing is seeded from legacy carrier tables.
 */
export const ZONE_SCHEMES = [
  {
    code: 'customer_default',
    name: 'Customer shipping zones (customer rate card and factory payout cards, D-013)',
  },
] as const;

export const CUSTOMER_SHIPPING_RATE_CARDS = [
  {
    key: 'default',
    description: 'D-013 customer shipping rate card (zone/postcode × weight/volume)',
    decisions: ['D-013'],
  },
] as const;

/**
 * Carriers are seeded disabled: getpack's own accounts are opened and their sandbox credentials
 * registered before a Superadmin (`carriers.manage`) enables one (D-005, D-114 carrier choice Proposed).
 */
export const CARRIERS = [
  {
    code: 'factory_fleet',
    name: 'Factory fleet',
    adapterKey: 'factory_fleet',
    enabled: true,
    supports: [],
  },
  {
    code: 'flash_express',
    name: 'Flash Express',
    adapterKey: 'flash_express',
    enabled: false,
    supports: ['quote', 'book', 'label', 'track', 'cancel', 'webhook'],
  },
  {
    code: 'deliveree',
    name: 'Deliveree',
    adapterKey: 'deliveree',
    enabled: false,
    supports: ['quote', 'book', 'track', 'cancel', 'webhook'],
  },
] as const;
