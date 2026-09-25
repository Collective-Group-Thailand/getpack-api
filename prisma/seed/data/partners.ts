/**
 * Agreement templates every factory accepts before activation (D-011; the confidentiality clause
 * covers both directions, D-044). Seeded as keys only: the texts are legal content that Packio's
 * counsel publishes as versions through the admin API, like consent texts (B1.2).
 */
export const AGREEMENT_TEMPLATES = [
  { key: 'partner_agreement', name: 'Partner agreement', description: 'D-011 partner agreement' },
  {
    key: 'price_data_confidentiality',
    name: 'Price-data confidentiality',
    description: 'D-044 confidentiality of price data, both directions',
  },
] as const;
