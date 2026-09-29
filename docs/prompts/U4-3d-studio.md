# U4 — Packio 3D Studio (backend)

> อ่าน `CLAUDE.md`, `docs/prompts/00-master-plan.md`, `docs/decisions.md`, `docs/contract/api-conventions.md`, และ `docs/design-tool/studio-spec.md` (สำเนาจาก packio-web) ก่อนทุก session
> ลำดับ: contract นำหน้า frontend U4 ทีละ session · **ทุก session เริ่มด้วย gap analysis** เทียบกับ designs/artwork/proof/quote modules ที่มีอยู่ (B2, B4) · ทุก session ที่แก้ contract ต้อง bump + tag

---

## Goal
Provide every behaviour the studio needs so that **a design becomes a production order without human re-work**: studio documents with versions, real-time quoting from the design, shared print-check rules, server print-PDF + preflight + digital proof, brand kits, collaboration, and funnel analytics.

## U4.B1 — Studio documents & versions
1. Extend `designs` into studio documents: style code + variant, dims with basis, material, print method, print sides, finishes, document JSON (schema-versioned), assets, `version`, `locked_by_order_id`, named versions, ETag concurrency (`If-Match`, 412), autosave endpoint optimised for small patches (JSON Patch), size limits.
2. Lock a version when it is ordered; edits after lock create a new version; orders always reference an immutable version.
3. Asset uploads (presigned multipart, resumable), virus scan, image metadata (pixel size for effective-DPI), private by default, company scope.

## U4.B2 — Quote from design
1. `POST /v1/store/studio/{id}/quote`: derives calculator inputs from the document (style → calculator, blank area/cut/crease/glue from the drawing service, print sides, colour count for flexo from spot layers, finish areas from finish layers, inserts) and returns the same quote object checkout uses, with a `specHash`; cached by `specHash`; rate-limited.
2. Explanations for price changes (diff between the previous and new quote as reason codes).
3. RFQ path pre-filled with the full document for non-instant types.
4. Test: the checkout total for an order created from a studio version equals the studio quote for the same `specHash` (e2e + property test over random documents).

## U4.B3 — Print-check rules shared with the web
1. Rule catalogue (ids, severities, thresholds per print method and material) as effective-dated settings; served to the web (`GET /v1/store/studio/rules`) so both sides use identical thresholds.
2. Server evaluator over the document (fast checks) and over the generated PDF (preflight, B4 ADR-0009) with the same rule ids; results stored per version; acknowledgements stored with user/time.
3. Substrate soft-proof profiles (ICC or simplified transforms) per material served to the web.

## U4.B4 — Print PDF, preflight, digital proof, order hand-off
0. `packio-web` ADR-0009 generates the print PDF **in the browser** (F4). The studio moves generation to the server so preflight and the digital proof run on exactly what is printed: packio-web writes ADR-0012 superseding ADR-0009 in U4.6; keep the browser export for customer downloads only.
1. Worker job on "order this version": render print-ready PDF (vector dieline on spot layers `CutContour`/`Crease`/`Perf`, artwork with bleed, finishes as named spot separations, fonts outlined/embedded, images embedded at placed resolution), run preflight, generate the digital proof (PDF + 3D snapshot), attach to the order line, emit events.
2. `POST /v1/store/studio/{id}/order` (Idempotency-Key): lock version → create cart line or direct order (same checkout rules) → start the job → return job status link (202 + polling/SSE).
3. For studio orders, the proof approval screen confirms the same rendering; approval evidence per B4.
4. B2B: create purchase approval with a share link when the company policy requires it.

## U4.B5 — Brand kit, templates, elements, data blocks
1. Company-scoped brand kits (logos, palettes, font pairs, usage notes) with permissions.
2. Template catalogue (our own) with constraint layouts, tags by use case, availability per style family; admin CRUD + approval.
3. Element library (our own shapes/icons/marks) with a `requires_right` flag for certification marks and a company declaration record.
4. Barcode/QR validation service (check digits, symbology rules) used by both web and preflight.
5. Background removal and upscale-warning workers (self-hosted model or vendor adapter — ADR; images never leave the chosen processor region without a DPA).
6. Font licensing registry: only fonts with print/embedding rights are served to the studio.

## U4.B6 — Collaboration, sharing, analytics
1. Share links with scopes (view/comment/edit), expiry, revocation; comments anchored to face id + UV or flat coordinates; mentions and notifications through the outbox.
2. Funnel analytics facts (studio start, box confirmed, first artwork, checks clean, add to cart, order) and reports against spec §1 targets.
3. Design-service hand-off: create a design-service order from a studio document with the brief pre-filled; designer assignment gives edit access to that document only.

## Definition of Done (each session)
- Contract rebuilt, linted, tagged, and the tag written in PROGRESS for packio-web.
- Unit, integration (Testcontainers), e2e green; property test for quote parity; rule-id parity test with the web fixtures.
- Events for every state change; idempotent order hand-off; no public access to private assets (tests).
