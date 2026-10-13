/**
 * Building blocks of the default posting rules (accounting-design §5, ADR-0007). A rule is data: its
 * conditions use the approval-engine shape over `payload.<path>`, its template names accounts, sides,
 * amount expressions, dimensions and tax tagging.
 */
import { type PostingTemplate } from '../../../src/common/ledger-core/template';

export interface PostingRuleSeed {
  key: string;
  eventType: string;
  name: string;
  description: string;
  decisions: string[];
  conditions: unknown;
  template: PostingTemplate;
}

export const eq = (field: string, value: string | boolean) => ({
  field: `payload.${field}`,
  op: 'eq',
  value,
});
export const ne = (field: string, value: string) => ({ field: `payload.${field}`, op: 'ne', value });
export const gt0 = (field: string) => ({ field: `payload.${field}`, op: 'gt', value: '0' });
export const any = (...conditions: unknown[]) => ({ any: conditions });
export const all = (...conditions: unknown[]) => ({ all: conditions });

/** Where customer cash lands, by how it was received (P01, P02, P03, P08, P01X). */
export const RECEIPT_ACCOUNT = {
  switch: 'receiptVia',
  cases: {
    twoc2p: '1131',
    scb: '1132',
    slip: '1133',
    bank: '1133',
    unidentified: '1140',
    store_credit: '2320',
  },
};

/** Revenue account per revenue category (P06, P07, P09). */
export const REVENUE_ACCOUNT = {
  switch: 'item.category',
  cases: {
    made_to_order: '4110',
    standard_product: '4120',
    design_service: '4130',
    mockup: '4140',
    shipping: '4150',
    other_service: '4160',
  },
  default: '4160',
};

export const CLEARING_BY_PROVIDER = { switch: 'provider', cases: { twoc2p: '1131', scb: '1132' } };
export const VAT_INPUT = { switch: 'vatClaimable', cases: { true: '1241', false: '1242' } };
export const VAT_INPUT_CODE = {
  switch: 'vatClaimable',
  cases: { true: 'input_vat', false: 'input_vat_pending' },
} as const;
export const WHT_PAYABLE = { switch: 'whtForm', cases: { pnd53: '2231', pnd3: '2232' } };
export const WHT_PAYABLE_CODE = {
  switch: 'whtForm',
  cases: { pnd53: 'wht_pnd53', pnd3: 'wht_pnd3' },
} as const;
/** The GL account of the company bank account the event names (112x, D-093). */
export const BANK = { path: 'bankAccountCode' };

export const CUSTOMER_DIMS = {
  order: 'orderId',
  orderGroup: 'orderGroupId',
  customer: 'customerId',
  company: 'companyId',
  channel: 'channel',
};
export const VENDOR_DIMS = {
  vendor: 'vendorId',
  factory: 'factoryId',
  order: 'orderId',
  productType: 'productTypeId',
};
export const DOC_SOURCE = { type: 'customer_document', id: 'documentId', number: 'docNumber' };
/** Points events carry the customer as `userId` (loyalty module, B3.4). */
export const POINTS_SOURCE = { type: 'points_entry', id: 'entryId' };
export const POINTS_LIABILITY_AMOUNT = 'round(bahtValue * expectedRedemptionRatePct / 100)';
