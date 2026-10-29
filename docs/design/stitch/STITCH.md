# Stitch round (2026-10-28) — what we took, what we refused

Stitch project: `projects/12520150679215817661` ("getpack — พอร์ทัลลูกค้า / ติดตาม / คลังแบรนด์").
Input: `DESIGN.md` built from `styles-redesign/design-tokens.css`.
Stitch output is a proposal only. Our prototypes and tokens stay the source of truth.
Screens are kept here as JPG for reference. All their data is sample data.

## Screens

| Screen | File | Stitch screen id |
|---|---|---|
| /track result (mobile, unverified) | track-mobile.jpg | 72817a3ae5a749e6bee15a5bc131b4e5 |
| Orders ledger (desktop) | orders-desktop.jpg | 4530c2ad270d438ea7e875b7c753f48f |
| Consent step (mobile sheet) | consent-mobile.jpg | 316b61f0bb074355b661d43cdb0e8564 |
| Brand kit · fonts (desktop) | brandkit-fonts.jpg | a143e0fecd0f4c68841c9cb3967a0634 |
| Documents grouped by order (desktop) | documents-desktop.jpg | 8a9e56286d2348668ed7f23064a5aefb |
| Order detail (mobile) | order-detail.jpg | 58f88a151538425b93c6635a4f27b41c |
| Studio · brand panel (desktop) | studio-brand.jpg | 0d36774b1fd24e4490ce47df5cdceca5 |
| Company approvals (desktop) | approvals-desktop.jpg | f2e462b1244344e399f5e893327790ab |

## Ported into the prototypes

| Idea | Where now | Flag |
|---|---|---|
| Numbered summary points (01, 02, 03) with hairline rows, like a typeset agreement | Portal prototype · consent | Part of portal Phase 2 |
| Per-order reconciliation table under Documents (net, VAT, WHT, gross; voided excluded) | Portal prototype · docs | F30 |
| Approvals as a split view (queue + detail) with a budget bar showing used / after this approval | Portal prototype · company approvals | F29 |
| "ใช้เฉพาะสีแบรนด์" switch in the Studio brand panel, and an edge-distance item in the brand check | Brand-kit prototype · studio | F31 |
| Production sub-steps, honest delay note, calendar and LINE buttons, privacy footer on /track | Already in the portal prototype; Stitch confirmed the direction | Phase 1 |

For the account-orders round (not this pack), recommended:

- In the orders ledger, put the inline next action under the status pill ("อัปโหลดไฟล์", "ชำระงวดที่ 2").
- Put a second line under the total ("มัดจำ 50% แล้ว", "ค้าง ฿x").
- Order detail: one "สิ่งที่ต้องทำ" block holding only the next step, above a compact 6-step stepper.

## Refused (do not port)

- **Fonts:** Plus Jakarta Sans and Space Mono. We use Anuphan, IBM Plex Sans Thai and IBM Plex Mono.
- **Hours:** "จ.-ศ. 08:30–17:30". The real hours are daily 09:00–18:00 (P-05).
- **Over-claims about what the system does:**
  - "คืนเข้าบัญชีเครดิตทันที" (credit is issued after the claim is checked);
  - "1200 DPI" and "ขยับอัตโนมัติ" in the Studio preflight;
  - "ยื่นตรวจได้ทันที" for e-Tax.
- **Route text shown to customers:** "/track" and "SKU" codes.
- **Banners:** the "ENTERPRISE" label and the "© 2025" footer.
- **Invented identities:** company and person names are sample data. In the real UI they come from the account.
- **Full address and phone on /track:** never shown. The order detail inside the account may show them.

---

## Round 2 (2026-10-28): Anuphan only, expert-human brief

The owner asked for:

- Anuphan only;
- design that looks as human as possible, never AI;
- expert, modern, international quality that can compete with European and American design studios.

The brief is in `STITCH-BRIEF.md`. Stitch's design-system API refused a custom font (`invalid argument`), so the
brief goes at the top of every prompt and the screens are generated without the old design system.
Each HTML file was checked: it loads only `family=Anuphan` and sets `* { font-family: 'Anuphan' !important }`.

Screens in `v2/`: orders, track-mobile, track-verified, consent, documents, order-detail, studio, brandkit, approvals.

What round 2 does better and should guide the build:

- **Tables, statuses and tabs:**
  - real tables with right-aligned figures;
  - status as a 6px dot plus text;
  - underline tabs, not pills.
- **Nav and containers:**
  - nav without icons, grouped with 12px muted labels;
  - one container per idea, with no cards inside cards.
- **One clear next step:** a single primary action per screen, such as "ยืนยัน" on /track or "อนุมัติ" in approvals.
- **Agreement page:** a typeset agreement with 01–03 numbering. The checkbox sits in its own band, and the button is
  sticky at the bottom.
- **Budget bar:** solid for what is used, lighter for what this request adds (F29).
- **Studio:** the brand panel, the "ใช้เฉพาะสีแบรนด์" switch, and a brand-check strip that marks problems with dots
  but makes no auto-fix claim (F31).

Still refused in round 2:

- **Wrong hours and entity names:**
  - "จ.–ศ. 08:30–17:30" in the docs and approvals screens (real hours: daily 09:00–18:00);
  - "© getpack (Thailand) Co., Ltd." (the entity is Collective Group (Thailand)).
- **Data that looks real:**
  - a real-looking 13-digit tax ID in the docs footer;
  - a sample brand naming "Collective Group" on the box artwork.
- **Over-claims and jargon:**
  - "อัปเดตอัตโนมัติ" next to the LINE action;
  - "CVI Guard" / "Flexo" wording in the Studio status strip.
