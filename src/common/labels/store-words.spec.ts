import { STORE_STATUS_LABEL_DICTIONARY } from '@modules/catalog/store/status-labels.controller';

import { STORE_CLAIM_OWNERS, storeEnum, storeWords } from './store-words';

describe('storefront words (D-440)', () => {
  it('gives every *LabelAdminTh the customer words of its sibling', () => {
    expect(
      storeWords({
        status: 'released',
        statusLabelTh: 'เตรียมผลิต',
        statusLabelAdminTh: 'รอโรงงานรับงาน',
        jobs: [{ artworkStatusLabelTh: 'รอไฟล์จากคุณ', artworkStatusLabelAdminTh: 'รอไฟล์จากลูกค้า' }],
      }),
    ).toEqual({
      status: 'released',
      statusLabelTh: 'เตรียมผลิต',
      statusLabelAdminTh: 'เตรียมผลิต',
      jobs: [{ artworkStatusLabelTh: 'รอไฟล์จากคุณ', artworkStatusLabelAdminTh: 'รอไฟล์จากคุณ' }],
    });
  });

  it('replaces factory- and capacity-named values by their store alias', () => {
    expect(
      storeWords({
        status: 'factory_review',
        sla: { currentOwner: 'factory' },
        agreement: { status: 'pending_factory' },
        steps: [
          { reason: 'capacity_unavailable' },
          { reason: 'no_active_factory' },
          { reason: 'rfq_required' },
        ],
        lead: { kind: 'factory' },
      }),
    ).toEqual({
      status: 'under_review',
      sla: { currentOwner: 'getpack' },
      agreement: { status: 'pending_confirmation' },
      steps: [{ reason: 'not_instant' }, { reason: 'not_instant' }, { reason: 'rfq_required' }],
      // The agent programme's lead kind is its own term (D-419), not a party to an order.
      lead: { kind: 'factory' },
    });
  });

  it('keeps dates, nulls and numbers, and is idempotent', () => {
    const at = new Date('2026-10-25T00:00:00Z');
    const once = storeWords({ at, n: 1, x: null, status: 'factory_review' });
    expect(once).toEqual({ at, n: 1, x: null, status: 'under_review' });
    expect(storeWords(once)).toEqual(once);
  });

  it('publishes store enums without the factory values', () => {
    expect(storeEnum(['pending_factory', 'active'] as const)).toEqual(['pending_confirmation', 'active']);
    expect(storeEnum(['submitted', 'under_review', 'factory_review'] as const)).toEqual([
      'submitted',
      'under_review',
    ]);
    expect(STORE_CLAIM_OWNERS).not.toContain('factory');
  });

  it('serves the storefront a dictionary of customer words only', () => {
    const claim = STORE_STATUS_LABEL_DICTIONARY.find((e) => e.enumName === 'ClaimStatus')!;
    expect(claim.values.map((v) => v.value)).not.toContain('factory_review');
    for (const e of STORE_STATUS_LABEL_DICTIONARY)
      for (const v of e.values) {
        expect(v.labelAdminTh).toBe(v.labelTh);
        expect(`${v.labelTh} ${v.labelEn}`).not.toMatch(/โรงงาน|factory/i);
      }
  });
});
