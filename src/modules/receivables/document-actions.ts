import { type ActionRule } from '@common/next-actions/next-actions';

/** What a customer document's action guards read (`customer-documents.service.ts` resend / void). */
export interface DocumentFacts {
  status: string;
  docType: string;
  receivableItem: {
    status: string;
    openAmount: { toString(): string };
    amount: { toString(): string };
  } | null;
}

const untouched = (d: DocumentFacts) =>
  d.receivableItem === null ||
  (d.receivableItem.status === 'open' &&
    d.receivableItem.openAmount.toString() === d.receivableItem.amount.toString());

/** Finance's actions on a customer document (D-010, D-092; numbers stay gapless, a void keeps its number). */
export const ADMIN_DOCUMENT_ACTIONS: ActionRule<DocumentFacts>[] = [
  { key: 'customer_document.resend', permissions: ['receivables.manage'], when: (d) => d.status !== 'void' },
  {
    key: 'customer_document.void',
    permissions: ['receivables.manage'],
    irreversible: true,
    when: (d) =>
      d.status !== 'void' &&
      ['iv', 'dn'].includes(d.docType) &&
      (untouched(d) || 'receivables.document_settled'),
  },
];
