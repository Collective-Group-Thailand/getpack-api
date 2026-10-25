# Stage A — prompt พร้อมใช้ (Phase 0 ทุกชุด)

คัดลอกทั้งบล็อกไปวางใน session ใหม่ทีละอัน ตามลำดับจากบนลงล่าง (1 บล็อก = 1 session)

- repo API: `Collective-Group-Thailand/getpack-api` (ใส่ไว้ในทุก prompt แล้ว)
- ทุกขั้นใช้ branch `fix/uat-phase0` ในทั้งสอง repo
- ขั้นที่มี 2 บล็อก: รันฝั่ง API ก่อน → ตรวจรายงาน → รันฝั่ง web
- จบแต่ละ session: ตรวจ diff บน GitHub, ขั้นที่แก้หน้าจอให้ pull ลงเครื่องแล้วดูที่ localhost:3001 ก่อนรันขั้นถัดไป
- A6–A9 เป็นงานสำรวจและแก้เฉพาะฝั่ง web ถ้ารายงานบอกว่าต้องแก้ API ให้เก็บไว้ทำใน Phase ถัดไปของชุดนั้น

---

## A1 — business · Phase 0 + Phase 3b

### A1 · ฝั่ง API (repo getpack-api)

~~~~text
Repo: getpack-api (backend only — do not touch any UI code).
Read docs/design/MASTER-RUN-ORDER.md (sections 2b and 3) and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.
If PostgreSQL/Redis are not running: `sudo service postgresql start && sudo service redis-server start`.

Step: A1 — business · Phase 0 + Phase 3b, API side only.
Run the first phase prompt (Phase 0 → PLAN.md), then continue with the second (Phase 3b) in this same session;
ignore the "Stop for approval" inside Phase 0 and stop only at the end with one combined report.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

Focus: remove code/endpoints that compute public factory-network statistics (coverage, counts, thresholds) and
strip factory data from every storefront response. Known leaks from the environment audit (fix all, server-side):
- GET /v1/store/network/stats — remove the endpoint (minFactories, partnerCount, per-product-type coverage).
- GET /v1/store/public-config — remove factoryCount.
- GET /v1/store/styles/{code} and /styles/compare — remove partnersCount.
- GET /v1/store/agent/commissions, /agent/statements/{id} — remove factoryName; /agent — remove totals.factories.
  Sales agents are external people: they must not learn factory identities either.
- GET /v1/store/call-off-agreements* — remove the factory field from the response (do not rely on the UI).
- GET /v1/store/orders/{id}/shipments — events[].location: drop pickup/origin locations; keep status, time and
  destination-side locations only.
Then search for any other store/* or public response field containing factory/partner/machine/plant data and
report it. Add a contract test that fails if any store/* response contains such keys. The seed's fake factories
may stay in the database.
Integration/e2e tests need Docker and cannot run here — list the ones I must run locally.
Also explain in one line why `prisma migrate status` reports 124 migrations while 125 were counted earlier.
Do only the backend part of the phase prompt(s) below. Migrations must be reversible. Never return factory
ids/names/locations/counts in any storefront response.
When done: write docs/design/business-redesign/API-CHANGES.md (endpoints added/changed/removed, DTOs, migrations,
example requests/responses, env vars, open questions). If nothing is needed on the API side, write
API-CHANGES.md saying "No API changes" with the reason. Run lint + type-check + tests, commit, push the branch.
Never merge or open a PR to main, never force-push. Never connect to UAT/production databases or providers.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/business-redesign/PROMPT-business-contact-partners.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Map /business, /business/apply, /contact, /partner-with-us, /network: routes, components, form handlers, where
   contact submissions go today (e-mail? ticket table?), and business-account APIs (roles, approval threshold, PO,
   branches, credit request, CSV reorder).
2. Confidentiality audit: list every place a customer or the public can see factory information (pages, APIs,
   JSON-LD, e-mails, PDFs + metadata, tracking, QC photos, delivery docs, labels) and every place a factory can see
   customer identity/contact data. Include fixes in PLAN.md.
3. List what is missing for: company catalogue, budgets per branch/cost centre, ticket status lookup, callback
   scheduling, partner applications, factory-ERP module status flags, contact-info config.
4. Write docs/design/business-redesign/PLAN.md (gaps, confidentiality fixes, schema/API changes, risks). Stop for approval.
</task>

First read docs/design/business-redesign/PROMPT-business-contact-partners.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Replace /network content with "มาตรฐานการผลิตของ getpack" (keep the URL, update the footer label to
   "มาตรฐานการผลิต"). Remove the product-type coverage list, the "ยังไม่เผยแพร่ตัวเลข" block and the
   "อย่างน้อย 3 แห่ง / 30 งาน" threshold text, and delete any code/API that computes public network statistics.
2. Sections: ควบคุมคุณภาพ 4 ขั้น (ตรวจไฟล์และสเปก · ตรวจระหว่างผลิต · ตรวจก่อนส่ง · รักษาความลับ — no numbers, no
   mention of factories, partners, vetting or where production happens) ·
   เกณฑ์ตรวจ (ขนาด ± 3 มม. · สี ΔE2000 ≤ 3 เทียบตัวอย่างที่อนุมัติ · จำนวน ± 5% ส่วนที่ขาดคืนเป็นเครดิต) · สิ่งที่ลูกค้าเห็น
   (แบบให้อนุมัติ · สถานะ · ผลตรวจ · รับประกันงาน) · FAQ (ใครรับผิดชอบงานของฉัน: getpack is the seller and is responsible end-to-end — never say who produces it ·
   ไฟล์ปลอดภัยไหม · ถ้างานไม่ตรงมาตรฐาน · สั่งอะไรได้บ้าง → /products).
3. Product availability is shown only from the customer's view on product pages (instant price vs request a quote),
   never as factory coverage.
</task>
~~~~

### A1 · ฝั่ง web (repo getpack-web)

~~~~text
Repo: getpack-web (Next.js).
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.

Step: A1 — business · Phase 0 + Phase 3b, web side.
Run the first phase prompt (Phase 0 → PLAN.md), then continue with the second (Phase 3b) in this same session;
ignore the "Stop for approval" inside Phase 0 and stop only at the end with one combined report.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

API_INTERNAL_URL points to the shared UAT API (https://uat-api.getpack.co): READ-ONLY. Only GET requests;
never POST/PUT/PATCH/DELETE, never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"
API changes from this step are NOT on UAT yet: code against the contract, cover them with mocked tests
(mocks in test files only), and list what I must verify locally with both branches running.
API contract: docs/design/business-redesign/API-CHANGES.md from repo Collective-Group-Thailand/getpack-api, branch fix/uat-phase0.
If it is not in this repo yet, fetch it first (try `gh api repos/Collective-Group-Thailand/getpack-api/contents/docs/design/business-redesign/API-CHANGES.md?ref=fix/uat-phase0`
decoded from base64, then `git clone --depth 1 -b fix/uat-phase0` of the API repo into /tmp), save it to the
same path here and commit it. If you cannot access the API repo, stop and ask me to paste the file.
Use the contract exactly; do not invent endpoints.
When done: run lint, type-check, build and tests, commit, push the branch.
Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/business-redesign/PROMPT-business-contact-partners.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Map /business, /business/apply, /contact, /partner-with-us, /network: routes, components, form handlers, where
   contact submissions go today (e-mail? ticket table?), and business-account APIs (roles, approval threshold, PO,
   branches, credit request, CSV reorder).
2. Confidentiality audit: list every place a customer or the public can see factory information (pages, APIs,
   JSON-LD, e-mails, PDFs + metadata, tracking, QC photos, delivery docs, labels) and every place a factory can see
   customer identity/contact data. Include fixes in PLAN.md.
3. List what is missing for: company catalogue, budgets per branch/cost centre, ticket status lookup, callback
   scheduling, partner applications, factory-ERP module status flags, contact-info config.
4. Write docs/design/business-redesign/PLAN.md (gaps, confidentiality fixes, schema/API changes, risks). Stop for approval.
</task>

First read docs/design/business-redesign/PROMPT-business-contact-partners.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Replace /network content with "มาตรฐานการผลิตของ getpack" (keep the URL, update the footer label to
   "มาตรฐานการผลิต"). Remove the product-type coverage list, the "ยังไม่เผยแพร่ตัวเลข" block and the
   "อย่างน้อย 3 แห่ง / 30 งาน" threshold text, and delete any code/API that computes public network statistics.
2. Sections: ควบคุมคุณภาพ 4 ขั้น (ตรวจไฟล์และสเปก · ตรวจระหว่างผลิต · ตรวจก่อนส่ง · รักษาความลับ — no numbers, no
   mention of factories, partners, vetting or where production happens) ·
   เกณฑ์ตรวจ (ขนาด ± 3 มม. · สี ΔE2000 ≤ 3 เทียบตัวอย่างที่อนุมัติ · จำนวน ± 5% ส่วนที่ขาดคืนเป็นเครดิต) · สิ่งที่ลูกค้าเห็น
   (แบบให้อนุมัติ · สถานะ · ผลตรวจ · รับประกันงาน) · FAQ (ใครรับผิดชอบงานของฉัน: getpack is the seller and is responsible end-to-end — never say who produces it ·
   ไฟล์ปลอดภัยไหม · ถ้างานไม่ตรงมาตรฐาน · สั่งอะไรได้บ้าง → /products).
3. Product availability is shown only from the customer's view on product pages (instant price vs request a quote),
   never as factory coverage.
</task>
~~~~

---

## A2 — account · Phase 0

### A2 · ฝั่ง API (repo getpack-api)

~~~~text
Repo: getpack-api (backend only — do not touch any UI code).
Read docs/design/MASTER-RUN-ORDER.md (sections 2b and 3) and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.
If PostgreSQL/Redis are not running: `sudo service postgresql start && sudo service redis-server start`.

Step: A2 — account · Phase 0, API side only.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

Focus: single server-side customer status, disable the overdue auto-cancel job (re-quote instead), split the
artwork status "รอแบบไดคัท" into two (migration), per-order amounts instead of the group amount.
Do only the backend part of the phase prompt(s) below. Migrations must be reversible. Never return factory
ids/names/locations/counts in any storefront response.
When done: write docs/design/account-redesign/API-CHANGES.md (endpoints added/changed/removed, DTOs, migrations,
example requests/responses, env vars, open questions). If nothing is needed on the API side, write
API-CHANGES.md saying "No API changes" with the reason. Run lint + type-check + tests, commit, push the branch.
Never merge or open a PR to main, never force-push. Never connect to UAT/production databases or providers.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/account-redesign/PROMPT-account-orders.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Order status: implement/repair the derived customer status (รอชำระเงิน · รอไฟล์งาน · รออนุมัติแบบ · กำลังผลิต ·
   กำลังจัดส่ง · ได้รับแล้ว · เคลมกำลังตรวจ · เสร็จสิ้น · ยกเลิก). UATOR-2610-00008 must read "ได้รับแล้ว · เคลมกำลังตรวจ",
   no "ยืนยันรับของ", and the claim-window message must reflect the open claim. Add tests for each transition.
2. Payment deadline (decided: re-quote, no auto-cancel): disable/remove the auto-cancel job for overdue payments,
   change the copy, and add "ตรวจราคาใหม่และชำระ" → server re-prices the group (pricing service, current lead time),
   shows the difference, then proceeds to payment. Keep an admin-configurable long-stop (e.g. archive after N days)
   only if the business asks; default off.
2b. Artwork status split (decided): migrate "รอแบบไดคัท" into "รอทีมส่งแบบไดคัทให้" (owner team) and "รอไฟล์จากคุณ"
   (owner customer); show the owner and next step everywhere; only customer-owned states show "ส่งไฟล์งาน".
3. Delivery date: for unpaid orders show "คำนวณหลังชำระเงิน" (or recompute live) instead of a past date.
4. Group payments: on an order page show this order's share and the group total separately.
5. Overview: tier progress must state what counts (e.g. "นับยอดเมื่อได้รับของแล้ว"); fix the broken design thumbnail.
6. Error state: transient API errors show "ระบบขัดข้องชั่วคราว" with automatic retry and the reference code.
7. Rename "ขั้นตอนที่โรงงาน" and remove factory wording (hard rule 4).
8. Stop for approval with FINDINGS.md.
</task>
~~~~

### A2 · ฝั่ง web (repo getpack-web)

~~~~text
Repo: getpack-web (Next.js).
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.

Step: A2 — account · Phase 0, web side.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

API_INTERNAL_URL points to the shared UAT API (https://uat-api.getpack.co): READ-ONLY. Only GET requests;
never POST/PUT/PATCH/DELETE, never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"
API changes from this step are NOT on UAT yet: code against the contract, cover them with mocked tests
(mocks in test files only), and list what I must verify locally with both branches running.
API contract: docs/design/account-redesign/API-CHANGES.md from repo Collective-Group-Thailand/getpack-api, branch fix/uat-phase0.
If it is not in this repo yet, fetch it first (try `gh api repos/Collective-Group-Thailand/getpack-api/contents/docs/design/account-redesign/API-CHANGES.md?ref=fix/uat-phase0`
decoded from base64, then `git clone --depth 1 -b fix/uat-phase0` of the API repo into /tmp), save it to the
same path here and commit it. If you cannot access the API repo, stop and ask me to paste the file.
Use the contract exactly; do not invent endpoints.
When done: run lint, type-check, build and tests, commit, push the branch.
Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/account-redesign/PROMPT-account-orders.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Order status: implement/repair the derived customer status (รอชำระเงิน · รอไฟล์งาน · รออนุมัติแบบ · กำลังผลิต ·
   กำลังจัดส่ง · ได้รับแล้ว · เคลมกำลังตรวจ · เสร็จสิ้น · ยกเลิก). UATOR-2610-00008 must read "ได้รับแล้ว · เคลมกำลังตรวจ",
   no "ยืนยันรับของ", and the claim-window message must reflect the open claim. Add tests for each transition.
2. Payment deadline (decided: re-quote, no auto-cancel): disable/remove the auto-cancel job for overdue payments,
   change the copy, and add "ตรวจราคาใหม่และชำระ" → server re-prices the group (pricing service, current lead time),
   shows the difference, then proceeds to payment. Keep an admin-configurable long-stop (e.g. archive after N days)
   only if the business asks; default off.
2b. Artwork status split (decided): migrate "รอแบบไดคัท" into "รอทีมส่งแบบไดคัทให้" (owner team) and "รอไฟล์จากคุณ"
   (owner customer); show the owner and next step everywhere; only customer-owned states show "ส่งไฟล์งาน".
3. Delivery date: for unpaid orders show "คำนวณหลังชำระเงิน" (or recompute live) instead of a past date.
4. Group payments: on an order page show this order's share and the group total separately.
5. Overview: tier progress must state what counts (e.g. "นับยอดเมื่อได้รับของแล้ว"); fix the broken design thumbnail.
6. Error state: transient API errors show "ระบบขัดข้องชั่วคราว" with automatic retry and the reference code.
7. Rename "ขั้นตอนที่โรงงาน" and remove factory wording (hard rule 4).
8. Stop for approval with FINDINGS.md.
</task>
~~~~

---

## A3 — pdp · Phase 0

### A3 · ฝั่ง API (repo getpack-api)

~~~~text
Repo: getpack-api (backend only — do not touch any UI code).
Read docs/design/MASTER-RUN-ORDER.md (sections 2b and 3) and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.
If PostgreSQL/Redis are not running: `sudo service postgresql start && sudo service redis-server start`.

Step: A3 — pdp · Phase 0, API side only.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

Focus: ONE pricing service and ONE spec label for the same spec everywhere (฿14.79 / ฿15.70 / ฿17.26 mismatch).
This step OWNS the price reconciliation (GLOBAL-RULES §5).
Do only the backend part of the phase prompt(s) below. Migrations must be reversible. Never return factory
ids/names/locations/counts in any storefront response.
When done: write docs/design/pdp-redesign/API-CHANGES.md (endpoints added/changed/removed, DTOs, migrations,
example requests/responses, env vars, open questions). If nothing is needed on the API side, write
API-CHANGES.md saying "No API changes" with the reason. Run lint + type-check + tests, commit, push the branch.
Never merge or open a PR to main, never force-push. Never connect to UAT/production databases or providers.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/pdp-redesign/PROMPT-pdp-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Data-consistency fix. Investigate, report, then fix only after I approve the plan.
Found issues:
1. /products and /products/uat-postal-box-b show "เริ่มต้น ฿15.70 ที่ 300 ชิ้น" (reference spec: size 00,
   KA125 B, "พิมพ์ 4 สี (CMYK)"), but /configure/uat-postal-box-b defaults to size 00 · KA125 B · "ดำ" and
   shows ฿17.26 at 300 pcs. Customers see the price jump on entry.
2. Tier table shows the same unit price for 100 / 300 / 500 (฿17.26) and ฿14.96 at 1,000. Confirm whether intended.
3. Product description says "เลือกพิมพ์โลโก้ 1–2 สีได้" but print options are "ดำ · พิมพ์ 4 สี (CMYK)".
4. Reference spec says "กว้าง × ยาว × ลึก 97.5 × 140 × 60" while tables say "ยาว × กว้าง × สูง 140 × 97.5 × 60".
5. "ดาวน์โหลดแบบกล่อง" links to the generic /templates page instead of this product/size's file.
6. The Studio editor shows ฿14.79/ชิ้น at 300 pcs for a 150 × 100 × 80 mm postal box (KA125 B), which matches
   none of the above (listing ฿15.70, configurator ฿17.26). All three surfaces must call the same pricing service
   with the same spec and say which spec the price is for.

Steps:
a. Trace where the listing/start price is computed and stored vs the configurator price. Explain the gap.
b. Propose: start price = the configurator's own price for its default spec at the reference quantity,
   computed by the same engine (cached/revalidated), used by listing cards, category pages, product page and
   JSON-LD. Add a test asserting equality for every instant-price product.
c. List copy fixes for 3–4 (do not change business copy without approval) and a deep-link for 5
   (/templates?product=…&size=… or a direct file URL).
d. Write docs/design/pdp-redesign/PRICE-CONSISTENCY.md with findings + plan. Stop for approval, then implement.
</task>
~~~~

### A3 · ฝั่ง web (repo getpack-web)

~~~~text
Repo: getpack-web (Next.js).
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.

Step: A3 — pdp · Phase 0, web side.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

API_INTERNAL_URL points to the shared UAT API (https://uat-api.getpack.co): READ-ONLY. Only GET requests;
never POST/PUT/PATCH/DELETE, never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"
API changes from this step are NOT on UAT yet: code against the contract, cover them with mocked tests
(mocks in test files only), and list what I must verify locally with both branches running.
API contract: docs/design/pdp-redesign/API-CHANGES.md from repo Collective-Group-Thailand/getpack-api, branch fix/uat-phase0.
If it is not in this repo yet, fetch it first (try `gh api repos/Collective-Group-Thailand/getpack-api/contents/docs/design/pdp-redesign/API-CHANGES.md?ref=fix/uat-phase0`
decoded from base64, then `git clone --depth 1 -b fix/uat-phase0` of the API repo into /tmp), save it to the
same path here and commit it. If you cannot access the API repo, stop and ask me to paste the file.
Use the contract exactly; do not invent endpoints.
When done: run lint, type-check, build and tests, commit, push the branch.
Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/pdp-redesign/PROMPT-pdp-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Data-consistency fix. Investigate, report, then fix only after I approve the plan.
Found issues:
1. /products and /products/uat-postal-box-b show "เริ่มต้น ฿15.70 ที่ 300 ชิ้น" (reference spec: size 00,
   KA125 B, "พิมพ์ 4 สี (CMYK)"), but /configure/uat-postal-box-b defaults to size 00 · KA125 B · "ดำ" and
   shows ฿17.26 at 300 pcs. Customers see the price jump on entry.
2. Tier table shows the same unit price for 100 / 300 / 500 (฿17.26) and ฿14.96 at 1,000. Confirm whether intended.
3. Product description says "เลือกพิมพ์โลโก้ 1–2 สีได้" but print options are "ดำ · พิมพ์ 4 สี (CMYK)".
4. Reference spec says "กว้าง × ยาว × ลึก 97.5 × 140 × 60" while tables say "ยาว × กว้าง × สูง 140 × 97.5 × 60".
5. "ดาวน์โหลดแบบกล่อง" links to the generic /templates page instead of this product/size's file.
6. The Studio editor shows ฿14.79/ชิ้น at 300 pcs for a 150 × 100 × 80 mm postal box (KA125 B), which matches
   none of the above (listing ฿15.70, configurator ฿17.26). All three surfaces must call the same pricing service
   with the same spec and say which spec the price is for.

Steps:
a. Trace where the listing/start price is computed and stored vs the configurator price. Explain the gap.
b. Propose: start price = the configurator's own price for its default spec at the reference quantity,
   computed by the same engine (cached/revalidated), used by listing cards, category pages, product page and
   JSON-LD. Add a test asserting equality for every instant-price product.
c. List copy fixes for 3–4 (do not change business copy without approval) and a deep-link for 5
   (/templates?product=…&size=… or a direct file URL).
d. Write docs/design/pdp-redesign/PRICE-CONSISTENCY.md with findings + plan. Stop for approval, then implement.
</task>
~~~~

---

## A4 — configurator · Phase 0

### A4 · ฝั่ง API (repo getpack-api)

~~~~text
Repo: getpack-api (backend only — do not touch any UI code).
Read docs/design/MASTER-RUN-ORDER.md (sections 2b and 3) and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.
If PostgreSQL/Redis are not running: `sudo service postgresql start && sudo service redis-server start`.

Step: A4 — configurator · Phase 0, API side only.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

Focus: VAT rounding (฿338.58 vs ฿338.75) if computed in the API, size F / flat tiers data. Price logic was
fixed in A3 — only verify it, do not change it again.
Do only the backend part of the phase prompt(s) below. Migrations must be reversible. Never return factory
ids/names/locations/counts in any storefront response.
When done: write docs/design/configurator-redesign/API-CHANGES.md (endpoints added/changed/removed, DTOs, migrations,
example requests/responses, env vars, open questions). If nothing is needed on the API side, write
API-CHANGES.md saying "No API changes" with the reason. Run lint + type-check + tests, commit, push the branch.
Never merge or open a PR to main, never force-push. Never connect to UAT/production databases or providers.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/configurator-redesign/PROMPT-configurator-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Fix or report, smallest safe change each, one commit per item:
1. Missing translation: the quantity step renders the raw key `configurator.quantity.target`. Add the Thai/EN
   strings (label: "งบต่อชิ้นในใจ (ไม่บังคับ)") and add a test/lint that fails on any raw i18n key in rendered pages.
2. Investigate (report, don't change pricing): with size 00 selecting "พิมพ์ 4 สี (CMYK)" did not change the price
   (฿17.26), while for size C it did. Explain (minimum charge? bug?) in docs/design/configurator-redesign/FINDINGS.md.
   Also compare with the Studio editor price (฿14.79/ชิ้น at 300 pcs, 150 × 100 × 80 mm, KA125 B) and the listing
   price (฿15.70): one pricing service, one spec label everywhere.
3. Report the 100/300/500 flat tier for small sizes (00, 0) — intended minimum or bug.
4. Steps 2–4 show "เรียบร้อยแล้ว" before the customer touches them. Change the status to "ค่าเริ่มต้น" until the
   customer confirms or changes the step (UI only).
5. VAT check: for a total of ฿5,178.00 (VAT-inclusive) the summary shows VAT ฿338.58, but 5,178 × 7/107 = ฿338.75.
   Find which base the VAT is computed on (per-unit rounding? shipping?) and report; fix only after approval.
6. Size F at 100 pcs returns "สเปกนี้คำนวณราคาอัตโนมัติไม่ได้" only inside the tier table. Make the main price area
   and primary CTA switch to "ขอใบเสนอราคา" with the spec prefilled.
Stop after the report + fixes.
</task>
~~~~

### A4 · ฝั่ง web (repo getpack-web)

~~~~text
Repo: getpack-web (Next.js).
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.

Step: A4 — configurator · Phase 0, web side.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

API_INTERNAL_URL points to the shared UAT API (https://uat-api.getpack.co): READ-ONLY. Only GET requests;
never POST/PUT/PATCH/DELETE, never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"
API changes from this step are NOT on UAT yet: code against the contract, cover them with mocked tests
(mocks in test files only), and list what I must verify locally with both branches running.
API contract: docs/design/configurator-redesign/API-CHANGES.md from repo Collective-Group-Thailand/getpack-api, branch fix/uat-phase0.
If it is not in this repo yet, fetch it first (try `gh api repos/Collective-Group-Thailand/getpack-api/contents/docs/design/configurator-redesign/API-CHANGES.md?ref=fix/uat-phase0`
decoded from base64, then `git clone --depth 1 -b fix/uat-phase0` of the API repo into /tmp), save it to the
same path here and commit it. If you cannot access the API repo, stop and ask me to paste the file.
Use the contract exactly; do not invent endpoints.
When done: run lint, type-check, build and tests, commit, push the branch.
Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/configurator-redesign/PROMPT-configurator-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Fix or report, smallest safe change each, one commit per item:
1. Missing translation: the quantity step renders the raw key `configurator.quantity.target`. Add the Thai/EN
   strings (label: "งบต่อชิ้นในใจ (ไม่บังคับ)") and add a test/lint that fails on any raw i18n key in rendered pages.
2. Investigate (report, don't change pricing): with size 00 selecting "พิมพ์ 4 สี (CMYK)" did not change the price
   (฿17.26), while for size C it did. Explain (minimum charge? bug?) in docs/design/configurator-redesign/FINDINGS.md.
   Also compare with the Studio editor price (฿14.79/ชิ้น at 300 pcs, 150 × 100 × 80 mm, KA125 B) and the listing
   price (฿15.70): one pricing service, one spec label everywhere.
3. Report the 100/300/500 flat tier for small sizes (00, 0) — intended minimum or bug.
4. Steps 2–4 show "เรียบร้อยแล้ว" before the customer touches them. Change the status to "ค่าเริ่มต้น" until the
   customer confirms or changes the step (UI only).
5. VAT check: for a total of ฿5,178.00 (VAT-inclusive) the summary shows VAT ฿338.58, but 5,178 × 7/107 = ฿338.75.
   Find which base the VAT is computed on (per-unit rounding? shipping?) and report; fix only after approval.
6. Size F at 100 pcs returns "สเปกนี้คำนวณราคาอัตโนมัติไม่ได้" only inside the tier table. Make the main price area
   and primary CTA switch to "ขอใบเสนอราคา" with the spec prefilled.
Stop after the report + fixes.
</task>
~~~~

---

## A5 — upload · Phase 0

### A5 · ฝั่ง API (repo getpack-api)

~~~~text
Repo: getpack-api (backend only — do not touch any UI code).
Read docs/design/MASTER-RUN-ORDER.md (sections 2b and 3) and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.
If PostgreSQL/Redis are not running: `sudo service postgresql start && sudo service redis-server start`.

Step: A5 — upload · Phase 0, API side only.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

Focus: investigation only for the FINDINGS (where files are stored, access, retention, prepress tooling,
dieline templates). No code changes unless the phase prompt requires one.
Do only the backend part of the phase prompt(s) below. Migrations must be reversible. Never return factory
ids/names/locations/counts in any storefront response.
When done: write docs/design/upload-redesign/API-CHANGES.md (endpoints added/changed/removed, DTOs, migrations,
example requests/responses, env vars, open questions). If nothing is needed on the API side, write
API-CHANGES.md saying "No API changes" with the reason. Run lint + type-check + tests, commit, push the branch.
Never merge or open a PR to main, never force-push. Never connect to UAT/production databases or providers.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/upload-redesign/PROMPT-upload-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Bug: /configure/<slug>?design=own_file must pre-select "มีไฟล์งานแล้ว" in step 6, and the collapsed step
   summary must show the selected option (never "ออกแบบออนไลน์" when that option does not exist). Add a test.
2. Replace the copy on /studio/upload with what the system really does today until Phase 2 ships
   (no automatic check claim).
3. Write docs/design/upload-redesign/FINDINGS.md:
   - where files are uploaded today (after payment?), storage, who can access, retention;
   - which products accept own files (only these 5?) and why;
   - whether the prepress team already uses a preflight tool (e.g. Acrobat Preflight, Esko, PitStop, callas) whose
     profile we can reuse server-side;
   - whether dieline templates per product/size exist as files (.ai/.pdf/DXF) and where;
   - the "เริ่ม ฿15.70" vs ฿17.26 mismatch (same as the PDP Phase 0).
4. Stop for approval.
</task>
~~~~

### A5 · ฝั่ง web (repo getpack-web)

~~~~text
Repo: getpack-web (Next.js).
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.

Step: A5 — upload · Phase 0, web side.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

API_INTERNAL_URL points to the shared UAT API (https://uat-api.getpack.co): READ-ONLY. Only GET requests;
never POST/PUT/PATCH/DELETE, never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"
API changes from this step are NOT on UAT yet: code against the contract, cover them with mocked tests
(mocks in test files only), and list what I must verify locally with both branches running.
API contract: docs/design/upload-redesign/API-CHANGES.md from repo Collective-Group-Thailand/getpack-api, branch fix/uat-phase0.
If it is not in this repo yet, fetch it first (try `gh api repos/Collective-Group-Thailand/getpack-api/contents/docs/design/upload-redesign/API-CHANGES.md?ref=fix/uat-phase0`
decoded from base64, then `git clone --depth 1 -b fix/uat-phase0` of the API repo into /tmp), save it to the
same path here and commit it. If you cannot access the API repo, stop and ask me to paste the file.
Use the contract exactly; do not invent endpoints.
When done: run lint, type-check, build and tests, commit, push the branch.
Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/upload-redesign/PROMPT-upload-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Bug: /configure/<slug>?design=own_file must pre-select "มีไฟล์งานแล้ว" in step 6, and the collapsed step
   summary must show the selected option (never "ออกแบบออนไลน์" when that option does not exist). Add a test.
2. Replace the copy on /studio/upload with what the system really does today until Phase 2 ships
   (no automatic check claim).
3. Write docs/design/upload-redesign/FINDINGS.md:
   - where files are uploaded today (after payment?), storage, who can access, retention;
   - which products accept own files (only these 5?) and why;
   - whether the prepress team already uses a preflight tool (e.g. Acrobat Preflight, Esko, PitStop, callas) whose
     profile we can reuse server-side;
   - whether dieline templates per product/size exist as files (.ai/.pdf/DXF) and where;
   - the "เริ่ม ฿15.70" vs ฿17.26 mismatch (same as the PDP Phase 0).
4. Stop for approval.
</task>
~~~~

---

## A6 — studio · Phase 0

### A6 · ฝั่ง web (repo getpack-web)

~~~~text
Repo: getpack-web (Next.js).
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.

Step: A6 — studio · Phase 0, web side.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

API_INTERNAL_URL points to the shared UAT API (https://uat-api.getpack.co): READ-ONLY. Only GET requests;
never POST/PUT/PATCH/DELETE, never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"
When done: run lint, type-check, build and tests, commit, push the branch.
Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/studio-redesign/PROMPT-studio-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Inspect /studio, /studio/new, /studio/upload and the editor entry route; list every place a style count or path
   copy appears. Find the truth: how many styles are editable in the Studio vs orderable in /styles, and what the
   upload path really does (auto check + price, or straight to spec + manual check).
2. Write docs/design/studio-redesign/FINDINGS.md with the answers and a proposal: one hub at /studio,
   /studio/new → 301/redirect (keep ?start= params working), one source of truth for counts and copy.
3. Check: "แบบที่คนเริ่มบ่อย" currently shows the first 3 catalogue styles — confirm whether real usage data exists.
4. Stop for approval.
</task>
~~~~

---

## A7 — editor · Phase 0

### A7 · ฝั่ง web (repo getpack-web)

~~~~text
Repo: getpack-web (Next.js).
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.

Step: A7 — editor · Phase 0, web side.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

API_INTERNAL_URL points to the shared UAT API (https://uat-api.getpack.co): READ-ONLY. Only GET requests;
never POST/PUT/PATCH/DELETE, never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"
When done: run lint, type-check, build and tests, commit, push the branch.
Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/editor-redesign/PROMPT-editor-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Map the editor: routes, state store, document schema (objects, sides, variants?), canvas renderer, 3D renderer,
   preflight rules, autosave/history, upload pipeline, export pipeline, brand-kit storage, permissions/sharing.
2. Price: explain why the editor shows ฿14.79 (300 pcs, 150×100×80, KA125 B) while the listing shows ฿15.70 and the
   configurator ฿17.26. Make all three call one pricing function with an explicit spec label. Report first, fix
   after approval.
3. Write docs/design/editor-redesign/PLAN.md: gap list vs the prototype (per Phase below), schema changes needed
   (e.g. object.variant overrides, flip, gradient, path points, guides, mode preference), migration for existing
   drafts, and risks. Stop for approval.
</task>
~~~~

---

## A8 — checkout · Phase 0

### A8 · ฝั่ง web (repo getpack-web)

~~~~text
Repo: getpack-web (Next.js).
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.

Step: A8 — checkout · Phase 0, web side.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

API_INTERNAL_URL points to the shared UAT API (https://uat-api.getpack.co): READ-ONLY. Only GET requests;
never POST/PUT/PATCH/DELETE, never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"
When done: run lint, type-check, build and tests, commit, push the branch.
Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/checkout-redesign/PROMPT-checkout-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
1. Map the current cart and checkout routes, components, state, APIs (cart, addresses, shipping quote, discounts,
   points, tax invoice, payment provider, instalment, deposit), and every validation that blocks checkout.
2. Note inconsistencies: the cart spec says "ขนาด (กว้าง × ยาว × ลึก) 97.5 × 140 × 60 มม." while other pages use
   ยาว × กว้าง × สูง; shipping and VAT lines are missing from the cart summary.
3. Write docs/design/checkout-redesign/PLAN.md mapping the prototype's 4 steps to existing APIs; list gaps
   (e.g. postcode → province/district lookup, multi-item quote PDF, approver share link). Stop for approval.
</task>
~~~~

---

## A9a — styles · Phase 0

### A9a · ฝั่ง web (repo getpack-web)

~~~~text
Repo: getpack-web (Next.js).
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.

Step: A9a — styles · Phase 0, web side.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

API_INTERNAL_URL points to the shared UAT API (https://uat-api.getpack.co): READ-ONLY. Only GET requests;
never POST/PUT/PATCH/DELETE, never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"
When done: run lint, type-check, build and tests, commit, push the branch.
Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/styles-redesign/PROMPT-styles-redesign.md, section "Shared context",
and follow its <context>, <hard_rules> and <design_system> strictly for this whole task.

<task>
Phase 0 of the /styles redesign. DO NOT write or change code in this phase.

1. Open and study docs/design/styles-redesign/styles-redesign-prototype.html (all states: filters,
   size search, quick view, wizard, compare tray, mobile 390px, dark mode) and its "ดูสิ่งที่เปลี่ยน" notes.
2. Inspect the repo: the /styles route, its components, data fetching, API types/DTOs for catalogue
   styles and facets, existing compare/favourite/cart/auth/analytics/i18n utilities, header component,
   and how the Studio (design editor) is opened for a given style.
3. Reproduce the current header bug: at ~1054px width the nav item "สตูดิโอออกแบบ" overlaps the logo
   and "ติดต่อ" is covered by the search icon. Find the cause.
4. Produce `docs/design/styles-redesign/PLAN.md` containing:
   a. Mapping table: prototype section → files to create/modify → reused components.
   b. Data gap table: every field the new UI needs vs what the API returns today
      (use catalog-commercial-data-template.csv columns as the checklist). Mark: available / derivable / missing.
   c. Facet structure today (labels like "ก้นกล่อง: ก้นล็อกอัตโนมัติ") and how you'll group them
      into sub-groups (strip the "group:" prefix).
   d. Risks, open questions, and an ordered task list for Phase 1.
5. Stop and wait for my approval.
</task>
~~~~

---

## A9b — products · Phase 0

### A9b · ฝั่ง web (repo getpack-web)

~~~~text
Repo: getpack-web (Next.js).
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.

Step: A9b — products · Phase 0, web side.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

API_INTERNAL_URL points to the shared UAT API (https://uat-api.getpack.co): READ-ONLY. Only GET requests;
never POST/PUT/PATCH/DELETE, never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"
When done: run lint, type-check, build and tests, commit, push the branch.
Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/products-redesign/PROMPT-products-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Phase 0 of the /products redesign. DO NOT change code.
1. Study the prototype in all states (modes, calculator, tabs, table view, RFQ tray, mobile 390px dark).
2. Inspect: the /products route + components, /products/[category] and /products/[slug], the product DTOs
   (price mode, start price, reference qty, MOQ, unit, lead time, stock status, images, category), the instant
   pricing engine/calculators and how the configurator is opened with preset values, the RFQ/quote flow
   (single vs multi-item), cart, analytics, i18n, and what the /styles redesign already built that can be reused.
3. Write docs/design/products-redesign/PLAN.md:
   a. Prototype section → files → reused components.
   b. Data gap table: every field the UI needs vs the API today (available / derivable / missing).
      Pay special attention to: stock items' real unit prices (today they show "ราคาตามสเปก"), tier prices for
      the calculator, print-option pricing, multi-item RFQ support, mode counts and min prices per mode.
   c. Whether the pricing engine can return prices for quantity presets [100,300,500,1000,2000,5000] fast enough
      for a live calculator (target < 300ms via BFF). If not, propose the smallest endpoint that can.
   d. Risks, open questions, ordered task list for Phase 1.
4. Stop and wait for approval.
</task>
~~~~

---

## A9c — category · Phase 0

### A9c · ฝั่ง web (repo getpack-web)

~~~~text
Repo: getpack-web (Next.js).
Read docs/design/MASTER-RUN-ORDER.md and docs/design/GLOBAL-RULES.md first.
GLOBAL-RULES.md overrides the phase prompt on any conflict.

Step: A9c — category · Phase 0, web side.
Branch: fix/uat-phase0. Run `git fetch` first and continue the branch.

API_INTERNAL_URL points to the shared UAT API (https://uat-api.getpack.co): READ-ONLY. Only GET requests;
never POST/PUT/PATCH/DELETE, never submit forms, orders, payments, uploads or messages against it.
Before typecheck/build run: export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=4096"
When done: run lint, type-check, build and tests, commit, push the branch.
Never merge or open a PR to main, never force-push.
Do NOT read whole prototype HTML files — grep only the sections you need.
Stop with the phase report and wait for my approval.

--- PHASE PROMPT ---
First read docs/design/category-redesign/PROMPT-category-redesign.md, section "Shared context",
and follow its <context> and <hard_rules> strictly for this whole task.

<task>
Phase 0 of the category template redesign. DO NOT change code.
1. Study the prototype (rows view, comparison table, use-case filter, size finder, size chart with prices,
   multi-size order, flute guide, cross-link, FAQ, mobile 390px dark).
2. Inspect /products/[category]: current sidebar (it lists all 14 categories, each with "1 · ประเภท" — find
   what that number really is), filter chips (they show values with zero results), data per product
   (structure, flute/layers, surface, standard-size tables, custom-size support), the standard-size data
   behind the product page table, and whether the pricing engine can price each standard size.
3. Write docs/design/category-redesign/PLAN.md: section → files → reused components; data gap table for all
   14 categories (which have standard sizes, which are quote-only, which have a material guide);
   per-category content file schema; risks; ordered Phase 1 tasks. Stop for approval.
</task>
~~~~

---

จบ Stage A แล้วไป Stage B (styles Phase 1 บน branch `design/styles-catalog-redesign` สร้างจาก `fix/uat-phase0`) — ผมจะเตรียมไฟล์ prompt ของ Stage B–C ให้แบบเดียวกัน
