# Trust section — content the business must provide (C0b, DECISIONS-STAGE-A §9.4c)

The /styles trust section ("ความน่าเชื่อถือ") shows **only** what staff enter. Nothing is invented: every part stays hidden
until real, checked content exists. Identical copy in `getpack-web` and `getpack-api`.

Shown today: the **tax-invoice note** only, from D-010 (every customer tax invoice is issued by Collective Group (Thailand)
under the getpack brand for the full amount paid) and D-125 (a tax invoice per order, per branch). Default wording
(`styles.library.trustTaxInvoiceDefault`): "ออกใบกำกับภาษีเต็มรูปแบบให้ทุกคำสั่งซื้อ ตามยอดที่ชำระเต็มจำนวน และระบุสาขาของผู้ซื้อได้".

## What to provide

| # | Item | Required details | Rules |
|---|---|---|---|
| 1 | Material / process certificates | Certificate name (TH + EN), certificate number, issuing body, expiry date, a PDF or image of the certificate | Only certificates held by getpack / Collective Group or valid for the material getpack sells. A certificate held by a production partner must not name or identify that partner (GLOBAL-RULES §1). Expired → removed. |
| 2 | Food-grade documents | Document title (TH + EN), the material / style it covers, test standard, lab, date, a PDF | Per material class; never implied for materials it does not cover. |
| 3 | Production photos ("รูปงานจริงระหว่างผลิต") | JPG/WebP, alt text TH + EN | Product and process close-ups only: **no** manufacturer name, logo, signage, uniforms, vehicles, location, windows / outdoor views or identifiable workers; EXIF/GPS stripped on upload (GLOBAL-RULES §1). |
| 4 | Customer logos | Brand name, logo file (SVG/PNG), **written permission** from the brand (kept on file, with date and signatory) | No logo without written permission (GLOBAL-RULES §3). |
| 5 | Tax-invoice wording | TH + EN, if the business wants other words than the default above | Must stay true to D-010 / D-125; company name, tax id and branch come from settings, not from this text. |
| 6 | Per-style facts (optional) | Recyclable, plastic-free, certification codes per style | Business data only, never derived from the material. |

## Where staff enter each item

| Item | Where | Who |
|---|---|---|
| 1–5 | Back office → Style library → library page settings (`store.style-library.settings`, edited with `styles.curate`). **Not built yet:** the endpoint is the open contract request `store.style-library.settings` (`getpack-web/docs/contract-requests.md`); until the API implements it the section shows the default tax-invoice note only. | Marketing (wording, logos, photos), Prepress / QA (certificates, food-grade documents) |
| 3 (files) | Uploaded through the back office file upload (scanned, EXIF stripped), then picked in the settings above | Marketing |
| 6 | Back office → Style library → a style → commercial data (`PATCH /v1/admin/styles/{styleId}`, `commercial`), or the catalogue CSV once its importer exists. The style workspace screen does not show the commercial fields yet — enter them through the admin API until it does. | Marketing |
| Quote response time (`{n}` on quote-only styles) | Back office → Settings → `rfq.sla_business_hours` (per product type, platform fallback; business hours, shown as whole working days) | Admin |
