# B6 — Analytics, reports, launch readiness

> อ่าน `CLAUDE.md`, `00-master-plan.md`, `docs/decisions.md` (D-102, D-111, D-113) ก่อน · 6.1 เริ่มได้เมื่อ B2 มี event แล้ว (ทำคู่ขนานได้) · 6.3 ทำเป็นขั้นสุดท้ายก่อน go-live

---

## Deliverable 6.1 — Demand & growth analytics (D-102)
- Event ingestion from the outbox + frontend analytics events posted through the BFF (page views, configurator steps, quote shown, add to cart, checkout steps) with consent mode (PDPA); nightly rollups into an `analytics` schema (star model: facts for sessions, quotes, RFQs, orders, payments, jobs, shipments, claims; dimensions for date, product type, spec bands, quantity bands, province, channel, campaign, customer segment, factory).
- Dashboards data (admin): traffic & funnel (visit → configure → quote → cart → paid), quotes & RFQs by product type × spec band × quantity band × province, GMV, AOV, conversion, repeat rate, price/lead-time sensitivity (drop-off after quote shown), **unmet demand** (declined/expired RFQs with reason, specs the factory cannot make, capacity-limited dates), factory utilisation and on-time rate, campaign performance.
- **Partner prospectus** export (PDF + XLSX): aggregated and anonymised only — minimum group size k ≥ 5 for any breakdown, no customer identities or individual prices.

## Deliverable 6.2 — Operational reports
Sales, sales tax, payments per channel (fees, VAT, WHT, net, settlement date), orders & quotations, promotion/campaign usage, points liability roll-forward, AR/AP aging, payout history, factory scorecard history, claims; each with filters, xlsx streaming and scheduled email. R2 (D-111): calculate/search/drawing/event-log reports.

## Deliverable 6.3 — Launch readiness (single public launch, D-113)
1. **UAT package**: scripted end-to-end scenarios with the launch factory and internal staff (sandbox payments, real documents in a UAT entity series, payouts to test accounts, GL close for a simulated month) covering every decision group; sign-off sheet per scenario.
2. Security: OWASP ASVS L2 checklist, pen-test fixes, secrets rotation, least-privilege IAM, backups + PITR restore test, DR runbook.
3. Performance: k6 load tests (browse/quote peak, checkout, partner updates) with targets documented; database index review.
4. Accounts & integrations under **Collective Group (Thailand)**: SCB, 2C2P, slip-verification provider, ThaiBulkSMS sender name, LINE OA/Login/LIFF, SES domain (SPF/DKIM/DMARC), Firebase project, carriers (Flash Express, Deliveree), bank bulk-transfer format, web-push VAPID keys.
5. Production settings review (every decision-backed setting listed with its value and owner) and approval matrices loaded.
6. Monitoring & alerts: error rate, latency, queue depth, outbox dead letters, webhook failures, payout/bank file failures, ledger posting failures, SLA breaches.
7. `docs/RUNBOOK.md` (deploy, rollback of the application release, incident response, on-call) and `docs/LAUNCH-CHECKLIST.md` (go/no-go with owners).
