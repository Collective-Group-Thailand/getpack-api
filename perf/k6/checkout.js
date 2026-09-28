// Checkout (B6.3): signed-in (fake) customers save a quotation, add it to the cart, place the order group and start
// an SCB QR payment in the sandbox. Customers are pre-issued by the UAT seed (CUSTOMER_TOKENS, one per line) —
// OTP sign-in is rate limited per IP on purpose (auth.otp_policy) and is not part of this scenario.
// `k6 run -e BASE_URL=… -e CUSTOMER_TOKENS=./tokens.txt -e ADDRESS_IDS=./addresses.txt perf/k6/checkout.js`
import { check, fail, group, sleep } from 'k6';
import http from 'k6/http';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

import { TARGETS } from './targets.js';

const BASE = __ENV.BASE_URL;
const TOKENS = open(__ENV.CUSTOMER_TOKENS).split('\n').filter(Boolean);
const ADDRESSES = open(__ENV.ADDRESS_IDS).split('\n').filter(Boolean);
const QUOTE_BODY = JSON.parse(open(__ENV.QUOTE_BODY || './payloads/folding-quote.json'));

export const options = {
  scenarios: {
    checkout: { executor: 'constant-vus', vus: TARGETS.checkout.vus, duration: '10m' },
  },
  thresholds: {
    http_req_failed: [`rate<${TARGETS.errorRate}`],
    'http_req_duration{kind:cart}': [`p(95)<${TARGETS.checkout.cartP95Ms}`],
    'http_req_duration{kind:checkout}': [`p(95)<${TARGETS.checkout.checkoutP95Ms}`],
    'http_req_duration{kind:payment}': [`p(95)<${TARGETS.checkout.paymentP95Ms}`],
  },
};

export default function () {
  const i = (__VU - 1) % TOKENS.length;
  const auth = { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[i]}` } };
  group('checkout', () => {
    const quote = http.post(`${BASE}/v1/store/quotes`, JSON.stringify(QUOTE_BODY), {
      ...auth,
      tags: { kind: 'cart' },
    });
    if (!check(quote, { 'quote 201': (r) => r.status === 201 })) fail('quote not saved');
    const q = quote.json();
    const option = q.options[0];
    const add = http.post(
      `${BASE}/v1/store/cart/items`,
      JSON.stringify({
        quoteId: q.id,
        quoteOptionId: option.id,
        designOption: 'own_file',
        destinations: [{ addressId: ADDRESSES[i], quantity: option.quantity }],
      }),
      { ...auth, tags: { kind: 'cart' } },
    );
    check(add, { 'cart 201': (r) => r.status === 201 });
    const placed = http.post(`${BASE}/v1/store/checkout`, '{}', {
      headers: { ...auth.headers, 'Idempotency-Key': uuidv4() },
      tags: { kind: 'checkout' },
    });
    if (!check(placed, { 'checkout 201': (r) => r.status === 201 })) return;
    const pay = http.post(
      `${BASE}/v1/store/order-groups/${placed.json('id')}/payments`,
      JSON.stringify({ method: 'scb_qr' }),
      {
        headers: { ...auth.headers, 'Idempotency-Key': uuidv4() },
        tags: { kind: 'payment' },
      },
    );
    check(pay, { 'payment 201': (r) => r.status === 201 });
  });
  sleep(2 + Math.random() * 4);
}
