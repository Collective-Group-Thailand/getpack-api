// Agent portal read load (P7 of docs/design/agent-portal, D-467 / D-468): a signed-in sales agent's list and detail
// screens — leads pipeline, one lead, its timeline, quotes, commissions, statements and the commission forecast — at a
// constant arrival rate (default 50 requests per second). UAT / load stack only, never production:
//   k6 run -e BASE_URL=https://api.uat.example -e AGENT_TOKEN=<access token of a seeded agent> perf/k6/agent-portal.js
// The token is an agent-zone access token (client `agent`) of a UAT agent (`UATFRE22`, docs/launch/UAT-DATA.md §6.3);
// see perf/README.md for how to obtain one. Read-only: the script never writes.
import { check } from 'k6';
import http from 'k6/http';

import { TARGETS } from './targets.js';

const BASE = __ENV.BASE_URL;
const TOKEN = __ENV.AGENT_TOKEN;
const RPS = TARGETS.agent.rps;

export const options = {
  scenarios: {
    agent_reads: {
      executor: 'constant-arrival-rate',
      rate: RPS,
      timeUnit: '1s',
      duration: __ENV.DURATION || '5m',
      preAllocatedVUs: 30,
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_failed: [`rate<${TARGETS.errorRate}`],
    'http_req_duration{kind:list}': [`p(95)<${TARGETS.agent.listP95Ms}`],
    'http_req_duration{kind:detail}': [`p(95)<${TARGETS.agent.detailP95Ms}`],
    'http_req_duration{kind:forecast}': [`p(95)<${TARGETS.agent.listP95Ms}`],
  },
};

const params = (kind, name) => ({
  headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', 'Accept-Language': 'th' },
  tags: { kind, name },
});

const rows = (res) => {
  try {
    const body = res.json();
    return Array.isArray(body?.data) ? body.data : Array.isArray(body?.items) ? body.items : [];
  } catch {
    return [];
  }
};

export function setup() {
  if (!BASE || !TOKEN) throw new Error('BASE_URL and AGENT_TOKEN are required');
  const leads = rows(
    http.get(`${BASE}/v1/store/agent/leads/pipeline?limit=50`, params('list', 'leads.list')),
  );
  const quotes = rows(http.get(`${BASE}/v1/store/agent/quotes?perPage=25`, params('list', 'quotes.list')));
  const statements = rows(http.get(`${BASE}/v1/store/agent/statements`, params('list', 'statements.list')));
  if (leads.length === 0) throw new Error('the agent has no leads — seed UAT first (pnpm db:seed:uat)');
  return {
    leadIds: leads.map((l) => l.id),
    quoteIds: quotes.map((q) => q.id),
    statementIds: statements.map((s) => s.id),
  };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Weighted like the agent app's navigation: lists and the lead detail dominate.
const CALLS = [
  [25, () => ['list', 'leads.list', '/v1/store/agent/leads/pipeline?limit=25']],
  [10, () => ['list', 'leads.list.followUp', '/v1/store/agent/leads/pipeline?view=follow_up_today&limit=25']],
  [20, (d) => ['detail', 'leads.get', `/v1/store/agent/leads/${pick(d.leadIds)}`]],
  [10, (d) => ['list', 'leads.activities', `/v1/store/agent/leads/${pick(d.leadIds)}/activities?limit=20`]],
  [10, () => ['list', 'quotes.list', '/v1/store/agent/quotes?perPage=25']],
  [
    5,
    (d) =>
      d.quoteIds.length ? ['detail', 'quotes.get', `/v1/store/agent/quotes/${pick(d.quoteIds)}`] : null,
  ],
  [8, () => ['list', 'commissions.list', '/v1/store/agent/commissions?perPage=25']],
  [5, () => ['list', 'statements.list', '/v1/store/agent/statements']],
  [
    2,
    (d) =>
      d.statementIds.length
        ? ['detail', 'statements.get', `/v1/store/agent/statements/${pick(d.statementIds)}`]
        : null,
  ],
  [5, () => ['forecast', 'commissions.forecast', '/v1/store/agent/commissions/forecast']],
];
const TOTAL = CALLS.reduce((a, [w]) => a + w, 0);

export default function (data) {
  let roll = Math.random() * TOTAL;
  let call = CALLS[0][1];
  for (const [weight, fn] of CALLS) {
    if (roll < weight) {
      call = fn;
      break;
    }
    roll -= weight;
  }
  const target = call(data) ?? ['list', 'leads.list', '/v1/store/agent/leads/pipeline?limit=25'];
  const [kind, name, path] = target;
  const res = http.get(`${BASE}${path}`, params(kind, name));
  check(res, { [`${name} 200`]: (r) => r.status === 200 });
}
