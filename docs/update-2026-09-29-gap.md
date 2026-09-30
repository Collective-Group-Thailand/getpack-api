# Update 2026-09-29 (U1 + U2) — gap analysis

Session 0 of every U-B session (`docs/prompts/U1-update-2026-09-29.md`) and every U2 session (`docs/prompts/U2-benchmark-2026-09-29.md`): one row per requirement → `met | partial | missing`, the evidence, and what the session changes. Requirements already `met` are not touched. Newest session on top.

## U2.0 — benchmark §4 intake (2026-09-30, no code)

Scope: every requirement of U2.1–U2.9 (benchmark `docs/benchmark/kumopack-2026-09-29.md` §4 and §2.5) against the code at `32a03c7` (contract `v0.3.0`, 757 paths). U3, U4 and U5 run their own gap analyses in their sessions; their business decisions are collected here (RUN-ORDER §3). **Totals: 44 requirements — 0 met, 18 partial, 26 missing** (quantity tolerance, inside 1.8, is met end to end). "Session" = where the work lands.

### U2.1 — Specification model v2
| # | Requirement | Before | Evidence | Session |
|---|---|---|---|---|
| 1.1 | Measurement basis on every dimensioned spec (configurator, quote, order line, design, job snapshot, RFQ) | missing | No basis anywhere (grep `measurement_?basis`, `over_?crease`, `inside_?dim`: 0 hits). Dimensions are unlabelled mm: `FoldingConfigurationDto` w/l/d (`src/modules/pricing/quotes/quote.dto.ts:173-180`), `CorrugateConfigurationDto` (`corrugate.dto.ts:143-150`), quote `input` jsonb (`prisma/schema/pricing.prisma:533`, built `saved-quotes.service.ts:107-111`), `rfqs.length_mm/width_mm/height_mm` (`pricing.prisma:696-698`), `design_documents.*_mm` (`fulfilment.prisma:441-443`), `drawing_jobs.*_mm` (`:525-527`), `production_jobs.spec_snapshot` copies the configuration (`production.service.ts:299-311`); order lines hold no dimensions (`commerce.prisma:683-728`); quote PDF prints "w × l × d มม." without a basis (`quote-pdf.service.ts:79`) | U2.1 |
| 1.2 | Pure conversion service between bases from caliper + construction rules | missing | Flute take-ups `flute_types.col_*`, `ct` (`catalog.prisma:639-646`) are used only inside `calculators/corrugate/geometry.ts:17-25,161-166`; `standard_sizes.calc_*_mm` is a legacy per-flute calculation size (`catalog.prisma:470-474`); dieline port has no basis or caliper (`src/integrations/dieline/dieline-engine.port.ts:10-16`) | U2.1 |
| 1.3 | API mm-only, requests with a unit rejected; display unit on the profile | missing | All lengths fixed mm; only quantity `ProductUnit` exists (`catalog.prisma:110-121`); profile has `users.locale` only (`iam.prisma:140`) and `UpdateCustomerProfileDto` cannot change even that (`customers.dto.ts:462-474`) | U2.1 |
| 1.4 | Stable public style code `PK-<FAMILY>-<NN>`, immutable, carried to quote / order line / proof / job sheet / partner bundle / exports | partial | `patterns.code` unique (`catalog.prisma:500`) but **editable** (`product-structure.resources.ts:649`); `sub_patterns` has no code (`:545-584`); exposed only in store catalogue / configurator (`store-configurator.service.ts:63`, `store-catalog.service.ts:174`); quote snapshot keeps `patternId` only; order line descriptions generic (`checkout/order-pricing.ts:150-153`); job view passes configuration through (`job-views.ts:59-75`) | U2.1 (U3.B1 owns `style_bases`) |
| 1.5 | International name (RSC, FOL, …) as a separate verified field, empty rather than guessed | missing | Only free-text `patterns.technical_name` (`catalog.prisma:502`); FEFCO references exist only in `docs/design-tool/style-library-master.csv` | U2.1 / U3.B1 |
| 1.6 | Draft configurations: persisted while incomplete, completeness score, resumable | missing | A quote is saved only when priced (`saved-quotes.service.ts:101`, `quotes.nothing_to_save`); `QuoteStatus` has no draft (`pricing.prisma:503-512`) | U2.1 |
| 1.7 | Share by signed link with expiry; convertible to quote or RFQ | partial | `store.quotes.share` / `getShared` with a hashed token (`quotes.controller.ts:126-199`, `pricing.prisma:539`) — **no expiry, still resolves after the quote expired or converted** (`saved-quotes.service.ts:247`); quote → cart only (`quote-conversion.service.ts`); no quote → RFQ path (only `rfqs.routed_from_calculate_log_id`, `pricing.prisma:709`) | U2.1 |
| 1.8 | Applicable dimensional / quantity / colour tolerance exposed before purchase, same numbers as the claim engine | partial | **Quantity: met** — `factory_tolerance_policy_versions` (`partners.prisma:931-975`) + setting `fulfilment.tolerance_default_pct` (D-163) → `QuoteStepDto.tolerance*Pct` (`quote.dto.ts:360-370`) → `quote_options` → `orders` → `production_jobs.tolerance_*_pct` → `delivery.service.ts:247-249` → auto-claim (`claims.service.ts:313-339`). **Dimensional and colour: missing** (grep `deltaE`, `colour_tolerance`: 0). **RFQ-accepted quotes freeze no tolerance** (`rfqs.service.ts:262-294`), so delivery reconciles at 0 % (`delivery.service.ts:248`) — finding F2 | U2.1 |
| 1.9 | Backfill `basis = internal`; conversion round-trip ≤ 0.05 mm; quote snapshot meaning stable after settings change | missing | — (depends on 1.1–1.2) | U2.1 |

### U2.2 — Structure Advisor
| # | Requirement | Before | Evidence | Session |
|---|---|---|---|---|
| 2.1 | `advisory` module with load, stacking, fragility, transport, humidity, storage inputs | missing | No module (`ls src/modules`); no transport-mode enum; weight / stacking only in shipping packing settings (`setting-keys.ts:35-37`, `shipping/packing/corrugate-packing.ts:58-77`) | U2.2 |
| 2.2 | Rule set + McKee BCT from ECT, effective-dated safety factors, output a range | missing | grep `ECT`, `BCT`, `mckee`, `edge crush`: 0; `materials.strength` is a free 64-char label (`catalog.prisma:683`, `import-kinds.ts:150`) — **no typed board strength data to compute from** | U2.2 |
| 2.3 | Recommendation + 2–3 alternatives priced by the real quote engine, warnings | missing | Quote engine reusable (`quote-engine.service.ts`) | U2.2 |
| 2.4 | `advisory_recommendations` log, replayable; choice stored on the quote | missing | — | U2.2 |
| 2.5 | Reason codes only; "AI" only if a model is used | missing | — | U2.2 |
| 2.6 | Signed golden cases, monotonicity property tests, reproducibility test | missing | — | U2.2 |

### U2.3 — Target price, levers, unmet demand
| # | Requirement | Before | Evidence | Session |
|---|---|---|---|---|
| 3.1 | Optional `target_price_per_unit` on configuration, quote, RFQ | missing | grep `target_?price`, `budget`: 0; RFQ has `target_date` only (`pricing.prisma:699`) | U2.3 |
| 3.2 | Gap + levers recomputed by the real engine | missing | — | U2.3 |
| 3.3 | `quote_outcomes` (won / lost / expired / converted to RFQ) | partial | Quotes: `expired` / `converted` only (`pricing.prisma:503-512`); RFQs: `declined` / `expired` + reasons incl. `price_not_competitive` (`prisma/seed/data/quotes.ts:8`) | U2.3 |
| 3.4 | Unmet-demand facts by type, region, quantity band, price gap → prospectus; min cell size enforced in the query layer | partial | `unmet_demand_records` (`pricing.prisma:881-905`) filled by `unmet-demand.subscriber.ts:24,49`; `analytics.fact_unmet_demand` (`prisma/migrations/20261021000001_analytics/migration.sql:391-405`); `admin.analytics.unmetDemand`; k from `analytics.prospectus_min_group_size` (`setting-keys.ts:77`, seeded 3) applied only to prospectus exports (`prospectus.service.ts:101,247`, `k-anonymity.ts:43`); no price-gap dimension | U2.3 |

### U2.4 — Sample / prototype orders
| # | Requirement | Before | Evidence | Session |
|---|---|---|---|---|
| 4.0 | Build on the D-072 mockup add-on — one sample path | partial | Mockup exists: `orders.mockup_option` (`commerce.prisma:69,544`), `OrderLineType.mockup` (`:125-137`), `JobKind.mockup` + one live mockup job per order (`fulfilment.prisma:566,816`), `PoKind.mockup` (`finance.prisma:1274`), seeded `mockup` route with photo evidence (`prisma/seed/data/fulfilment.ts:81-89`), CS-priced `admin.artwork.addMockup` (`src/modules/artwork/mockups.controller.ts:59-73`) → fixed-amount instalment (`mockups.service.ts:40-56`), released on payment (`production.service.ts:211-233`). **Gaps (finding F4):** not shippable (`logistics/shipments.service.ts:98`), no customer approval, bulk production not held (`production.service.ts:145-148`), `free_mockup` perk unused (`promotion-engine.ts:49,300`), excluded from inspections / scorecards (`production-oversight.service.ts:48,434,456`) | U2.4 |
| 4.1 | Order kind `sample` with its own arc, linked to configuration and to the bulk order | missing | No order kind (`commerce.prisma:522`; grep `order_kind`, `sample_order`: 0) | U2.4 |
| 4.2 | Priced by the existing engine with a sample rule set — no new pricing path | missing | Mockup price is typed in by CS; no calculator | U2.4 |
| 4.3 | `production_job` of type sample with evidence (photos, measured dimensions, board used) | partial | Milestone machinery + photo / QC evidence (`fulfilment.prisma:557,648-721`, `milestones.service.ts:167-181,289-308`); no structured measured-dimension / board-used fields | U2.4 |
| 4.4 | Approval with evidence; locks spec + artwork for the bulk order | partial | Pattern exists on proofs (`fulfilment.prisma:242-270`, `artwork/proofs.service.ts:268-290`: user, time, channel, IP, UA, file sha256) and reorder lock (`orders.reuse_artwork_proof_id`); nothing for samples | U2.4 |
| 4.5 | Sample invoicing; credit rule as an effective-dated setting with postings and tests | partial | Add-on charges reusable (`order-charges.service.ts:27,52`); store-credit ledger exists (`finance.prisma:1171-1215`, `store-credit.service.ts`) but **nothing applies credit to a later order** — it is only debited on a refund (`banking.service.ts:655`); `PaymentMethod.store_credit` (`commerce.prisma:902`) has no handler (finding F3) | U2.4 |
| 4.6 | Claims reference samples; scorecard counts sample lead time separately | missing | Mockups excluded from scorecards (`production-oversight.service.ts:434,456`) | U2.4 |

### U2.5 — Guarantee, claims transparency, trust data
| # | Requirement | Before | Evidence | Session |
|---|---|---|---|---|
| 5.1 | `guarantee_policies` (effective-dated, claim type × severity → remedy, SLAs), read by the claim engine and the public page, changes approved | partial | Claims model: `ClaimType`, `ClaimResolutionKind {reprint, partial_refund, full_refund, credit}`, `ClaimAction` (`fulfilment.prisma:1301-1370`), `claims` / `claim_resolutions` (`:1373,1454`); **no severity, no goodwill, no SLA, no policy table** (grep `guarantee`: 0); only setting `claims.window_days` (`prisma/seed/data/settings.ts:143`); approval engine ready (`src/platform/approvals/approvals.service.ts:79`, policies in `prisma/seed/data/approval-policies.ts`) | U2.5 |
| 5.2 | Customer claim timeline with SLA countdowns and current owner; overdue → ops signal | partial | Customer view has `windowEndsAt` only (`claim-views.ts:9-38`); claim events on the order timeline (`claims.service.ts:709`); no claim key in `SIGNAL_KEYS` (`ops/ops-signals.service.ts:17-29`) | U2.5 |
| 5.3 | Public network statistics — aggregates only, documented minimum sample, no partner identity | missing | No public aggregate endpoint; data in `factory_scorecards` (`fulfilment.prisma:999`), `factory_delivery_zones` (`partners.prisma:729`); k-suppression helper reusable (`analytics/k-anonymity.ts:43`). **With one launch factory (D-101) every aggregate is that factory's own data** | U2.5 |
| 5.4 | Verified reviews: delivered orders only, one per order line, moderated, reply workflow, aggregate + list with product type | partial | `order_reviews` one **per order** (`commerce.prisma:1803`), delivered check (`reviews.service.ts:41`), hide / publish moderation (`:94-109`), D-135 reward (`:52-60`); no reply, no public list, no aggregate | U2.5 |

### U2.6 — Library, dielines, spec sheets (catalogue parts superseded by U3)
| # | Requirement | Before | Evidence | Session |
|---|---|---|---|---|
| 6.1 | Taxonomy, facets, search, favourites, per-style size / material compatibility | partial | Category → type → product → pattern (`catalog.prisma:184,211,342,400`); trigram search top 20 (`store-catalog.controller.ts:329-365`); size rules in `patterns.constraints` (`size-rules.ts:25-73`); no family / closure / use-case, no facets, no favourites | **U3.B1–B2** (precedence) |
| 6.2 | Free dieline download (PDF / DXF / SVG), rate-limited, logged, no gating | partial | `store.designs.requestDrawing` / `getDrawing` (`designs.controller.ts:348-401`), formats svg / dxf / pdf (`fulfilment.prisma:135`); **501 until `@packio/dieline` is installed** (`packio-dieline.engine.ts:14-40`, flag `drawing.engine`); no size validation (`drawings.service.ts:70-87`); global throttler only (`app.module.ts:87-92`); no `dieline_downloads` (only `drawing_jobs`, `fulfilment.prisma:518`) | U3.B5 (else U2.6) |
| 6.3 | Packaging spec sheet PDF (th / en) for approved orders / samples, QR to tracking | missing | PDF pipeline with Thai fonts reusable (`src/integrations/pdf/puppeteer-pdf-renderer.ts`, `Dockerfile:29-31`); QR only on shipment labels (`logistics/shipment-documents.ts:50,92`); no job / spec sheet (grep: 0) | U2.6 |

### U2.7 — Repeat business
| # | Requirement | Before | Evidence | Session |
|---|---|---|---|---|
| 7.1 | Consumption history per SKU, suggested reorder date / quantity, storefront + CS queue | missing | Reorder exists (`claims/reorder.service.ts`, `store.claims.reorder`); no history or suggestion (grep: 0) | U2.7 |
| 7.2 | Die / plate reuse: one-off cost shown waived with reason and tooling reference; tooling registry | partial | D-153 (Accepted) promises no repeat plate / die charges; **reorder re-prices with `toolingAmount` charged again** (`reorder.service.ts:53-62` → `quotes.save` without waiver; `corrugate.adapter.ts:103`) — finding F1; no tooling registry (`PlDiecutBlockPrice` / `PlCorrugateDieBlock` are price tables) | U2.7 (F1 pre-launch candidate) |
| 7.3 | Call-off / blanket orders with scheduled releases, deposit, expiry, storage, deferred revenue | missing | grep `call.?off`, `blanket`: 0; account 2310 customer advances exists (`prisma/seed/data/finance-accounts.ts:202-210`) | U2.7 |
| 7.4 | B2B scoped API keys, order create / track, documents, signed outbound webhooks with delivery log | missing | `ApiClient` is factory-scoped (`iam.prisma:783-815`), no key management endpoints; only inbound `webhook_inbox` (`platform.prisma:210,1050`) | U2.7 |

### U2.8 — Sustainability (only with real data)
| # | Requirement | Before | Evidence | Session |
|---|---|---|---|---|
| 8.1 | Recycled content / certifications from partner documents with expiry; footprint estimate with method and factor source | missing | `Material` has `isFoodGrade`, `coatable` only (`catalog.prisma:669-716`); `KycDocType` has no certificate types (`partners.prisma:76-87`), `expires_on` exists but nothing expires documents | U2.8 |

### U2.9 — Partner portal parity
| # | Requirement | Before | Evidence | Session |
|---|---|---|---|---|
| 9.1 | Business hours & closures per factory, edited by admin + partner, effective-dated, feeding `BusinessTime` / D-074 / promised dates | partial | Per-factory calendars exist (`business_calendars` / `business_calendar_days`, `platform.prisma:1246,1278`; `factories.calendar_id`; `factories.service.ts:142-156`; `business-calendar.service.ts:22`); hours global only (`calendar.business_hours`, `setting-keys.ts:106`; `working-days.ts:70`); **no endpoint writes calendar days** (already LAUNCH-CHECKLIST 5.6, U-B0.3) | U-B0.3 (days) + U2.9 (hours) |
| 9.2 | Payout calendar: upcoming + past runs with lines, expected dates, status; statements per run and per PO | partial | `partner.payables.payoutStatement` lists **paid** items only (`payouts.controller.ts:305-324`, `payouts.service.ts:783-796`): no run, no pay-on date, no pending items, no PO link; PDF only for 50 ทวิ (`:326`) | U2.9 |
| 9.3 | Billing list by PO and by payment line with totals (earned / paid / retained / deducted) reconciling to the ledger | partial | PO / GR / statements endpoints (`payables.controller.ts:432-583`), PO DTO net / VAT / gross only (`payables.dto.ts:85-126`); `vendor_deductions` not visible to partners (`finance.prisma:1797`); no vendor sub-ledger reconciliation | U2.9 |
| 9.4 | Partner counters incl. sample jobs and open claims | missing | No partner dashboard / counters operation; `partner.me.get` returns user + roles (`me.controllers.ts:118-143`); the 08:00 digest counts jobs only (`production-oversight.service.ts:350-405`) | U2.9 |
| 9.5 | Partner knowledge base (`partner_guide`, th / en, partner audience only) | missing | CMS `Article` / `Faq` have no audience (`catalog.prisma:1486-1583`); no `/v1/partner` CMS paths | U2.9 |
| 9.6 | CI release hygiene (debug markers, test tax ids outside UAT, `dev_only` flags) | missing | `.github/workflows/ci.yml` (lint, unit, integration, e2e, contract, prisma-drift, build + Trivy), `release.yml` — no marker check; `feature_flags` has no `dev_only` (`platform.prisma:499-516`); note `DEVPV-` numbers in examples (`payouts.dto.ts:370`) | U2.9 |

### Findings against accepted decisions (recorded, not fixed — U2.0 writes no code)
| # | Finding | Decision | Evidence | Proposed home |
|---|---|---|---|---|
| F1 | Reorder charges plates / die blocks again | D-153 | `reorder.service.ts:53-62`, `corrugate.adapter.ts:103` | intake item 24 |
| F2 | RFQ-accepted orders reconcile at 0 % tolerance — any shortage or overage opens a claim | D-021, D-163 | `rfqs.service.ts:262-294`, `delivery.service.ts:247-249` | intake item 6 |
| F3 | Store credit (from claims / credit notes) can be refunded but never applied at checkout | D-083 (claim remedies), accounting-design §6 | `store-credit.service.ts`, only debit at `banking.service.ts:655`; `PaymentMethod.store_credit` unhandled | intake item 15 |
| F4 | Paid mockup cannot be shipped or approved by the customer; bulk production does not wait for it | D-072 | `shipments.service.ts:98`, `production.service.ts:145-148` | intake item 12 |
| F5 | Quote share links never expire and still resolve after expiry / conversion | D-051 (validity), PDPA | `saved-quotes.service.ts:247`, `pricing.prisma:539` | intake item 4 |
| F6 | Pattern (style) codes are editable after publication | — (U2.1 requirement) | `product-structure.resources.ts:649` | intake item 3 |

### U2.0 — outcome (2026-09-30)
All 38 intake items accepted as proposed → **D-182–D-219** in `docs/decisions.md` (identical in packio-web). Open sub-points (Still open): the legacy basis confirmation (D-182), the store-credit posting (D-196), tooling ownership (D-205), FEFCO / ECMA editions (D-211), the template author (D-216), the scorecard moderator (D-217). Launch gating D-219 → `docs/LAUNCH-CHECKLIST.md` §9.

**Implementation order** (RUN-ORDER §1 unchanged; pre-launch items first within it):
| # | Session | Contents | Launch |
|---|---|---|---|
| 1 | U-B0.1–0.3, U-B6 (label → tag & sleeve → pouch → standard product → service → folding B → tier-B) | as RUN-ORDER | pre-launch (already) |
| 2 | **U2.1** spec model v2 — including F2 (D-187), F5 (D-185), F6 (D-184) | 1.1–1.9 | pre-launch |
| 3 | **U2.F** pre-launch fixes — F1 tooling register + reorder waiver (D-205, the minimal part of U2.7 item 2), F3 store credit at checkout (D-196, after Finance confirms the posting), F4 mockup shipping / customer approval / production hold on the `sample` entity attached to an order (D-192, D-193; the minimal part of U2.4) | F1, F3, F4 | pre-launch |
| 4 | **U2.5 (items 1–2)** guarantee policies, claim severity / goodwill / SLA timeline, ops signal | 5.1–5.2 | pre-launch |
| 5 | **U2.9 item 6** release-hygiene CI check | 9.6 | pre-launch |
| 6 | U2.2 → U3.B1–B3 → U2.3 / rest of U2.4 / U2.5 items 3–4 → U3.B4–B6 → U4 → U2.6 / rest of U2.7 / U2.9 items 1–5 → U5 | as RUN-ORDER rows 5–10c | post-launch |
| 7 | U-B1–U-B5, UAT, LAUNCH-CHECKLIST (§9 = the pre-launch rows above) | as RUN-ORDER rows 11–12 | — |

**Contract impact per deliverable** (estimates; each session confirms in its own gap analysis, bumps `package.json`, tags and writes the tag in PROGRESS):
| Deliverable | New operations | Changed operations / schemas | Breaking? |
|---|---|---|---|
| U2.1 | `store.configurations.*` (create, get, update, list, share, getShared, revokeShare, convertToQuote, convertToRfq); `store.specs.convertDimensions`; `store.catalog.getTolerances`; `store.me.updatePreferences` (display unit) | `basis` on Folding / Corrugate configuration DTOs, RFQ, design documents, quote / order line / job views; `styleCode` + `internationalName` on quote, order line, proof, job and partner views; `admin.catalogPatterns.update` refuses a code change once published (422); `store.quotes.share` gains `expiresAt`, `getShared` returns 410 after expiry; `unit` in any request → 422 | Additive: `basis` optional for one release (assumed `internal`, `Deprecation` header) and required after packio-web pins; removal of the fallback in U-B5 |
| U2.F | `admin.tooling.*` + `partner.tooling.*` (register); `store.samples.approve` / `requestChanges`; `store.samples.get` | quote step `toolingWaived`, `toolingWaiverReason`, `toolingRef`; checkout accepts `storeCreditAmount` / payment method `store_credit`; `admin.artwork.addMockup` deprecated in favour of `admin.samples.create`; shipment items accept sample lines | Additive (+ deprecation) |
| U2.5 items 1–2 | `store.guarantee.get` (public); `admin.guaranteePolicies.*` (versions through `guarantee_policy_change`) | claim views gain `severity`, `responseDueAt`, `decisionDueAt`, `currentOwner`; `ClaimResolutionKind` + `goodwill` (named enum, additive) | Additive |
| U2.9 item 6 | — | — (CI only) | — |
| Post-launch (U2.2–U2.9 rest, U3, U4, U5) | per their prompts (`advisory.*`, target price / levers, samples standalone, network stats, reviews, dieline downloads, spec sheet, reorder suggestions, call-offs, B2B keys / webhooks, partner counters / payout calendar / KB, U3 styles, U4 studio, U5 launchpad / messaging / basket) | — | decided per session |

## U-B6 corrugate (+ combine) — B2.3 Deliverable 2.3 for corrugate (2026-09-29, planning)

Legacy traced from `/Users/superball/Abbon/Loco_Pack/locopack-web`. Live paths: CS `GET /api/corrugate/calculate_cs` and SME `Calculator::FromSME:49,61` → `CorrugateCalculator::calculate_cs:310-1097` → per part `CalculatorCorrugate::calculate:147-865` (engines `CalRSCFlexo:867`, `CalDCFlexo:1084`, `CalDigital:1337`, `calculateAssembly:1961`) → `Calculator::SaleMargin:223-450` → `ShippingUtils::calShippingCostCorrugate:602` / `calCostCorrugate_WithShipping:305-461`. Dead: `CorrugateCalculator::fromCS:195` / `ConvertCSDataToFactory:212` (return nothing), the code after `return` in `Api/Corrugate/CorrugateController::calculate_cs:274-616`, `CalculatorCorrugate::calculateDimension:2049` (custom-cost path only). "Combine" = combination products (`mapping_inputs.is_combination`), i.e. several sub-pattern parts (Tele 29 body + lid, slide 30 tray + sleeve) priced and summed per factory × print type.

| # | Requirement | Before | Evidence | This session |
|---|---|---|---|---|
| C.1 | Corrugate geometry (16 pattern cases incl. sub-patterns, flute take-ups, `i/j/k/m` condition bands, factory `plus_dl/dw`, RSC vs D/C detection, print-area % per pattern area) | missing | `src/modules/pricing/calculators/` holds `folding/` only; `GeometryFormula` enum is folding-only (`prisma/schema/catalog.prisma:1686`); `GeometryDeterminant` has no `w/l` (`:1713`) | Port `CalculatorCorrugate.php:297-481,1580-1954` |
| C.2 | Engines: RSC flexo (roll layout, paper price bands, print margin, plates), D/C flexo (die blocks, die-cut per sheet), digital (sheet sizes, wastes, ink per m², finish, die-cut, die block, fix cost %, minimum), assemblies, fixed options, percent reduce | missing | — | Port `CalculatorCorrugate.php:600-1545,1956-2037`, `Calculator::calculatePercentReduce:452` |
| C.3 | Orchestration (`calculate_cs`): options factory × print type, parts summed, min order, max colours, difficulty, board grade × flute per factory, colours, coating only on coatable board, assemblies (+ automatic packing assembly), cheapest layout, lead time, selection | missing | — | Port `CorrugateCalculator.php:310-1097` as a pure function |
| C.4 | Sell side (`SaleMargin`) | met | `calculators/folding/sell.ts` (product-agnostic, lives under `folding/`) | Reuse; move to a shared location (no number change) |
| C.5 | Corrugate price-list components (`find_pattern_type`, `paper_roll_widths`, `paper_grade_match_flute`, corrugate `difficult_level` / `difficult_match_margin`, corrugate `diecut_block_price` columns, `percent_reduces`, `factory_fix_cost_percents`, `fixed_options`, `factory_rel_pattern_conditions` × flute, corrugate `factory_match_print_type` columns, digital print / finish / die-cut prices, board sheet sizes) | missing | 20 folding `pl_*` tables only (`prisma/schema/partners.prisma:1282-1850`); enum values `paper_roll_widths`, `difficulty_levels`, `difficulty_margins`, `percent_reduces`, `fix_cost_pcts` exist without tables (A-13); `pl_pattern_conditions` has no flute; `pl_print_type_terms` is folding-shaped | New `pl_*` tables + descriptors registered with price governance; folding tables reused only where columns match |
| C.6 | Catalogue data the port needs | partial | `FluteType` lacks `ct` (`catalog.prisma:600`); `Material` has gsm / flute / colours / strength but no "coatable" (legacy `paper_grade.can_finish`); no corrugate formula on patterns / sub-patterns; `StandardSize.calc*Mm` exists (`:454`); pattern ↔ flute (`PatternFluteType`) exists; no corrugate print types in any seed | Additive columns / enum values; admin CRUD fields |
| C.7 | Quote engine, saved quotes, checkout usable by a second calculator | partial | `QuoteEngineService` injects `FoldingSnapshotLoader` and calls `foldingCalculator` directly (`quote-engine.service.ts:22,178,205`); `CalculatorRegistry` never populated (`calculators/calculator.ts:25`); saved quotes / repricer / checkout / drawings accept folding only (`saved-quotes.service.ts:35,81`, `saved-quotes.repricer.ts:80`, `checkout.service.ts:499`) | Calculator adapters dispatched by `calculator_key`; folding numbers unchanged (golden tests) |
| C.8 | Shipping packer for corrugate (B2.4 deferral) | missing | `ShippingQuoteService.prepare` hard-codes `packFolding` (`shipping-quote.service.ts:20,63`) | Port the packing part of `ShippingUtils.php:305-403` (weight, flat size, RSC thickness × 2.5, 60 cm lay-out, cartons); packer chosen per part kind |
| C.9 | `GET /v1/admin/cs/corrugate/input-data`, `POST /v1/admin/cs/corrugate/calculate` | missing | only `admin.csFolding.*` (`quotes.controller.ts:121-208`); triage row `admin.cs-calculators` | New `admin.csCorrugate.*` |
| C.10 | Factory-side breakdown (own factory) | missing | only `partner.pricingFolding.calculate` (`quotes.controller.ts:211`) | New `partner.pricingCorrugate.calculate` |
| C.11 | `POST /v1/store/quotes/actions/calculate` prices corrugate | missing | `CalculateQuoteDto.configuration` is `FoldingConfigurationDto`; dispatch refuses anything but `folding` (`quotes.controller.ts:106-110`); triage row `store.quote-configurations` | Configuration union by `productTypeCode` with `CorrugateConfigurationDto` (additive) |
| C.12 | Store configurator data for corrugate | missing | no configurator read; `store.catalog.getProduct` gives codes and free-form constraints (`store-catalog.service.ts:142-197`); triage row `store.configurator` (U-B0.1) | See plan (scope question) |
| C.13 | Calculate / search logs | partial | `QuoteEngineService.log` writes folding-shaped input (`quote-engine.service.ts:604-673`) | Per-calculator input summary |
| C.14 | Golden tests + `docs/pricing-validation-corrugate.md` (20 cases from the PHP) | missing | `test/fixtures/legacy/calculate_logs_*.sql` holds inputs only | `test/golden/corrugate/`, generated doc |
| C.15 | Port map `docs/legacy/05-corrugate-port-map.md` | missing | — | Written in slice 1 |
| C.16 | Type stays `rfq` until sign-off; switchable once shipped | partial | mechanism met (`shipped-calculators.ts:8`, seed `rfq`, A-16); `corrugate` not in `SHIPPED_CALCULATORS` | Add `corrugate` after the golden slice; seed unchanged |
| C.17 | Dev fixture | missing | `prisma/seed/dev-folding.ts` only | `prisma/seed/dev-corrugate.ts` (fake factory, fake prices) |
| C.18 | Tier-B envelopes (D-043) | out of scope | after the last calculator (U-B6 tail) | — |
| C.19 | Contract release tag | needed | latest tag `v0.2.0` | Bump + tag after the endpoint slice |
| C.20 | Admin editing of geometry data (band tables + bands, conditions, pattern condition slots, standard blanks) — found in slice 3 | missing | `geometry_band_tables`, `geometry_bands`, `geometry_conditions`, `pattern_geometry_conditions`, `pattern_standard_blanks` (`catalog.prisma:1826-1940`) are written by seeds only; no admin resource in `catalog.registry.ts` (folding shipped without it) | Slice 7d: `admin.catalogGeometryBandTables.*` (+ `replaceBands`), `admin.catalogGeometryConditions.*`, `admin.catalogPatterns.getGeometry` / `replaceGeometryConditions` / `replaceStandardBlanks`; the calculators' slot rules checked on edit |

**Outcome (2026-09-30, U-B6 corrugate complete, branch `feat/u-b6-corrugate-calculator`):** C.1 geometry (slice 3), C.2 engines (slices 4–5), C.3 orchestration (slice 6), C.4 sell side shared (slice 1), C.5 price components and C.6 catalogue data (slice 2), C.7 generic quote engine, saved quotes and checkout (slices 1, 7b), C.8 packer (slice 6), C.9 CS endpoints and C.10 factory breakdown (slice 7a), C.11 store calculate (slice 7a), C.12 store configurator (slice 7c), C.13 per-calculator log input (slice 1), C.15 port map (slice 1, §10 in slice 8), C.17 dev fixture (slice 6), C.20 geometry admin (slice 7d) — **met**. C.14 golden cases + `docs/pricing-validation-corrugate.md` — **met, signed off 2026-09-30** (replayed on Locopack staging). C.16 `corrugate` in `SHIPPED_CALCULATORS`, type still seeded `rfq` — **met**. C.19 tag `v0.3.0` — **local tag** (no git remote in this checkout). C.18 tier-B envelopes — out of scope.

## U-B0 steps 1–2 — contract release tag and contract-requests triage (2026-09-29)

| # | Requirement | Before | Evidence | This session |
|---|---|---|---|---|
| 1.1 | `package.json` bumped from `0.1.0` | missing | `package.json` `"version": "0.1.0"`; `APP_VERSION` (`src/bootstrap.ts:9`) → `info.version` via `buildOpenApiDocument` (`scripts/contract-build.ts:29`) | Bumped to `0.2.0` |
| 1.2 | `pnpm contract:build` at the release | met (drift-free) | Rebuild changed only `info.version` (745 paths) | Regenerated and committed |
| 1.3 | Tag `vX.Y.Z` with `contract/openapi.json` as release asset | partial | `.github/workflows/release.yml` publishes the asset on a `v*.*.*` tag push (checks contract drift, `contract:lint`, tag = `package.json`); `git tag -l` empty; this checkout has no git remote | Annotated tag `v0.2.0` created locally; the push that runs the release workflow is the user's |
| 1.4 | Tag written in `docs/PROGRESS.md` for packio-web to pin | missing | — | PROGRESS entry with version, release URL and sha256 |
| 2.1 | Both frontend files read from the sibling checkout | met | `../packio-web` at `9cbd99a`: `docs/contract-requests.md` (133 open ids), `docs/contract-requests.openapi.json` (115 ids, 293 operations) | — |
| 2.2 | `docs/contract-requests-triage.md`, one row per request id with a verdict | missing | — | Written (see the file's summary for counts) |
| 2.3 | The three known contract defects recorded | missing | `RateCardLineResponse` enum and DTO share a name (`src/modules/partners/pricing/pricing.dto.ts:315,319`); `AssemblyDto` defined twice (`src/modules/catalog/materials/materials.dto.ts:553`, `src/modules/pricing/quotes/quote.dto.ts:79`); `PriceSimulationDto.result` is `additionalProperties: true` without a named schema | Recorded as `implement here` rows with a non-breaking fix and a group |
| 3 | Implement the `implement here` rows (U-B0.1–0.3) | missing | — | Out of scope (later sessions) |
