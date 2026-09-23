# B4 — Fulfilment: artwork & proofs, designs & drawing, production & QC, logistics, tracking, claims & reorder, LINE

> อ่าน `CLAUDE.md`, `00-master-plan.md`, `docs/decisions.md` (D-013, D-021, D-022, D-070…D-083, D-101, D-114, D-142, D-143, D-151…D-155), `docs/schema-design.md` ก่อน · ต้องมี B3.1–3.2 แล้ว
> ทำทีละ Deliverable (4.1 → 4.6)

---

You are a senior backend engineer on **`packio-api`**. Partner factories are **external suppliers**: Packio issues POs, factories report progress through the partner surface; Packio plans, monitors, alerts and proves.

## Deliverable 4.1 — Artwork, preflight, proofs, design services, designs & drawing
- `artwork_submissions` (order item, version, source `upload | designer | design_service`, files, preflight status + report) → automated **preflight** worker (tooling chosen in an ADR, e.g. Ghostscript/pdfcpu/pdf.js + custom checks): page size vs dieline + bleed, effective resolution, colour mode/spot, fonts embedded/outlined, safe zone, thin lines, overprint, ink coverage; Thai report with thumbnails; **block** on size mismatch or missing bleed, **warn** on low resolution or RGB (D-070).
- `proofs` (version, proof PDF, dieline, prepress author, status `pending_customer | approved | changes_requested | superseded`, decision evidence: who/when/IP/UA/approved file sha256) + `proof_annotations` (page, rect/pin/draw, comment, author, resolved) + version compare metadata. Approval locks and hashes the approved file. Prepress workspace endpoints: queue with SLA, preflight report, upload proof versions, respond to annotations, send template/dieline to customer.
- **Design services** (D-071): hired-design brief (legacy `brd_*` fields + attachments), SLA target 5 / max 10 business days, **3 free revision rounds**, round ≥ 4 is a chargeable add-on (fee = max(THB 500, 20 % of design fee), settings) the customer must pay before work starts; structure/concept change → new design quote.
- **Mockup / physical proof** add-on (D-072) as an order line with its own job.
- **Designs**: design documents (`jsonb`, `schemaVersion`, versions, ETag), assets, semi-design templates; drawing service consuming **`@packio/dieline`** (pinned from GitHub Packages) → dieline SVG/DXF/PDF to S3 + drawing log; auto-send template to the customer after the relevant payment (legacy `sendDrawingAutov2` behaviour). Until the package is published, return `501` with problem `drawing.engine_unavailable` behind a flag.

## Deliverable 4.2 — Production jobs, milestones, QC, capacity, scorecard
- `production_jobs` per (order item, factory): job no, route snapshot, quantities (ordered / good / scrap), status `released | accepted | rejected | in_progress | on_hold | completed | cancelled`, planned/actual dates, promised ship date, priority, lot no, spec snapshot, PO reference (B5 payables).
- **Auto start** (D-073): subscriber re-evaluates the gate on every relevant event — artwork approved **and** before-production instalments paid **and** factory active with capacity **and** the price snapshot still valid → release job + PO (+ event for B5 AP commitment) + notify factory (partner push, LINE, email) + customer "queued for production". CS manual start = permission + reason + audit.
- **Acceptance SLA 1 business day** (D-074, business calendar): accept / reject with reason; overdue → alert + proposal. Reassignment (D-012) only when ≥ 2 active factories serve the type (D-101) and the new factory keeps margin ≥ floor (10 %, setting); otherwise escalate to CS/Partner team. Customer price never changes.
- **Milestones** per product-type route (editable data: e.g. job received → prepress ready → materials ready → printing → finishing → die-cut → gluing/assembly → QC → packing → ready to ship; digital/label/pouch/stock variants) with required evidence (photo / QC form), quantities in/out/scrap, customer-visible flag + customer label.
- **QC**: factory QC checklist with photos (D-076); **Packio inspection sampling** from settings: ≥ THB 300,000 → 100 %; 100,000–299,999 → 20 % random; first 3 jobs of a new factory → 100 %; factory 90-day defect/claim rate > 3 % → 50 %; special finishes or food-contact → +20 pp; ISO 2859-1 level II, AQL 0 / 2.5 / 4.0. Inspection tasks for Packio staff with results feeding the scorecard.
- **Reported delivered quantity** → tolerance evaluation (D-021/D-080) happens in 4.3.
- SLA/at-risk engine (repeatable job): predicted finish vs promise, alerts, daily digest per factory.
- **Scorecard** (D-155) monthly: on-time acceptance, on-time shipping, QC first-pass, claim rate, on-time updates; visible to the factory; used in allocation priority (D-075) when ≥ 2 factories.
- Partner surface: today counters, job list/detail (spec, approved proof & dieline — signed URLs, approved version only), accept/reject, milestone start/complete (Idempotency-Key, quantity validation, client id + timestamp; server wins on conflict), evidence upload, QC, issues, capacity maintenance, users (factory owner), own scorecard. Factory data visibility per D-142.

## Deliverable 4.3 — Logistics, carriers, POD, tolerance (D-013, D-021, D-080, D-114)
- `shipments` (+ items with quantities, events): split & multi-destination; carrier `factory_fleet` (default) or `flash_express` / `deliveree` fallback via `CarrierAdapter`; status `draft | ready | picked_up | in_transit | out_for_delivery | delivered | failed | returned | cancelled`; packing list + carton labels (100×150 mm) with QR → public tracking token.
- **POD mandatory** for factory deliveries (photo + receiver name + signature, or carrier POD) — unlocks payout eligibility (B5).
- **Tolerance**: on delivery confirmation compare delivered vs ordered using the tolerance snapshot from the quote: shortage within tolerance → pro-rata customer credit (event for CN/store credit P19); overage within → no charge; outside → automatic claim (4.5). Factory payable uses actual quantity (P15).
- Shipping blocked when before-shipping instalments are unpaid (B3.2 gate).
- Order completion: all shipments delivered → auto-complete after **7 days** or earlier customer confirmation (D-081).

## Deliverable 4.4 — Timeline, public tracking, web push & realtime events
- Customer timeline (cursor): ordered → paid instalments → artwork/proof → customer-visible milestones with labels and shareable photos → shipments & carrier steps → POD → completed; promised vs actual; no factory identity or costs (D-050).
- Staff timeline: everything + internal notes with @mentions.
- Public tracking `GET /v1/store/track/{token}`: no PII, rate-limited.
- Realtime + web push fan-out for key events (D-143).

## Deliverable 4.5 — Claims & reorder (D-082, D-083, D-153)
- Claims within **7 days** of receipt; types `damaged | wrong_spec | print_defect | quantity_short | late | other`; required product photos **and** shipping-carton photos; requested resolution (reprint, partial/full refund, credit); statuses `submitted → under_review → need_info → factory_review → approved | rejected → resolved → closed`; liability rules (spec/print defect → factory; transit damage → factory as shipper; defects in customer-approved artwork → customer) with override by permission; resolution executes existing mechanisms only (re-production PO, refund, credit note, factory deduction events for B5). Automatic claim from tolerance breach.
- Reorder: from a past order — same spec & approved artwork, re-priced at current cost, quantity editable, proof skipped if artwork unchanged, reusable plate/die-block charges waived (shown), goes to cart.

## Deliverable 4.6 — LINE & notification matrix
- LINE Messaging webhook (signature-verified), OA rich menus, push via the notification service; LINE Login linking; **LIFF APIs** (D-151): order status, slip upload, artwork approval, reorder, points, chat with CS (conversations stored, staff inbox endpoints, realtime).
- Seed the complete **notification routing matrix** (event × audience × channel, D-143/D-144) and all templates (th/en) for customer, staff and factory events across B2–B5; template preview and test send.

Quality: e2e — paid & approved order auto-releases a job → factory accepts → milestones with photos → QC pass (sampling selects the job) → two shipments to two addresses with POD → shortage within tolerance creates a credit event → auto-complete after 7 days (time travel) → claim with photos → factory liable → re-production job; acceptance overdue with one factory escalates (no auto-reassign); IDOR tests on partner endpoints; idempotent milestone updates.
