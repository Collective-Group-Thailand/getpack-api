import { type Prisma } from '@generated/prisma/client';

/** Finance work queues of billing statements, shared by `…/billing-statements?queue=` and the dashboard (U-B0.3). */
export const STATEMENT_QUEUES = ['missing_tax_invoice'] as const;
export type StatementQueue = (typeof STATEMENT_QUEUES)[number];

export const STATEMENT_QUEUE_WHERE: Record<StatementQueue, Prisma.BillingStatementWhereInput> = {
  // D-090: the factory confirmed it, but its own tax invoice is not recorded / validated yet.
  missing_tax_invoice: {
    status: 'confirmed',
    vendorInvoices: { none: { status: { in: ['recorded', 'validated'] } } },
  },
};
