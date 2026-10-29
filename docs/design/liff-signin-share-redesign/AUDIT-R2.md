# Customer round 2 — LINE mini app, sign-in, share links · audit (2026-10-28)

Checked live on UAT (web localhost:3001) with C01 มาลี (signed in, Chrome), plus SSR text of signed-out pages and the
source of every route. Read-only: nothing was submitted, paid or created.

**Owner's standing instruction:**

- Every menu and sub-page is covered.
- The head of the business team adds recommendations per page without waiting.
- The owner accepts every recommendation.
- Design must look made by a skilled human: Anuphan only, no AI tells.

## 1. Coverage (16 routes)

| Group | Route | Checked | How |
|---|---|---|---|
| LINE | /liff (home) | ✓ | live, C01 |
| LINE | /liff/orders | ✓ | live, C01 |
| LINE | /liff/orders/[id] | ✓ | live, C01 O16 (overdue) |
| LINE | /liff/orders/[id]/proof | ✓ | live, C01 O16 (no proof yet) |
| LINE | /liff/orders/[id]/reorder | ✓ | live, C01 O8 |
| LINE | /liff/pay/[id] | ◐ | source only (no open payment id in UAT for C01) |
| LINE | /liff/points | ✓ | live, C01 |
| LINE | /liff/chat | ✓ | source (page compiled slowly; content is static) |
| LINE | LiffSignIn (signed out in LINE) | ✓ | source + i18n |
| Sign-in | /sign-in (phone) | ✓ | SSR text |
| Sign-in | OTP, errors, lockout | ◐ | source; add to e2e |
| Share | /q/[token] (seller quotation) | ✓ | source + i18n |
| Share | /design/[id] | ✓ | source (redirects to /studio/[id]) |
| Share | /design/shared/[token] (+ /edit) | ✓ | source + i18n |
| Share | /l/[token] | ✓ | source + i18n |
| Share | /r/[code] → /referral/[code] | ✓ | source: landing is "coming soon" |

## 2. Findings

| # | Sev | Where | Finding | Fixed in |
|---|---|---|---|---|
| R2-01 | **P0** | /q/[token] | A factory's own quotation to its own customer (getpack Factory ERP, D-360) renders on the getpack domain inside the storefront layout (getpack header, footer, meta). Anyone who receives it can link that factory to getpack. This breaks factory confidentiality. | Phase 0, 3 |
| R2-02 | **P1** | /r → /referral/[code] | Referral links are handed out (account › referral, F25), but the landing page is "เร็ว ๆ นี้", so every referral link dead-ends. | Phase 0, 4 |
| R2-03 | P1 | /liff/orders/[id] | An overdue order says "open the website to re-quote and pay". It cannot be paid in LINE. | 1 |
| R2-04 | P1 | /liff/orders/[id]/reorder | Price "valid until 28 ต.ค. 15:25" (same day) contradicts P-24 (15 days). "ผลิตประมาณ 10 วันทำการ" gives no reason (P-26). | 0 (API), 1 |
| R2-05 | P1 | /sign-in | "การเข้าสู่ระบบถือว่ายอมรับข้อกำหนด" contradicts the separate consent step. Google and Apple buttons show although only LIFF is configured. | 2 |
| R2-06 | P2 | /liff home | The status "รอชำระเงิน" sits next to the action "ส่งไฟล์งาน". Product name differs between home and list. Points have no ฿ value. No due dates. | 1 |
| R2-07 | P2 | /liff/orders/[id] | The "ความคืบหน้า" heading renders with no stages. There are two status chips and the primary action is not the urgent one. | 1 |
| R2-08 | P2 | /liff/orders | No groups or filters, no amount, no date. | 1 |
| R2-09 | P2 | /liff/proof | The internal word "ทีมพรีเพรส". No pin comments or version compare in LINE. The back link label is wrong. | 1 |
| R2-10 | P2 | LiffSignIn | When LINE sign-in fails, the user is sent to /sign-in in the browser and may not return to LINE. | 2 |
| R2-11 | P2 | /liff/chat | Opens the OA chat with no context, so the customer retypes the order number. | 1 |
| R2-12 | P2 | share | Two share systems (designer: view only; studio: view, comment, edit) with different copy. The recipient cannot say "approved". | 4 |
| R2-13 | P3 | /l/[token] miss page | Does not say what the link was about. | 4 |
| R2-14 | P3 | /liff/points | No progress to the next tier and no expiry date. | 1 |

## 3. Recommendations per page (accepted, see DECISIONS-R2)

| Page | Recommendation | Flag |
|---|---|---|
| LINE home | Due-date "ต้องทำ" queue, one button per row; badge on the orders tab | R2-F1 (with F32) |
| LINE order | Re-quote and pay inside LINE; "send the file first" as an option | core |
| LINE proof | Pin comments, compare versions, approve with a checklist | R2-F2 (with F33) |
| LINE reorder | Quantity shortcuts with price-break hint; save as quote | F14 |
| LINE pay | Share the QR to the company's accountant in LINE (shareTargetPicker); slip upload hidden as fallback | R2-F3 |
| LINE points | Tier progress, expiry warning 30 days before | F46 |
| LINE chat | Choose the topic first; OA chat opens with the order number pre-filled | F22 |
| LINE sign-in | OTP inside LINE; link the LINE account, unlink in privacy | core |
| Sign-in | Honest providers only; no implied acceptance; OTP attempts and lockout page | core |
| Seller quote | Neutral white-label host; "ขอแก้ไข" response; PDF metadata clean | core |
| Shared design | One share system; recipient can mark "ผ่าน" (name recorded) | F16 |
| Notification link miss | Show the subject and a direct button | core |
| Referral landing | Real landing page with reward from config, no fake numbers | core |
| LINE rich menu | Rich menu with 4 areas matching the LIFF tabs (หน้าแรก, คำสั่งซื้อ, คะแนน, แชท) | R2-F4 |
| LINE notifications | Flex messages per event (payment due, proof ready, shipped) with one button each | R2-F5 |
