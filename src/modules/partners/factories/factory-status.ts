import { type FactoryStatus } from '@generated/prisma/client';

/**
 * The partner lifecycle (D-011, D-041), mirrored by trigger `tg_factories__status`:
 * `applied → under_review → trial → active`, `suspended` in between, `offboarded` at the end.
 * `trial → active` happens only through the `partner_activation` approval (D-041).
 */
export const FACTORY_TRANSITIONS: Readonly<Record<FactoryStatus, readonly FactoryStatus[]>> = {
  applied: ['under_review', 'offboarded'],
  under_review: ['applied', 'trial', 'offboarded'],
  trial: ['active', 'suspended', 'offboarded'],
  active: ['suspended', 'offboarded'],
  suspended: ['trial', 'active', 'offboarded'],
  offboarded: [],
};

export const canTransition = (from: FactoryStatus, to: FactoryStatus): boolean =>
  FACTORY_TRANSITIONS[from].includes(to);

/** Statuses in which a factory may take production work (D-011: onboarding precedes any work). */
export const WORKING_STATUSES: readonly FactoryStatus[] = ['trial', 'active'];

/** The factory may still edit its own legal data before getpack starts the trial. */
export const SELF_EDITABLE_STATUSES: readonly FactoryStatus[] = ['applied', 'under_review'];
