import { inboxLink } from './inbox-links';

const ID = '0192f3a0-7c1e-7d2a-9b1f-00000000e001';

describe('in-app notification links (U-B0.3)', () => {
  it('maps an aggregate to the page of each zone', () => {
    expect(inboxLink('store', 'order', ID, {})).toBe(`/account/orders/${ID}`);
    expect(inboxLink('admin', 'order', ID, {})).toBe(`/orders/${ID}`);
    expect(inboxLink('admin', 'approval_request', ID, {})).toBe(`/approvals/${ID}`);
    expect(inboxLink('partner', 'production_job', ID, {})).toBe(`/jobs/${ID}`);
    expect(inboxLink('partner', 'shipment', ID, {})).toBe(`/ship/${ID}`);
  });

  it('nests a customer claim under its order, from the event payload', () => {
    expect(inboxLink('store', 'claim', ID, { orderId: 'o-1' })).toBe(`/account/orders/o-1/claims/${ID}`);
    expect(inboxLink('store', 'claim', ID, {})).toBeNull();
  });

  it('takes a company approver to the business approvals (round 2, B2)', () => {
    expect(inboxLink('store', 'approval_request', ID, { policyKey: 'company_order_approval' })).toBe(
      `/business/approvals?request=${ID}`,
    );
    expect(inboxLink('store', 'approval_request', ID, { policyKey: 'discount_memo' })).toBeNull();
  });

  it('answers null where the zone has no page', () => {
    expect(inboxLink('partner', 'order', ID, {})).toBeNull();
    expect(inboxLink('store', 'approval_request', ID, null)).toBeNull();
  });
});
