# UAT seed สำหรับตรวจพอร์ทัลและคลังแบรนด์ให้ครบ · Claude Code prompt (getpack-api)

## วิธีใช้

- **ที่วาง:** session ของ `getpack-api` · branch `fix/uat-phase0`
- **ต้องรันอยู่:** API (localhost:3000) และฐานข้อมูล UAT `getpack_uat_20261012`
- **ผลลัพธ์:** ไฟล์ `docs/design/portal-redesign/UAT-SEED-IDS.md` (id และลิงก์ของข้อมูลที่สร้าง) ส่งไฟล์นี้กลับมาให้ผมตรวจต่อ
- **ทำไมต้องรันฝั่งคุณ:** ฐานข้อมูลและ API อยู่ที่ localhost ในเครื่องคุณ เครื่องมือของผมเข้าไม่ถึง

---

## 🟦 API

```text
Read docs/design/GLOBAL-RULES.md, docs/design/portal-redesign/AUDIT-PORTAL.md (§1 coverage) and
docs/design/brandkit-redesign/BRAND-KIT.md first. Branch: fix/uat-phase0 (git fetch; continue it if it exists).

<context>
The customer-zone audit could not open 5 routes because UAT has no data for them, and the brand-kit round needs
a sample kit. UAT is populated by test/uat/populate.uat-spec.ts (`pnpm uat:populate`). It drives the API exactly
like real users (C01–C13, OTP 000000) and must stay that way. No raw SQL, no direct Prisma writes except where the
existing populate spec already uses an admin/service path for the same kind of record.
</context>

<task>
Add idempotent steps to the populate spec. Each step checks whether its record already exists (by a stable
reference or name) and skips if so. Run against the UAT database.
1. RFQ basket (C02): a basket with 2 lines (one instant-price product, one quote-only product) saved and not yet
   submitted → /account/rfq-baskets/[basketId].
2. Sample (C03): a sample request from a saved quote, moved through the admin path to "shipped" with a shipment
   number → /account/samples/[sampleId].
3. Structural request (C05): a request for a 6-slot bottle tray with 2 reference photos. The team uploads
   draft round 1 and asks one question → /account/structural-requests/[requestId].
4. Agent (C13): C13 applies to and is approved as a sales agent. Two customers bound through the agent link: a new
   phone 0800000114 with one paid order, and 0800000115 signed up with no order. Generate one statement (pending)
   → /account/agent/customers, /leads, /commissions, /statements, /statements/[id]. No factory referral data
   (DECISIONS-PORTAL P-03).
5. Tracking link (O6, C06): mint one durable tracking link through the admin/service path; write the full URL
   into the ids file (it is a test link) → /track/[token].
6. Company approval (C09–C11): C10 (buyer) places an order above ฿10,000 incl. VAT for UAT-CO-001, so it waits in
   C11's approval queue. Do not approve it.
7. Withholding tax (C07): mark the C07 juristic buyer profile as withholding. One instalment shows "awaiting 50 ทวิ"
   if the current model supports it; if not, note "not supported yet" and skip.
8. Brand kit (C09): one company kit "UAT แบรนด์หลัก" with 4 colours (one with CMYK) and a font pair from studio-served
   fonts. Upload a company logo asset (SVG fixture from test/fixtures; add one if missing, neutral shapes only, no
   real brand).
9. Write docs/design/portal-redesign/UAT-SEED-IDS.md: for each step, account, ids, URLs on http://localhost:3001,
   and whether it was created or already existed.
Rules: GLOBAL-RULES apply (no factory names in customer-visible data; test names stay "ทดสอบ"). No real payments.
The QR/fake payment helper already used by the spec is fine. Run `pnpm uat:populate`, then lint and typecheck.
Commit "test(uat): seed portal + brand-kit audit data" and push.
STOP with the report and the ids file.
</task>
```
