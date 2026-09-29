# U2 — Update 2026-09-29 (backend): spec model v2, Structure Advisor, target price, samples, trust & self-service

> สำหรับ repo ที่รัน B1–B6 และกำลังทำ U1 · อ่าน `CLAUDE.md`, `docs/prompts/00-master-plan.md`, `docs/decisions.md`, `docs/contract/api-conventions.md`, `docs/benchmark/kumopack-2026-09-29.md` ก่อนทุก session
> **ลำดับ**: ทำ U1 (U-B0 integration, U-B6 calculators) ให้จบก่อน — ยกเว้น U2.1 ที่เริ่มขนานได้หลัง U-B0 tag แรก
> **ทุก session เริ่มด้วย gap analysis** ใน Plan Mode: เขียน/อัปเดต `docs/update-2026-09-29-gap.md` หนึ่งแถวต่อข้อกำหนด → `met | partial | missing` พร้อมหลักฐาน (file:line, endpoint, table) แล้วทำเฉพาะที่ขาด
> ทุก session ที่แก้ contract: bump version, `pnpm contract:build`, `pnpm contract:lint`, tag `vX.Y.Z`, เขียน tag ใน `docs/PROGRESS.md`

---

## Why this update
`docs/benchmark/kumopack-2026-09-29.md` compares Packio with a Thai packaging marketplace that is live today. It lists what we must match (spec rigour, structural guidance, samples, published trust rules) and what we should do better (instant true pricing with honest alternatives, evidence-based guarantee, repeat-order intelligence). This prompt turns §4 of that document into backend work. **Read the benchmark's §5 "what not to copy" before planning** — subscriptions, quotas, factory bidding and paid gating of dielines are out of scope by design.

## Decisions
Each deliverable below needs decision ids. In U2.0 propose them to the user as a numbered list (continuing the current sequence in `docs/decisions.md`), get the user's confirmation of the business rules in **bold** below, then write them into `docs/decisions.md` and reference them in code comments and OpenAPI descriptions as usual. Do not invent business rules silently; where the user has not answered, implement the most conservative option and record the assumption.

---

## U2.0 — Intake session (no code)
1. Gap analysis over §4 of the benchmark against the current modules.
2. Draft decision entries for: measurement basis handling, style code scheme, Structure Advisor safety factors and disclaimer, target-price handling, sample order commercial rules (**is the sample cost credited against the bulk order? who pays freight? how long is a sample quote valid?**), guarantee remedies matrix and claim SLA (**tolerance bands for colour, dimensions, quantity, lead time**), free dieline download policy, call-off/blanket order rules (**deposit, expiry, storage responsibility**), public network statistics (**which aggregate numbers may be published**), **whether sample orders replace or extend the mockup / physical-proof add-on already built in B4.1 (D-072)**, and **which U2–U5 deliverables must be finished before go-live (D-113 single launch) and which ship after launch**.
3. Output: a decisions draft, an implementation order, and the contract impact (new/changed operations) per deliverable.

---

## U2.1 — Specification model v2 (P0)
**Goal**: no order ever leaves an ambiguous dimension or an untraceable style.

1. **Measurement basis**: enum `internal | external | over_crease | product` on every dimensioned spec (configurator input, quote line, order line, design document, job spec snapshot, RFQ). Store dimensions in mm as `numeric`, always with the basis; compute the other bases from the material caliper and the style's construction rules (the dieline engine already knows the geometry — expose a pure conversion service so API and web agree to the millimetre).
2. **Units**: the API stays mm-only; add `unit` only as a display preference on the user profile. Reject requests that send a unit.
3. **Style codes**: a stable public code per style (`PK-<FAMILY>-<NN>`), unique, immutable, in the catalogue, quote, order line, proof, job sheet, partner bundle and every export. Add the international name (RSC, FOL, RTE …) as a separate field where it applies, verified — leave it empty rather than guessing.
4. **Draft configurations**: persist an incomplete configuration with a completeness score (which required fields are missing), resumable, shareable by signed link with an expiry, convertible to a quote or an RFQ.
5. **Tolerances**: expose the applicable dimensional / quantity / colour tolerance for the chosen spec (effective-dated settings) so the storefront can show it before purchase and the claim engine can use the same numbers.
6. Migration + backfill: existing rows get `basis = internal` with a note (assumption recorded); tests prove conversion round-trips within 0.05 mm and that a quote snapshot never changes meaning after a settings change.

## U2.2 — Structure Advisor (P0)
**Goal**: recommend board/caliper with a defensible, auditable explanation; never a black box.

1. New module `advisory`. Input: product weight per unit, units per box, stack height and rows, pallet pattern (optional), fragility band, transport mode (`pickup | parcel_domestic | pallet_domestic | sea_export`), storage humidity band, storage duration band, plus the chosen style and dimensions.
2. Engine: rule set + the McKee relation for BCT from ECT and box perimeter, with **effective-dated safety factors** (humidity, stacking duration, pallet overhang, transport shock) in settings; output an ECT/BCT **range** and required-vs-available margin, never a single promised number.
3. Output: recommended material(s) with reasons (each reason references the factor that produced it), 2–3 alternatives priced through the **real** quote service (cheapest / strongest / fastest) with lead-time deltas, and warnings when the configuration is structurally risky.
4. Everything logged (`advisory_recommendations`: inputs, rule-set version, output, chosen option, quote ids) so the recommendation can be replayed and improved; the customer's final choice is stored on the quote.
5. Wording rule: the API returns reason codes and numbers, not marketing text; the word "AI" appears only if a model is genuinely used (today: rules).
6. Tests: golden cases signed by the business (a table of product/weight/stack → expected board family), property tests that a heavier or taller stack never recommends a weaker board, and a test that every recommendation is reproducible from its log.

## U2.3 — Target price, levers and unmet demand (P1)
1. Optional `target_price_per_unit` on configuration, quote and RFQ (currency THB, decimal).
2. On quote: compute `gap = quoted − target`; when the quote is above target, generate **levers** from the real engine: next quantity break, alternative board/print/finish, longer lead time, different assembly — each with the recalculated price, the trade-off in plain reason codes, and validity.
3. Store `quote_outcomes` (won / lost / expired / converted to RFQ) with the target, the gap, the levers shown and which one was taken.
4. Analytics: unmet-demand facts by product type, region, quantity band and price gap; feed the existing prospectus so partner recruitment and price negotiations use it. No customer's target price is ever exposed to a partner; only aggregates, with the minimum cell size from the setting `analytics.prospectus_min_group_size` (D-160, currently 3) enforced in the query layer and tested — if the business wants a stricter size for target prices, record it as a new decision in U2.0 rather than hard-coding it.

## U2.4 — Sample / prototype orders (P1)
0. Build on what exists: B4.1 already delivers the mockup / physical-proof add-on (D-072) with its own job and charges. Extend that into the sample order kind below according to the U2.0 decision — never two parallel sample paths.
1. New order kind `sample` with its own arc: `requested → quoted → paid → in_production → shipped → delivered → approved | changes_requested | rejected`, linked to the parent configuration and, later, to the bulk order (`bulk_order.sample_order_id`).
2. Pricing through the existing engine with a sample-specific rule set (quantity, setup, no plate amortisation …) — **no new pricing code path**.
3. Production: a `production_job` of type `sample` on the same milestone machinery, with required evidence (photos, measured dimensions, board actually used).
4. Approval: customer approves with evidence (who, when, IP, UA, photo hashes); approval **locks** the spec and the artwork version for the bulk order and pre-fills it.
5. Finance: sample invoicing, and the credit rule from U2.0 implemented as an effective-dated setting with ledger postings and tests (including the case where the bulk order is cancelled after the credit).
6. Claims may reference a sample; scorecard counts sample lead time separately.

## U2.5 — Guarantee, claims transparency and trust data (P1)
1. Publish the remedies matrix as data: `guarantee_policies` (effective-dated) mapping claim type × severity → remedy (reprint / partial credit / refund / goodwill), response SLA and decision SLA; the claim engine reads the same rows, so the public page and the workflow can never disagree. Version every change with an approval (existing approval matrix).
2. Claim timeline API for the customer with SLA countdowns and the current owner; overdue claims raise ops signals.
3. Network statistics endpoint for the public site: audited partner count, audit criteria (content), capability/capacity coverage by region and product type, aggregate on-time-delivery and first-pass-quality over a rolling window — **aggregates only**, with a documented minimum sample size, never a partner's identity or per-order factory.
4. Verified-review collection: only from customers with a delivered order, one per order line, moderated, with the reply workflow; expose aggregate and individual reviews with the order's product type — never fabricate or synthesise reviews (D-181 applies).

## U2.6 — Library, dielines and spec sheets (P2)
> **Precedence:** the style catalogue, search and drawing-service parts are superseded by `U3-style-library.md` (U3.B1, U3.B2, U3.B5). In U2.6 implement only the **packaging spec sheet** (item 3) and the **free dieline download policy** if U3.B5 has not done it yet.
1. Catalogue support for a much larger style library: taxonomy (family, closure, use case, printability), facets, search, favourites per user, and per-style min/max dimensions and material compatibility served from one place (shared with `@packio/dieline`).
2. **Free dieline download**: authenticated endpoint that renders the configured dieline as PDF and DXF (and SVG) via the drawing service, rate-limited per user, watermark-free, logged (`dieline_downloads`) for analytics and abuse control. No plan gating.
3. **Packaging spec sheet** (PDF, th/en) generated for any approved order or approved sample: dimensions with basis, style code and international name, board/material with caliper, print and finishing, tolerances, carton/pallet data, approved artwork thumbnail, QR to the tracking page. Generated by the existing PDF pipeline with embedded Thai fonts.

## U2.7 — Repeat business (P2)
1. **Reorder intelligence**: per SKU (approved spec + artwork version) keep a consumption history; compute a suggested reorder date and quantity (simple moving average + lead time + safety stock, documented formula, no ML), expose it to the storefront and to CS as a task queue; respect notification preferences.
2. **Die/plate reuse**: when reordering an unchanged spec within the tooling's validity, the quote must show the one-off cost as waived, with the reason and the tooling reference; tooling registry (owner, location, validity, condition) maintained with the partner.
3. **Call-off / blanket orders**: one priced commitment with scheduled releases; each release creates a normal order and production job; rules for deposit, expiry, minimum release and who stores the stock come from U2.0; finance handles deferred revenue per the accounting design (confirm with the accountant before implementing postings).
4. **Customer API & webhooks** for B2B accounts: scoped API keys, order create/track, document download, webhook subscriptions with signing and delivery log; documented in the contract with examples.

## U2.8 — Sustainability data (P3, only with real data)
Material recycled content and certifications captured from partner documents with expiry tracking; an estimated material-mass and transport-distance footprint per order using published factors, with the method and factor source shown; no marketing claim is generated by the system.

## U2.9 — Partner portal parity (P2, from benchmark §2.5)
1. **Business hours & closures per factory** (weekly schedule + exceptions) layered on the national holiday calendar (D-161) and the default business hours (D-175), feeding `BusinessTime`, acceptance SLAs (D-074) and promised dates; admin and partner can edit, changes audited and effective-dated.
2. **Payout calendar**: endpoint returning upcoming and past payout runs per partner with the lines they contain (30 % / balance / retention release), expected dates from the payout policy, and status; statements downloadable per run and per purchase order.
3. **Finance views**: the partner billing list available both grouped by purchase order and flattened by payment line, with totals (earned, paid, retained, deducted) that reconcile to the ledger (test).
4. **Partner counters** include sample jobs and open claims that involve the partner.
5. **Partner knowledge base**: CMS content type `partner_guide` (th/en) with categories (print spec, file handling, QC photo standard, packing & labels, payouts), served only to the partner audience.
6. **Release hygiene**: a CI check that fails when production build artefacts or seed data contain debug markers (`[Dev]`, `mock`, `TODO-REMOVE`, test tax ids outside UAT) and when a feature flag default marked `dev_only` is enabled outside local.

---

## Definition of Done (each session — same as U1 plus)
- Gap table updated; decisions written and referenced (`D-###` in code comments and OpenAPI descriptions).
- Contract rebuilt, linted, tagged; `packio-web` told which tag to pin (PROGRESS entry).
- Unit + integration (Testcontainers) + e2e green; golden/property tests where the deliverable computes money, structure or dates.
- Every new configurable value is an effective-dated setting with permission and audit; every state change emits a domain event; every new customer-visible rule has a public representation that reads from the same data.
- No aggregate endpoint can leak an individual partner's or customer's data (tests prove it).
- `docs/PROGRESS.md` entry: done, decisions, deferred, assumptions.
