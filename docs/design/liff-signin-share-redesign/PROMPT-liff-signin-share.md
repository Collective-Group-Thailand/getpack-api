# getpack — LINE mini app (/liff/*) + เข้าสู่ระบบ + ลิงก์ส่งต่อ · Claude Code Prompt Pack (ลูกค้า รอบ 2)

## วิธีใช้

1. วาง 4 ไฟล์ในโฟลเดอร์ `docs/design/liff-signin-share-redesign/` ของทั้ง `getpack-web` และ `getpack-api`:
   - `PROMPT-liff-signin-share.md` (ไฟล์นี้)
   - `AUDIT-R2.md`
   - `DECISIONS-R2.md`
   - `liff-signin-share-prototype.html`
2. **ต้องมีก่อน:** portal Phase 0 (fix/uat-phase0) เสร็จแล้ว
3. **ลำดับ:** Phase 0 → 1 → 2 → 3 → 4 → 5 (ฟีเจอร์ตาม flag) ทุก Phase หยุดรออนุมัติ
4. **ต้นแบบ:** เปิด `liff-signin-share-prototype.html` เลือกหน้าจากเมนูซ้าย (มือถือเลือกจาก dropdown) ปุ่ม "ดูสิ่งที่เปลี่ยน" บอกสิ่งที่เจอ สิ่งที่เปลี่ยน และสเปกสำหรับทีมพัฒนา
5. **กล่องในแต่ละ Phase:** 🟦 API รันใน getpack-api ก่อน แล้วเขียน `docs/design/liff-signin-share-redesign/API-CHANGES.md` จากนั้น 🟩 Web รันใน getpack-web
6. **Branch:**
   - Phase 0 ลง `fix/uat-phase0` แล้ว merge เข้า `design/liff-signin-share`
   - Phase 1–5 ลง `design/liff-signin-share` ที่สร้างจาก `design/portal-redesign` (ถ้ายังไม่มี ใช้ branch ล่าสุดที่มีอยู่)
7. ห้ามชำระเงินจริง ห้ามส่ง LINE push หาผู้ใช้จริง ใช้บัญชีทดสอบ C01–C13 (OTP 000000) เท่านั้น

---

## Shared context

```text
<context>
Project: getpack (getpack.co) by Collective Group (Thailand) Co., Ltd. Next.js `getpack-web` + NestJS `getpack-api`.
This pack covers the LINE mini app (/liff, /liff/orders, /liff/orders/[id], /proof, /reorder, /liff/pay/[id],
/liff/points, /liff/chat, LiffSignIn), the sign-in page (/sign-in: phone, OTP, errors, lockout) and the links customers
share or receive (/q/[token] seller quotations, /design/shared/[token] (+/edit), /design/[id], /l/[token], /r/[code] →
/referral/[code]).

Read first: docs/design/liff-signin-share-redesign/AUDIT-R2.md (findings R2-01..R2-14, coverage) and DECISIONS-R2.md
(R2-D1..R2-D13). Prototype: liff-signin-share-prototype.html (#l-home … #ref). Design language: design tokens with
Anuphan as the only typeface (the owner switched the whole product to Anuphan); status = 6px dot + text; lists = rows in
one bordered container; one primary action per screen. LINE screens are always phone width (max 390 content) with the
LIFF tab bar (หน้าแรก, คำสั่งซื้อ, คะแนน, แชท).

Key facts from UAT 2026-10-28:
- /q/[token] (D-360) is a factory's own quotation to its own customer rendered inside the getpack storefront layout.
- /referral/[code] renders ComingSoon while /r/[code] links are given to customers.
- /liff/orders/[id] for an overdue order tells the customer to open the website; reorder shows a same-day price expiry
  and a 10-working-day lead time without a reason.
- /sign-in says signing in means accepting the terms, and shows Google/Apple although only NEXT_PUBLIC_LIFF_ID is set.
- Two share systems: features/customer/designer share (view only) and studio share (view/comment/edit).
</context>

<hard_rules>
0. Follow docs/design/GLOBAL-RULES.md → DECISIONS-STAGE-A.md → portal-redesign/DECISIONS-PORTAL.md → DECISIONS-R2.md.
1. Factory confidentiality everywhere (pages, APIs, PDFs, LINE messages, metadata, file names). Use "ทีมงาน",
   "ฝ่ายผลิต", "การผลิต". Seller quotation pages (factory → its customer) carry no getpack branding at all (R2-D1).
2. Reverse confidentiality: partner surfaces never receive getpack customer identity.
3. No internal strategy on any page.
4. Never ship sample data; the prototype's "ตัวอย่าง" items are fake. No fake reviews, counters or testimonials.
5. Copy claims only what the system does today; unfinished features hidden or behind flags.
6. Git: Phase 0 on fix/uat-phase0 then merge into design/liff-signin-share; Phases 1–5 on design/liff-signin-share. Never
   merge to main, never force-push, never rebase.
7. Single owners (GLOBAL-RULES §5): pricing service, VAT helper, spec label helper, quote 15-day lock, order customer
   status (account Phase 0), notification deep links (deep-links.service). Import, never fork.
8. Old URLs keep working (308) except /q/[token] on the getpack host, which must 404 (R2-D1). No horizontal scroll at
   360/390; dark mode; keyboard operable; visible focus; aria-live for async results; Thai-first i18n.
9. Gate per Web phase: pnpm lint · typecheck · test · build (NODE_OPTIONS=--max-old-space-size=4096) · e2e for touched
   pages · `grep -rn "โรงงาน" src/ messages/` on customer surfaces adds nothing · screenshot match with the prototype at
   1440 / 1054 / 390 dark. API phases: lint · typecheck · unit + e2e · OpenAPI regenerated.
</hard_rules>
```

---

## Phase 0 — แก้ P0/P1 ที่มีอยู่ตอนนี้

### 🟦 API

```text
Read the Shared context above and follow it. Branch: fix/uat-phase0.
<task>
1. R2-01: add config PARTNER_DOCS_BASE_URL (required in production; dev default http://localhost:3002). Seller
   quotation links (D-360) are generated on that host only. Quote-link PDFs: Producer/Creator/Title metadata = seller
   name, never "getpack". Public quote-link DTO: remove any getpack field (support contact, platform name).
2. R2-02: GET /v1/public/referrals/{code} → {referrerFirstName|null, reward:{type,value}|null, conditions[], valid}
   (reward from config referral.welcomeReward; null hides the line).
3. R2-04: reorder quote = saved quote valid 15 days (P-24); lead time returned with reason when > 5 working days (P-26).
4. Tests for all three; OpenAPI regenerated; API-CHANGES.md section "Phase 0".
</task>
STOP and report.
```

### 🟩 Web

```text
Read the Shared context above and follow it. Branch: fix/uat-phase0. Pull ../getpack-api API-CHANGES.md, pnpm gen:api.
<task>
1. R2-01: new zone/app route for the seller quotation on PARTNER_DOCS_BASE_URL with an empty layout (no getpack
   header/footer/fonts-brand/analytics/cookie banner/meta; noindex; title = seller name; accent from seller). Move
   QuoteAnswer there. `/q/[token]` on the getpack storefront host → notFound().
2. R2-02: replace ComingSoon on /referral/[code] with the landing page from the prototype (#ref) using the new API.
3. R2-04: reorder (web + LIFF) shows "ราคายืน 15 วัน ถึง {date}" and the lead-time reason.
4. Match the prototype at 1440 / 1054 / 390 dark for #q-link and #ref. Gate (hard rule 9). Commit, push, STOP.
</task>
```

---

## Phase 1 — LINE mini app

### 🟦 API

```text
Read the Shared context above and follow it. Branch: design/liff-signin-share.
<task>
1. GET /v1/store/me/todo → [{kind: pay|artwork|proof|wht|approval|claim, orderId, orderCode, title, dueAt, amount?,
   overdue}] sorted by dueAt (shared with portal F32).
2. GET /v1/store/orders?group=todo|in_production|done (cursor paging); each row includes displayName (same as order
   detail), qty, total, customerStatus, dueAt.
3. POST /v1/store/orders/{id}/requote → {oldTotal,newTotal,changed,validUntil}; POST /v1/store/payments with
   Idempotency-Key → paymentId (LIFF uses /liff/pay/{id}).
4. GET /v1/store/points/summary {available, valueThb, expiring[{points,at}], tier, spend12m, nextTier}.
5. Proof: GET /v1/store/orders/{id}/proofs (versions + pins); POST …/proofs/{v}/pins {x,y,text} (x,y 0–1); POST
   …/proofs/{v}/approve {confirmedChecklist:true}. CS sees pins in admin.
Tests; OpenAPI; API-CHANGES.md "Phase 1". STOP.
</task>
```

### 🟩 Web

```text
Read the Shared context above and follow it. Branch: design/liff-signin-share.
<task>
Rebuild /liff/* to match the prototype (#l-home, #l-orders, #l-order, #l-proof, #l-reorder, #l-pay, #l-points, #l-chat):
- home: "ต้องทำ" queue from /me/todo (one action per row, due text, overdue says "ยังไม่ถูกยกเลิก"), "ทำต่อได้" reorder
  row, points strip with ฿ value and progress to the next tier; tab badge = todo count.
- orders: underline tabs ต้องทำ / กำลังผลิต / เสร็จแล้ว with counts; rows with amount right-aligned; honest empty text.
- order: single "ขั้นถัดไป" block (pay first when due/overdue: old vs today's price, confirm & pay; "ส่งไฟล์งานก่อนก็ได้"),
  6 stages always rendered, key-value summary, "คุยกับทีมเรื่องนี้" carries the order code.
- proof: version tabs + compare, tap to pin a comment (bottom sheet), approve sheet with checklist and tolerances,
  replace "ทีมพรีเพรส" with "ทีม".
- reorder: one column, quantity shortcuts with the price-break hint (F14 when on), 15-day price, "เก็บเป็นใบเสนอราคา".
- pay: big PromptPay QR, receiver name, expiry, save QR, share to accountant (liff.shareTargetPicker, R2-D13), slip
  upload in a <details> fallback; on paid return to the order with the next step.
- points: large figure, ฿ value, tier progress, expiry note.
- chat: pick the topic, open https://line.me/R/oaMessage/{oaId}/?{text} with "เรื่อง {orderCode}", quick replies P-19,
  hours + SLA (P-05).
Match the prototype at 390 light and dark. Gate (hard rule 9). Commit, push, STOP.
</task>
```

---

## Phase 2 — เข้าสู่ระบบ (เว็บ + ใน LINE)

### 🟦 API

```text
Read the Shared context above and follow it. Branch: design/liff-signin-share.
<task>
1. OTP limits (R2-D7): 3 wrong codes → 429 {retryAfterSec: 900}; resend after 60 s; verify 401 returns attemptsLeft.
2. POST /v1/auth/customer/line/link {idToken} after OTP inside LIFF (R2-D8); DELETE …/line/link from privacy settings.
Tests; OpenAPI; API-CHANGES.md "Phase 2". STOP.
</task>
```

### 🟩 Web

```text
Read the Shared context above and follow it. Branch: design/liff-signin-share.
<task>
1. /sign-in per prototype #s-phone, #s-otp, #s-lock: remove the implied-acceptance sentence (R2-D6), show only
   configured providers (firebaseConfigured()/lineConfigured(), R2-D5), 6-box OTP with paste and
   autocomplete="one-time-code", attempts left, resend countdown, lockout page with the wait time and LINE alternative.
2. LiffSignIn per #l-signin: phone → OTP → consent inside LIFF without leaving LINE, then link the LINE account; explain
   why LINE sign-in failed; unlink control in /account/privacy.
Match the prototype at 1440 / 1054 / 390 dark. Gate. Commit, push, STOP.
</task>
```

---

## Phase 3 — ใบเสนอราคาของผู้ขาย (หน้าที่ไม่มีแบรนด์ getpack)

### 🟦 API

```text
Read the Shared context above and follow it. Branch: design/liff-signin-share.
<task>
POST /v1/public/quote-links/{token}/revision-request {name, message} → notifies the seller in the partner portal.
Rate-limit public quote-link endpoints (10/min per token). Tests; OpenAPI; API-CHANGES.md "Phase 3". STOP.
</task>
```

### 🟩 Web

```text
Read the Shared context above and follow it. Branch: design/liff-signin-share.
<task>
Seller quotation page per prototype #q-link on PARTNER_DOCS_BASE_URL: A4 paper layout, right-aligned figures, amount in
Thai words, accept (name, position, PO, agree checkbox), decline (reason), request revision (new). The seller's accent
colour only; no getpack anything (check HTML, headers, meta, favicon, PDF). Match 1440 / 1054 / 390 dark. Gate. STOP.
</task>
```

---

## Phase 4 — แบบที่แชร์, ลิงก์แจ้งเตือน, หน้าเพื่อนแนะนำ

### 🟦 API

```text
Read the Shared context above and follow it. Branch: design/liff-signin-share.
<task>
1. Merge the designer share into the studio share (scopes view|comment|edit, 15 days default, revocable) — R2-D9.
2. POST /v1/public/design-shares/{token}/approve {name} → owner notified; recipient never gets prices or account data.
3. resolveDeepLink returns {kind:"expired", subject:{type,label,path}} when the signed-in owner matches (R2-D10).
Tests; OpenAPI; API-CHANGES.md "Phase 4". STOP.
</task>
```

### 🟩 Web

```text
Read the Shared context above and follow it. Branch: design/liff-signin-share.
<task>
1. One share dialog everywhere (studio + designer), copy from the prototype; /design/shared/[token] per #d-shared with
   pins, comments and "แจ้งว่าแบบนี้ผ่าน".
2. /l/[token] miss page per #d-miss (subject + direct button, change account).
3. /referral/[code] per #ref (already started in Phase 0; finish states: unknown/expired code).
Match 1440 / 1054 / 390 dark. Gate. Commit, push, STOP.
</task>
```

---

## Phase 5 — ฟีเจอร์เสริม (เปิดทีละ flag)

### 🟦 API

```text
Read the Shared context above and follow it. Branch: design/liff-signin-share. One flag at a time, tests each, STOP after each.
<task>
R2-F1 FEATURE_LIFF_TODO — /me/todo powers the LINE home and the tab badge (shares data with portal F32).
R2-F2 FEATURE_LIFF_PROOF_PINS — proof pins and version compare in LINE (with portal F33).
R2-F3 FEATURE_LIFF_SHARE_QR — shareTargetPicker for the payment QR (R2-D13).
R2-F4 FEATURE_LINE_RICH_MENU — rich menu (หน้าแรก, คำสั่งซื้อ, คะแนน, แชท) deployed through the LINE Messaging API from
   config; per-environment menu ids.
R2-F5 FEATURE_LINE_FLEX — flex message templates per event (payment due, proof ready, shipped, delivered) with one
   button each linking /l/{token}; quiet hours per P-18 except payment confirmations.
</task>
```

### 🟩 Web

```text
Read the Shared context above and follow it. Branch: design/liff-signin-share.
<task>
For each flag the API finished: UI hidden when off, analytics `<flag>_used`, screenshots 390 light/dark, gate, STOP.
</task>
```

---

## ข้อมูลที่ทีมธุรกิจต้องเตรียม

| รายการ | ใคร | ใช้ใน Phase |
|---|---|---|
| โดเมนกลางสำหรับเอกสารของผู้ขาย (`PARTNER_DOCS_BASE_URL`) + TLS | ทีม infra | 0, 3 |
| มูลค่ารางวัลเพื่อนแนะนำ (`referral.welcomeReward`) | ทีมธุรกิจ (ตัดสินใจแล้ว: ใช้ค่าใน config ของ P-04 ไปก่อน) | 0 |
| LINE Developers: LIFF id ต่อสภาพแวดล้อม, สิทธิ์ shareTargetPicker, rich menu, OA id | ทีม infra | 1, 5 |
