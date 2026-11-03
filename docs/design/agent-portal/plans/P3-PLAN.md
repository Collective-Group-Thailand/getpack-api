# P3 — lead management for agents · plan (autorun)

Branch `feat/agent-p3-leads` (both repos). Decision D-468 (PLAN A-06, A-10, A-11, A-13). Owner delegated all
decisions; assumptions are recorded here, in `docs/PROGRESS.md` and in D-468. Phase 4 (approval desk, waterfall,
playbook admin, field RBAC) builds on this data model without rework.

## Scope (API)

Operation ids follow the contract rule `<surface>.<resource>.<action>` (3 parts), so the prompt's
`store.agent.leads.check` becomes `store.agentLeads.check`, `store.agent.quotes.create` → `store.agentQuotes.create`,
`store.agent.playbook.get` → `store.agentPlaybook.get`, `store.agent.commissions.forecast` →
`store.agentCommissions.forecast` (same convention as P2's `store.agentPush.*`).

1. **Pipeline on `SalesAgentLead`** (D-417 protection / expiry unchanged). New columns: `stage`
   (`SalesAgentLeadStage` new|contacted|quoted|negotiating|won|lost, default new), `expected_value` numeric(14,2),
   `next_follow_up_at`, `follow_up_reminded_at`, `lost_reason` (`SalesAgentLeadLostReason`), `lost_note`, `source`
   (`SalesAgentLeadSource` manual|card_scan|csv_import|link|staff, default manual), `industry`, `line_id`, `tags[]`,
   `won_at`, `stage_changed_at`. `won` only by the system (`payment.received` / `payment.allocated` of an order group of
   the converted customer or company — a deposit counts). `lost` (agent, reason required) releases the protection at
   once (status `withdrawn`, `closed_reason = lost`, `protected_until = now`) unless already converted.
   `SalesAgentLeadActivity` (append-only trigger `forbid_mutation`): lead, kind (call|line|visit|email|note|quote_sent|
   stage_change|system), body, occurred_at, created_by (user, null for system), data json.
   Quote created → stage `quoted` (from new / contacted); discount requested → `negotiating`.
   Follow-up reminders: worker job every 10 min sends `sales_agent_lead.follow_up_due` at `next_follow_up_at`, never
   inside the quiet hours (setting `agents.follow_up_quiet_hours` 21:00–08:00 Asia/Bangkok — the reminder waits until
   08:00); new agent notification event `follow_up_due` (P2 preference model; in-app, push, LINE, e-mail).
   Endpoints: `store.agentLeads.check` (phone / e-mail / tax id → `{ available, reason: own_lead|unavailable|null,
   leadId }`, never names another agent or a customer — D-440), `store.agentLeads.list` (cursor; filters stage[],
   due today/overdue, source, protection ending, closed, text; sort createdAt|nextFollowUpAt|protectedUntil|updatedAt),
   `store.agentLeads.get` (ETag), existing `store.agent.registerLead` (create) extended with the pipeline fields,
   `store.agentLeads.update` (PATCH, If-Match), `store.agentLeads.changeStage`, `store.agentLeads.addActivity`,
   `store.agentLeads.listActivities` (cursor), existing `store.agent.withdrawLead`, `store.agentLeads.export` (CSV of
   own leads, formula-safe, transient file + 5-min link, audited), `store.agentLeads.importPreview` (CSV text, ≤ 500
   rows, every row through the same checks — dry run stored 24 h) → `store.agentLeads.importCommit`
   (`Idempotency-Key`; rows re-checked at commit). Registering a lead that is another agent's protected lead or an
   existing customer is refused with the one neutral `agents.lead_unavailable` (was `agents.lead_taken` /
   `agents.lead_existing_customer`, D-440).
2. **Quote on behalf.** `SalesAgentQuote` (agent, lead, quote, status sent|opened|accepted|expired|withdrawn,
   sent / opened / accepted / withdrawn timestamps, share token encrypted so the agent can copy the link again).
   `store.agentQuotes.create` prices through `SavedQuotesService.save` with an anonymous store owner (store rules,
   D-441 default spec, instant products only) — the quote has no customer (getpack owns it) — shares it and returns
   `shareUrl` = `${STOREFRONT_BASE_URL}/q/{token}`. `store.quotes.getShared` (`/q/{token}`) now returns `agentCode`
   when the quote was sent by an agent (the web sets the agent cookie like `/a/{code}`) and the first open is recorded
   (`opened`, system activity on the lead). Lead conversion (existing D-417 rule) hands the lead's open agent quotes
   to the new customer so they can order them; `quote.converted` → `accepted` + activity. `list`, `get`, `resend`
   (new link, old one revoked), `withdraw` (link revoked). Agents see sell prices and the quote document only
   (`SavedQuoteDto` of the store) — never cost, margin or factory fields (contract test).
3. **Discount requests with give-get and co-fund.** `SalesAgentDiscountRequest` (round per quote version, one open
   per quote — partial unique index; requested %, reason, give-get: quantity, commitment one_off|call_off + months,
   deposit %, cash within days, lead-time flexibility days, spec change; competitor evidence: file + like-for-like
   spec json; give-get hash). A new round on the same quote needs a changed give-get (`quotes.discount_round_limit`)
   and no open round (`quotes.discount_request_open`). `SalesAgentDiscountOption` (1–3 per round; kind
   standard|co_fund|spiff; discount %, net amount, commission rate / base / amount computed by the API with
   decimal.js; valid until = now + `quotes.discounted_validity_days` (7); acceptance evidence ip / user agent /
   time / snapshot + sha256). Internal `AgentDiscountsService.offerOptions` (P4 calls it; unit-tested): the first
   option is always `standard` at the FULL standard rate (or the registered lock); co-fund < standard; spiff >
   standard. `store.agentQuotes.requestDiscount`, `store.agentQuotes.discountRequests` (rounds + options),
   `store.agentQuotes.acceptOption` (`Idempotency-Key`, audited). PDF conditions line: deferred to P4 (the discounted
   price is applied to a quote only when P4 approves; recorded).
4. **Deal registration.** `SalesAgentDealRegistration` (agent, lead, scope quote|call_off_agreement, call-off
   agreement?, locked first / repeat rate, plan version, approved option?, status registered|won|lost|expired,
   protected_until = now + `agent.deal_protection_days` (90), threshold snapshot json); quotes point to it
   (`sales_agent_quotes.deal_registration_id`). Automatic when the quote's largest commission base ≥
   `agent.deal_registration_threshold` (500000.00); `store.agentQuotes.registerDeal` for smaller ones (no approval —
   protection + rate lock is never a cut). One active registration per lead; the lead's protection is extended to
   the registration's. `AgentCommissionsService.rateLockFor` → accepted option of the order's quote, else the
   registration of the quote (or of the call-off agreement's quote for every call-off). Protection: other agents'
   lead registration / check / import refused neutrally; staff assignment of that customer / company to another
   agent refused (`agents.deal_registered`). Expiry job hourly. Won with the lead; lost when the lead is lost.
5. **Playbook.** `SalesPlaybookCard` (key, version, contexts[], audiences[], title / body th / en, suggested replies
   json, status draft|published|retired, published_at). Seeded from PLAYBOOK.md as **published v1** (the owner's
   approved seed content, PLAN §7 "owner agreed 2026-11-01"); English left empty (falls back to Thai) until Marketing
   writes it. `store.agentPlaybook.get?context=` → published cards for audience `agent`.
6. **Card scan.** File purpose `agent_card_scan` (transient, images ≤ 10 MiB). `store.agentLeads.scanCard`
   `{ fileId }` → OCR (`OcrPort`; adapter `tesseract_cli` running `tesseract … -l tha+eng tsv`, `fake` for tests /
   dev, env `OCR_ADAPTER`, `TESSERACT_PATH`) → parsed fields with confidence (pure parser, unit tests th + en).
   Nothing saved; the image is purged after `agents.card_scan_retention_days` (7) by a daily job.
7. **Commission forecast (F47).** `store.agentCommissions.forecast` → per order: status, expected base, rate,
   expected commission, expected payable date — from the system's real rules (D-466 §5): earned after the claim
   window and full payment, summarised on the 1st of the next month (Bangkok), payable within
   `agents.rules.paymentTermsDays` of approval (approval assumed on the 1st). Not "the 5th" (P-02).
8. Docs: API-CHANGES-P3.md, D-468, PROGRESS.

Settings (effective-dated, audited): `quotes.discounted_validity_days` 7 (sales_manager), `agent.deal_protection_days`
90 (sales_manager), `agent.deal_registration_threshold` 500000.00 (sales_manager), `agents.follow_up_quiet_hours`
21:00–08:00 (sales_manager), `agents.card_scan_retention_days` 7 (PDPA, proposed).

Migrations (each with `down.sql`, rollback tested): `20270105000001_agent_p3_pipeline`,
`20270105000002_agent_p3_quotes_deals`, `20270105000003_agent_p3_playbook`.

## Scope (web — `getpack-web`, after the API; PROMPT lines 430–465)
Agent zone: lead list (views ทั้งหมด · ต้องติดตามวันนี้ · ใกล้หมดสิทธิ์ · ปิดแล้ว; cards / table / optional board, a
"ย้ายไปขั้น…" menu, no drag-only), new lead sheet / dialog with duplicate check on blur and card scan, offline drafts
(IndexedDB), lead detail (timeline, follow-up picker, lost flow), quote on behalf (configurator in agent mode, share),
discount request (give-get first, evidence, playbook beside), deal registration badge, playbook tab, CSV import /
export, commission forecast, teaching empty states. Journeys per the responsive contract.

## Tests
Unit: stage rules, follow-up quiet hours, CSV (formula-safe export, import parsing / row errors), duplicate check
neutrality, card parser (th / en), commission per option + offerOptions rules, give-get change detection, rate lock
resolution, forecast dates, playbook seed parse, guard levels for every new handler, confidentiality contract test
(no cost / margin / factory on every new agent response), notification seeds. e2e specs updated (SKIPPED-DOCKER).

## Risks
- Quotes are write-once snapshots: no agent columns on `quotes` (side table instead).
- A customer who opens the link without signing up with the lead's phone / e-mail cannot order the agent's quote
  (only the lead's conversion hands it over) — they can configure again; recorded.
- OCR quality depends on the host's Tesseract and `tha` data; production image needs `tesseract-ocr` +
  `tesseract-ocr-tha` (ops note).
