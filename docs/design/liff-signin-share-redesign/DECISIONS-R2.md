# Customer round 2 — decisions (head of business team, 2026-10-28)

Precedence: GLOBAL-RULES → DECISIONS-STAGE-A → DECISIONS-PORTAL → this file.

| # | Topic | Decision |
|---|---|---|
| R2-D1 | Seller quotation links (/q) | Served only on a neutral host `PARTNER_DOCS_BASE_URL` with an empty layout: no getpack name, logo, header, footer, analytics, meta, favicon or PDF producer. `/q/[token]` on the getpack domain returns 404 (no redirect). The seller's logo and accent colour are used. |
| R2-D2 | Overdue orders in LINE | Re-quote and pay inside LINE, same rules as the web (re-quote, never auto-cancel). |
| R2-D3 | Order of actions | When payment is overdue or due, payment is the primary action. Sending the artwork first stays possible as a secondary action. |
| R2-D4 | Reorder price in LINE and web | A saved quote that holds for 15 days (P-24). Lead time comes from data, with a reason when it is longer than 5 working days (P-26). |
| R2-D5 | Sign-in providers | Show only the providers configured in the environment. Today that is phone OTP + LINE. Google and Apple stay hidden until Firebase is configured. |
| R2-D6 | Implied consent | Removed. Consent only happens in the consent step (P-18). |
| R2-D7 | OTP limits | 3 wrong codes, then a 15-minute wait per phone number. Resend after 60 seconds. The account is never locked permanently. |
| R2-D8 | LINE account link | After OTP inside LINE, the LINE user id links to the account. Unlink in บัญชี › ความเป็นส่วนตัว. One LINE id per account. |
| R2-D9 | Share links | One share system with scopes view, comment and edit. Links default to 15 days and can be revoked. A recipient can mark "ผ่าน" with a name; they never see prices or account data. |
| R2-D10 | Notification links (/l) | Valid 7 days. The miss page names the subject when the signed-in owner matches. |
| R2-D11 | Referral landing | The landing page goes live with the reward value from config (`referral.welcomeReward`). There are no testimonials or counters. An expired or unknown code shows the page without the referrer's name. |
| R2-D12 | LINE notifications | Flex messages with one button each, sent only for the customer's own events, 09:00–20:00 except payment confirmations (P-18). |
| R2-D13 | QR share | "ส่งต่อให้ฝ่ายบัญชี" uses LINE shareTargetPicker and shares only the QR image, the amount and the order number. |
