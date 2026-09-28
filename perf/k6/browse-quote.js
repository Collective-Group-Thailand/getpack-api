// Browse & quote peak (B6.3): anonymous visitors browse the catalogue, calculate instant prices and save a
// quotation, while the BFF posts analytics events. Run against the UAT / load environment only (never production
// data): `k6 run -e BASE_URL=https://api.uat.example -e QUOTE_BODY=./payloads/folding-quote.json perf/k6/browse-quote.js`
import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { randomString, uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

import { TARGETS } from './targets.js';

const BASE = __ENV.BASE_URL;
// A folding-carton configuration of the environment (ids of its catalogue), see perf/README.md.
const QUOTE_BODY = JSON.parse(open(__ENV.QUOTE_BODY || './payloads/folding-quote.json'));

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: [
        { target: TARGETS.browse.peakRps, duration: '3m' },
        { target: TARGETS.browse.peakRps, duration: '10m' },
        { target: 0, duration: '2m' },
      ],
    },
  },
  thresholds: {
    'http_req_failed{kind:catalog}': [`rate<${TARGETS.errorRate}`],
    'http_req_failed{kind:calculate}': [`rate<${TARGETS.errorRate}`],
    'http_req_duration{kind:catalog}': [`p(95)<${TARGETS.browse.catalogP95Ms}`],
    'http_req_duration{kind:calculate}': [`p(95)<${TARGETS.browse.calculateP95Ms}`],
    'http_req_duration{kind:save}': [`p(95)<${TARGETS.browse.saveP95Ms}`],
    'http_req_duration{kind:events}': [`p(95)<${TARGETS.browse.eventsP95Ms}`],
  },
};

const json = { headers: { 'Content-Type': 'application/json', 'Accept-Language': 'th' } };

export default function () {
  const anonymousId = `k6${randomString(18)}`;
  const sessionId = `s-${randomString(12)}`;
  group('browse', () => {
    const types = http.get(`${BASE}/v1/store/catalog/product-types`, { tags: { kind: 'catalog' } });
    check(types, { 'product types 200': (r) => r.status === 200 });
    const products = http.get(`${BASE}/v1/store/catalog/products?perPage=24`, { tags: { kind: 'catalog' } });
    check(products, { 'products 200': (r) => r.status === 200 });
  });
  sleep(Math.random() * 2);
  group('quote', () => {
    const calc = http.post(`${BASE}/v1/store/quotes/actions/calculate`, JSON.stringify(QUOTE_BODY), {
      ...json,
      tags: { kind: 'calculate' },
    });
    check(calc, { 'calculate 200': (r) => r.status === 200 });
    http.post(
      `${BASE}/v1/store/analytics/events`,
      JSON.stringify({
        events: [
          {
            eventId: uuidv4(),
            name: 'page_view',
            occurredAt: new Date().toISOString(),
            anonymousId,
            sessionId,
            pagePath: '/configure/folding_carton',
            deviceClass: 'mobile',
          },
          {
            eventId: uuidv4(),
            name: 'quote_shown',
            occurredAt: new Date().toISOString(),
            anonymousId,
            sessionId,
            productTypeCode: 'folding_carton',
            properties: { quantity: 1000, instant: true },
          },
        ],
      }),
      { ...json, tags: { kind: 'events' } },
    );
    // One visitor in ten saves the quotation.
    if (Math.random() < 0.1) {
      const saved = http.post(`${BASE}/v1/store/quotes`, JSON.stringify({ ...QUOTE_BODY, anonymousId }), {
        ...json,
        tags: { kind: 'save' },
      });
      check(saved, { 'save 201': (r) => r.status === 201 });
    }
  });
  sleep(1 + Math.random() * 3);
}
