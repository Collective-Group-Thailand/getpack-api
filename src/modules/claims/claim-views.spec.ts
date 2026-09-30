import { MoneyDecimal } from '@common/money/money';

import { adminClaimDto, partnerClaimDto, storeClaimDto } from './claim-views';
import { type ClaimRow } from './claims.service';

const at = new Date('2026-10-25T04:00:00Z');
const resolution = (action: string, amount: string | null) => ({
  action,
  amount: amount === null ? null : new MoneyDecimal(amount),
  quantity: null,
  executedAt: at,
  refund: null,
  productionJob: null,
});

const claim = {
  publicId: '0192f3a0-7c1e-7d2a-9b1f-0000000f3001',
  claimNo: 'DEVCLM-2610-00001',
  order: {
    publicId: '0192f3a0-7c1e-7d2a-9b1f-0000000f1002',
    orderCode: 'DEV-2610-00001',
    orderGroup: { company: null },
    proofs: [],
  },
  customer: {
    publicId: '0192f3a0-7c1e-7d2a-9b1f-0000000f3006',
    displayName: 'ลูกค้า ทดสอบ',
    customerProfile: null,
  },
  decidedBy: null,
  liabilityOverriddenBy: null,
  type: 'print_defect',
  origin: 'customer',
  status: 'resolved',
  description: 'สีเพี้ยน',
  requestedResolution: 'reprint',
  claimedQuantity: 100,
  claimedAmount: null,
  receivedAt: at,
  windowEndsAt: at,
  submittedAt: at,
  infoRequest: null,
  decisionNote: null,
  resolutions: [
    resolution('reproduction_job', null),
    resolution('factory_deduction', '1250.00'),
    resolution('carrier_recovery', '300.00'),
    resolution('store_credit', '100.00'),
  ],
  productionJob: null,
  liability: 'factory',
  factoryResponse: null,
  factoryResponseNote: null,
  liabilityByRule: 'factory',
  overrideReason: null,
  factory: null,
  shipment: null,
  infoResponse: null,
  decidedAt: at,
} as unknown as ClaimRow;

describe('claim views', () => {
  it('never shows the customer what Packio recovers from the factory or the carrier (D-083, D-044)', () => {
    const view = storeClaimDto(claim);
    expect(view.resolutions.map((r) => r.action)).toEqual(['reproduction_job', 'store_credit']);
    expect(JSON.stringify(view)).not.toContain('1250.00');
  });

  it('keeps every resolution for the factory and for staff', () => {
    expect(partnerClaimDto(claim).resolutions.map((r) => r.action)).toHaveLength(4);
    const admin = adminClaimDto(claim).resolutions;
    expect(admin.map((r) => r.action)).toEqual([
      'reproduction_job',
      'factory_deduction',
      'carrier_recovery',
      'store_credit',
    ]);
    expect(admin[1]!.amount).toBe('1250.00');
  });

  it('names the D-083 rule and the customer for staff (U-B0.2)', () => {
    expect(adminClaimDto(claim)).toMatchObject({
      liabilityRule: 'factory_production',
      customer: { customerCode: null, companyName: null },
      approvedProof: null,
    });
  });

  it('shows the factory its own deduction amount only', () => {
    const partner = partnerClaimDto(claim).resolutions;
    expect(partner.map((r) => r.amount)).toEqual([null, '1250.00', null, null]);
  });
});
