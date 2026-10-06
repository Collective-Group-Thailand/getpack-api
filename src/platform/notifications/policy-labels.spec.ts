import { policyLabel, readablePayload } from './policy-labels';

describe('approval policy labels in notifications (round 2, B2)', () => {
  it('names the policy in the template language', () => {
    expect(policyLabel('company_order_approval', 'th')).toBe('คำสั่งซื้อของบริษัท');
    expect(policyLabel('company_order_approval', 'en')).toBe('company order');
  });

  it('humanises a policy it does not know rather than printing the key', () => {
    expect(policyLabel('brand_new_policy', 'th')).toBe('brand new policy');
  });

  it('puts the name where templates print the key, and keeps the key as policyCode', () => {
    expect(readablePayload({ policyKey: 'discount_memo', amount: '1.00' }, 'th')).toEqual({
      policyKey: 'บันทึกขอส่วนลด',
      policyCode: 'discount_memo',
      amount: '1.00',
    });
    expect(readablePayload({ amount: '1.00' }, 'th')).toEqual({ amount: '1.00' });
    expect(readablePayload(null, 'th')).toBeNull();
  });
});
