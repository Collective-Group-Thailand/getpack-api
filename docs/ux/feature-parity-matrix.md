# Feature parity matrix — every Kumopack feature observed on 2026-09-29 → where Packio covers it

> Rule: a competitor feature is "covered" only when a named deliverable builds it **and** its acceptance test exists. Anything marked **GAP** is assigned in `U5-ux-excellence.md`.
> Verdicts: Beat = we build a clearly stronger version · Match = equivalent · Adapt = same job, different mechanism for our model · Skip = deliberately not built (reason given).

| # | Competitor feature | Packio deliverable | Verdict | Status before U5 |
|---|---|---|---|---|
| 1 | Buyer dashboard with period-over-period KPIs and status counts | U2.F5 account dashboard | Beat (money + boxes + reorder suggestions) | covered |
| 2 | Multi-product request basket | B3 cart (instant) + B2 RFQ | Beat for instant types | **GAP: multi-item RFQ basket for RFQ-only types** → U5.4 |
| 3 | 10-step spec wizard with completeness summary | U2.F1 configurator v2 | Beat (live price, advisor) | covered |
| 4 | Style picker with card/list views and style codes | U3.5 library, U2.1 codes | Beat (960 variants, facets) | covered |
| 5 | Measurement basis + unit switch | U2.1 / U2.F1 | Match+ (three sizes live) | covered |
| 6 | Weight / stacking / fragility / transport inputs | U2.2 / U2.F1 | Match | covered |
| 7 | "AI recommend" board thickness | U2.2 Structure Advisor | Beat (explained, priced alternatives) | covered |
| 8 | Liner material choice with swatches | U2.F1 / U4.2 | Match | covered |
| 9 | Finishes & accessories with Simple/Advanced | U4.2 / U2.F1 | Match | covered |
| 10 | Print method + assembly choice | U4.2 (print method configures editor) | Beat | covered |
| 11 | Artwork upload at request time | U4.4 uploads, B4 artwork | Beat (preflight, proofs) | covered |
| 12 | Quantity tiers + target price | U2.3 / U2.F1 | Beat (levers) | covered |
| 13 | Status tabs incl. sample production and dispute | U2.4 samples, B4 claims | Match | covered |
| 14 | Card / table views and filters on lists | design-system DataTable | Match | covered |
| 15 | Direct chat with the counterparty | LINE deep links only | Adapt (chat with Packio, not the factory) | **GAP: in-app messaging per order/design** → U5.3 |
| 16 | Coins, coupons, coupon wallet | B3 loyalty & promotions | Match | covered |
| 17 | Affiliate programme with payouts | B3 referral | Match (verify payouts) | covered (verify in U5 gap analysis) |
| 18 | Profile: business type, group, logistics, invoices | B3 companies / account | Beat (B2B) | covered |
| 19 | Buyer subscription plans and quotas | — | Skip (fights our funnel) | n/a |
| 20 | Verified factory directory with ratings | U2.5 network page | Adapt (aggregate, no identities) | covered |
| 21 | Product-type catalogue with international names | F3 + U3 | Beat | covered |
| 22 | Materials library, learning centre, blog, split FAQ | F3 CMS | Match | **GAP: materials library with real spec data + buyer learning paths** → U5.6 |
| 23 | First-order coupon pop-up | B3 campaigns | Adapt (only real campaigns, D-181) | covered |
| 24 | ~880 mockup templates, categories, favourites | U3 (960 producible variants) | Beat | covered |
| 25 | Customizer: size ranges, three size read-outs, custom caliper | U2.1 / U3.2 / U4.2 | Match+ | covered |
| 26 | 3D open/close animation, dieline view with dimensions | U3.3 / U4.3 | Beat (face-aware editing) | covered |
| 27 | Editor: uploads, text, shapes, packaging symbols, background patterns | U4.4 | Beat (brand kit, data blocks, finishes) | covered |
| 28 | Outside/inside toggle | U4.3 | Match (cost shown) | covered |
| 29 | PDF / AI download (paid) | U2.6 / U3.B5 free PDF/DXF/SVG | Beat (free) | **GAP: label the PDF as "Illustrator-compatible" and include layered spot names designers expect** → U5.4 |
| 30 | Create request from design | U4.6 order from studio | Beat (instant order) | covered |
| 31 | Google sign-in | F3 auth (Firebase Google/Apple, OTP, LINE) | Beat | covered |
| 32 | Supplier dashboard with KPIs | F5 + U2.F7 | Beat | covered |
| 33 | Supplier inquiry inbox with lifecycle tabs | F5 jobs | Adapt | covered |
| 34 | Supplier finance by contract / by instalment | U2.9 / U2.F7 | Match+ (payout calendar) | covered |
| 35 | Supplier profile: hours, bank, users, logistics | F5 + U2.9 | Beat (finer roles) | covered |
| 36 | Supplier subscriptions, paid visibility | — | Skip (supply agreement tiers instead) | n/a |
| 37 | Supplier affiliate | — | Skip | n/a |
| 38 | Weekly clearing & auto-confirm receipt after 7 days | B5 payouts, B4 auto-complete | Match | covered |
| 39 | Marketplace stock items with carrier API | B stock products + logistics carriers | Match | covered (verify fast-ship promise in U5 gap analysis) |
| 40 | Quick chat with the platform team | LINE OA | Adapt | **GAP: same as #15, plus staff inbox** → U5.3 |

**Features we have that the benchmark does not** (keep them visible in marketing and onboarding): instant true pricing, live price inside the designer, continuous print checks and soft proof, digital proof with approval evidence, production milestones with photos and QC, split shipments with POD, B2B credit and approval policies, full tax documents from one seller, repeat-order intelligence, call-off orders, customer API/webhooks, AR at real size, published guarantee.
