# Load tests (k6)

Scripts for the B6.3 performance readiness: `browse-quote.js`, `checkout.js`, `partner-updates.js`, with their
targets in `targets.js` and a payload template in `payloads/`. They run with the [k6](https://k6.io) binary against
the UAT / load stack only — never production. How to prepare data, run them and read the results:
`docs/launch/PERFORMANCE.md`.

## Agent portal (P7)

`agent-portal.js` loads the agent zone's reads — leads pipeline (default and follow-up views), one lead, its
timeline, quotes, commissions, statements and the commission forecast — at a constant 50 requests per second
(`AGENT_RPS`) for 5 minutes (`DURATION`), with thresholds p95 < 300 ms per kind and < 1 % errors. Read-only.

1. Seed UAT (`docs/launch/UAT-DATA.md` §6.3): the agent `UATFRE22` signs in with phone OTP `0800000301`.
2. Get an **agent-zone** access token for it just before the run (tokens live 10–15 minutes): sign in on the storefront,
   create a hand-off code (`POST /v1/auth/customer/handoff`, `{ "target": "agent", "fingerprint": "k6" }`) and redeem it
   (`POST /v1/auth/customer/handoff/actions/redeem` with the same fingerprint) — the response's access token is the
   `AGENT_TOKEN`. Never use a production account.
3. Reach the API the way the agent zone's BFF does (server-side), or the per-IP throttles apply to the generator.
4. `k6 run -e BASE_URL=https://api.uat.example -e AGENT_TOKEN=… perf/k6/agent-portal.js`
5. Keep the summary as evidence in `docs/launch/PERFORMANCE.md`.

The query plans behind these endpoints are checked with `perf/sql/agent-portal-explain.sql` (synthetic volume, rolled
back): `psql "$UAT_DATABASE_URL" -v ON_ERROR_STOP=1 -f perf/sql/agent-portal-explain.sql`.
