# getpack portal audit · 2026-10-28

Living record of the customer-zone audit, the recommendations and the decisions. Read this before any new round on
/account, /business (logged-in) or /track. Update it when a finding is fixed or a decision changes.

---

## 0. Working agreement (owner ↔ Claude)

- Claude is the head of the getpack business team. It answers business-team questions and decides on the owner's
  behalf. Anything legal, tax or binding on real money goes to the named signer, and ships as config that stays off
  until signed.
- Every round proposes improvements and new features for every page. The owner accepts them all by default. Each
  one ships behind its own flag.
- Design must look like a skilled human designed it, never AI-generated. That means:
  - the existing getpack tokens and type only;
  - ledger-style lists instead of floating cards;
  - real wording instead of explanatory filler;
  - few callouts, and only where the customer must act.
- Every round delivers:
  - an audit of every route at 1440 and 390 px (read-only in UAT);
  - a canvas prototype (HTML, published as an Artifact) with a "ดูสิ่งที่เปลี่ยน" panel;
  - a prompt pack with 🟦 API and 🟩 Web boxes per phase;
  - this kind of .md record;
  - a zip.
- Test accounts on UAT (localhost:3001): phone 08000001xx and OTP 000000. C01 มาลี, C02 วิชัย, C03 นภา, C05 สุดา,
  C06 อนันต์, C07 ปรีชา (juristic, WHT), C08 ปริญญา, C09–C11 company UAT-CO-001, C12 ชัยวัฒน์, C13 อรุณี.

---

## 1. Coverage: 51 customer routes

✓ = opened and checked at 1440 and 390 px · ◐ = only an empty or error state could be checked · ✗ = not reachable without creating data

| Area | Route | Status | Account used |
|---|---|---|---|
| Track | /track | ✓ | guest |
| Track | /track/[token] | ✓ (test link minted via API as C06 for O6) | C06 |
| Sign-in | consent step after OTP | ✓ | C03, C06, C09 |
| Account | /account (overview) | ✓ | C01, C07, C09 |
| Orders | /account/orders · /[id] | ✓ (designed in account-orders pack) | C01, C06, C07 |
| Orders | /[id]/artwork | ✓ | C01 O16 |
| Orders | /[id]/proof | ✓ (no proof yet) | C01 O17 |
| Orders | /[id]/receipt | ✓ | C01 O8 |
| Orders | /[id]/claim | ✓ (window closed) | C01 O8 |
| Orders | /[id]/claims/[claimId] | ✓ | C01 UATCL-2610-0001 |
| Orders | /[id]/reorder | ✓ | C01 O8 |
| Orders | /account/instalments | ✓ | C01, C07 |
| Quotes | /account/quotes | ✓ | C01, C07 |
| Quotes | /account/rfqs · /[rfqId] | ✓ | C01, C03 R2, C07 R5 |
| Quotes | /account/rfq-baskets/[basketId] | ✓ (after migrate deploy) | C01 UATRB-2610-00001 |
| Designs | /account/designs | ✓ | C01 |
| Designs | /account/samples | ✓ (empty) | C01 |
| Designs | /account/samples/[sampleId] | ✓ | C01 (quoted, awaiting quote) |
| Designs | /account/structural-requests | ✓ (empty) | C01 |
| Designs | /account/structural-requests/new | ✓ (form, not submitted) | C09 |
| Designs | /account/structural-requests/[id] | ✓ | C01 (declined, assigned) |
| Reorder | /account/replenishment | ✓ (empty) | C01 |
| Reorder | /account/call-offs · /[agreementId] | ✓ | C07 |
| Documents | /account/documents | ✓ | C01, C07 |
| Messages | /account/messages · /[conversationId] | ✓ | C01, C06 |
| Rewards | /account/points · /wallet · /referral | ✓ | C01, C07 |
| Rewards | /account/agent | ✓ | C01 |
| Rewards | /account/agent/customers · /leads · /commissions · /statements · /statements/[id] | ◐ crash for non-agents | C09 |
| Settings | /account/addresses · /notifications · /privacy (+ edit/add/delete dialogs opened, not submitted) | ✓ | C01, C07 |
| Settings | /account/company | ✓ redirects to /business | — |
| Company | /business (logged-in) · /approvals · /reorder · /credit · /members · /branches · /assets · /settings · /api · /apply | ✓ | C09 |

To finish coverage, run portal Phase 0 API item 12b (UAT seed), which seeds the following in UAT: one RFQ basket, one sample, one structural request, one agent with
customers and a statement, and one tracking link (minted by an admin). Then re-check the ✗ and ◐ rows.

---

## 2. Findings (evidence) and where they are fixed

Severity: P0 = money, tax or confidentiality · P1 = wrong state or dead end · P2 = clarity, layout or a11y.

| # | Sev | Finding | Fix in |
|---|---|---|---|
| F-01 | P0 | Instalment orders get a "final" TR on top of the instalment TRs. The design is intentional (`customer_documents.deducted_prior_amount`, "§2 deposits & instalments"), but the amounts are wrong, read-only DB 2026-10-28. TR-00009 (O7): net 186,213.86 + VAT 11,733.59 ≠ gross 179,361.06; it restates the full VAT (= TR-07 + TR-08) and the full WHT 5,021.82 (= 2 × 2,510.91), so VAT and WHT are counted twice in any report that sums documents. Same pattern on TR-00012 (O8) and TR-00016. The customer list shows ฿179,361.06 as if it were a new charge | portal P0 (P-01, S-02) |
| F-02 | P0 | Design thumbnails point at `abbon-oic-documents.s3…/getpack/customer_content/2026/`: broken, and exposes another company's bucket | portal P0 (P-20) |
| F-03 | P0 | Agent page says "ไม่เกิน 30% ของกำไร" and pays a factory referral reward of ฿3,000 | portal P0 (P-02, P-03) |
| F-04 | P0 | "โรงงานรับงานแล้ว" production sub-step on the customer order page (O6, O7) | portal P0 |
| F-05 | P0 | Referral link uses `https://www.getpack.invalid/r/…` | portal P0 (P-21) |
| F-06 | P0 | Public tracking DTO still returns the carrier `trackingUrl` / `trackingNo` (possible origin leak) | portal P0 |
| F-07 | P1 | /account/agent/customers, /leads, /commissions, /statements, /statements/[id] crash with "เกิดข้อผิดพลาด PK-…" for a non-agent instead of showing the join page | portal P0 (new) |
| F-08 | P1 | Reorder price breakdown (O8): "สินค้า ฿43,860.00" already includes VAT, yet VAT ฿2,893.85 is listed as if added. Lines appear to sum to ฿47,128.35 but the total is ฿44,234.50 | portal P0 (new) |
| F-09 | P1 | Reorder price "ใช้ได้ถึง 28 ต.ค. 2569 12:00" (hours), while saved quotes lock for 15 days. Production shows "ประมาณ 10 วันทำการ" against the 5-working-day standard, with no explanation | portal P0 (new) · business: confirm per-product lead time |
| F-10 | P1 | Claim UATCL-2610-0001: "รอทีม getpack · ทีมงานตอบกลับแล้ว… · ตัดสินภายใน 13 วันที่ผ่านมา เลยกำหนด". The statuses contradict each other, the wording is broken, and the claim is 16 days overdue with no escalation | portal P0 (new) · P-05 SLA applies to claims too |
| F-11 | P1 | Artwork page (O16, unpaid and overdue): upload is offered with no "ตรวจหลังชำระเงิน" note (Stage A decision) and no dieline download; "โทรหาเรา" shows no number | account pack Phase 0 recheck + portal P0 |
| F-12 | P1 | Company bulk reorder example uses "PK-2569-00113", a legacy Packio prefix mixed with a BE year. Real numbers look like UATOR-2610-00008 | portal P0 (new) |
| F-13 | P1 | Company approvals page reads "คำสั่งซื้อของคุณที่รอผู้อนุมัติ" even for the admin, and "เกินวงเงินผู้สั่งซื้อ" vs "ยอดเกิน ฿10,000" uses two different rules in the wording | portal P8 |
| F-14 | P1 | Overview shows "เริ่มกล่องแรกของคุณ" to customers who have orders (C07, C09). A completed order shows "แจ้งปัญหาสินค้า" next to "หมดเวลาแจ้งเคลม" | portal P0 |
| F-15 | P1 | O6 main status "กำลังผลิต" although every production sub-step is done. Ship date passed with no late badge | portal P0 |
| F-16 | P1 | Instalment overdue state differs from the overview; overflows at 390 px | portal P0 |
| F-17 | P1 | Quotes: 9 duplicates, no number, no filter; expired quote/RFQ is a dead end; hidden shipping ฿374.50 | portal P3 |
| F-18 | P1 | Call-off: "piece", remaining 0, "ไม่กำหนด", min 1 | portal P0, P4 |
| F-19 | P1 | Messages: 16-day unanswered message, no SLA; empty render 2–3 s; RFQ questions not in Messages | portal P6 |
| F-20 | P1 | Consent step: native triangles, links inside labels, "[UAT]" legal text, privacy notice "accepted", marketing bundled into one checkbox | portal P2 |
| F-21 | P2 | Dimension label order varies (ยาว×กว้าง×สูง vs กว้าง×ยาว×ลึก) across quotes, RFQ, reorder and order spec | spec helper (PDP Phase 0) + portal P0 |
| F-22 | P2 | RFQ label "material" untranslated; tape size as L×W×H | portal P0 |
| F-23 | P2 | Documents: empty status column, no delivery note / billing statement, CE date inputs, no WHT handling | portal P5 |
| F-24 | P2 | Address line mixes in the company name; toggles have no aria state; cookie banner repeats | portal P0, P8 |
| F-25 | P2 | Proof page shows a stray "หัวข้อ" label above the studio link | account pack recheck |
| F-26 | P2 | Company API page: webhook management is API-only (no UI); scopes shown as raw ids (fine for developers, but add a plain description) | portal P9 F27 area |
| F-27 | P2 | Structural request form: "ทีมจะติดต่อกลับเมื่อมีผู้รับงาน" implies an outside party and gives no timing. Use P-10: first draft within 3 working days | portal P4 |
| F-28 | P2 | Brand kits: fonts limited to studio OFL fonts (D-284 guard); company "font" assets are storage only; individuals have no kit; no text-to-outline found in the print path | brandkit-redesign/PROMPT-brand-kit.md + BRAND-KIT.md |

| F-29 | P1 | Delete-data dialog (C01) does not say what is lost: store credit ฿792.29, 20 points, designs, brand fonts. It also gives no timeline and asks for no identity check. One click sends the request | portal P8 |
| F-30 | P2 | Address edit sheet: phone field too narrow (number cut off); no "ชื่อสถานที่/บริษัท" field, so company names end up in the street line; "รายละเอียดเพิ่มเติม" is vague | portal P8 |
| F-31 | P2 | Tax profile form is good (individual / juristic / government, head office / branch, WHT switch, document e-mail). Missing: prefill from tax-ID lookup, WHT rate; postcode comes before the registered address, which reads in the wrong order | portal P8 (keep the government option) |
| F-32 | P2 | Privacy page: "อ่านข้อความฉบับเต็ม" opens "[UAT] ข้อความทดสอบ…" inline under every consent | portal P2 (LegalReader) |

| F-33 | P0 | Public /track/[token] (test link for O6) shows the step "โรงงานรับงานแล้ว" to anyone holding the link. The public DTO also carries `statusLabelAdminTh` and internal promised dates per step. Status reads "กำลังผลิต" although every step is done, and the 26 ต.ค. ship date has passed with no late notice. The shipment number is shown twice. The minted link host is `https://www.getpack.invalid` | portal P0, P1 |
| F-34 | P0 | UAT ran newer code than its schema: 4 migrations were not applied (rfq_product_reference, c1b_stock_hints_basket_pending, c1c_fit_range_bounds, c1d_superadmin_controls). /v1/store/rfqs and /rfq-baskets returned 500, which broke the quotes pages. Fixed on 2026-10-28 by `prisma migrate deploy`; /health is back to 200. Add a startup check that refuses to boot (or reports 503 with the reason) when migrations are pending | portal P0 (new) |
| F-35 | P1 | RFQ baskets have no way in from the menu or the quotes list (orphan route). Totals hide shipping (฿25 × 500 + VAT ≠ ฿13,749.50). "ผลิต 21 วัน" does not say whether these are working days. "ยอมรับและใส่ตะกร้า (0)" is disabled with no reason | portal P3 |
| F-36 | P1 | Samples: the list says "ไม่มีค่าใช้จ่าย" while the detail page says "รอใบเสนอราคา…ค่าตัวอย่าง". The detail page has no product name and no link to its quote. The credit rule appears only "ตามเงื่อนไขที่แสดงหลังอนุมัติ" (state it before purchase). Price shown without a VAT line. "7 วัน" is not labelled as working or calendar days | portal P4 |
| F-37 | P2 | Structural requests: "มีผู้ออกแบบรับงาน / ผู้ออกแบบกำลังศึกษา" reads like an outside party, so use "ทีมออกแบบ". No draft due date (P-10: 3 working days). A declined request points to "หน้าแบบกล่อง" with no link to the suggested style | portal P4 |

Forms opened (read-only, nothing saved): address edit, add tax profile, privacy full text, delete-data request.

No horizontal scroll at 390 px on any order sub-page, structural form, RFQ detail or messages page that was checked.

---

## 3. Recommendations per page (accepted by the owner)

| Page | Recommendation | Where |
|---|---|---|
| /track | Two lookup modes; verify to see more; LINE follow; delivery window; receiver change; add-to-calendar | portal P1, F1, F11, F12 |
| Consent | Card per document, notice vs acceptance, per-channel marketing, legal reader with summary/TOC/progress, change diff | portal P2, F13 |
| Quotes | Numbers, lock meter, re-quote dialog, RFQ owner status, answer in sheet, approver link, compare, next price break, expiry reminder | portal P3, F3, F4, F14, F15 |
| Designs | Real thumbnails, sane versions, auto-claim drafts, sample and structural flows, share 3D review, print-ready badge | portal P4, F16, F17 |
| Reorder | Usage forecast, order-by date, reminders, call-off numbers, scheduled call-offs, multi-item reorder | portal P4, F5, F18, F19 |
| Order reorder page | Show "ราคารวม VAT แล้ว" lines that add up (goods ex-VAT, shipping, VAT, total). Price valid 15 days like quotes (P-24). Explain any lead time above the 5-day standard | portal P0 (new) |
| Claim page | One status per owner (รอทีมตรวจ / รอข้อมูลจากคุณ / ตัดสินแล้ว), SLA countdown (P-25), escalation to CS lead, outcome with credit/remake details | portal P0 + P6 |
| Artwork page | Download dieline (AI/PDF, free, as decided), unpaid note "ตรวจหลังชำระเงิน", phone/LINE shown, preflight results per file | account recheck + portal P0 |
| Documents | Month groups, e-Tax status, all types, ZIP, auto-mail, WHT certificate flow, e-Tax files, statement of account | portal P5, F2, F6, F20, F21 |
| Messages | Unified inbox with subjects and status, SLA, context attach, CSAT | portal P6, F8, F22, F23 |
| Rewards | Tier ladder, rules, history; referral share card; agent dashboard; points at checkout | portal P7, F9, F24, F25 |
| Agent sub-pages | Non-agents land on the join page (no crash); agents get customers/leads/commissions/statements under one tab with masked names | portal P0 + P7 |
| Settings | Address place name and notes; buyer profiles with tax lookup and WHT; notification matrix; privacy rights; sessions | portal P8, F26 |
| Company | Move to /account/company/*; approvals for admins show all pending; one threshold wording; contact routing; spend insights; webhook UI | portal P8, F10, F27, F28 (new) |
| Delete data | Show what is lost (credit, points, designs, fonts) with amounts; offer to spend or refund credit first; OTP confirmation; 30-day timeline; cancel within the window | portal P8 |
| Brand kit (Studio) | Customer fonts, colours with CMYK/Pantone, logo variants and rules, text styles and data blocks, personal and company kits, locks and compliance check, branch batch, import from brand guideline PDF, versioning, external designer role | brandkit-redesign/PROMPT-brand-kit.md + BRAND-KIT.md |

## 4. Decisions added in this audit

| # | Decision |
|---|---|
| P-24 | A reorder price is a quote. It locks for 15 days like any saved quote, not until noon the same day. |
| P-25 | Claims are decided within 5 working days of the claim date. At 3 working days with no decision, the CS lead gets an alert. The customer sees one status and the due date. |
| P-26 | Shown lead time comes from data per product. When it is longer than the 5-working-day standard, the page says why (material or product type). The business team reviews the 10-day value on corrugated postal boxes. |
| P-27 | Non-agents opening any /account/agent/* page see the join page, never an error. |
| F28 | New flag FEATURE_COMPANY_WEBHOOKS_UI: manage webhook subscriptions and delivery history in /account/company/api. |
| F29 | New flag FEATURE_APPROVAL_BUDGET (from the Stitch round): optional branch budget; approval shows used / after-approval; over budget flagged, not blocked. |
| F30 | New flag FEATURE_DOCS_RECONCILE (Stitch round): per-order table of non-voided tax invoices against the order total. |
| F31 | New flag FEATURE_STUDIO_BRAND_LOCK (Stitch round): "ใช้เฉพาะสีแบรนด์" switch and edge-distance check in the Studio. |
| Brand kit | Customer fonts allowed (P-22). Brand kits are free for every account. Quotas: individual 20 fonts, company 200 fonts, 2 GB per account. The customer attests the licence on upload; takedown within 1 working day of a rights notice. Locks and the pre-order check are for company accounts, default "warn". Font and logo files of closed accounts are deleted after 90 days, except files tied to ordered jobs (2 years). Print text is outlined via HarfBuzz shaping (Thai-correct). Production never receives font files. Sign-off S-06 (legal): licence attestation text and takedown process. |

## 5. Signer queue

S-01 WHT rates · S-02 void duplicate tax invoices · S-03 ToS/privacy text · S-04 agent WHT and agreement ·
S-05 DBD lookup terms · S-06 font licence attestation and takedown. All are business-decided and wait for the
accountant or legal adviser.

---

## 6. Whole customer side — what is designed and what is not (2026-10-28)

The web app has 113 customer-facing `page.tsx` routes (storefront, account, company, track, LIFF, share links).

**Designed in an existing pack:**

- styles · products · category · pdp · configurator · checkout (incl. /cart, /checkout/pay, /payments/return)
- account-orders · studio (incl. /studio/upload) · editor · upload · business (/business, /contact, /partner-with-us, /network)
- portal (this pack: /track + 51 /account and company routes) · brand kit

**This pack:** 49 of 51 routes are ✓. The 5 agent sub-pages are ◐ until seed step 4 creates an enrolled agent.

**Not designed by any pack yet:**

| Group | Routes | Why it matters |
|---|---|---|
| LINE mini app | /liff, /liff/chat, /liff/orders, /liff/orders/[id], /liff/orders/[id]/proof, /liff/orders/[id]/reorder, /liff/pay/[id], /liff/points | Thai SMEs live in LINE. Proof approval, payment and reorder happen here more than on the web. |
| Sign-in | /sign-in (phone, OTP, LINE login, errors, lockout) | Only the consent step after OTP was designed. |
| Share links | /q/[token] (quote), /design/shared/[token] (+ /edit), /design/[id], /l/[token], /r/[code], /referral/[code] | These are the first page a customer's boss, colleague or friend sees. |
| Home | / | No dedicated pack. The header comes from styles. |
| Help and content | /help, /help/chat, /help/contact, /help/faq, /help/glossary, /help/how-it-works, /faq, /guarantee, /learn, /learn/[slug], /articles, /articles/[slug], /materials, /templates, /samples, /reviews, /about | Must say only what the system does. Reviews must be real reviews only. |
| System | /search, /legal/terms, /legal/privacy, /legal/cookies, 404 (/[...rest]) | |

**Recommended order of the next rounds:**

1. **Round 2:** LINE mini app + sign-in + share links (16 routes). This is where most repeat customers act.
2. **Round 3:** home + help/content + search + legal + 404 (22 routes).

## 7. New recommendations per menu (F32–F53, accepted under P-23)

Each one ships behind its own flag and states only what the system really does.

| # | Menu | Recommendation |
|---|---|---|
| F32 | Overview | One "ต้องทำ" queue across orders, instalments, quotes, 50 ทวิ, approvals and claims, sorted by due date, each with one button. |
| F33 | Orders › proof | Pin comments on the proof (per panel), approve panel by panel, and compare proof v1 and v2 side by side. |
| F34 | Orders | Split delivery: one order to several branch addresses with quantity per address (company accounts). |
| F35 | Orders › receipt | QC report PDF per order: measured size against ± 3 mm and colour ΔE2000 against ≤ 3, with photos. Shown only when production recorded the measurements. |
| F36 | Instalments | LINE/e-mail reminder 3 days before an instalment is due, with a PromptPay QR deep link. "ชำระทั้งหมดที่ค้าง" in one payment. |
| F37 | Quotes | "ขอราคาเพิ่มอีกจำนวน": add up to 3 quantity tiers to a saved quote in one click (instant styles priced at once, RFQ goes to the team). |
| F38 | RFQ | Start an RFQ from a photo of an existing box. The team replies with the suggested spec. No automatic spec claims. |
| F39 | Designs | Version history per design: restore and compare two versions. |
| F40 | Designs | Download your own dieline (PDF) and the print-ready PDF of designs you ordered. |
| F41 | Samples | Sample fee credited to the first order of the same spec within 30 days (business value: converts samples to orders; amount set in config). |
| F42 | Structural requests | 3D approval in the browser with dimension read-outs; approve or request a revision round (P-10 counts rounds). |
| F43 | Replenishment / call-offs | Customer replies to the LINE reminder with a stock count; the forecast updates. |
| F44 | Documents | Monthly input-VAT summary (Excel) for the customer's accountant, built only from issued tax invoices. |
| F45 | Messages | Company shared inbox: colleagues with the right role see and answer the same thread. |
| F46 | Points | Reminder 30 days before points expire, with the baht value. |
| F47 | Agent | Commission forecast: pending → payable date per order (P-02 rules), no customer PII beyond what the agent already sees. |
| F48 | Settings › addresses | Import branch addresses by CSV with validation and a preview. |
| F49 | Settings › privacy | Self-service data export (ZIP of profile, orders and documents), ready within 24 hours, link valid 7 days. |
| F50 | Company › members | Spending limit per member; above it the order goes to approval. |
| F51 | Company › approvals | Approval delegation while an approver is away, with start and end dates and an audit log. |
| F52 | Track (verified) | Proof of delivery: delivery photo and receiver name after hand-over. |
| F53 | Brand kit | One-click brand guideline PDF from the kit, to send to outside designers. |
