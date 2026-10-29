# getpack print-file specification (own-file uploads)

Stage C block C12, DECISIONS-STAGE-A §17.1, **D-460**. Values recommended by the assistant acting as head of Prepress,
delegated by the owner (Superball) on 2026-10-29. Prepress may change any threshold from a date in the back office
(`artwork.preflight_rules`, effective-dated and audited); this file follows the setting, not the other way round.
Identical copy in `getpack-api` and `getpack-web`.

Scope: files customers upload themselves (`/studio/upload` file check, the order's artwork upload). Studio designs
are produced by getpack and already follow it. Export / import features (PDF/X export presets, Illustrator scripts,
automatic fixes) are follow-ups — this is the spec only.

## 1. File

| Item | Rule |
|---|---|
| Format | **PDF/X-4** (preferred). PDF/X-1a is accepted. `.ai` files saved with PDF compatibility are read as PDF. |
| Colour | **CMYK** plus **named spot colours** (e.g. a Pantone name). No RGB, no Lab, no ICC-tagged RGB images. |
| Transparency | Allowed in PDF/X-4 (live transparency). PDF/X-1a files are flattened by definition. |
| Text | Fonts **embedded** (subset is fine) or **converted to outlines**. A missing font is a must-fix. |
| Scale | **1 : 1**, millimetres. Never scaled to fit a page. |
| Designs | **One design per file** (one product × one size). Several sizes or designs = several files (one variant each). |
| Size | Up to **200 MB** per file (the automatic check's limit). Larger files: send a link; the team checks them. |
| Security | No password, no encryption. |

## 2. Layout on the dieline

Start from the getpack template of the product and size you order (download on the product page or `/studio/upload`).

| Item | Base (paper board: offset / digital) | Corrugated board (flexo) |
|---|---|---|
| Bleed beyond the cut line | 3 mm | 3 mm |
| Safe zone inside cuts and folds (text, logos) | 3 mm | **5 mm** |
| Image resolution at final size | warn < 300 ppi · **must fix < 150 ppi** | warn < 200 ppi · **must fix < 100 ppi** |
| Smallest text (positive) | 6 pt | **7 pt** |
| Smallest text (reversed / knock-out) | 8 pt | 8 pt |
| Small text in black | below 12 pt: **100 % K only** (no C/M/Y — warn; an automatic fix comes later) | same |
| Thinnest line | 0.25 pt | **0.5 pt** |
| Total ink coverage (TAC) | ≤ 300 % | **≤ 240 %** |

"Corrugated" = the print profile `corrugated` of `artwork.preflight_rules`: products priced by the corrugate
calculator or styles of the `corrugated` material class.

## 3. Die and crease lines

- The **cut** line is a spot colour named **`CutContour`** or **`Die`** — or the cut is drawn on a layer named
  **`die`**. Either is accepted.
- **Creases** (folds) are a spot colour named **`Crease`**, separate from the cut.
- Die and crease paths are set to **overprint** and never carry artwork. They are not printed.
- Do not move, scale or redraw the template's die lines; place the artwork on its own layer.
- On an own-file upload, missing die lines are a **must-fix** (creases too when the product's dieline has folds).

## 4. Barcodes and QR codes

Checked by the team before production (not automatic). Print barcodes at **≥ 80 % magnification**, keep the
**quiet zones** clear on both sides, place them on a flat panel away from folds and cuts, in a single dark colour
(100 % K preferred) on a light background.

## 5. How the checks treat each item (`artwork.preflight_rules`)

| Check | Severity | Notes |
|---|---|---|
| `size_mismatch`, `missing_bleed` | must fix | D-070 |
| `low_resolution` | warn; must fix below `blockBelowPpi` | D-460 |
| `rgb_colour` | warn | D-070 |
| `fonts_not_embedded` | must fix | D-460 |
| `ink_count` | must fix | D-459 |
| `die_layer` | must fix on own-file uploads | D-460 |
| `small_text`, `small_text_black` | warn | D-460 |
| `safe_zone`, `thin_lines`, `overprint` | review | the team decides before production |
| `ink_coverage` | review | measured by the team until the checks can rasterise |
| `barcode` | team check | §4 |
| reversed text size | team check | not detectable automatically yet; value `minTextReversedPt` |

The customer sees "ต้องแก้" for must-fix items (the cart stays closed), "ควรดู" for review items and "ทีมตรวจให้" for team checks; Prepress reviews
every file again after payment (DECISIONS-STAGE-A §7).
