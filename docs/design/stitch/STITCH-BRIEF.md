# getpack — DESIGN.md (customer portal, /track, brand kit, studio)

## Who designs this
You are a senior product designer at the level of the best European and American product studios. You have shipped
calm, precise operations software: Linear, Stripe Dashboard, Vercel, Mercury, Pitch, Figma's admin. You design
for real use, not for screenshots. Every screen must look like a skilled human designer made it by hand, with
judgement and restraint. Nothing may feel generated or templated.

## Typeface (hard rule)
- **Anuphan only**, for everything: display, headings, body, labels, buttons, numbers, codes and money.
- No other family. Not Inter, Plus Jakarta Sans, Space Mono, IBM Plex, Noto, Roboto or system fallbacks.
- Weights: 300 for large display figures, 400 for body, 500 for labels and UI, 600 for headings, 700 used sparingly.
- Numbers, money and codes use `font-variant-numeric: tabular-nums` and are right-aligned in tables. There is no mono font.
- Thai text: body 15px/1.65, small 13px/1.55, headings line-height ≥ 1.2. Letter-spacing: -0.01em at 24px and up, 0
  for body. No ALL-CAPS Thai. Short English overlines may be uppercase at 11px with +0.06em tracking.
- Type scale: 12 · 13 · 15 · 17 · 20 · 24 · 32 · 44.

## Product
getpack (getpack.co) by Collective Group (Thailand). Customers design a box online, see the price, order and track
production. Users are Thai SME brand owners and company buyers. Thai first.
Tone: calm, competent and precise — an operations tool, not a startup landing page.
Never mention factories. Say "ทีมงาน", "ฝ่ายผลิต" or "การผลิต".

## What "human, expert, modern, international" means here
- **One clear idea per screen.** One primary action, and nothing competes with it.
- **Hierarchy comes from type size, weight and spacing**, not from colour, boxes or icons.
- **Generous, consistent rhythm** on an 8px grid with optical adjustments. Align to a strict 12-column grid
  (desktop 1440: 80px margins, 24px gutters).
- **Few containers.** Prefer whitespace and a single hairline over cards inside cards.
  - Lists of records are ledger rows in one bordered container.
  - Tables are real tables with right-aligned numbers.
- **Icons:** 1.5px stroke, 16–20px, only where they help scanning. Never decorative icon tiles or icon-in-circle headers.
- **Colour is quiet.** Neutral surfaces carry the page. Brand green marks action and the current state only.
  Status colour appears as a small dot plus text, not big tinted banners.
- **Micro-details a senior designer would add:**
  - consistent 1px hairlines and focus rings;
  - honest empty states;
  - realistic Thai copy of realistic length;
  - dates as "28 ต.ค. 2569", money as "฿18,540.00".
- **Never use the AI tells:**
  - gradients, glassmorphism, glow, emoji, decorative blobs or 3D illustrations;
  - big rounded hero cards, centered everything, coloured icon tiles;
  - pill buttons everywhere, badge spam, drop shadows on every card;
  - stock photos, fake testimonials, "AI" sparkles.

## Colour (light)
- **Surfaces:** page #F6F5F1 · surface #FFFFFF · surface-2 #EFEEE9 · product stage #EDECE6
- **Text and lines:** ink #16201B · secondary #4A554F · muted #7B847F · hairline #E3E1DA · strong line #CFCDC5
- **Brand green:** #17573F (actions, links, current state) · hover #0E4430 · tint #E2EDE7
- **Status:** ok #1F7A57 · warn #9A6210 · error #B8352B · info #2F5FD0. Use a soft tint only for the rare inline notice.

## Colour (dark)
page #0F1412 · surface #161C19 · surface-2 #1D2521 · ink #ECEFEC · secondary #B5BEB8 · line #29322D · brand #56BC91

## Shape
- **Radii:** 8px controls · 12px containers · 16px sheets and dialogs.
- **Buttons** are rectangles with 8px radius, 40px tall (44px on mobile). Pills are for status only.
- **Shadows:** a single soft shadow (0 8px 24px rgba(22,32,27,.08)), for floating layers only.

## Layout
- **Desktop account shell:**
  - 240px left nav, grouped ซื้อ / เอกสารและบัญชี / บริษัท;
  - group labels 12px muted;
  - active item has ink text, a surface-2 background and no colour bar.
- **Content** max 1200px.
- **Mobile 390:** 16px side gutter, nav becomes a horizontal scroller, sticky bottom action when there is one
  primary action, no horizontal page scroll.

## Content rules
- Sample data is labelled "ตัวอย่าง".
- Copy says only what the system really does: no "ทันที" or "อัตโนมัติ" unless true.
- Working hours are daily 09:00–18:00.
- The public /track page never shows a full address, price, origin or factory.
