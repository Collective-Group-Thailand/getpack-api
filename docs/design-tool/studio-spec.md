# getpack 3D Studio — product specification

> Concept: **ออกแบบเสร็จ → สั่งผลิตได้ทันที** — one continuous place where a first-time customer picks a box, designs it in 3D, sees that it is print-ready, sees the real price, and orders. No separate "save and quit", no RFQ wait for instant types, no file hand-off.
> Builds on: `@getpack/dieline` (U3 recipes), designer v2 (F4), Structure Advisor & spec model v2 (U2), quote engine (B2), artwork/proof pipeline (B4).
> Benchmark addendum: §9. Original design only — no layouts, assets, patterns, icons or copy from any other product.

---

## 1. Goals and success metrics
| Goal | Metric (measured by product analytics, reviewed monthly) | Launch target |
|---|---|---|
| A new user can go from "เลือกกล่อง" to "สั่งผลิต" alone | median time to first add-to-cart from studio | ≤ 10 min |
| People finish what they start | studio session → add-to-cart conversion | ≥ 25 % of sessions that add artwork |
| Files are right the first time | orders from the studio that pass preflight without prepress changes | ≥ 90 % |
| No price surprises | orders whose checkout total equals the studio price (same qty/options) | 100 % |
| Fast on ordinary devices | studio interactive on a mid-range Android over 4G | ≤ 3.0 s, 60 fps orbit, ≤ 100 ms input latency |
| Accessible | WCAG 2.2 AA for all non-canvas UI; every canvas action has a panel/keyboard equivalent | pass |

## 2. The flow (one URL, five steps, always reversible)
```
① Start ──► ② Box ──► ③ Design ──► ④ Check ──► ⑤ Order
   │           │           │            │            │
   │           │           └───────── live price & lead time always visible ─────────┘
   │           └ size basis, material, advisor, print method (drives what ③ allows)
   └ pick a style · describe your product · reorder a past design · start from a template
```
- A thin **step bar** at the top (เลือกกล่อง · ขนาดและวัสดุ · ออกแบบ · ตรวจงาน · สั่งผลิต) shows progress; users can jump back without losing work. Steps ④ and ⑤ unlock as soon as the design has content; "Check" runs continuously anyway.
- The **price dock** (bottom on mobile, right rail on desktop) is present from step ② onwards: per-piece price, quantity chip (tap to change), lead time / delivery date, "ราคารวม VAT", and the primary button **สั่งผลิต**. It updates on every change that affects price (size, material, print sides, colours, finishes, inserts, quantity) through the real quote API, debounced, with the reason for a change shown briefly ("+฿0.42/ชิ้น เพราะพิมพ์ด้านใน").
- Instant types show a price; RFQ-only types show "ขอใบเสนอราคา" with the SLA and pre-fill the RFQ with the full design — never a fake price.

### ① Start
- Entry points: style library card, product page, configurator, "ออกแบบใหม่" in the account, a reorder, a shared link, LINE LIFF.
- **Describe your product** helper: product L×W×H (or a photo with a reference object — measured by the user, not guessed), weight, how it ships → suggests 3 styles with reasons and sizes (uses the Structure Advisor and style constraints).
- **Templates** (our own, by use case: coffee, cosmetics, snacks, e-commerce, gift, electronics, pharmacy): each template is a layout with constraints (logo zone, headline, pattern, back-panel info block) that **re-flows to any size** of the chosen style.

### ② Box (size, material, print method)
- Style + variant picker (U3.5), measurement basis with the three derived sizes, unit switch, size presets, material swatches with real appearance, Structure Advisor card.
- **Print method** choice (or "ให้ระบบเลือก"): digital, offset, flexo, no print, with a one-line explanation of what each allows. The choice **configures the editor**: flexo → spot-colour mode with a colour-count limit and priced per colour; digital/offset → full CMYK; no print → only structural options.
- Print sides (outside / inside / both) and finishes (matte/gloss lamination, spot UV, foil, emboss, window film) with their price impact.

### ③ Design (3D-first, 2D precision)
Layout (desktop): left **tool rail** (Templates · Brand kit · Uploads · Text · Elements · Background · Layers), centre **stage**, right **context panel** (selected object or selected face), price dock, bottom **view bar** (3D / Flat / Split, open–close slider, outside/inside, zoom, undo/redo, rulers toggle).
- **Split view by default on desktop**: 3D model and flat dieline side by side, selection synchronised. Mobile: 3D with a swipe to flat.
- **Face-aware editing in 3D**: tap a panel → camera turns to face it, panel highlighted with its name ("ด้านหน้า", "ฝาบน", "ลิ้นกันฝุ่น"), and the user edits directly on that face; objects are clipped to the face and can optionally **wrap across a fold** (explicit toggle, with a warning about fold tolerance).
- **Smart guides**: snap to face centre, face edges, safe zone, other objects; distance labels in mm; alignment to the fold, not to the sheet.
- **Brand kit**: upload logo(s) → automatic palette extraction (editable) → fonts (licensed for print; Thai + Latin pairs) → "ใช้แบรนด์ของฉัน" applies logo, colours and fonts to the current template in one click. Saved to the company and reused across designs.
- **Elements**: shapes, lines, frames, icons drawn by us, packaging marks (recycle, fragile, this way up, keep dry, food-safe) — marks with legal meaning (certifications) only when the customer has declared the right to use them.
- **Data blocks**: barcode (EAN-13/UPC/Code-128 with quiet zone and minimum module size check), QR (URL, with error-correction level), ingredients/nutrition/manufacturer blocks as structured forms that render typographically correct Thai.
- **Images**: background removal, crop, replace, effective-DPI badge at the placed size, colour-space warning.
- **Background**: colour, gradient, our own patterns (tileable, scaled in mm), full-wrap image across the whole dieline with bleed.
- **Inside printing**: switch to inside view; cost shown before the first object is placed inside.
- **Material look**: kraft, white board, coated, metallic foil and spot UV rendered with physically based materials; finishing areas are painted as separate layers (not colours) so they become production separations.

### ④ Check (continuous, then a final pass)
- A **checks panel** with counts by severity; each item selects the object and explains the fix in one sentence, with a one-click fix when safe:
  - text/logo outside safe zone → *move inside*; background not reaching bleed → *extend to bleed*; image below 300 dpi effective (warning) / below 150 dpi (block); text below minimum size for the print method; hairlines below minimum stroke; rich black on small text; RGB-only colours outside CMYK gamut (soft-proof preview); spot-colour count above the flexo limit → *convert to nearest allowed*; objects crossing glue areas or creases (warning), barcodes across a fold (block); white ink needed on kraft/metallic; foil/spot UV areas below minimum feature size.
- **Soft proof** toggle: shows the design as it will print on the chosen substrate (CMYK simulation, kraft absorption), so there are no surprises.
- **Final pass** when the user presses สั่งผลิต: blocks must be resolved; warnings need an explicit acknowledgement stored with the order.

### ⑤ Order (sheet over the studio, never a page reload)
- Quantity tiers with the best value highlighted, delivery date per option, sample option (U2.4), target price (U2.3) and levers, tolerances summary, what the price includes.
- **One click "เพิ่มลงตะกร้า" or "สั่งเลย"**: the design version is locked, the print-ready PDF (vector dieline on its own spot layers, artwork with bleed, separations for finishes) is generated server-side, the automatic preflight runs on that PDF and attaches the report, and a **digital proof** is produced for the order — so for studio designs, proof approval is the same screen the customer just saw, confirmed with a checklist.
- For B2B companies with approval policies: "ส่งขออนุมัติ" instead of pay, with a share link showing the 3D, price and checks.
- After ordering, "แก้ไขแบบ" creates a new version; the order keeps its locked version.

## 3. Collaboration and sharing
- Share link (view / comment / edit), comments pinned to a face position in 3D or a point on the flat, @mentions within the company, resolve threads.
- Version history with named versions, visual diff (side by side and overlay), restore.
- Presentation mode: turntable, open/close animation, our own scene presets; export PNG/MP4; **AR at real size** on phones (GLB/USDZ).

## 4. Reorder and continuity
- Every ordered design becomes a **product** in the customer's library (style code, size, material, artwork version) — reorder in one click, change quantity only, or duplicate to a new size (layout re-flows with constraints; checks re-run).

## 5. Help for people who do not design
- "ให้ทีมออกแบบให้" inside the studio: opens a brief pre-filled with the box, size, brand kit and whatever the customer placed; converts into a design-service order (B4 design services); the designer works in the same studio document; the customer comments and approves there.

## 6. Non-functional requirements
- Autosave every change (debounced) to the API with conflict detection; offline edits queued in IndexedDB; never lose work on refresh.
- Undo/redo ≥ 200 steps; keyboard shortcuts documented in a "?" overlay.
- 3D performance: single draw-call-per-face strategy with texture atlases, level of detail for thumbnails, WebGL2 with graceful fallback to 2D-only on unsupported devices.
- Fonts: only fonts licensed for print production and embedding; outlined in the print PDF.
- Accessibility: panels, lists and dialogs fully keyboard/screen-reader accessible; canvas objects listed in the Layers panel as an accessible tree with the same actions.
- Privacy: uploaded images stay private to the customer/company; never used for training or as templates.

## 7. What makes it better than the benchmark (checklist for release)
- [ ] Live **real** price and lead time inside the editor, identical to checkout
- [ ] Order from the studio in one step; no RFQ for instant types
- [ ] Print method configures the editor (flexo spot colours, digital CMYK)
- [ ] Face-aware 3D editing + synchronised flat view (benchmark edits flat with a small 3D preview)
- [ ] Continuous print checks with one-click fixes and soft proof
- [ ] Brand kit and templates that re-flow to any size
- [ ] Finishes (foil, spot UV, emboss, window) rendered in 3D and produced as separations
- [ ] Barcode/QR/data blocks with production validation
- [ ] Digital proof generated from the studio; approval in context
- [ ] Collaboration: share, comment on 3D, versions, company approval
- [ ] Free downloads of dieline and mockup exports (no plan gate)
- [ ] AR at real size

## 8. Out of scope for the first release
Freehand vector drawing tools, multi-page artboards unrelated to packaging, generative-AI images (possible later behind a flag with clear licensing), printing on non-listed materials.

## 9. Benchmark addendum — Kumopack editor (observed 2026-09-29)
- Customizer: size inputs with per-style ranges, three simultaneous size read-outs (production/internal/external), material and custom caliper, 3D view with open/close slider, dieline tab with dimension annotations, buttons for PDF/AI download (plan-gated) and "create request".
- Advanced editor: 2D-first editing on the flat dieline with a small picture-in-picture 3D preview; outside/inside toggle; tools for uploads, a single "add text", basic shapes plus packaging symbols, background colour and a pattern gallery; select/pan, undo/redo, zoom; a read-only config card (size, material, CMYK, print sides, finishing); "Save & Quit" returns to the customizer.
- Not observed: prices or lead time in the editor, print-readiness checks, face-aware 3D editing, brand kit, barcode tools, collaboration/versions, ordering without leaving the tool.
