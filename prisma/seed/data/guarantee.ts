/**
 * D-260 guarantee policy version 1 — the remedy matrix of D-198 and the SLAs of D-199 (accepted 2026-09-30).
 * Claim type × severity → remedies allowed for a claim whose liability is on Packio's side (factory, carrier, Packio);
 * a customer-liable claim gets none (D-083). Late delivery has no guarantee at launch (D-199); `other` claims only
 * goodwill through a discount memo (D-262).
 */
export const GUARANTEE_POLICY_V1 = {
  versionNo: 1,
  responseBusinessDays: 1,
  decisionBusinessDays: 3,
  reason: 'D-198 / D-199 (accepted 2026-09-30): remedies and claim SLAs at launch',
  rules: [
    ...(['damaged', 'wrong_spec', 'print_defect'] as const).flatMap((claimType) => [
      { claimType, severity: 'critical' as const, remedies: ['reprint', 'refund'] as const },
      { claimType, severity: 'major' as const, remedies: ['reprint', 'refund'] as const },
      { claimType, severity: 'minor' as const, remedies: ['partial_credit'] as const },
    ]),
    ...(['critical', 'major', 'minor'] as const).map((severity) => ({
      claimType: 'quantity_short' as const,
      severity,
      remedies: ['reprint', 'refund'] as const,
    })),
    ...(['late', 'other'] as const).flatMap((claimType) =>
      (['critical', 'major', 'minor'] as const).map((severity) => ({
        claimType,
        severity,
        remedies: [] as const,
      })),
    ),
  ],
};
