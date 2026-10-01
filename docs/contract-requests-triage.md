# Contract requests — triage (U1 U-B0 step 2)

Every contract request `packio-web` has open against this repo, classified per U1 §U-B0 step 2. This repo owns the contract (api-conventions §1): where the requested shape and the domain model disagree, the published shape wins and the mapping is written here; business rules are never weakened to fit a mock.

- **Sources** (sibling checkout, read-only): `packio-web@f225d30` — `docs/contract-requests.md` (open table, 134 ids), `src/lib/api/requests/` (the zod registry; `awaiting-triage.ts` listed one new request, `awaiting-migration.ts` 86 operations). Compared with `contract/openapi.json` at **`v0.3.0`**. The frontend's `pnpm gen:triage` reads this file (`scripts/gen-triage.ts`): keep the group headings (``### U-B0.x``), request headings (``#### `id` — verdict``), operation lines (``- **METHOD path** — verdict → `operationId` (`METHOD path`)``) and gap bullets (``  - **gap (U-B0.x):**``) in *Details* exactly in this form.
- **Triaged** 2026-09-29 against `packio-web@9cbd99a` and `v0.2.0` (133 ids); **re-triaged** 2026-09-30 against `packio-web@f225d30` and `v0.3.0` (the delta below). Verdict per frontend operation, rolled up per id.
- **Legend:** `published as <operationId>` — shape identical for the frontend (extra backend response fields allowed; path-parameter names may differ) · `published differently` — the operation exists; the frontend applies the mapping in *Details* · `implement here` — build it in the named group and module · `reject` — conflicts with a decision; **proposed only, needs the user's OK** · `mixed` — per-operation verdicts differ (see *Details*).
- **Additive gaps**: under `published differently`, something the screen needs that the published operation lacks. It is added here (additive, never breaking) in the named group; the rest of the mapping stays on the frontend.
- When a group ships, its rows move to `published`; after U-B0.3 every row is `published` or `rejected` (U1 §U-B0 step 4).

## Changes since the 2026-09-29 triage

What changed: contract `v0.3.0` (U-B6 corrugate: +16 operations, quote configuration `anyOf` Folding | Corrugate, `toolingAmount` on calculate steps, store option `id`), decisions D-182–D-219 (U2.0 intake), and one new frontend request.

| Id | Was | Now | Why |
|---|---|---|---|
| `store.configurator` | implement here (U-B0.1) | **published differently** → `store.catalog.getConfigurator`, 4 additive gaps | Published at the requested path in `v0.3.0` |
| `admin.analytics-journeys` | — (awaiting triage) | **implement here** (U-B0.3 row), **built in U5.B6** | New request (packio-web U5.0); U5 owns the journey analytics, and D-219 makes it post-launch |
| `store.quote-configurations` | implement here | implement here (5 calculators left) | Corrugate configuration published; one typed DTO per calculator (backend wins) |
| `admin.cs-calculators` | published differently (folding) | published differently (folding + corrugate) | `admin.csCorrugate.*` published; gaps now name 5 calculators |
| `store.quotes`, `admin.quotations` | 10 / 7 gaps | 12 / 9 gaps | + `options[].toolingAmount` on the saved option (calculate has it since `v0.3.0`, the saved view drops it) |
| `admin.prepress` | 8 gaps | 7 gaps | Mockup job ref moved to U2.F with the `sample` entity (D-192) — out of U-B0.2 |
| `store.quotes` share | expiresAt "missing (lives with validity)" | expiresAt delivered by **U2.1** | D-185 (F5): 15-day, revocable links, 410 after expiry |
| `store.checkout`, `store.wallet` | — | note | D-196 (F3): store credit at checkout, U2.F |
| `store.reorder`, `store.company-reorder` | — | note | D-205 (F1): tooling register + waiver, U2.F |
| `admin.cs-create-order` | — | note | D-192: mockup → `sample`, CS "add mockup" deprecated additively in U2.F |
| `partner.capacity-calendar`, B6.3 calendar gap | — | note | D-209: who edits factory hours / closures |
| `store.sample-kits` | open question 5 | still open, cross-referenced | D-192–D-197 cover configured samples, not material kits |

No verdict became `reject`. Items moved out of U-B0 scope: `admin.analytics-journeys` (→ U5.B6), the prepress mockup ref (→ U2.F), share-link expiry (→ U2.1), store credit at checkout (→ U2.F), tooling waiver (→ U2.F). U2.1 and U2.F are pre-launch (D-219), so nothing launch-blocking was dropped.

## Summary

| Group | Ids | published | published differently | implement here | reject (proposed) | mixed | Ops: published / differently / implement / reject | Additive gaps |
|---|---|---|---|---|---|---|---|---|
| U-B0.1 | 49 | 0 | 22 | 22 | 0 | 5 | 1 / 80 / 38 / 0 | 93 |
| U-B0.2 | 34 | 0 | 23 | 2 | 0 | 9 | 0 / 88 / 18 / 0 | 140 |
| U-B0.3 | 51 | 0 | 18 | 28 | 0 | 5 | 0 / 46 / 42 / 0 | 56 |
| **Total** | **134** | **0** | **63** | **52** | **0** | **19** | **1 / 214 / 98 / 0** | **289** |

**U-B0.1 shipped in `v0.4.0` (2026-10-01):** its 49 ids are published (47, most with the mapping in *Details*) or deferred by decision (2: guided help, sample kits — D-223); see *U-B0.1 shipped*. The table above keeps the counts of the triage.

**U-B0.2 shipped in `v0.5.0` (2026-10-01):** its 34 ids are published (most with the mapping in *Details*); see *U-B0.2 shipped*.

**U-B0.3 shipped in `v0.6.0` (2026-10-01):** 50 of its 51 ids are published (most with the mapping in *Details*); `admin.analytics-journeys` is built in U5.B6 (post-launch, D-219). The three known contract defects and the two B6.3 launch gaps are closed. See *U-B0.3 shipped*. Every row of the triage is now `published` except the three deferred by decision (guided help and sample kits, D-223; analytics journeys, D-219).

Plus the three known contract defects and the two B6.3 launch gaps below (not frontend requests; counted separately).

The *Ops* and *Additive gaps* columns count per frontend operation, including field-level entries (for example `… (OtpChallengeDto.codeLength)`) and the scope bullets of the first triage. `pnpm gen:triage` counts only the `- **METHOD path**` lines and their `gap` bullets, so the generated `triage.ts` holds **134 requests and 305 operations** (1 published · 210 published differently · 94 implement here; gaps 93 / 140 / 53 by group). The 2026-09-30 deltas above are the same on both bases.

## U-B0.1 shipped (`v0.4.0`, 2026-10-01)

Every U-B0.1 row below is now **published** (`v0.4.0`), except the two deferred by decision. "Published differently" keeps its mapping in *Details*; the table says what the group added. Nothing was removed or made required on the wire (the only structural change against `v0.3.0` is the S1 fix of `FoldingPartDto.assemblies[]`, which the old document showed with the catalogue `AssemblyDto` shape — the server always required `assemblyId`).

| Id | Now | Added in U-B0.1 (operationIds / fields) | Published differently / left out |
|---|---|---|---|
| `otp.code-length` | published | `OtpChallengeDto.codeLength`, `maxAttempts` | — |
| `otp.attempts-remaining` | published | `auth.otp_invalid` problem member `attemptsRemaining` | — |
| `store.sitemap` | published differently | `store.catalog.getSitemap` | Entries are `{kind, key, updatedAt}`; the web builds the paths |
| `store.price-hints` | published | `store.catalog.listPriceHints` (D-220) | — |
| `store.product-faqs` | published | `store.catalog.listProductFaqs`, `admin.cmsFaqs.replaceCatalogProducts` | — |
| `store.product-categories` | published | `store.catalog.listProductCategories` | — |
| `store.catalog-category-filter` | published | `category` on `store.catalog.listProducts` / `listStockProducts` (sub-categories included, D-228) | — |
| `store.search-faq-hits` | published | FAQ hits on `store.catalog.search` | — |
| `store.profile` | published | `CustomerProfileDto.profileCompletedAt` | E-mail not editable on the profile (D-224) |
| `store.configurator` | published differently | `unit`, `quantity {min, max, default, presets, maxTiers}`, `design {options, default}`, option content (description, image, swatch) | Shape stays calculator-first (patterns / optionGroups) |
| `store.quote-configurations` | published (6 calculators) | folding, corrugate; label since `v0.7.0` (`LabelConfigurationDto`); tag & sleeve since `v0.8.0` (`TagSleeveConfigurationDto`); pouch since `v0.9.0` (`PouchConfigurationDto`, configurator `pouch` shape); standard product since `v0.10.0` (`StandardProductConfigurationDto`) | Service → U-B6 |
| `store.quotes` | published differently | `summary` spec lines, `options[].toolingAmount` | Share-link expiry → U2.1 (D-185) |
| `store.promo-check` | published | `store.promotions.checkCode` (public, Retry-After), `store.promotions.listMine` | — |
| `store.support-channels` | published | `store.support.getChannels` (D-221) | — |
| `store.rfq-forms` | published | `store.rfqs.getForm` | — |
| `store.rfqs` | published differently | `files`, message `files`, `routedFrom.calculationId`; `calculationId` on calculate | — |
| `store.cart` | published differently | `items[].summary` | Blockers / `readyForCheckout` → the checkout preview |
| `store.checkout` | published differently | preview `paymentMethods`, `points`, `company` blocks | Store credit at checkout → U2.F (D-196) |
| `store.payments` | published differently | `receiverAccounts`, `failureCode` | No client-supplied return URL (assumption A7) |
| `store.instalments` | published | `store.paymentSchedules.listInstalments` | — |
| `store.orders` | published differently | `summary`, `receipt`, `toleranceOutcome`, `cancelReason*`, `createdAt`, `estimatedDeliveryDate`; `store.documents.list?orderId` | `nextActions` → U-B0.3 |
| `store.loyalty` | published differently | `nextTier`, `nextTierMinSpend12m`, `nextTierProgressPct`, ledger `orderId`; referral `rules`, `rewardedThisMonth`, `recent` | — |
| `store.wallet` | published differently | — | Store credit at checkout → U2.F (D-196) |
| `store.privacy` | published | `store.me.listPrivacyRequests` / `createPrivacyRequest`, `admin.privacyRequests.*` (D-222) | — |
| `store.identities` | published | `store.me.unlinkIdentity` | The account phone cannot be unlinked |
| `store.artwork` | published differently | `store.artwork.getRules` (file rules, D-070 checks, checklist, dieline) | No aggregate (A8); `nextActions` → U-B0.3 |
| `store.proofs` | published differently | approval `{checklist, note}`, `decidedByName`, `decisionChecklist`, reply inheritance | Page rasterisation deferred (A9) |
| `store.design-service` | published differently | `referenceFileIds` on paid rounds | — |
| `store.designs` | published differently | product, `thumbnailUrl`, `orders`, `share`, `createdAt`, `?linked=`; save `kind` / `label` / style / material / size; versions `kind` / `label` / thumbnail, `limit` + `before`, `?kind=`; `store.designs.restoreVersion`, `duplicate`, `import` | Versions page on the published array (no envelope); no stored `source`; `nextActions` → U-B0.3 |
| `store.design-assets` | published differently | file purpose `design_asset`; asset `url`, `mimeType`, `sizeBytes`, `widthPx`, `heightPx`, `createdAt` | `addAsset` still answers the design |
| `store.designer-catalog` | published | `store.designer.getCatalog`, `getTemplate`, `getFont` | Templates carry no dieline key (they have no box style) |
| `store.design-share` | published | `store.designs.share`, `unshare`, `getShared` (view-only, 15 days, D-226) | 404 `http.not_found`, not `design.share_not_found` |
| `store.tracking` | published differently | steps `promisedAt`, `estimatedDeliveryDate` | No order code, product or location on the public page (D-224) |
| `store.receipt` | published differently | `OrderDto.receipt` | — |
| `store.claims` | published differently | `store.claims.getForm`; liability actions hidden from the store view | `respondBy` → U2.5 (D-199); no message thread (D-225) |
| `store.reorder` | published differently | `store.claims.previewReorder`, `previewToken` on `store.claims.reorder` | Tooling waiver → U2.F (D-205) |
| `store.support` | published | `store.support.contact`, `store.support.handoff` (D-221) | — |
| `store.guided-help` | **deferred** | — | D-223 → U2.2 |
| `store.sample-kits` | **deferred** | — | D-223 → U2.4 |
| `store.companies` | published differently | `signatory`, `contactPhone`, `discountPct`, `myRoles`, `can{}`; credit `eligibility`; `store.companyCredit.receivables` (receivables, D-122 notices); `Idempotency-Key` on apply | — |
| `store.company-members` | published differently | `store.companies.changeMemberRoles` (PUT …/roles, 409 `companies.last_admin`) | Member e-mail / phone hidden (D-224) |
| `store.company-branches` | published differently | province / district / subdistrict names | — |
| `store.company-assets` | published | `store.companyAssets.list`, `add`, `remove` (D-227) | Per `companyId`, not `/me/company` |
| `store.company-approvals` | published differently | `?status=pending\|decided\|all&limit&offset`; `threshold`, `ordersCount`, `branchName`, `expiresAt`, `decidedBy`, `decidedAt`, `decisionComment`; `Idempotency-Key` on decide | Array, no envelope |
| `store.company-credit` | published differently | `store.companyCredit.apply`, `listStatements`, `receivables` (aging) | Statement PDF by month (`store.documents.companyStatementPdf`) |
| `store.company-spend` | published | `store.companies.spend` | — |
| `store.company-reorder` | published | `store.claims.previewBulkReorder`, `store.claims.bulkReorder` | Tooling waiver per row → U2.F (D-205) |

## U-B0.1 — `auth.*` / `store.*`: catalogue, quotes, RFQ, cart, checkout, payments, orders

| Id | Frontend operations | Verdict | Backend operationId(s) | Work here | Notes |
|---|---|---|---|---|---|
| `otp.code-length` | `POST /v1/auth/customer/otp/request (OtpChallengeDto.codeLength)` | implement here (U-B0.1) | `auth.customer.requestOtp` | U-B0.1: implement in `auth` | Not in the contract: OtpChallengeDto has no codeLength although the code length is the `auth.otp_policy.codeLength` setting. Additive field on auth.customer.requestOtp. |
| `otp.attempts-remaining` | `POST /v1/auth/customer/otp/verify` | published differently | `auth.customer.verifyOtp` | U-B0.1: 1 additive gap(s) | auth.customer.verifyOtp already knows the remaining attempts (auth.otp_invalid params.remaining) but only puts it into the localised `detail` text; expose it as a structured field. |
| `store.sitemap` | `GET /v1/store/sitemap` | implement here (U-B0.1) | — | U-B0.1: implement in `catalog` | No sitemap endpoint. Implement a public, cacheable list of indexable catalogue paths (product types, catalogue/stock products, showcase, articles, FAQs) in catalog. |
| `store.price-hints` | `GET /v1/store/catalog/price-hints` | implement here (U-B0.1) | — | U-B0.1: implement in `pricing` | No price-hint read exists (catalogue reads carry no prices by design). Implement a separate, short-cached public read of starting-from price per piece + basis + lead-time range, which D-181 requires on product cards. |
| `store.product-faqs` | `GET /v1/store/catalog/products/{slug}/faqs` | implement here (U-B0.1) | — | U-B0.1: implement in `catalog` | No product-scoped FAQ read, and the faqs table has no link to a catalogue product. Implement the link (CMS) plus the public read. |
| `store.product-categories` | `GET /v1/store/catalog/product-categories` | implement here (U-B0.1) | — | U-B0.1: implement in `catalog` | No public category read; only the admin table exists. Implement a public list of active categories that have active product types. |
| `store.catalog-category-filter` | `GET /v1/store/catalog/products?category=` and `…/stock-products?category=` | implement here (U-B0.1) | `store.catalog.listProducts` | U-B0.1: implement in `catalog` | listProducts / listStockProducts filter by productType only. Additive `category` query param on both. |
| `store.search-faq-hits` | `GET /v1/store/catalog/search` (StoreSearchHitKind += faq)` | implement here (U-B0.1) | `store.catalog.search` | U-B0.1: implement in `catalog` | StoreSearchHitKind is catalog_product\|stock_product\|showcase_product\|article — no faq. Additive enum value in store.catalog.search. |
| `store.order-by-code` | `GET /v1/store/orders/by-code/{orderCode}` | published differently | `store.orders.getByCode` | — (frontend migrates) | Published at the same path as store.orders.getByCode (404 for other customers' codes), returning the full OrderDto rather than a lookup DTO; orderId → id, createdAt absent. |
| `store.profile` | `PATCH /v1/store/me` | published differently | `store.customerProfile.update` | U-B0.1: 2 additive gap(s) | Covered by PATCH /v1/store/customer-profile (store.customerProfile.update, If-Match), not PATCH /v1/store/me; customerType is read from GET /v1/store/customer-profile. E-mail is not writable there. |
| `store.configurator` | `GET /v1/store/catalog/products/{slug}/configurator` | published differently | `store.catalog.getConfigurator` | U-B0.1: 4 additive gap(s) | **Re-triaged 2026-09-30** (was implement here): published in `v0.3.0` at the same path for the ported calculators (folding, corrugate). It has patterns with parts and typed size rules, standard sizes, option groups with the ids the configuration takes, the difficulty level, print areas and quote validity, but a different shape: flat patterns / standardSizes / optionGroups by catalogue kind instead of size + stepper groups. Gaps: sales unit, quantity presets / limits, option content, design options. |
| `store.quote-configurations` | `POST /v1/store/quotes/actions/calculate` | implement here (U-B0.1) | `store.quotes.calculate` | U-B0.1: implement in `pricing` | Still open for five calculators: calculate/save accept Folding \| Corrugate configuration DTOs (`anyOf`, corrugate since `v0.3.0`); label, tag_sleeve, pouch, standard_product and service follow in U-B6, one typed DTO each (backend wins over the generic group-kind proposal). The AssemblyDto name collision persists. earliestDeliveryDate and (since `v0.3.0`) toolingAmount are published on the calculate steps. |
| `store.quotes` | `GET /v1/store/quotes`<br>`POST /v1/store/quotes`<br>`GET /v1/store/quotes/{quoteId}`<br>`POST /v1/store/quotes/{quoteId}/actions/export-pdf`<br>`POST /v1/store/quotes/{quoteId}/actions/share`<br>`GET /v1/store/shared-quotes/{token}` | published differently | `store.quotes.list`, `store.quotes.save`, `store.quotes.get`, `store.quotes.requestPdf`, `store.quotes.share`, `store.quotes.getShared` | U-B0.1: 12 additive gap(s) | Saved quotations are published (save/list/get/share/shared read/PDF) but modelled differently: one quotation holds every quantity tier as options[], promotions live on cart/checkout, the PDF is async request+poll, and the shared read is at /v1/store/quotes/shared/{token}. Since `v0.3.0` the configuration may be corrugate. The saved option lacks toolingAmount (gap). Share-link expiry comes from U2.1 (D-185, F5). |
| `store.promo-check` | `POST /v1/store/promotions/actions/check` | implement here (U-B0.1) | — | U-B0.1: implement in `promotions` | No pre-cart promo check. Codes are validated only when entered on the cart (store.cart.applyCode) and evaluated at checkout preview. Implement a public, rate-limited check in promotions. |
| `store.support-channels` | `GET /v1/store/support-channels` | implement here (U-B0.1) | — | U-B0.1: implement in `catalog` | No public support-contact read and no setting for LINE OA / phone / e-mail / hours. Implement settings + a public read. |
| `store.rfq-forms` | `GET /v1/store/rfq-forms/{productTypeCode}` | implement here (U-B0.1) | — | U-B0.1: implement in `rfq` | No public RFQ form read; product_types.rfq_spec_schema is admin-only JSON Schema. Implement a typed form DTO in rfq. |
| `store.rfqs` | `GET /v1/store/rfqs`<br>`POST /v1/store/rfqs`<br>`GET /v1/store/rfqs/{rfqId}`<br>`GET /v1/store/rfqs/{rfqId}/messages`<br>`POST /v1/store/rfqs/{rfqId}/messages`<br>`POST /v1/store/rfqs/{rfqId}/quotes/{quoteId}/actions/accept` | published differently | `store.rfqs.list`, `store.rfqs.submit`, `store.rfqs.get`, `store.rfqs.postMessage`, `store.rfqs.accept` | U-B0.1: 9 additive gap(s) | The customer RFQ flow is published (list/submit/get/post message/accept) with a different model: messages are embedded in RfqDto, accept is POST /rfqs/{rfqId}/actions/accept with rfqQuoteId in the body, every mutation returns RfqDto. |
| `store.cart` | `GET /v1/store/cart`<br>`POST /v1/store/cart/items`<br>`DELETE /v1/store/cart/items/{itemId}`<br>`PATCH /v1/store/cart/items/{itemId}`<br>`POST /v1/store/cart/items/{itemId}/actions/accept-reprice`<br>`PUT /v1/store/cart/items/{itemId}/destinations` | published differently | `store.cart.get`, `store.cart.addItem`, `store.cart.removeItem`, `store.cart.updateItem`, `store.cart.confirmReprice`, `store.cart.setDestinations` | U-B0.1: 2 additive gap(s) | The multi-item cart is published (get/add/update/remove/destinations/confirm-reprice) with CartDto, If-Match on mutations, quoteOptionId per item and a two-step reprice (reprice → confirm-reprice). |
| `store.address-book` | `GET /v1/store/me/addresses`<br>`POST /v1/store/me/addresses`<br>`DELETE /v1/store/me/addresses/{addressId}`<br>`PATCH /v1/store/me/addresses/{addressId}`<br>`GET /v1/store/me/tax-profiles`<br>`POST /v1/store/me/tax-profiles`<br>`DELETE /v1/store/me/tax-profiles/{profileId}`<br>`PATCH /v1/store/me/tax-profiles/{profileId}` | published differently | `store.addresses.list`, `store.addresses.create`, `store.addresses.delete`, `store.addresses.update`, `store.taxProfiles.list`, `store.taxProfiles.create`, `store.taxProfiles.delete`, `store.taxProfiles.update` | — (frontend migrates) | Address book and tax profiles are published at /v1/store/addresses and /v1/store/tax-profiles (not under /me), with geo ids instead of free-text province/subdistrict, structured tax-profile address, paging and If-Match on PATCH. |
| `store.checkout` | `POST /v1/store/checkout/actions/preview`<br>`POST /v1/store/checkout` | published differently | `store.checkout.preview`, `store.checkout.place` | U-B0.1: 4 additive gap(s) | Preview and place are published at the same paths but with a different model: codes are applied to the cart first, delivery comes from cart item destinations, the schedule is rule-selected (no customer choice), the price guard is expectedGrossAmount (no previewToken), and the payment method is chosen when paying. Store credit at checkout comes with U2.F (D-196, F3). |
| `store.payments` | `POST /v1/store/instalments/{instalmentId}/payments`<br>`GET /v1/store/payments/{paymentId}`<br>`POST /v1/store/payments/{paymentId}/slips` | published differently | `store.payments.initiate`, `store.payments.get`, `store.payments.uploadSlip` | U-B0.1: 4 additive gap(s) | Payments are published, but started per order group (with optional instalmentIds) rather than per instalment; QR is qrPayload only, no receiver bank account, no returnUrl. |
| `store.instalments` | `GET /v1/store/instalments` | implement here (U-B0.1) | — | U-B0.1: implement in `payment-schedules` | No cross-order instalment list; instalments are only per order group (store.paymentSchedules.get). Implement a paged customer list in payment-schedules. |
| `store.orders` | `GET /v1/store/orders`<br>`GET /v1/store/orders/{orderId}`<br>`POST /v1/store/orders/{orderId}/documents/{documentId}/actions/download` | published differently | `store.orders.listGroups`, `store.orders.get`, `store.documents.pdf` | U-B0.1: 6 additive gap(s) | Orders are published group-first: the list is /v1/store/order-groups, the order detail is lean with sub-resources (timeline, progress, shipments, proofs, design service, claims, documents), and document downloads go through /v1/store/documents/{id}/pdf. |

## U-B0.1 — `store.*`: account, artwork & designs, fulfilment, support, business

| Id | Frontend operations | Verdict | Backend operationId(s) | Work here | Notes |
|---|---|---|---|---|---|
| `store.loyalty` | `GET /v1/store/me/points`<br>`GET /v1/store/me/points/entries`<br>`GET /v1/store/me/referral` | published differently | `store.loyalty.get`, `store.loyalty.ledger`, `store.referral.get` | U-B0.1: 5 additive gap(s) | Points balance/tier and history exist as store.loyalty.get and store.loyalty.ledger under /v1/store/loyalty; referral exists as store.referral.get but only with the code, link and per-status counts. Tier progress and the referral friend list, rules and monthly counter are additive gaps. |
| `store.wallet` | `GET /v1/store/me/wallet` | published differently | `store.documents.storeCredit` | U-B0.1: 1 additive gap(s) | Store credit exists as store.documents.storeCredit (GET /v1/store/store-credit) with a different entry shape; there is no customer-facing list of the promotion codes a customer holds, which is an additive gap. Spending the balance at checkout: U2.F (D-196). |
| `store.privacy` | `GET /v1/store/me/privacy-requests`<br>`POST /v1/store/me/privacy-requests` | implement here (U-B0.1) | — | U-B0.1: implement in `customers` | No PDPA data-subject request (export / deletion) exists in the backend; it must be built. |
| `store.identities` | `DELETE /v1/store/me/identities/{provider}` | implement here (U-B0.1) | — | U-B0.1: implement in `auth` | Linked identities are listed on store.me.get (identities[]) but there is no unlink endpoint; it must be built. |
| `store.artwork` | `GET /v1/store/orders/{orderId}/artwork`<br>`POST /v1/store/orders/{orderId}/artwork/submissions` | published differently | `store.artwork.list`, `store.artwork.submit` | U-B0.1: 5 additive gap(s) | The backend has no single artwork aggregate: the same data comes from store.orders.get + store.artwork.list + store.artwork.listProofs + store.artwork.listTemplates + store.designServices.get, and submitting is store.artwork.submit (hyphenated path, returns the submission). The file rules, checklist, dieline dimensions and nextActions are gaps. |
| `store.proofs` | `POST /v1/store/orders/{orderId}/proofs/{proofId}/actions/approve`<br>`POST /v1/store/orders/{orderId}/proofs/{proofId}/actions/request-changes`<br>`GET /v1/store/orders/{orderId}/proofs/{proofId}/annotations`<br>`POST /v1/store/orders/{orderId}/proofs/{proofId}/annotations`<br>`POST /v1/store/orders/{orderId}/proofs/{proofId}/annotations/{annotationId}/messages` | published differently | `store.artwork.approveProof`, `store.artwork.requestProofChanges`, `store.artwork.getProof`, `store.artwork.annotate` | U-B0.1: 4 additive gap(s) | Proof actions exist at /v1/store/proofs/{proofId}/… without the orderId prefix and return ProofDto; annotation threads are flat annotations with parentId (replies via store.artwork.annotate). Rasterised pages, dieline overlay per page and the approval checklist/note are gaps. |
| `store.design-service` | `POST /v1/store/orders/{orderId}/design-service/actions/approve`<br>`PUT /v1/store/orders/{orderId}/design-service/brief`<br>`POST /v1/store/orders/{orderId}/design-service/rounds` | published differently | `store.artwork.approveProof`, `store.designServices.submitBrief`, `store.designServices.confirmExtraRound` | U-B0.1: 1 additive gap(s) | Hired design exists (store.designServices.get / submitBrief / confirmExtraRound) but the backend drives rounds through proofs: approving the delivered design is store.artwork.approveProof and a free revision is store.artwork.requestProofChanges; only chargeable rounds use confirm-extra-round. The brief has fixed fields, not RFQ-style questions. |
| `store.designs` | `GET /v1/store/designs`<br>`POST /v1/store/designs`<br>`DELETE /v1/store/designs/{designId}`<br>`GET /v1/store/designs/{designId}`<br>`PUT /v1/store/designs/{designId}`<br>`POST /v1/store/designs/{designId}/actions/duplicate`<br>`GET /v1/store/designs/{designId}/versions`<br>`GET /v1/store/designs/{designId}/versions/{versionNo}`<br>`POST /v1/store/designs/{designId}/versions/{versionNo}/actions/restore`<br>`POST /v1/store/designs/actions/import` | mixed: 6 published differently · 1 published · 3 implement here | `store.designs.list`, `store.designs.create`, `store.designs.delete`, `store.designs.get`, `store.designs.save`, `store.designs.listVersions`, `store.designs.getVersion` | U-B0.1: implement in `designs`; 10 additive gap(s) | CRUD, save-with-If-Match and version read exist under the same paths, with the backend DesignDocumentDto shape (title, catalogProductId, flat document+schemaVersion, file ids instead of URLs); duplicate, restore and import are missing and must be built. |
| `store.design-assets` | `POST /v1/store/designs/{designId}/assets` | published differently | `store.designs.addAsset` | U-B0.1: 2 additive gap(s) | store.designs.addAsset exists at the same path but takes {fileId, kind} and returns the whole design; there is no design_asset FilePurpose, no dimensions and no signed URL on the asset. |
| `store.designer-catalog` | `GET /v1/store/designer/catalog`<br>`GET /v1/store/designer/templates/{templateId}` | implement here (U-B0.1) | — | U-B0.1: implement in `designs` | No designer catalogue exists. store.catalog.getProduct gives patterns (code, name, dielineKey, constraints) and standard sizes, and store.catalog.listSemiDesigns gives semi-designs, but material caliper, flute allowances, template documents, fonts, colours and artwork rules are not published to the store; it must be built. |
| `store.design-share` | `POST /v1/store/designs/{designId}/actions/share`<br>`DELETE /v1/store/designs/{designId}/share`<br>`GET /v1/store/shared-designs/{token}` | implement here (U-B0.1) | — | U-B0.1: implement in `designs` | No design sharing exists; it must be built (the quote share-token pattern store.quotes.share / store.quotes.getShared is the model). |
| `store.tracking` | `GET /v1/store/tracking/{token}` | published differently | `store.tracking.get` | U-B0.1: 2 additive gap(s) | Public tracking exists as store.tracking.get at /v1/store/track/{token} (tokens from store.timeline.createTrackingLink), with steps/shipments in a different shape; per-order stages for the signed-in customer are store.timeline.progress. Backend deliberately exposes no location (no province), no product name or quantity. |
| `store.receipt` | `POST /v1/store/orders/{orderId}/actions/confirm-receipt` | published differently | `store.orders.confirmReceipt` | U-B0.1: 1 additive gap(s) | store.orders.confirmReceipt exists at the same path with Idempotency-Key, but returns OrderDto without a receipt block and uses 409 order.invalid_transition; confirmedAt / claimWindowEndsAt are a gap. |
| `store.claims` | `GET /v1/store/orders/{orderId}/claim-form`<br>`POST /v1/store/orders/{orderId}/claims`<br>`GET /v1/store/orders/{orderId}/claims/{claimId}`<br>`POST /v1/store/orders/{orderId}/claims/{claimId}/messages` | mixed: 1 implement here · 3 published differently | `store.claims.submit`, `store.claims.get`, `store.claims.respondInfo` | U-B0.1: implement in `claims`; 2 additive gap(s) | Claim submit exists (store.claims.submit, same path), claim read is store.claims.get at /v1/store/claims/{claimId}, and replies are only the answer to an info request (store.claims.respondInfo). There is no claim-form endpoint and no free message thread. |
| `store.reorder` | `POST /v1/store/orders/{orderId}/actions/reorder`<br>`GET /v1/store/orders/{orderId}/reorder` | mixed: 1 published differently · 1 implement here | `store.claims.reorder` | U-B0.1: implement in `claims`; 1 additive gap(s) | The reorder action exists (store.claims.reorder) but adds straight to the cart and returns the CartDto, with no preview token; the re-priced preview GET must be built. The tooling waiver follows D-205 (U2.F, F1). |
| `store.support` | `POST /v1/store/support/actions/contact`<br>`POST /v1/store/support/actions/handoff` | implement here (U-B0.1) | — | U-B0.1: implement in `conversations` | No contact-form or guided-help hand-off endpoint exists; both must be built (public, rate-limited). |
| `store.guided-help` | `POST /v1/store/guided-help/actions/recommend` | implement here (U-B0.1) | — | U-B0.1: implement in `catalog` | No recommendation endpoint exists; it must be built from catalogue data. |
| `store.sample-kits` | `GET /v1/store/sample-kits`<br>`POST /v1/store/sample-kits/actions/request` | implement here (U-B0.1) | — | U-B0.1: implement in `catalog` | No sample-kit catalogue or request flow exists; it must be built, but kit contents, prices and first-order crediting are business values with no decision yet (D-192–D-197 cover configured samples, not kits). |
| `store.companies` | `POST /v1/store/companies`<br>`GET /v1/store/me/company`<br>`PATCH /v1/store/me/company` | published differently | `store.companies.apply`, `store.companies.get`, `store.companies.updateSettings` | U-B0.1: 7 additive gap(s) | Company sign-up and settings exist per company id (store.companies.apply, store.companies.get, store.companies.updateSettings, plus addKycDocument/submitKyc and companyCredit.get); there is no singular /me/company, and a user may belong to several companies. Signatory details, contact phone, role capabilities, receivables and notices are gaps. |
| `store.company-members` | `GET /v1/store/me/company/members`<br>`POST /v1/store/me/company/members`<br>`DELETE /v1/store/me/company/members/{memberId}`<br>`PATCH /v1/store/me/company/members/{memberId}` | mixed: 3 published differently · 1 implement here | `store.companies.get`, `store.companies.inviteMember`, `store.companies.removeMember` | U-B0.1: implement in `companies`; 1 additive gap(s) | Members come inside CompanyDto (store.companies.get); invite and remove exist under /v1/store/companies/{companyId}/members; changing a member's roles does not exist and must be built. |
| `store.company-branches` | `GET /v1/store/me/company/branches`<br>`POST /v1/store/me/company/branches`<br>`DELETE /v1/store/me/company/branches/{branchId}` | published differently | `store.companies.get`, `store.companies.addBranch`, `store.companies.removeBranch` | U-B0.1: 1 additive gap(s) | Branches come inside CompanyDto; add and remove exist under /v1/store/companies/{companyId}/branches with a structured address. |
| `store.company-assets` | `GET /v1/store/me/company/brand-assets`<br>`POST /v1/store/me/company/brand-assets`<br>`DELETE /v1/store/me/company/brand-assets/{assetId}` | implement here (U-B0.1) | — | U-B0.1: implement in `companies` | No company brand-asset library exists; it must be built. |
| `store.company-approvals` | `GET /v1/store/me/company/approvals`<br>`POST /v1/store/me/company/approvals`<br>`POST /v1/store/me/company/approvals/{approvalId}/actions/approve`<br>`POST /v1/store/me/company/approvals/{approvalId}/actions/reject` | published differently | `store.companyApprovals.list`, `store.checkout.place`, `store.companyApprovals.decide` | U-B0.1: 4 additive gap(s) | D-123 approvals exist but the backend places the order at checkout as pending_company_approval (store.checkout.place with companyId) instead of a separate approval request; list and decide are store.companyApprovals.list / decide under /v1/store/companies/{companyId}/approvals. The preview signals it through a company.approval_required notice. |
| `store.company-credit` | `POST /v1/store/me/company/credit-applications`<br>`GET /v1/store/me/company/statements`<br>`POST /v1/store/me/company/statements/{statementId}/actions/download` | mixed: 1 implement here · 2 published differently | `store.documents.companyStatement`, `store.documents.companyStatementPdf` | U-B0.1: implement in `companies`; 2 additive gap(s) | Monthly statements exist per month (store.documents.companyStatement / store.companyCredit.statement, PDF via store.documents.companyStatementPdf) but not as a list with aging; a customer credit application does not exist (only the admin-side admin.companyCredit.requestLimit). |
| `store.company-spend` | `GET /v1/store/me/company/spend` | implement here (U-B0.1) | — | U-B0.1: implement in `companies` | No company spend summary exists; it must be built. |
| `store.company-reorder` | `POST /v1/store/me/company/bulk-reorders`<br>`POST /v1/store/me/company/bulk-reorders/actions/preview` | implement here (U-B0.1) | — | U-B0.1: implement in `claims` | No bulk reorder exists; single reorder is store.claims.reorder. Both bulk preview and add must be built. |

## U-B0.2 shipped (`v0.5.0`, 2026-10-01)

Every U-B0.2 row below is now **published** (`v0.5.0`). "Published differently" keeps its mapping in *Details*; the table says what the group added. Nothing was removed or made required on the wire: every new `Idempotency-Key` and `If-Match` is optional (required would break `v0.4.0` clients), every new field is additive. `allowedActions` / `nextActions` are U-B0.3 for every row.

| Id | Now | Added in U-B0.2 (operationIds / fields) | Published differently / left out |
|---|---|---|---|
| `admin.orders` | published differently | `admin.orders.list` (filters, customer / factory refs, next instalment, slip-review SLA); group `customer`, `placedBy`, `taxProfile`, `hasSlipToReview`; staff timeline `promisedAt` | Page-shaped aggregate (the web composes); order `urgency` (no order SLA decided) |
| `admin.order-notes` | published | `OrderNoteDto.mentions` | — |
| `admin.order-actions` | published differently | `admin.orders.listCancelReasons`, `admin.orders.sendPaymentReminder`, `sendPaymentReminders` (one per group per hour); optional `Idempotency-Key` on cancel / cancelGroup / startManually; `admin.payments.list?groupId&orderId` | Slips stay on the payments resources |
| `admin.customers` | published differently | `?customerType&createdVia`; `companyName`, `ordersCount`, `lastOrderAt`, `referralCode` | Birth date (not collected) |
| `admin.geo` | published differently | geography reads carry ids (`CodeNameRefDto`) | Uses `store.catalog.lookupPostcode` |
| `admin.cs-calculators` | published differently (6 calculators) | pattern `rules`, `catalogProducts`, `discountPolicy.directLimitPct`; `admin.csLabel.*` since `v0.7.0`; `admin.csTagSleeve.*` since `v0.8.0`; `admin.csPouch.*` since `v0.9.0`; `admin.csStandardProduct.*` since `v0.10.0` | Service → U-B6 |
| `admin.quotations` | published differently | `?channel`, `customerCode`, `rfq` ref, internal `note` | Multi-factory grid (the API picks the factory, D-043) |
| `admin.discount-memos` | published differently | `?requestedBy`, `evidence` | No memo code (no series decided) |
| `admin.cs-create-order` | published differently | — | Through the customer's cart + `admin.checkout.place` |
| `admin.rfqs` | published differently | list filters (product type, channel, dates, `awaitingFactory`); `customerCode`, `contact`, `slaTargetHours`, `routedFromCalculator`, `specLines`, `quoteDefaults.validUntil`; ETag on get | `suggestedUnitPrice` (needs the engine's sell-margin resolution) |
| `admin.rfq-messages` | published differently | staff message `fileIds` | Messages inline on `admin.rfqs.get` |
| `admin.rfq-actions` | published | `admin.rfqs.startReview`; assign `null` unassigns; optional `Idempotency-Key` on decline | — |
| `admin.unmet-demand-reasons` | published | `admin.rfqs.listUnmetDemandReasons` | — |
| `admin.rfq-consultations` | published differently | `admin.rfqs.listCandidateFactories`, `admin.rfqs.remindConsultation`; factory notifications for requested / reminded | One factory per consultation call |
| `admin.rfq-quotes` | published | `admin.rfqs.replaceDraftQuotation` (If-Match), `admin.rfqs.recordAcceptance` | — |
| `admin.prepress` | published differently | queue filters (assignee, product type, artwork status) and refs | Per-order workspace composed client-side; mockup ref → U2.F (D-192) |
| `admin.prepress-actions` | published | `admin.artwork.assignPrepress` (A-62); accept note | — |
| `admin.prepress-proofs` | published differently | annotation `resolvedBy`; reply inherits geometry | — |
| `admin.prepress-template` | published differently | `admin.designs.listOrderDrawings`, `DrawingJobDto.outputFile` | — |
| `admin.design-services` | published differently | optional `Idempotency-Key` on deliver / requote | — |
| `admin.design-documents` | published | `owner`, `editable`, `admin.designs.copy`, 409 `designs.read_only` | — |
| `admin.production-board` | published | `admin.production.board`; list `?factoryId&productTypeCode`; `productTypeCode`, `currentMilestoneKey`, `riskReason` | — |
| `admin.inspections` | published differently | `?factoryId`; typed `accept` / `found`, `aql`, order ref, product type, `inspectorUser`; optional `Idempotency-Key` on record | — |
| `admin.scorecards` | published | `admin.inspections.monthScorecards` | — |
| `admin.campaigns` | published differently | `owner`, `spentPct`, `promotionsCount`, `createdAt`; action `reason` | Campaign `newCustomersCount` (no decided definition) |
| `admin.promotions` | published differently | `admin.promotions.reorder` (priorities 10, 20, …); `benefitSummaryTh/En`, `usage`, `campaign` ref, `updatedAt` | Zones instead of provinces (D-053) |
| `admin.coupons` | published differently | `admin.promotions.listCouponBatches`; coupon `?batchId&status`, `batchId`, `assignedCustomer`; disable `reason` | Codes stay under the promotion |
| `admin.referrals` | published differently | `?referrerId`; `firstOrderGrossAmount`, `firstOrderClaimWindowEndsAt`, `rewardPoints`, `ReferralFraudFlag` | — |
| `admin.customer-loyalty` | published differently | ledger `?entryType` | Balance on `…/loyalty` |
| `admin.customer-consents` | published | `admin.consentPurposes.customerConsents` | — |
| `admin.companies` | published differently | `?creditStatus`; `membersCount`, member `email` / `phone`, KYC file name / signed URL / uploaded / reviewed by, `discount`, `receivables` summary; ETag; optional If-Match on staff actions | Members, branches and KYC stay inline |
| `admin.company-credit` | published differently | eligibility `reason`, `versions[]`, pending `versionNo` / `approvalId`; optional `Idempotency-Key` on requestLimit; `admin.companyCredit.receivables`, `admin.companyCredit.listStatements`, `admin.receivables.companyStatementPdf` | No evidence files (the statement is a KYC document, D-121); no statement due date or status (each invoice keeps its term) |
| `admin.shipments` | published | `?queue&carrier&factoryId`; `cartons`, destination `province`, `blockedByPayment`, `exception`, `podReview`, `splitFrom`; ETag; `admin.shipments.resolveException`, `split`, `carrierQuotes`, `reviewPod` (D-229, D-230, A-63); `bookCarrier` `reason` | Documents are file ids (`admin.files.download`); only drafts split (D-230); no per-trip customer charge |
| `admin.claims` | published differently | `?type&origin&customerId&factoryId`; `customer`, `shipmentNo`, `liabilityRule`, `liabilityOverriddenBy`, `decidedBy`, `approvedProof`; ETag | One op per action (Idempotency-Key); `slaDueAt` → U2.5; no message thread (D-225) |

## U-B0.2 — `admin.*` commerce & operations

| Id | Frontend operations | Verdict | Backend operationId(s) | Work here | Notes |
|---|---|---|---|---|---|
| `admin.orders` | `GET /v1/admin/order-groups/{groupId}`<br>`GET /v1/admin/orders`<br>`GET /v1/admin/orders/{orderId}`<br>`GET /v1/admin/orders/{orderId}/timeline` | published differently | `admin.orders.getGroup`, `admin.orderOperations.queue`, `admin.orders.get`, `admin.timeline.get` | U-B0.2: 9 additive gap(s) | Group detail, order detail and timeline exist, but the order detail is a lean AdminOrderDto (lines, destinations, totals, internal margin) rather than the page-shaped aggregate; there is no GET /v1/admin/orders list — CS queues are GET /v1/admin/order-queues/{queue} with a different queue enum. |
| `admin.order-notes` | `GET /v1/admin/orders/{orderId}/notes`<br>`POST /v1/admin/orders/{orderId}/notes` | published differently | `admin.orderOperations.listNotes`, `admin.orderOperations.addNote` | U-B0.2: 2 additive gap(s) | Both note ops exist with the same body; the note DTO has no `mentions` (mentions appear on timeline entries) and the list is offset-paged with meta. |
| `admin.order-actions` | `GET /v1/admin/order-cancel-reasons`<br>`POST /v1/admin/orders/{orderId}/actions/approve-slip`<br>`POST /v1/admin/orders/{orderId}/actions/cancel`<br>`POST /v1/admin/orders/{orderId}/actions/record-slip`<br>`POST /v1/admin/orders/{orderId}/actions/reject-slip`<br>`POST /v1/admin/orders/{orderId}/actions/send-payment-reminder`<br>`POST /v1/admin/orders/{orderId}/actions/start-production`<br>`POST /v1/admin/orders/actions/send-payment-reminders` | mixed: 3 implement here · 5 published differently | `admin.payments.reviewSlip`, `admin.orders.cancel`, `admin.payments.uploadSlip`, `admin.production.startManually` | U-B0.2: implement in `orders`, `payment-schedules`; 2 additive gap(s) | Cancel and manual start exist on the order (cancel answers AdminOrderDto, start answers the production job, neither declares Idempotency-Key); slip approve/reject/record live on the payments resources (Finance slip queue, payment slips); cancel reasons and payment reminders have no endpoint. |
| `admin.customers` | `GET /v1/admin/customers`<br>`POST /v1/admin/customers`<br>`GET /v1/admin/customers/{customerId}`<br>`POST /v1/admin/customers/{customerId}/addresses` | published differently | `admin.customers.list`, `admin.customers.findOrCreate`, `admin.customers.get`, `admin.customers.createAddress` | U-B0.2: 4 additive gap(s) | All four ops exist. Create is find-or-create (200/201 with { created, customer }); the detail has no addresses/tax profiles/loyalty (separate endpoints); addresses take provinceId/subdistrictId uuids and answer province/subdistrict objects. |
| `admin.geo` | `GET /v1/admin/geo/postcodes/{postcode}` | published differently | `store.catalog.lookupPostcode` | U-B0.2: 1 additive gap(s) | No admin postcode endpoint, but the store's public postcode lookup (and the admin geography subdistricts list filtered by postcode) cover it with a flat list of subdistrict/district/province areas. |
| `admin.cs-calculators` | `POST /v1/admin/cs/{type}/calculate`<br>`GET /v1/admin/cs/{type}/input-data` | published differently | `admin.csFolding.calculate`, `admin.csFolding.inputData`, `admin.csCorrugate.calculate`, `admin.csCorrugate.inputData` | U-B0.2: 6 additive gap(s) | Folding (B2.3) and, since `v0.3.0`, corrugate are published as fixed paths per calculator (`/v1/admin/cs/{folding\|corrugate}/input-data`, `…/calculate`) with calculator-specific bodies and an AdminQuoteCalculationDto (steps carry toolingAmount). The other five calculators (label, tag_sleeve, pouch, standard_product, service) are not published (U-B6 work). |
| `admin.quotations` | `GET /v1/admin/quotations`<br>`POST /v1/admin/quotations`<br>`GET /v1/admin/quotations/{quoteId}`<br>`POST /v1/admin/quotations/{quoteId}/actions/export-pdf` | published differently | `admin.quotes.list`, `admin.quotes.create`, `admin.quotes.get`, `admin.quotes.requestPdf` | U-B0.2: 9 additive gap(s) | Published as /v1/admin/quotes (list, create, get, request-pdf + GET pdf, share). Create prices a configuration (no calculationId/resultId) and discounts are not on the quotation — CS discount and memo apply at checkout. Since `v0.3.0` the configuration may be corrugate; the saved option lacks toolingAmount (gap). |
| `admin.discount-memos` | `GET /v1/admin/discount-memos`<br>`POST /v1/admin/discount-memos`<br>`GET /v1/admin/discount-memos/{memoId}` | published differently | `admin.discountMemos.list`, `admin.discountMemos.raise`, `admin.discountMemos.get` | U-B0.2: 4 additive gap(s) | All three ops exist; the memo prices the customer's CS cart (no calculationId/resultId), has no memoCode or evidence file refs, and names the approval `approvalId`. |
| `admin.cs-create-order` | `POST /v1/admin/orders` | published differently | `admin.checkout.place` | — (frontend migrates) | CS orders through the customer's cart: add the quotation option to /v1/admin/customers/{customerId}/cart/items (with destinations, design/mockup options), then POST …/checkout (Idempotency-Key) which returns the order group. The mockup option becomes a `sample` in U2.F (D-192). |
| `admin.rfqs` | `GET /v1/admin/rfqs`<br>`GET /v1/admin/rfqs/{rfqId}` | published differently | `admin.rfqs.list`, `admin.rfqs.get` | U-B0.2: 10 additive gap(s) | List and detail exist, both returning the full AdminRfqDto (messages, consultations, quotations inline); no named queues, spec is a raw map, and files/events/nextActions/urgency/SLA target/quote defaults are missing. |
| `admin.rfq-messages` | `GET /v1/admin/rfqs/{rfqId}/messages`<br>`POST /v1/admin/rfqs/{rfqId}/messages` | published differently | `admin.rfqs.get`, `admin.rfqs.postMessage` | U-B0.2: 2 additive gap(s) | Posting a message exists (answers the whole AdminRfqDto, no fileIds); there is no separate message list — messages come inline on admin.rfqs.get. |
| `admin.rfq-actions` | `POST /v1/admin/rfqs/{rfqId}/actions/assign`<br>`POST /v1/admin/rfqs/{rfqId}/actions/decline`<br>`POST /v1/admin/rfqs/{rfqId}/actions/request-info`<br>`POST /v1/admin/rfqs/{rfqId}/actions/start-review` | mixed: 3 published differently · 1 implement here | `admin.rfqs.assign`, `admin.rfqs.decline`, `admin.rfqs.requestInfo` | U-B0.2: implement in `rfq`; 2 additive gap(s) | assign, request-info and decline exist (answer AdminRfqDto) with renamed body fields; there is no start-review — assignment or a factory consultation moves submitted → in_review. |
| `admin.unmet-demand-reasons` | `GET /v1/admin/unmet-demand-reasons` | implement here (U-B0.2) | — | U-B0.2: implement in `rfq` | The `unmet_demand_reasons` table is seeded, but no endpoint lists it (only the analytics report GET /v1/admin/analytics/unmet-demand). |
| `admin.rfq-consultations` | `GET /v1/admin/rfqs/{rfqId}/candidate-factories`<br>`POST /v1/admin/rfqs/{rfqId}/consultations`<br>`POST /v1/admin/rfqs/{rfqId}/consultations/{consultationId}/actions/remind` | mixed: 2 implement here · 1 published differently | `admin.rfqs.requestConsultation` | U-B0.2: implement in `rfq`; 2 additive gap(s) | Requesting a factory consultation exists but for one factory per call (factoryId) and answers the AdminRfqDto; candidate factories and remind are not published. |
| `admin.rfq-quotes` | `POST /v1/admin/rfqs/{rfqId}/quotes`<br>`DELETE /v1/admin/rfqs/{rfqId}/quotes/{quoteId}`<br>`PUT /v1/admin/rfqs/{rfqId}/quotes/{quoteId}`<br>`POST /v1/admin/rfqs/{rfqId}/quotes/{quoteId}/actions/record-acceptance`<br>`POST /v1/admin/rfqs/{rfqId}/quotes/{quoteId}/actions/send` | mixed: 3 published differently · 2 implement here | `admin.rfqs.draftQuotation`, `admin.rfqs.discardQuotation`, `admin.rfqs.sendQuotation` | U-B0.2: implement in `rfq`; 3 additive gap(s) | Draft create, send and discard exist under different paths (/rfqs/{rfqId}/quotations, /rfq-quotations/{id}/actions/{send,discard}); there is no draft update (PUT) and no CS-recorded acceptance. |
| `admin.prepress` | `GET /v1/admin/prepress`<br>`GET /v1/admin/prepress/{orderId}` | published differently | `admin.artwork.queue`, `admin.artwork.list` | U-B0.2: 7 additive gap(s) | The prepress queue exists as GET /v1/admin/prepress/queue with three kinds (submissions, changes_requested, proofs_waiting) and lean rows; there is no per-order workspace aggregate — the pieces are per-resource artwork, proof, template, design-service and design endpoints. The mockup job ref moved to U2.F with the `sample` entity (D-192, re-triaged 2026-09-30). |
| `admin.prepress-actions` | `POST /v1/admin/prepress/{orderId}/actions/assign`<br>`POST /v1/admin/prepress/submissions/{submissionId}/actions/accept`<br>`POST /v1/admin/prepress/submissions/{submissionId}/actions/reject` | mixed: 1 implement here · 2 published differently | `admin.artwork.accept`, `admin.artwork.reject` | U-B0.2: implement in `artwork`; 1 additive gap(s) | Accept and reject exist on /v1/admin/artwork-submissions/{submissionId}/actions/{accept,reject} answering the submission (accept takes no note); prepress assignment of an order does not exist. |
| `admin.prepress-proofs` | `POST /v1/admin/prepress/{orderId}/proofs`<br>`GET /v1/admin/prepress/proofs/{proofId}/annotations`<br>`POST /v1/admin/prepress/proofs/{proofId}/annotations`<br>`POST /v1/admin/prepress/proofs/{proofId}/annotations/{annotationId}/actions/resolve` | published differently | `admin.artwork.sendProof`, `admin.artwork.getProof`, `admin.artwork.annotate`, `admin.artwork.resolveAnnotation` | U-B0.2: 3 additive gap(s) | All four exist under the artwork resources: send proof on /v1/admin/orders/{orderId}/proofs, annotations inline on GET /v1/admin/proofs/{proofId}, annotate and resolve answer the whole proof; a staff reply currently needs kind/page/geometry. |
| `admin.prepress-template` | `POST /v1/admin/prepress/{orderId}/actions/send-template`<br>`POST /v1/admin/prepress/{orderId}/drawing-jobs` | published differently | `admin.artwork.sendTemplate`, `admin.designs.drawForOrder` | U-B0.2: 2 additive gap(s) | Drawing (POST /v1/admin/orders/{orderId}/drawings, 202 or 501 drawing.engine_unavailable) and sending a template by hand (POST /v1/admin/orders/{orderId}/templates, a required fileId) exist under /orders. |
| `admin.design-services` | `POST /v1/admin/prepress/{orderId}/design/actions/deliver-round`<br>`POST /v1/admin/prepress/{orderId}/design/actions/requote` | published differently | `admin.designServices.deliver`, `admin.designServices.requote` | U-B0.2: 1 additive gap(s) | Deliver and requote exist on the design-service resource (/v1/admin/design-services/{designServiceId}/actions/{deliver,requote}) with the same bodies, answering DesignServiceDto. |
| `admin.design-documents` | `GET /v1/admin/design-documents/{documentId}`<br>`PUT /v1/admin/design-documents/{documentId}`<br>`POST /v1/admin/design-documents/{documentId}/actions/copy` | mixed: 2 published differently · 1 implement here | `admin.designs.get`, `admin.designs.save` | U-B0.2: implement in `designs`; 2 additive gap(s) | Get and save exist as /v1/admin/designs/{designId} (ETag + If-Match, save only on the staff author's designs); there is no editable flag, owner or copy action. |
| `admin.production-board` | `GET /v1/admin/production-board` | published differently | `admin.production.list` | U-B0.2: 4 additive gap(s) | No board endpoint; GET /v1/admin/production-jobs lists jobs (with milestones, atRisk, predictedFinishOn, inspectionRequired) and has an at_risk queue, but no grouping by current milestone, no factoryId/productType filter and no risk reason. |
| `admin.inspections` | `GET /v1/admin/inspections`<br>`POST /v1/admin/inspections/{inspectionId}/actions/record` | published differently | `admin.inspections.list`, `admin.inspections.record` | U-B0.2: 6 additive gap(s) | List and record exist; the DTO uses jobId/jobNo/factoryCode and free maps for accept/found, has no AQL values, and record takes foundCritical/foundMajor/foundMinor flat without Idempotency-Key. |
| `admin.scorecards` | `GET /v1/admin/scorecards` | published differently | `admin.inspections.scorecards` | U-B0.2: 1 additive gap(s) | Scorecards exist per factory (GET /v1/admin/factories/{factoryId}/scorecards, latest 12 months) with the same metric fields; there is no all-factories-for-a-month view. |
| `admin.campaigns` | `GET /v1/admin/campaigns`<br>`POST /v1/admin/campaigns`<br>`GET /v1/admin/campaigns/{campaignId}`<br>`PATCH /v1/admin/campaigns/{campaignId}`<br>`POST /v1/admin/campaigns/{campaignId}/actions/{action}` | published differently | `admin.campaigns.list`, `admin.campaigns.create`, `admin.campaigns.get`, `admin.campaigns.update`, `admin.campaigns.action` | U-B0.2: 6 additive gap(s) | All five ops exist with the same paths; DTOs lack owner, spentPct, promotionsCount, createdAt, performance and allowedActions, `goals` is an object map, and the action enum is activate\|pause\|end (activate resumes a paused campaign; no reason, no If-Match). |
| `admin.promotions` | `GET /v1/admin/promotions`<br>`POST /v1/admin/promotions`<br>`GET /v1/admin/promotions/{promotionId}`<br>`PATCH /v1/admin/promotions/{promotionId}`<br>`POST /v1/admin/promotions/{promotionId}/actions/{action}`<br>`PUT /v1/admin/promotions/priority` | mixed: 5 published differently · 1 implement here | `admin.promotions.list`, `admin.promotions.create`, `admin.promotions.get`, `admin.promotions.update`, `admin.promotions.action` | U-B0.2: implement in `promotions`; 8 additive gap(s) | List/create/get/update/action exist; conditions/benefit are typed but without schemaVersion, with different benefit types (free_design vs free_design_rounds, tiered vs tiered_percent, + free_revision_rounds, unit_price_override) and zoneCodes instead of provinceIds; usage/allowedActions/benefitSummary missing; the bulk priority reorder does not exist (priority is a per-promotion field). |
| `admin.coupons` | `POST /v1/admin/coupon-codes/{codeId}/actions/disable`<br>`GET /v1/admin/promotions/{promotionId}/coupon-batches`<br>`POST /v1/admin/promotions/{promotionId}/coupon-batches`<br>`GET /v1/admin/promotions/{promotionId}/coupon-codes` | mixed: 3 published differently · 1 implement here | `admin.promotions.setCouponStatus`, `admin.promotions.generateCoupons`, `admin.promotions.listCoupons` | U-B0.2: implement in `promotions`; 5 additive gap(s) | Codes are published as /v1/admin/promotions/{promotionId}/coupons (list, generate with Idempotency-Key, export, enable/disable); there is no batch list, no batchId/status filter and disable is nested under the promotion without a reason. |
| `admin.referrals` | `GET /v1/admin/referrals` | published differently | `admin.referrals.list` | U-B0.2: 4 additive gap(s) | The referral queue exists with the same statuses; approvalRequestId is approvalId, the first order is flattened to a group id/code, fraudFlags are free strings and referralCode/rewardPoints/referrerId filter are missing. |
| `admin.customer-loyalty` | `GET /v1/admin/customers/{customerId}/points` | published differently | `admin.loyalty.ledger` | U-B0.2: 1 additive gap(s) | Points ledger is GET /v1/admin/customers/{customerId}/loyalty/ledger (same entry fields, orderCode/groupCode flat, reason instead of note); the balance is a separate GET …/loyalty. |
| `admin.customer-consents` | `GET /v1/admin/customers/{customerId}/consents` | implement here (U-B0.2) | — | U-B0.2: implement in `platform/notifications (src/platform/notifications, where store.me.consents and admin.consentPurposes live — not under src/modules)` | No staff read of a customer's consents; only the store's own GET /v1/store/me/consents and the admin purpose/text catalogue (admin.consentPurposes.list). |
| `admin.companies` | `GET /v1/admin/companies`<br>`GET /v1/admin/companies/{companyId}`<br>`POST /v1/admin/companies/{companyId}/actions/{action}`<br>`GET /v1/admin/companies/{companyId}/branches`<br>`GET /v1/admin/companies/{companyId}/kyc-documents`<br>`POST /v1/admin/companies/{companyId}/kyc-documents/{documentId}/actions/review`<br>`GET /v1/admin/companies/{companyId}/members` | published differently | `admin.companies.list`, `admin.companies.get`, `admin.companies.setStatus`, `admin.companies.reviewKycDocument` | U-B0.2: 10 additive gap(s) | List, detail, status actions and KYC document review exist; members, branches and KYC documents are inline on the company (no sub-list endpoints), receivables and credit come from other endpoints, and the actions split into approve-kyc / reject-kyc / {suspend, reactivate, close} without If-Match. |
| `admin.company-credit` | `POST /v1/admin/companies/{companyId}/credit-limits`<br>`GET /v1/admin/companies/{companyId}/statements` | published differently | `admin.companyCredit.requestLimit`, `admin.receivables.companyStatement` | U-B0.2: 6 additive gap(s) | Credit-limit request and monthly statements exist; the request's basis enum differs (financial_statement vs financial_review), has no evidenceFileIds or Idempotency-Key and answers the credit summary; statements are one month per call (month required). |
| `admin.shipments` | `GET /v1/admin/shipments`<br>`GET /v1/admin/shipments/{shipmentId}`<br>`POST /v1/admin/shipments/{shipmentId}/actions/book-carrier`<br>`POST /v1/admin/shipments/{shipmentId}/actions/resolve-exception`<br>`POST /v1/admin/shipments/{shipmentId}/actions/split`<br>`POST /v1/admin/shipments/{shipmentId}/carrier-quotes`<br>`POST /v1/admin/shipments/{shipmentId}/documents`<br>`POST /v1/admin/shipments/{shipmentId}/pod/actions/{decision}` | mixed: 4 published differently · 4 implement here | `admin.shipments.list`, `admin.shipments.get`, `admin.shipments.bookCarrier`, `admin.files.download` | U-B0.2: implement in `logistics`; 9 additive gap(s) | List, detail and fallback carrier booking exist (booking takes the carrier directly, not a quote id; no If-Match; no ETag on detail); split, per-shipment carrier quotes, exception resolution and POD review are not published; labels/packing list are file ids on the shipment downloaded via admin.files.download. |
| `admin.claims` | `GET /v1/admin/claims`<br>`GET /v1/admin/claims/{claimId}`<br>`POST /v1/admin/claims/{claimId}/actions/{action}`<br>`POST /v1/admin/claims/{claimId}/liability`<br>`POST /v1/admin/claims/{claimId}/resolutions` | published differently | `admin.claims.list`, `admin.claims.get`, `admin.claims.decide`, `admin.claims.overrideLiability`, `admin.claims.resolve` | U-B0.2: 8 additive gap(s) | List, detail, every action, liability override and resolutions exist, but as one op per action (review, request-info, send-to-factory, decide approved\|rejected, close, override-liability, resolve with actions[]) guarded by Idempotency-Key rather than If-Match; detail lacks allowedActions/allowedResolutions, messages and refs. |

## U-B0.3 shipped (`v0.6.0`, 2026-10-01)

Every U-B0.3 row below is now **published** (`v0.6.0`), except `admin.analytics-journeys` (built in U5.B6, post-launch, D-219). "Published differently" keeps its mapping in *Details*; the table says what the group added. Nothing was removed or made required on the wire: new `Idempotency-Key` / `If-Match` headers are optional where the operation was already published, every new field is additive, every new query parameter optional. The three known contract defects and the two B6.3 launch gaps are fixed. Decisions: D-231 and D-232 (proposed in this group, accepted by the user).

| Id | Now | Added in U-B0.3 (operationIds / fields) | Published differently / left out |
|---|---|---|---|
| `admin.menu-entries` | published | `admin.me.get` `menu[]`: 14 business entries + `finance` (any-of gate) | — |
| `admin.permissions` | published differently | — (met: `admin.me.get` `permissions[]`) | Frontend adopts the `rbac.md` keys |
| `admin.analytics` | published differently | `admin.analytics.*` reads as published; per-cell abandonment via `admin.analytics.sensitivity` | — |
| `admin.analytics-journeys` | not yet | — | Built in U5.B6 (post-launch, D-219); setting `analytics.journey_drop_alert_pct` confirmed there |
| `admin.prospectus` | published differently | — (met: `admin.analytics.requestProspectus`, asynchronous export) | — |
| `admin.reports` | published differently | `admin.reports.preview` `columns[].total`, `totals`, `generatedAt`; `admin.reports.catalogue` `group` | — |
| `admin.saved-views` | published | `admin.savedViews.list` / `create` / `delete` | — |
| `admin.search` | published | `admin.search.find` (ten types, each behind its read permission) | E-mail / phone exact only (audited) |
| `admin.dashboard` | published | `admin.dashboard.get` (21 queues with SLA state) | — |
| `admin.staff-directory` | published | `admin.staffDirectory.list` | No contact details |
| `admin.sod-rules` | published | `admin.sodRules.list` | — |
| `admin.imports` | published differently | — (met: `admin.catalogImports.preview` / `confirm`; + kind `national_holidays`) | — |
| `admin.exports` | published differently | `admin.exports.create` (orders, customers, companies, shipments, claims) | Contact details left out |
| `admin.slip-file` | published differently | `SlipDto.fileId` (download through `admin.files.download`) | No slip-specific route |
| `admin.document-resend` | published | `admin.customerDocuments.resend`, `deliveries` | — |
| `admin.dunning-log` | published | `admin.customerDocuments.dunningLog` | — |
| `admin.credit-note-reasons` | published | `admin.customerDocuments.listCreditNoteReasons` (+ `direction`) | — |
| `admin.document-payment-filter` | published | `admin.customerDocuments.list?paymentId` | — |
| `admin.payout-documents` | published | `admin.payouts.itemDocuments` | — |
| `admin.bank-line-suggestions` | published | `admin.banking.suggestMatches` | — |
| `admin.bank-line-split` | published | `admin.banking.splitLine` | — |
| `admin.gateway-settlements` | published | `admin.banking.listSettlements` | — |
| `admin.depreciation-preview` | published | `admin.fixedAssets.previewRun` | — |
| `admin.account-roll-forward` | published | `admin.financialReports.accountRollForward` | — |
| `admin.subledger-reconciliation` | published | `admin.financialReports.subledgerReconciliation` | — |
| `partner.factory-name` | published | `partner.me.get` factories `code`, `name`, `roles` as `FactoryRole` | — |
| `partner.references` | published differently | `partner.factories.priceReferences` (`/references`) | Names only, never a price (D-044) |
| `partner.change-requests` | published | `partner.changeRequests.list` / `create`; staff `admin.factoryChangeRequests.list` / `answer` | — |
| `partner.site-visits` | published | `partner.factories.listSiteVisits` | Date and result only |
| `partner.proposal-evidence` | published | `partner.priceProposals.listEvidence` / `addEvidence`; `admin.priceProposals.listEvidence` | — |
| `partner.today` | published | `partner.production.today` | — |
| `partner.jobs` | published differently | `PartnerJobDto` product type, title, milestone, risk, reject fields, tolerance, artwork, inspection, destinations; `partner.production.lookup`; `?view` | Token-scoped path (D-044) |
| `partner.job-milestones` | published differently | — (met: `partner.production.updateMilestone`) | — |
| `partner.job-qc` | published differently | `QcCheckDto.performedBy` | No checklist invented |
| `partner.job-issues` | published | `partner.production.resolveIssue` (D-232); issue kinds, raisedBy / resolvedBy, photos | — |
| `partner.capacity-calendar` | published | `partner.factories.capacityCalendar` | Partner write of closures → U2.9 (D-209) |
| `partner.shipments` | published differently | `partner.shipments.shipPlan`, `requestCarrier`, `?view`; cartons, `blockedByPayment`, `carrierRequest`, items `toleranceOutcome` | Per-carton public tracking URL (token stored hashed) |
| `partner.permissions` | published differently | — (met: `partner.me.get` `permissions[]`) | Frontend adopts the `rbac.md` keys |
| `partner.billing-statements` | published differently | line `kind` / `reference` / `quantity`, `totals`, `generatedAt`, `confirmedBy`, `taxInvoiceStatus` / `inputVatStatus` / `taxInvoices`, `disputedLineNos` (+ dispute `lineNos`), named status filter | Token-scoped path; no `eTaxReference` (the e-Tax file is `fileId`) |
| `partner.payouts` | published | `partner.payables.payoutSchedule`, `getPayout`, `payoutDocuments`, `statementOfAccount`; list `status`, `payOn`, `claimDeductionAmount` | List stays `from` / `to` (no paging) |
| `partner.claims` | published differently | `factoryRespondedAt`, `factoryEvidenceFileIds` (+ respond `evidenceFileIds`), `shipmentNo`, `deductionAmount`, `deductions` | No factory `responseDueAt` (no setting decided) |
| `partner.scorecard` | published | `partner.production.scorecards?months` | — |
| `partner.users` | published differently | `status`, `lastSignInAt`, `isSelf`, roles as `FactoryRole`; `?status`; `partner.factoryUsers.setRoles` (also reactivates) | No `invited` status (users are created active) |
| `partner.notification-preferences` | published | `partner.me.notificationPreferences` / `setNotificationPreferences` (D-231) | — |
| `status.enums` | published differently | — (met: every status is a named enum) | Frontend adopts the backend names |
| `entity.next-actions` | published | Shared `NextActionDto` `{ key, irreversible, disabledReason }` — `nextActions` on orders (store / admin), production jobs (partner / admin), RFQs (store / admin), shipments (partner / admin), claims (store / partner / admin), billing statements (partner / admin), payout runs (admin), customer documents (admin; empty for customers), built from each endpoint's own state check and the reader's permissions | Paying an instalment stays `StoreInstalmentDto.payable`; no order-group actions (the paid amount is not on the group view) |
| `rum.web-vitals` | published | `{store,admin,partner}.rum.recordWebVital`; `admin.ops.webVitals` | — |
| `notifications.unread-and-link` | published | `meta.unreadCount`, item `url`, `{surface}.notifications.markAllRead` | — |
| `analytics.events` | published differently | — (met: `store.analytics.ingest`) | — |
| `contract.rate-card-line-response` | published | enum `CardLineAnswer` | — |
| `admin.price-simulation-result` | published | `PriceSimulationResultDto` | — |

**B6.3 launch gaps (closed):** national holidays and factory closures (`admin.calendar.*`, import kind `national_holidays`; D-161, D-170, D-209); approval-policy versions (`admin.approvalPolicies.*`, maker-checker, D-063).

## U-B0.3 — `admin.*` platform, finance & analytics

| Id | Frontend operations | Verdict | Backend operationId(s) | Work here | Notes |
|---|---|---|---|---|---|
| `admin.menu-entries` | `GET /v1/admin/me` → `menu[]` | published differently | `admin.me.get` | U-B0.3: 2 additive gap(s) | GET /v1/admin/me already returns menu[{key,path}] from iam/menu.catalog.ts, but the catalogue only has platform entries (dashboard, approvals, users, settings, feature_flags, notification_templates, notification_routes, audit_logs, outbox, analytics, reports, ops); the business-module entries and `finance` are additive work. |
| `admin.permissions` | `permission keys in `/v1/admin/me` → `permissions[]` | published differently | `admin.me.get` | — (frontend migrates) | Permissions are published in GET /v1/admin/me permissions[] and the catalogue already defines the business modules' keys, but many names differ from the frontend's proposal; backend names win and the frontend must re-map its mock. |
| `admin.analytics` | `GET /v1/admin/analytics/campaigns`<br>`GET /v1/admin/analytics/demand`<br>`GET /v1/admin/analytics/factories`<br>`GET /v1/admin/analytics/overview`<br>`GET /v1/admin/analytics/unmet-demand` | published differently | `admin.analytics.campaigns`, `admin.analytics.demand`, `admin.analytics.factories`, `admin.analytics.sales`, `admin.analytics.unmetDemand` | U-B0.3: 1 additive gap(s) | B6.1 analytics is published but shaped differently: explicit from/to dates (no range preset), bare arrays instead of {period, rows} envelopes, different metric sets; the overview KPI endpoint does not exist and is composed from sales + funnel + traffic. |
| `admin.analytics-journeys` | `GET /v1/admin/analytics/journeys` | implement here (U-B0.3) | — | U-B0.3: implement in `analytics` — **built in U5.B6** (post-launch, D-219) | **New 2026-09-30** (packio-web U5.0). One UX journey's funnel with week-over-week drop alerts. B6.1 publishes only the D-102 visit → paid funnel and five event names. U5.B6 owns journey dashboards and drop alerts (RUN-ORDER §1–2); the threshold becomes a setting (scorecard proposes 15 %). |
| `admin.prospectus` | `POST /v1/admin/analytics/prospectus` | published differently | `admin.analytics.requestProspectus` | — (frontend migrates) | Published as an asynchronous export resource: POST /v1/admin/analytics/prospectus-exports (202, Idempotency-Key) → poll → GET …/{exportId}/file?format=pdf\|xlsx. k is the setting analytics.prospectus_min_group_size = 3 (D-160 supersedes B6.1's k≥5, as in D-044) and is returned as kThreshold. |
| `admin.reports` | `GET /v1/admin/reports`<br>`GET /v1/admin/reports/{reportKey}` | published differently | `admin.reports.catalogue`, `admin.reports.preview` | U-B0.3: 4 additive gap(s) | The report catalogue and a report preview are published (B6.2) but with different keys, filter model and column types; the preview has no pagination, no totals row and caps at 200 rows (export for all rows). |
| `admin.saved-views` | `GET /v1/admin/saved-views`<br>`POST /v1/admin/saved-views`<br>`DELETE /v1/admin/saved-views/{viewId}` | implement here (U-B0.3) | — | U-B0.3: implement in `iam` | No saved-views resource exists in packio-api; new per-user staff resource. |
| `admin.search` | `GET /v1/admin/search` | implement here (U-B0.3) | — | U-B0.3: implement in `iam` | No admin global search exists (only store.catalog.search); new scoped, server-side search. |
| `admin.dashboard` | `GET /v1/admin/dashboard` | implement here (U-B0.3) | — | U-B0.3: implement in `ops` | No dashboard/work-queue count endpoint exists; individual queues exist (admin.orderOperations.queue, admin.payments.slipQueue, admin.artwork.queue, admin.payouts.exceptions, …) but no aggregated counts with SLA state. |
| `admin.staff-directory` | `GET /v1/admin/staff-directory` | implement here (U-B0.3) | — | U-B0.3: implement in `iam` | No least-privilege staff picker exists: GET /v1/admin/users (admin.users.list) needs users.read and returns e-mail/phone. New directory endpoint for every staff member. |
| `admin.sod-rules` | `GET /v1/admin/sod-rules` | implement here (U-B0.3) | — | U-B0.3: implement in `iam` | The sod_rules table is seeded and enforced (409 iam.sod_conflict) and a sod_rules.manage permission exists, but no read endpoint is published. |
| `admin.imports` | `POST /v1/admin/imports`<br>`GET /v1/admin/imports/{importId}`<br>`POST /v1/admin/imports/{importId}/actions/apply` | published differently | `admin.catalogImports.preview`, `admin.catalogImports.confirm` | — (frontend migrates) | Excel import is published per resource (catalogue kinds; customer shipping rate cards) as a synchronous preview → confirm pair guarded by previewSha256, not as a generic job resource; backend wins. |
| `admin.exports` | `POST /v1/admin/exports` | published differently | `admin.reports.export` | U-B0.3: 1 additive gap(s) | No generic export endpoint; exports are published per resource (reports async, catalogue, audit log, coupons, rate cards). Report exports are asynchronous runs; lists without an export (orders, customers, …) are additive work. |
| `admin.slip-file` | `GET /v1/admin/slips/{slipId}/file` | implement here (U-B0.3) | — | U-B0.3: implement in `payments` | No way to see the slip image: SlipQueueItemDto / SlipDto (also inside admin.payments.get) carry no fileId, so admin.files.download cannot be reached. |
| `admin.document-resend` | `POST /v1/admin/customer-documents/{documentId}/actions/resend`<br>`GET /v1/admin/customer-documents/{documentId}/deliveries` | implement here (U-B0.3) | — | U-B0.3: implement in `receivables` | Customer documents can be listed, downloaded and voided, but nothing resends one or lists where it was delivered. |
| `admin.dunning-log` | `GET /v1/admin/dunning-log` | implement here (U-B0.3) | — | U-B0.3: implement in `receivables` | The receivables.dunning job writes dunning_notices (stage before_due\|on_due\|overdue, domainEventId, sentAt) but no endpoint lists them. |
| `admin.credit-note-reasons` | `GET /v1/admin/credit-note-reasons` | implement here (U-B0.3) | — | U-B0.3: implement in `receivables` | The credit_note_reasons table is seeded (10 rows) but not published, although IssueDebitNoteDto.reasonCode is required and credit-note requests take reasonCode. |
| `admin.document-payment-filter` | `GET /v1/admin/customer-documents?paymentId=` | published differently | `admin.customerDocuments.list` | U-B0.3: 1 additive gap(s) | admin.customerDocuments.list exists and each row carries paymentId, but the list has no paymentId filter. |
| `admin.payout-documents` | `GET /v1/admin/payout-runs/{runId}/items/{itemId}/documents` | implement here (U-B0.3) | — | U-B0.3: implement in `payouts` | Payout items expose pvNumber and WHT amounts, and partners can download their 50 ทวิ (partner.payables.whtCertificatePdf), but the back office has no download for either document, and no remittance-advice document exists at all. |
| `admin.bank-line-suggestions` | `GET /v1/admin/bank-statement-lines/{lineId}/suggestions` | implement here (U-B0.3) | — | U-B0.3: implement in `banking` | The auto-matcher (banking.auto_match: amount tolerance, reference, date window) runs on import but its candidates are not published. |
| `admin.bank-line-split` | `POST /v1/admin/bank-statement-lines/{lineId}/actions/split` | implement here (U-B0.3) | — | U-B0.3: implement in `banking` | Manual match takes a single target and requires the target amount to equal the whole line; the bank_matches table already allows several matches per line (with amount), but no split action exists. |
| `admin.gateway-settlements` | `GET /v1/admin/gateway-settlements` | implement here (U-B0.3) | — | U-B0.3: implement in `banking` | Gateway settlements can be imported (admin.banking.importSettlement) but not listed. |
| `admin.depreciation-preview` | `GET /v1/admin/depreciation-runs/preview` | implement here (U-B0.3) | — | U-B0.3: implement in `fixed-assets` | POST /v1/admin/depreciation-runs posts FA02 immediately; there is no dry run. |
| `admin.account-roll-forward` | `GET /v1/admin/financial-reports/roll-forward` | implement here (U-B0.3) | — | U-B0.3: implement in `financial-reports` | Only the fixed-asset roll-forward (admin.fixedAssets.rollForward) and GL detail per account exist; there is no month-by-month roll-forward of a control account such as 2330 or 2130. |
| `admin.subledger-reconciliation` | `GET /v1/admin/financial-reports/subledger-reconciliation` | implement here (U-B0.3) | — | U-B0.3: implement in `financial-reports` | CloseService.subledgers computes the §7 step 8 rows but they are only exposed as the subledgers_reconciled task's checkResult inside admin.close.get (close.read, only after a check). |

## U-B0.3 — `partner.*` and cross-cutting

| Id | Frontend operations | Verdict | Backend operationId(s) | Work here | Notes |
|---|---|---|---|---|---|
| `partner.factory-name` | `GET /v1/partner/me` | published differently | `partner.me.get` | U-B0.3: 2 additive gap(s) | GET /v1/partner/me exists but FactoryAccessDto has only factoryId + roles; the name is available from partner.factories.list (FactoryDto.legalName/tradeName/code). Additive: add name/code to FactoryAccessDto. |
| `partner.references` | `GET /v1/partner/factories/{factoryId}/references` | implement here (U-B0.3) | — | U-B0.3: implement in `partners` | No partner catalogue/reference read exists (partner.priceLists.listLines returns raw ids in `values`; partner.priceLists.listComponents gives column metadata only). Implement a factory-scoped reference-name lookup. |
| `partner.change-requests` | `GET /v1/partner/factories/{factoryId}/change-requests`<br>`POST /v1/partner/factories/{factoryId}/change-requests` | implement here (U-B0.3) | — | U-B0.3: implement in `partners` | No factory change-request resource exists anywhere (no table, no route). Implement in partners with a Partner-team answer flow; nothing is changed until staff act. |
| `partner.site-visits` | `GET /v1/partner/factories/{factoryId}/site-visits` | implement here (U-B0.3) | — | U-B0.3: implement in `partners` | Site visits exist only on the admin surface (admin.factories.listSiteVisits → SiteVisitDto with inspectorIds, checklist, photos). Implement a reduced partner read. |
| `partner.proposal-evidence` | `GET /v1/partner/factories/{factoryId}/price-proposals/{proposalId}/evidence`<br>`POST /v1/partner/factories/{factoryId}/price-proposals/{proposalId}/evidence` | implement here (U-B0.3) | — | U-B0.3: implement in `partners` | Price proposals carry only `comment`; attachment subject `price_proposal` exists in the schema enum but no endpoint writes or reads it. Implement. |
| `partner.today` | `GET /v1/partner/factories/{factoryId}/today` | implement here (U-B0.3) | — | U-B0.3: implement in `production` | No shop-floor summary exists; partner.production.list with queue=awaiting_acceptance\|at_risk can approximate parts. Implement an aggregate read. |
| `partner.jobs` | `GET /v1/partner/factories/{factoryId}/jobs`<br>`GET /v1/partner/factories/{factoryId}/jobs/{jobId}`<br>`POST /v1/partner/factories/{factoryId}/jobs/{jobId}/actions/accept`<br>`POST /v1/partner/factories/{factoryId}/jobs/{jobId}/actions/reject`<br>`GET /v1/partner/factories/{factoryId}/jobs/lookup` | mixed: 4 published differently · 1 implement here | `partner.production.list`, `partner.production.get`, `partner.production.accept`, `partner.production.reject` | U-B0.3: implement in `production`; 5 additive gap(s) | Published under /v1/partner/production-jobs (token-scoped, no factoryId in path) with a different DTO; list/get/accept/reject map with renames and several missing display fields; code lookup is new. |
| `partner.job-milestones` | `POST /v1/partner/factories/{factoryId}/jobs/{jobId}/milestones/{seq}/actions/complete`<br>`POST /v1/partner/factories/{factoryId}/jobs/{jobId}/milestones/{seq}/actions/start` | published differently | `partner.production.updateMilestone` | — (frontend migrates) | Published as one endpoint partner.production.updateMilestone with `action: start\|complete`, keyed by milestone id (not seq), returning {applied, job, reason}; conflict is `applied:false`, not 409. |
| `partner.job-qc` | `POST /v1/partner/factories/{factoryId}/jobs/{jobId}/qc-checks` | published differently | `partner.production.recordQc` | U-B0.3: 2 additive gap(s) | Published as partner.production.recordQc under /production-jobs; body and response differ (checklist object + checklistVersion, coded defects with severity, returns QcCheckDto). |
| `partner.job-issues` | `POST /v1/partner/factories/{factoryId}/jobs/{jobId}/issues`<br>`POST /v1/partner/factories/{factoryId}/jobs/{jobId}/issues/{issueId}/actions/resolve` | mixed: 1 published differently · 1 implement here | `partner.production.raiseIssue` | U-B0.3: implement in `production`; 3 additive gap(s) | Raise is published (partner.production.raiseIssue) with a free-text kind and JobIssueDto response; resolving from the factory side does not exist (resolve is staff-only: admin.production.resolveIssue). |
| `partner.capacity-calendar` | `GET /v1/partner/factories/{factoryId}/capacity-calendar` | implement here (U-B0.3) | — | U-B0.3: implement in `partners` | Only partner.factories.getCapacity (one productTypeId per call, no closures) exists. Implement a multi-type calendar with national + factory closures. Who edits factory hours and closures: D-209. |
| `partner.shipments` | `GET /v1/partner/factories/{factoryId}/ship-plan`<br>`GET /v1/partner/factories/{factoryId}/shipments`<br>`POST /v1/partner/factories/{factoryId}/shipments`<br>`GET /v1/partner/factories/{factoryId}/shipments/{shipmentId}`<br>`POST /v1/partner/factories/{factoryId}/shipments/{shipmentId}/actions/dispatch`<br>`POST /v1/partner/factories/{factoryId}/shipments/{shipmentId}/actions/request-carrier`<br>`POST /v1/partner/factories/{factoryId}/shipments/{shipmentId}/pod` | mixed: 2 implement here · 5 published differently | `partner.shipments.list`, `partner.shipments.create`, `partner.shipments.get`, `partner.shipments.dispatch`, `partner.shipments.recordPod` | U-B0.3: implement in `logistics`; 6 additive gap(s) | Published under /v1/partner/shipments (token-scoped) with a draft → ready (labels) → dispatch → POD flow and a multi-item body; ship-plan and the partner "request carrier" action do not exist. |
| `partner.permissions` | `factory-scope permission keys` | published differently | — | — (frontend migrates) | rbac.md already has factory-scope production, QC, shipping, claims and payables keys (added in B4/B5), with different names from the FE proposal; backend keys win. |
| `partner.billing-statements` | `GET /v1/partner/factories/{factoryId}/billing-statements`<br>`GET /v1/partner/factories/{factoryId}/billing-statements/{statementId}`<br>`POST /v1/partner/factories/{factoryId}/billing-statements/{statementId}/actions/confirm`<br>`POST /v1/partner/factories/{factoryId}/billing-statements/{statementId}/actions/dispute`<br>`POST /v1/partner/factories/{factoryId}/billing-statements/{statementId}/tax-invoices` | published differently | `partner.payables.listStatements`, `partner.payables.getStatement`, `partner.payables.confirmStatement`, `partner.payables.disputeStatement`, `partner.payables.submitTaxInvoice` | U-B0.3: 10 additive gap(s) | Published under /v1/partner/billing-statements (factoryId as optional query) with a flatter BillingStatementDto; totals breakdown, tax-invoice list and nextActions are missing; tax-invoice capture needs amounts and returns VendorInvoiceDto. |
| `partner.payouts` | `GET /v1/partner/factories/{factoryId}/payout-schedule`<br>`GET /v1/partner/factories/{factoryId}/payouts`<br>`GET /v1/partner/factories/{factoryId}/payouts/{payoutId}`<br>`GET /v1/partner/factories/{factoryId}/statement-of-account` | mixed: 3 implement here · 1 published differently | `partner.payables.payoutStatement` | U-B0.3: implement in `payables`, `payouts`; 3 additive gap(s) | Only the payout statement list (partner.payables.payoutStatement, same path, different query/shape) and the 50 ทวิ PDF exist; payout schedule, payout detail and statement of account must be implemented. |
| `partner.claims` | `GET /v1/partner/factories/{factoryId}/claims`<br>`GET /v1/partner/factories/{factoryId}/claims/{claimId}`<br>`POST /v1/partner/factories/{factoryId}/claims/{claimId}/actions/respond` | published differently | `partner.claims.list`, `partner.claims.get`, `partner.claims.respond` | U-B0.3: 8 additive gap(s) | Published under /v1/partner/claims (token-scoped) with PartnerClaimDto; job is flat, evidence is photo ids, factory evidence on respond and the deduction figures are missing. |
| `partner.scorecard` | `GET /v1/partner/factories/{factoryId}/scorecards` | published differently | `partner.production.scorecards` | U-B0.3: 1 additive gap(s) | Published at the same path (partner.production.scorecards → ScorecardDto[]); no `months` query and month is the first day of the month. |
| `partner.users` | `GET /v1/partner/factories/{factoryId}/users`<br>`POST /v1/partner/factories/{factoryId}/users`<br>`PATCH /v1/partner/factories/{factoryId}/users/{userId}` | published differently | `partner.factoryUsers.list`, `partner.factoryUsers.create`, `partner.factoryUsers.deactivate` | U-B0.3: 4 additive gap(s) | List and create are published at the same paths with a leaner FactoryUserDto and an initial-password (not invite) flow; owners are Packio-managed (D-171); role change is missing, deactivate is an action. |
| `partner.notification-preferences` | `GET /v1/partner/me/notification-preferences`<br>`PUT /v1/partner/me/notification-preferences` | implement here (U-B0.3) | — | U-B0.3: implement in `platform/notifications (src/platform/notifications — not under src/modules)` | Preferences exist only on the store surface (store.me.notificationPreferences, category = transactional\|marketing\|security). Implement the partner equivalent. |
| `status.enums` | `components on /v1/{store,admin,partner}/* responses` | published differently | — | U-B0.3: 1 additive gap(s) | Resolved differently: every status vocabulary is already a named enum component (≈80 *Status enums, no inline status enums in the contract). Three FE names map to other backend names; five FE-only vocabularies wait on their endpoints. |
| `entity.next-actions` | `responses for orders, jobs, RFQs, claims, payouts, documents` | implement here (U-B0.3) | — | U-B0.3: implement in `orders, production, logistics, rfq, claims, payables, payouts, receivables (shared DTO in src/common)` | No entity response carries a nextActions list today. Implement a shared NextActionDto and add it to the entity responses the FE names. |
| `rum.web-vitals` | `POST /v1/{store,admin,partner}/rum/web-vitals` | implement here (U-B0.3) | — | U-B0.3: implement in `ops` | No RUM ingestion endpoint exists on any surface. Implement a fire-and-forget 202 sink. |
| `notifications.unread-and-link` | `GET /v1/{surface}/notifications`<br>`POST /v1/{surface}/notifications/actions/read-all` | mixed: 1 published differently · 1 implement here | `partner.notifications.list` | U-B0.3: implement in `platform/notifications (src/platform/notifications — not under src/modules)`; 2 additive gap(s) | The feed is published on all three surfaces (cursor, InboxItemDto) but has no unread count and no destination link; bulk read-all does not exist. |
| `analytics.events` | `POST /v1/store/analytics/events` | published differently | `store.analytics.ingest` | — (frontend migrates) | Published as store.analytics.ingest at the same path, but as a batch with client event ids, consent-resolved visitor/session ids and a 5-name enum; the FE 13-name union must map onto it (backend wins). |
| `contract.rate-card-line-response` | `POST /v1/partner/factories/{factoryId}/price-proposals/{proposalId}/actions/respond` | implement here (U-B0.3) | — | U-B0.3: implement in `partners` | Confirmed defect: class RateCardLineResponse and its `response` enum share the component name, so the published schema self-references and the accept\|counter values are lost (the only self-referencing schema in the contract). Fix by renaming. |
| `admin.price-simulation-result` | `GET /v1/admin/price-proposals/{proposalId}/simulations/{simulationId}` | implement here (U-B0.3) | — | U-B0.3: implement in `partners` | Confirmed: PriceSimulationDto.result is an open object (additionalProperties: true) although quote-repricer.port.ts returns a fixed RepriceResult. Publish it as a named schema. |

## Known contract defects

These are not new endpoints. In each one the published document says something other than what the code does. Every fix changes only component names or schemas: the wire JSON stays the same, so no deprecation is needed. The frontend regenerates its types and drops its `CONTRACT-DEFECT` narrowing. Each fix also adds a guard so the defect cannot come back.

| Defect | Evidence | Effect on the contract | Fix | Group |
|---|---|---|---|---|
| `contract.rate-card-line-response`: the enum and the DTO share one name | `src/modules/partners/pricing/pricing.dto.ts:315` (class `RateCardLineResponse`) and `:319` (`@EnumField([...], 'RateCardLineResponse')`) | The component references itself (the only such schema in the contract), and the `accept \| counter` values are lost in `partner.priceProposals.respondToRateCard` | Give the enum its own component name (for example `RateCardLineAnswer`) and keep the DTO. Add a contract check that fails on any self-referencing schema | U-B0.3 (`partners`) |
| Duplicate `AssemblyDto` | `src/modules/pricing/quotes/quote.dto.ts:83` (quote input `{ assemblyId, amount?, w?, l? }`, used by `FoldingPartDto.assemblies`, `:155`) and `src/modules/catalog/materials/materials.dto.ts:574` (catalogue row; `v0.3.0` added `autoAdd` to it). Still present at `v0.3.0`; the corrugate part avoided it with its own `CorrugateAssemblyDto` | Only one of them becomes the `AssemblyDto` component. `FoldingPartDto.assemblies` is published with the **catalogue row shape**, not the shape the controller validates, so a client built from the contract sends the wrong body to `store.quotes.calculate` / `admin.csFolding.calculate` | Rename the quote input class (for example `QuoteAssemblyInputDto`). Add a build-time check in `contract:build` that fails when two DTO classes map to one component name | U-B0.1 (`pricing`) |
| `PriceSimulationDto.result` has no named schema | `src/modules/partners/pricing/pricing.dto.ts:680` is `additionalProperties: true`, but `RepriceResult` (`quote-repricer.port.ts`) has a fixed shape | `admin.priceSuggestions.getSimulation` / `admin.priceSuggestions.simulate` return an untyped object, and the impact card casts it | Replace it with `result: PriceSimulationResultDto \| null` (`quotesInWindow` integer; `priceChangePct`, `marginChangePct`, `selectionShareChangePct` decimal string or null). The endpoint stays staff-only (D-044) | U-B0.3 (`partners`) |

The same two ids appear in the U-B0.3 table as `implement here`. Re-checked 2026-09-30 at `v0.3.0`: all three defects are still present (`RateCardLineResponse` still references itself; `PriceSimulationDto.result` is still `additionalProperties: true` at `pricing.dto.ts:670-680`).

## Also in U-B0.3: launch gaps from B6.3

These are not frontend requests. U1 §U-B0 step 3 puts them in U-B0.3 so the group has a single backlog.

| Gap | Decision | Scope |
|---|---|---|
| No admin endpoint writes `business_calendar_days` | D-161 (one national calendar plus factory closures, admin-maintained), D-170 (Excel import pattern) | Admin CRUD for national holidays (loaded once a year) and factory closures, plus the Excel import (upload → preview → confirm). Audited and effective for SLA and lead-time calculations. D-209 (2026-09-30): factory hours and closures are edited by the factory's Owner / Planner and by the Partner Manager — audited, effective from the next day, no approval, never shortening an accepted job's SLA. The staff side is built here; the partner-zone write is U2.9 (post-launch) |
| No admin endpoint creates approval-policy versions | D-063 | Create a draft version → Superadmin approves it → it takes effect from its date. The running version is never edited in place |

## Proposed rejections (need the user's OK)

No request id is rejected. One requested **field** is not being added:

| Request | Field | Reason | Decision |
|---|---|---|---|
| `store.checkout` | `scheduleKey` (customer picks the payment schedule) | Rules pick the payment schedule, and overriding it needs a staff permission. A customer must not choose it | D-020 |

## Open questions (answers change group scope; none blocks this triage)

1. **`partner.job-issues` resolve:** only staff resolve issues today (`admin.production.resolveIssue`). May a factory close its own issue, or is the partner "resolve" operation dropped?
2. **`admin.shipments` POD accept/reject:** no decision covers staff review of proof of delivery. The row is `implement` and flagged uncertain.
3. **`store.tracking` location:** the public page (`store.tracking.get`) deliberately shows no location. The frontend row allows the destination province. Should the province be shown? *Answered 2026-09-30 by D-224: no location, order code, product or quantity on the public page.*
4. **`store.profile` e-mail:** `store.customerProfile.update` has no e-mail field. Should customers change their e-mail there, or does it come only from verified identities? *Answered 2026-09-30 by D-224: only from verified identities; not editable on the profile.*
5. **Business values not yet set:**
   - sample kits (`store.sample-kits`): kit prices and whether a kit is credited on the first order;
   - guided help (`store.guided-help`): the answer-to-box-style rules;
   - PDPA requests (`store.privacy`): the staff role that answers them (not in D-140).

   These stay `implement here`, but the U-B0.1 plan must record assumptions or get the values. None will be invented.
   *Answered 2026-09-30:* sample kits and guided help are not built in U-B0.1 (D-223 — U2.4 / U2.2); PDPA requests are answered by the new Data Protection Officer role within 30 days (D-222).
   *2026-09-30:* D-192–D-197 answer this for **samples of a configured product** only. Material / finish kits are still open, including whether a kit is a kind of `sample` (D-192 "one sample path"). Free kit freight needs a real promotion (D-195, D-181).
6. **To verify in U-B0.1:** the store claim view offers the resolution actions `factory_deduction` / `carrier_recovery`. They may reveal internal liability to the customer (D-083). If confirmed, this is a defect, fixed with a test. *Confirmed 2026-09-30 (`claim-views.ts:29-36` maps every resolution with its amount); fixed in U-B0.1 S1.*
7. **`admin.analytics-journeys` drop-alert threshold (2026-09-30):** the scorecard proposes a 15 % week-over-week drop. It becomes the setting `analytics.journey_drop_alert_pct`; U5.B6 confirms the value with the business before it ships. It does not block U-B0.

## Cross-cutting findings for the implementing groups

- **Idempotency:** the frontend marks these irreversible operations idempotent, but none declares `Idempotency-Key`: company approval decision, artwork submit, design create, company apply, order cancel, manual start, RFQ decline/send/consultation, proof create, inspection record, credit-limit request, design deliver. For each, the group adds the header (money-moving or irreversible operations need it, CLAUDE.md) or records why it is not needed.
- **Concurrency:** cart mutations need `If-Match`, which the frontend does not send. Claim actions take `Idempotency-Key` where the frontend sends `If-Match`. Campaign, promotion and company actions declare no concurrency header, and shipment and claim detail return no `ETag`. `store.cart.removeItem` documents a 412 but takes no `If-Match`.
- **`nextActions`:** no entity (orders, prepress, RFQ, shipments, claims, jobs) publishes `nextActions`. It is delivered once, in U-B0.3 (`entity.next-actions`), and applied to each entity DTO.
- **Enum names:** every status is already a named component. The frontend must adopt the backend names (`ProductionJobStatus`, not `JobStatus`, which means background jobs; `PayoutRunStatus`; `CustomerDocumentStatus`) and the backend action names (campaign `resume` → `activate`, company `reinstate` → `reactivate`, `return-kyc` → `reject-kyc`, and so on; see *Details*).
- **Carrier enum inconsistency (backend):** the timeline's shipment reference uses carrier `packio`, while `ShipmentDto` uses `factory_fleet`. U-B0.2 aligns them to `factory_fleet` without breaking clients (both values accepted, then `packio` deprecated).
- **Admin CS calculators:** folding, (since `v0.3.0`) corrugate, (since `v0.7.0`) label, (since `v0.8.0`) tag & sleeve and (since `v0.9.0`) pouch and (since `v0.10.0`) standard product are published (`admin.csFolding.*`, `admin.csCorrugate.*`, `admin.csLabel.*`, `admin.csTagSleeve.*`, `admin.csPouch.*`, `admin.csStandardProduct.*`, factory side `partner.pricingLabel.calculate`, `partner.pricingTagSleeve.calculate`, `partner.pricingPouch.calculate`, `partner.pricingStandardProduct.calculate`). The service calculator arrives with U-B6, one per session. U-B0.2 only adds the D-052 direct-discount limit (`discounts.cs_limit_pct`) and the quantity presets to the input data of each published calculator. It never adds illustrative figures.
- **`unit` means two different things (2026-09-30):** the `unit` gaps in this triage (`store.quotes`, `store.configurator`, orders) are the **sales unit** of a response (piece, sheet, roll — `ProductUnit`, already stored on quote options). D-183 (U2.1) refuses a **measurement** unit in any request, because dimensions are mm only. U2.1 must name the refused request field precisely, so the refusal never catches the sales-unit response field.
- **Pre-launch fixes outside U-B0 (D-219):** some requests are completed by U2.1 (share-link expiry, D-185) or U2.F (store credit at checkout D-196, tooling waiver D-205, mockup → `sample` D-192/D-193), not by a U-B0 group. Their rows carry a note, and U-B0 builds nothing that those sessions replace.

## Cross-check with `awaiting-migration.ts`

packio-web lists **86** operations as "published, not yet migrated" (unchanged at `f225d30`). Every one is in this triage: **1** is `published` (`DELETE /v1/store/designs/{designId}` → `store.designs.delete`) and **85** are `published differently`, each with its mapping in *Details*. None is `implement here`. The published shape nearly always differs somewhere (path, field name, envelope, nullability or headers), so migrating each screen means applying its mapping, not just swapping the client.

## Not re-triaged

The *Resolved* section of `contract-requests.md` is already closed on the frontend side, so it is not re-triaged here: `auth.*` and `{store,admin,partner}.me` (B1.3), `notifications.feed` / `push.subscriptions` / `realtime.auth` (B1.3), and `admin.price-suggestions` / `admin.index-series` / `admin.coverage` (B2.2). The fourth line of that section, the "86 requests", is the list checked above.

## Details — mappings, gaps and scope

Per id, per frontend operation. `→` reads "frontend asks for → backend publishes".

### U-B0.1 — `auth.*` / `store.*`: catalogue, quotes, RFQ, cart, checkout, payments, orders

#### `otp.code-length` — implement here (U-B0.1)

Decisions: D-143

- **POST /v1/auth/customer/otp/request (OtpChallengeDto.codeLength)** — implement here → `auth.customer.requestOtp` (`POST /v1/auth/customer/otp/request`)
  - **scope (U-B0.1, `auth`):** Add `codeLength: integer` to OtpChallengeDto, read from the `auth.otp_policy` setting (otp.service.ts already generates `policy.codeLength` digits). Public, no new permission.
  - *note:* The operation exists; only the field is missing. verifyOtp accepts ^\d{4,8}$, so the UI must not assume 6.

#### `otp.attempts-remaining` — published differently

Decisions: D-143

- **POST /v1/auth/customer/otp/verify** — published differently → `auth.customer.verifyOtp` (`POST /v1/auth/customer/otp/verify`)
  - attemptsRemaining (on OtpChallengeDto or failed verify) → 422 `auth.otp_invalid` ProblemDetails.detail text "…เหลือโอกาสอีก {remaining} ครั้ง" (localised string only, no structured field)
  - locked challenge → 422 `auth.otp_expired` (spent/expired/locked are one code)
  - **gap (U-B0.1):** structured `attemptsRemaining: integer` on the auth.otp_invalid problem (e.g. a ProblemDetails extension member) and/or `maxAttempts` on OtpChallengeDto (from `auth.otp_policy.maxAttempts`)
  - *note:* Evidence: src/modules/auth/login/otp.service.ts throws DomainException('auth.otp_invalid', {params:{remaining}}); ProblemDetails schema has no params member.

#### `store.sitemap` — implement here (U-B0.1)

Decisions: D-005

- **GET /v1/store/sitemap** — implement here
  - **scope (U-B0.1, `catalog`):** Public GET returning {data:[{path,lastModified,changeFrequency?,priority?}]} from active product types, catalogue products, stock products, showcase products, published articles/FAQs, excluding pages whose SEO meta has noindex (store.catalog.getSeo). Locale-agnostic paths; ETag/Cache-Control like the other catalogue reads. D-005 (no legacy URLs).
  - *note:* Related existing ops: store.catalog.getSeo (per page meta), store.catalog.merchantFeed (Google feed). The path-to-route mapping must match packio-web routes — agree it in the contract.

#### `store.price-hints` — implement here (U-B0.1)

Decisions: D-043, D-050, D-101, D-181

- **GET /v1/store/catalog/price-hints** — implement here
  - **scope (U-B0.1, `pricing`):** Public GET ?productType=&slugs=&skus= → PriceHintDto[]: starting price per piece from the active factory price paths (tier A/B, D-043) with the quantity/size basis, VAT/delivery flags, lead-time range respecting weekly capacity (D-101); null when no factory prices it (RFQ). No factory data (D-050). Precompute/cache (stock products already have StockProductPriceSummary in catalog, used by merchantFeed); ~60 s cache.
  - *note:* D-181 explicitly mandates 'starting price per piece, the quantity that price assumes, MOQ and lead time' on made-to-order cards, so this is required, not optional. Formulas must come from the ported calculators (golden tests), never a new formula.

#### `store.product-faqs` — implement here (U-B0.1)

Decisions: D-005

- **GET /v1/store/catalog/products/{slug}/faqs** — implement here
  - **scope (U-B0.1, `catalog`):** Add a catalogue product ↔ FAQ link (join table, admin CMS edit in catalog/cms with audit) and a public GET /v1/store/catalog/products/{slug}/faqs → [{questionTh,questionEn|null,answerTh,answerEn|null}] of published FAQs in admin sort order; 404 for unknown slug.
  - *note:* Nearest existing op store.catalog.listFaqs returns FAQs grouped by FAQ category only (same four text fields, so the item shape already matches). prisma Faq has only categoryId.

#### `store.product-categories` — implement here (U-B0.1)

- **GET /v1/store/catalog/product-categories** — implement here
  - **scope (U-B0.1, `catalog`):** Public GET → [{code,nameTh,nameEn,parentCode|null,sort}] from product_categories (status active, with ≥1 active product type); cacheable like listProductTypes.
  - *note:* prisma ProductCategory already has code/nameTh/nameEn/parentId/sort/status; store.catalog.listProductTypes exposes only categoryCode. store.catalog.listShowcase has a `category` filter but that is the showcase category slug, not product_categories.

#### `store.catalog-category-filter` — implement here (U-B0.1)

- **GET /v1/store/catalog/products?category=` and `…/stock-products?category=** — implement here → `store.catalog.listProducts` (`GET /v1/store/catalog/products`)
  - **scope (U-B0.1, `catalog`):** Add optional `category` (product_categories.code, include children?) to store.catalog.listProducts and store.catalog.listStockProducts, joining through product_types.categoryId; one paginated list.
  - *note:* Also applies to store.catalog.listStockProducts. uncertain: whether a parent category should include its children — decide in the contract.

#### `store.search-faq-hits` — implement here (U-B0.1)

- **GET /v1/store/catalog/search` (StoreSearchHitKind += faq)** — implement here → `store.catalog.search` (`GET /v1/store/catalog/search`)
  - **scope (U-B0.1, `catalog`):** Index published FAQs (question/answer TH/EN) in the same search, return kind=faq with key = FAQ public id; enum change must be announced (additive enum value).
  - *note:* Adding an enum value is a contract change the client must tolerate; confirm the web zod enum is open or update it together.

#### `store.order-by-code` — published differently

Decisions: D-050, D-060

- **GET /v1/store/orders/by-code/{orderCode}** — published differently → `store.orders.getByCode` (`GET /v1/store/orders/by-code/{orderCode}`)
  - StoreOrderLookupDto → OrderDto (full order, same as store.orders.get)
  - orderId → id (rename)
  - orderCode → orderCode (same; path pattern ^[A-Z0-9-]{3,40}$)
  - status → status (same OrderStatus enum)
  - createdAt → missing-on-backend (OrderDto has statusChangedAt; the group has placedAt)
  - *note:* Scoped by customerId in orders.service → http.not_found for another customer's code, as requested. createdAt is not needed to navigate; add it only if the search result must show it.

#### `store.profile` — published differently

Decisions: D-020

- **PATCH /v1/store/me** — published differently → `store.customerProfile.update` (`PATCH /v1/store/customer-profile`)
  - path /v1/store/me → /v1/store/customer-profile; If-Match required (ETag from store.customerProfile.get) — 412/428
  - UpdateStoreProfileDto → UpdateCustomerProfileDto: displayName (max 120), customerType (individual|juristic|government) same
  - email → missing-on-backend (not writable on the profile)
  - extra-on-backend input: firstName, lastName (nullable, max 80)
  - StoreProfileDto → CustomerProfileDto: id, displayName, email|null, phone|null same; customerType: nullable → non-null (DB default individual)
  - extra-on-backend output: customerCode|null, firstName, lastName, createdVia, createdAt
  - `customerType` on StoreMeDto → read it from GET /v1/store/customer-profile (store.customerProfile.get) instead of store.me.get
  - **gap (U-B0.1):** email write with `409 customer.email_taken` — uncertain: e-mail may be meant to come from verified identities (Google/Apple); decide before adding
  - **gap (U-B0.1):** a 'profile prompted/completed' signal: customerType defaults to individual so the UI cannot tell 'never asked' (firstName null is only a proxy)
  - *note:* D-020 (payment schedule depends on customer type) is cited by the backend op.

#### `store.configurator` — published differently

Decisions: D-043, D-050, D-051, D-072, D-100, D-192

*Re-triaged 2026-09-30:* published in `v0.3.0` (U-B6 corrugate slice 7c) at the requested path. It was `implement here` against `v0.2.0`.

- **GET /v1/store/catalog/products/{slug}/configurator** — published differently → `store.catalog.getConfigurator` (`GET /v1/store/catalog/products/{slug}/configurator`)
  - public, cacheable; 404 when the product's type has no ported calculator (RFQ only, D-100) → same as asked
  - slug, catalogProductId, productTypeCode, calculator (CalculatorKey), quoteValidityDays (`quotes.validity_days`, D-051) → same
  - size.kind → missing-on-backend: implied by `calculator` (folding and corrugate are boxes, L × W × H)
  - size.patterns[] → patterns[] (top level): id, code, name, dielineKey same; parts[] {subPatternId, name} + seq; an **empty** parts[] means one part sent without subPatternId (the request expects one entry with subPatternId null)
  - rules {minLengthMm, maxLengthMm, minWidthMm, maxWidthMm, minHeightMm, maxHeightMm} → rules {minLMm, maxLMm, minWMm, maxWMm, minHMm, maxHMm} (rename; all nullable = no limit)
  - rules.lengthMustExceedWidth → same; + lengthMustExceedHeight, widthMustExceedHeight (corrugate: H ≤ 0.95 × W)
  - rules.minGussetMm / maxGussetMm → missing-on-backend (no pouch calculator yet, U-B6)
  - rules.stepMm → missing-on-backend
  - size.standardSizes[] → standardSizes[] (top level): code, name, lengthMm, widthMm same; + id; heightMm is required (not nullable); patternId → missing-on-backend (standard sizes belong to the catalogue product, so they apply to any of its patterns); gussetMm → missing-on-backend
  - size.customAllowed → missing-on-backend: the ported calculators always accept a custom size within `rules`
  - groups[] {kind, step, nameTh/En, helpTh/En, selection, required, options[]} → optionGroups[] {kind: OfferableOptionKind, options[]}. Kinds: material → material; print → ink_colour (the configuration takes printFront/printBack[{inkColourId, percent}]); coating_front / coating_back → coating (the side is the part's coatingFrontId / coatingBackId); finish, diecut, assembly → same; shape, pouch_type, closure, window, product, service → none yet (their calculators are not ported, U-B6). step, names, help, selection and required → missing-on-backend: the storefront owns the stepper labels and layout per kind, and required / multiple follow the calculator's configuration DTO
  - options[] → StoreOptionDto: id, code, nameTh, nameEn, isDefault same; + attributes (material: kind, gsm, micron, flute, isFoodGrade, coatable; finish / coating: finishKind, requiresAmount/Width/Length; ink_colour: colourKind; assembly: requiresAmount/Width/Length)
  - options[].area {requiresAmount, requiresWidth, requiresLength, maxAmount} → attributes.requiresAmount / requiresWidth / requiresLength; maxAmount → missing-on-backend
  - options[].print {front, back} presets → missing-on-backend: no print presets in the catalogue; the storefront composes the colours from the ink_colour options
  - options[].descriptionTh/En, imageUrl, swatchHex → missing-on-backend
  - pattern imageUrl → missing-on-backend
  - quantity {presets, min, max, default, maxTiers} → missing-on-backend (calculate accepts up to 10 quantities)
  - design {options, default} → missing-on-backend (chosen on the cart item, store.cart.addItem designOption)
  - mockup {options} → missing-on-backend. D-192 turns the mockup add-on into the `sample` entity. Its order-attached part is built in U2.F (finding F4, pre-launch, D-219), so the configurator's sample offer comes from there, not from this group
  - fixedInputs (record) → difficultyLevelId (typed, top level; null = not priced online)
  - extra-on-backend: instant (the type is instant and the product has a difficulty level, D-043), printAreas (corrugate), patterns[].fluteTypeIds (corrugate)
  - **gap (U-B0.1):** unit — the product's sales unit (quote options already store `ProductUnit`), shown in the request's language
  - **gap (U-B0.1):** quantity presets, min, max and default from catalogue data or settings (never invented), plus maxTiers = 10
  - **gap (U-B0.1):** option and pattern content for the storefront: descriptionTh/En, imageUrl, swatchHex (catalogue / CMS data)
  - **gap (U-B0.1):** the design options this product offers and their default (D-071; `free_design` only through a real promotion, D-181)
  - *note:* Every value the API cannot publish from catalogue data stays missing rather than guessed (CLAUDE.md). Service: `src/modules/catalog/store/store-configurator.service.ts`.

#### `store.quote-configurations` — implement here (U-B0.1)

Decisions: D-100, D-043

- **POST /v1/store/quotes/actions/calculate** — implement here → `store.quotes.calculate` (`POST /v1/store/quotes/actions/calculate`)
  - **scope (U-B0.1, `pricing`):** (1) Per-calculator configuration DTOs, one per remaining instant calculator, ported with golden tests (D-100). **Corrugate has been done since `v0.3.0`**: `configuration` is `anyOf` FoldingConfigurationDto | CorrugateConfigurationDto on calculate, save and the saved views. Still to come, one per U-B6 session: label, tag_sleeve, pouch, standard_product, service. The backend owns the shape: corrugate set the pattern of **one typed DTO per calculator**, so the frontend's "generic selection by group kind" proposal is not adopted — backend wins. (2) Contract bug: rename the quote-part assembly class (`src/modules/pricing/quotes/quote.dto.ts:83` `AssemblyDto`). It collides with the catalogue row at `src/modules/catalog/materials/materials.dto.ts:574` `AssemblyDto`, so FoldingPartDto.assemblies is published as catalogue rows (code, nameTh, autoAdd, status, updatedAt…) instead of {assemblyId, amount?, w?, l?}. The corrugate part uses its own `CorrugateAssemblyDto` and is correct.
  - *note:* earliestDeliveryDate is published: CalculateQuote steps[].earliestDeliveryDate and SavedQuoteOptionDto.earliestDeliveryDate (date|null) — that part of the request is done. Since `v0.3.0`, steps[].toolingAmount carries plates and die blocks apart from the pieces (corrugate flexo; 0.00 for folding). `src/modules/pricing/calculators` has `folding` and `corrugate`.
  - *note:* U2.1 (pre-launch, D-219) adds `basis` (D-182) to every dimensioned configuration DTO, additively. D-183 refuses a **measurement** unit in any request; that is unrelated to the sales-unit `unit` gaps in this triage (see *Cross-cutting findings*).

#### `store.quotes` — published differently

Decisions: D-051, D-010, D-050, D-092, D-053, D-072

- **GET /v1/store/quotes** — published differently → `store.quotes.list` (`GET /v1/store/quotes`)
  - query page/perPage/sort/order/q/status → same
  - StoreQuoteSummaryDto → SavedQuoteDto (full quote per row)
  - grossAmount → options[].grossAmount (per tier)
  - quantity → options[].quantity (per tier)
  - product{…}, productType{code,name}, unit → productTypeCode only (rest missing-on-backend)
  - quoteCode string → string|null
  - currency → enum ['THB']
  - id, status, source, validUntil, createdAt → same
  - extra-on-backend: configuration, deliveryPostcode, options[], priceLocked, pdfStatus, sharedAt
  - **gap (U-B0.1):** product {slug,name,imageUrl} and productType name on SavedQuoteDto (display without a second catalogue call)
- **POST /v1/store/quotes** — published differently → `store.quotes.save` (`POST /v1/store/quotes`)
  - body {productTypeCode, configuration, deliveryPostcode?} → same names (configuration is the product type's calculator DTO — FoldingConfigurationDto or, since `v0.3.0`, CorrugateConfigurationDto — incl. catalogProductId and quantities[] ≤10)
  - catalogProductSlug → configuration.catalogProductId (uuid, rename+nesting)
  - quantity (single) → configuration.quantities[] (all tiers are saved as options[])
  - designOption, mockupOption → missing-on-backend here; set on store.cart.addItem
  - promoCode → missing-on-backend here; store.cart.applyCode + checkout preview
  - extra-on-backend: anonymousId (save without sign-in, then store.quotes.claim); security is public+optional customer, not customer-only
  - StoreQuoteDto → SavedQuoteDto (backend name)
  - quantity (single) → missing-on-backend: a saved quote keeps every requested tier as options[] (SavedQuoteOptionDto, one per quantity); the cart picks one via quoteOptionId — backend wins
  - unitPrice/netAmount/vatAmount/grossAmount/shippingAmount (top level) → options[].unitPrice/netAmount/vatAmount/grossAmount/shippingAmount (nesting; shippingAmount nullable + options[].shippingPending/shippingPendingReason)
  - lines[] {lineType, description, oneOff, waivedReason…} → missing-on-backend; the breakdown is options[].productAmount + designFeeAmount + structureDesignFeeAmount + shippingAmount (no plate/die_block/mockup lines on a quotation)
  - discountAmount, promotion{code,applied,reason,title,discountAmount,capped} → missing-on-backend: promotions are evaluated on the cart/checkout (store.cart.applyCode + store.checkout.preview discounts[] with capReason), not on a quotation — backend wins
  - leadTimeDays / earliestShipDate / estimatedDeliveryDate → options[].leadTimeDays (int|null) / options[].earliestShipDate (date|null) / options[].earliestDeliveryDate (date|null) (rename + nesting + nullable)
  - tolerance{shortagePct,overagePct} → options[].toleranceShortagePct / toleranceOveragePct (string|null, nesting)
  - productType{code,name} → productTypeCode (flattened; name missing-on-backend)
  - product{slug,name,imageUrl} → missing-on-backend (only configuration.catalogProductId)
  - specs[{label,value}] → missing-on-backend
  - unit → missing-on-backend
  - designOption / mockupOption → missing-on-backend on the quote; chosen on the cart item (store.cart.addItem designOption/mockupOption) — backend wins
  - nextActions → missing-on-backend
  - quoteCode: string → string|null (issued on share/PDF)
  - currency: string → enum Currency ['THB']
  - status (QuoteStatus), source, validUntil, createdAt, id, configuration, deliveryPostcode → same (configuration is FoldingConfigurationDto | CorrugateConfigurationDto | null since `v0.3.0`)
  - extra-on-backend: priceLocked, pdfStatus (none|pending|ready), sharedAt
  - **gap (U-B0.1):** product {slug,name,imageUrl} and productType name on SavedQuoteDto (display without a second catalogue call)
  - **gap (U-B0.1):** specs[{label,value}] human-readable spec summary (the UI must not derive it from ids)
  - **gap (U-B0.1):** unit
  - **gap (U-B0.1):** options[].toolingAmount — the calculate step publishes plates and die blocks apart from the pieces since `v0.3.0` (QuoteStepDto.toolingAmount), but the saved option drops it (`src/modules/quotes/quote-views.ts`), although the stored `result` keeps it. It is the backend source for the request's one-off `lines[]` (plate / die_block). The reorder waiver fields come with D-205 in U2.F
- **GET /v1/store/quotes/{quoteId}** — published differently → `store.quotes.get` (`GET /v1/store/quotes/{quoteId}`)
  - extra query anonymousId (owner = customer or anonymous session); others get 404
  - StoreQuoteDto → SavedQuoteDto (backend name)
  - quantity (single) → missing-on-backend: a saved quote keeps every requested tier as options[] (SavedQuoteOptionDto, one per quantity); the cart picks one via quoteOptionId — backend wins
  - unitPrice/netAmount/vatAmount/grossAmount/shippingAmount (top level) → options[].unitPrice/netAmount/vatAmount/grossAmount/shippingAmount (nesting; shippingAmount nullable + options[].shippingPending/shippingPendingReason)
  - lines[] {lineType, description, oneOff, waivedReason…} → missing-on-backend; the breakdown is options[].productAmount + designFeeAmount + structureDesignFeeAmount + shippingAmount (no plate/die_block/mockup lines on a quotation)
  - discountAmount, promotion{code,applied,reason,title,discountAmount,capped} → missing-on-backend: promotions are evaluated on the cart/checkout (store.cart.applyCode + store.checkout.preview discounts[] with capReason), not on a quotation — backend wins
  - leadTimeDays / earliestShipDate / estimatedDeliveryDate → options[].leadTimeDays (int|null) / options[].earliestShipDate (date|null) / options[].earliestDeliveryDate (date|null) (rename + nesting + nullable)
  - tolerance{shortagePct,overagePct} → options[].toleranceShortagePct / toleranceOveragePct (string|null, nesting)
  - productType{code,name} → productTypeCode (flattened; name missing-on-backend)
  - product{slug,name,imageUrl} → missing-on-backend (only configuration.catalogProductId)
  - specs[{label,value}] → missing-on-backend
  - unit → missing-on-backend
  - designOption / mockupOption → missing-on-backend on the quote; chosen on the cart item (store.cart.addItem designOption/mockupOption) — backend wins
  - nextActions → missing-on-backend
  - quoteCode: string → string|null (issued on share/PDF)
  - currency: string → enum Currency ['THB']
  - status (QuoteStatus), source, validUntil, createdAt, id, configuration, deliveryPostcode → same (configuration is FoldingConfigurationDto | CorrugateConfigurationDto | null since `v0.3.0`)
  - extra-on-backend: priceLocked, pdfStatus (none|pending|ready), sharedAt
  - **gap (U-B0.1):** product {slug,name,imageUrl} and productType name on SavedQuoteDto (display without a second catalogue call)
  - **gap (U-B0.1):** specs[{label,value}] human-readable spec summary (the UI must not derive it from ids)
  - **gap (U-B0.1):** unit
  - **gap (U-B0.1):** options[].toolingAmount — the calculate step publishes plates and die blocks apart from the pieces since `v0.3.0` (QuoteStepDto.toolingAmount), but the saved option drops it (`src/modules/quotes/quote-views.ts`), although the stored `result` keeps it. It is the backend source for the request's one-off `lines[]` (plate / die_block). The reorder waiver fields come with D-205 in U2.F
- **POST /v1/store/quotes/{quoteId}/actions/export-pdf** — published differently → `store.quotes.requestPdf` (`POST /v1/store/quotes/{quoteId}/actions/request-pdf`)
  - export-pdf (sync SignedUrlDto) → request-pdf returns 202 SavedQuoteDto (pdfStatus=pending), then poll GET /v1/store/quotes/{quoteId}/pdf (store.quotes.getPdf) → QuotePdfDto {status: none|pending|ready, url|null, expiresAt|null}
  - url/expiresAt: non-null → nullable until status=ready
  - *note:* Issued by Collective Group (Thailand) under Packio (D-010, D-092); signed-in owners only; 409 when the quote is not live.
- **POST /v1/store/quotes/{quoteId}/actions/share** — published differently → `store.quotes.share` (`POST /v1/store/quotes/{quoteId}/actions/share`)
  - QuoteShareDto.token → shareToken (rename)
  - expiresAt → missing-on-backend today (the link lives with the quote's validity; sharing again revokes the previous link). **D-185 (finding F5):** U2.1 (pre-launch, D-219) adds `expiresAt` (15 days, setting `configurations.share_link_days`) and explicit revocation, and `store.quotes.getShared` refuses an expired link (410). So this field is delivered by U2.1, not by U-B0.1
  - extra-on-backend: sharePath, quote (SavedQuoteDto)
  - extra query anonymousId
  - *note:* Token shown once, only its hash kept.
- **GET /v1/store/shared-quotes/{token}** — published differently → `store.quotes.getShared` (`GET /v1/store/quotes/shared/{token}`)
  - path /v1/store/shared-quotes/{token} → /v1/store/quotes/shared/{token} (token ^[A-Za-z0-9_-]{43}$)
  - StoreSharedQuoteDto → SavedQuoteDto (never the owner, no promotion)
  - unitPrice/grossAmount/quantity/leadTimeDays → options[].unitPrice/grossAmount/quantity/leadTimeDays
  - product{…}, productType{…}, specs, unit → productTypeCode only
  - extra-on-backend: id, status, source, options[], priceLocked, pdfStatus, deliveryPostcode, createdAt, sharedAt
  - **gap (U-B0.1):** product {slug,name,imageUrl} and productType name on SavedQuoteDto (display without a second catalogue call)
  - **gap (U-B0.1):** specs[{label,value}] human-readable spec summary (the UI must not derive it from ids)
  - **gap (U-B0.1):** unit

#### `store.promo-check` — implement here (U-B0.1)

Decisions: D-053

- **POST /v1/store/promotions/actions/check** — implement here
  - **scope (U-B0.1, `promotions`):** Public POST {code, productTypeCode, quantity?} → {code, valid, reason|null, title, benefit} using the same validation as promotion-codes.service (status, window, assignment, uses left, product-type condition) without writing; rate-limited by `promotions.code_attempt_limits` per customer/IP/device with 429 Retry-After (D-053 abuse controls). No amounts.
  - *note:* Closest existing op: store.cart.applyCode (POST /v1/store/cart/codes) — customer + If-Match, stores the code on the cart; rejectReason is free text there. Reason enum should reuse the engine's codes.

#### `store.support-channels` — implement here (U-B0.1)

Decisions: D-005

- **GET /v1/store/support-channels** — implement here
  - **scope (U-B0.1, `catalog`):** New effective-dated, audited setting (e.g. `storefront.support_channels`: lineOaId, phone, email, hours) editable by the role the decision names, and a public cacheable GET returning it (nulls when unset). Packio's own accounts (D-005).
  - *note:* uncertain: owning module — catalog (public storefront reads, cms) or conversations (LINE OA integration). No such key in src/platform/settings/setting-keys.ts today. Needs a decision on who edits it.

#### `store.rfq-forms` — implement here (U-B0.1)

Decisions: D-100, D-043

- **GET /v1/store/rfq-forms/{productTypeCode}** — implement here
  - **scope (U-B0.1, `rfq`):** Public GET → typed fields rendered from product_types.rfq_spec_schema (rfq-spec.ts already validates against it), schemaVersion, dimensions asked/required, quantity limits (backend accepts up to 10 tiers, not 6), file rules (rfq file purpose accept/maxBytes/maxFiles), SLA hours from `rfq.sla_business_hours`; 404 for instant-only/unknown types.
  - *note:* store.rfqs.submit currently stores specSchemaVersion: 1 fixed (rfqs.service.ts:149) and does not accept it in the body — align both.

#### `store.rfqs` — published differently

Decisions: D-100, D-043, D-051, D-050, D-102

- **GET /v1/store/rfqs** — published differently → `store.rfqs.list` (`GET /v1/store/rfqs`)
  - query page/perPage/sort/order/q/status → same
  - StoreRfqDto → RfqDto (backend name)
  - productType{code,name} → productTypeCode + productTypeName (flattened)
  - dimensions{lengthMm,widthMm,heightMm} → lengthMm/widthMm/heightMm top level (number|null, not integer)
  - spec[{label,value}] → spec: object map {key: value} (raw values; labels missing-on-backend)
  - quotes[] (StoreRfqQuoteDto) → quotations[] {id, versionNo, status, sentAt, validUntil (date-time|null, FE had date), note, lines[{quantity,unitPrice,netAmount,vatAmount,grossAmount,leadTimeDays,shippingNetAmount}]} (rename; customerNote → note; acceptedAt missing-on-backend)
  - latestQuote{versionNo,status,validUntil} → missing-on-backend (take the highest versionNo of quotations[])
  - acceptedQuote{id,quoteCode,quantity} → acceptedQuoteId (uuid|null of the saved quotation)
  - declineReason (text) → declineReasonCode (code|null)
  - respondBy → slaDueAt (rename)
  - notes: string|null → string
  - quantities[]: integer → number
  - targetDate: date string|null → same (format date)
  - files[] (FileRef) → missing-on-backend
  - nextActions → missing-on-backend
  - extra-on-backend: messages[] {id, author: customer|packio, body, createdAt}, closedAt
  - **gap (U-B0.1):** files[] (FileRef) on RfqDto so the status page can show what was uploaded
  - **gap (U-B0.1):** nextActions (or document that the UI keys off status)
- **POST /v1/store/rfqs** — published differently → `store.rfqs.submit` (`POST /v1/store/rfqs`)
  - Idempotency-Key → same (required)
  - specSchemaVersion → missing-on-backend (server stamps version 1)
  - dimensions{lengthMm,widthMm,heightMm} → lengthMm/widthMm/heightMm top level (number 0.01–99999, nullable)
  - quantities: 1–6 integers → 1–10 numbers (backend allows more tiers)
  - fileIds: required → optional (≤20)
  - routedFrom{catalogProductSlug,reason,configuration} → missing-on-backend
  - productTypeCode, spec (map), targetDate, deliveryPostcode, notes → same
  - StoreRfqDto → RfqDto (backend name)
  - productType{code,name} → productTypeCode + productTypeName (flattened)
  - dimensions{lengthMm,widthMm,heightMm} → lengthMm/widthMm/heightMm top level (number|null, not integer)
  - spec[{label,value}] → spec: object map {key: value} (raw values; labels missing-on-backend)
  - quotes[] (StoreRfqQuoteDto) → quotations[] {id, versionNo, status, sentAt, validUntil (date-time|null, FE had date), note, lines[{quantity,unitPrice,netAmount,vatAmount,grossAmount,leadTimeDays,shippingNetAmount}]} (rename; customerNote → note; acceptedAt missing-on-backend)
  - latestQuote{versionNo,status,validUntil} → missing-on-backend (take the highest versionNo of quotations[])
  - acceptedQuote{id,quoteCode,quantity} → acceptedQuoteId (uuid|null of the saved quotation)
  - declineReason (text) → declineReasonCode (code|null)
  - respondBy → slaDueAt (rename)
  - notes: string|null → string
  - quantities[]: integer → number
  - targetDate: date string|null → same (format date)
  - files[] (FileRef) → missing-on-backend
  - nextActions → missing-on-backend
  - extra-on-backend: messages[] {id, author: customer|packio, body, createdAt}, closedAt
  - **gap (U-B0.1):** routedFrom (catalogue product + reason + configuration) when the configurator routes to RFQ — feeds D-102 unmet-demand analytics
  - **gap (U-B0.1):** files[] (FileRef) on RfqDto so the status page can show what was uploaded
  - **gap (U-B0.1):** nextActions (or document that the UI keys off status)
- **GET /v1/store/rfqs/{rfqId}** — published differently → `store.rfqs.get` (`GET /v1/store/rfqs/{rfqId}`)
  - StoreRfqDto → RfqDto (backend name)
  - productType{code,name} → productTypeCode + productTypeName (flattened)
  - dimensions{lengthMm,widthMm,heightMm} → lengthMm/widthMm/heightMm top level (number|null, not integer)
  - spec[{label,value}] → spec: object map {key: value} (raw values; labels missing-on-backend)
  - quotes[] (StoreRfqQuoteDto) → quotations[] {id, versionNo, status, sentAt, validUntil (date-time|null, FE had date), note, lines[{quantity,unitPrice,netAmount,vatAmount,grossAmount,leadTimeDays,shippingNetAmount}]} (rename; customerNote → note; acceptedAt missing-on-backend)
  - latestQuote{versionNo,status,validUntil} → missing-on-backend (take the highest versionNo of quotations[])
  - acceptedQuote{id,quoteCode,quantity} → acceptedQuoteId (uuid|null of the saved quotation)
  - declineReason (text) → declineReasonCode (code|null)
  - respondBy → slaDueAt (rename)
  - notes: string|null → string
  - quantities[]: integer → number
  - targetDate: date string|null → same (format date)
  - files[] (FileRef) → missing-on-backend
  - nextActions → missing-on-backend
  - extra-on-backend: messages[] {id, author: customer|packio, body, createdAt}, closedAt
  - **gap (U-B0.1):** files[] (FileRef) on RfqDto so the status page can show what was uploaded
  - **gap (U-B0.1):** nextActions (or document that the UI keys off status)
- **GET /v1/store/rfqs/{rfqId}/messages** — published differently → `store.rfqs.get` (`GET /v1/store/rfqs/{rfqId}`)
  - separate list → RfqDto.messages[] embedded in store.rfqs.get (no own endpoint, no paging)
  - StoreRfqMessageDto.authorKind (customer|staff) → author (customer|packio) (enum values)
  - authorName → missing-on-backend (staff appear as the team — matches D-050 intent)
  - files[] → missing-on-backend
  - body, createdAt → same; extra id
  - **gap (U-B0.1):** message attachments (files[]) if CS questions need them
- **POST /v1/store/rfqs/{rfqId}/messages** — published differently → `store.rfqs.postMessage` (`POST /v1/store/rfqs/{rfqId}/messages`)
  - body {body, fileIds?} → RfqMessageInputDto {body} (fileIds missing-on-backend)
  - 201 StoreRfqMessageDto → 201 RfqDto (whole RFQ; need_info goes back to in_review)
  - **gap (U-B0.1):** fileIds on RFQ messages
  - *note:* No Idempotency-Key on the backend op (not requested either).
- **POST /v1/store/rfqs/{rfqId}/quotes/{quoteId}/actions/accept** — published differently → `store.rfqs.accept` (`POST /v1/store/rfqs/{rfqId}/actions/accept`)
  - path param quoteId → body rfqQuoteId (uuid)
  - body quantity (one) → quantities[] (optional, ≤10; all tiers or some)
  - Idempotency-Key → same (required)
  - 200 RfqAcceptanceDto {rfq, quote: StoreQuoteDto} → 200 RfqDto (acceptedQuoteId points at the saved quotation; fetch it with store.quotes.get)
  - *note:* Creates a saved quotation source=rfq, price-locked (D-051, D-100).

#### `store.cart` — published differently

Decisions: D-110, D-051, D-072, D-142

- **GET /v1/store/cart** — published differently → `store.cart.get` (`GET /v1/store/cart`)
  - StoreCartDto → CartDto (backend name); every mutation returns CartDto and requires If-Match with the cart ETag (412/428) — not in the frontend request
  - items[].quote{id,quoteCode,validUntil,source} → items[].quoteId, quoteOptionId, quoteCode (string|null), priceLockedUntil, source (flattened; validUntil → priceLockedUntil)
  - items[].state (ok|repriced|unavailable) → missing-on-backend; derive from priceLocked + pendingReprice (null|object)
  - items[].repricing{previousUnitPrice,previousGrossAmount,reason} → items[].pendingReprice{previousGrossAmount,newUnitPrice,newGrossAmount,differenceAmount,quoteId,quoteOptionId,validUntil} (shape differs: backend gives new price + previous gross, no previousUnitPrice, no reason)
  - items[].unavailableReason → missing-on-backend
  - items[].grossAmount → items[].productGrossAmount (rename; design fee is items[].designFeeAmount, shipping items[].quoteShippingAmount)
  - items[].product{slug,name,imageUrl} / productType{code,name} → productTypeCode only (product missing-on-backend)
  - items[].specs, items[].unit, items[].currency → missing-on-backend (currency at cart level)
  - items[].designOptions[] (allowed options) → missing-on-backend
  - items[].destinations[].addressId/address: non-null → nullable (RFQ lines carry a fixed destination)
  - itemCount → missing-on-backend (items.length)
  - subtotalAmount → productGrossAmount (cart level); vatAmount → missing-on-backend (checkout preview gives totals)
  - readyForCheckout / blockers[{itemId,code,message}] → missing-on-backend; per-item destinationsComplete + priceLocked + pendingReprice; checkout preview returns 422 checkout.destinations_incomplete etc.
  - extra-on-backend: channel, customerId, codes[] (coupon codes on the cart, status validated|rejected), items[].designDocumentId, designNote, designFeeAmount, reorderOf, reusesApprovedArtwork
  - **gap (U-B0.1):** items[].product {slug,name,imageUrl}, productType name, specs, unit for display
  - **gap (U-B0.1):** cart-level readyForCheckout + blockers (or document that store.checkout.preview is the gate)
- **POST /v1/store/cart/items** — published differently → `store.cart.addItem` (`POST /v1/store/cart/items`)
  - body {quoteId} → {quoteId, quoteOptionId (required: the chosen quantity tier), designOption (required), mockupOption?, designDocumentId?, designNote?, destinations?[{addressId,quantity}] ≤20}
  - If-Match required
  - 201 CartDto
  - *note:* The quantity tier is chosen by quoteOptionId from SavedQuoteDto.options[].
- **DELETE /v1/store/cart/items/{itemId}** — published differently → `store.cart.removeItem` (`DELETE /v1/store/cart/items/{itemId}`)
  - same path/method; 200 CartDto (response shape per GET mapping)
  - *note:* Contract lists 412 but no If-Match parameter on this op — minor backend contract inconsistency to check.
- **PATCH /v1/store/cart/items/{itemId}** — published differently → `store.cart.updateItem` (`PATCH /v1/store/cart/items/{itemId}`)
  - designOption → same
  - quantity → missing-on-backend (quantity is fixed by the quote option; remove and re-add with another quoteOptionId)
  - extra-on-backend: mockupOption, designDocumentId, designNote
  - If-Match required
- **POST /v1/store/cart/items/{itemId}/actions/accept-reprice** — published differently → `store.cart.confirmReprice` (`POST /v1/store/cart/items/{itemId}/actions/confirm-reprice`)
  - accept-reprice → confirm-reprice (rename)
  - If-Match required
  - precondition: POST /v1/store/cart/items/{itemId}/actions/reprice (store.cart.repriceItem) creates the new quotation and fills items[].pendingReprice; the API does not re-price silently on GET
  - RFQ items are not re-priced (ask for a new quotation)
- **PUT /v1/store/cart/items/{itemId}/destinations** — published differently → `store.cart.setDestinations` (`PUT /v1/store/cart/items/{itemId}/destinations`)
  - destinations[{addressId,quantity}] → same (1–20, quantity ≥1)
  - If-Match required
  - 200 CartDto
  - *note:* Request shape is identical; only the CartDto response and If-Match differ.

#### `store.address-book` — published differently

Decisions: D-110, D-125, D-142, D-174

- **GET /v1/store/me/addresses** — published differently → `store.addresses.list` (`GET /v1/store/addresses`)
  - envelope {data} → {data, meta} paged (page/perPage/sort/order/q + kind filter)
  - path /v1/store/me/addresses → /v1/store/addresses
  - CustomerAddressDto → AddressDto (backend name)
  - province: string (free text) → provinceId: uuid on input / province{id,nameTh,nameEn} on output (geo master: store.catalog.listProvinces, lookupPostcode)
  - subdistrict: string|null → subdistrictId: uuid|null on input / subdistrict{id,nameTh,nameEn}|null on output
  - district → missing-on-backend (implied by the subdistrict; store.catalog.listDistricts for pickers)
  - kind (delivery|billing) → required on create (FE input omitted it)
  - phone pattern ^0\d{8,9}$ → also accepts E.164
  - extra-on-backend: lat, lng, updatedAt
- **POST /v1/store/me/addresses** — published differently → `store.addresses.create` (`POST /v1/store/addresses`)
  - StoreAddressInputDto → address input with kind, provinceId, subdistrictId?, lat?, lng?
  - path /v1/store/me/addresses → /v1/store/addresses
  - CustomerAddressDto → AddressDto (backend name)
  - province: string (free text) → provinceId: uuid on input / province{id,nameTh,nameEn} on output (geo master: store.catalog.listProvinces, lookupPostcode)
  - subdistrict: string|null → subdistrictId: uuid|null on input / subdistrict{id,nameTh,nameEn}|null on output
  - district → missing-on-backend (implied by the subdistrict; store.catalog.listDistricts for pickers)
  - kind (delivery|billing) → required on create (FE input omitted it)
  - phone pattern ^0\d{8,9}$ → also accepts E.164
  - extra-on-backend: lat, lng, updatedAt
- **DELETE /v1/store/me/addresses/{addressId}** — published differently → `store.addresses.delete` (`DELETE /v1/store/addresses/{addressId}`)
  - path /v1/store/me/addresses/{addressId} → /v1/store/addresses/{addressId}; 204 same
- **PATCH /v1/store/me/addresses/{addressId}** — published differently → `store.addresses.update` (`PATCH /v1/store/addresses/{addressId}`)
  - If-Match required (412/428)
  - path /v1/store/me/addresses → /v1/store/addresses
  - CustomerAddressDto → AddressDto (backend name)
  - province: string (free text) → provinceId: uuid on input / province{id,nameTh,nameEn} on output (geo master: store.catalog.listProvinces, lookupPostcode)
  - subdistrict: string|null → subdistrictId: uuid|null on input / subdistrict{id,nameTh,nameEn}|null on output
  - district → missing-on-backend (implied by the subdistrict; store.catalog.listDistricts for pickers)
  - kind (delivery|billing) → required on create (FE input omitted it)
  - phone pattern ^0\d{8,9}$ → also accepts E.164
  - extra-on-backend: lat, lng, updatedAt
- **GET /v1/store/me/tax-profiles** — published differently → `store.taxProfiles.list` (`GET /v1/store/tax-profiles`)
  - path → /v1/store/tax-profiles
  - envelope {data} → {data, meta} paged
  - path /v1/store/me/tax-profiles/{profileId} → /v1/store/tax-profiles/{taxProfileId} (path segment + param name)
  - address: string (single text) → line1, line2?, provinceId (uuid), subdistrictId?, postcode on input; line1/line2/province{}/subdistrict{}/postcode on output
  - branchCode: required → optional (only for branchType=branch)
  - withholdsTax: required → optional (default false)
  - extra-on-backend: documentEmail (email|null), updatedAt
- **POST /v1/store/me/tax-profiles** — published differently → `store.taxProfiles.create` (`POST /v1/store/tax-profiles`)
  - StoreTaxProfileInputDto → create body: taxType, name, taxId (^\d{13}$, checksum in customers/thai-tax-id.ts), branchType, branchCode?, line1, line2?, provinceId, subdistrictId?, postcode, withholdsTax?, documentEmail?, isDefault?
  - path /v1/store/me/tax-profiles/{profileId} → /v1/store/tax-profiles/{taxProfileId} (path segment + param name)
  - address: string (single text) → line1, line2?, provinceId (uuid), subdistrictId?, postcode on input; line1/line2/province{}/subdistrict{}/postcode on output
  - branchCode: required → optional (only for branchType=branch)
  - withholdsTax: required → optional (default false)
  - extra-on-backend: documentEmail (email|null), updatedAt
- **DELETE /v1/store/me/tax-profiles/{profileId}** — published differently → `store.taxProfiles.delete` (`DELETE /v1/store/tax-profiles/{taxProfileId}`)
  - path /v1/store/me/tax-profiles/{profileId} → /v1/store/tax-profiles/{taxProfileId}; 204 same
- **PATCH /v1/store/me/tax-profiles/{profileId}** — published differently → `store.taxProfiles.update` (`PATCH /v1/store/tax-profiles/{taxProfileId}`)
  - taxType, taxId, branchType, branchCode → not updatable (tax id and branch never change; add a new profile) — backend wins
  - If-Match required
  - path /v1/store/me/tax-profiles/{profileId} → /v1/store/tax-profiles/{taxProfileId} (path segment + param name)
  - address: string (single text) → line1, line2?, provinceId (uuid), subdistrictId?, postcode on input; line1/line2/province{}/subdistrict{}/postcode on output
  - branchCode: required → optional (only for branchType=branch)
  - withholdsTax: required → optional (default false)
  - extra-on-backend: documentEmail (email|null), updatedAt

#### `store.checkout` — published differently

Decisions: D-020, D-051, D-053, D-060, D-013, D-133, D-142, D-174, D-125

- **POST /v1/store/checkout/actions/preview** — published differently → `store.checkout.preview` (`POST /v1/store/checkout/actions/preview`)
  - contact{name,phone,email} → missing-on-backend (customer profile + ccEmails[] ≤10)
  - delivery{mode:shared,addressId}|{mode:per_item} → missing-on-backend; destinations are set per cart item (store.cart.setDestinations), 422 checkout.destinations_incomplete
  - couponCodes[] (≤3) → store.cart.applyCode / removeCode before preview (codes live on the cart)
  - pointsToRedeem (≥0) → redeemPoints (≥1, optional) (rename)
  - scheduleKey → missing-on-backend: schedule template is selected by rules (D-020); a customer choice is an override that needs a staff permission — do not add
  - paymentMethod → missing-on-backend here; chosen per payment at store.payments.initiate
  - note → missing-on-backend
  - taxProfileId, poNumber → same (nullable/optional)
  - extra-on-backend input: companyId, companyBranchId, ccEmails, expectedGrossAmount, utm{}
  - previewToken/expiresAt → missing-on-backend (stateless preview; place re-prices and refuses with 409 checkout.total_changed when expectedGrossAmount differs)
  - items[] → orders[] {cartItemId, productTypeCode, quantity, lines[], destinations[{postcode,quantity,shippingNetAmount}], discounts[], totals}
  - promotions.applied[] → orders[].discounts[] {source (coupon|automatic_promotion|referral|cs_discount|discount_memo|company_discount|points_redemption), code, promotionId, amount, cappedAmount, capReason (margin_floor|budget)}; promotions.rejected[] → CartDto.codes[].status=rejected + rejectReason, plus notices[]
  - points{balance,min,max,pointValue,redeemed,redeemedAmount,toEarn} → missing-on-backend (store.loyalty.get gives the balance; redemption shows as a points_redemption discount)
  - schedule{options[],selectedKey,note} → paymentSchedule{templateKey, instalments[{seq,labelTh,labelEn,pct,grossAmount,cashAmount,dueTrigger,requiredBefore}]}|null (one schedule, no options)
  - paymentMethods[] → missing-on-backend
  - taxInvoice{name,taxId,branch,withholdsTax} → withholding (boolean) only; the rest from the tax profile
  - company{…} → missing-on-backend (store.companies.get / store.companyCredit.get)
  - totals.itemsAmount/shippingAmount/pointsAmount/withholdingAmount/payableNowAmount → totals.netAmount/shippingNetAmount/whtAmount/cashAmount (payable now = first instalment cashAmount)
  - blockers[] → notices[{code,params}] + 409/422 problems
  - **gap (U-B0.1):** paymentMethods available + fee (settings `payments.method_fees`, feature flags D-176) if the checkout must show them before paying
  - **gap (U-B0.1):** points min/max/toEarn preview (D-133 `loyalty.redemption_limits`)
  - **gap (U-B0.1):** company approval/credit summary on the preview for B2B checkout (D-125)
- **POST /v1/store/checkout** — published differently → `store.checkout.place` (`POST /v1/store/checkout`)
  - Idempotency-Key → same (replay returns the same group)
  - body: same differences as preview; previewToken → expectedGrossAmount
  - 201 PlacedOrderDto → 201 OrderGroupDto
  - groupId → id; groupCode, orders[] same names (orders[] are OrderDto)
  - grossAmount → totals.grossAmount (nesting)
  - firstInstalment → missing-on-backend (store.paymentSchedules.get on the group)
  - expiresAt → same (nullable)
  - 409 checkout.repriced / checkout.preview_expired → 409 checkout.total_changed / checkout.price_expired
  - extra-on-backend: status (pending_company_approval|waiting_payment|…), placedAt, poNumber, channel, ccEmails, cancelledAt
  - **gap (U-B0.1):** firstInstalment on the placed group (to go straight to payment) — optional, derivable from store.paymentSchedules.get
  - *note:* D-196 (finding F3): store credit becomes usable at checkout as a payment method, up to the order total. U2.F delivers it (pre-launch, D-219; checkout accepts `storeCreditAmount` / payment method `store_credit`) once Finance confirms the 2320 → AR posting. U-B0.1 does not build it.

#### `store.payments` — published differently

Decisions: D-061, D-020, D-176, D-175

- **POST /v1/store/instalments/{instalmentId}/payments** — published differently → `store.payments.initiate` (`POST /v1/store/order-groups/{groupId}/payments`)
  - path instalmentId → groupId path + body instalmentIds[] (≤12; omit = everything due now)
  - method → same enum + card_instalment_2c2p, scb_direct_debit (extra values)
  - returnUrl → missing-on-backend (return URL is server-configured)
  - Idempotency-Key → same
  - StorePaymentDto → PaymentDto
  - instalmentId → missing (payment may cover several); groupId instead
  - orderGroupCode → missing-on-backend
  - qr{payload,imageUrl} → qrPayload (string|null, render the image client-side)
  - bankAccount{bank,accountName,accountNo} → missing-on-backend
  - slips[].message → lastCheck (pass|mismatch|duplicate|unreadable|provider_error)
  - slips[].reviewDueAt → slaDueAt; slips[].uploadedAt → createdAt
  - failureReason → missing-on-backend
  - amount → amount (+ cashAmount after withholding, whtAmount)
  - expiresAt/paidAt nullable same; status same PaymentStatus
  - extra-on-backend: referenceCode, createdAt
  - **gap (U-B0.1):** receiver bank account for bank_transfer_slip (from setting `payments.slip_receiver_accounts`, D-061)
  - **gap (U-B0.1):** failureReason on a failed payment
  - **gap (U-B0.1):** returnUrl or a documented fixed return route for 2C2P
- **GET /v1/store/payments/{paymentId}** — published differently → `store.payments.get` (`GET /v1/store/payments/{paymentId}`)
  - same path; response PaymentDto — see the initiate mapping (qrPayload, no bankAccount/failureReason/instalmentId/orderGroupCode, slips[] field renames)
  - **gap (U-B0.1):** bankAccount, failureReason (as above)
  - *note:* Realtime: store.realtime.stream exists; confirm it announces payment updates.
- **POST /v1/store/payments/{paymentId}/slips** — published differently → `store.payments.uploadSlip` (`POST /v1/store/payments/{paymentId}/slips`)
  - fileId → same (file purpose `slip`, scanned clean)
  - declaredAmount → same
  - declaredTransferredAt → transferredAt (rename)
  - Idempotency-Key → same
  - 201 PaymentDto (as above)

#### `store.instalments` — implement here (U-B0.1)

Decisions: D-020, D-061

- **GET /v1/store/instalments** — implement here
  - **scope (U-B0.1, `payment-schedules`):** Customer-scoped paged GET ?status= across the caller's order groups → per instalment: id, group code, order allocations, seq, labelTh/En, dueTrigger, requiredBefore, dueAt, grossAmount, cashAmount, paidAmount, openAmount, status, receipt document id (receivables/documents), active payment id, payable. Read-only; D-020.
  - *note:* Per-group data already exists: store.paymentSchedules.get (GET /v1/store/order-groups/{groupId}/payment-schedule) returns instalments[] with labelTh/labelEn (not label), allocations[{orderId,orderCode}], cashAmount/openAmount/whtAmount; receipts via store.documents.list (paymentId, docType rc/tr). Reuse that view shape.

#### `store.orders` — published differently

Decisions: D-050, D-141, D-060, D-021, D-080, D-081, D-082, D-010, D-125

- **GET /v1/store/orders** — published differently → `store.orders.listGroups` (`GET /v1/store/order-groups`)
  - path /v1/store/orders → /v1/store/order-groups (list of groups, each with orders[])
  - view=active|completed|cancelled → status=OrderGroupStatus (pending_company_approval|waiting_payment|in_progress|completed|cancelled)
  - StoreOrderSummaryDto → OrderDto inside data[].orders[]
  - groupCode → parent group's groupCode
  - productType{code,name} → productTypeCode
  - product{slug,name,imageUrl} → missing-on-backend
  - quantity → quantityOrdered
  - unit → missing-on-backend
  - grossAmount/currency → totals.grossAmount/totals.currency
  - createdAt → group placedAt
  - nextActions → missing-on-backend
  - id, orderCode, status, artworkStatus, promisedShipDate → same
  - **gap (U-B0.1):** product {name,imageUrl,slug} and unit on OrderDto
  - **gap (U-B0.1):** nextActions per order (pay, upload, approve proof, confirm receipt)
- **GET /v1/store/orders/{orderId}** — published differently → `store.orders.get` (`GET /v1/store/orders/{orderId}`)
  - StoreOrderDetailDto → OrderDto (lean)
  - quantity → quantityOrdered; grossAmount/net/discount/shipping/vat/currency → totals{grossAmount,netAmount,discountAmount,shippingNetAmount,vatAmount,whtAmount,cashAmount,currency}
  - tolerance{shortagePct,overagePct} → toleranceShortagePct/toleranceOveragePct
  - destinations[] flat address → destinations[].address{recipientName,phone,line1,line2,subdistrictNameTh,districtNameTh,provinceNameTh,postcode} + shippingNetAmount
  - leadTimeDays: int → int|null; promisedShipDate nullable same
  - lines[] → same name (OrderLineDto: lineType, descriptionTh/En, quantity, unitPrice, amounts, whtCategory)
  - group{id,groupCode,orderCount}, groupCode, expiresAt, poNumber, taxInvoice → store.orders.getGroup (group has expiresAt, poNumber)
  - instalments[] → store.paymentSchedules.get on the group (allocations per order)
  - documents[] → store.documents.list (filter client-side by orderId — no orderId query param), docType iv|tr|rc|cn|dn (no qt; the quotation PDF is store.quotes.getPdf), docNumber, status, issuedAt, grossAmount, docKind (instalment|final|…)
  - artwork{status,latestSubmission,latestProof,designService} → artworkStatus + store.artwork.list / store.artwork.listProofs / store.designServices.get
  - shipments[] → store.shipments.list: carrier enum packio|flash_express|deliveree (not factory_fleet), cartonsCount, events[].occurredAt, proofOfDelivery{capturedAt,receiverName,photoFileIds[]}, items[].deliveredQuantity
  - timeline[] → store.timeline.get {id,type,messageKey,params,occurredAt,photoFileIds,shipment} (cursor paged; title/detail rendered from messageKey)
  - stages[] → store.timeline.progress steps[{key,labelTh,labelEn,status pending|in_progress|completed|skipped,completedAt}]
  - claims[] → store.claims.list?orderId=
  - trackingToken → POST /v1/store/orders/{orderId}/tracking-links (store.timeline.createTrackingLink) → {token,url}
  - receipt{confirmedAt,autoCompleteAt,claimWindowEndsAt}, toleranceOutcome, estimatedDeliveryDate, cancelReason, specs, product, unit, nextActions, createdAt → missing-on-backend (cancelledAt present)
  - extra-on-backend: quoteId, statusChangedAt, designOption, mockupOption
  - **gap (U-B0.1):** receipt dates on the order (confirmedAt, autoCompleteAt = delivered + `orders.auto_complete_days`, claimWindowEndsAt = receipt + `claims.window_days`) — D-081/D-082, the UI must not compute them
  - **gap (U-B0.1):** toleranceOutcome (D-021/D-080)
  - **gap (U-B0.1):** orderId filter on store.documents.list
  - **gap (U-B0.1):** product/specs/unit/nextActions/createdAt/cancelReason/estimatedDeliveryDate
  - *note:* No factory, cost or margin in any of these (D-050, D-141).
- **POST /v1/store/orders/{orderId}/documents/{documentId}/actions/download** — published differently → `store.documents.pdf` (`GET /v1/store/documents/{documentId}/pdf`)
  - POST …/orders/{orderId}/documents/{documentId}/actions/download → GET /v1/store/documents/{documentId}/pdf (no orderId segment)
  - SignedUrlDto{url,expiresAt} → {url,expiresAt} same
  - 409 while the PDF is not rendered yet (pdfReady on the document)

### U-B0.1 — `store.*`: account, artwork & designs, fulfilment, support, business

#### `store.loyalty` — published differently

Decisions: D-130, D-131, D-132, D-133, D-134, D-136

- **GET /v1/store/me/points** — published differently → `store.loyalty.get` (`GET /v1/store/loyalty`)
  - path /v1/store/me/points → /v1/store/loyalty
  - StorePointsDto → LoyaltySummaryDto (flat, not nested balance/tier)
  - balance.available → availablePoints (rename, nesting)
  - balance.pending → pendingPoints (rename, nesting)
  - balance.expiringSoon:int + balance.expiringSoonAt → expiringSoon: ExpiringPointsDto[] {points, expiresAt} (type: list of expiring lots within 30 days, not one total + one date)
  - balance.availableBahtValue → availableValue (rename, decimal string)
  - tier.current → tier (LoyaltyTier, same enum member|silver|gold; nesting)
  - tier.multiplier → multiplier (same, string)
  - tier.spend12m → spend12m (same, decimal string)
  - tier.next / tier.nextThreshold / tier.progressPct → missing-on-backend
  - pointValue → pointValue (same)
  - extra-on-backend: currency
  - **gap (U-B0.1):** tier progress: next tier, its 12-month-spend threshold and progress % (thresholds are the D-134 settings; compute in loyalty.service, never in the web)
  - *note:* Backend field names win. D-130..D-134.
- **GET /v1/store/me/points/entries** — published differently → `store.loyalty.ledger` (`GET /v1/store/loyalty/ledger`)
  - path /v1/store/me/points/entries → /v1/store/loyalty/ledger
  - query page/perPage/sort/order/q → same
  - envelope {data, meta{page,perPage,total}} → same (PageMeta)
  - PointsEntryDto.id/entryType/points/bahtValue/status/availableAt/expiresAt/createdAt → same (enums identical)
  - order {id, orderCode} | null → orderCode: string|null (no order id; nesting)
  - note → reason (rename)
  - extra-on-backend: groupCode
  - **gap (U-B0.1):** order id on the entry if the history must link to the order page (or link by code via store.orders.getByCode)
  - *note:* Backend schema is also named PointsEntryDto but with a different shape.
- **GET /v1/store/me/referral** — published differently → `store.referral.get` (`GET /v1/store/referral`)
  - path /v1/store/me/referral → /v1/store/referral
  - StoreReferralDto → MyReferralDto
  - code → code (same)
  - extra-on-backend: link (share URL)
  - referrals: [{id, refereeName (masked), status, joinedAt, rewardPoints}] → referrals: ReferralCountsDto {pending, qualified, rejected, rewarded, underReview} (type: counts only, no list)
  - referrerReward / refereeReward (rules in words) → missing-on-backend
  - monthlyLimit / rewardedThisMonth → missing-on-backend
  - ReferralStatus enum pending|qualified|rewarded|rejected_fraud|under_review → counts keyed pending|qualified|rewarded|rejected|underReview (enum naming differs: rejected vs rejected_fraud, underReview vs under_review)
  - **gap (U-B0.1):** referral rules from the D-136 settings (referee % and cap, referrer reward, monthly max)
  - **gap (U-B0.1):** rewardedThisMonth for the D-136 10-per-month cap
  - **gap (U-B0.1):** optional list of the customer's own referrals with masked referee name, status, joinedAt, rewardPoints (masking server-side; never expose phone/email/full name)
  - *note:* 404 http.not_found also documented. D-136.

#### `store.wallet` — published differently

Decisions: D-053, D-080, D-021, D-033

- **GET /v1/store/me/wallet** — published differently → `store.documents.storeCredit` (`GET /v1/store/store-credit`)
  - path /v1/store/me/wallet → /v1/store/store-credit (store credit only)
  - storeCredit.balance → balance (top level; decimal string, no dec2 pattern declared)
  - storeCredit.currency → currency (plain string, not const THB)
  - storeCredit.entries[] → entries: StoreCreditEntryDto[]
  - entries[].id / amount / createdAt → same
  - entries[].kind {shortage_credit|refund|goodwill|spent|expired} → source: StoreCreditSource {shortage_credit|cancellation|claim|refund_alternative|applied_to_order|manual|refunded} (rename + enum values; backend wins)
  - entries[].order {id, orderCode} → orderCode: string|null (no id)
  - entries[].note → missing-on-backend
  - extra-on-backend: entries[].docNumber (the credit note number)
  - promotions: WalletPromotionDto[] → missing-on-backend
  - **gap (U-B0.1):** customer-facing list of promotion codes assigned to me (promotion coupons carry assignedCustomerId) plus referral-reward codes, with title/benefit/conditions/validUntil/status — additive store endpoint in the promotions module
  - *note:* Backend description cites D-021/D-033 (credit notes). D-053, D-080.
  - *note:* D-196 (F3): the balance shown here becomes spendable at checkout in U2.F; this read stays as mapped.

#### `store.privacy` — implement here (U-B0.1)

Decisions: D-005, D-140

- **GET /v1/store/me/privacy-requests** — implement here
  - **scope (U-B0.1, `customers`):** List the signed-in customer's own PDPA requests (kind, status, note, signed download when an export is ready, requestedAt, dueAt from a settings-defined legal deadline). Customer scope only.
  - *note:* Consents already exist (store.me.consents / store.me.recordConsent, analytics module). No D-### covers DSAR handling; PDPA rule in CLAUDE.md.
- **POST /v1/store/me/privacy-requests** — implement here
  - **scope (U-B0.1, `customers`):** Create an export|delete request, Idempotency-Key required; one transaction + audit + outbox event for the privacy team queue; deletion answer must state limits (open orders, tax-record retention). The response deadline and retention periods must be settings, not constants; an admin queue to answer requests is also needed.
  - *note:* uncertain: which role answers (no privacy role in D-140) — record an assumption in PROGRESS.

#### `store.identities` — implement here (U-B0.1)

Decisions: D-151

- **DELETE /v1/store/me/identities/{provider}** — implement here
  - **scope (U-B0.1, `auth`):** Unlink one of my sign-in identities (provider must be the IdentityProvider enum phone_otp|firebase_google|firebase_apple|line, not a free string); 409 identity.last_method when it is the last one; audit + event; revoke sessions bound to that identity.
  - *note:* GET /v1/store/me (store.me.get) already returns identities[{provider, linkedAt}] (auth/controllers/me.controllers.ts). D-151.

#### `store.artwork` — published differently

Decisions: D-070, D-073

- **GET /v1/store/orders/{orderId}/artwork** — published differently → `store.artwork.list` (`GET /v1/store/orders/{orderId}/artwork-submissions`)
  - one aggregate → several calls: store.orders.get (artworkStatus, designOption, orderCode), store.artwork.list (submissions), store.artwork.listProofs (proofs), store.artwork.listTemplates (dieline templates), store.designServices.get (designService)
  - submissions: envelope → plain array ArtworkSubmissionDto[] (no {data})
  - submissions[].id/versionNo/status/preflightStatus/note/submittedAt → same (enums identical)
  - submissions[].rejectionReason → rejectReason (rename)
  - submissions[].findings[] {check,severity,page,message} → preflightReport.files[].checks[] {check, severity, page, outcome, messageTh, messageEn, measurements} (nesting per file; message split Th/En; only outcome=fail rows are findings)
  - submissions[].files[] {role, file{id, originalName, mimeType, sizeBytes, thumbnailUrl, url}} → files[] {id, fileId, role, originalName, mimeType, sizeBytes, linkUrl} (flattened; no url/thumbnail — download via store.files.download)
  - extra-on-backend: submissions[].channel, source, reviewedAt, preflightCompletedAt, preflightReport.blockCount/warnCount/expectedSize
  - proofs[] → ProofDto[] (see store.proofs mapping: proofFile, decisionComment, approvedFileSha256, annotations[] instead of counts, compare)
  - dieline {dielineKey, lengthMm, widthMm, heightMm, templateUrl} → store.artwork.listTemplates: DielineDeliveryDto[] {id, fileId, note, sentAt, trigger} (no dimensions/dielineKey; download fileId)
  - designService → store.designServices.get: DesignServiceDto (see store.design-service)
  - rules {accept, maxBytes, maxFiles, bleedMm, safeMarginMm, minDpi, colourMode} → missing-on-backend
  - checklist[] {key,label} → missing-on-backend
  - nextActions[] → missing-on-backend
  - **gap (U-B0.1):** artwork file rules from settings (D-070 bleed, safe margin, min DPI, colour mode; accepted types / max size / max files as the file module enforces them) on a store endpoint
  - **gap (U-B0.1):** the approval checklist items (settings-driven) the customer confirms
  - **gap (U-B0.1):** dieline key and box dimensions on the order (or template) for the upload page
  - **gap (U-B0.1):** optional: an aggregate GET /v1/store/orders/{orderId}/artwork composed server-side if the web prefers one call
  - *note:* Backend wins on the split model; path is artwork-submissions, not artwork/submissions.
- **POST /v1/store/orders/{orderId}/artwork/submissions** — published differently → `store.artwork.submit` (`POST /v1/store/orders/{orderId}/artwork-submissions`)
  - path …/artwork/submissions → …/artwork-submissions
  - files[] {fileId, role} → files[] {fileId, role?} (role enum ArtworkUploadRole artwork|font|reference — no link; links go in links: string[])
  - designDocumentId → separate op store.designs.submitForOrder (POST …/artwork-submissions/from-design, body {designId?, note?})
  - note → note (same)
  - extra-on-backend: links[] (https links)
  - response StoreArtworkDto → ArtworkSubmissionDto (the new version; poll GET …/artwork-submissions/{submissionId} = store.artwork.get for the preflight report)
  - Idempotency-Key header → not declared on backend
  - **gap (U-B0.1):** Idempotency-Key on store.artwork.submit (the FE marks it idempotent; CLAUDE.md money/irreversible rule does not strictly require it — decide)
  - *note:* Errors: 409 artwork.not_accepting, 422 artwork.file_not_usable. D-070, D-073.

#### `store.proofs` — published differently

Decisions: D-070, D-073

- **POST /v1/store/orders/{orderId}/proofs/{proofId}/actions/approve** — published differently → `store.artwork.approveProof` (`POST /v1/store/proofs/{proofId}/actions/approve`)
  - path drops /orders/{orderId}
  - Idempotency-Key → same (required; Idempotent-Replayed header)
  - body {checklist: string[], note?} → no request body on backend
  - response StoreArtworkDto → ProofDto
  - decision.fileSha256 → approvedFileSha256; decision.at → decidedAt; decision.note → decisionComment; decision.outcome → status; decision.byName → missing; decision.checklist → missing
  - extra-on-backend: approvedFileId, decisionChannel, onBehalfReason
  - **gap (U-B0.1):** accept and store the confirmed checklist keys (and optional note) as part of the approval evidence (B4.1)
  - **gap (U-B0.1):** approver display name on the proof decision
  - **gap (U-B0.1):** rasterised proof pages (imageUrl, widthPx, heightPx per page) and per-page dieline overlay — backend has proofFile.pageCount and dielineFileId only (preflight notes a rasteriser does not exist yet)
  - *note:* 409 artwork.not_accepting | file.not_ready | proofs.not_pending. D-073 production auto-start is handled by the backend.
- **POST /v1/store/orders/{orderId}/proofs/{proofId}/actions/request-changes** — published differently → `store.artwork.requestProofChanges` (`POST /v1/store/proofs/{proofId}/actions/request-changes`)
  - path drops /orders/{orderId}
  - body note → comment (rename; RequestChangesDto)
  - response StoreArtworkDto → ProofDto
  - *note:* 409 proofs.not_pending. D-070.
- **GET /v1/store/orders/{orderId}/proofs/{proofId}/annotations** — published differently → `store.artwork.getProof` (`GET /v1/store/proofs/{proofId}`)
  - separate list → ProofDto.annotations[] on store.artwork.getProof (also on store.artwork.listProofs)
  - thread {id, messages[]} → flat AnnotationDto[] where the root has parentId null and replies carry parentId (client groups them)
  - messages[].body → comment; messages[].authorKind/authorName → author {kind, displayName}; resolved:boolean → resolvedAt: string|null
  - kind {pin|rect|draw} → same enum; page, geometry → same
  - proofId → implied (parent ProofDto.id)
  - *note:* Resolve is store.artwork.resolveAnnotation (POST /v1/store/proof-annotations/{annotationId}/actions/resolve).
- **POST /v1/store/orders/{orderId}/proofs/{proofId}/annotations** — published differently → `store.artwork.annotate` (`POST /v1/store/proofs/{proofId}/annotations`)
  - path drops /orders/{orderId}
  - page / kind / geometry → same (backend kind also allows draw)
  - body → comment (rename)
  - response StoreAnnotationThreadDto → the whole ProofDto
  - *note:* 409 proofs.annotation_closed when the proof is no longer pending.
- **POST /v1/store/orders/{orderId}/proofs/{proofId}/annotations/{annotationId}/messages** — published differently → `store.artwork.annotate` (`POST /v1/store/proofs/{proofId}/annotations`)
  - reply endpoint → the same annotate op with parentId = annotationId
  - body → comment; page/kind/geometry are required on backend even for a reply (send the parent's values)
  - response StoreAnnotationThreadDto → ProofDto
  - **gap (U-B0.1):** uncertain: whether replies should not need page/kind/geometry — check AnnotateProofDto validation; consider making them optional when parentId is set

#### `store.design-service` — published differently

Decisions: D-071, D-073, D-020

- **POST /v1/store/orders/{orderId}/design-service/actions/approve** — published differently → `store.artwork.approveProof` (`POST /v1/store/proofs/{proofId}/actions/approve`)
  - dedicated approve action → approve the proof of the delivered round (the designer's delivery is an artwork submission with source design_service that goes to preflight and a proof; proof.approved closes the round and sets the design service to approved)
  - orderId → proofId of the latest pending proof (store.artwork.listProofs)
  - response StoreArtworkDto → ProofDto (refetch store.designServices.get)
  - *note:* Backend wins (design-services.service.ts onProofDecision). D-071, D-073.
- **PUT /v1/store/orders/{orderId}/design-service/brief** — published differently → `store.designServices.submitBrief` (`PUT /v1/store/orders/{orderId}/design-service/brief`)
  - answers: {key: value} → fixed fields brandName, brandCategory, description (required strings)
  - fileIds → attachmentFileIds (rename, optional)
  - response StoreArtworkDto → DesignServiceDto
  - briefFields (RfqFieldDto[]) on the GET → missing-on-backend (the brief has fixed fields; backend wins)
  - brief[] {label,value} → brief {brandName, brandCategory, description, attachmentFileIds} | null; briefSubmitted → briefSubmittedAt
  - *note:* 409 design_services.invalid_status. Same method+path; body and response differ. D-071.
- **POST /v1/store/orders/{orderId}/design-service/rounds** — published differently → `store.designServices.confirmExtraRound` (`POST /v1/store/orders/{orderId}/design-service/actions/confirm-extra-round`)
  - free revision (rounds 2–4) → store.artwork.requestProofChanges on the delivered proof (the backend opens the next free round automatically)
  - chargeable round → POST …/design-service/actions/confirm-extra-round
  - note → changeRequest (rename)
  - acceptedFee → expectedFeeGross (rename; must equal nextRevision.feeGross, else 409 design_services.fee_changed)
  - fileIds → missing-on-backend
  - Idempotency-Key → same (required)
  - response StoreArtworkDto → DesignServiceDto
  - nextRound {roundNo, chargeable, feeAmount} → nextRevision {revisionNo, chargeable, feeNet, feeGross} (rename, fee split net/gross)
  - rounds[].feeAmount → feeNet; rounds[].files → submissionId (files are on the artwork submission); rounds[].note → changeRequest
  - pendingFeeInstalment → rounds[].instalmentId (resolve via store.paymentSchedules.get)
  - **gap (U-B0.1):** optional reference files on a paid-round change request (attachment file ids)
  - *note:* Fee = max(THB 500, 20 % of design fee) is computed by the backend from settings. D-071, D-020.

#### `store.designs` — mixed: 6 published differently · 1 published · 3 implement here

Decisions: D-152, D-070

- **GET /v1/store/designs** — published differently → `store.designs.list` (`GET /v1/store/designs`)
  - query page/perPage/sort/order/q → same; linked (any|linked|unlinked) → missing-on-backend
  - data[] StoreDesignSummaryDto → DesignDocumentDto (backend schema name collides with the FE document schema)
  - name → title (rename)
  - thumbnailUrl → thumbnailFileId (file id, not URL)
  - product {slug, name, productTypeCode} → catalogProductId (uuid only)
  - link {orderId, orderCode, itemId, itemName} → missing-on-backend (link is the other way: cart item / order designDocumentId)
  - versionNo:int → versionNo: int|null
  - createdAt → missing-on-backend; updatedAt → same
  - styleId → missing-on-backend
  - extra-on-backend: lengthMm, widthMm, heightMm, patternId, materialId, semiDesignTemplateId, schemaVersion
  - **gap (U-B0.1):** product summary (slug, name, productTypeCode) and thumbnail URL on list items
  - **gap (U-B0.1):** the order link (orderId/orderCode) derived from orders/cart items using the design, plus a linked filter
  - *note:* D-152, D-070.
- **POST /v1/store/designs** — published differently → `store.designs.create` (`POST /v1/store/designs`)
  - name → title
  - catalogProductSlug? → catalogProductId (required uuid)
  - document {schemaVersion, spec, content} → document (opaque object) + schemaVersion (top level)
  - templateId → semiDesignTemplateId
  - patternId / materialId → same
  - source (DesignSource) → missing-on-backend
  - link {orderId, itemId} → missing-on-backend
  - extra-on-backend: lengthMm, widthMm, heightMm
  - Idempotency-Key → not declared on backend
  - response StoreDesignDto → DesignDocumentDto with ETag
  - **gap (U-B0.1):** Idempotency-Key on create (FE marks it idempotent)
  - **gap (U-B0.1):** uncertain: source/link — starting a design from an order line may be served by passing designDocumentId on the cart item; decide whether the design needs a stored source
  - *note:* 409 designs.template_without_design, 422 designs.document_too_large.
- **DELETE /v1/store/designs/{designId}** — published → `store.designs.delete` (`DELETE /v1/store/designs/{designId}`)
  - same method, path and 204
  - 409 design.linked → not raised: backend soft-deletes and orders keep the version they used (backend wins)
  - *note:* Behaviour difference only in the error set.
- **GET /v1/store/designs/{designId}** — published differently → `store.designs.get` (`GET /v1/store/designs/{designId}`)
  - ETag header → same (the FE assumes "v<versionNo>"; treat as opaque)
  - name → title; thumbnailUrl → thumbnailFileId; product → catalogProductId
  - document {schemaVersion, spec, content} → document (object|null) + schemaVersion (int|null) top level
  - assets[] {id, fileId, url, mimeType, widthPx, heightPx, sizeBytes, createdAt} → assets[] {id, fileId, kind} (no signed url/size/dimensions)
  - source, link, styleId, createdAt, nextActions → missing-on-backend
  - extra-on-backend: lengthMm/widthMm/heightMm, semiDesignTemplateId, assets[].kind
  - **gap (U-B0.1):** signed URL (and mime/size/dimensions) per asset so the designer can render without a download call per image
  - **gap (U-B0.1):** nextActions (e.g. submit for an order, share)
- **PUT /v1/store/designs/{designId}** — published differently → `store.designs.save` (`PUT /v1/store/designs/{designId}`)
  - If-Match → same (required; 412 concurrency.stale, 428 concurrency.precondition_required)
  - name → title (optional on backend)
  - document → document + schemaVersion (required) top level
  - kind (autosave|manual) → missing-on-backend (every save is an immutable version)
  - patternId / materialId → not accepted on save
  - thumbnailFileId → same
  - response StoreDesignDto → DesignDocumentDto with ETag
  - **gap (U-B0.1):** save kind (autosave vs manual) if the version history must tell them apart; consider pruning/coalescing autosaves
  - **gap (U-B0.1):** changing pattern/material on save (or document that it lives in the document body)
- **POST /v1/store/designs/{designId}/actions/duplicate** — implement here
  - **scope (U-B0.1, `designs`):** Copy my design's current version and assets into a new unlinked design with the given name (title); Idempotency-Key; audit + activity. D-152.
- **GET /v1/store/designs/{designId}/versions** — published differently → `store.designs.listVersions` (`GET /v1/store/designs/{designId}/versions`)
  - envelope {data, meta{nextCursor}} with cursor/limit → plain array DesignVersionDto[] (no pagination)
  - versionNo → same
  - savedAt → createdAt (rename)
  - kind (autosave|manual|restore|import) → missing-on-backend
  - label, thumbnailUrl → missing-on-backend
  - extra-on-backend: contentSha256, schemaVersion, document (nullable; description says bodies are omitted)
  - **gap (U-B0.1):** cursor pagination (versions grow with autosave; api-conventions)
  - **gap (U-B0.1):** version kind/label/thumbnail
- **GET /v1/store/designs/{designId}/versions/{versionNo}** — published differently → `store.designs.getVersion` (`GET /v1/store/designs/{designId}/versions/{versionNo}`)
  - path param versionNo: string → integer
  - savedAt → createdAt; kind/label/thumbnailUrl → missing-on-backend
  - document {schemaVersion, spec, content} → document (object|null) + schemaVersion top level
  - extra-on-backend: contentSha256
- **POST /v1/store/designs/{designId}/versions/{versionNo}/actions/restore** — implement here
  - **scope (U-B0.1, `designs`):** Create a new version whose document equals version N (history never rewritten); If-Match on the design's current ETag, 412 concurrency.stale; returns the design with the new ETag.
- **POST /v1/store/designs/actions/import** — implement here
  - **scope (U-B0.1, `designs`):** One-time import of browser-kept guest designs: per-row {localId, name, document, createdAt, updatedAt} → {imported[{localId, designId}], skipped[{localId, reason}]}; replays by localId are no-ops (store localId per owner); Idempotency-Key; each row needs a catalogue product (backend requires catalogProductId) — the request must carry it or rows are skipped.

#### `store.design-assets` — published differently

Decisions: D-152, D-070

- **POST /v1/store/designs/{designId}/assets** — published differently → `store.designs.addAsset` (`POST /v1/store/designs/{designId}/assets`)
  - fileId → same
  - widthPx / heightPx → missing-on-backend
  - kind: DesignAssetKind {image|font|logo|svg} → extra-on-backend (required)
  - response DesignAssetDto {id, fileId, url, mimeType, widthPx, heightPx, sizeBytes, createdAt} → DesignDocumentDto (whole design; assets[] {id, fileId, kind})
  - FilePurpose design_asset → missing (enum artwork|proof|slip|evidence|document|import|avatar; upload with artwork as the FE already does)
  - **gap (U-B0.1):** FilePurpose design_asset (size/type policy for designer images)
  - **gap (U-B0.1):** asset url (signed), mimeType, sizeBytes, widthPx/heightPx on the asset view
  - *note:* Removal exists: store.designs.removeAsset (DELETE …/assets/{assetId}).

#### `store.designer-catalog` — implement here (U-B0.1)

Decisions: D-070, D-152

- **GET /v1/store/designer/catalog** — implement here
  - **scope (U-B0.1, `designs`):** Public, cacheable read for ?product=slug: patterns with id, dielineKey, size rules and material ids; materials with caliper (materials.micron) and flute allowances (flute_types col_a/col_c/col_dd); semi-design templates; colours and fonts (admin design-fonts); artwork rules from settings (D-070). Reads catalog data; no prices.
  - *note:* Overlaps store.catalog.getProduct (patterns/standardSizes) and store.catalog.listSemiDesigns; material data is catalog-owned — could equally live in the catalog module.
- **GET /v1/store/designer/templates/{templateId}** — implement here
  - **scope (U-B0.1, `designs`):** Public read of one semi-design template with its designer document (set by admin.designs.setTemplateDesign), dieline key and colours.
  - *note:* store.artwork.listTemplates is per-order dieline files, not this.

#### `store.design-share` — implement here (U-B0.1)

Decisions: D-152

- **POST /v1/store/designs/{designId}/actions/share** — implement here
  - **scope (U-B0.1, `designs`):** Create or return the one live view-only token for my design, optional expiresInDays 1–365; token stored hashed; Idempotency-Key; audit.
- **DELETE /v1/store/designs/{designId}/share** — implement here
  - **scope (U-B0.1, `designs`):** Revoke the live link (old token → 404); audit.
- **GET /v1/store/shared-designs/{token}** — implement here
  - **scope (U-B0.1, `designs`):** Public (security: []), rate-limited read of the design's current version: name, document, assets with signed URLs, sharedAt; 404 design.share_not_found when revoked/expired. No owner identity.

#### `store.tracking` — published differently

Decisions: D-143, D-142, D-075, D-081

- **GET /v1/store/tracking/{token}** — published differently → `store.tracking.get` (`GET /v1/store/track/{token}`)
  - path /v1/store/tracking/{token} → /v1/store/track/{token} (same operationId store.tracking.get)
  - orderCode → missing-on-backend
  - status: OrderStatus → status: string (not an enum)
  - productName / quantity / unit → missing-on-backend
  - stages[] {key, title, state done|current|upcoming|skipped, at, promisedAt, detail} → steps[] ProgressStepDto {key, labelTh, labelEn, status pending|in_progress|completed|skipped, completedAt} (rename + enum values; no per-step promisedAt; title split Th/En)
  - estimatedDeliveryDate → promisedShipDate (date; ship, not delivery) plus shippedAt / deliveredAt
  - shipments[].shipmentNo / trackingNo / trackingUrl → same
  - shipments[].status: ShipmentStatus → TrackingStatus {ready|picked_up|in_transit|out_for_delivery|delivered|failed|returned} (subset)
  - shipments[].carrier: CarrierCode {factory_fleet|flash_express|deliveree} → StoreCarrier {packio|flash_express|deliveree} (factory_fleet → packio)
  - shipments[].cartons → cartonsCount
  - shipments[].province → missing-on-backend (backend excludes all locations — backend wins)
  - shipments[].quantity / shippedAt / deliveredAt → missing-on-backend
  - shipments[].events[] {at, status, location} → steps[] {occurredAt, status} (no location)
  - updatedAt → missing-on-backend
  - StoreOrderDetailDto.stages → use store.timeline.progress (GET /v1/store/orders/{orderId}/progress) for the signed-in view
  - **gap (U-B0.1):** orderCode, product name and quantity/unit on the public view if the business accepts them (not personal data; confirm against PDPA rule)
  - **gap (U-B0.1):** per-stage promised dates (only promisedShipDate exists)
  - *note:* Backend is public (security []). Province/location exclusion is a backend choice; the FE row itself allows province — flag to the user, backend wins.

#### `store.receipt` — published differently

Decisions: D-081, D-082

- **POST /v1/store/orders/{orderId}/actions/confirm-receipt** — published differently → `store.orders.confirmReceipt` (`POST /v1/store/orders/{orderId}/actions/confirm-receipt`)
  - Idempotency-Key → same (required)
  - body {} → no request body declared
  - response StoreOrderDetailDto → OrderDto (the same schema store.orders.get returns)
  - receipt {confirmedAt, autoCompleteAt, claimWindowEndsAt} → missing-on-backend
  - 409 order.not_delivered → 409 order.invalid_transition
  - **gap (U-B0.1):** receipt block on the order view: confirmedAt, autoCompleteAt (delivery + 7 days) and claimWindowEndsAt (D-082) — StoreClaimDto.windowEndsAt exists only after a claim
  - *note:* D-081, D-082.

#### `store.claims` — mixed: 1 implement here · 3 published differently

Decisions: D-081, D-082, D-083

- **GET /v1/store/orders/{orderId}/claim-form** — implement here
  - **scope (U-B0.1, `claims`):** Read-only form data for my order: claim window end (D-082, from receipt), open flag, allowed types and resolutions, delivered shipments (id, shipmentNo, deliveredQuantity, deliveredAt — no province/address per the tracking choice), evidence rules from settings (accept, maxBytes, min product/carton photos, max photos).
  - *note:* Types/resolutions are already contract enums (ClaimType, ClaimResolutionKind).
- **POST /v1/store/orders/{orderId}/claims** — published differently → `store.claims.submit` (`POST /v1/store/orders/{orderId}/claims`)
  - Idempotency-Key → same
  - type / description / requestedResolution / shipmentId / productPhotoFileIds / cartonPhotoFileIds → same
  - affectedQuantity → claimedQuantity (rename)
  - extra-on-backend: claimedAmount
  - response StoreClaimDto → backend StoreClaimDto (different shape): order {id, orderCode} → orderId + orderCode (flat); shipment → missing; affectedQuantity → claimedQuantity; evidence {productPhotos[], cartonPhotos[] file objects} → photos {product: uuid[], carton: uuid[]}; automatic → origin (customer|tolerance_auto|staff); respondBy → missing; messages[] → infoRequest (single string); outcome {decision, resolution, amount, note, at} → status + decisionNote + resolutions[] {action, amount, quantity, executedAt, …}; canReply → derive from status == need_info
  - extra-on-backend: windowEndsAt, receivedAt, claimedAmount
  - 422 claim.window_closed → 409 claims.window_closed; 422 claim.evidence_missing → 422 claims.evidence_missing; extra 409 claims.not_delivered
  - **gap (U-B0.1):** respondBy (review SLA) on the claim, if the web must show it
  - *note:* Backend wins on liability staying internal (D-083) — resolutions[] exposes factory_deduction/carrier_recovery actions; uncertain whether those should be filtered from the customer view.
- **GET /v1/store/orders/{orderId}/claims/{claimId}** — published differently → `store.claims.get` (`GET /v1/store/claims/{claimId}`)
  - path drops /orders/{orderId}
  - response mapping as for store.claims.submit
  - list of my claims also exists: store.claims.list (GET /v1/store/claims)
- **POST /v1/store/orders/{orderId}/claims/{claimId}/messages** — published differently → `store.claims.respondInfo` (`POST /v1/store/claims/{claimId}/info`)
  - free thread reply → answer to Packio's question only while status = need_info (409 claims.invalid_status otherwise)
  - path …/orders/{orderId}/claims/{claimId}/messages → /v1/store/claims/{claimId}/info
  - body → response (rename); fileIds → photoFileIds (rename)
  - Idempotency-Key → required on backend
  - response → StoreClaimDto (backend shape)
  - **gap (U-B0.1):** uncertain: a customer-facing message thread on claims (messages[] with author and files) — backend has only infoRequest/response; build only if the business wants a thread

#### `store.reorder` — mixed: 1 published differently · 1 implement here

Decisions: D-153

- **POST /v1/store/orders/{orderId}/actions/reorder** — published differently → `store.claims.reorder` (`POST /v1/store/orders/{orderId}/actions/reorder`)
  - Idempotency-Key → same
  - quantity (required) → quantity? (optional)
  - previewToken → missing-on-backend (409 reorder.repriced cannot happen; the cart reprice flow covers price changes)
  - extra-on-backend: reuseArtwork?: boolean
  - response {quoteId, cartItemId} → CartDto (with ETag); the new item carries quoteId, reorderOf {orderId, orderCode} and reusesApprovedArtwork
  - 409 → orders.reorder_unavailable | cart.item_exists; 422 pricing.not_instant
  - **gap (U-B0.1):** optional previewToken binding to the preview price once the preview GET exists
  - *note:* The FE note "quotation should carry the source order" is already served: CartItemDto.reorderOf + reusesApprovedArtwork. D-153.
  - *note:* D-205 (finding F1): today the reorder charges plates and die blocks again. U2.F (pre-launch, D-219) adds the tooling register and the waiver: reusable for 12 months from last use at the same factory for an unchanged spec, confirmed by the factory at PO acceptance. The preview below shows the waiver from U2.F's `toolingWaived` / `toolingWaiverReason`; U-B0.1 does not invent its own rule.
- **GET /v1/store/orders/{orderId}/reorder** — implement here
  - **scope (U-B0.1, `claims`):** Preview a reorder of my order at ?quantity: same spec re-priced at today's cost via the pricing engine (no invented formulas), reusable plate/die charges waived, proof skipped when artwork unchanged, min/max quantity, lead time and earliest ship date, a short-lived previewToken. Lives next to claims/reorder.service.ts. D-153.

#### `store.support` — implement here (U-B0.1)

Decisions: D-151, D-175

- **POST /v1/store/support/actions/contact** — implement here
  - **scope (U-B0.1, `conversations`):** Public (guest or customer), rate-limited (429 + Retry-After), Idempotency-Key: open a CS conversation/ticket from the contact form {name, phone|email, topic, orderCode?, message}; returns ticketNo, respondBy (SLA from settings / business hours D-175) and a LINE URL carrying only the ticket number.
  - *note:* No ticket model exists yet; conversations (D-151 chat with CS) is the nearest owner. No logging of phone/email (PDPA).
- **POST /v1/store/support/actions/handoff** — implement here
  - **scope (U-B0.1, `conversations`):** Public, rate-limited, Idempotency-Key: hand off the guided-help context {page, answers, recommended, note} to CS via LINE or callback; same SupportTicketDto response.

#### `store.guided-help` — implement here (U-B0.1)

- **POST /v1/store/guided-help/actions/recommend** — implement here
  - **scope (U-B0.1, `catalog`):** Public, rate-limited: map four answers (use, size, quantity band, priority) to catalogue box styles with a reason each and a from-unit-price from the pricing engine.
  - *note:* No D-### defines the answer → style rules; they must be admin-maintained catalogue data (never hard-coded or invented). Record the assumption in PROGRESS.

#### `store.sample-kits` — implement here (U-B0.1)

- **GET /v1/store/sample-kits** — implement here
  - **scope (U-B0.1, `catalog`):** Public list of admin-maintained sample kits (code, name, description, contents, image, price, creditedOnFirstOrder, leadDays, available).
  - *note:* No D-### covers sample kits; price and credit rule must be admin settings/catalogue data.
- **POST /v1/store/sample-kits/actions/request** — implement here
  - **scope (U-B0.1, `catalog`):** Public, rate-limited, Idempotency-Key: request a kit to an address; a paid kit creates a payable (payment link through the payments module) and, if the kit says so, a first-order credit (promotions/store credit) — money-moving, so event-driven ledger postings.
  - *note:* uncertain: owner module for the paid part (payments/checkout) and the accounting treatment — needs a decision before building.
  - *note:* D-192–D-197 (2026-09-30) cover **samples of a configured product** (the `sample` entity, sample credit against the bulk order, freight at the customer rate card). They do not cover **material / finish kits**, so kit prices and first-order crediting stay open (*Open questions* 5). Whether a kit is a kind of `sample` (D-192 "one sample path") is part of that question. D-195 and D-181 already rule out free kit freight unless a real promotion gives it.

#### `store.companies` — published differently

Decisions: D-120, D-121, D-122, D-123, D-124, D-125

- **POST /v1/store/companies** — published differently → `store.companies.apply` (`POST /v1/store/companies`)
  - legalName / taxId / isVatRegistered → same
  - headOffice {address: string} → headOffice: CompanyBranchInputDto {name, line1, line2?, postcode, provinceId, subdistrictId?, branchCode?, …} (structured address)
  - signatory {name, position} → missing-on-backend (only a signatory_id KYC document type)
  - contactPhone → missing-on-backend
  - documents[] → separate calls store.companies.addKycDocument (POST …/{companyId}/kyc-documents {docType, fileId, issuedOn?}) then store.companies.submitKyc
  - docType enum → backend adds other
  - extra-on-backend: tradeName, documentEmail, withholdsTax
  - Idempotency-Key → not declared on backend
  - response StoreCompanyDto → CompanyDto
  - 409 company.exists → 409 companies.tax_id_taken; 422 company.kyc_missing → 409 companies.kyc_incomplete (on submit-kyc); company.certificate_too_old → companies.certificate_too_old (raised in the KYC flow)
  - **gap (U-B0.1):** authorised signatory name and position (D-120 requires signatory details)
  - **gap (U-B0.1):** company contact phone
  - **gap (U-B0.1):** Idempotency-Key on apply
  - *note:* D-120, D-121.
- **GET /v1/store/me/company** — published differently → `store.companies.get` (`GET /v1/store/companies/{companyId}`)
  - singular /me/company → pick companyId from store.companies.listMine (GET /v1/store/companies), then GET /v1/store/companies/{companyId} (ETag)
  - id / companyCode (nullable on backend) / legalName / taxId / status / isVatRegistered / poNumberPolicy / orderApprovalThreshold → same names
  - myRoles → derive from members[] (CompanyMemberDto.roles for me) — not a field
  - can {manageMembers, manageSettings, approveOrders, viewFinance, order} → missing-on-backend
  - discountPct → missing-on-backend
  - credit {status, limitAmount, availableAmount, termDays, application} → store.companyCredit.get: CompanyCreditDto {creditStatus, limitAmount|null, availableAmount, termDays, exposureAmount, pendingRequest {limitAmount, termDays, requestedAt}}; also CompanyDto.creditStatus
  - credit.eligible / paidOrdersCount / paidOrdersNeeded / allowedTerms → missing-on-backend
  - receivables {openAmount, overdueAmount, oldestOverdueDays, nextDueAt, creditOrdersBlocked} → missing-on-backend
  - notices[] → missing-on-backend
  - kyc[] {docType, status, note, uploadedAt} → kycDocuments[] {id, docType, fileId, issuedOn, status, note} (+ missingKyc[])
  - statusNote → statusReason
  - extra-on-backend: tradeName, documentEmail, withholdsTax, branches[], members[], createdAt
  - **gap (U-B0.1):** my roles and a can{} capability map resolved server-side from company permissions
  - **gap (U-B0.1):** credit eligibility (paid orders count vs the D-121 threshold, allowed terms from settings)
  - **gap (U-B0.1):** receivables summary and D-122 notices (due soon, due today, overdue, credit blocked)
  - **gap (U-B0.1):** company discount % (D-124) if the web must show it
- **PATCH /v1/store/me/company** — published differently → `store.companies.updateSettings` (`PATCH /v1/store/companies/{companyId}`)
  - path /me/company → /companies/{companyId}
  - If-Match → required on backend (412 concurrency.stale, 428 concurrency.precondition_required)
  - orderApprovalThreshold / poNumberPolicy → same
  - extra-on-backend: tradeName, documentEmail, withholdsTax
  - response StoreCompanyDto → CompanyDto (ETag)

#### `store.company-members` — mixed: 3 published differently · 1 implement here

Decisions: D-123, D-125, D-140

- **GET /v1/store/me/company/members** — published differently → `store.companies.get` (`GET /v1/store/companies/{companyId}`)
  - separate list {data} → CompanyDto.members[]
  - id / roles / status / joinedAt → same
  - user {id, displayName, email, phone} → user: UserRefDto {id, displayName} (no email/phone)
  - **gap (U-B0.1):** member email/phone for the admin view, if the business accepts showing them to company admins (PDPA; decide)
- **POST /v1/store/me/company/members** — published differently → `store.companies.inviteMember` (`POST /v1/store/companies/{companyId}/members`)
  - path /me/company/members → /companies/{companyId}/members
  - name → missing-on-backend (invitee must be an existing customer account: 422 companies.account_not_found)
  - phone / email → same (either)
  - roles → same (CompanyRole enum)
  - response CompanyMemberDto → CompanyDto; 409 companies.already_member
  - invitee accepts via store.companies.acceptInvitation (POST /v1/store/company-invitations/{memberId}/actions/accept), listed by store.companies.listInvitations
  - *note:* Backend wins: "they join on their next sign-in" is an explicit accept.
- **DELETE /v1/store/me/company/members/{memberId}** — published differently → `store.companies.removeMember` (`POST /v1/store/companies/{companyId}/members/{memberId}/actions/remove`)
  - DELETE → POST …/actions/remove
  - response {removed} → CompanyDto
  - 409 company.last_admin → 409 companies.cannot_remove_self (an admin cannot remove themself, so the last admin always stays)
- **PATCH /v1/store/me/company/members/{memberId}** — implement here
  - **scope (U-B0.1, `companies`):** Company Admin changes a member's roles (CompanyRole[]); 409 company.last_admin when demoting the last admin; audit + event; revoke/grant company permissions. D-140, D-123.

#### `store.company-branches` — published differently

Decisions: D-125

- **GET /v1/store/me/company/branches** — published differently → `store.companies.get` (`GET /v1/store/companies/{companyId}`)
  - separate list → CompanyDto.branches[]
  - id / branchType / branchCode / name → same
  - address: string → line1, line2, postcode (structured; no province name in the view)
  - extra-on-backend: isDefault
  - **gap (U-B0.1):** province (and subdistrict) names on CompanyBranchDto so the address prints fully
- **POST /v1/store/me/company/branches** — published differently → `store.companies.addBranch` (`POST /v1/store/companies/{companyId}/branches`)
  - path → /companies/{companyId}/branches
  - branchCode (required) → branchCode? (optional)
  - name → same
  - address: string → line1, line2?, postcode, provinceId, subdistrictId? (structured)
  - extra-on-backend: branchType, isDefault
  - response CompanyBranchDto → CompanyDto; 409 companies.branch_exists
- **DELETE /v1/store/me/company/branches/{branchId}** — published differently → `store.companies.removeBranch` (`DELETE /v1/store/companies/{companyId}/branches/{branchId}`)
  - path → /companies/{companyId}/branches/{branchId}
  - response {removed} → CompanyDto (200)
  - 409 companies.head_office_required

#### `store.company-assets` — implement here (U-B0.1)

Decisions: D-125

- **GET /v1/store/me/company/brand-assets** — implement here
  - **scope (U-B0.1, `companies`):** List the company's shared brand assets (logo, guidelines, font, approved artwork) with file view (signed url), uploader and date; company members only; per companyId like the rest of the company API.
- **POST /v1/store/me/company/brand-assets** — implement here
  - **scope (U-B0.1, `companies`):** Add an uploaded file (presign already accepts companyId) as a brand asset {fileId, kind, name}; permission for who may add (admin/buyer — decide); audit.
- **DELETE /v1/store/me/company/brand-assets/{assetId}** — implement here
  - **scope (U-B0.1, `companies`):** Remove a brand asset (file retained if referenced); audit.

#### `store.company-approvals` — published differently

Decisions: D-123, D-060, D-125

- **GET /v1/store/me/company/approvals** — published differently → `store.companyApprovals.list` (`GET /v1/store/companies/{companyId}/approvals`)
  - path → /companies/{companyId}/approvals
  - query status (pending|decided) / page → missing-on-backend (plain array, pending for approvers)
  - envelope {data, meta} → plain array
  - id / poNumber / requestedAt → same
  - requestNo → groupCode (the order group code) + groupId
  - status {pending|approved|rejected|expired} → ApprovalStatus {pending|approved|rejected|withdrawn|expired}
  - requestedBy → requester (UserRefDto)
  - grossAmount → amount (+ currency)
  - threshold / branch / items[] / scheduleLabel / note / decidedBy / decidedAt / reason / orders[] / expiresAt → missing-on-backend (read the group via store.orders.getGroup)
  - **gap (U-B0.1):** status filter + pagination, decided history
  - **gap (U-B0.1):** threshold, decider, decidedAt, reason on the approval view; order lines summary (or rely on store.orders.getGroup)
- **POST /v1/store/me/company/approvals** — published differently → `store.checkout.place` (`POST /v1/store/checkout`)
  - separate "send for approval" → place the checkout normally with companyId (+ companyBranchId, poNumber); above the company threshold the group is created as OrderGroupStatus pending_company_approval and the approval opens (company-checkout.extension)
  - previewToken → the checkout preview/place contract of store.checkout.place
  - CheckoutPreviewDto.company.needsApproval → notices[] code company.approval_required {threshold}
  - po_required blocker → 422 companies.po_required
  - 409 company.approval_required on checkout → not used (backend wins)
  - response CompanyApprovalDto → the placed group (status pending_company_approval)
  - **gap (U-B0.1):** CheckoutPreviewDto company block (companyCode, legalName, poNumberPolicy, approvalThreshold, creditAvailableAmount, creditBlocked) if the web needs more than the notice
  - *note:* Backend wins on the model (D-123 "approver must approve before the order is placed" is implemented as a pending group).
- **POST /v1/store/me/company/approvals/{approvalId}/actions/approve** — published differently → `store.companyApprovals.decide` (`POST /v1/store/companies/{companyId}/approvals/{approvalId}/actions/{decision}`)
  - path → /companies/{companyId}/approvals/{approvalId}/actions/approve (decision path param = approve)
  - body → {comment?}
  - Idempotency-Key → not declared on backend
  - 409 approval.repriced → not raised; 409 approval.not_pending | iam.sod_conflict (requester cannot approve)
  - response → backend CompanyApprovalDto
  - **gap (U-B0.1):** Idempotency-Key on decide (approving starts the payment clock — irreversible)
- **POST /v1/store/me/company/approvals/{approvalId}/actions/reject** — published differently → `store.companyApprovals.decide` (`POST /v1/store/companies/{companyId}/approvals/{approvalId}/actions/{decision}`)
  - decision path param = reject
  - reason → comment (optional on backend; FE requires it)
  - rejection cancels the order group

#### `store.company-credit` — mixed: 1 implement here · 2 published differently

Decisions: D-121, D-122, D-125

- **POST /v1/store/me/company/credit-applications** — implement here
  - **scope (U-B0.1, `companies`):** Company Admin applies for a limit and term {requestedLimit, termDays ∈ allowed terms, basis paid_orders|financial_review, financialStatementFileIds?}; 409 company.not_eligible (< 3 paid orders without statements, D-121) / company.credit_pending; routes into the existing credit-limit approval (Finance ≤ THB 100,000, C-Level above) behind admin.companyCredit.requestLimit; Idempotency-Key; audit + event.
- **GET /v1/store/me/company/statements** — published differently → `store.documents.companyStatement` (`GET /v1/store/companies/{companyId}/statements`)
  - list of statements → one statement per required ?month= (no list)
  - id → same; period → month
  - openingBalance → opening; invoicedAmount → invoiced; paidAmount → paid; closingBalance → closing (renames)
  - extra-on-backend: credited, currency, pdfReady
  - dueAt / status (open|paid|overdue) / issuedAt / file → missing-on-backend (PDF via store.documents.companyStatementPdf)
  - aging {current, 1–30, 31–60, 61–90, >90} → missing-on-backend
  - receivables {…} → missing-on-backend
  - line-level detail → store.companyCredit.statement (GET /v1/store/companies/{companyId}/statement?month=) StatementDto
  - **gap (U-B0.1):** list of issued statements (month, due date, status)
  - **gap (U-B0.1):** aging buckets and receivables summary for the company (the receivables module has them for admin)
  - *note:* Two overlapping backend statement endpoints (…/statement vs …/statements) — worth consolidating.
- **POST /v1/store/me/company/statements/{statementId}/actions/download** — published differently → `store.documents.companyStatementPdf` (`GET /v1/store/companies/{companyId}/statements/{month}/pdf`)
  - POST …/{statementId}/actions/download → GET /v1/store/companies/{companyId}/statements/{month}/pdf (keyed by month)
  - SignedUrlDto → DownloadUrlDto {url, expiresAt}
  - 409 file.not_ready when the PDF is not rendered yet

#### `store.company-spend` — implement here (U-B0.1)

Decisions: D-125

- **GET /v1/store/me/company/spend** — implement here
  - **scope (U-B0.1, `companies`):** Company Admin/Accountant: sums of the company's orders over ?months by month, member, branch and product type, computed server-side with decimal.js (net vs gross must be stated); per companyId.

#### `store.company-reorder` — implement here (U-B0.1)

Decisions: D-153

- **POST /v1/store/me/company/bulk-reorders** — implement here
  - **scope (U-B0.1, `claims`):** Add the ok rows of a preview (previewToken) to the cart as reorder items via the existing reorder.service; Idempotency-Key; returns cartItemIds.
- **POST /v1/store/me/company/bulk-reorders/actions/preview** — implement here
  - **scope (U-B0.1, `claims`):** Validate CSV rows {line, orderCode, quantity} against the company's orders, re-price each (D-153) or refuse with a reason; totals and a short-lived previewToken. Company-scoped (company_orders.place).
  - *note:* Tooling waivers per row follow D-205 (U2.F), as in `store.reorder`.

### U-B0.2 — `admin.*` commerce & operations

#### `admin.orders` — published differently

Decisions: D-060, D-073, D-075, D-141, D-142, D-143, D-175

- **GET /v1/admin/order-groups/{groupId}** — published differently → `admin.orders.getGroup` (`GET /v1/admin/order-groups/{groupId}`)
  - groupCode, status, poNumber, channel, orders[] → same names
  - customer{id,customerCode,displayName,companyName} → customerId (uuid only; missing-on-backend ref)
  - placedBy{id,displayName} → placedById (uuid only)
  - grossAmount/netAmount/vatAmount/discountAmount/shippingAmount/currency (flat) → totals{grossAmount,netAmount,vatAmount,discountAmount,shippingNetAmount,cashAmount,whtAmount,currency} (nesting; shippingAmount → totals.shippingNetAmount rename)
  - instalments[] → not on group; read admin.paymentSchedules.get (GET /v1/admin/order-groups/{groupId}/payment-schedule): label → labelTh/labelEn, + pct, cashAmount, whtAmount, openAmount, paidAt, allocations
  - orders[] item → AdminOrderDto (see admin.orders.get mapping: quantity → quantityOrdered, productType{code,name} → productTypeCode, no customer/factory/urgency/slaDueAt/nextInstalment/hasSlipToReview)
  - extra-on-backend: ccEmails, csRemarks, cancelledAt, expiresAt, utm
  - **gap (U-B0.2):** customer ref (code, displayName, companyName) and placedBy displayName on the group, or the web resolves them via admin.customers.get
  - *note:* Backend owns the model: group totals live in `totals`.
- **GET /v1/admin/orders** — published differently → `admin.orderOperations.queue` (`GET /v1/admin/order-queues/{queue}`)
  - query queue → path param {queue} (required); enum awaiting_artwork → artwork_review, ready_to_produce → waiting_production, slip_review → no order queue (use admin.payments.slipQueue GET /v1/admin/slips), waiting_payment/due_soon/late same
  - extra-on-backend query withinDays (due_soon window)
  - query status/artworkStatus/channel/productType/factoryId/customerId/companyId/createdFrom/createdTo → missing-on-backend (admin.orders.listGroups GET /v1/admin/order-groups only filters status with the group enum cancelled|completed|in_progress|pending_company_approval|waiting_payment)
  - row id → orderId (rename); groupId, groupCode, orderCode, status, artworkStatus same
  - customer{...} → customerName (string only)
  - productType{code,name} → productTypeCode
  - createdAt → placedAt (rename)
  - promisedShipDate string → string:date (same meaning)
  - grossAmount same
  - extra-on-backend: groupExpiresAt
  - missing-on-backend: channel, currency, factory, hasSlipToReview, nextInstalment, quantity, unit, slaDueAt, urgency
  - **gap (U-B0.2):** A filterable all-orders list (status, artworkStatus, channel, productType, factoryId, customerId, companyId, createdFrom/To) for the customer and company screens — additive GET /v1/admin/orders in orders module
  - **gap (U-B0.2):** Row fields urgency and slaDueAt computed on the business calendar (D-175), nextInstalment, hasSlipToReview, quantity, customer ref, factory ref (D-141-masked)
  - *note:* Queue semantics per backend description: waiting_payment oldest first, artwork_review = uploaded/in review, waiting_production = paid not started. D-060, D-073.
- **GET /v1/admin/orders/{orderId}** — published differently → `admin.orders.get` (`GET /v1/admin/orders/{orderId}`)
  - id, orderCode, status, artworkStatus, designOption, mockupOption, cancelledAt, lines[] (lineNo, lineType, quantity, unitPrice, netAmount, vatAmount, grossAmount) same
  - quantity → quantityOrdered (rename)
  - productType{code,name} → productTypeCode
  - leadTimeDays integer → integer|null (nullability)
  - grossAmount/netAmount/vatAmount/discountAmount/shippingAmount/currency → totals{...} (nesting; shippingAmount → shippingNetAmount)
  - margin{buyCostNet,marginAmount,marginPct,belowMarginFloor} (omitted for roles) → internal{buyCostNet,marginAmount,marginPct,belowMarginFloor,selectedFactoryId} always present, values null when masked (D-141)
  - factory{id,code,name} → internal.selectedFactoryId only
  - tolerance{shortagePct,overagePct} → toleranceShortagePct/toleranceOveragePct (flat, nullable)
  - destinations[] flat address → destinations[].address{recipientName,phone,line1,line2,provinceId,provinceNameTh,districtNameTh,subdistrictId,subdistrictNameTh,postcode} (nesting; province → provinceNameTh) + shippingNetAmount
  - lines[].description → descriptionTh/descriptionEn; lines[].unit, waivedReason missing-on-backend; + id, discountAmount, vatRatePct, whtAmount, whtCategory
  - group{...}, groupId, groupCode, ccEmails, poNumber, csRemarks, channel, expiresAt → on the group (admin.orders.getGroup)
  - instalments[], nextInstalment → admin.paymentSchedules.get on the group
  - payments[] with slips → admin.payments.list (no orderId/groupId filter) / admin.payments.get
  - artwork{status,submissions,proofs} → admin.artwork.list (GET /v1/admin/orders/{orderId}/artwork-submissions) + admin.artwork.listProofs
  - jobs[] → admin.production.list?orderId=
  - shipments[] → admin.shipments.list?orderId=
  - documents[] → admin.customerDocuments.list?orderId=
  - claims[] → admin.claims.list?orderId=
  - createdAt → statusChangedAt/placedAt on group (no createdAt on order)
  - startMode → production job releaseMode (admin.production.get)
  - extra-on-backend: quoteId, statusChangedAt
  - **gap (U-B0.2):** nextActions (key, irreversible, disabledReason) — the web must not infer actions
  - **gap (U-B0.2):** urgency and slaDueAt on the business calendar
  - **gap (U-B0.2):** customer ref, taxProfile snapshot, specs[{label,value}], parts[] with per-part prices, confirmedProductionDate, cancelReason, hasSlipToReview
  - **gap (U-B0.2):** payments filter by order/group (admin.payments.list has none)
  - **gap (U-B0.2):** decide with the web whether to add a page-shaped aggregate endpoint or keep composing from the per-resource endpoints above
  - *note:* D-060, D-073, D-141, D-142. Backend DTO is intentionally lean; the aggregate would be additive (orders module).
- **GET /v1/admin/orders/{orderId}/timeline** — published differently → `admin.timeline.get` (`GET /v1/admin/orders/{orderId}/timeline`)
  - query cursor, limit; meta.nextCursor same
  - id same
  - at → occurredAt (rename)
  - kind → type (activity action or shipment.<status>) + source enum note|order|order_group|production_job|shipment
  - title/detail (rendered strings) → messageKey + params (i18n key the client renders) and body (note text)
  - visibility single enum → visibility[] array of customer|internal|partner
  - actor{id,displayName}|null → actor{type api_client|system|user|webhook, displayName|null} (always present; no id)
  - extra-on-backend: mentions[], photoFileIds[], shipment{id,shipmentNo,carrier,trackingNo}
  - **gap (U-B0.2):** promisedAt per entry for promised-vs-actual (D-075) — missing on backend
  - *note:* Backend timeline carries i18n keys, not rendered text; backend wins. D-143, D-075.

#### `admin.order-notes` — published differently

Decisions: D-143

- **GET /v1/admin/orders/{orderId}/notes** — published differently → `admin.orderOperations.listNotes` (`GET /v1/admin/orders/{orderId}/notes`)
  - data[].id, author{id,displayName}, body, createdAt same
  - data[].mentions[] UserRefDto → missing-on-backend (StaffTimelineEntryDto.mentions on admin.timeline.get carries them)
  - envelope {data} → {data, meta{page,perPage,total}} + query page/perPage/sort/order/q (extra-on-backend)
  - **gap (U-B0.2):** mentions[] {id,displayName} on OrderNoteDto
  - *note:* D-143
- **POST /v1/admin/orders/{orderId}/notes** — published differently → `admin.orderOperations.addNote` (`POST /v1/admin/orders/{orderId}/notes`)
  - body.body same (maxLength 4000)
  - body.mentions uuid[] required → optional (maxItems 20)
  - 201 OrderNoteDto id/author/body/createdAt same; mentions missing-on-backend
  - **gap (U-B0.2):** mentions in the 201 response
  - *note:* Mentioned staff are on the order.note_added event; notification via subscriber (D-143).

#### `admin.order-actions` — mixed: 3 implement here · 5 published differently

Decisions: D-060, D-061, D-073, D-143, D-176

- **GET /v1/admin/order-cancel-reasons** — implement here
  - **scope (U-B0.2, `orders`):** Read-only lookup over the seeded `order_cancel_reasons` table (code, localized name, requiresCreditNote, applies-to) for the cancel dialog; orders.service already validates reasonCode against it (D-060).
  - *note:* Table and seed exist (prisma commerce.prisma OrderCancelReason, reference-seed ORDER_CANCEL_REASONS); only the endpoint is missing.
- **POST /v1/admin/orders/{orderId}/actions/approve-slip** — published differently → `admin.payments.reviewSlip` (`POST /v1/admin/slips/{slipId}/actions/review`)
  - path orderId + body.slipId → path slipId
  - approve/reject are one op: body approve: true (required boolean)
  - body.note same (optional)
  - extra-on-backend body: bankTransRef (Finance records the bank transaction reference), receivedAmount
  - Idempotency-Key header same (required)
  - 200 OrderDetailDto → AdminPaymentDto (the payment with its slips)
  - *note:* Backend permission is `payments.verify_slip` (Finance) and the uploader cannot review their own slip (iam.sod_conflict); only slips that failed automatic verification reach review (D-061, D-176). The order screen must re-read the order after the call.
- **POST /v1/admin/orders/{orderId}/actions/cancel** — published differently → `admin.orders.cancel` (`POST /v1/admin/orders/{orderId}/actions/cancel`)
  - body.reasonCode same (required)
  - body.note string → string|null (optional)
  - Idempotency-Key header (FE required) → not declared on backend
  - 200 OrderDetailDto → AdminOrderDto (lean order, see admin.orders.get)
  - **gap (U-B0.2):** Idempotency-Key on cancel if the web wants replay safety (conventions: irreversible op) — backend currently relies on state checks (409)
  - *note:* Before production only; afterwards claims (B4.5). Group cancel is admin.orders.cancelGroup. D-060, D-142.
- **POST /v1/admin/orders/{orderId}/actions/record-slip** — published differently → `admin.payments.uploadSlip` (`POST /v1/admin/payments/{paymentId}/slips`)
  - path orderId + body.instalmentId → path paymentId: first create a bank_transfer_slip payment for the instalment(s) with admin.payments.initiate (POST /v1/admin/order-groups/{groupId}/payments, body { method, instalmentIds[] })
  - body.fileId, declaredAmount same
  - body.declaredTransferredAt → transferredAt (rename)
  - Idempotency-Key same (required)
  - 200 OrderDetailDto → 201 AdminPaymentDto
  - *note:* Same automatic checks as the customer's slip (D-061, D-176); recorded as uploaded by CS (`orders.manage`).
- **POST /v1/admin/orders/{orderId}/actions/reject-slip** — published differently → `admin.payments.reviewSlip` (`POST /v1/admin/slips/{slipId}/actions/review`)
  - path orderId + body.slipId → path slipId
  - body approve: false
  - body.reason (required) → note (optional on backend)
  - Idempotency-Key required on backend
  - 200 OrderDetailDto → AdminPaymentDto
  - *note:* Finance permission `payments.verify_slip` (D-061).
- **POST /v1/admin/orders/{orderId}/actions/send-payment-reminder** — implement here
  - **scope (U-B0.2, `payment-schedules`):** Manually (re)send the due/overdue instalment reminder for the order's group through the notification matrix (D-143: e-mail, LINE, SMS for instalment due) — emit a domain event, the notification is a subscriber; throttle repeat sends; 204.
  - *note:* No manual reminder endpoint exists (automatic reminders only in receivables/loyalty jobs).
- **POST /v1/admin/orders/{orderId}/actions/start-production** — published differently → `admin.production.startManually` (`POST /v1/admin/orders/{orderId}/actions/start-production`)
  - body.reason same (required)
  - Idempotency-Key (FE required) → not declared on backend
  - 200 OrderDetailDto → AdminJobDto (the released production job: jobNo, releaseMode manual_exception, releaseReason, milestones, …)
  - **gap (U-B0.2):** Idempotency-Key if required by the web
  - *note:* D-073 exception: never before payment; audited.
- **POST /v1/admin/orders/actions/send-payment-reminders** — implement here
  - **scope (U-B0.2, `payment-schedules`):** Bulk variant of the manual reminder over orderIds → { sent, skipped } (D-143 channels, event-driven notifications); Idempotency-Key recommended.

#### `admin.customers` — published differently

Decisions: D-092, D-161

- **GET /v1/admin/customers** — published differently → `admin.customers.list` (`GET /v1/admin/customers`)
  - query page/perPage/sort/order/q same
  - query customerType, createdVia → missing-on-backend
  - data[].id, displayName, email, phone, customerType, createdVia, createdAt same
  - data[].customerCode string → string|null
  - data[].companyName, ordersCount → missing-on-backend
  - extra-on-backend: firstName, lastName, status, lastLoginAt
  - **gap (U-B0.2):** filters customerType, createdVia
  - **gap (U-B0.2):** companyName and ordersCount on the row
- **POST /v1/admin/customers** — published differently → `admin.customers.findOrCreate` (`POST /v1/admin/customers`)
  - body displayName, email same
  - body phone required → optional (phone or e-mail to match)
  - body customerType required → optional
  - extra-on-backend body: firstName, lastName
  - 201 CustomerSummaryDto → 201 { created: true, customer: AdminCustomerDto } or 200 { created: false, customer } when an account matched (envelope)
  - *note:* Customer code issued by the API (series `customer`, D-092); publishes customer.registered via `cs`.
- **GET /v1/admin/customers/{customerId}** — published differently → `admin.customers.get` (`GET /v1/admin/customers/{customerId}`)
  - id, displayName, email, phone, customerType, createdVia, createdAt same; customerCode nullable on backend
  - addresses[] → admin.customers.listAddresses (GET …/addresses) with province/subdistrict objects
  - taxProfiles[] → admin.customers.listTaxProfiles (GET …/tax-profiles)
  - loyalty{tier,availablePoints,spend12m} → admin.loyalty.get (GET …/loyalty: tier, availablePoints, spend12m, pendingPoints, …)
  - birthDate, companyName, lastOrderAt, ordersCount, referralCode → missing-on-backend
  - extra-on-backend: firstName, lastName, status, lastLoginAt
  - **gap (U-B0.2):** ordersCount, lastOrderAt, companyName, referralCode, birthDate if the CS screen needs them
- **POST /v1/admin/customers/{customerId}/addresses** — published differently → `admin.customers.createAddress` (`POST /v1/admin/customers/{customerId}/addresses`)
  - body kind, label, recipientName, phone, line1, postcode, isDefault same
  - body line2 required-nullable → optional-nullable
  - body province (name) → provinceId (uuid, required)
  - body subdistrict/district (names) → subdistrictId (uuid|null); district derived
  - extra-on-backend body: lat, lng
  - 201 province string → province{id,nameTh,nameEn}; subdistrict string → subdistrict{id,nameTh,nameEn}; district missing
  - extra-on-backend: updatedAt, lat, lng
  - **gap (U-B0.2):** a postcode lookup that returns the uuids createAddress needs (see admin.geo)
  - *note:* Geography ids from D-161 master data.

#### `admin.geo` — published differently

Decisions: D-161

- **GET /v1/admin/geo/postcodes/{postcode}** — published differently → `store.catalog.lookupPostcode` (`GET /v1/store/catalog/geo/postcodes/{postcode}`)
  - path postcode same
  - {postcode, province, districts[{name, subdistricts[]}]} (nested) → flat array StorePostcodeAreaDto[] of {province{code,nameTh,nameEn}, district{code,nameTh,nameEn}, subdistrict{code,nameTh,nameEn,postcode}} (group client-side)
  - names → nameTh/nameEn + code (Accept-Language not used for the name)
  - empty array when unknown (not 404)
  - alternative: admin.geographySubdistricts.list (GET /v1/admin/geography/subdistricts?postcode=) returns id, districtId, code, nameTh, nameEn, postcode, paged
  - **gap (U-B0.2):** The store lookup returns codes, not the uuids admin.customers.createAddress needs (provinceId, subdistrictId); add ids to the lookup or an admin variant
  - *note:* D-161 geography.

#### `admin.cs-calculators` — published differently

Decisions: D-012, D-043, D-051, D-052, D-100, D-141

- **POST /v1/admin/cs/{type}/calculate** — published differently → `admin.csFolding.calculate` (`POST /v1/admin/cs/folding/calculate`), `admin.csCorrugate.calculate` (`POST /v1/admin/cs/corrugate/calculate`, since `v0.3.0`)
  - path {type} → fixed path per calculator: `folding`, and `corrugate` since `v0.3.0` (body CsCorrugateConfigurationDto: patternId, materialId (board), difficultyLevelId, l, w, d, parts[{subPatternId?, printFront/printBack, coatingFrontId/BackId, assemblies[CorrugateAssemblyDto]}], digitalFrontCoveragePct? (staff only), design, quantities)
  - body {customerId?, postcode, quantities, input: oneOf[7] discriminated by `calculator`} → folding configuration at the top level: patternId, materialId, difficultyLevelId (uuids), l, w, d (mm, required), c, x, grainParallel dl|dw, catalogProductId, design{graphic,structure}, parts[{subPatternId, printFront[{inkColourId,percent}], printBack[], finish1FrontId, finish1BackId, finish2[{finishId,amount,l[],w[]}], diecutTypeId, assemblies[]}] (codes/names → uuids)
  - body.postcode → query deliveryPostcode (optional)
  - body.customerId → missing-on-backend (not needed to price)
  - quantities[] integer → number
  - 200 CsCalculationDto → AdminQuoteCalculationDto { calculatorVersion, steps[] (per quantity: unitPrice, productAmount, designFeeAmount, structureDesignFeeAmount, shippingAmount/Net/Vat, vatAmount, grossAmount, leadTimeDays, earliestShipDate, earliestDeliveryDate, tolerance pcts, instant, reason, shippingPending(+Reason), internal{factoryId, printTypeId, priceListVersionId, productionRun, buyPrice, marginPct, belowMarginFloor, parts[], shipping}), options[{optionKey, error}] }
  - results[] factory × print type grid with cheapest/fastest flags → backend picks one factory/print type per quantity (internal.factoryId/printTypeId); no cheapest/fastest, no perPieceWithDelivery; the plate/die-block split is steps[].toolingAmount since `v0.3.0` (corrugate flexo; 0.00 for folding)
  - calculationId, validUntil → none: save with admin.quotes.create (configuration re-priced, D-051 validity)
  - routeToRfq → steps[].instant=false with reason
  - marginPct → steps[].internal.marginPct (null without margin.read, D-141)
  - **gap (U-B0.2):** The five other calculators (label, tag_sleeve, pouch, standard_product, service) — U-B6 work, one per session, ported with golden tests, not invented. Corrugate (with combine parts) shipped in `v0.3.0`
  - **gap (U-B0.2):** If the multi-factory comparison grid is required: per-factory × print-type results with API-computed cheapest/fastest (D-043/D-100) — confirm against the legacy CS calculator
  - *note:* Published: folding (B2.3) and corrugate (U-B6, `v0.3.0`). Not published: label, tag_sleeve, pouch, standard_product, service (U-B6). D-100, D-043, D-051, D-012, D-141.
- **GET /v1/admin/cs/{type}/input-data** — published differently → `admin.csFolding.inputData` (`GET /v1/admin/cs/folding/input-data`), `admin.csCorrugate.inputData` (`GET /v1/admin/cs/corrugate/input-data`, since `v0.3.0`)
  - path {type} → fixed path per calculator: `folding`, and `corrugate` since `v0.3.0` (CorrugateInputDataDto: patterns with flutes, boards, coatings, inkColours, assemblies, difficultyLevels, printAreas); the other five types are not published (U-B6)
  - type field → implied by path
  - patterns[].code, name, subPatterns[].name same; + id, geometryFormula, subPatterns[].id/seq; subPatterns[].code missing
  - patterns[].constraints, standardSizes → missing-on-backend
  - options (named lists map) → typed lists materials[], inkColours[], finishes[] (slot finish1|finish2), diecutTypes[], assemblies[], difficultyLevels[] (id, code, nameTh/nameEn)
  - factories[], printTypes[] → missing-on-backend (the API selects the factory, D-043)
  - quantityPresets → missing-on-backend
  - discountPolicy.directLimitPct → missing-on-backend
  - **gap (U-B0.2):** discountPolicy.directLimitPct from setting `discounts.cs_limit_pct` (D-052) so the UI does not hard-code 5 %
  - **gap (U-B0.2):** pattern size constraints and standard sizes
  - **gap (U-B0.2):** quantity presets
  - **gap (U-B0.2):** input data for the five calculators not yet ported (U-B6); corrugate shipped in `v0.3.0`
  - *note:* Folding (B2.3) and corrugate (`v0.3.0`) are published; the gaps above apply to both.

#### `admin.quotations` — published differently

Decisions: D-010, D-051, D-052, D-092

- **GET /v1/admin/quotations** — published differently → `admin.quotes.list` (`GET /v1/admin/quotes`)
  - path /quotations → /quotes
  - query page/perPage/sort/order/q/status/customerId same (status enum calculated|converted|expired|saved|shared|superseded same)
  - query channel → missing-on-backend
  - data[].id, quoteCode (nullable on backend), status, source, channel, validUntil, createdAt, customer{id,displayName}, createdBy{id,displayName} (non-null on backend) same
  - currency const THB → enum ['THB']
  - productType{code,name} → productTypeCode
  - quantities[] → options[].quantity
  - grossAmount → options[].grossAmount per quantity
  - customer.customerCode/companyName, rfq{id,rfqCode} → missing-on-backend
  - extra-on-backend: configuration, options[] (full prices + internal), deliveryPostcode, pdfStatus, priceLocked, sharedAt
  - **gap (U-B0.2):** channel filter
  - **gap (U-B0.2):** rfq ref for source=rfq
  - **gap (U-B0.2):** customer code on the row
  - *note:* D-051, D-010.
- **POST /v1/admin/quotations** — published differently → `admin.quotes.create` (`POST /v1/admin/quotes`)
  - path /quotations → /quotes
  - body {calculationId, resultId} → {productTypeCode, configuration (the same calculator configuration as admin.csFolding.calculate / admin.csCorrugate.calculate — `anyOf` since `v0.3.0`), deliveryPostcode?} — the server re-prices; no calculation id
  - body.customerId → customerUserId (optional)
  - body.discountPct, discountMemoId → not on the quotation: admin.checkout.place body csDiscountPct (≤ discounts.cs_limit_pct) / discountMemoId (D-052)
  - body.note → missing-on-backend
  - 201 QuotationDetailDto → AdminQuoteDto: options[] quantity/unitPrice/netAmount/vatAmount/grossAmount same, earliestShipDate string → date|null, leadTimeDays nullable, discountAmount missing; discount, nextActions, pdf{file}, specs[], rfq, productType → missing (pdfStatus, productTypeCode instead)
  - **gap (U-B0.2):** specs[{label,value}] rendered by the API
  - **gap (U-B0.2):** nextActions
  - **gap (U-B0.2):** note on the quotation
  - **gap (U-B0.2):** options[].toolingAmount on AdminQuoteDto — admin.csCorrugate.calculate returns it per step (`v0.3.0`), but the saved option drops it (as `store.quotes`)
  - *note:* Backend wins: discount belongs to the checkout, not the quotation.
- **GET /v1/admin/quotations/{quoteId}** — published differently → `admin.quotes.get` (`GET /v1/admin/quotes/{quoteId}`)
  - path /quotations → /quotes; quoteId same
  - same field mapping as create (AdminQuoteDto)
  - pdf FileRef → pdfStatus none|pending|ready + admin.quotes.getPdf
  - discount{pct,memo} → none on the quote (memo via admin.discountMemos.*)
  - **gap (U-B0.2):** specs, nextActions, rfq ref
  - **gap (U-B0.2):** options[].toolingAmount on AdminQuoteDto — admin.csCorrugate.calculate returns it per step (`v0.3.0`), but the saved option drops it (as `store.quotes`)
- **POST /v1/admin/quotations/{quoteId}/actions/export-pdf** — published differently → `admin.quotes.requestPdf` (`POST /v1/admin/quotes/{quoteId}/actions/request-pdf`)
  - export-pdf → request-pdf (issues the QT number, renders in background) → 202 AdminQuoteDto
  - {url, expiresAt} → poll admin.quotes.getPdf (GET /v1/admin/quotes/{quoteId}/pdf) → {status none|pending|ready, url|null, expiresAt|null}
  - *note:* Async render; D-010/D-092 numbering; issuer data from settings.

#### `admin.discount-memos` — published differently

Decisions: D-052, D-124, D-141, D-162

- **GET /v1/admin/discount-memos** — published differently → `admin.discountMemos.list` (`GET /v1/admin/discount-memos`)
  - query page/perPage/sort/order/q/status same (status enum same)
  - query requestedBy → missing-on-backend; extra-on-backend customerId
  - data[] same: id, status, customer{id,displayName}, requestedBy, orderValue, requestedPct, requestedAmount, approvedPct, belowMarginFloor, reason, validUntil, createdAt
  - approvalRequestId → approvalId (rename)
  - resultingMarginPct optional → required-nullable (null without margin rights, D-141)
  - memoCode → missing-on-backend
  - evidence FileRef[] → missing-on-backend
  - customer.customerCode/companyName missing
  - extra-on-backend: scope order|company, companyId, appliedGroupCode
  - **gap (U-B0.2):** memoCode (document number) if the UI shows one
  - **gap (U-B0.2):** evidence file refs on the DTO
  - **gap (U-B0.2):** requestedBy filter
- **POST /v1/admin/discount-memos** — published differently → `admin.discountMemos.raise` (`POST /v1/admin/discount-memos`)
  - body customerId, requestedPct, reason same
  - body evidenceFileIds required → optional
  - body calculationId, resultId → missing-on-backend: the memo prices the customer's CS cart now (admin.cart.*), valid until the cart's price lock
  - 201 DiscountMemoDto → same DTO as list (approvalId, no memoCode/evidence)
  - *note:* Routed to the matching tier only (D-052, D-162); used once at checkout via discountMemoId. Company-level memos: admin.discountMemos.raiseForCompany (D-124).
- **GET /v1/admin/discount-memos/{memoId}** — published differently → `admin.discountMemos.get` (`GET /v1/admin/discount-memos/{memoId}`)
  - same as list row mapping (approvalRequestId → approvalId; memoCode, evidence missing)
  - **gap (U-B0.2):** memoCode, evidence
  - *note:* Extra op on backend: admin.discountMemos.withdraw.

#### `admin.cs-create-order` — published differently

Decisions: D-051, D-052, D-060, D-142, D-174

- **POST /v1/admin/orders** — published differently → `admin.checkout.place` (`POST /v1/admin/customers/{customerId}/checkout`)
  - path /v1/admin/orders → /v1/admin/customers/{customerId}/checkout; body.customerId → path customerId
  - body quoteId + quantity → admin.cart.addItem (POST /v1/admin/customers/{customerId}/cart/items, If-Match) body quoteId + quoteOptionId (the option for that quantity)
  - body designOption, mockupOption, destinations[{addressId,quantity}] → admin.cart.addItem body (same names; also designDocumentId, designNote) or admin.cart.setDestinations
  - body taxProfileId, poNumber, ccEmails (optional on backend), csRemarks → checkout body (same names)
  - extra-on-backend checkout body: csDiscountPct, discountMemoId, expectedGrossAmount (guards checkout.total_changed), companyId, companyBranchId, paymentSchedule override, redeemPoints, utm
  - Idempotency-Key same (replay returns the same group)
  - 201 {groupId, groupCode, orders[{id, orderCode}]} → AdminOrderGroupDto: groupId → id (rename); groupCode, orders[].id, orders[].orderCode same; + totals, status, …
  - preview first: admin.checkout.preview
  - *note:* Backend wins: one flow for store and CS (cart → checkout). D-051, D-060, D-142, D-174.
  - *note:* D-192: the cart item's `mockupOption` stays as mapped until U2.F. U2.F turns the mockup into a `sample` attached to the order and deprecates the CS "add mockup" endpoints additively; they are removed in U-B5.

#### `admin.rfqs` — published differently

Decisions: D-043, D-051, D-100, D-102, D-141

- **GET /v1/admin/rfqs** — published differently → `admin.rfqs.list` (`GET /v1/admin/rfqs`)
  - query page/perPage/sort/order/q/status same (status enum same)
  - query assigneeId → assignedToId (rename)
  - query queue (new|mine|need_info|awaiting_factory|quoted|overdue) → partly: status=submitted (new), assignedToId=<me> (mine), status=need_info, status=quoted, overdue=true; awaiting_factory missing
  - query productType, channel, submittedFrom, submittedTo → missing-on-backend
  - data[].id, rfqCode, status, channel, customer{id,displayName}, quantities (integer → number), submittedAt, firstResponseAt, slaDueAt same
  - data[].targetDate string → string:date
  - data[].assignee|null → assignedTo (rename)
  - data[].productType{code,name} → productTypeCode + productTypeName
  - data[].dimensions{lengthMm,widthMm,heightMm} (integer) → lengthMm/widthMm/heightMm top-level (number|null)
  - data[].consultationCounts{requested,responded} → derive from consultations[] (status)
  - data[].latestQuote → derive from quotations[] (versionNo, status, validUntil)
  - data[].urgency → overdue boolean
  - data[].slaTargetHours, province, routedFromCalculator, customer.customerCode/companyName → missing-on-backend
  - extra-on-backend: acceptedQuoteId, declineReasonCode, closedAt, deliveryPostcode, notes, spec map, messages[], consultations[], quotations[] (heavy rows)
  - **gap (U-B0.2):** queue filter incl. awaiting_factory; productType, channel, submitted date range filters
  - **gap (U-B0.2):** slaTargetHours (per-category setting), urgency on the business calendar, routedFromCalculator
  - *note:* D-100, D-043, D-102.
- **GET /v1/admin/rfqs/{rfqId}** — published differently → `admin.rfqs.get` (`GET /v1/admin/rfqs/{rfqId}`)
  - same base mapping as the list row
  - spec [{label,value}] rendered by the API → spec raw object map (+ specSchemaVersion missing)
  - quotes[] (RfqQuoteDto) → quotations[] {id, versionNo, status, validUntil|null, sentAt, note, lines[{quantity, unitPrice, leadTimeDays, netAmount, vatAmount, grossAmount, shippingNetAmount, belowMarginFloor, factoryId, buyUnitPrice|null, marginPct|null}]}; customerNote → note; createdAt, createdBy, acceptedAt, currency, lines[].suggestedUnitPrice, lines[].consultationId, lines[].factory{...} missing
  - consultations[]: factory{id,code,name} → factoryId + factoryCode; requestedAt, requestedBy, tier, declineNote missing; response{leadTimeDays,tiers[],notes} → lines[]{quantity,buyUnitPrice,leadTimeDays} + responseNote + respondedAt; note nullable → string
  - declineReason{code,name} → declineReasonCode (code only), declineNote missing
  - acceptedQuotation{id,quoteCode,versionNo,quantity} → acceptedQuoteId
  - messages[] present (FE reads them from …/messages)
  - missing-on-backend: files[], contact{email,phone}, events[], nextActions[], quoteDefaults.validUntil, routedFrom, routedFromCalculator, slaTargetHours, urgency, province
  - **gap (U-B0.2):** files (FileRef[]) of the request
  - **gap (U-B0.2):** customer contact
  - **gap (U-B0.2):** events (or use a timeline)
  - **gap (U-B0.2):** nextActions
  - **gap (U-B0.2):** quoteDefaults.validUntil from `quotes.validity_days` (D-051)
  - **gap (U-B0.2):** spec rendered as label/value from the category rfqSpecSchema
  - **gap (U-B0.2):** consultation tier (D-043) and requestedBy
  - **gap (U-B0.2):** suggestedUnitPrice per quote line
  - *note:* D-100, D-043, D-051, D-141 (buyUnitPrice/marginPct null without rights).

#### `admin.rfq-messages` — published differently

Decisions: D-100

- **GET /v1/admin/rfqs/{rfqId}/messages** — published differently → `admin.rfqs.get` (`GET /v1/admin/rfqs/{rfqId}`)
  - {data: RfqMessageDto[]} → AdminRfqDto.messages[] (inline)
  - id, body, visibility (customer|internal), createdAt same
  - authorKind customer|staff → author customer|packio (enum values)
  - author{id,displayName}|null → authorUser{id,displayName}
  - files[] → missing-on-backend
  - **gap (U-B0.2):** message attachments (files)
  - *note:* No dedicated list endpoint; the detail carries the thread.
- **POST /v1/admin/rfqs/{rfqId}/messages** — published differently → `admin.rfqs.postMessage` (`POST /v1/admin/rfqs/{rfqId}/messages`)
  - body.body, visibility same
  - body.fileIds → missing-on-backend
  - 201 RfqMessageDto → 201 AdminRfqDto (the whole request; the new message is in messages[])
  - **gap (U-B0.2):** fileIds attachments
  - *note:* First customer-visible message records firstResponseAt (D-100).

#### `admin.rfq-actions` — mixed: 3 published differently · 1 implement here

Decisions: D-100, D-102

- **POST /v1/admin/rfqs/{rfqId}/actions/assign** — published differently → `admin.rfqs.assign` (`POST /v1/admin/rfqs/{rfqId}/actions/assign`)
  - body.assigneeId (uuid|null) → userId (uuid, required; no unassign)
  - 200 RfqDetailDto → AdminRfqDto
  - **gap (U-B0.2):** unassign (null) if needed
  - *note:* A submitted request moves to in_review on assign (D-100).
- **POST /v1/admin/rfqs/{rfqId}/actions/decline** — published differently → `admin.rfqs.decline` (`POST /v1/admin/rfqs/{rfqId}/actions/decline`)
  - body.reasonCode, note same
  - Idempotency-Key (FE required) → not declared on backend
  - 200 RfqDetailDto → AdminRfqDto
  - **gap (U-B0.2):** Idempotency-Key if the web relies on it (request text says decline is idempotent)
  - *note:* Unmet-demand reason code (D-102).
- **POST /v1/admin/rfqs/{rfqId}/actions/request-info** — published differently → `admin.rfqs.requestInfo` (`POST /v1/admin/rfqs/{rfqId}/actions/request-info`)
  - body.message → body (rename)
  - 200 RfqDetailDto → AdminRfqDto
  - *note:* → need_info.
- **POST /v1/admin/rfqs/{rfqId}/actions/start-review** — implement here
  - **scope (U-B0.2, `rfq`):** Explicit submitted → in_review transition without assigning (audit + outbox event); 409 rfq.invalid_state otherwise (D-100). Alternatively the web uses assign, which already performs the transition.
  - *note:* Low value: assign/consultation already transition.

#### `admin.unmet-demand-reasons` — implement here (U-B0.2)

Decisions: D-102

- **GET /v1/admin/unmet-demand-reasons** — implement here
  - **scope (U-B0.2, `rfq`):** Read-only lookup {data:[{code,name}]} localized by Accept-Language over the seeded unmet_demand_reasons (prisma/seed data/quotes UNMET_DEMAND_REASONS), for the decline dialog (D-102).

#### `admin.rfq-consultations` — mixed: 2 implement here · 1 published differently

Decisions: D-043, D-044, D-100, D-141, D-142, D-143, D-155

- **GET /v1/admin/rfqs/{rfqId}/candidate-factories** — implement here
  - **scope (U-B0.2, `rfq`):** Candidate factories for the RFQ's category: factory ref, participation tier (D-043), capable + reason from capabilities, alreadyConsulted, onTimeRatePct from the scorecard (D-155); staff only, no prices.
  - *note:* Capabilities exist per factory (admin.factories.listCapabilities) but no per-RFQ candidate view.
- **POST /v1/admin/rfqs/{rfqId}/consultations** — published differently → `admin.rfqs.requestConsultation` (`POST /v1/admin/rfqs/{rfqId}/consultations`)
  - body.factoryIds[] → factoryId (one factory per call; one open request per factory)
  - body.dueAt, note same
  - Idempotency-Key (FE required) → not declared on backend
  - 201 {data: RfqConsultationDto[]} → 201 AdminRfqDto (consultations[] inline: id, factoryId, factoryCode, status requested|responded|declined|expired, dueAt, note, respondedAt, responseNote, lines[{quantity,buyUnitPrice,leadTimeDays}])
  - **gap (U-B0.2):** multi-factory request in one call (or the web loops)
  - **gap (U-B0.2):** suggestedUnitPrice (sell, from the sell-margin table) per response line
  - *note:* Factory sees spec, tiers, target date and province only — never customer or sell price (D-044, D-142). buyUnitPrice only for D-141 roles.
- **POST /v1/admin/rfqs/{rfqId}/consultations/{consultationId}/actions/remind** — implement here
  - **scope (U-B0.2, `rfq`):** Re-notify the factory of an open consultation (domain event → partner notification subscriber, D-143); throttled; 204.

#### `admin.rfq-quotes` — mixed: 3 published differently · 2 implement here

Decisions: D-012, D-051, D-100, D-141

- **POST /v1/admin/rfqs/{rfqId}/quotes** — published differently → `admin.rfqs.draftQuotation` (`POST /v1/admin/rfqs/{rfqId}/quotations`)
  - path …/quotes → …/quotations
  - body.lines[].quantity, unitPrice, leadTimeDays same
  - body.lines[].consultationId → factoryId + buyUnitPrice (explicit, optional)
  - extra-on-backend lines[].shippingNetAmount
  - body.customerNote → note
  - body.validUntil → missing-on-backend: validity comes from `quotes.validity_days` at send (D-051)
  - 201 RfqQuoteDto → 201 AdminRfqDto (the draft is in quotations[]: id, versionNo, status, validUntil|null, sentAt, note, lines[{netAmount,vatAmount,grossAmount,shippingNetAmount,belowMarginFloor,factoryId,buyUnitPrice,marginPct}])
  - lines[].suggestedUnitPrice, factory{...}, createdBy, createdAt, acceptedAt, currency → missing-on-backend
  - **gap (U-B0.2):** suggestedUnitPrice per line (sell-margin table)
  - **gap (U-B0.2):** D-141 rule 'CS sees marginPct only on a line priced under the suggestion' — backend returns marginPct by margin.read only
  - *note:* One draft at a time; margin-floor flag from buy price (D-012).
- **DELETE /v1/admin/rfqs/{rfqId}/quotes/{quoteId}** — published differently → `admin.rfqs.discardQuotation` (`POST /v1/admin/rfq-quotations/{rfqQuoteId}/actions/discard`)
  - DELETE …/rfqs/{rfqId}/quotes/{quoteId} → POST /v1/admin/rfq-quotations/{rfqQuoteId}/actions/discard (path + method; param quoteId → rfqQuoteId)
  - 204 → 200 AdminRfqDto
  - *note:* Drafts only (D-100).
- **PUT /v1/admin/rfqs/{rfqId}/quotes/{quoteId}** — implement here
  - **scope (U-B0.2, `rfq`):** Replace the lines/note of the single draft RFQ quotation (re-priced by the API, belowMarginFloor, D-012/D-141), If-Match guarded; alternatively discard + draft again.
- **POST /v1/admin/rfqs/{rfqId}/quotes/{quoteId}/actions/record-acceptance** — implement here
  - **scope (U-B0.2, `rfq`):** CS records the customer's acceptance (phone, LINE) of one quantity of a sent RFQ quotation → creates the saved quotation (quotes.source = rfq) CS then puts in the cart; mirrors the customer accept path (rfqs.service accept); Idempotency-Key; audit + event.
  - *note:* Only the customer-side accept exists today.
- **POST /v1/admin/rfqs/{rfqId}/quotes/{quoteId}/actions/send** — published differently → `admin.rfqs.sendQuotation` (`POST /v1/admin/rfq-quotations/{rfqQuoteId}/actions/send`)
  - path → /v1/admin/rfq-quotations/{rfqQuoteId}/actions/send (param quoteId → rfqQuoteId; no rfqId)
  - Idempotency-Key (FE required) → not declared on backend
  - 200 RfqDetailDto → AdminRfqDto
  - **gap (U-B0.2):** Idempotency-Key if required
  - *note:* Validity `quotes.validity_days` (D-051); supersedes the previous quotation; RFQ → quoted.

#### `admin.prepress` — published differently

Decisions: D-070, D-071, D-072, D-141, D-175

- **GET /v1/admin/prepress** — published differently → `admin.artwork.queue` (`GET /v1/admin/prepress/queue`)
  - path /prepress → /prepress/queue
  - query queue (preflight|proof|awaiting_customer|changes_requested|template|design|mockup) → kind (submissions|proofs_waiting|changes_requested); template, design, mockup, proof stages missing (design queue: admin.designServices.list)
  - query artworkStatus, productType, assigneeId → missing-on-backend
  - data[].orderId, orderCode same
  - data[].stage → kind
  - data[].slaDueAt → dueAt (artwork.prepress_sla_business_hours, D-175; null when no SLA)
  - data[].urgency → overdue boolean
  - data[].latestSubmission{versionNo,preflightStatus,submittedAt} → flat versionNo, preflightStatus, since
  - extra-on-backend: itemId
  - missing-on-backend: artworkStatus, assignee, customer, productType, latestProof, design{roundNo,freeRounds,status}, mockup, updatedAt
  - **gap (U-B0.2):** stages template/design/mockup/proof in one queue (or the web merges admin.designServices.list)
  - **gap (U-B0.2):** assignee (prepress ownership) and assigneeId filter
  - **gap (U-B0.2):** customer and productType refs, artworkStatus filter
  - *note:* D-070, D-175.
- **GET /v1/admin/prepress/{orderId}** — published differently → `admin.artwork.list` (`GET /v1/admin/orders/{orderId}/artwork-submissions`)
  - PrepressDetailDto (one aggregate) → compose: admin.artwork.list (submissions newest first with preflightReport, D-070), admin.artwork.listProofs + admin.artwork.getProof (proof, annotations, compare), admin.artwork.listTemplates (template deliveries), admin.designServices.list/get (rounds, D-071), admin.designs.get (design document), admin.orders.get (order status, design/mockup options)
  - ArtworkSubmissionDetailDto.findings per-check severity → preflightReport (ArtworkSubmissionDto)
  - drawingJobs[] → no list endpoint (only POST /v1/admin/orders/{orderId}/drawings answer)
  - dieline size → template delivery / drawing job lengthMm, widthMm, heightMm
  - **gap (U-B0.2):** nextActions per submission and per workspace
  - **gap (U-B0.2):** assignee
  - **gap (U-B0.2):** drawing-jobs list per order
  - mockup job ref (D-072) → no longer a U-B0.2 gap: D-192 replaces the mockup with the `sample` entity, and its reference on the prepress workspace comes with U2.F (finding F4, pre-launch). Re-triaged 2026-09-30
  - **gap (U-B0.2):** decide: add a page-shaped workspace endpoint (artwork module) or compose client-side
  - *note:* No cost or margin on any of these (D-141). D-070, D-071, D-072.

#### `admin.prepress-actions` — mixed: 1 implement here · 2 published differently

Decisions: D-070

- **POST /v1/admin/prepress/{orderId}/actions/assign** — implement here
  - **scope (U-B0.2, `artwork`):** Assign/unassign the prepress owner of an order's artwork (assigneeId|null), audited + event; feeds the queue's assignee filter. admin.designServices.assign covers design services only.
- **POST /v1/admin/prepress/submissions/{submissionId}/actions/accept** — published differently → `admin.artwork.accept` (`POST /v1/admin/artwork-submissions/{submissionId}/actions/accept`)
  - path /prepress/submissions/{id} → /artwork-submissions/{id}
  - body.note → missing-on-backend (no body)
  - 200 PrepressDetailDto → ArtworkSubmissionDto (id, orderId, orderCode, channel, files[], note, preflightStatus, preflightReport, preflightCompletedAt, …)
  - 409 preflight.blocking_findings → 409 artwork.preflight_blocked (also artwork.preflight_pending, artwork.invalid_status, artwork.not_accepting)
  - **gap (U-B0.2):** optional acknowledgement note
  - *note:* Order artwork status → in_review.
- **POST /v1/admin/prepress/submissions/{submissionId}/actions/reject** — published differently → `admin.artwork.reject` (`POST /v1/admin/artwork-submissions/{submissionId}/actions/reject`)
  - path /prepress/submissions/{id} → /artwork-submissions/{id}
  - body.reason same
  - 200 PrepressDetailDto → ArtworkSubmissionDto
  - *note:* Order artwork status → changes_requested (D-070).

#### `admin.prepress-proofs` — published differently

Decisions: D-070

- **POST /v1/admin/prepress/{orderId}/proofs** — published differently → `admin.artwork.sendProof` (`POST /v1/admin/orders/{orderId}/proofs`)
  - path /prepress/{orderId}/proofs → /orders/{orderId}/proofs
  - body proofFileId, dielineFileId same
  - body submissionId required → optional (defaults to the latest accepted submission)
  - body.note → changeNote (rename)
  - Idempotency-Key (FE required) → not declared on backend
  - 201 PrepressDetailDto → 201 ProofDto (id, versionNo, status, proofFile, dielineFileId, changeNote, annotations[], compare{previous…}, decision fields)
  - **gap (U-B0.2):** Idempotency-Key if required (request says create is idempotent)
  - *note:* Supersedes the waiting proof; artwork status → proof_sent (D-070).
- **GET /v1/admin/prepress/proofs/{proofId}/annotations** — published differently → `admin.artwork.getProof` (`GET /v1/admin/proofs/{proofId}`)
  - {data: ProofAnnotationDto[]} → ProofDto.annotations[] (inline)
  - id, parentId, page, kind pin|rect|draw, geometry map, comment, resolvedAt same (dates as plain string on backend)
  - authorKind + author{id,displayName} → author{kind customer|staff, displayName} (no id)
  - resolvedBy → missing-on-backend
  - **gap (U-B0.2):** resolvedBy on annotations
- **POST /v1/admin/prepress/proofs/{proofId}/annotations** — published differently → `admin.artwork.annotate` (`POST /v1/admin/proofs/{proofId}/annotations`)
  - path /prepress/proofs/{id}/annotations → /proofs/{id}/annotations
  - body.comment same
  - body.parentId required → optional nullable
  - extra-on-backend required: kind, page, geometry (a reply must repeat them)
  - 201 ProofAnnotationDto → 201 ProofDto (whole proof with annotations[])
  - **gap (U-B0.2):** reply without geometry (inherit from parent) — or the web copies the parent's kind/page/geometry
- **POST /v1/admin/prepress/proofs/{proofId}/annotations/{annotationId}/actions/resolve** — published differently → `admin.artwork.resolveAnnotation` (`POST /v1/admin/proof-annotations/{annotationId}/actions/resolve`)
  - path → /v1/admin/proof-annotations/{annotationId}/actions/resolve (no proofId)
  - 200 ProofAnnotationDto → 200 ProofDto

#### `admin.prepress-template` — published differently

Decisions: D-070

- **POST /v1/admin/prepress/{orderId}/actions/send-template** — published differently → `admin.artwork.sendTemplate` (`POST /v1/admin/orders/{orderId}/templates`)
  - path /prepress/{orderId}/actions/send-template → POST /orders/{orderId}/templates
  - body.fileId optional → required
  - body.drawingJobId → missing-on-backend (a finished drawing is sent automatically by drawForOrder; otherwise pass its outputFileId as fileId)
  - body.message → note
  - Idempotency-Key (FE required) → not declared on backend
  - 200 PrepressDetailDto → 201 DielineDeliveryDto
  - **gap (U-B0.2):** Idempotency-Key if required
  - *note:* Trim box becomes the preflight size (ADR-0009, D-070).
- **POST /v1/admin/prepress/{orderId}/drawing-jobs** — published differently → `admin.designs.drawForOrder` (`POST /v1/admin/orders/{orderId}/drawings`)
  - path /prepress/{orderId}/drawing-jobs → /orders/{orderId}/drawings
  - body.format required → optional (svg|dxf|pdf same)
  - 202 DrawingJobDto: id, format, status (queued|running|succeeded|failed|engine_unavailable), engineVersion, error same; createdAt date-time → string
  - outputFile FileRef → outputFileId (uuid only)
  - extra-on-backend: orderId, patternId, lengthMm, widthMm, heightMm, completedAt
  - 501 drawing.engine_unavailable same
  - **gap (U-B0.2):** outputFile as FileRef (url) or the web resolves the file id
  - *note:* Box style/size from the order's quotation; template goes to the customer once drawn (legacy sendDrawingAutov2).

#### `admin.design-services` — published differently

Decisions: D-070, D-071

- **POST /v1/admin/prepress/{orderId}/design/actions/deliver-round** — published differently → `admin.designServices.deliver` (`POST /v1/admin/design-services/{designServiceId}/actions/deliver`)
  - path /prepress/{orderId}/design/actions/deliver-round → /design-services/{designServiceId}/actions/deliver (param orderId → designServiceId)
  - body fileIds, note same
  - Idempotency-Key (FE required) → not declared on backend
  - 200 PrepressDetailDto → DesignServiceDto (rounds, due state)
  - **gap (U-B0.2):** Idempotency-Key if required
  - *note:* Becomes a new artwork version (source design_service), preflight/review/proof follow (D-071, D-070). Round fee from settings.
- **POST /v1/admin/prepress/{orderId}/design/actions/requote** — published differently → `admin.designServices.requote` (`POST /v1/admin/design-services/{designServiceId}/actions/requote`)
  - path → /design-services/{designServiceId}/actions/requote
  - body.reason same
  - Idempotency-Key not declared on backend
  - 200 PrepressDetailDto → DesignServiceDto
  - *note:* D-071.

#### `admin.design-documents` — mixed: 2 published differently · 1 implement here

Decisions: D-005, D-152

- **GET /v1/admin/design-documents/{documentId}** — published differently → `admin.designs.get` (`GET /v1/admin/designs/{designId}`)
  - path /design-documents/{documentId} → /designs/{designId}
  - id, title same; updatedAt date-time → string
  - document{schemaVersion?,spec,content} → document free map|null + schemaVersion|null, versionNo|null top-level
  - thumbnailUrl → thumbnailFileId
  - editable, owner{displayName} → missing-on-backend
  - extra-on-backend: catalogProductId, patternId, materialId, lengthMm/widthMm/heightMm, semiDesignTemplateId, assets[]
  - ETag header present
  - **gap (U-B0.2):** editable (true only for the staff member's own copy) and owner
  - *note:* D-152.
- **PUT /v1/admin/design-documents/{documentId}** — published differently → `admin.designs.save` (`PUT /v1/admin/designs/{designId}`)
  - path → /designs/{designId}
  - If-Match required same; 412 concurrency.stale same
  - body.title required → optional
  - body.document.schemaVersion → top-level schemaVersion (required)
  - body.document{spec,content} → document map
  - extra-on-backend: thumbnailFileId
  - 403 design.read_only → 403 auth.forbidden (only the staff author's designs)
  - **gap (U-B0.2):** specific problem code design.read_only if the UI needs to tell it apart
  - *note:* D-005.
- **POST /v1/admin/design-documents/{documentId}/actions/copy** — implement here
  - **scope (U-B0.2, `designs`):** Server-side copy of a customer's design document into a staff-owned editable copy ({title} → 201 view with ETag), recording provenance; the customer's document is never modified (F4 C.2). admin.designs.create is for semi-design templates and needs catalogProductId.

#### `admin.production-board` — published differently

Decisions: D-074, D-075, D-141

- **GET /v1/admin/production-board** — published differently → `admin.production.list` (`GET /v1/admin/production-jobs`)
  - ProductionBoardDto{columns[{key,name,total,atRisk,jobs[]}]} (grouped) → flat paged {data: AdminJobDto[], meta} — group client-side by the current milestone in milestones[]
  - query atRisk=true → queue=at_risk
  - query factoryId, productType → missing-on-backend (extra-on-backend: status, orderId, q, queue awaiting_acceptance|escalated)
  - jobs[].jobNo, status, promisedShipDate, predictedFinishOn, atRisk, inspectionRequired same
  - jobs[].order{…} → orderId + orderCode
  - jobs[].factory{…} → factoryId + factoryCode
  - jobs[].quantity → quantityOrdered
  - jobs[].milestone → derive from milestones[]
  - jobs[].productType, riskReason → missing-on-backend
  - extra-on-backend: buyCostNet (factory_cost.read only, D-141), inspectionReasons, holdReason, releaseMode, plannedStartOn/FinishOn, …
  - **gap (U-B0.2):** board endpoint (or list params) grouping by current milestone with column totals and at-risk counts, computed by the API
  - **gap (U-B0.2):** factoryId and productType filters
  - **gap (U-B0.2):** riskReason and current milestone key per job
  - **gap (U-B0.2):** productType ref on the job
  - *note:* D-074, D-075, D-141.

#### `admin.inspections` — published differently

Decisions: D-076

- **GET /v1/admin/inspections** — published differently → `admin.inspections.list` (`GET /v1/admin/inspections`)
  - query status, page, perPage same (status enum same)
  - query factoryId, q, sort, order → missing-on-backend
  - data[].id, status, reasons[] (enum same), lotSize, sampleSize, notes same
  - data[].acceptNumbers{critical,major,minor} → accept (free map with the same keys)
  - data[].found{critical,major,minor}|null → found map|null
  - data[].aql{critical,major,minor} → missing-on-backend
  - data[].job{id,jobNo} → jobId + jobNo
  - data[].factory{…} → factoryCode
  - data[].order, productType → missing-on-backend
  - data[].inspector{id,displayName}|null → inspector string|null
  - data[].scheduledAt, resultAt date-time → string|null
  - extra-on-backend: ratePct, selected
  - **gap (U-B0.2):** factoryId filter
  - **gap (U-B0.2):** aql per class
  - **gap (U-B0.2):** order ref and productType
  - **gap (U-B0.2):** typed accept/found objects {critical,major,minor} instead of free maps
  - **gap (U-B0.2):** inspector ref
  - *note:* ISO 2859-1 level II (D-076).
- **POST /v1/admin/inspections/{inspectionId}/actions/record** — published differently → `admin.inspections.record` (`POST /v1/admin/inspections/{inspectionId}/actions/record`)
  - body.found{critical,major,minor} → foundCritical, foundMajor, foundMinor (flat, required)
  - body.notes, photoFileIds same
  - Idempotency-Key (FE required) → not declared on backend
  - 200 InspectionDto → InspectionDto (backend shape above)
  - **gap (U-B0.2):** Idempotency-Key if required
  - *note:* API judges pass/fail (D-076). Extra op: admin.inspections.schedule.

#### `admin.scorecards` — published differently

Decisions: D-075, D-155

- **GET /v1/admin/scorecards** — published differently → `admin.inspections.scorecards` (`GET /v1/admin/factories/{factoryId}/scorecards`)
  - GET /v1/admin/scorecards?month= (all factories) → per factory path {factoryId}, latest 12 months, bare array
  - {month, data[]} envelope → array
  - month, onTimeAcceptancePct, onTimeShippingPct, qcFirstPassPct, claimRatePct, onTimeUpdatesPct, jobsCount same
  - computedAt date-time → string
  - data[].factory ref → implied by path
  - **gap (U-B0.2):** cross-factory scorecards for one month (GET /v1/admin/scorecards?month=) with the factory ref, for allocation and the partner team
  - *note:* D-155, D-075. Recompute: admin.inspections.recomputeScorecard.

#### `admin.campaigns` — published differently

Decisions: D-154

- **GET /v1/admin/campaigns** — published differently → `admin.campaigns.list` (`GET /v1/admin/campaigns`)
  - query page/perPage/sort/order/q/status same (status enum draft|scheduled|active|paused|exhausted|ended same)
  - data[].id, code, name, status, startsAt, spentAmount, alertThresholdPct, alertedAt same
  - data[].budgetAmount string → string|null (unlimited)
  - data[].endsAt date-time → date-time|null
  - data[].owner, spentPct, promotionsCount, createdAt → missing-on-backend
  - extra-on-backend: currency, goals (map)
  - **gap (U-B0.2):** owner, spentPct (API-computed so the UI does not divide money), promotionsCount, createdAt
  - *note:* Threshold from setting campaigns.budget_alert_pct (D-154).
- **POST /v1/admin/campaigns** — published differently → `admin.campaigns.create` (`POST /v1/admin/campaigns`)
  - body code, name, startsAt same (required)
  - body budgetAmount required → optional nullable
  - body endsAt required → optional nullable
  - body goals string|null → goals object (free map)
  - 201 CampaignDetailDto → CampaignDto (same as list row); performance, allowedActions, owner, spentPct, promotionsCount, createdAt missing
  - **gap (U-B0.2):** allowedActions
  - **gap (U-B0.2):** performance (or read admin.promotions.report?campaignId=)
- **GET /v1/admin/campaigns/{campaignId}** — published differently → `admin.campaigns.get` (`GET /v1/admin/campaigns/{campaignId}`)
  - same as list row mapping
  - performance{redemptionsCount,ordersCount,discountAmount,revenueAmount,newCustomersCount} → admin.promotions.report (GET /v1/admin/promotions/report?campaignId=): redemptions, appliedRedemptions, discountAmount, cappedAmount, orderGroups, grossAmount, customers (newCustomersCount missing)
  - allowedActions → missing-on-backend
  - **gap (U-B0.2):** allowedActions
  - **gap (U-B0.2):** newCustomersCount
- **PATCH /v1/admin/campaigns/{campaignId}** — published differently → `admin.campaigns.update` (`PATCH /v1/admin/campaigns/{campaignId}`)
  - If-Match same
  - body name, startsAt same
  - body budgetAmount string → string|null
  - body endsAt → nullable
  - body goals string|null → object map
  - 200 CampaignDetailDto → CampaignDto
  - *note:* Budget never below spent; raising an exhausted campaign's budget reopens it (D-154).
- **POST /v1/admin/campaigns/{campaignId}/actions/{action}** — published differently → `admin.campaigns.action` (`POST /v1/admin/campaigns/{campaignId}/actions/{action}`)
  - path action activate|pause|resume|end → activate|pause|end (resume → activate from paused)
  - If-Match (FE required) → not declared on backend
  - body.reason → missing-on-backend (no body)
  - 200 CampaignDetailDto → CampaignDto
  - **gap (U-B0.2):** reason for pause/end if it must be audited with a reason
  - *note:* D-154.

#### `admin.promotions` — mixed: 5 published differently · 1 implement here

Decisions: D-053

- **GET /v1/admin/promotions** — published differently → `admin.promotions.list` (`GET /v1/admin/promotions`)
  - query page/perPage/sort/order/q/kind/status/campaignId same
  - data[] id, name, kind, status, priority, stacking, startsAt, endsAt same
  - data[].campaign{id,code,name}|null → campaignId|null
  - data[].benefitSummary → missing-on-backend (benefit object returned instead)
  - data[].usage{redemptionsCount,discountAmount,cappedAmount} → admin.promotions.report?promotionId= (redemptions, discountAmount, cappedAmount); spentAmount on the row
  - data[].updatedAt → missing-on-backend
  - extra-on-backend: benefit, conditions, budgetAmount, spentAmount, stackGroup, usageLimitTotal, usageLimitPerCustomer, description
  - **gap (U-B0.2):** benefitSummary rendered by the API (localized)
  - **gap (U-B0.2):** usage on the row
  - **gap (U-B0.2):** campaign ref
  - *note:* D-053.
- **POST /v1/admin/promotions** — published differently → `admin.promotions.create` (`POST /v1/admin/promotions`)
  - body name, kind, stacking, startsAt same
  - extra-on-backend required body.priority (integer)
  - body campaignId, stackGroup, endsAt, budgetAmount, usageLimitTotal, usageLimitPerCustomer: required-nullable → optional-nullable
  - conditions.schemaVersion, benefit.schemaVersion (const 1) → missing-on-backend
  - conditions.channels, segments, productTypeCodes, minOrderValue, minQuantity, firstOrderOnly, paymentMethods same names, all optional and non-null (omit instead of null)
  - conditions.segments[] enum new|returning|b2b_company → free string
  - conditions.provinceIds[] (uuid) → zoneCodes[] (shipping zone codes)
  - extra-on-backend conditions: catalogProductIds, categoryCodes
  - benefit.type enum: free_design_rounds → free_revision_rounds (or free_design), tiered_percent → tiered; extra-on-backend free_design, unit_price_override
  - benefit.pct, amount, maxAmount, multiplier, points, rounds: nullable-required → optional non-null
  - benefit.tiers[].minOrderValue → tiers[].min (+ amount; basis quantity|value)
  - extra-on-backend benefit.unitPrice, basis
  - 201 PromotionDetailDto → PromotionDto (no allowedActions, usage, benefitSummary, campaign ref, updatedAt; + spentAmount, description)
  - **gap (U-B0.2):** allowedActions
  - **gap (U-B0.2):** usage
  - **gap (U-B0.2):** benefitSummary
  - **gap (U-B0.2):** province-level condition if zones are not enough (confirm with D-053)
  - *note:* Backend owns the rule schema (promotion-schemas.ts).
- **GET /v1/admin/promotions/{promotionId}** — published differently → `admin.promotions.get` (`GET /v1/admin/promotions/{promotionId}`)
  - same as create response mapping
  - **gap (U-B0.2):** allowedActions, usage, benefitSummary
- **PATCH /v1/admin/promotions/{promotionId}** — published differently → `admin.promotions.update` (`PATCH /v1/admin/promotions/{promotionId}`)
  - If-Match same
  - body name, stacking, stackGroup, startsAt, endsAt, conditions, benefit, usageLimitTotal, usageLimitPerCustomer, budgetAmount same names (conditions/benefit as in create mapping)
  - body.campaignId → not updatable (anything but kind and campaign)
  - extra-on-backend: priority, description
  - *note:* Placed orders keep their reserved redemption (D-053).
- **POST /v1/admin/promotions/{promotionId}/actions/{action}** — published differently → `admin.promotions.action` (`POST /v1/admin/promotions/{promotionId}/actions/{action}`)
  - path action activate|pause|resume|end → activate|pause|end (resume → activate from paused)
  - If-Match (FE required) → not declared on backend
  - body.reason → missing-on-backend
  - 200 PromotionDetailDto → PromotionDto
  - *note:* A coupon promotion needs at least one code before activation (D-053).
- **PUT /v1/admin/promotions/priority** — implement here
  - **scope (U-B0.2, `promotions`):** Bulk reorder: promotionIds[] in evaluation order → rewrite each promotion's priority in one transaction (audit + event) → {updated}; today priority is only settable per promotion via admin.promotions.update (D-053).

#### `admin.coupons` — mixed: 3 published differently · 1 implement here

Decisions: D-053

- **POST /v1/admin/coupon-codes/{codeId}/actions/disable** — published differently → `admin.promotions.setCouponStatus` (`POST /v1/admin/promotions/{promotionId}/coupons/{couponId}/actions/{action}`)
  - path /coupon-codes/{codeId}/actions/disable → /promotions/{promotionId}/coupons/{couponId}/actions/disable (needs promotionId; codeId → couponId); also action=enable
  - body.reason (required) → missing-on-backend
  - 200 CouponCodeDto → CouponDto
  - **gap (U-B0.2):** disable reason (leaked code) recorded in audit
  - *note:* Disabled code is refused at the cart (D-053).
- **GET /v1/admin/promotions/{promotionId}/coupon-batches** — implement here
  - **scope (U-B0.2, `promotions`):** List the coupon generation batches of a promotion (kind single|bulk_unique|per_customer, count, prefix, usageLimit, generatedAt, generatedBy) — generateCoupons already returns a batchId (D-053).
- **POST /v1/admin/promotions/{promotionId}/coupon-batches** — published differently → `admin.promotions.generateCoupons` (`POST /v1/admin/promotions/{promotionId}/coupons`)
  - path …/coupon-batches → …/coupons
  - Idempotency-Key same
  - body kind (single|bulk_unique) → kind single|bulk_unique|per_customer (+ customerIds[] for per_customer)
  - body code, count, prefix same
  - body.usageLimitPerCode → usageLimit
  - 201 CouponBatchDto{id,promotionId,kind,count,prefix,usageLimitPerCode,generatedAt,generatedBy} → {batchId, count} only
  - **gap (U-B0.2):** full batch DTO in the response (kind, prefix, usageLimit, generatedAt, generatedBy)
  - *note:* Up to 10,000 one-use codes; case-insensitive unique (D-053). Export: admin.promotions.exportCoupons.
- **GET /v1/admin/promotions/{promotionId}/coupon-codes** — published differently → `admin.promotions.listCoupons` (`GET /v1/admin/promotions/{promotionId}/coupons`)
  - path …/coupon-codes → …/coupons
  - query page/perPage/sort/order/q same
  - query batchId, status → missing-on-backend
  - data[].id, code, status (active|used_up|disabled), usageLimit, usedCount same
  - data[].assignedCustomer{…} → assignedCustomerId|null
  - data[].batchId → missing-on-backend
  - **gap (U-B0.2):** batchId and status filters
  - **gap (U-B0.2):** batchId on the row
  - **gap (U-B0.2):** assigned customer ref

#### `admin.referrals` — published differently

Decisions: D-132, D-136

- **GET /v1/admin/referrals** — published differently → `admin.referrals.list` (`GET /v1/admin/referrals`)
  - query page/perPage/sort/order/q/status same (status enum same)
  - query referrerId → missing-on-backend
  - data[].id, status, attributedAt, referrer{id,displayName}, referee{id,displayName} same (customerCode/companyName missing)
  - data[].approvalRequestId → approvalId
  - data[].referralCode → code (rename)
  - data[].firstOrder{id,orderCode,grossAmount,claimWindowEndsAt} → firstOrderGroupId + firstOrderGroupCode (group, not order; no amount/claim window)
  - data[].fraudFlags[] enum → string[] (free)
  - data[].rewardPoints → missing-on-backend
  - extra-on-backend: qualifiedAt, rewardedAt, decidedAt
  - **gap (U-B0.2):** referrerId filter
  - **gap (U-B0.2):** first order grossAmount and claimWindowEndsAt (D-132)
  - **gap (U-B0.2):** rewardPoints
  - **gap (U-B0.2):** fraud flag enum in the contract
  - *note:* Held attribution → referral_review approval (D-136). Detail: admin.referrals.get.

#### `admin.customer-loyalty` — published differently

Decisions: D-130, D-131, D-132, D-133, D-134

- **GET /v1/admin/customers/{customerId}/points** — published differently → `admin.loyalty.ledger` (`GET /v1/admin/customers/{customerId}/loyalty/ledger`)
  - path …/points → …/loyalty/ledger
  - query page/perPage/sort/order/q same; entryType filter → missing-on-backend
  - data[].id, entryType (enum same), points, bahtValue, status (enum same), availableAt, expiresAt, createdAt same
  - data[].order{id,orderCode}|null → orderCode + groupCode (flat)
  - data[].note → reason
  - balance{available,pending,expiringSoon,expiringSoonAt,availableBahtValue} → admin.loyalty.get (GET …/loyalty): availablePoints, pendingPoints, availableValue, expiringSoon[{points,expiresAt}] (list, not a sum+date), + tier, spend12m, pointValue, multiplier, currency
  - **gap (U-B0.2):** entryType filter
  - *note:* Append-only ledger (B3.4), pending until completion + claim window (D-132). Staff adjustments: admin.loyalty.adjust.

#### `admin.customer-consents` — implement here (U-B0.2)

- **GET /v1/admin/customers/{customerId}/consents** — implement here
  - **scope (U-B0.2, `platform/notifications (src/platform/notifications, where store.me.consents and admin.consentPurposes live — not under src/modules)`):** Read-only latest decision per purpose for one customer (purpose, required, granted, versionNo, outdated vs the current text version, source, recordedAt), reusing the store.me.consents view; staff read permission; PDPA — no write for staff.

#### `admin.companies` — published differently

Decisions: D-120, D-121, D-122, D-123, D-125

- **GET /v1/admin/companies** — published differently → `admin.companies.list` (`GET /v1/admin/companies`)
  - query page/perPage/sort/order/q/status same (status enum applied|kyc_review|active|suspended|closed same)
  - query creditStatus → missing-on-backend
  - data[].id, legalName, taxId, status, creditStatus (enum same), paidOrdersCount same; companyCode nullable on backend
  - data[].membersCount → members[] inline (count client-side)
  - data[].receivables{openAmount,overdueAmount,oldestOverdueDays,nextDueAt,creditOrdersBlocked} → missing-on-backend on the row (creditStatus blocked_overdue signals the block; company credit: admin.companyCredit.get)
  - extra-on-backend: full company (branches[], members[], kycDocuments[], missingKyc[], tradeName, documentEmail, withholdsTax, poNumberPolicy, orderApprovalThreshold, statusReason)
  - **gap (U-B0.2):** creditStatus filter
  - **gap (U-B0.2):** receivables summary per row (open/overdue, oldest overdue days, next due, D-122)
  - **gap (U-B0.2):** membersCount (rows are heavy with members inline)
  - *note:* D-120, D-122.
- **GET /v1/admin/companies/{companyId}** — published differently → `admin.companies.get` (`GET /v1/admin/companies/{companyId}`)
  - id, legalName, taxId, status, creditStatus, isVatRegistered, poNumberPolicy, orderApprovalThreshold, kycApprovedAt, paidOrdersCount, createdAt same
  - credit{limitAmount,termDays,availableAmount,…} → admin.companyCredit.get (GET …/credit): limitAmount|null, termDays|null, availableAmount, exposureAmount, pendingRequest{limitAmount,termDays,requestedAt}, currency; eligible, eligibleReason, versions[] missing
  - discount{pct,memoCode,validTo,discountMemoId} → missing-on-backend (company memos via admin.discountMemos.list, scope company)
  - receivables → missing-on-backend
  - allowedActions → missing-on-backend
  - members, branches, kycDocuments, missingKyc inline (extra-on-backend)
  - **gap (U-B0.2):** allowedActions
  - **gap (U-B0.2):** credit eligibility (eligible, eligibleReason) and limit versions history
  - **gap (U-B0.2):** active company discount
  - **gap (U-B0.2):** receivables summary (D-122)
  - *note:* D-120…D-125.
- **POST /v1/admin/companies/{companyId}/actions/{action}** — published differently → `admin.companies.setStatus` (`POST /v1/admin/companies/{companyId}/actions/{action}`)
  - action suspend, close same; reinstate → reactivate
  - action approve-kyc → admin.companies.approveKyc (POST …/actions/approve-kyc, no body)
  - action return-kyc → admin.companies.rejectKyc (POST …/actions/reject-kyc, body {reason})
  - body.reason same (ReasonDto)
  - If-Match (FE required) → not declared on backend
  - 200 CompanyDetailDto → AdminCompanyDto
  - **gap (U-B0.2):** If-Match concurrency on company actions if required
  - *note:* Closing returns it to prepaid; approve-kyc issues the company code and starts prepaid (D-120, D-121).
- **GET /v1/admin/companies/{companyId}/branches** — published differently → `admin.companies.get` (`GET /v1/admin/companies/{companyId}`)
  - CompanyBranchDto[] → AdminCompanyDto.branches[] (inline)
  - id, branchCode, branchType, name same
  - address (string) → line1, line2|null, postcode (structured)
  - extra-on-backend: isDefault
  - *note:* Tax invoice per branch (D-125).
- **GET /v1/admin/companies/{companyId}/kyc-documents** — published differently → `admin.companies.get` (`GET /v1/admin/companies/{companyId}`)
  - CompanyKycDocumentDto[] → AdminCompanyDto.kycDocuments[] (inline)
  - id, docType, status (expired|pending|rejected|verified), note same; docType enum + other on backend
  - issuedOn string → string:date
  - file FileRef → fileId (uuid only)
  - uploadedAt, reviewedAt, reviewedBy → missing-on-backend
  - extra-on-backend: missingKyc[] on the company
  - **gap (U-B0.2):** file ref with url, uploadedAt, reviewedAt/By
  - *note:* D-120.
- **POST /v1/admin/companies/{companyId}/kyc-documents/{documentId}/actions/review** — published differently → `admin.companies.reviewKycDocument` (`POST /v1/admin/companies/{companyId}/kyc-documents/{documentId}/actions/review`)
  - body outcome (verified|rejected) same
  - body note required-nullable → optional-nullable
  - 200 CompanyKycDocumentDto → AdminCompanyDto (the whole company; the document is in kycDocuments[])
  - *note:* Certificate older than b2b.kyc_certificate_max_age_months cannot be verified (D-120).
- **GET /v1/admin/companies/{companyId}/members** — published differently → `admin.companies.get` (`GET /v1/admin/companies/{companyId}`)
  - CompanyMemberDto[] → AdminCompanyDto.members[] (inline)
  - id, roles[] (company_admin|company_buyer|company_approver|company_accountant), status (invited|active|removed), joinedAt same
  - user{id,displayName,email,phone} → user{id,displayName} (email, phone missing-on-backend)
  - **gap (U-B0.2):** member user email and phone

#### `admin.company-credit` — published differently

Decisions: D-121, D-125

- **POST /v1/admin/companies/{companyId}/credit-limits** — published differently → `admin.companyCredit.requestLimit` (`POST /v1/admin/companies/{companyId}/credit-limits`)
  - body limitAmount, reason same
  - body termDays required → optional (from b2b.credit_terms, default 30)
  - body basis enum financial_review → financial_statement (paid_orders same)
  - body evidenceFileIds → missing-on-backend (the verified financial statement is a KYC document)
  - Idempotency-Key (FE required) → not declared on backend
  - 201 {versionNo, approvalRequestId, status: proposed} → 201 CompanyCreditDto {creditStatus, limitAmount|null, termDays|null, availableAmount, exposureAmount, currency, pendingRequest{limitAmount,termDays,requestedAt}}
  - **gap (U-B0.2):** Idempotency-Key (money-affecting request; conventions)
  - **gap (U-B0.2):** approval request id and version no in the response
  - **gap (U-B0.2):** evidence files if Finance needs them beyond the KYC financial statement
  - *note:* Routed by seeded credit_limit policy (Finance ≤ THB 100,000, C-Level above); requester cannot approve (D-121).
- **GET /v1/admin/companies/{companyId}/statements** — published differently → `admin.receivables.companyStatement` (`GET /v1/admin/companies/{companyId}/statements`)
  - list of CompanyStatementDto[] → one statement per call with required query month (YYYY-MM)
  - period → month
  - openingBalance → opening; invoicedAmount → invoiced; paidAmount → paid; closingBalance → closing (renames)
  - extra-on-backend: credited, currency, pdfReady
  - file FileRef → pdfReady (PDF generated on first request)
  - dueAt, status open|paid|overdue, issuedAt → missing-on-backend
  - per-order lines: admin.companyCredit.statement (GET …/statement?month=)
  - **gap (U-B0.2):** list of available months (or the web iterates months)
  - **gap (U-B0.2):** dueAt, status and issuedAt per statement
  - **gap (U-B0.2):** PDF download link
  - *note:* D-125.

#### `admin.shipments` — mixed: 4 published differently · 4 implement here

Decisions: D-013, D-021, D-022, D-080, D-114, D-141, D-165

- **GET /v1/admin/shipments** — published differently → `admin.shipments.list` (`GET /v1/admin/shipments`)
  - query page/perPage/sort/order/q/status same (status enum same)
  - query queue (awaiting_pickup|in_transit|exceptions|pod_review), carrier, factoryId → missing-on-backend (extra-on-backend orderId)
  - data[].id, shipmentNo, status, carrier (deliveree|factory_fleet|flash_express same), trackingNo, readyAt same
  - data[].cartons → cartonsCount (rename)
  - data[].order{id,orderCode} → items[].orderCode (per item; no order id)
  - data[].factory{…} → factoryId + factoryCode
  - data[].destination{recipientName,province,postcode} → destination{recipientName,phone,line1,line2,postcode} (province missing)
  - data[].quantity → sum of items[].quantity
  - data[].lastEvent → last of events[] (occurredAt, status, location)
  - data[].exception, podReview, promisedShipDate → missing-on-backend (plannedShipOn instead of promisedShipDate)
  - extra-on-backend: full ShipmentDto (items, events, proofOfDelivery, labelFileId, packingListFileId, trackingUrl, weightG, volumeCm3, carrierBookingRef, carrierCostAmount, payoutAmount — costs per D-141)
  - **gap (U-B0.2):** queue, carrier and factoryId filters
  - **gap (U-B0.2):** exception text, POD review state
  - **gap (U-B0.2):** destination province
  - *note:* D-013, D-114, D-141.
- **GET /v1/admin/shipments/{shipmentId}** — published differently → `admin.shipments.get` (`GET /v1/admin/shipments/{shipmentId}`)
  - same base mapping as the list row
  - ETag (FE expects) → not declared on backend
  - destination AddressSnapshot province/district/subdistrict names → missing (line1/line2/postcode/phone/recipientName only)
  - items[].orderId, destinationLabel → items[].orderCode, jobId, jobNo, destinationId, deliveredQuantity
  - cartonList[{seq,labelCode,weightG}] → missing-on-backend (cartonsCount only)
  - weightG integer|null → integer
  - pod{kind,receiverName,deliveredQuantity,capturedAt,photos,signature,review,reviewedBy,reviewNote} → proofOfDelivery{kind,receiverName,deliveredQuantity,capturedAt,photoFileIds[],signatureFileId,carrierPodRef} (file ids, no review fields)
  - tolerance ToleranceResultDto → admin.shipments.reconciliation (GET /v1/admin/orders/{orderId}/delivery-reconciliation, per order, 404 until delivered)
  - economics{customerCharge,carrierCost,factoryPayout} → carrierCostAmount, payoutAmount (masked per D-141); customerCharge missing
  - blockedByPayment, allowedActions → missing-on-backend
  - **gap (U-B0.2):** ETag (needed for If-Match on the actions the web plans)
  - **gap (U-B0.2):** allowedActions
  - **gap (U-B0.2):** blockedByPayment (before-shipping instalment gate, B3.2)
  - **gap (U-B0.2):** carton list
  - **gap (U-B0.2):** province on the destination
- **POST /v1/admin/shipments/{shipmentId}/actions/book-carrier** — published differently → `admin.shipments.bookCarrier` (`POST /v1/admin/shipments/{shipmentId}/actions/book-carrier`)
  - Idempotency-Key same
  - If-Match (FE required) → not declared on backend
  - body.quoteId → carrier (deliveree|flash_express) + optional pickupAt — the carrier quote is taken at booking and kept as Packio's cost
  - body.reason → missing-on-backend
  - 200 ShipmentDetailDto → ShipmentDto
  - **gap (U-B0.2):** reason for the fallback booking if it must be audited
  - *note:* Only where the factory fleet cannot serve (D-013, D-114); shipping gate applies (B3.2).
- **POST /v1/admin/shipments/{shipmentId}/actions/resolve-exception** — implement here
  - **scope (U-B0.2, `logistics`):** Resolve a failed/returned shipment: resolution cancel|retry|return with reason, If-Match; today only admin.shipments.cancel (draft/packed) and admin.shipments.updateStatus (staff status correction) exist; audit + event.
- **POST /v1/admin/shipments/{shipmentId}/actions/split** — implement here
  - **scope (U-B0.2, `logistics`):** Split a not-yet-shipped shipment by quantity into a new shipment (Idempotency-Key + If-Match, reason) → {shipment, created}; one transaction, audit, outbox event.
- **POST /v1/admin/shipments/{shipmentId}/carrier-quotes** — implement here
  - **scope (U-B0.2, `logistics`):** Quote the enabled fallback carriers for this shipment (weight, volume, pickup at factory, destination) → CarrierQuoteDto[] via the carrier adapters (D-114); admin.carriers.testQuote only checks an account. Staff with logistics rights; costs are Packio's (D-141).
  - *note:* Alternatively the web books without a quote (bookCarrier prices at booking).
- **POST /v1/admin/shipments/{shipmentId}/documents** — published differently → `admin.files.download` (`GET /v1/admin/files/{fileId}/download`)
  - POST …/documents {kind: labels|packing_list} → read ShipmentDto.labelFileId / packingListFileId (generated when the shipment is packed) then GET /v1/admin/files/{fileId}/download
  - {url, expiresAt} same (signed URL, 5 minutes)
  - *note:* Files are null before the shipment is ready.
- **POST /v1/admin/shipments/{shipmentId}/pod/actions/{decision}** — implement here
  - **scope (U-B0.2, `logistics`):** Staff review of a recorded POD (accept|reject with note) before payout/claim window proceed (D-013, D-022); POD recording exists (admin.shipments.recordPod) but no review state; audit + event.
  - *note:* uncertain: no decision names a POD review step — confirm it is wanted.

#### `admin.claims` — published differently

Decisions: D-022, D-082, D-083

- **GET /v1/admin/claims** — published differently → `admin.claims.list` (`GET /v1/admin/claims`)
  - query page/perPage/sort/order/q/status same (status enum same)
  - query type, origin → missing-on-backend (extra-on-backend orderId)
  - data[].id, claimNo, type, origin, status, requestedResolution, claimedAmount, liability, submittedAt same (enums same)
  - data[].order{id,orderCode} → orderId + orderCode
  - data[].factory{…} → factoryId + factoryCode (nullable)
  - data[].customer → missing-on-backend
  - data[].slaDueAt → missing-on-backend
  - extra-on-backend: full claim (description, photos, liabilityByRule, resolutions, factoryResponse, …)
  - **gap (U-B0.2):** type and origin filters
  - **gap (U-B0.2):** customer ref
  - **gap (U-B0.2):** slaDueAt (claim SLA)
  - *note:* D-082, D-083.
- **GET /v1/admin/claims/{claimId}** — published differently → `admin.claims.get` (`GET /v1/admin/claims/{claimId}`)
  - same base mapping
  - ETag (FE expects) → not declared
  - shipment{id,shipmentNo} → shipmentId
  - evidence{productPhotos,cartonPhotos} FileRef[] → photos{product[],carton[]} file ids
  - liabilityByRule same; liabilityRule (rule text) → missing
  - liabilityOverride{by,at,reason} → overrideReason only
  - factoryResponse{response,note,at} → factoryResponse enum + factoryResponseNote
  - decision{by,at,reason} → decidedAt + decisionNote
  - resolutions[] action/amount/executedAt same; executedBy, reference → jobNo, quantity, refundId
  - receivedAt, windowEndsAt, claimedQuantity, description same
  - approvedProof, messages[], allowedActions, allowedResolutions → missing-on-backend
  - extra-on-backend: infoRequest, infoResponse, jobId, jobNo
  - **gap (U-B0.2):** allowedActions and allowedResolutions
  - **gap (U-B0.2):** messages thread (customer/factory/internal)
  - **gap (U-B0.2):** liabilityRule explanation
  - **gap (U-B0.2):** approvedProof ref (D-083 artwork-approved evidence)
  - **gap (U-B0.2):** who decided / overrode
- **POST /v1/admin/claims/{claimId}/actions/{action}** — published differently → `admin.claims.decide` (`POST /v1/admin/claims/{claimId}/actions/decide`)
  - start-review → admin.claims.review (POST …/actions/review, no body)
  - request-info → admin.claims.requestInfo (body {note}, min 3)
  - send-to-factory → admin.claims.sendToFactory (no body)
  - approve / reject → admin.claims.decide (body {decision: approved|rejected, note})
  - close → admin.claims.close (no body)
  - body.reason → note (request-info, decide) or none
  - If-Match (FE) → Idempotency-Key required on every claim action
  - 200 ClaimDetailDto → ClaimDto
  - *note:* Approval needs a determined liability (claims.liability_undetermined).
- **POST /v1/admin/claims/{claimId}/liability** — published differently → `admin.claims.overrideLiability` (`POST /v1/admin/claims/{claimId}/actions/override-liability`)
  - path …/liability → …/actions/override-liability
  - body liability (enum same), reason same (min 10)
  - If-Match (FE) → Idempotency-Key required
  - 200 ClaimDetailDto → ClaimDto
  - *note:* Permission claims.override_liability; before the decision only (D-083).
- **POST /v1/admin/claims/{claimId}/resolutions** — published differently → `admin.claims.resolve` (`POST /v1/admin/claims/{claimId}/actions/resolve`)
  - path …/resolutions → …/actions/resolve
  - body {action, amount, note} (one) → {actions: [{action, amount?, note?, quantity?, paymentId?}]} (1–6 in one transaction)
  - action enum same
  - amount string|null required → optional (required for money actions)
  - extra-on-backend: quantity (reproduction), paymentId (refund)
  - Idempotency-Key same
  - 200 ClaimDetailDto → ClaimDto
  - *note:* Existing mechanisms only; refund needs Finance Manager approval (D-083, D-022).

### U-B0.3 — `admin.*` platform, finance & analytics

#### `admin.menu-entries` — published differently

Decisions: D-140, D-141

- **GET /v1/admin/me` → `menu[]** — published differently → `admin.me.get` (`GET /v1/admin/me`)
  - MenuEntryDto{key,path} → MenuEntryDto{key,path} (same shape)
  - analytics /admin/analytics → present (gated on analytics.read)
  - reports /admin/reports → present (no permission; the report catalogue itself filters by data permission)
  - orders, cs_calculators, quotations, rfq, prepress, production, shipments, claims, partners, catalogue, marketing, customers, companies, discount_memos, finance → missing-on-backend
  - extra-on-backend keys: dashboard, approvals, users, settings, feature_flags, notification_templates, notification_routes, audit_logs, outbox, ops
  - **gap (U-B0.3):** Add ADMIN_MENU entries (src/modules/iam/menu.catalog.ts) using the backend's permission keys, e.g. orders→orders.read, cs_calculators→quotes.calculate, quotations→quotes.read, rfq→rfqs.read, prepress→artwork.read, production→production.read, shipments→shipments.read, claims→claims.read, partners→partners.read, catalogue→catalog.read, marketing→promotions.read, customers→customers.read, companies→companies.read, discount_memos→discount_memos.read
  - **gap (U-B0.3):** `finance` entry needs an any-of gate (payments.verify_slip | receivables.manage | ledger.read | payables.read | banking.read | tax.read): MenuEntry.permission is a single key today, so extend it to `permission: PermissionKey | PermissionKey[]` (any-of) in menuFor()
  - *note:* Table-only id. Paths are the frontend's; the backend just echoes them. Keys proposed by the frontend are fine; the permission gates must be the backend catalogue's keys (see admin.permissions).

#### `admin.permissions` — published differently

Decisions: D-140, D-141

- **permission keys in `/v1/admin/me` → `permissions[]** — published differently → `admin.me.get` (`GET /v1/admin/me`)
  - same: orders.read, orders.manage, discount_memos.read, catalog.read, catalog.manage, cms.manage, partners.read, partners.manage, price_proposals.review, price_suggestions.read, agreements.manage, zones.manage, index_series.manage, production.read, customers.read, companies.read, companies.manage, shipments.read, shipments.manage, claims.read, analytics.read
  - orders.create_on_behalf → carts.manage_on_behalf (rename)
  - cs.calculate → quotes.calculate (rename)
  - quotations.manage → quotes.manage (rename; also quotes.read)
  - discounts.apply → discount_memos.request (rename: CS discounts within limit + raise memos, D-052/D-124)
  - rfq.read / rfq.manage → rfqs.read / rfqs.manage (rename)
  - prepress.read → artwork.read (rename); prepress.manage → prepress.review (rename)
  - qc.inspect → inspections.perform (rename, D-076)
  - marketing.read → promotions.read (rename); marketing.manage → promotions.manage + campaigns.manage (split)
  - claims.decide → claims.manage (decide/close) + claims.resolve (resolution) + claims.override_liability (split)
  - reports.read → missing-on-backend by design: each report requires its own data permission; reports.export / reports.schedule exist
  - extra-on-backend: analytics.read_factories, analytics.prospectus, analytics.manage, orders.cancel, orders.reprice, margin.read, … (full list in GET /v1/admin/roles and docs/rbac.md)
  - *note:* Table-only id. Use GET /v1/admin/roles (admin.roles.list) or docs/rbac.md as the source for per-role grants instead of mocks/personas.ts. List-level actions: catalog import → catalog.import; export → reports.export (reports) / audit_logs.export (audit).

#### `admin.analytics` — published differently

Decisions: D-102, D-044, D-101, D-053, D-154

- **GET /v1/admin/analytics/campaigns** — published differently → `admin.analytics.campaigns` (`GET /v1/admin/analytics/campaigns`)
  - query range(7d|30d|90d|custom) → missing-on-backend; from/to are required dates (format date), the frontend resolves the preset in Asia/Bangkok
  - response {period, rows[]} → bare array (envelope); period → missing (echo of the request)
  - rows[].campaign{id,code,name} → id, code, name flattened (nesting)
  - rows[].redemptions → redemptions (same)
  - rows[].paidOrders → orderGroups (rename)
  - rows[].discountAmount → discountAmount (same)
  - rows[].revenueAmount → grossAmount (rename)
  - rows[].newCustomers → newCustomers (same)
  - extra-on-backend: reversals, cappedAmount, budget|null, spent, status
  - *note:* permission analytics.read
- **GET /v1/admin/analytics/demand** — published differently → `admin.analytics.demand` (`GET /v1/admin/analytics/demand`)
  - query range → from/to (required dates)
  - query dimension (single, required) → groupBy[] (optional array; adds `channel`)
  - query productType → productTypeId (uuid)
  - response {period, dimension, rows[], suppressedGroups, minGroupSize} → bare array of cells (envelope)
  - rows[].key/label → productType{id,code,nameTh,nameEn} | province{…} | specBand | quantityBand | channel (nesting; frontend builds key/label from the grouped column)
  - rows[].quotes → savedQuotes (+ calculations, instantCalculations, convertedQuotes)
  - rows[].rfqs → routedToRfq / rfqsSubmitted (+ rfqsQuoted, rfqsAccepted, rfqsDeclined, rfqsExpired)
  - rows[].paidOrders, rows[].gmv → missing-on-backend here; available per product type in admin.analytics.sales byProductType[] (ordersPaid, gmv)
  - rows[].conversionPct → missing (derivable: convertedQuotes / savedQuotes)
  - rows[].abandonedAfterPricePct → missing-on-backend
  - suppressedGroups / minGroupSize → missing-on-backend: staff dashboards are not k-suppressed; D-044 k≥3 applies to exports and the partner prospectus
  - extra-on-backend: avgFirstResponseMinutes
  - **gap (U-B0.3):** abandonedAfterPricePct (price shown → no cart) per cell, if the screen keeps that column
  - *note:* permission analytics.read; top 500 cells
- **GET /v1/admin/analytics/factories** — published differently → `admin.analytics.factories` (`GET /v1/admin/analytics/factories`)
  - query range → from/to (required dates)
  - response {period, rows[]} → bare array (envelope); one row per factory × product type, not per factory
  - rows[].factory{id,code,name} → factory{id,code,nameTh,nameEn} (rename name → nameTh/nameEn)
  - rows[].jobs → released (+ accepted, rejected, shipped)
  - rows[].utilisationPct (string) → utilisationPct string|null (nullability)
  - rows[].onTimePct|null → acceptedOnTimePct|null and shippedOnTimePct|null (split)
  - extra-on-backend: productType{…}, claims
  - *note:* requires analytics.read AND analytics.read_factories (staff-only named factories, D-044)
- **GET /v1/admin/analytics/overview** — published differently → `admin.analytics.sales` (`GET /v1/admin/analytics/sales`)
  - no single overview op: compose admin.analytics.sales + admin.analytics.funnel + admin.analytics.traffic (all from/to)
  - kpis.sessions → admin.analytics.traffic totals.sessions
  - kpis.gmv / kpis.aov / kpis.repeatRatePct → sales totals.gmv / totals.aov|null / totals.repeatRatePct|null
  - kpis.paidOrders → sales totals.groupsPaid (rename; order groups)
  - kpis.conversionPct → sales sessionConversionPct|null
  - kpis.quotes / kpis.rfqs → sum of admin.analytics.demand savedQuotes / rfqsSubmitted
  - funnel[{step,count}] → admin.analytics.funnel steps[{step, sessions, fromPreviousPct, fromVisitPct}] (rename count → sessions; enum adds `placed`)
  - trend[{date,gmv,paidOrders,quotes}] → sales series[{period, gmv, groupsPaid, groupsPlaced, netSales, aov, repeatRatePct}] (rename; interval day|week|month; no quotes per day)
  - previous{gmv,paidOrders,conversionPct} → missing: call sales again with the previous period
  - computedAt → missing-on-backend
  - *note:* Not a gap: the backend deliberately exposes the B6.1 rollups per topic; the frontend composes the overview. uncertain: if one round-trip is wanted, an additive overview op in analytics could be added.
- **GET /v1/admin/analytics/unmet-demand** — published differently → `admin.analytics.unmetDemand` (`GET /v1/admin/analytics/unmet-demand`)
  - query range → from/to (required dates)
  - period → missing (echo)
  - reasons[{code,label,count}] → byReason[{key, records}] (rename; frontend owns the label)
  - specs[{productTypeCode, productTypeName, spec, requests}] → rows[{productType{code,nameTh,nameEn}, specBand, quantityBand, province, reasonCode, source, records}] (nesting/rename)
  - capacityLimited[{week, productTypeCode, productTypeName, requests}] → capacityLimitedWeeks[{weekStart (date), productType{…}, factories, factoriesFull}] (rename; counts factories, not requests)
  - rfqsDeclined / rfqsExpired → derivable from byReason / bySource
  - extra-on-backend: bySource[]
  - productType names are inline (nameTh/nameEn), so roles without catalog.read can read them (as the frontend asked)
  - *note:* permission analytics.read

#### `admin.analytics-journeys` — implement here (U-B0.3)

Decisions: D-102, D-144, D-217, D-219

*Triaged 2026-09-30:* new since the 2026-09-29 triage (packio-web U5.0, `awaiting-triage.ts`).

- **GET /v1/admin/analytics/journeys** — implement here
  - **scope (U-B0.3, `analytics`), built in U5.B6:** one journey's funnel (`configurator | checkout | studio | claims | reorder`, from the UX scorecard) over a period (`range` 7d | 30d | 90d | custom, resolved in Asia/Bangkok as the frontend asks): sessions and conversion per step, the same figures for the previous period of equal length, week-over-week change of each step's conversion, and a per-step `alert` when the weekly drop exceeds the threshold. Reuse the B6.1 pieces: `src/modules/analytics/event-schemas.ts` (validated event names — `AnalyticsEventName` has only `page_view | configurator_step | quote_shown | add_to_cart | checkout_step`, so the journey step events of the studio, claims and reorder journeys must be added there first), the daily funnel rollups (`admin.analytics.funnel`), and `src/modules/ops/ops-signals.service.ts` to raise the drop as an ops signal (`ops.alert_raised`, at most once an hour per signal). Permission `analytics.read`; consent-gated events only (D-144).
  - *note:* The alert threshold is a business value. The scorecard (§4) proposes 15 % week over week; it becomes the setting `analytics.journey_drop_alert_pct` (effective-dated, Superadmin, D-063), with its value confirmed by the business in U5.B6 (*Open questions* 7). It is not a constant.
  - *note:* **Built in U5.B6, not in U-B0.3.** RUN-ORDER §1 puts "dashboards per journey, week-over-week drop alerts" in U5.B6 (U5 precedence, §2), and D-219 makes all of U5 post-launch. The row sits under U-B0.3 only because the triage groups are U-B0.1–0.3. U-B0 step 4 ("every row published or rejected") counts it as carried over to U5.B6. The screen stays on its mock until then.

#### `admin.prospectus` — published differently

Decisions: D-102, D-044, D-160

- **POST /v1/admin/analytics/prospectus** — published differently → `admin.analytics.requestProspectus` (`POST /v1/admin/analytics/prospectus-exports`)
  - path /analytics/prospectus → /analytics/prospectus-exports (rename; resource, not action)
  - header Idempotency-Key → required on backend (missing in the frontend request)
  - body range → missing; from/to required dates (format date)
  - body format pdf|xlsx → not in the request: the worker renders both; choose at download via GET /v1/admin/analytics/prospectus-exports/{exportId}/file?format=pdf|xlsx (admin.analytics.prospectusFile)
  - extra-on-backend body: productTypeIds[]
  - response 200 {url, expiresAt, minGroupSize, suppressedGroups} → 202 ProspectusExportDto {id, status pending|ready|failed, from, to, kThreshold, suppressedCells|null, requestedAt, generatedAt|null, error|null}
  - minGroupSize → kThreshold (rename; = 3 from the setting)
  - suppressedGroups → suppressedCells (rename; null until ready; counts primary + complementary suppression)
  - url / expiresAt → from admin.analytics.prospectusFile (5-minute signed URL, each download audited)
  - status polling → GET /v1/admin/analytics/prospectus-exports/{exportId} (admin.analytics.getProspectus); history → admin.analytics.listProspectus
  - *note:* permission analytics.prospectus (exists, D-102/D-044/D-160). Answer to the frontend's note: k ≥ 3 factories/contributors per breakdown applies (D-160, D-044); the B6.1 'k ≥ 5' is superseded. The screen should show kThreshold from the response rather than a constant.

#### `admin.reports` — published differently

Decisions: D-111, D-033

- **GET /v1/admin/reports** — published differently → `admin.reports.catalogue` (`GET /v1/admin/reports`)
  - key enum: sales, sales_tax, points_liability, claims, payout_history, ar_aging, ap_aging → same; payments → payments_by_channel; orders_quotations → two reports `orders` and `quotations`; promotion_usage → campaign_usage; extra-on-backend: factory_scorecards
  - group (sales|finance|marketing|operations) → missing-on-backend
  - filters[{key, options[{value,label}]}] → filters[{key enum period|channel|productTypeId|factoryId|status|provider, kind range|as_of|month|enum|uuid, required, values[]|null}] (no labels: frontend owns them)
  - asOf boolean → filters[].kind = 'as_of' (moved)
  - extra-on-backend: nameTh, nameEn, description, columns[{key,labelTh,labelEn,type}], formats[xlsx|csv], decisions[]
  - **gap (U-B0.3):** optional: `group` on ReportDefinitionDto if the menu groups reports (otherwise the frontend maps key → group)
  - *note:* Only reports whose data permission the caller holds are listed (D-111).
- **GET /v1/admin/reports/{reportKey}** — published differently → `admin.reports.preview` (`GET /v1/admin/reports/{reportKey}/preview`)
  - path …/{reportKey} → …/{reportKey}/preview
  - query from/to/asOf → same names (format date); extra: month, period (previous_day|previous_week|previous_month|month_to_date|year_to_date)
  - query filter=&value= (generic) → named query params channel, productTypeId, factoryId, status, provider (rename)
  - query page/perPage → missing: first 200 rows + truncated; full data via POST /v1/admin/reports/{reportKey}/exports (admin.reports.export) → admin.reports.getRun → admin.reports.runFile
  - key → reportKey (rename)
  - columns[].type text|code|money|number|pct|date|datetime → text|integer|money|decimal|percent|date|datetime|boolean (enum values)
  - columns[].total → missing-on-backend; extra labelTh/labelEn
  - rows → rows (same: records of string|number|boolean|null)
  - totals → missing-on-backend
  - meta{page,perPage,total} → truncated boolean
  - generatedAt → missing-on-backend
  - extra-on-backend: filters (the resolved filters echoed)
  - **gap (U-B0.3):** totals row (columns[].total + totals) computed server-side — the screen must not add up money
  - **gap (U-B0.3):** optional: generatedAt
  - **gap (U-B0.3):** uncertain: server pagination beyond 200 rows, if the screen needs to browse more than the preview
  - *note:* Each report requires its data permission (D-111).

#### `admin.saved-views` — implement here (U-B0.3)

- **GET /v1/admin/saved-views** — implement here
  - **scope (U-B0.3, `iam`):** List the caller's own views plus shared views for `resource` (per-user table saved_views: resource, name, query jsonb string map, columns[]|null, shared, owner). No money/PII. Any staff member; page envelope {data, meta} per api-conventions.
  - *note:* uncertain: no src/modules module is a natural owner — iam (staff per-user state) is proposed; a new src/platform/saved-views would also fit the platform layer.
- **POST /v1/admin/saved-views** — implement here
  - **scope (U-B0.3, `iam`):** Create a view (201 SavedViewDto); audit/activity row; owner = actor; validate `resource` against a registry of list resources and cap query size.
- **DELETE /v1/admin/saved-views/{viewId}** — implement here
  - **scope (U-B0.3, `iam`):** Delete own view (204); 403/404 for someone else's; shared views deleted only by their owner.

#### `admin.search` — implement here (U-B0.3)

- **GET /v1/admin/search** — implement here
  - **scope (U-B0.3, `iam`):** Search by code / phone / e-mail across order, order_group, quote, rfq, customer, company, factory, shipment, claim, user, returning only types the actor's permissions and scope allow (ScopingService + the *.read permissions); q ≥ 2 chars, limit cap; pg_trgm (extension already installed) indexes on codes/names; searches by phone/e-mail audited as data_access (PDPA).
  - *note:* uncertain on owner: iam holds the permission/scoping services; each module could contribute a search provider (like the report registry).

#### `admin.dashboard` — implement here (U-B0.3)

Decisions: D-061, D-175

- **GET /v1/admin/dashboard** — implement here
  - **scope (U-B0.3, `ops`):** Aggregate per-queue {key, path, count, overdueCount, nextDueAt} from a registry each module contributes (orders.waiting_payment etc. from OrderQueue; finance.slips with the D-061 4-business-hour SLA from the slip queue slaDueAt; finance.unmatched_bank_lines, unidentified_receipts, payout_runs_awaiting_approval, deliveries_without_gr, bills_missing_tax_invoice, wht_certificates_missing, overdue_b2b_invoices, refunds_to_pay, close_tasks), each included only if the actor holds its working permission; overdue via the business calendar (Asia/Bangkok). Read-only, no idempotency.
  - *note:* ops-signals.service.ts already computes some of the same counts (slip_verification_wait_hours, approvals_overdue, acceptance_overdue) for monitoring and can share queries.

#### `admin.staff-directory` — implement here (U-B0.3)

Decisions: D-140

- **GET /v1/admin/staff-directory** — implement here
  - **scope (U-B0.3, `iam`):** Active staff only {id, displayName, roles[] (role keys)}; filters q (name), role, permission (holders of a permission via role grants, e.g. for RFQ assignment or approval delegation D-140), limit ≤ 50; no e-mail/phone (PDPA least privilege); any staff principal, no extra permission.
  - *note:* Feeds POST /v1/admin/approval-delegations delegateId (approvals.delegate).

#### `admin.sod-rules` — implement here (U-B0.3)

Decisions: D-140

- **GET /v1/admin/sod-rules** — implement here
  - **scope (U-B0.3, `iam`):** Read-only list of active SodRule rows: id (publicId), kind role_pair|action_pair, left/right = roleA/roleB keys or actionA/actionB, enforcement block|warn, description, decisions (decisionRefs); consider also exposing key and subjectMatch (same_subject|same_vendor|same_customer). Gate on users.read or roles.assign (whoever assigns roles).
  - *note:* Enums in the frontend request match prisma (SodRuleKind, SodEnforcement). The 409 stays the enforcement.

#### `admin.imports` — published differently

Decisions: D-005, D-170, D-161

- **POST /v1/admin/imports** — published differently → `admin.catalogImports.preview` (`POST /v1/admin/catalog/imports/{kind}/actions/preview`)
  - path /v1/admin/imports + body.resource → /v1/admin/catalog/imports/{kind}/actions/preview with kind ∈ geography|materials|finishes|ink_colours|patterns|standard_sizes|stock_attribute_values|stock_products (listed by admin.catalogImports.listKinds); shipping rate cards: admin.customerShippingRates.previewImport
  - body fileId → fileId (same; file uploaded via admin.files.presign)
  - 201 ImportJobDto → 200 ImportPreviewDto (synchronous; no job id / status)
  - id / status / createdAt / appliedAt → missing (stateless dry run); canConfirm boolean instead of status ready|failed
  - fileName → missing (fileId echoed)
  - totals{rows,create,update,invalid} → totals{create,update,unchanged,invalid} (rows → sum; `unchanged` extra) plus sheets[{name,create,update,unchanged,invalid}]
  - preview[{rowNo, action, values, errors[]}] → errors[{sheet,row,column|null,code,message}] only (no per-row values/action), errorsTruncated
  - extra-on-backend: previewSha256 (must be sent back on confirm)
  - *note:* permission catalog.import (geography also geography.manage, D-161/D-170)
- **GET /v1/admin/imports/{importId}** — published differently → `admin.catalogImports.preview` (`POST /v1/admin/catalog/imports/{kind}/actions/preview`)
  - no import job to poll: preview and confirm are synchronous and return the full result; re-run the preview to see the state again
  - *note:* No backend equivalent needed with the synchronous flow.
- **POST /v1/admin/imports/{importId}/actions/apply** — published differently → `admin.catalogImports.confirm` (`POST /v1/admin/catalog/imports/{kind}/actions/confirm`)
  - path …/imports/{importId}/actions/apply → …/catalog/imports/{kind}/actions/confirm
  - body (none) → {fileId, previewSha256} (the plan must equal the preview; 409 catalog.import_stale, 422 catalog.import_invalid)
  - Idempotency-Key → same (required)
  - response ImportJobDto → ImportPreviewDto (same shape as preview)
  - *note:* Audited, emits catalog.import_applied.

#### `admin.exports` — published differently

Decisions: D-033, D-111

- **POST /v1/admin/exports** — published differently → `admin.reports.export` (`POST /v1/admin/reports/{reportKey}/exports`)
  - resource 'report:<key>' → path {reportKey}; format xlsx|csv → same; query → filters{from,to,asOf,month,period,channel,productTypeId,factoryId,status,provider} (typed, not a string map)
  - report response 200 ExportFileDto → 202 ReportRunDto {id,status queued|running|succeeded|failed,rowCount|null,…}; poll admin.reports.getRun, then admin.reports.runFile → {url, expiresAt}
  - resource catalogue:<kind> → POST /v1/admin/catalog/exports/{kind} (admin.catalogImports.export) → {fileId,url,expiresAt,rows} (no truncated, xlsx only)
  - resource audit_logs → POST /v1/admin/audit-logs/exports (admin.auditLogs.export) → {fileId,url,expiresAt,rows,truncated} (same as ExportFileDto; CSV only)
  - resource coupons → POST /v1/admin/promotions/{promotionId}/coupons/exports (admin.promotions.exportCoupons); rate cards → admin.customerShippingRates.exportVersion
  - **gap (U-B0.3):** exports for the other server lists (orders, customers, companies, shipments, claims, …) — either a generic POST /v1/admin/exports over a list-resource registry in the reports module (same ExportFileDto as AuditExportDto, permission of the list + reports.export, audited export.generated) or per-list export endpoints
  - *note:* The frontend's ExportFileDto matches AuditExportDto exactly.

#### `admin.slip-file` — implement here (U-B0.3)

Decisions: D-061

- **GET /v1/admin/slips/{slipId}/file** — implement here
  - **scope (U-B0.3, `payments`):** Return a short-lived signed URL of the slip's file (purpose `slip`, retention financial_record, so the download is audited as data_access) for payments.verify_slip; simplest: add fileId (or FileRefDto) to SlipDto/SlipQueueItemDto and let the reviewer call admin.files.download, provided FilesService.canRead grants the slip to payments.verify_slip (it currently allows the uploader, files.read, owning scope or a module attachment policy).
  - *note:* Either the dedicated endpoint or the added field works; the field + existing download is the smaller change. Never log the URL.

#### `admin.document-resend` — implement here (U-B0.3)

Decisions: D-143, D-010

- **POST /v1/admin/customer-documents/{documentId}/actions/resend** — implement here
  - **scope (U-B0.3, `receivables`):** Record a `customer_document.resend_requested` domain event (outbox) for an issued document; the notification subscriber sends it by email / LINE (D-143; LINE only when linked); optional override email; Idempotency-Key; 409 for a void document; audit row; permission receivables.manage (uncertain).
- **GET /v1/admin/customer-documents/{documentId}/deliveries** — implement here
  - **scope (U-B0.3, `receivables`):** List notifications rows linked to the document's issued/resent events: channel, recipient (recipientAddressMasked only — PDPA), sentAt, status, kind issued|resent; receivables.read.

#### `admin.dunning-log` — implement here (U-B0.3)

Decisions: D-122, D-143

- **GET /v1/admin/dunning-log** — implement here
  - **scope (U-B0.3, `receivables`):** Page of DunningEntryDto from dunning_notices joined to receivable_items/customer_documents (docNumber, customer) and, via domainEventId, to notifications for channel/masked recipient/status; filters customerId, documentId, from; receivables.read.
  - *note:* Company (B2B) receivables are skipped by this job — they are reminded per credit instalment by the companies module (B3.5), so companyId entries need that source too or companyId stays null. Recipient must be the masked address (PDPA). One notice may fan out to several channels; status enum should follow NotificationStatus rather than sent|failed.

#### `admin.credit-note-reasons` — implement here (U-B0.3)

- **GET /v1/admin/credit-note-reasons** — implement here
  - **scope (U-B0.3, `receivables`):** Read-only list of active CreditNoteReason rows {code, statutoryCategory, nameTh, nameEn, appliesTo}; receivables.read or credit_notes.request.
  - *note:* statutoryCategory and appliesTo enums in the request match prisma (CnStatutoryCategory, CnAppliesTo). `direction` credit|debit does not exist: add a column and set it in the seed (additional_charge, price_increase = debit) rather than inferring from names.

#### `admin.document-payment-filter` — published differently

Decisions: D-010

- **GET /v1/admin/customer-documents?paymentId=** — published differently → `admin.customerDocuments.list` (`GET /v1/admin/customer-documents`)
  - query paymentId → missing-on-backend (existing filters: docType, status, orderId, customerId, companyId, from, to, q)
  - CustomerDocumentDto.paymentId → paymentId string(uuid)|null (same)
  - **gap (U-B0.3):** add optional query `paymentId` (uuid) to admin.customerDocuments.list
  - *note:* Table-only id; trivial additive filter.

#### `admin.payout-documents` — implement here (U-B0.3)

Decisions: D-022, D-093, D-164, D-166

- **GET /v1/admin/payout-runs/{runId}/items/{itemId}/documents** — implement here
  - **scope (U-B0.3, `payouts`):** For a paid item: signed URLs of the issued WHT certificates (IssuedWhtCertificateDto: wtNumber, form → whtForm, whtAmount → amount; base from the item's whtBase) reusing the partner PDF path, plus a factory remittance advice PDF (new render, PV number + items); 409 before paid; payouts.manage or payables.read; downloads audited (financial_record).
  - *note:* Remittance advice is a new document (nothing renders it today). Field names should follow IssuedWhtCertificateDto (form, whtAmount, whtRatePct, paidAmount).

#### `admin.bank-line-suggestions` — implement here (U-B0.3)

Decisions: D-061, D-093

- **GET /v1/admin/bank-statement-lines/{lineId}/suggestions** — implement here
  - **scope (U-B0.3, `banking`):** Read-only candidates for an unmatched line using the same rule as BankingService.autoMatch (payments slip/bank, gateway settlements, payout runs, refunds, unidentified receipts, tax payments) excluding targets already matched; BankLineSuggestionDto[{targetType BankMatchTarget, targetId, label, amount, date, reasons[]}], best first; banking.read.
  - *note:* targetType enum matches BankMatchTarget exactly.

#### `admin.bank-line-split` — implement here (U-B0.3)

Decisions: D-061, D-093

- **POST /v1/admin/bank-statement-lines/{lineId}/actions/split** — implement here
  - **scope (U-B0.3, `banking`):** Match one unmatched line to ≥ 2 targets in one transaction: parts sum to the line amount, each part equals its target (as manualMatch checks), postings per target (P04/P05) via events, audit; Idempotency-Key; banking.manage; response should be the published BankStatementLineDto (as admin.banking.matchLine returns) rather than {id, matchStatus}.

#### `admin.gateway-settlements` — implement here (U-B0.3)

Decisions: D-061, D-093

- **GET /v1/admin/gateway-settlements** — implement here
  - **scope (U-B0.3, `banking`):** Page of the published SettlementDto (id, provider scb|twoc2p, settlementDate, grossAmount, feeAmount, vatOnFee, netAmount, lineCount, unmatchedLines, status imported|posted) plus companyBankAccountId; filters status, provider, q; banking.read.
  - *note:* Response field names in the request already match SettlementDto.

#### `admin.depreciation-preview` — implement here (U-B0.3)

Decisions: D-150

- **GET /v1/admin/depreciation-runs/preview** — implement here
  - **scope (U-B0.3, `fixed-assets`):** Dry run of FixedAssetsService.runIn for a month (catch-up months included) without posting: period, periodStatus (PeriodStatus), alreadyRun, assetCount, totalAmount, per-asset lines; fixed_assets.read.
  - *note:* Route order: declare before any future depreciation-runs/{runId}. Must share code with the run so the preview equals what posts.

#### `admin.account-roll-forward` — implement here (U-B0.3)

Decisions: D-031, D-033

- **GET /v1/admin/financial-reports/roll-forward** — implement here
  - **scope (U-B0.3, `financial-reports`):** Per month from → to for one account: opening, increases, decreases, closing in the account's normal direction, split by posting rule (ruleKey on journal lines); ledger.read; accountCode restricted to roll-forward accounts (2330, 2130).
  - *note:* Not covered by the points_liability report (counts points, not the 2330 money). admin.financialReports.glDetail carries the lines + ruleKey but the screen must not sum money.

#### `admin.subledger-reconciliation` — implement here (U-B0.3)

Decisions: D-033, D-169

- **GET /v1/admin/financial-reports/subledger-reconciliation** — implement here
  - **scope (U-B0.3, `financial-reports`):** Read-only call of CloseService.subledgers (rows key, accounts, subledger, gl, difference) for the entity; ledger.read (auditor role).
  - *note:* The sub-ledgers hold current open amounts, so the rows are as of now (asOf = computation time); `period` only affects the fixed-asset row (period end). Closest existing: admin.close.get → tasks[key=subledgers_reconciled].checkResult (figures + items), stale until re-checked.

### U-B0.3 — `partner.*` and cross-cutting

#### `partner.factory-name` — published differently

Decisions: D-140, D-044

- **GET /v1/partner/me** — published differently → `partner.me.get` (`GET /v1/partner/me`)
  - FactoryAccessDto.factoryId → same
  - FactoryAccessDto.roles → same (string[], not a named FactoryRole enum)
  - FactoryAccessDto.name → missing-on-backend (workaround: partner.factories.list → FactoryDto.tradeName ?? legalName, plus code)
  - **gap (U-B0.3):** Add `name: string` (tradeName ?? legalName) and `code: string` to FactoryAccessDto
  - **gap (U-B0.3):** Type FactoryAccessDto.roles / PartnerMeDto.roles as the named FactoryRole enum
  - *note:* Additive only; the FE workaround via partner.factories.list stays valid.

#### `partner.references` — implement here (U-B0.3)

Decisions: D-044, D-040

- **GET /v1/partner/factories/{factoryId}/references** — implement here
  - **scope (U-B0.3, `partners`):** partners/pricing: names/codes of the catalogue records the factory's own price lines reference (and those it may add lines for, i.e. its capabilities) + its product types; own factory only, no price values (D-044, D-040); permission factory_prices.read.
  - *note:* Not a D-044 problem: returns catalogue names, never other factories' prices. Consider keying by PriceComponent `ref` dimension keys (materialId, printTypeId, finishId…) as listComponents already exposes them.

#### `partner.change-requests` — implement here (U-B0.3)

Decisions: D-021, D-173, D-043, D-167, D-022, D-041

- **GET /v1/partner/factories/{factoryId}/change-requests** — implement here
  - **scope (U-B0.3, `partners`):** New factory_change_requests table + list of the factory's own requests (topic, message, preferredDates, status open|in_progress|done|declined, response); permission factory_profile.read.
- **POST /v1/partner/factories/{factoryId}/change-requests** — implement here
  - **scope (U-B0.3, `partners`):** Create a request (topic enum incl. capability, capacity, delivery_zones, tolerance, participation_tier, pricing_arrangement, payout_policy, site_visit; 422 when site_visit lacks a future date); one tx + audit + outbox event for the Partner team notification; permission factory_profile.manage (owner); Idempotency-Key recommended.
  - *note:* Admin queue (F2.6) is a follow-up; also needs a named FactoryChangeRequestTopic/Status enum. Touches D-021, D-173, D-043, D-167, D-022, D-041 only as topics — no business value changes without staff.

#### `partner.site-visits` — implement here (U-B0.3)

Decisions: D-041

- **GET /v1/partner/factories/{factoryId}/site-visits** — implement here
  - **scope (U-B0.3, `partners`):** partners/site-visits (service exists): own factory's visits projected to {id, visitedOn, result: SiteVisitResult, notes, createdAt} — no inspectors, checklist or photos; permission factory_profile.read.
  - *note:* Reuse the named SiteVisitResult enum (pass|conditional|fail) instead of the FE inline enum. uncertain: whether SiteVisitDto.notes are written for the factory — may need a separate factory-facing note.

#### `partner.proposal-evidence` — implement here (U-B0.3)

Decisions: D-040

- **GET /v1/partner/factories/{factoryId}/price-proposals/{proposalId}/evidence** — implement here
  - **scope (U-B0.3, `partners`):** partners/pricing: list attachments(subject=price_proposal) of the own proposal; also expose on the admin proposal review; permission factory_prices.read.
- **POST /v1/partner/factories/{factoryId}/price-proposals/{proposalId}/evidence** — implement here
  - **scope (U-B0.3, `partners`):** Attach a completed, clean file (partner.files.* presign flow) with note ≤ 500; 409 price.proposal_closed once decided; audit + activity; permission factory_prices.propose; Idempotency-Key.

#### `partner.today` — implement here (U-B0.3)

Decisions: D-074, D-076, D-101

- **GET /v1/partner/factories/{factoryId}/today** — implement here
  - **scope (U-B0.3, `production`):** production: counters (awaiting_acceptance, milestones due today per business calendar Asia/Bangkok, at_risk, on_hold), ordered work queue and alerts (acceptance SLA overdue/due soon D-074, planned inspection D-076); permission factory_jobs.read.
  - *note:* Queue items should reuse whatever summary DTO the jobs list uses (see partner.jobs).

#### `partner.jobs` — mixed: 4 published differently · 1 implement here

Decisions: D-074, D-012, D-101, D-142, D-044

- **GET /v1/partner/factories/{factoryId}/jobs** — published differently → `partner.production.list` (`GET /v1/partner/production-jobs`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044): GET /v1/partner/production-jobs
  - query view (to_accept|in_production|awaiting_qc|ready_to_ship|late|all) → queue (awaiting_acceptance|at_risk|escalated) + status (ProductionJobStatus); to_accept→queue=awaiting_acceptance, in_production→status=in_progress, late→queue=at_risk, awaiting_qc/ready_to_ship → missing-on-backend
  - query page/perPage/sort/order/q → same; orderId extra-on-backend
  - envelope {data, meta{page,perPage,total}} → same (PageMeta)
  - data[] PartnerJobSummaryDto → PartnerJobDto (full job in list)
  - id, jobNo, kind (JobKind), status (ProductionJobStatus), inspectionRequired → same
  - quantity → quantityOrdered (rename); quantityGood/quantityScrap extra
  - acceptDueAt (nullable) → acceptDueAt (non-null string)
  - promisedShipDate (non-null) → promisedShipDate (nullable)
  - productType {code,name} → missing-on-backend (only inside the untyped `spec` object)
  - title → missing-on-backend
  - atRisk, riskReason → missing-on-backend (only the queue=at_risk filter; holdReason extra)
  - current {seq,key,name,status,dueAt} → derive from milestones[] (first not completed)
  - views[] → missing-on-backend
  - **gap (U-B0.3):** productType ref {code,name} and title on PartnerJobDto
  - **gap (U-B0.3):** atRisk + riskReason (SLA engine already stores at_risk_since)
  - **gap (U-B0.3):** view filters awaiting_qc / ready_to_ship (or accept a status[] list)
  - **gap (U-B0.3):** optional factoryId query filter for users holding roles at several factories
  - *note:* Backend wins on status/kind vocabularies (identical enums already).
- **GET /v1/partner/factories/{factoryId}/jobs/{jobId}** — published differently → `partner.production.get` (`GET /v1/partner/production-jobs/{jobId}`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - spec [{label,value}] → spec (open object, snapshot) — type
  - artwork {versionNo,approvedAt,proof,dieline} → approvedFileId / dielineFileId (download via partner.files.download; approved version only) — nesting; versionNo/approvedAt missing-on-backend
  - purchaseOrder {poNumber,issuedAt,buyAmount,currency} → missing-on-job (partner.payables.listPurchaseOrders / getPurchaseOrder)
  - tolerance → missing-on-backend
  - destinations[] PartnerDestinationDto → JobDestinationDto: recipientName, phone, postcode, quantity same; address → line1 + line2; province → missing; shippedQuantity → missing
  - milestones[] PartnerJobMilestoneDto → MilestoneDto: seq, key, status, dueAt, startedAt, completedAt, quantityIn/Out/Scrap, note, onTime same; name → nameTh/nameEn; requiresPhoto/requiresQc → evidence (EvidenceRequirement none|photo|qc_form|photo_and_qc_form); photos[] → photoFileIds[]; reportedBy → missing; id, tracksQuantity, customerVisible extra
  - qcChecks → separate partner.production.listQc (QcCheckDto)
  - issues → separate partner.production.listIssues (JobIssueDto)
  - qcChecklist, inspections, history, nextActions, rejectedReason → missing-on-backend
  - acceptedAt, releasedAt, lotNo, plannedStartOn/FinishOn, holdReason extra-on-backend
  - **gap (U-B0.3):** tolerance, qcChecklist (route checklist), inspections (factory-safe view), destination province + shippedQuantity, artwork versionNo/approvedAt, rejectedReason, nextActions (see entity.next-actions)
  - *note:* D-142: recipients as name/address/phone only — backend already complies; buy amount is the factory's own PO, no selling price.
- **POST /v1/partner/factories/{factoryId}/jobs/{jobId}/actions/accept** — published differently → `partner.production.accept` (`POST /v1/partner/production-jobs/{jobId}/actions/accept`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - body {clientRef, clientReportedAt} → no body; replay protection via required Idempotency-Key
  - response PartnerJobDto (FE) → PartnerJobDto (BE shape above)
  - *note:* Permission factory_jobs.respond (not factory_jobs.accept).
- **POST /v1/partner/factories/{factoryId}/jobs/{jobId}/actions/reject** — published differently → `partner.production.reject` (`POST /v1/partner/production-jobs/{jobId}/actions/reject`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - reason → reasonCode (rename)
  - JobRejectReason enum values: capacity, spec_not_feasible, price, other same; material → material_unavailable; machine → missing-on-backend (use capacity/other); artwork_issue extra-on-backend
  - note → note (same, optional)
  - clientRef/clientReportedAt → not accepted; Idempotency-Key required
  - *note:* Backend owns JobRejectReason; FE should import Schemas["JobRejectReason"].
- **GET /v1/partner/factories/{factoryId}/jobs/lookup** — implement here
  - **scope (U-B0.3, `production`):** production: resolve a scanned/typed code (jobNo, job QR, carton label code) to {jobId, jobNo} within the token's factories, 404 otherwise; permission factory_jobs.read.
  - *note:* Typed jobNo alone is already served by partner.production.list?q=; the carton label code → job mapping is logistics data.

#### `partner.job-milestones` — published differently

Decisions: D-075, D-076, D-155

- **POST /v1/partner/factories/{factoryId}/jobs/{jobId}/milestones/{seq}/actions/complete** — published differently → `partner.production.updateMilestone` (`POST /v1/partner/production-jobs/{jobId}/milestones/{milestoneId}`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - path {seq} → {milestoneId} (uuid, MilestoneDto.id)
  - /actions/complete → body action: "complete" (MilestoneAction)
  - clientRef → same (uuid, required)
  - clientReportedAt → same (optional on BE)
  - quantityIn/Out/Scrap → same (optional on BE; required only on tracksQuantity steps)
  - photoFileIds → same (optional on BE, required by the step's evidence)
  - note → same
  - shareWithCustomer extra-on-backend
  - response PartnerJobDto → MilestoneUpdateResultDto {applied, job: PartnerJobDto, reason: MilestoneUpdateOutcome|null} — envelope
  - 409 job.conflict (server wins) → 200 applied:false with reason (duplicate|already_started|already_completed|skipped) and the current job
  - *note:* FE should reload from `job` when applied=false.
- **POST /v1/partner/factories/{factoryId}/jobs/{jobId}/milestones/{seq}/actions/start** — published differently → `partner.production.updateMilestone` (`POST /v1/partner/production-jobs/{jobId}/milestones/{milestoneId}`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - path {seq} → {milestoneId}
  - /actions/start → body action: "start"
  - clientRef, clientReportedAt → same
  - response → MilestoneUpdateResultDto envelope
  - *note:* Permission factory_milestones.update (not factory_jobs.update).

#### `partner.job-qc` — published differently

Decisions: D-076, D-155

- **POST /v1/partner/factories/{factoryId}/jobs/{jobId}/qc-checks** — published differently → `partner.production.recordQc` (`POST /v1/partner/production-jobs/{jobId}/qc-checks`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - checklist [{key,pass,note}] → checklist (object keyed by item) + checklistVersion (required) — type
  - result (QcResult) → same
  - defects [{label,count}] → defects QcDefectDto[] {code, count, severity: DefectSeverity, note?} — label→code, severity required
  - photoFileIds (1–20) → photoFileIds (required)
  - notes → note (rename)
  - quantityChecked, quantityDefective extra-on-backend
  - clientRef/clientReportedAt → not accepted; Idempotency-Key required
  - response 201 PartnerJobDto → 201 QcCheckDto {id, result, isFirstPass, checklist, checklistVersion, defects, photoFileIds, note, performedAt, quantity*} — FE refetches the job
  - PartnerQcCheckDto.performedBy/photos (file objects) → missing (photoFileIds only)
  - **gap (U-B0.3):** performedBy on QcCheckDto
  - **gap (U-B0.3):** route QC checklist on the job (qcChecklist) so the FE can render items + checklistVersion
  - *note:* First pass decided server-side (D-155) — matches FE intent. Permission factory_qc.record (same key).

#### `partner.job-issues` — mixed: 1 published differently · 1 implement here

Decisions: D-074

- **POST /v1/partner/factories/{factoryId}/jobs/{jobId}/issues** — published differently → `partner.production.raiseIssue` (`POST /v1/partner/production-jobs/{jobId}/issues`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - kind (JobIssueKind enum material|machine|artwork|quantity|quality|delay|other) → kind (free string) — type
  - description → same
  - photoFileIds → same (optional)
  - clientRef/clientReportedAt → not accepted; no Idempotency-Key on BE
  - response PartnerJobDto → JobIssueDto {id, kind, description, status: IssueStatus, resolutionNote, resolvedAt, createdAt}
  - PartnerJobIssueDto.photos, raisedBy → missing; raisedAt → createdAt; JobIssueStatus → IssueStatus (same values)
  - **gap (U-B0.3):** Named JobIssueKind enum for `kind` (FE list is a good start)
  - **gap (U-B0.3):** Idempotency-Key + clientRef on raiseIssue like the other shop-floor writes
  - **gap (U-B0.3):** photos + raisedBy on JobIssueDto
- **POST /v1/partner/factories/{factoryId}/jobs/{jobId}/issues/{issueId}/actions/resolve** — implement here
  - **scope (U-B0.3, `production`):** production: let the factory close its own issue (note, clientRef, Idempotency-Key) with audit + outbox; permission factory_issues.raise.
  - *note:* uncertain: backend currently treats resolution as a Packio staff answer (admin.production.resolveIssue, "Packio staff answer it"); confirm with the business whether a factory may self-resolve (e.g. machine fixed) or only staff — if staff only, drop this op instead of implementing.

#### `partner.capacity-calendar` — implement here (U-B0.3)

Decisions: D-101, D-161

- **GET /v1/partner/factories/{factoryId}/capacity-calendar** — implement here
  - **scope (U-B0.3, `partners`):** partners/capacity + platform/calendar: weeks × product types {capacity, booked, free} (decimal strings like CapacityWeekDto) and closures from the national calendar (only days that count as non-working, D-161) plus the factory's own; permission factory_capacity.read.
  - *note:* Capacity values are strings in CapacityWeekDto — FE should keep them as decimal strings. Depends on the B6.3 launch gap (admin CRUD for business_calendar_days).
  - *note:* D-209: the factory's own business hours and closures are edited by its Owner or Planner and by the Partner Manager. The change is audited, takes effect from the next day, needs no approval, and never shortens the SLA of a job already accepted. This read shows them; the partner-side write belongs to U2.9 (post-launch), and the staff write is part of the B6.3 calendar gap below.

#### `partner.shipments` — mixed: 2 implement here · 5 published differently

Decisions: D-013, D-114, D-110, D-021, D-080, D-165, D-142

- **GET /v1/partner/factories/{factoryId}/ship-plan** — implement here
  - **scope (U-B0.3, `logistics`):** logistics: completed jobs of the factory with quantityGood and per-destination remaining quantity (ordered − in live shipments), blockedReason inspection_pending|payment_pending (same checks as dispatch); permission factory_shipments.read.
- **GET /v1/partner/factories/{factoryId}/shipments** — published differently → `partner.shipments.list` (`GET /v1/partner/shipments`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - query view (open|in_transit|delivered|all) → status (single ShipmentStatus): open≈draft|ready, in_transit≈picked_up|in_transit|out_for_delivery, delivered=delivered — missing multi-value
  - page/perPage/sort/order/q → same; orderId extra
  - envelope {data, meta} → same
  - PartnerShipmentDto (FE) → PartnerShipmentDto (BE): id, shipmentNo, status (ShipmentStatus same values), carrier (CarrierCode same), trackingNo, weightG, readyAt, pickedUpAt, deliveredAt → same (weightG non-null on BE)
  - job {id,jobNo,title,productType} → items[] ShipmentItemDto {jobId, jobNo, orderCode, destinationId, quantity, deliveredQuantity} — nesting; title/productType missing
  - destination {id,recipientName,phone,address,province,postcode} → ShipmentDestinationDto {recipientName, phone, line1, line2, postcode}; id → items[].destinationId; province missing
  - quantity → sum(items[].quantity)
  - cartons → cartonsCount (rename)
  - carrierRequested → missing-on-backend
  - promisedShipDate → plannedShipOn (different meaning: planned ship date of the trip)
  - podRequired → implied true for carrier=factory_fleet (D-013); hasPod → proofOfDelivery != null
  - extra-on-backend: labelFileId, packingListFileId, events[], proofOfDelivery, note, volumeCm3
  - **gap (U-B0.3):** view grouping or status[] filter
  - **gap (U-B0.3):** carrierRequested flag once request-carrier exists
- **POST /v1/partner/factories/{factoryId}/shipments** — published differently → `partner.shipments.create` (`POST /v1/partner/shipments`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - {jobId, destinationId, quantity} → items: [{jobId, destinationId, quantity}] (one trip may carry several job lines to one address) — nesting
  - cartons → cartonsCount (rename)
  - weightG optional → weightG required
  - clientRef/clientReportedAt → not accepted; Idempotency-Key required
  - plannedShipOn, volumeCm3, note extra-on-backend
  - response PartnerShipmentDetailDto → PartnerShipmentDto (status draft)
  - *note:* Labels and packing list are generated by a separate step partner.shipments.markReady (POST /v1/partner/shipments/{shipmentId}/actions/ready) that the FE flow lacks; partner.shipments.cancel and partner.shipments.updateStatus (own-fleet transit steps) also exist.
- **GET /v1/partner/factories/{factoryId}/shipments/{shipmentId}** — published differently → `partner.shipments.get` (`GET /v1/partner/shipments/{shipmentId}`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - PartnerShipmentDto (FE) → PartnerShipmentDto (BE): id, shipmentNo, status (ShipmentStatus same values), carrier (CarrierCode same), trackingNo, weightG, readyAt, pickedUpAt, deliveredAt → same (weightG non-null on BE)
  - job {id,jobNo,title,productType} → items[] ShipmentItemDto {jobId, jobNo, orderCode, destinationId, quantity, deliveredQuantity} — nesting; title/productType missing
  - destination {id,recipientName,phone,address,province,postcode} → ShipmentDestinationDto {recipientName, phone, line1, line2, postcode}; id → items[].destinationId; province missing
  - quantity → sum(items[].quantity)
  - cartons → cartonsCount (rename)
  - carrierRequested → missing-on-backend
  - promisedShipDate → plannedShipOn (different meaning: planned ship date of the trip)
  - podRequired → implied true for carrier=factory_fleet (D-013); hasPod → proofOfDelivery != null
  - extra-on-backend: labelFileId, packingListFileId, events[], proofOfDelivery, note, volumeCm3
  - cartonList [{seq,labelCode,trackingUrl,weightG}] → labelFileId (one PDF of all labels) — missing per-carton rows
  - packingList [{label,quantity}] → packingListFileId (file)
  - events [{occurredAt,status,note}] → events ShipmentEventDto (+ source, location)
  - pod {receiverName,deliveredQuantity,capturedAt,photos,signature,capturedBy,review,reviewNote} → proofOfDelivery ProofOfDeliveryDto {kind, receiverName, deliveredQuantity, capturedAt, photoFileIds, signatureFileId, carrierPodRef}; capturedBy/review/reviewNote missing
  - tolerance, blockedByPayment, nextActions → missing-on-backend
  - **gap (U-B0.3):** per-carton label rows with labelCode + public tracking URL
  - **gap (U-B0.3):** blockedByPayment / blocked reason
  - **gap (U-B0.3):** tolerance result after POD
  - **gap (U-B0.3):** nextActions
- **POST /v1/partner/factories/{factoryId}/shipments/{shipmentId}/actions/dispatch** — published differently → `partner.shipments.dispatch` (`POST /v1/partner/shipments/{shipmentId}/actions/dispatch`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - body {clientRef, clientReportedAt} → no body; Idempotency-Key required
  - 409 shipments.payment_pending → same; also 409 shipments.inspection_pending
  - response → PartnerShipmentDto
- **POST /v1/partner/factories/{factoryId}/shipments/{shipmentId}/actions/request-carrier** — implement here
  - **scope (U-B0.3, `logistics`):** logistics: factory asks Packio for the fallback carrier (D-013 fallback, D-114) with a reason; creates a task/event for Logistics, who books via admin.shipments.bookCarrier; permission factory_shipments.manage; Idempotency-Key.
  - *note:* The factory must not book a carrier itself — booking stays admin.shipments.bookCarrier.
- **POST /v1/partner/factories/{factoryId}/shipments/{shipmentId}/pod** — published differently → `partner.shipments.recordPod` (`POST /v1/partner/shipments/{shipmentId}/proof-of-delivery`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - /pod → /proof-of-delivery (path)
  - receiverName → same
  - deliveredQuantity → items: [{destinationId, deliveredQuantity}] — nesting
  - capturedAt → same (optional on BE)
  - photoFileIds (1–10, required) → photoFileIds (optional in DTO; business rule requires ≥ 1 for factory deliveries)
  - signatureFileId → same (optional in DTO)
  - lat, lng → same
  - note, carrierPodRef extra
  - clientRef/clientReportedAt → not accepted; Idempotency-Key required
  - response 201 → PartnerShipmentDto
  - *note:* Tolerance judgement (D-021, D-080, D-165) happens server-side on POD — matches FE intent.

#### `partner.permissions` — published differently

Decisions: D-140, D-141

- **factory-scope permission keys** — published differently
  - factory_jobs.read → factory_jobs.read (same; all six roles)
  - factory_jobs.accept → factory_jobs.respond (accept + reject; owner, planner)
  - factory_jobs.update → factory_milestones.update (owner, planner, operator, qc, shipping — not accountant)
  - (new) factory_issues.raise → owner, planner, operator, qc, shipping
  - factory_qc.record → same (owner, qc)
  - factory_shipments.read → same (owner, planner, shipping — accountant does NOT have it, FE proposed it)
  - factory_shipments.manage → same (owner, shipping)
  - factory_billing.read → factory_payables.read (owner, accountant)
  - factory_billing.confirm → factory_payables.manage (owner, accountant)
  - factory_payouts.read → factory_payables.read (owner, accountant)
  - factory_claims.read → same (owner, planner, qc)
  - factory_claims.respond → same but owner + qc (FE: owner only)
  - factory_scorecard.read → same (owner, planner, qc)
  - factory_users.manage → same (owner)
  - factory_capacity.read/manage, factory_prices.*, factory_rate_card.accept, factory_rfq.* extra (already in rbac.md)
  - shipping role: FE proposed factory_jobs.read only → BE also grants factory_milestones.update + factory_issues.raise
  - *note:* FE should key its mock personas and guards on the rbac.md names; PartnerMeDto.permissions returns them.

#### `partner.billing-statements` — published differently

Decisions: D-090, D-022, D-165

- **GET /v1/partner/factories/{factoryId}/billing-statements** — published differently → `partner.payables.listStatements` (`GET /v1/partner/billing-statements`)
  - path factoryId → query factoryId (optional)
  - status → status (plain string on BE; values BillingStatementStatus)
  - page/perPage/sort/order/q → same; envelope same
  - id, bsNumber, periodFrom, periodTo, status → same
  - totals {production,shipping,deductions,net,vat,gross,alreadyPaid,remaining} → netAmount, vatAmount, grossAmount (flat) — production/shipping/deductions/alreadyPaid/remaining missing
  - generatedAt → missing
  - currency → missing (THB implied)
  - taxInvoiceStatus, inputVatStatus → missing on statement (on VendorInvoiceDto only)
  - confirmedAt, disputeNote, factoryId, lines extra in list
  - **gap (U-B0.3):** totals breakdown by line kind + alreadyPaid/remaining (D-022 advance offset)
  - **gap (U-B0.3):** generatedAt
  - **gap (U-B0.3):** taxInvoiceStatus / inputVatStatus summary
  - **gap (U-B0.3):** named BillingStatementStatus on the status query
- **GET /v1/partner/factories/{factoryId}/billing-statements/{statementId}** — published differently → `partner.payables.getStatement` (`GET /v1/partner/billing-statements/{statementId}`)
  - path → /v1/partner/billing-statements/{statementId}
  - summary fields as in the list mapping
  - lines [{id,kind,description,reference,quantity,amount}] → BillingStatementLineDto {lineNo, description, netAmount, vatAmount, grossAmount}: id→lineNo, kind/reference/quantity missing, amount→netAmount
  - confirmedBy → missing
  - confirmedAt, disputeNote → same
  - taxInvoices PartnerVendorInvoiceDto[] → missing
  - nextActions → missing
  - **gap (U-B0.3):** line kind (production|shipping|deduction|advance_offset), reference, quantity (min(delivered, shipped), D-165)
  - **gap (U-B0.3):** confirmedBy
  - **gap (U-B0.3):** taxInvoices on the statement (VendorInvoiceDto list)
  - **gap (U-B0.3):** nextActions
- **POST /v1/partner/factories/{factoryId}/billing-statements/{statementId}/actions/confirm** — published differently → `partner.payables.confirmStatement` (`POST /v1/partner/billing-statements/{statementId}/actions/confirm`)
  - path → /v1/partner/billing-statements/{statementId}/actions/confirm
  - body {note?} → no body
  - Idempotency-Key required (same)
  - response BillingStatementDto
- **POST /v1/partner/factories/{factoryId}/billing-statements/{statementId}/actions/dispute** — published differently → `partner.payables.disputeStatement` (`POST /v1/partner/billing-statements/{statementId}/actions/dispute`)
  - path → /v1/partner/billing-statements/{statementId}/actions/dispute
  - note → note (same)
  - lineIds → missing-on-backend
  - response BillingStatementDto
  - **gap (U-B0.3):** optional disputed line references
- **POST /v1/partner/factories/{factoryId}/billing-statements/{statementId}/tax-invoices** — published differently → `partner.payables.submitTaxInvoice` (`POST /v1/partner/billing-statements/{statementId}/tax-invoices`)
  - path → /v1/partner/billing-statements/{statementId}/tax-invoices
  - invoiceNo → vendorInvoiceNo (rename)
  - invoiceDate, sellerTaxId, sellerBranchCode → same
  - source (pdf_upload|e_tax) → source TaxInvoiceCaptureSource (same values)
  - fileId → same (optional)
  - eTaxReference → missing-on-backend
  - netAmount, vatAmount → required on backend (missing in FE — backend wins: the factory keys the amounts of its own invoice, Finance validates them, accounting-design §2)
  - response PartnerBillingStatementDto → VendorInvoiceDto (status recorded|validated|rejected|void, inputVatStatus)
  - **gap (U-B0.3):** eTaxReference (or document it as carried in fileId for e_tax)
  - *note:* FE VendorInvoiceStatus local union has `submitted`; backend is recorded|validated|rejected|void. Permission factory_payables.manage.

#### `partner.payouts` — mixed: 3 implement here · 1 published differently

Decisions: D-022, D-164, D-093, D-166

- **GET /v1/partner/factories/{factoryId}/payout-schedule** — implement here
  - **scope (U-B0.3, `payables`):** payables/payouts: per job the advance/balance/retention items from the snapshotted payout policy (D-022, D-164) with PayableStatus, eligibleAt, waitingFor and paidOn/payoutId; permission factory_payables.read.
- **GET /v1/partner/factories/{factoryId}/payouts** — published differently → `partner.payables.payoutStatement` (`GET /v1/partner/factories/{factoryId}/payouts`)
  - path → same
  - query page/perPage/sort/order/q → from/to (date); no pagination — response is a plain array, not {data, meta}
  - id, pvNumber (nullable on BE), paidOn → same
  - status PayoutItemStatus → missing (BE kind: PayoutKind)
  - gross → apNetAmount (+ vatAmount)
  - wht → whtAmount
  - deductions → retentionAmount (claim deductions are not a separate field)
  - net → cashAmount
  - currency → missing (THB)
  - bankLast4 → bankAccountLast4 (nullable)
  - whtCertificates[] (ids for partner.payables.whtCertificatePdf) extra-on-backend
  - **gap (U-B0.3):** status per payout
  - **gap (U-B0.3):** claim-deduction amount separate from retention
  - **gap (U-B0.3):** decide pagination vs from/to (backend currently from/to only)
- **GET /v1/partner/factories/{factoryId}/payouts/{payoutId}** — implement here
  - **scope (U-B0.3, `payouts`):** payouts: one payout with allocations (job/BS references and amounts), remittance advice file, WHT certificate (existing partner.payables.whtCertificatePdf for the download) and failureReason; own factory only; permission factory_payables.read.
- **GET /v1/partner/factories/{factoryId}/statement-of-account** — implement here
  - **scope (U-B0.3, `payables`):** payables: vendor sub-ledger between from/to with opening, entries (BS, payout, deduction, advance) and closing balance as decimal strings; permission factory_payables.read.

#### `partner.claims` — published differently

Decisions: D-082, D-083, D-142

- **GET /v1/partner/factories/{factoryId}/claims** — published differently → `partner.claims.list` (`GET /v1/partner/claims`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - status (ClaimStatus) → same; orderId filter extra
  - envelope same
  - id, claimNo, type (ClaimType), status, submittedAt, liability (ClaimLiability), factoryResponse (FactoryClaimResponse) → same
  - job {id,jobNo} → jobId, jobNo (flat, nullable)
  - shipmentNo → missing
  - responseDueAt → missing (windowEndsAt is the customer claim window, not the factory response due)
  - deduction → missing
  - extra: orderId, orderCode, origin, receivedAt, claimedAmount, infoRequest, resolutions, photos
  - **gap (U-B0.3):** shipmentNo
  - **gap (U-B0.3):** factory responseDueAt
  - **gap (U-B0.3):** deduction amount against the factory
- **GET /v1/partner/factories/{factoryId}/claims/{claimId}** — published differently → `partner.claims.get` (`GET /v1/partner/claims/{claimId}`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - summary fields as in list
  - description, requestedResolution (ClaimResolutionKind same values), claimedQuantity → same
  - evidence [{role,file}] → photos {product: uuid[], carton: uuid[]} (download via files API); role factory → missing
  - factoryNote → factoryResponseNote
  - factoryRespondedAt → missing
  - decision → decisionNote
  - deductions [{id,amount,status,appliedOn}] → missing (resolutions[] is the customer-side resolution)
  - nextActions → missing
  - **gap (U-B0.3):** factory evidence files
  - **gap (U-B0.3):** factoryRespondedAt
  - **gap (U-B0.3):** deductions list
  - **gap (U-B0.3):** nextActions
  - *note:* D-142: backend exposes orderCode but no customer identity — compliant.
- **POST /v1/partner/factories/{factoryId}/claims/{claimId}/actions/respond** — published differently → `partner.claims.respond` (`POST /v1/partner/claims/{claimId}/actions/respond`)
  - path: FE /v1/partner/factories/{factoryId}/... → BE token-scoped path without factoryId (other factories are 404, D-044)
  - response (accepted|disputed) → same
  - note (required, 3–2000) → note (optional)
  - evidenceFileIds → missing-on-backend
  - Idempotency-Key → same
  - response PartnerClaimDto → same name, BE shape
  - **gap (U-B0.3):** evidenceFileIds (attachments role claim.factory_evidence)
  - *note:* Permission factory_claims.respond (owner + qc on BE).

#### `partner.scorecard` — published differently

Decisions: D-155, D-075

- **GET /v1/partner/factories/{factoryId}/scorecards** — published differently → `partner.production.scorecards` (`GET /v1/partner/factories/{factoryId}/scorecards`)
  - path → same
  - query months → missing-on-backend (returns all months)
  - PartnerScorecardDto → ScorecardDto
  - month "YYYY-MM" → "YYYY-MM-01" (first day of the month) — format
  - jobsCount, onTimeAcceptancePct, onTimeShippingPct, qcFirstPassPct, claimRatePct, onTimeUpdatesPct → same (decimal strings, nullable)
  - computedAt nullable → non-null
  - **gap (U-B0.3):** optional months (1–24) limit
  - *note:* Permission factory_scorecard.read (same key).

#### `partner.users` — published differently

Decisions: D-140, D-171

- **GET /v1/partner/factories/{factoryId}/users** — published differently → `partner.factoryUsers.list` (`GET /v1/partner/factories/{factoryId}/users`)
  - id, displayName, email → same
  - roles FactoryRole[] → string[] (unnamed)
  - status, lastSignInAt, isSelf → missing-on-backend
  - **gap (U-B0.3):** status (UserStatus) and lastSignInAt on FactoryUserDto
  - **gap (U-B0.3):** isSelf (or compare with PartnerMeDto.id client-side)
  - **gap (U-B0.3):** roles typed as FactoryRole
- **POST /v1/partner/factories/{factoryId}/users** — published differently → `partner.factoryUsers.create` (`POST /v1/partner/factories/{factoryId}/users`)
  - email, displayName → same
  - roles FactoryRole[] → FactoryStaffRole[] — factory_owner not allowed (D-171: owners are invited by Packio)
  - initialPassword (min 12, handed over out of band) → required on backend, missing in FE — backend wins (no e-mail invitation flow exists)
  - response PartnerFactoryUserDto → FactoryUserDto
  - *note:* Status `invited` has no backend equivalent — users are created active with a password to change at first sign-in.
- **PATCH /v1/partner/factories/{factoryId}/users/{userId}** — published differently → `partner.factoryUsers.deactivate` (`POST /v1/partner/factories/{factoryId}/users/{userId}/actions/deactivate`)
  - status: deactivated → POST …/users/{userId}/actions/deactivate (204, no body)
  - status: active (reactivate) → missing-on-backend
  - roles change → missing-on-backend
  - 409 users.last_owner → not applicable: owners are managed by Packio (D-171)
  - **gap (U-B0.3):** Endpoint to change a staff user's factory roles (FactoryStaffRole[], audited, SoD) — e.g. PUT …/users/{userId}/roles
  - *note:* Permission factory_users.manage (owner).

#### `partner.notification-preferences` — implement here (U-B0.3)

Decisions: D-143, D-144

- **GET /v1/partner/me/notification-preferences** — implement here
  - **scope (U-B0.3, `platform/notifications (src/platform/notifications — not under src/modules)`):** Partner MeController twin of store.me.notificationPreferences for web_push, line, email (D-143) with locked rows (jobs to accept) and lineLinked; reuse NotificationPreferenceDto (+ locked) and named enums.
  - *note:* The FE per-kind categories (jobs, shipping, prices, billing, claims, account) are a new vocabulary vs NotificationCategory (transactional|marketing|security); backend must decide — either extend NotificationCategory or map kinds onto event-type groups.
- **PUT /v1/partner/me/notification-preferences** — implement here
  - **scope (U-B0.3, `platform/notifications (src/platform/notifications — not under src/modules)`):** Set the partner user's channel choices; locked rows rejected with 422; audit row.

#### `status.enums` — published differently

- **components on /v1/{store,admin,partner}/* responses** — published differently
  - OrderStatus, PaymentStatus, InstalmentStatus, ArtworkStatus, ProofStatus, RfqStatus, ShipmentStatus, ClaimStatus → same names, identical values (FE local InstalmentStatus, QuoteStatus, MemoStatus, CompanyStatus, CreditStatus, CampaignStatus, PromotionStatus, CouponStatus, PointsStatus, MemberStatus, ReferralStatus, PreflightStatus, SubmissionStatus, DrawingStatus, DesignServiceStatus, DesignRoundStatus, RfqQuoteStatus, ConsultationStatus, MilestoneStatus, InspectionStatus, CatalogStatus, ContentStatus, QcResult also identical → switch to Schemas[…])
  - JobStatus (production) → ProductionJobStatus — rename; NOTE backend `JobStatus` is a different enum (queued|running|succeeded|failed, background jobs) — FE must not bind to it
  - PayoutStatus → PayoutRunStatus (draft|proposed|approved|file_generated|confirmed|partially_failed|rejected|cancelled) — FE-only values pending_approval, sent, posted; BE-only rejected; per-item: PayoutItemStatus, per-payable: PayableStatus
  - DocumentStatus → CustomerDocumentStatus (issued|void)
  - JobIssueStatus → IssueStatus (same values)
  - VendorInvoiceStatus → VendorInvoiceStatus: FE `submitted` → BE `recorded`; BE-only `void`
  - StatementStatus, PodReviewStatus, ChangeRequestStatus, FactoryUserStatus, DunningStatus → missing-on-backend (their endpoints are not published yet; named when they ship)
  - **gap (U-B0.3):** Consider renaming the background `JobStatus` enum (e.g. AsyncJobStatus) to remove the collision with the production job vocabulary — contract-breaking, so additive + deprecate (U1)
  - *note:* api-conventions §3 already requires named enums and contract:lint fails on inline enums.

#### `entity.next-actions` — implement here (U-B0.3)

- **responses for orders, jobs, RFQs, claims, payouts, documents** — implement here
  - **scope (U-B0.3, `orders, production, logistics, rfq, claims, payables, payouts, receivables (shared DTO in src/common)`):** Shared `NextActionDto { key (named enum per domain, snake_case with prefix), irreversible, disabledReason }` computed server-side from the same state-machine/permission checks the action endpoints use; additive field on each entity DTO.
  - *note:* FE per-entity requests (PartnerJobDto, PartnerShipmentDetailDto, PartnerBillingStatementDto, PartnerClaimDto) already assume it. Keep keys as named enums so FE maps are exhaustive.

#### `rum.web-vitals` — implement here (U-B0.3)

Decisions: D-144

- **POST /v1/{store,admin,partner}/rum/web-vitals** — implement here
  - **scope (U-B0.3, `ops`):** ops: accept {name LCP|INP|CLS|FCP|TTFB (named enum), value, rating, id, route (pattern, validated to contain no ids/tokens), zone} → 202; rate-limited, no PII, aggregated into ops signals / metrics; public on store (anonymous) and authenticated on admin/partner.
  - *note:* PDPA (D-144 cited by FE): reject anything that is not a route pattern. No decision id governs RUM; performance budgets are an FE doc.

#### `notifications.unread-and-link` — mixed: 1 published differently · 1 implement here

Decisions: D-143

- **GET /v1/{surface}/notifications** — published differently → `partner.notifications.list` (`GET /v1/partner/notifications (also store.notifications.list, admin.notifications.list)`)
  - meta.unreadCount → missing-on-backend (CursorMeta has nextCursor only)
  - InboxItemDto.url → missing-on-backend
  - InboxItemDto: id, title, body, eventType, readAt, createdAt → present
  - **gap (U-B0.3):** meta.unreadCount on the inbox response (separate meta schema, not CursorMeta)
  - **gap (U-B0.3):** url: string|null (zone-relative path) on InboxItemDto, derived from the event subject per surface
- **POST /v1/{surface}/notifications/actions/read-all** — implement here
  - **scope (U-B0.3, `platform/notifications (src/platform/notifications — not under src/modules)`):** inboxController(surface): mark all of the caller's unread notifications read (optionally up to a createdAt watermark) → 204; realtime signal to other tabs.

#### `analytics.events` — published differently

Decisions: D-102, D-144

- **POST /v1/store/analytics/events** — published differently → `store.analytics.ingest` (`POST /v1/store/analytics/events`)
  - body single event → AnalyticsEventBatchDto {events: AnalyticsEventDto[] ≤ 50} — envelope
  - name (13-name union) → name AnalyticsEventName (page_view|configurator_step|quote_shown|add_to_cart|checkout_step): page_view/product_viewed → page_view; configurator_opened/configuration_changed → configurator_step; quote_shown → quote_shown; cart_item_added → add_to_cart; checkout_started → checkout_step; order_placed → checkout_step {step, orderGroupId}; quote_abandoned, rfq_submitted, design_started, design_saved, order_paid → missing (server-side facts/rollups derive RFQs, orders, payments and abandonment)
  - occurredAt number (ms) → occurredAt date-time string
  - eventId (uuid, replay-safe), anonymousId, sessionId → required on backend, missing in FE
  - properties.route → pagePath (server strips ids/query)
  - properties.productType → productTypeCode
  - properties.quantityBand → properties.quantity (exact; the server stores bands) — backend wins
  - properties.province → postcode (stored as province, consent only)
  - properties.quoteMode → properties.instant (boolean) on quote_shown
  - properties.reason → missing
  - deviceClass, utm extra-on-backend
  - response 202 (ignored) → 202 AnalyticsIngestResultDto {accepted, dropped, duplicates}
  - *note:* Consent: FE sends regardless; backend drops identifiers without analytics_cookies consent (store.analytics.recordConsent) — compatible with the FE "not gated" stance. AnalyticsEventName is already a named enum.

#### `contract.rate-card-line-response` — implement here (U-B0.3)

Decisions: D-042

- **POST /v1/partner/factories/{factoryId}/price-proposals/{proposalId}/actions/respond** — implement here
  - **scope (U-B0.3, `partners`):** partners/pricing/pricing.dto.ts:319 — rename the enum component (e.g. `RateCardLineAnswer`, values accept|counter) and keep the DTO as `RateCardLineResponse` (or rename the DTO to RateCardLineResponseDto); pnpm contract:build + contract:lint; add a lint/unit check that no schema references itself.
  - *note:* Backend op partner.priceProposals.respondToRateCard; request body RespondToRateCardDto { lines?: RateCardLineResponse[] }. Wire shape unchanged, only the component names — FE removes its CONTRACT-DEFECT narrowing.

#### `admin.price-simulation-result` — implement here (U-B0.3)

Decisions: D-040, D-044

- **GET /v1/admin/price-proposals/{proposalId}/simulations/{simulationId}** — implement here
  - **scope (U-B0.3, `partners`):** partners/pricing/pricing.dto.ts:680 — `result: PriceSimulationResultDto | null` with quotesInWindow integer, priceChangePct / marginChangePct / selectionShareChangePct decimal-string|null (RepriceResult); also used by admin.priceSuggestions.simulate.
  - *note:* Backend op admin.priceSuggestions.getSimulation. Staff-only (D-044) — never exposed on the partner surface (verified: no suggestion/benchmark/margin field in any partner response schema).
