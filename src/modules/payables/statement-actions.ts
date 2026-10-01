import { type ActionRule } from '@common/next-actions/next-actions';

/** What a statement's action guards read (`vendor-invoices.service.ts`). */
export interface StatementFacts {
  status: string;
  /** Statuses of its non-void tax invoices. */
  invoiceStatuses: string[];
}

const DECIDABLE = ['generated', 'sent', 'disputed'];
/** A tax invoice is still wanted while none is recorded or validated (a rejected one is replaced). */
const wantsInvoice = (s: StatementFacts) =>
  !s.invoiceStatuses.some((i) => i === 'recorded' || i === 'validated');

/** The factory's actions on its statement (D-090). */
export const PARTNER_STATEMENT_ACTIONS: ActionRule<StatementFacts>[] = [
  {
    key: 'billing_statement.confirm',
    permissions: ['factory_payables.manage'],
    irreversible: true,
    when: (s) => DECIDABLE.includes(s.status),
  },
  {
    key: 'billing_statement.dispute',
    permissions: ['factory_payables.manage'],
    when: (s) => DECIDABLE.includes(s.status),
  },
  {
    key: 'billing_statement.submit_tax_invoice',
    permissions: ['factory_payables.manage'],
    when: (s) => s.status !== 'superseded' && wantsInvoice(s),
  },
];

/** Finance's actions on a factory statement (§2, D-090). */
export const ADMIN_STATEMENT_ACTIONS: ActionRule<StatementFacts>[] = [
  {
    key: 'billing_statement.capture_tax_invoice',
    permissions: ['payables.manage'],
    when: (s) => s.status !== 'superseded' && wantsInvoice(s),
  },
  {
    key: 'billing_statement.validate_tax_invoice',
    permissions: ['payables.manage'],
    when: (s) => s.invoiceStatuses.includes('recorded'),
  },
];
