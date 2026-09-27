/**
 * Fulfilment reference data (B4): feature flags of the fulfilment integrations. Milestone routes, the
 * notification matrix and templates are added by their deliverables.
 */
export const FULFILMENT_FEATURE_FLAGS = [
  {
    key: 'drawing.engine',
    description:
      'Dieline drawing engine @packio/dieline (B4.1) — off until the package is published; drawings answer 501',
  },
] as const;
