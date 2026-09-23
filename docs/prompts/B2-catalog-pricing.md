# B2 — Catalogue, partners & price governance, pricing, shipping rates, quotes & RFQ

> อ่าน `CLAUDE.md`, `00-master-plan.md`, `docs/decisions.md` (D-011, D-012, D-013, D-021, D-040, D-041, D-042, D-043, D-044, D-050, D-051, D-100, D-101), `docs/schema-design.md`, `docs/legacy/00-domain-context.md` §3–§4 ก่อน · ต้องทำ B1 ครบแล้ว
> ทำทีละ Deliverable (2.1 → 2.5) · 2.3 ทำทีละ calculator · เปิดไฟล์ PHP ของ legacy ทุกครั้งที่ port สูตร — ห้ามเดา

---

You are a senior backend engineer on **`packio-api`**. Migrations for each context follow the approved `docs/schema-design.md`. Every configurable value is an effective-dated setting (ADR-0005).

## Deliverable 2.1 — Catalogue & CMS
- Product types (the 7 instant types of D-100 + RFQ categories: rigid/gift boxes, paper bags, food packaging, tubes, custom tape, POP displays, other), each flagged `quote_mode = instant | rfq` (switchable per type when a calculator ships).
- Catalogue model inspired by legacy (§3): packaging types, products/mapping inputs with imagesets and standard sizes, patterns (+ sub-patterns, size constraints, flute match), papers / paper grades / flutes / films, finishes, print types, colours, difficult levels, assemblies, stock/standard products (+ attributes, prices, stock), semi-design templates, fonts, colours.
- CMS: banners, home sections, articles & categories, FAQs, SEO meta, videos, Google Merchant feed, provinces/districts/zipcodes.
- Admin CRUD for all, list filters, **Excel import/export with preview → confirm** for the large tables; public reads under `/v1/store/catalog/*`; search with `pg_trgm`.
- Seed: no real catalogue data (created by admins, D-005); dev seed with fake items.

## Deliverable 2.2 — Partners & price governance (D-011, D-040…D-044, D-101)
- **Onboarding**: application (company data, tax id, VAT registration, addresses, contacts, bank account — verified, change requires approval), KYC documents, capability matrix (product types, processes, machines, max sheet/size, materials, finishes, delivery zones), capacity per product type per week, quantity tolerance per factory with per-product-type override (D-021), shipping buy rates (D-013), payout policy (D-022), **pricing arrangement**: ownership mode `platform_rate_card | factory_price_list` (D-042) and **participation tier A/B/C per product type** (D-043), agreement acceptance (versioned agreement text, e-acceptance evidence), **site visit record** (date, inspector, checklist, photos — required before `trial → active`, D-041), status `applied → under_review → trial → active → suspended → offboarded`, approval by Partner team via the approvals engine. **Assisted onboarding**: Packio staff may enter data on the factory's behalf; the factory's sign-off is recorded (D-100 note).
- **Price tables per factory — the buy prices Packio pays, never the factory's internal costs** (D-042; components modelled on the legacy master price tables: paper prices, print prices/plates/wastes, finishes (+prices/plates/wastes), die-cuts (+prices, block prices, wastes), assemblies (+prices, sheets, wastes), sortings, semi-plate wastes, delivery costs, packing types/prices, code margins, colours, difficult levels, conditions, calculate conditions, paper trims/sheets/sizes, paper-cannot-do-process, step prices, factory × print-type margins, spec titles/details, machines). Every change is a **price proposal** with a workflow that depends on the mode (D-042): in `factory_price_list` the factory proposes → Packio reviews → approves → new version with `effective_from`; in `platform_rate_card` Packio staff draft a new version → the factory **accepts** (whole, per line, or negotiates exceptions) → it applies to new orders. Quotes snapshot the version used. Tier A holds a full parametric table, tier B only the lines it covers (common specs / standard sizes / stock products), tier C none (D-043).
- **Price suggestions — staff-only, never visible to factories** (D-040 note, D-044): per line compute suggested value + basis — group 1 materials: `material_price_index` (adapter; manual admin entry first) × approved price; group 2 process rates: own history × cost-driver index (minimum wage, electricity Ft, PPI — manually maintained series) and **peer benchmark only when ≥ 3 active factories** serve the type (D-101); group 3 waste: actual scrap ratio from production reports (P75) when data exists; group 4 commercial terms: impact only; group 5 shipping payout: customer rate card − target shipping margin. Deviation band flags. **Impact simulation**: re-price the factory's quotes of the last 90 days with proposed values → price, margin and selection-share deltas.
- Capacity: weekly capacity per type; booked load from accepted jobs; lead-time engine refuses promises beyond capacity (next available date).
- **Quote-path resolution**: a service answers, for a given product type + configuration, whether an instant price path exists (any active factory with tier A, or tier B whose envelope covers the configuration) → otherwise the configurator and CS route to RFQ (D-043, D-100); admins see per type which factories cover it.
- Endpoints: partner surface (own data, proposals or rate-card acceptance, sign-offs — a factory may never read another factory's prices or any benchmark, D-044), admin surface (review queues, approvals, acceptance status, suggestions, simulation, coverage map). Every read of another factory's price lines is audit-logged.

## Deliverable 2.3 — Pricing calculators (7 instant types, D-100)
Port **exactly** from legacy, one calculator per session, in this order: **folding (A, B, digital) → corrugate (+ combine) → label → tag & sleeve → pouch → standard product → service**.
Legacy logic reference map (calculators first; other rows are used in B3–B6):

| Rule | Legacy location |
|---|---|
| Calculator pipelines (all 6 types + service) | `app/Models/{Folding,Label,Corrugate,TagAndSleeve,Pouch}Calculator.php`, `app/Models/Calculator.php`, `app/Models/Converter.php`, `app/Libraries/Folding/**` (A/B/Digital, Object/*, Process*/*), `app/Libraries/FoldingBox.php`, `app/Libraries/Rectangle.php`, `app/Libraries/StandardProduct/*`, helpers `cal*`/`calculate*` in `app/Helpers/helpers.php` |
| Shipping selection & rate cards | `app/Libraries/Shipping/*` (`ShippingUtils`, `FoldingUtil`, per-carrier classes, `postalcode.php`) |
| Order creation (web/CS/std/service/rigid), totals, expiry, order code | `Api/OrderAPIController@storev2/@store/@createOrderFromCS`, `StandardProductAPIController@createOrder`, `RigidAPIController@store`, `OrderController@store`, `ServiceOrderController` |
| Status transitions, notifications on each transition, points, drawing auto-send | `OrderController@update/@updateManual/@updateOrderStatus/@graphicStatus/@sendDrawingAutov2`, `Api/OrderAPIController@approve*/@userReject*` |
| Payment integrations & callbacks | `Api/OrderAPIController@payment2C2P*`, `Api/OrderPaidController`, `Webhook/SCBWebhookController`, `PaymentStatusController`, `RefundPaymentController`, `Libraries/Payment/*`, `Libraries/2c2p/*` |
| Receipt / tax-invoice / credit-note numbering & PDFs | `OrderController@genPdf*`, `@updateOrderCreditNote`, `@setTaxData`, helpers `genReceiptNumber`, `getCreditNoteNumber`, `createReplacementNumber`, `Api/DocumentController` |
| Points/redeem | `Services/RedeemService`, `Services/PointUserService`, `Services/HelperService`, `Order@givePointOrder`, `Api/PointUserAPIController` |
| Promotions | `Models/Promotion@calculateDiscount/@calculateDiscountTypeStep`, `PromotionController`, `Api/UserPromotionAPIController` |
| Auth | `Api/LoginAction`, `Api/PassportController`, `Api/SMSController`, `Api/UsersController`, `LoginController`, `Middleware/CheckApiAuth` |
| Cron | `app/Console/Commands/*` |
| Emails (content + when sent) | `app/Mail/*`, `app/Jobs/Mail*Job.php`, `resources/views/emails/**` |
| Reports | `app/Libraries/Report*.php`, `app/Exports/*`, `app/DataTables/Report*.php`, `ReportController`, `ReportPaymentController`, `ReportOrderController` |
| Money/date helpers | `app/Helpers/helpers.php` (`convertTo2Decimal*`, `roundUp`, `calculateVat*`, `calculateWithholdingTax`, `calculateServiceCost`, `addDateWithOutWeekend`, `getLotOfProduction`, `DateThai`, `convertNumberToThaiBaht`, `convertPhoneFormat`, `generateOrderCode`) |



Rules:
- Calculators are **pure** services: typed input + cost-table snapshot + settings snapshot → typed result (per part/sub-pattern breakdown, waste, sheets, layout, plate, die block, finishes, assembly, packing, delivery, design fee, margin, VAT, per piece, total, lead time, next available date from capacity, tolerance of the chosen factory). No DB calls inside maths.
- Factory selection: evaluate every **active** factory with the capability, capacity **and a price path covering the configuration** (D-043); rank by **effective cost to Collective Group** (VAT-inclusive for non-VAT factories, `accounting-design.md` §11) then lead time; with one factory the selection is trivially that factory (D-101). Customers never see factory identity (D-050).
- Margin floor guard (D-012/D-063): results below the floor are flagged; later discounts/promotions are capped against it (B3).
- **Golden tests (mandatory)**: if an anonymised legacy dump is provided in `test/fixtures/legacy/` (never loaded into any runtime DB), export N `calculate_logs` per type + the matching master tables → `test/golden/<type>/*.json` and assert numeric outputs within 0.005. If no dump is available, derive test vectors by reading the PHP code (document every vector's source file:line) and produce `docs/pricing-validation-<type>.md` with 20 cases for business sign-off. CI fails on any mismatch.
- Calculate logs and search logs are written for analytics (B6).
- Endpoints: `POST /v1/store/quotes` (customer), `POST /v1/admin/cs/{type}/calculate` + `GET /v1/admin/cs/{type}/input-data` (CS), factory-side breakdown for partner/admin (`/v1/partner/...` scoped to own factory).

## Deliverable 2.4 — Shipping rate cards (D-013, D-114)
- Customer shipping rate card per zone/zipcode × weight/volume bands (effective-dated); factory shipping payout rate card per factory × zone; packing helper (boxes per carton, cartons per pallet, from legacy logic); delivery cost included in quotes as its own line (for WHT and accounting).
- `CarrierAdapter { quote, book, label, track, cancel, webhook }` interface with **Flash Express** and **Deliveree** implementations (sandbox) + fakes; used only as fallback when the factory cannot serve the zone. Legacy carrier engines (`app/Libraries/Shipping/*`) are the logic reference for rate computation where useful.

## Deliverable 2.5 — Quotes & RFQ
- **Quotes**: saved quote = input + result + cost/settings snapshot versions, validity **15 days** with price lock (D-051), PDF in the name of Collective Group (Thailand) with Packio branding (issuer data from settings), share link (signed), convert to cart item; CS quotations with discount requests (B3.5).
- **RFQ** (D-100, D-043 — also the automatic fallback when no instant price path covers a configuration): request (product category, dimensions/spec fields per category, quantity tiers, target date, delivery zipcode, files, notes), statuses `submitted → in_review → need_info → quoted → accepted | declined | expired`, SLA per category (setting), assignment to CS, factory consultation (partner surface: request cost for an RFQ), quoted price lines with validity, customer acceptance → cart item with a **manual quote snapshot** that flows through the same order pipeline; declined/expired RFQs are recorded as **unmet demand** with reason codes (D-102).
- Events for analytics: `quote.calculated`, `quote.saved`, `rfq.*`.

After each deliverable: tests, contract, `docs/PROGRESS.md` (decisions implemented, legacy files ported with file:line).
