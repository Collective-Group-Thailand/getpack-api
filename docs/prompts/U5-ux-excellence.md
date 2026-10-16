# U5 — UX excellence layer (backend support)

> อ่าน `CLAUDE.md`, `00-master-plan.md`, `docs/decisions.md`, `docs/contract/api-conventions.md`, และ `getpack-web/docs/ux/*.md` (สำเนาไว้ที่ `docs/ux/`) ก่อนทุก session
> ทำก่อน frontend U5 ที่เกี่ยวข้องหนึ่งก้าว · **ทุก session เริ่มด้วย gap analysis** · แก้ contract ต้อง bump + tag

## U5.B1 — Context & personalisation endpoints
1. `GET /v1/store/me/launchpad`: last designs, reorder candidates, orders needing action with the next action, recommended next step — one call for the signed-in home.
2. Defaults service: last address, company tax profile, last material/print method per product type, brand kit presence — used to pre-fill configurator, studio and checkout.
3. Signed deep-link tokens for notifications (open exact screen, short expiry, single-purpose).

## U5.B2 — Messaging
0. **Extend the conversations and LINE chat built in B4.6** (tables, staff inbox, LINE merge) — gap-analyse first; add only what is missing below, never a second messaging store.
1. `conversations` (customer, company, subject type: order | design | rfq | support), `messages` (text, attachments, context cards), participants, read receipts, SLA fields, assignment, internal notes (staff only), canned responses.
2. Merge LINE OA messages into the customer's thread when the LINE account is linked; outbound replies to LINE when the customer prefers it.
3. Outbox events for new messages; notification preferences respected; attachments through the files module (private, scanned).
4. Staff inbox APIs with filters, assignment and SLA timers; analytics on first-response and resolution time.

## U5.B3 — Multi-item RFQ basket
1. `rfq_baskets` + items (each a configured spec snapshot + optional design version), single submission, one conversation, per-item quote responses, conversion of accepted items into cart lines with the quoted price and validity.

## U5.B4 — Dieline export for designers
1. PDF export with named layers/spot swatches (`CutContour`, `Crease`, `Perf`, `Bleed`, `Safe`, `Glue`), document title and style code in metadata; DXF and SVG unchanged; tests open the PDF and assert layer names.

## U5.B5 — Assistant backend (behind flag)
1. Tool-calling service exposing only existing, permission-checked operations: style search, advisor, quote, order status (own orders only), glossary, help search (pgvector over our own articles), create CS hand-off.
2. Guardrails: facts (price, date, strength, policy) must originate from a tool result in the same turn — enforced by response validation; refuse other customers' data; rate limits; cost ceiling per session.
3. Evaluation harness with ≥ 100 Thai cases, red-team set, nightly run, dashboard; logs stored per PDPA retention with opt-out.
4. Model/vendor choice and data-processing terms recorded in an ADR before enabling in any environment.

## U5.B6 — Analytics for the scorecard
1. Funnel facts and step events from the web (validated schema), dashboards per journey, week-over-week drop alerts through ops signals.
2. Export for scorecard rounds (anonymised).

## Definition of Done
Contract tagged; unit/integration/e2e green; IDOR tests on conversations and launchpad; assistant evaluation pass rate met before the flag can be enabled outside local.
