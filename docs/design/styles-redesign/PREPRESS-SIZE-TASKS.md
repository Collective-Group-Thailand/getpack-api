# Prepress size tasks — closed-size definitions for the size search

Owner decision 2026-10-28 12:07 (DECISIONS-STAGE-A §13.2, D-450). Opened by Stage C block C1e. Owner: **Prepress**.

The /styles size search ("ค้นหาด้วยขนาดสินค้า") fits a customer's product into a style's inside size range. Each range
is filled by the audited fit-range backfill (`pnpm styles:fit-ranges`, back office `/style-library/fit-ranges`) from
the approved recipe, its presets and the dieline engine's limits — never typed by hand. The styles below cannot get a
range until Prepress adds the missing engine data. Nothing here asks for a business value: only what the engine needs
to compute the closed (inside) size of a style it already draws.

## 1. Plastic bags (PK-PB-01 … PK-PB-08) — open

Size class `bag`: inside size = width × gusset (as the depth) × height (§13.2). The recipes state `width` and
`length` (and `gusset` on PK-PB-04 / 05), but the engine has **no reference material for `flexible`**, so it cannot
evaluate their presets or limits (the same reason they have no flat dieline on the card, C0b §9.4a). Until this is
done they stay out of the size search and are listed as "without a complete range".

| Code | Engine recipe | Size parameters today | Missing for the size search |
|---|---|---|---|
| PK-PB-01 | stand-up-pouch | width, length, bottom | flexible reference material; a closed size (width × gusset × height) — which parameter is the height, and the depth when filled (bottom gusset) |
| PK-PB-02 | flat-pouch | width, length | flexible reference material; closed size (a flat pouch has no gusset: depth definition needed) |
| PK-PB-03 | center-seal-pouch | width, length, centerSeal | flexible reference material; closed size (depth definition needed) |
| PK-PB-04 | flat-bottom-pouch | width, length, gusset | flexible reference material; closed size (height = `length`?) |
| PK-PB-05 | side-gusset-bag | width, length, gusset, centerSeal | flexible reference material; closed size (height = `length`?) |
| PK-PB-06 | poly-mailer | width, length, flapDepth | flexible reference material; closed size (depth definition needed) |
| PK-PB-07 | bubble-mailer | width, length, flapDepth | flexible reference material; closed size (depth definition needed) |
| PK-PB-08 | spouted-pouch | width, length, bottom, spout | flexible reference material; closed size (as PK-PB-01) |

**What to deliver (in `@getpack/dieline`, released to getpack-api as a new vendored bundle, ADR-0010):**
1. A reference material for the `flexible` class (thickness / properties the solver uses).
2. For each recipe, either a `closedSize(values, material)` returning the inside `{ length, width, height }` in mm
   (width × gusset × height for bags), or parameters named `width`, `gusset`, `height` so the documented bag rule
   (`getpack-api/src/integrations/dieline/inside-rules.ts`) reads them. A `closedSize` always wins over the rule.
3. Then: release the bundle, run `pnpm styles:recipes-from-engine` → approve the recipes (Prepress) →
   `pnpm styles:fit-ranges` (dry run, then `--confirm`) and check the eight codes leave "without a complete range".

## 2. Already covered by the C1e rules (no Prepress work)

- Paper bags PK-PG-01 / 02 — width × gusset × height from the recipe range and presets.
- Cups / bowls / tubes PK-SP-23, PK-SP-24, PK-RG-07 — diameter square × height from the presets and the recipe range.
- Labels, shrink sleeves, tags, sleeves, inserts, flat folders (PK-LA-*, PK-TG-*, PK-SL-03, PK-IN-02, PK-CI-02,
  PK-DS-04, PK-SP-13, PK-SP-12) — "size search not applicable"; nothing to add.

## Status

| Date | Item | Status |
|---|---|---|
| 2026-10-28 | §1 plastic bags | Open — waiting for Prepress |
