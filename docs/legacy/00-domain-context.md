# Locopack (legacy) — Logic reference for Packio

> **Packio — Your Packaging Production Partner** (Collective Group (Thailand)) is a **new business and a new system** (decision D-005). Nothing is migrated from Locopack. This document and the legacy code in `legacy/locopack-web/` are a **reference for logic and workflows only**: pricing formulas and calculators, order/artwork/payment workflows, document layouts, reports.
> Collective Group (Thailand) has confirmed the right to reuse Locopack code and pricing formulas (D-005).
> **Where Packio differs from Locopack, `docs/decisions.md` wins.** In particular: no SAP (D-030), no SCGP PDPA API, no LINE Notify, no legacy merchant/LINE/SMS accounts, no ETL, no URL redirects, no compatibility endpoints. Table/column names below describe legacy concepts, not the Packio schema.

## 1. What the system is

**Locopack** (locopack.co) is a Thai B2B/B2C **custom packaging e-commerce platform**. Customers configure packaging (size, paper, printing, finishing, quantity), get an instant price quoted from multiple partner factories, place an order, pay, upload/approve artwork, and the platform coordinates production with the factory, delivery, invoicing, and SAP accounting.

The legacy repo contains **three things in one codebase**:

| Part | Legacy tech | Who uses it | New stack |
|---|---|---|---|
| **Back-office web** (`routes/web.php`, Blade + Vue2) | Laravel views | Internal staff: Admin, CS, Factory, SEO | **Next.js** app |
| **Public REST API** (`routes/api.php`, `/api/*`) | Laravel controllers + Passport | Customer-facing SME website (separate Nuxt/Vue app at `LOCOPACK_SME_WEB_URL`), LINE LIFF, online design tool (`UR_DESIGN_URL`), drawing generator (`DRAWING_URL`), and the back-office itself | **NestJS** API |
| **Background** — cron, queue workers, webhooks | artisan schedule, SQS, SES | — | NestJS (schedule module + Bull/SQS) |

Packio mapping: all user interfaces → one Next.js app (`packio-web`); all server-side logic → NestJS (`packio-api`). Legacy JSON contracts, URLs and data are not carried over.

---

## 2. Actors & roles

`users.user_type`:

| value | role | notes |
|---|---|---|
| 0 | **CS** (customer service) | quotes, orders |
| 1 | **Factory** | sees factory calculators, orders assigned to their `factory_id` |
| 2 | **Admin** | everything (`adminOnly`, `web.admin`) |
| 3 | **SEO** | articles, categories, sitemaps |
| 4 | **Web** (customer) | created via Firebase/OTP/LINE; public API only |

`users.user_status`: 0 inactive, 1 active, 2 suspend.
Customer code: `user_code` = `LC` + 6-digit running number (generated on demand by admin, `OrderService.generateUserCode`).

Legacy middleware → new guards:
- `web.admin` = Admin only
- `web.factory` = Factory **or** Admin
- `web.seo` = SEO or Admin
- `adminOnly` = user_type 2
- `auth:api` = Bearer Passport token (customers + staff)
- `client` = OAuth client-credentials (server-to-server; used by `me-as-client`, `client-download-drawing-log`)
- `validSCBWebhookSignature` = SCB webhook HMAC check (`SCB_WEBHOOK_SECRET`)

### Authentication flows (must all be preserved)
1. **Staff login (back-office)**: `POST postlogin {username,password}` → calls `POST /api/login` (Passport personal access token, name `locopack`) → token stored in cookie `token_{APP_ENV}` + server session; every back-office request re-validates the token (`checkApiAuth` → `GET /api/user/auth`). Logout = `custom-logout` / `clearLogin`.
2. **Customer login via Firebase**: `POST /api/auth {idToken, name?, phone?, rememberme?}` → verify Firebase ID token (`kreait/firebase-php`) → find-or-create `users` by `firebase_uid` (user_type 4) → issue Passport token `web_token` (30 days, 366 if rememberme).
3. **Customer login via phone OTP**: `POST /api/otp-login` → ThaiBulkSMS OTP (6 digits) → `POST /api/verify-otp-login` → token. Also `otp`/`verify-otp` (authenticated, phone verification) and LIFF variants `liff-otp`, `liff-verify-otp`, `update-liff/{user}`.
4. **LINE**: `GET /api/line/user/token`, `POST /api/users/connect-line-to-user`, LINE login webhook `users/web-hook-line-api`.
5. `POST /api/register` (username/password, legacy), `POST /api/signout`, `GET /api/me`, `POST /api/me-as-admin`, `GET /api/me-as-client`.
6. `POST /api/check/phone`, `POST /api/check/email` (uniqueness checks), `POST /api/users/accept-term`, `GET /api/users/verify-email/{order}`, `DELETE /api/users/{user}` (delete Firebase auth user).

---

## 3. Product catalogue model

### 3.1 Packaging types (`packaging_types`, config `locopack.packaging_type_ids`)

| id | key | Thai | calculator class (legacy) |
|---|---|---|---|
| 1 | folding_box | กล่องกระดาษแข็ง | `FoldingCalculator` + `App\Libraries\Folding\*` (A/B variants + Digital) |
| 2 | sticker / label | สติ๊กเกอร์/ฉลาก | `LabelCalculator` |
| 3 | corrugate | กล่องกระดาษลูกฟูก | `CorrugateCalculator` |
| 4 | rigid / **standard_product** | สินค้ามาตรฐาน (ready-made: bottles, jars, boxes with stock) | `Rigid` / `StandardProduct` + `Libraries\StandardProduct\*` |
| 5 | tag_and_sleeve | ป้ายแท็ก / ปลอกแก้ว | `TagAndSleeveCalculator` |
| 6 | pouch | ซอง | `PouchCalculator` |
| — | **service** order (print_type 11) | บริการ (design, plate, diecut, delivery, seal mold, mockup) | `ServiceOrderController` |

`print_type` ids of note: 2 folding digital, 5 corrugate digital, 6 corrugate flexo, 9 std product, 11 service. Print types that can charge plate+diecut: `[6, 11]`.

### 3.2 Master data used by the pricing engine (per factory)
`factory` (with `factory_type_id` A=1/B=2, margin, max colors, shipping_enabled_* flags, SAP `sap_supplier_number`, `require_bill_before_gr`, `factory_organization_type_id` internal/external), `factory_match_print_type`, `factory_match_packaging`, `factory_rel_pattern_conditions`, `machine`, `pattern` (+ `sub_patterns`, `pattern_rel_papers`, `pattern_rel_standard_sizes`, `pattern_match_flute`, `pattern_match_conditions`, size constraints min/max w/l/h/b/s/cs/dl/dw), `paper` (per factory, gsm, cost per kg/pcs/m2, micron), `paper_types`, `paper_grade` (+ `paper_grade_match_flute`, `paper_grade_match_paper_sizes`, `paper_groups`, `flute_type`), `paper_sheets`, `paper_sizes`, `paper_trim`, `paper_roll_widths`, `paper_cannot_do_process`, `print_type`, `print_prices`, `print_plate`, `print_block`, `print_wastes`, `color` + `color_groups` + `percent_color`, `finish` + `finish_groups` + `finish_price` + `finish_plate` + `finish_wastes` + `foil_type`, `diecut_type` + `diecut_groups` + `diecut_price` + `diecut_block_price` + `diecut_wastes`, `assembly` + `assembly_groups` + `assembly_prices` + `assembly_sheets` + `assembly_wastes`, `sorting`, `semi_plate_waste`, `difficult_level` + `difficult_level_groups` + `difficult_match_margin`, `code_margin`, `factory_margins`, `locopack_margins`, `factory_fix_cost_percents`, `percent_reduces`, `step_prices` (per-factory quantity tiers), `delivery_cost`, `packing_type` + `packing_price`, `calculate_conditions`, `conditions`, `production_conditions`, `spec_titles` + `spec_details` (factory specs shown to customer), `customize_product_configs`.

### 3.3 Customer-facing catalogue
- `mapping_inputs` = the customer-facing "product" (e.g. "กล่องฝาเสียบ") — `packaging_type_id`, `mapping_input_type_id` (1 pattern, 2 paper, 3 finish-1 (coating), …), `sub_id` (points to the pattern / paper / finish id), name_th/en, description, `is_combination`, `flute_type`, `get_template_type` (1 none, 2/3 = online template/drawing available), video_link, sort, status. Has `product_imagesets` (+ `image_product_imageset`) for image galleries per paper/color combination, and `standard_sizes` (+ `standard_size_prices`).
- `sample_product_categories` → `sample_products` → `sample_product_rel_products` → `products` (pre-configured showcase products = "Product Groups").
- `standard_products` (ready-made products, stock, `standard_product_prices` tiers, attributes: material/type/shape/shoulder/neck/color/size/cap_type/sub_type, `ph6_id`, `min_price_per_pcs_with_delivery` recomputed nightly) + `stock_histories`.
- `semi_designs` (+ templates, colors, fonts) — semi-custom designs.
- `articles` + `article_categories`, `faqs` + `faq_categories`, `banners`, `homesections`, `sitemaps` (SEO meta per page slug), `videos`, `google-merchants` feed, `provinces`, `zipcodes`, `zipcodes_delivery_zone`.
- `images` — generic polymorphic image table: `type_id` (see `UploadFile` constants 1..30, e.g. 12 payment slip, 21 template file, 22 graphic confirm/reject, 23 design assets, 30 standard product), `sub_id`, `path` (S3 key), `link`, `short_url`.

### 3.4 Designs
- `designs` / `designs_assets` — online design editor documents (uuid, versions, options_json, thumbnail).
- `user_designs` / `user_design_histories` — customer's saved designs (size, paper, flute, semi_design, alerts). Nightly `user-design:remove` prunes.
- Drawing (die-line) download: `download-drawing` (+ logs) generates a template from pattern + size via external `DRAWING_URL` service.

---

## 4. Pricing engine ("calculate") — the core business logic

Every packaging type has a calculator with the same shape:

```
input  = { patternId, w, l, d(h), paper_type_id, paper_gsm, difficult_level_id,
           arrayBoxAmount[] (quantities), zipcode, promotion_code, discount_type, discount,
           selectedFactory?, fix_margin{manual, graphic_design_fee, structure_design_fee, design_status},
           delivery{calType 0 auto | 1 fixed}, custom_cost?, is_brief_design,
           input[] = per sub-pattern part { sub_id,
               print_front{check, amount, color[], percent[]}, print_back{...},
               finish_front{check,id}, finish_back{check,id},
               diecut, f2[] (finish-2 e.g. foil/emboss with w,l,amount), asb[] (assemblies) } }

for each factory (filtered by selectedFactory / factory_match_packaging / print type support)
  for each print_type the factory supports
    for each quantity in arrayBoxAmount
      for each sub-pattern part
        convert CS input → factory-specific params (paper id for that factory, layout/imposition on paper sheet
          → PatternArea / Layout, waste calc A/B by factory.calculate_waste_type)
        cost = paper + printing(plates, colors, waste) + finish1/finish2 (+plates) + diecut (+block)
             + assembly + sorting + packing + fix cost
        margin = factory margin + locopack margin (+ difficult_match_margin, percent_reduce, code_margin)
        delivery = pick cheapest enabled shipping provider for factory→zipcode zone by weight/volume
                   (SCG Express, Ninjavan, Deliveree, Flash, Kob, DHL, KPon1, KPon2) → delivery_price/cost, boxes
        design fee (graphic/structure; env SALE_MARGIN_*), VAT 7%
      summary[qty][factory] = { per_pcs, per_pcs_with_delivery, sum, plate, diecut_block, delivery_*,
                                design_price, total, lead_time (print_type.lead_time or custom by qty),
                                receiving_date, rating, specs, products[] (one row per part → `products` table),
                                order_hierarchies[] (SAP material codes, §6), promotion discount + log }
```

Entry points to preserve: `POST /api/calculate` (generic), `POST /api/folding/calculate`, `POST /api/calculate/label`, `GET /api/corrugate/calculate`, `POST /api/pouch/calculate`, `GET /api/rigids/{id}/calculate`, `GET /api/standard-products/{id}/zipcode/{zip}/step-prices`, CS variants `cs/folding|label|corrugate|tagAndSleeve|pouch` (GET = input master data, POST = calculate), `POST /api/validate-input`, `POST /api/promotions/calculate`, `GET /api/rigids/calculate-delivery`.

Every calculation is logged to `calculate_logs` (input JSON, output, user, ip) and searches to `search_logs`.

> ⚠️ The calculators are ~30k lines of PHP (`app/Libraries/Folding/**`, `app/Models/*Calculator.php`, `app/Libraries/Shipping/**`, `app/Libraries/StandardProduct/**`, `app/Helpers/helpers.php` cal* functions). They must be **ported function-by-function with golden-master tests** (record real request/response pairs from `calculate_logs` and assert the port returns identical numbers). Do not "re-design" the formulas.

---

## 5. Order lifecycle

### 5.1 Key tables
`orders` (see schema — ~150 columns), `order_products` → `products` (one row per part/sub-pattern; snapshot of price/cost/factory/print type/paper/colors via `product_colors`, `product_finishes`, `product_assemblies`), `order_hierarchies`, `orders_activity` (audit log, `name` = activity constant), `slips` (bank transfer slips), `quotations` (encoded CS input + create_order_data, code, PDF), `invoices` (customer billing entities), `order_receipt_references` (receipt / tax invoice / credit note document numbers, `type`, original/current doc no, amounts), `internal_account_numbers`, `sqs_activity_logs` (SAP process log), `promotion_logs`, `points_users`, `redeem_logs`, `trans_2c2p_creditcard_payment`, `trans_2c2p_online_payment`, `tracking_product_logs`, `event_logs`.

### 5.2 Enumerations (from `config/locopack.php`)

**order_status**

| id | key | Thai |
|---|---|---|
| 1 | waiting_for_pay | รอการชำระเงิน |
| 2 | waiting_for_approve | รออนุมัติการชำระเงิน |
| 3 | paid | ชำระเงินแล้ว |
| 7 | manufacturing | กำลังผลิต |
| 4 | shipping | กำลังขนส่ง |
| 5 | success | สำเร็จ |
| 6 | cancelled | ยกเลิกการสั่งซื้อ |
| 8 | deleted | ลบคำสั่งซื้อ |

**payment_status**: 1 waiting_pay, 2 waiting_confirm, 3 paid.

**payment_type**: 1 transfer (bank slip), 2 credit/debit card (2C2P), 3 online banking (2C2P), 4 installment (2C2P IPP), 5 QR code (SCB QR30), 6 SCB direct debit, 7 QR CS (SCB QR cross-bank). Fee: `payment_fee` 2.25 %, SCB Easy 5.

**graphic_status** (artwork workflow):

| id | meaning |
|---|---|
| 0 | designing / waiting template (admin uploads template; customer approves/rejects template via `template_status_id` 1 wait-approve, 2 rejected, 3 default) |
| 1 | user/admin uploaded graphic |
| 2 | user submitted for check (or, when hired design: user waiting for design) |
| 3 | admin rejected (or customer requested changes when hired design) |
| 4 | admin approved → waiting customer confirm production |
| 5 | customer confirmed → ready to produce (`customer_confirm_production`) |

**is_brief_design**: 0 by_myself, 1 hire (paid design, `brd_*` brief fields), 2 free. **design_by_yourself**: 1 = design online in web tool.
**discount_type**: 0 none, 1 promotion, 2 admin, 3 redeem points.
**tax_type**: 1 individual, 2 juristic, 3 government employee (withholding tax). **type_of_branch**: 1 head office (`00000`), 2 branch.
**reject/return reasons** (credit note): `reason_of_cancel_order` 1..11 with SAP reason codes (A53, A51, A55, B06, A50, B50) and type ITEM/SERVICE/BOTH; `credit_note_detail` 1 full, 2 partial (product/design/mold/die_cut/delivery/seal_mold/mockup).
**product_unit**: 1 ชิ้น, 2 กล่อง, 3 ซอง, 4 หลอด. **mockup_type**: 1 with print, 2 no print (price 500).
**contact_channel / sender** values seen in UI: website, line, facebook; sender: scg, ninja, deliveree, flash, kob, DHL, nim, รับเอง.

### 5.3 Happy path
1. **Quote** — customer (or CS on behalf) calculates; CS may save a `quotations` row and export PDF (`quotations/export-from-cs`, `order/{order}/quotation-pdf`).
2. **Create order** — `POST /api/orders-v2 {packaging_type_id, input (calculator input incl. zipcode, promotion_code, reward_data, discount_type), selected_key (factory), is_brief_design, design_by_yourself, uuid (design)}`; requires verified email. Re-runs calculator server-side (never trust client prices), creates `orders` + `products` + `order_products` + `order_hierarchies`, `order_code` = `ymd` + 3 random digits + `ss`, `expired_at`, activity `ORDER_CREATED`, confirmation email (`OrderConfirmation`). CS path: `POST /api/create-order-from-cs {order, cs_input, encode_data, create_user}` (`ADMIN_ORDER_CREATED`, `CreateOrderFromCS` mail). Standard product path `POST /api/standard-products/create-order`, rigid `POST /api/rigids`.
3. **Address / tax** — `save-address`, `save-invoice-address`, `save-tax-address`, `save-optional`, `update-ccemail`, `save-brief-design`.
4. **Payment** — customer picks type: slip upload (`save-payment-slip` → status 2/2, `ORDER_SLIP_UPLOADED`), 2C2P (`order/pay/creditcard`, `order/pay/onlinepayment`, `2c2p-ipp-getlink`, callbacks `2c2p/callback`, `2c2p/redirect`), SCB QR30 (`order/{order}/paid-qrcode` → QR image to S3, `url_image_qrcode`), SCB QR CS, SCB direct debit; SCB webhook `POST scb-payment-confirmation` sets status 2/2 + `paid_at` + `payment_callback_response`, emits `OrderPaid`, removes QR from S3. Unpaid orders auto-cancel after `expired_at` (cron every minute, §10).
5. **Approve payment** (admin, `orders/{id}/approve-slip` or status patch) → `order_status 3`, `payment_status 3`, SMS (ThaiBulkSMS) + mail `OrderRemindAfterApproveSlip`, auto-send drawing template (`sendDrawingAutov2`), `OrderRemindUserToDesignOnWeb` when applicable, give points (`givePointOrder`), approve redeem, copy graphic files, SAP `create_payment`.
6. **Artwork** — graphic_status flow (§5.2) with uploads (`order/upload-graphic`, `upload-graphic-for-user`, `upload-graphic-template`, `update-template-status`, `reconfirm-graphic`, `update-designer`, `update-design-online`), customer side (`approve-design`, `approve-template-status`, `approve-start-production`, `user-reject-graphic`, `user-reject-template`, `get-drawing`, `set-uuid`). Mails: `OrderTemplateUploaded*`, `OrderSVGTemplateUploaded`, `OrderApproveDesign`, `OrderRejectDesign`, `OrderTemplateAutoConfirm`.
7. **Start production** (admin sets status 7; requires designer if hired design, and lead time) → `start_production_at`, `delivery_at = start + lead_time business days`, `lot_of_production`, SAP **create-pr** (`PROCESS_SAP_URL/process/create-pr {orderId}`), mail to factory (`mail-tab`, `send-mail`, `send-mail-form`, `ManualSend`).
8. **Shipping** (status 4) → `sender`, `delivery_detail_text`, tracking no, `OrderDelivery` mail, `send-tracking-noti` (SMS/LINE). Daily cron `order:update-delivery-status` polls carriers.
9. **Complete** (status 5, from 4) → SMS thank-you, `OrderComplete` mail; cron `order:update-success-status` auto-completes after N days; NPS mail cron `order:send-out-nps`; follow-up mail cron `order:follow-up` for abandoned checkouts.
10. **Accounting** — tax invoice PDFs (`genPdfFullPaymentTax`, `genPdfNormalPaymentTax`, receipt numbers `genReceiptNumber`), credit notes (`update-order-credit-note`, `genPdfCreditNote`, `return_order_*`, reason codes), replacement invoices, `order_receipt_references`; SAP processes `create_payment`, `create_revenue`, `update_po`, manual **GR** (`orders/{id}/manual-gr`, guarded: PO issued, lead time, vendor billing if `require_bill_before_gr`, credit note < amount); `vendor_billing_no/date`; refunds via SCB (`refund/{order}`, `refund-status`) and points refund.
11. **Other admin ops** — cancel (6), change factory (`cs/change-factory/{type}/{order}` re-prices with a different factory), change user, edit order (re-calc), update address/user data/product description/lead time/confirm production date/optional/invoice/remark/cc email, re-production (`order/{id}/re-production` creates a linked `reorder_order_id`), mockup add-on, manual update (`order-manaul-update`), `link-stats` (Cuttly short-URL clicks), `new_alert_status` badges.

### 5.4 Order activity constants (audit trail, `orders_activity.name`)
`ORDER_CREATED, ADMIN_ORDER_CREATED, USER_DOWNLOAD_QUOTATION, USER_SAVE_ADDR_ORDER, USER_SAVE_ADDR_TAX_ORDER, ORDER_PAY_BANK_TRANSFER_TYPE, ORDER_PAY_2C2P_INTERNET_TYPE, ORDER_PAY_2C2P_CREDIT_TYPE, ORD_ACT_SELECT_PAY_QRCODE_TYPE, ORD_ACT_SELECT_PAY_QRCS_TYPE, ORD_ACT_SELECT_PAY_DIRECT_DEBIT_TYPE, SAVE_ONLINE_DRAWING, SAVE_UPLOAD_DESIGN_FILE, ORDER_WAITING_PAYMENT, ORDER_SLIP_UPLOADED, ORDER_SLIP_UPLOADED_BY_ADMIN, ORDER_PAYMENT_APPROVED, ORD_PAID, GRAPHIC_USER_UPLOADED, GRAPHIC_ADMIN_UPLOADED_TEMPLATE, GRAPHIC_ADMIN_UPLOADED_TEMPLATE_SVG, GRAPHIC_ADMIN_UPLOAD_INSTEAD_USER, GRAPHIC_USER_REQ_APPROVE, GRAPHIC_ADMIN_REJECT, GRAPHIC_APPROVE_SENDBACK, GRAPHIC_PRODUCTION_CONFIRM, GRAPHIC_USER_PRODUCTION_CONFIRM, GRAPHIC_USER_PRODUCTION_CONFIRM_FROM_REJECT, USER_REJECT_GRAPHIC, SKIP_GRAPHIC_STATUS_TO_WAIT_UPLOAD, SKIP_GRAPHIC_STATUS_TO_UPLOADED, SKIP_GRAPHIC_STATUS_TO_REQ_APPROVE, TEMPLATE_APPROVE_BY_ADMIN, TEMPLATE_APPROVE_BY_USER, TEMPLATE_REJECT_BY_USER, ORDER_START_PRODUCTION, ORDER_START_DELIVERY, ORDER_SET_DELIVERY_DETAIL, ORDER_COMPLETE, ORDER_SET_CANCEL, ORD_CANCELLED, ADMIN_CHANGE_OPTION_DESIGN, ADMIN_CHAGE_LEAD_DAYS, ADMIN_CHAGE_CONFIRM_PRODUCTION_DATE, AUTO_SEND_DRAWING, EDIT_ORDER, CHANGE_USER, ADMIN_DOWNLOAD_DRAWING, ADMIN_SEND_MAIL, ADMIN_SEND_MAIL_FORM, AUTO_UPDATE_SUCCESS_STATUS, ROLLBACK_AUTO_UPDATE_SUCCESS_ORDER, ORDER_NOTI_TRACKING_NO_TO_USER, UPDATE_VENDOR_BILLING, UPDATE_FACTORY`

---

## 6. SAP / product hierarchy (material codes) — NOT USED in Packio (D-030)

Each priced line gets a **PH code** built from 6 levels: `hierarchy_ph1` (default `09` Invenique) / `ph2` (`LC` Locopack) / `ph3` (by print type or service: 401 std product, 900 designer design, 909 locopack design, 901 delivery, 902 plate, 903 diecut, 904 mold) / `ph4` (from products) / `ph5` (paper / paper grade / material) / `ph6` (packaging type + sqm band `min_sqm..max_sqm`, or std product). Stored in `order_hierarchies {order_id, type_id, ph_code, ph1_id..ph6_id}`; `hierarchies` holds the imported SAP material master (`heirarchy, material_code, material_description, uom, material_type, commodity, material_group`) managed via **Master Data** screen (import/export Excel, template). Tools: `tools/decode-hierarchy`, `tools/incoming-gr-list`.

SAP itself is reached through an **external AWS service** (`PROCESS_SAP_URL`, API Gateway/Lambda): `POST /process/create-pr {orderId}`, `POST /process/create-gr {orderId}`, `POST /process/retry/{sqsActivityLogId}`; results land in `sqs_activity_logs {order_id, process_name ∈ create_pr|create_payment|create_revenue|update_po, status success|error, request, response, is_retry}` and update `orders.pr_id, po_id, po_status, design_pr_id, design_po_id, design_po_status, accounting_doc_no`. Back-office screen **Order SAP logs** lists + retries.

---

## 7. Loyalty points & rewards

- `bathPerPoint` 0.1 (1 point = 0.1 ฿). Points earned on paid orders (`givePointOrder`, `give_points_status`), `points_users {method 1 receive|2 used, type 1 free|2 paid, status 1 pending|2 done|3 refund, receive, used, point_balance, expiry_date (POINT_EXPIRATION_DATE), campaign_points_id}`; `users.total_points` cache.
- `rewards` + `rewards_configs` (per packaging type, min order price → points), `campaign_points`, `redeemtions`, `redeem_logs`. Redeem at checkout = `discount_type 3` (`HelperService.calculateRedeemPoint`), approved on payment approval (`RedeemService.approveRedeem`), refunded on cancel (`refundPoint`). New-customer popup gives points (`give-points/new-customer-popup`). Report `report/point-user` (+ export).

## 8. Promotions
`promotions {code, promotion_type_id 1 fixed baht | 2 percent | 3 step (3000–4999→20…), value, limit, limit_per_user, min_price, max_price, start_date, end_date, sorting (priority), show, link_more}`; `user_promotions` (saved codes per user), `promotion_logs`. Endpoints: `get-promo-codes`, `get-last-promocode-active`, `promotions/calculate`, `save-promo-code`, `check-use-promo-code/{code}`, `get-user-promo-codes`; admin: CRUD, priority ordering, usage report, logs. Also `articles_promotion`.

## 9. Integrations (reference only — Packio opens its own accounts; see §13)

| Integration | Purpose | Legacy lib |
|---|---|---|
| **MySQL 5.7** | primary DB | Eloquent |
| **AWS S3** | all files/images (`AWS_PATH` public base URL, buckets in `locopack.s3_bucket`) | flysystem, `S3Controller`, `FileUploadJob`, `MoveImageJob` |
| **AWS SES** (SMTP) + **SQS** (FIFO, `shiftonelabs/laravel-sqs-fifo-queue`) | transactional email queue (`EMAIL_QUEUE` toggle), `email-queue-worker-*.conf` | `SendEmailJob`, `Mail*Job` |
| **AWS Secrets Manager** | secrets (`AWS_SECRET_NAME`, `AwsSecret`) | `getAWSSecrets()` |
| **CloudWatch Logs**, **Sentry**, **Inspector** | logging/APM | |
| **Firebase Auth** (Admin SDK) | customer identity | `kreait/firebase-php` |
| **Laravel Passport** | OAuth2 bearer tokens, personal access + client credentials | `oauth_*` tables |
| **2C2P** | card / online banking / installment (IPP) payments, inquiry, redirect/callback with signature | `Libraries/2c2p`, `Payment2C2P`, `Payment/Generate2C2P`, `Inquiry2C2P` |
| **SCB Open API** | QR30, QR CS, direct debit, e-wallet, inquiry, refund (Paywise), slip verify, webhook | `Libraries/Payment/SCB*` |
| **ThaiBulkSMS** | OTP + order SMS | `sendThaiBulkSMS` |
| **LINE Messaging API / LIFF / rich menus** (legacy also used **LINE Notify**, which LINE discontinued on 31 Mar 2025 — replace with Messaging API push to a staff group/OA or Microsoft Teams) | chat bot webhook (`/api/line-webhook`), user linking, notifications | `Libraries/Line/*`, `LineNotifications` |
| **Facebook Messenger** | chat webhook (`/api/facebook-webhook`) | `Libraries/Facebook/*`; unified `WebhookMessagingInterface`, `conversations` + `chat_messages` tables |
| **Pusher** | realtime chat/notifications to back-office | `PusherService`, `broadcasting` |
| **Microsoft Teams** webhook | internal alerts (payment confirmations etc.) | `MicrosoftTeamsNotification` |
| **Cuttly** | short URLs + click stats (`shortenUrl`, `link-stats`) | |
| **Shipping carriers** | rate cards / tracking: SCG Express, Ninjavan, Deliveree, Flash, Kob, DHL, KPon1/2 (`shipping_providers`, `_areas` (zipcode→zone), `_costs` (weight/length → cost by zone group), Excel import `ImportShippingProviderArea`) | `Libraries/Shipping/*` |
| **SCGP PDPA** consent API | `scgppdpa-get-active-purposes`, `scgppdpa-submit-purposes`, "ส่ง consent" button on order | `Libraries/SCGP/*` |
| **SAP process service** | §6 | Guzzle |
| **Drawing generator** (`DRAWING_URL`) & **design tool** (`UR_DESIGN_URL`) | die-line templates / online editor | |
| **Google Merchant** feed | `google-merchants` | |
| **DomPDF / FPDF** | quotation, tax invoice, credit note PDFs (Thai fonts) | `resources/views/orders/pdf/*`, `quotations/pdf*` |
| **Maatwebsite Excel** | imports (prices, hierarchies, std products, PH6, shipping areas) and exports (reports) | `app/Exports/*` |
| **Swagger** | `/api/swagger/{doc}` JSON + swagger-ui | l5-swagger annotations |

## 10. Scheduled jobs (legacy `app/Console/Kernel.php`)

| schedule | command | what |
|---|---|---|
| every minute | `orders:cancel-expired` | set `order_status 6` for orders with `expired_at` passed (or no `expired_at` and older than 7 days) whose `payment_status` ∉ {2,3}; delete QR image from S3; activity `ORD_CANCELLED` |
| 00:00 | `sample-product:update-min-price` | recompute `standard_products.min_price_per_pcs_with_delivery` |
| 00:30 | `user-design:remove` | prune stale user designs |
| 01:00 (prod) | `order:update-success-status` | auto-move shipped → success after N days (`AUTO_UPDATE_SUCCESS_STATUS`) |
| 10:00 | `order:follow-up` | follow-up mail for orders never checked out |
| 10:30 | `order:send-out-nps` | NPS survey mail after completion |
| 18:00 | `order:update-delivery-status` | poll carrier tracking → status |
| (manual) | `RunGivePoint`, `SuccessOrderStatusCheckup`, `TestUpdateSuccessOrder` | maintenance |

Also HTTP-triggered cron endpoints: `GET /api/cronjob/update-delivery-status`, `/sendout-nps-final`, `/notify-miss-checkout`.

## 11. Reports (back-office)
Orders (DataTable + Excel `download-report-order`, `download-excel-order`, `/api/export/orders`), New orders, Quotations, Non-payment orders, **Sales** (ฝั่งขาย) + export, **Sales tax** (ภาษีขาย) + export, **Payments** (per payment channel: fee, VAT, WHT, net, cut-off/transfer date, FI doc numbers; export, export-with-revenue, send email `ReportPaymentEmail`), Point users, Promotion usage, Event logs report, Calculate logs, Search logs, Download-drawing logs, Order SAP logs, Tracking product logs, User designs.

## 12. Environment variables (names only; values live in AWS Secrets / `.env.*`)
```
APP_ENV APP_URL APP_API_URL LOCOPACK_SME_WEB_URL SITE_NAME COOKIE_DOMAIN SESSION_DOMAIN
DB_* REDIS_* QUEUE_CONNECTION SQS_QUEUE_NAME SQS_QUEUE_PREFIX EMAIL_QUEUE MAIL_*
AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION AWS_BUCKET AWS_PATH S3_BUCKET_PATH AWS_SECRET_NAME CLOUDWATCH_LOG_GROUP_NAME
PUSHER_APP_ID PUSHER_APP_KEY PUSHER_APP_SECRET PUSHER_APP_CLUSTER
2C2P_PANCOUNTRY 2C2P_MERCHANTID 2C2P_SECRETKEY 2C2P_SECRETKEY_SHA 2C2P_CURRENCYCODE 2C2P_URLSECUREPAY 2C2P_API_END_POINT 2C2P_VERSION 2C2P_VERSIONSECUREPAY 2C2P_PASSPHASE 2C2P_CERTFILE 2C2P_PEMFILE 2C2P_REDIRECT_URL
SCB_* (services.scb, qr_30, qr_cs, casa, ccfa) SCB_WEBHOOK_SECRET
THAI_BULK_SMS_KEY THAI_BULK_SMS_SECRET THAI_BULK_SMS_URL
LINE_NOTIFY_TOKEN LINE_BOT_CHANNEL_ID LINE_BOT_CHANNEL_SECRET LINE_BOT_CHANNEL_ACCESS_TOKEN LINE_BOT_CLIENT_ID LINE_API_URL LINE_BOT_RICHMENU_ID_FOR_GUEST LINE_BOT_RICHMENU_ID_FOR_USER LINE_RICH_MENU_ID LINE_CHANNEL_ACCESS_TOKEN
CUTTLY_API_KEY DRAWING_URL UR_DESIGN_URL ENABLE_SHIPPING_LIST PROCESS_SAP_URL POINT_EXPIRATION_DATE
DESIGN_COST_FOR_POUCH DESIGN_COST_FOR_POP SALE_MARGIN_GRAPHIC_DESIGN_FEE_FOLDING SALE_MARGIN_GRAPHIC_DESIGN_FEE_LABEL SALE_MARGIN_GRAPHIC_DESIGN_FEE_TAG SALE_MARGIN_GRAPHIC_DESIGN_FEE_CORRUGATE SALE_MARGIN_STRUCTURE_DESIGN_FEE SALE_MARGIN_FIX_COST SALE_MARGIN_TARTGET_MARGIN SALE_MARGIN_VAT
SENTRY_LARAVEL_DSN INSPECTOR_INGESTION_KEY
```

## 13. How Packio uses this reference
- **Port exactly** (with golden tests): pricing calculators and their shared maths (layout/pattern area, waste, margin, delivery, design fee, VAT, rounding helpers `convertTo2Decimal`, `roundUp`, `calculateVat`, `calculateWithholdingTax`), shipping rate engines, business-day helpers (`addDateWithOutWeekend`), lead-time rules, order/graphic/template status semantics, unpaid-order expiry rule (D-060).
- **Use as functional inspiration** (Packio may improve): admin screens and filters, reports, notifications, promotions and points mechanics (Packio rules in D-053, D-130…D-136 win), document layouts (issuer is Collective Group (Thailand), D-092).
- **Do not use**: SAP (§6, D-030), SCGP PDPA API, LINE Notify, legacy credentials/accounts, test/dev routes, legacy URLs.
- Money: decimal-safe arithmetic everywhere; Time: `Asia/Bangkok` for business rules.
