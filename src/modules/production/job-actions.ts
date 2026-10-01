import { type ActionRule } from '@common/next-actions/next-actions';

/** What a production job's action guards read (`production.service.ts`, `milestones.service.ts`, `shipments.service.ts`). */
export interface JobFacts {
  status: string;
  jobKind: string;
}

/** Statuses in which the factory works the job (`WORKING`). */
const WORKING = ['accepted', 'in_progress'];

/** The factory's actions on its job (D-142, D-074, D-232). */
export const PARTNER_JOB_ACTIONS: ActionRule<JobFacts>[] = [
  { key: 'job.accept', permissions: ['factory_jobs.respond'], when: (j) => j.status === 'released' },
  {
    key: 'job.reject',
    permissions: ['factory_jobs.respond'],
    irreversible: true,
    when: (j) => j.status === 'released',
  },
  {
    key: 'job.update_milestone',
    permissions: ['factory_milestones.update'],
    when: (j) => WORKING.includes(j.status),
  },
  { key: 'job.record_qc', permissions: ['factory_qc.record'], when: (j) => WORKING.includes(j.status) },
  { key: 'job.raise_issue', permissions: ['factory_issues.raise'], when: () => true },
  {
    key: 'job.ship',
    permissions: ['factory_shipments.manage'],
    when: (j) => j.status === 'completed' && j.jobKind !== 'mockup',
  },
];

/** Production staff actions (D-074, D-075). */
export const ADMIN_JOB_ACTIONS: ActionRule<JobFacts>[] = [
  {
    key: 'job.reassign',
    permissions: ['production.manage'],
    when: (j) => j.status === 'released' || j.status === 'rejected',
  },
  { key: 'job.hold', permissions: ['production.manage'], when: (j) => WORKING.includes(j.status) },
  { key: 'job.resume', permissions: ['production.manage'], when: (j) => j.status === 'on_hold' },
];
