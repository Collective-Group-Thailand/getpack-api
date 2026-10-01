import { type ActionRule } from '@common/next-actions/next-actions';

/** What an RFQ's action guards read (`rfqs.service.ts`: `OPEN`, quotation and acceptance checks). */
export interface RfqFacts {
  status: string;
  quotes: { status: string; validUntil: Date | null; lines: unknown[] }[];
  now: Date;
}

const OPEN = ['submitted', 'in_review', 'need_info', 'quoted'];
const open = (r: RfqFacts) => OPEN.includes(r.status);
const acceptable = (r: RfqFacts) =>
  r.status === 'quoted' &&
  r.quotes.some((q) => q.status === 'sent' && q.validUntil !== null && q.validUntil > r.now);
const draft = (r: RfqFacts) => r.quotes.find((q) => q.status === 'draft');
const MANAGE = ['rfqs.manage'];

/** The customer's actions on their RFQ (D-100, D-102). */
export const STORE_RFQ_ACTIONS: ActionRule<RfqFacts>[] = [
  { key: 'rfq.accept', irreversible: true, when: acceptable },
  { key: 'rfq.post_message', when: open },
  { key: 'rfq.decline', irreversible: true, when: open },
];

/** The RFQ desk's actions (D-100, D-102, D-175). */
export const ADMIN_RFQ_ACTIONS: ActionRule<RfqFacts>[] = [
  { key: 'rfq.assign', permissions: MANAGE, when: open },
  { key: 'rfq.start_review', permissions: MANAGE, when: (r) => r.status === 'submitted' },
  { key: 'rfq.request_info', permissions: MANAGE, when: (r) => open(r) && r.status !== 'quoted' },
  { key: 'rfq.request_factory_cost', permissions: MANAGE, when: open },
  { key: 'rfq.compose_quote', permissions: MANAGE, when: (r) => open(r) && !draft(r) },
  {
    key: 'rfq.send_quote',
    permissions: MANAGE,
    when: (r) => open(r) && draft(r) !== undefined && (draft(r)!.lines.length > 0 || 'rfq.quote_empty'),
  },
  { key: 'rfq.record_acceptance', permissions: MANAGE, irreversible: true, when: acceptable },
  { key: 'rfq.decline', permissions: MANAGE, irreversible: true, when: open },
];
