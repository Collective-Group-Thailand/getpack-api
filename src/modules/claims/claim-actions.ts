import { type ActionRule } from '@common/next-actions/next-actions';

/** The fields of a claim its action guards read (`claims.service.ts`, `liability.ts` transitions). */
export interface ClaimFacts {
  status: string;
  liability: string;
  factoryId: bigint | null;
}

const REVIEWABLE = ['submitted', 'need_info', 'factory_review'];
const OVERRIDABLE = ['submitted', 'under_review', 'need_info', 'factory_review'];

/** What the customer may do on their claim (U-B0.3): answer getpack's question. */
export const STORE_CLAIM_ACTIONS: ActionRule<ClaimFacts>[] = [
  { key: 'claim.answer_info', when: (c) => c.status === 'need_info' },
];

/** What the factory may do (D-083): accept or dispute while getpack asks for its review. */
export const PARTNER_CLAIM_ACTIONS: ActionRule<ClaimFacts>[] = [
  {
    key: 'claim.respond',
    permissions: ['factory_claims.respond'],
    when: (c) => c.status === 'factory_review',
  },
];

/** Staff actions (D-082, D-083) with the endpoints' own state checks. */
export const ADMIN_CLAIM_ACTIONS: ActionRule<ClaimFacts>[] = [
  { key: 'claim.review', permissions: ['claims.manage'], when: (c) => REVIEWABLE.includes(c.status) },
  { key: 'claim.request_info', permissions: ['claims.manage'], when: (c) => c.status === 'under_review' },
  {
    key: 'claim.send_to_factory',
    permissions: ['claims.manage'],
    when: (c) => c.status === 'under_review' && (c.factoryId !== null || 'claims.no_factory'),
  },
  {
    key: 'claim.override_liability',
    permissions: ['claims.override_liability'],
    when: (c) => OVERRIDABLE.includes(c.status),
  },
  {
    key: 'claim.approve',
    permissions: ['claims.manage'],
    irreversible: true,
    when: (c) =>
      c.status === 'under_review' && (c.liability !== 'undetermined' || 'claims.liability_undetermined'),
  },
  {
    key: 'claim.reject',
    permissions: ['claims.manage'],
    irreversible: true,
    when: (c) => c.status === 'under_review',
  },
  {
    key: 'claim.resolve',
    permissions: ['claims.resolve'],
    irreversible: true,
    when: (c) => c.status === 'approved',
  },
  {
    key: 'claim.close',
    permissions: ['claims.manage'],
    irreversible: true,
    when: (c) => c.status === 'rejected' || c.status === 'resolved',
  },
];
