import { type ActionRule } from '@common/next-actions/next-actions';

/** What a payout run's action guards read (`payouts.service.ts` `lockRun`). */
export interface RunFacts {
  status: string;
  items: { status: string }[];
}

/** Finance's actions on a payout run (D-093 maker-checker; approval itself is on the approval request). */
export const RUN_ACTIONS: ActionRule<RunFacts>[] = [
  {
    key: 'payout_run.propose',
    permissions: ['payouts.manage'],
    when: (r) =>
      r.status === 'draft' && (r.items.some((i) => i.status === 'included') || 'payouts.nothing_eligible'),
  },
  {
    key: 'payout_run.cancel',
    permissions: ['payouts.manage'],
    irreversible: true,
    when: (r) => ['draft', 'proposed', 'approved'].includes(r.status),
  },
  {
    key: 'payout_run.generate_bank_file',
    permissions: ['payouts.execute'],
    when: (r) => r.status === 'approved' || r.status === 'file_generated',
  },
  {
    key: 'payout_run.confirm',
    permissions: ['payouts.execute'],
    irreversible: true,
    when: (r) => r.status === 'file_generated',
  },
];
