// Partner updates (B6.3): factory users list their jobs and shipments and post milestone updates. Uses factory
// accounts and in-production jobs prepared by the UAT seed (PARTNER_TOKENS, one per line). Milestone posts carry a
// fresh `clientRef` so replays are safe (B4.2 idempotent partner updates).
// `k6 run -e BASE_URL=… -e PARTNER_TOKENS=./partner-tokens.txt perf/k6/partner-updates.js`
import { check, sleep } from 'k6';
import http from 'k6/http';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

import { TARGETS } from './targets.js';

const BASE = __ENV.BASE_URL;
const TOKENS = open(__ENV.PARTNER_TOKENS).split('\n').filter(Boolean);

export const options = {
  scenarios: {
    partners: { executor: 'constant-vus', vus: TARGETS.partner.vus, duration: '10m' },
  },
  thresholds: {
    http_req_failed: [`rate<${TARGETS.errorRate}`],
    'http_req_duration{kind:list}': [`p(95)<${TARGETS.partner.listP95Ms}`],
    'http_req_duration{kind:update}': [`p(95)<${TARGETS.partner.updateP95Ms}`],
  },
};

export default function () {
  const auth = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKENS[(__VU - 1) % TOKENS.length]}`,
    },
  };
  const jobs = http.get(`${BASE}/v1/partner/production-jobs?perPage=25`, { ...auth, tags: { kind: 'list' } });
  check(jobs, { 'jobs 200': (r) => r.status === 200 });
  http.get(`${BASE}/v1/partner/shipments?perPage=25`, { ...auth, tags: { kind: 'list' } });
  const job = (jobs.json('data') || []).find((j) => j.status === 'in_production');
  if (job) {
    const detail = http
      .get(`${BASE}/v1/partner/production-jobs/${job.id}`, { ...auth, tags: { kind: 'list' } })
      .json();
    const next = (detail.milestones || []).find((m) => m.status === 'in_progress' || m.status === 'pending');
    if (next) {
      // `start` is idempotent for a milestone already started; the load is the write path, not the progression.
      const res = http.post(
        `${BASE}/v1/partner/production-jobs/${job.id}/milestones/${next.id}`,
        JSON.stringify({ action: 'start', clientRef: uuidv4() }),
        { ...auth, tags: { kind: 'update' } },
      );
      check(res, { 'update 200/409': (r) => r.status === 200 || r.status === 409 });
    }
  }
  sleep(3 + Math.random() * 5);
}
