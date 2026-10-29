# Customer round 3 — home, help and content, search, legal, 404 · audit (2026-10-28)

## How this was checked

- Pages were captured full-page at 1440 and 390 px with a headless browser on the owner's machine (`getpack/_shots/*`).
- The text of each page was read from the server-rendered HTML.
- Read-only: nothing was submitted.

## Owner's instructions for this round

- The home page is good and the owner likes it. The redesign must be better, never weaker.
- Stitch screens are the design deliverable this round; no hand-built canvas. They are in `stitch/` (image + HTML).
- The current pages are in `current/`.

## 1. Coverage (22 routes)

| Route | Result |
|---|---|
| / | ✓ 1440 + 390 (7,539 / 13,653 px tall) |
| /help, /help/how-it-works, /help/glossary, /help/chat | ✓ |
| /help/contact, /help/faq | ✓ (308 → /contact, /faq) |
| /faq, /guarantee | ✓ |
| /learn, /articles | ✓ (empty state) |
| /materials, /samples | ✓ (empty state) |
| /templates | ✓ ("หน้านี้กำลังจัดทำ") |
| /reviews | ✓ (1 UAT review, average 5.00 shown) |
| /about | ✓ |
| /search, /search?q= | ✓ |
| /legal/terms, /legal/privacy, /legal/cookies | ✓ |
| 404 | ✓ (Next.js error badge "1 issue" in dev) |

No page scrolls horizontally at 390 px.

## 2. Findings

| # | Sev | Where | Finding | Fix |
|---|---|---|---|---|
| R3-01 | **P0** | /legal/privacy §4 | Says getpack discloses "ชื่อผู้รับ ที่อยู่จัดส่ง ไฟล์งาน" to the producer. This contradicts the reverse-confidentiality rule: production never receives customer name, address or phone. Either the practice or the notice is wrong. | Phase 0 (text + S-03), check that shipping labels are produced by getpack or the carrier |
| R3-02 | **P1** | /faq, /help | "จำนวนคลาดเคลื่อน ±5% … คืนเงินตามสัดส่วน" contradicts the fixed decision "± 5% returned as credit". | 0 |
| R3-03 | **P1** | /guarantee | "ตัดสินภายใน 3 วันทำการ" contradicts P-25 (decided within 5 working days, CS alert at 3). | 0 |
| R3-04 | **P1** | /about | "getpack (แพ็กกิโอ)" uses the old Packio pronunciation. "สั่งซ้ำได้ในคลิกเดียว" over-claims. | 0 |
| R3-05 | **P1** | /legal/terms §1 | "การใช้เว็บไซต์หรือสั่งซื้อถือว่าคุณยอมรับข้อกำหนดนี้" (implied consent) contradicts the consent step (R2-D6). Dates are in ค.ศ. | 0 + S-03 |
| R3-06 | P1 | home | Gallery section with large empty image tiles and no heading. Several template and "สิ่งที่เราผลิต" tiles are empty, because product images fail to load (F-02 bucket). | 1 |
| R3-07 | P1 | /templates, /learn, /articles, /materials, /samples | Public pages that are "กำลังจัดทำ" or empty, yet linked from home, help and the footer ("ดูคลังแบบกล่องทั้ง 986 แบบ" goes to /styles, which is fine, but help links to /learn and /materials). | 0 (hide links + noindex until content), 3 |
| R3-08 | P2 | /help/glossary | No terms load. It shows 'ไม่พบคำว่า “”' with an empty query. | 2 |
| R3-09 | P2 | /reviews | Shows an average of 5.00 from 1 review. An average from too few reviews misleads. | 2 |
| R3-10 | P2 | home, how-it-works, about | Internal jargon "ทีมปรีเพรส" and "พรูฟ". | 0 |
| R3-11 | P2 | /search | Ready-stock results have no price or "add to cart". All thumbnails are identical. No filters or counts per type. | 2 |
| R3-12 | P2 | 404 | Dev error overlay "1 issue" on the 404 render. The page offers few routes back. | 2 |
| R3-13 | P2 | /legal/cookies | "ฉบับใช้งานช่วงทดสอบระบบ" placeholder (S-03). | S-03 |
| R3-14 | P3 | every page | The cookie banner reappears on each page within a session (known from the portal round). | 0 |
| R3-15 | P3 | home 390 | The page is 13,653 px long. Templates and ready stock stack vertically. | 1 |

## 3. Recommendations per page (accepted)

| Page | Recommendation | Flag |
|---|---|---|
| Home | Keep the hero and live studio card, and keep the order of sections. | core |
| Home | Add 3 honest facts (5 วันทำการ · 15 วัน · ± 3 มม.). | core |
| Home | Move the "กล่องใบเดียวกัน" timeline up and give it line drawings. | core |
| Home | Templates as dieline drawings, never empty tiles. | core |
| Home | Ready stock shows a price per piece when known. | core |
| Home | Remove the empty gallery. | core |
| Home | Mobile: horizontal scrollers and a sticky "เริ่มออกแบบฟรี / ติดตามคำสั่งซื้อ" bar. | core |
| Home | Returning customers see "งานของคุณ" (to-do count + reorder) under the header. | R3-F1 |
| Help center | Search first; topics with article counts; a "มีคำสั่งซื้ออยู่แล้ว?" box; FAQ accordion; LINE / call-back band. | core |
| How it works | Sticky 6-step index; real UI snippets instead of photos; payment split rule shown. | core |
| Glossary | Terms with inline diagrams (bleed, flute, crease, ΔE); ก–ฮ / A–Z index; live filter. | R3-F2 |
| Search | Tabs by type with counts; size filter in mm; ready stock with price and "ใส่ตะกร้า"; zero-result "ส่งขนาดให้ทีมหาให้". | R3-F3 |
| 404 + empty pages | One honest pattern: what is missing, where to go, optional "แจ้งเมื่อมี". No "coming soon". | core |
| About + guarantee | Editorial about; guarantee with 7 days / 1 / 5 working days, outcome matrix, tolerances. | core |
| Legal | Reader with table of contents, plain summary, PDF, "ดูสิ่งที่เปลี่ยน" (F13), พ.ศ. dates. | core |
| Reviews | Show the average only from 5 verified reviews or more; otherwise list them without an average. | core |
