# U3 — Style Library at scale (backend)

> อ่าน `CLAUDE.md`, `docs/prompts/00-master-plan.md`, `docs/decisions.md`, `docs/contract/api-conventions.md`, `docs/benchmark/kumopack-2026-09-29.md` และ `packio-web/docs/design-tool/style-library-program.md` (คัดลอกไว้ที่ `docs/design-tool/` ของ repo นี้ด้วย) ก่อนทุก session
> ลำดับ: หลัง U-B0 · ทำขนานกับ packio-web U3 ได้ โดย contract นำหน้า · **ทุก session เริ่มด้วย gap analysis** · ทุก session ที่แก้ contract ต้อง bump + tag

---

## Goal
Serve a library of **105 base structures / 960 structural variants** (`style-library-master.json`) where each published variant is (1) buildable by `@packio/dieline`, (2) priced by an instant calculator or routed to RFQ, and (3) makeable by at least one active partner. The API is the authority on what is published.

## U3.B1 — Catalogue model for recipes and variants
1. Tables (additive): `style_bases` (code `PK-…`, family, category, product type, names th/en, construction text, reference code + `reference_verified` bool, wave, status), `style_recipes` (versioned JSON recipe from `@packio/dieline`, schema version, checksum, approved_by/at), `style_variants` (base, option values as a normalised key e.g. `top=reverse_tuck;bottom=crash_lock;hang=euro_slot;window=none`, generated code suffix, publishable flag, reasons when not publishable), `style_assets` (thumbnail 2D/3D, dieline SVG, manifest; S3 keys + hashes), `style_synonyms` (th/en search terms), `style_use_cases`.
2. Import command `pnpm styles:import <path-to-master.json | recipes bundle>` — idempotent, versioned, dry-run diff, approval required for changes to published variants (approval matrix engine).
3. Store options as data; never create a column per option.

## U3.B2 — Search & library read API
1. `GET /v1/store/styles` with facets (category, closure, feature, use case, material class, printability, price path, size range) and counts per facet, cursor pagination, sort (popular, new, instant first), Thai/English search with synonyms and typo tolerance (Postgres full-text + trigram; pgvector optional for "describe your product" search later).
2. `GET /v1/store/styles/{code}` with variants, valid option combinations, size ranges **per material** (from the recipe constraint solver results cached per material), starting price (from the quote engine for a typical size and quantity, with the assumptions returned), lead-time range, partners count (number only), assets.
3. Favourites per customer; compare endpoint for up to 3 styles.
4. Admin endpoints for curation (feature, hide, reorder, edit copy) with audit.

## U3.B3 — Capability matrix (which partner can make what)
1. **Extend the capability matrix B2.2 already built** (additive tables/columns; one source of truth, same approval and site-visit verification) to: per partner × material class × process (die-cut flatbed/rotary, slotter, folder-gluer types (straight-line, crash-lock, 4/6-corner), window patching, rigid box line, pouch making, label press, shrink sleeve) × max/min blank size, max caliper, min run, lead-time band — maintained in the partner zone and verified by site visit.
2. Each module in a recipe declares the processes it needs (crash-lock needs a crash-lock capable folder-gluer; window needs window patching …). A variant is **makeable** when at least one active partner has every required process and its blank fits the partner envelope for the requested size.
3. Nightly job recomputes `style_variants.publishable` and records reasons; coverage report per category for the admin and for the partner prospectus ("styles we cannot make yet" = recruitment targets).

## U3.B4 — Pricing path mapping
1. Each base maps to a calculator (`folding`, `corrugate`, `label`, `tag_sleeve`, `pouch`, `standard_product` — stock items only, `service`) or to a type **without** a calculator (`rigid`, `paper_bag`, `mailer`, `shrink_sleeve` → always RFQ, D-100), as the master file's `product_type` says, and the parameters that calculator needs (e.g. blank area from the dieline, number of glue points, window area, insert pieces).
2. The quote engine receives dieline-derived quantities from the drawing service (blank W×H, cut length, crease length, glue-line length, window area, piece count) so prices reflect the actual structure, not only L×W×H. Port rules stay as signed off in the pricing validation docs — **no new formulas without a signed validation doc**.
3. Variants whose calculator is not signed yet return `rfq_required` with the reason; the RFQ is pre-filled with the style code and options.

## U3.B5 — Drawing & asset service
1. Extend the drawing service to build any recipe via `@packio/dieline` (pinned version), produce SVG / PDF / DXF, the dieline-derived quantities (U3.B4), and 2D/3D thumbnails through a worker job (headless GL or pre-rendered by the web package pipeline — choose in an ADR).
2. Cache by (recipe version, dims, material) hash; invalidate on recipe version change.
3. Free, rate-limited dieline download (per U2.6) for any publishable variant.

## U3.B6 — Growth loops
1. **Partner dieline intake**: upload DXF/PDF with permission terms, prepress workflow (match to recipe → deviation report → approve as recipe or fixed template), provenance stored.
2. **Structural design requests** from customers: request, assignment to a structural designer, quote for the design service if applicable, approval, publication, notify requester.
3. **Demand signals**: zero-result searches, RFQs for unlisted structures, target-price misses → monthly "next styles" report in admin analytics.

## Definition of Done (each session)
- Migrations additive; import idempotent with diff; contract rebuilt, linted, tagged.
- Unit, integration (Testcontainers) and e2e green; capability and publishability logic covered by table-driven tests; a test proves an unpublishable variant can never be quoted instantly or ordered.
- Counts in `docs/PROGRESS.md`: bases, variants, publishable variants, per category, partners covering each process.
- No third-party template, model, image or wording imported (review checklist).
