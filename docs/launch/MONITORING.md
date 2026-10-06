# Monitoring & alerts — packio-api (B6.3 item 6)

> **Audience:** the on-call engineer and the tech lead. Two sources feed the alerts: the **APM** (OpenTelemetry traces
> and metrics, Sentry errors, CloudWatch for AWS resources) for request-level health, and the **operational signals**
> of the API (`GET /v1/admin/ops/signals`, permission `ops.read`) for the asynchronous work the APM cannot see. The
> worker job `ops.alerts` (every 5 min) raises `ops.alert_raised` for any signal at or above its threshold — at most
> once an hour per signal — and the notification matrix tells every Superadmin and Admin in-app and by e-mail.
> Thresholds are the setting `ops.alert_thresholds` (proposed values; a Superadmin changes them as new versions).

## 1. Required alerts

| Alert (B6.3 list) | Source | Condition (proposed) | Severity | First response (`docs/RUNBOOK.md`) |
|---|---|---|---|---|
| Error rate | APM: HTTP server spans / Sentry | 5xx > 1 % of requests over 5 min, or > 20 errors / min | Page | §4.1 |
| Latency | APM: `http.server.duration` p95 per route group | Above `docs/launch/PERFORMANCE.md` targets for 10 min | Page (store, checkout, webhooks) · ticket (admin) | §4.2 |
| Queue depth | Signal `queue_depth` | ≥ 1,000 waiting jobs | Page | §4.3 |
| Outbox dead letters | Signal `outbox_dead_letters` | ≥ 1 | Page (business hours) | §4.4 |
| Outbox backlog | Signal `outbox_backlog_minutes` | Oldest due message ≥ 15 min | Page | §4.3 |
| Webhook failures | Signal `webhook_failures_24h` | ≥ 5 in 24 h | Ticket; page if payments | §4.5 |
| Payout / bank-file failures | Signal `payout_item_failures_7d`; payout runs `partially_failed` | ≥ 1 | Finance + on-call, same day | §4.6 |
| Ledger posting failures | Signal `ledger_posting_failures` (dead letters of `ledger.*` consumers) | ≥ 1 | Finance Manager + on-call, same day (the books miss an event) | §4.4 |
| SLA breaches | Signals `acceptance_overdue` (D-074), `production_at_risk`, `rfq_first_response_overdue`, `approvals_overdue`, `slip_verification_wait_hours` (D-061: 4 business hours; the signal counts wall-clock hours, so it may fire early outside business hours), `claim_response_overdue` / `claim_decision_overdue` (D-263, U2.5; existing environments add both keys to `ops.alert_thresholds`) | ≥ 1 / 5 / 1 / 5 / 4 / 1 / 1 | Notice to the owning team (Partner, CS, approvers, Finance); on-call only if the signal is `unknown` | §4.7 |
| CS conversations | Signal `conversation_first_response_overdue` — live CS threads whose first customer message is past its first-response due time (D-221, D-300, U5.B2) | ≥ 1 | Notice to CS / CS Lead; on-call only if `unknown` | §4.7 |
| Journey conversion | Signal `journey_conversion_drops` — scorecard journeys whose first-to-last conversion fell more than `analytics.journey_drop_alert_pct` (15) week over week with ≥ `analytics.journey_alert_min_sessions` (30) sessions (D-303, U5.B6; checked on Mondays, Bangkok) | ≥ 1 | Notice to Marketing and the product owner; never pages | — (product review, not an incident) |

A signal whose source cannot be read (e.g. Redis down for `queue_depth`) is `unknown` and alerts like a breach.

## 2. Infrastructure alerts (CloudWatch)

| Resource | Condition | Severity |
|---|---|---|
| ECS services (api, worker) | Running tasks < desired for 5 min; task restarts > 3 / 15 min | Page |
| RDS | CPU > 80 % 10 min; free storage < 15 %; connections > 80 % of max; replica lag > 60 s | Page |
| ElastiCache Redis | Memory > 80 %; evictions > 0 (BullMQ and idempotency keys must not be evicted — `maxmemory-policy noeviction`) | Page |
| ALB | 5xx from targets; unhealthy targets; TLS certificate < 21 days to expiry | Page / ticket |
| SES | Bounce rate > 2 %, complaint rate > 0.05 % (account at risk) | Ticket, same day |
| S3 | 4xx / 5xx spike on the files bucket | Ticket |

## 3. Dashboards

- **Store health:** request rate, p95 and 5xx by route group (catalogue, calculate, quotes, cart, checkout, payments,
  analytics events), from the APM.
- **Async health:** the ops signals over time (a CloudWatch custom metric can scrape `GET /v1/admin/ops/signals` with a
  service account holding only `ops.read`), BullMQ queue sizes, outbox status counts.
- **Business pulse:** the admin analytics dashboards (B6.1) — they are nightly, so they are not alerting sources.

## 4. On-call

- Rota and escalation: `docs/RUNBOOK.md` §6. Pages go to the on-call engineer (phone), tickets to the team board;
  `ops.alert_raised` e-mails reach Superadmins and Admins as a second channel.
- Every page gets an incident note (`docs/RUNBOOK.md` §4) within one business day.
