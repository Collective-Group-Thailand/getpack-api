# Performance readiness — packio-api (B6.3)

> **Audience:** the tech lead and whoever runs the load tests on the UAT / load stack. Targets are **proposed** — no
> decision gives traffic or latency figures — and are confirmed by the business at the go / no-go
> (`docs/LAUNCH-CHECKLIST.md` item 3).

## 1. Scenarios and targets

| Scenario (script) | Load shape | Targets (p95, error rate) |
|---|---|---|
| Browse & quote peak (`perf/k6/browse-quote.js`) | Arrival rate ramping to `PEAK_RPS` (default 30 journeys / s) for 10 min: catalogue, instant calculation, analytics events, 1 in 10 saves the quotation | catalogue < 300 ms · calculate < 800 ms · save < 1 s · events < 250 ms · errors < 1 % |
| Checkout (`perf/k6/checkout.js`) | `CHECKOUT_VUS` (default 20) signed-in customers looping quote → cart → checkout → SCB QR payment (sandbox) for 10 min | cart < 600 ms · checkout < 1.5 s · payment start < 1.2 s · errors < 1 % |
| Partner updates (`perf/k6/partner-updates.js`) | `PARTNER_VUS` (default 10) factory users listing jobs / shipments and posting milestone updates for 10 min | lists < 500 ms · updates < 800 ms · errors < 1 % |

The thresholds live in `perf/k6/targets.js`; k6 exits non-zero when one is missed.

**Why these shapes:** the one launch factory (D-101) limits order volume, so the risk is the storefront — every
configurator change is a server-side calculation (D-050, prices never computed in the browser) — and the burst of
analytics events that comes with it (B6.1). Checkout exercises the money path (idempotency, row locks, the payment
adapter); partner updates the factories' mobile write path (B4.2).

## 2. Running them

1. Deploy the release candidate to the load stack with `INTEGRATIONS_MODE=real` against **sandbox** providers only, or
   `fake` to measure Packio alone. Never against production.
2. Prepare data with the UAT seed: the folding configuration ids of the environment in
   `perf/k6/payloads/folding-quote.json`; one token per test customer in `tokens.txt` and a delivery address id per
   customer in `addresses.txt`; partner tokens of factory users with in-production jobs in `partner-tokens.txt`.
   Tokens are short-lived (10 – 15 min): issue them just before the run.
3. Make sure the load generator reaches the API **through the BFF path the store uses**, or set `X-Forwarded-For` per
   virtual user — otherwise the per-IP throttles apply to the generator (`docs/launch/SECURITY.md` §7 #1).
4. `k6 run -e BASE_URL=https://api.load.example -e QUOTE_BODY=perf/k6/payloads/folding-quote.json perf/k6/browse-quote.js`
   (same pattern for the other two scripts). Keep the summary output and the Grafana / CloudWatch dashboards of the
   run as evidence.
5. While a run is going, watch `GET /v1/admin/ops/signals` (queue depth, outbox backlog) and the database (CPU,
   connections, slow queries).

## 3. Database index review

Done in B6.3 (migration `20261023000001_index_review`, test `test/integration/index-review.int-spec.ts`):

- **Rule:** every foreign key has an index led by its columns, except audit-actor columns (`created_by`,
  `decided_by`, … → `users`; users are anonymised, never deleted or re-keyed) and the partitioned audit / activity logs
  (append-only, queried by time). The test fails when a new foreign key breaks the rule. The two real gaps found —
  `consent_records.purpose_id`, `vendor_deductions.entity_id` — are indexed.
- **Time ranges** the nightly rollups, the operational reports and the prospectus filter on now have indexes:
  `order_groups.placed_at`, `quotes.created_at`, `quotes.converted_at`, `payments.paid_at`, `rfqs.submitted_at`,
  `rfqs.closed_at`, `claims.submitted_at`, `promotion_redemptions.applied_at`, `unmet_demand_records.occurred_at`,
  `shipments.picked_up_at` / `delivered_at`, `production_jobs.released_at`, `orders.shipped_at`,
  `payout_runs.pay_on` (partial where the column is nullable).
- **Partitioned logs** (`audit_logs`, `activity_logs`, `calculate_logs`, `search_logs`, `analytics.raw_events`) are
  kept three months ahead by `partitions.ensure`; queries on them must filter by time.
- **After the load runs:** enable `pg_stat_statements` on the load stack, list the top 20 statements by total time and
  mean time, and `EXPLAIN (ANALYZE, BUFFERS)` any above 50 ms mean; record them here with the index or rewrite chosen.

| Statement (normalised) | Mean ms | Calls | Action |
|---|---|---|---|
| | | | |

## 4. Capacity notes

- API and worker are one image, two services; scale the API on CPU and the worker on queue depth
  (`queue_depth` signal). PDF rendering (Chromium) runs in the worker only.
- Connection budget: each process holds a Prisma pool; keep `(API tasks + worker tasks) × pool size` below the RDS
  `max_connections` minus 20 % for admin and migrations.
