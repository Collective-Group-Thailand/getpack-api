# Tag & sleeve calculator — legacy port map (U-B6, B2.3 Deliverable 2.3)

> Reference for porting the legacy tag & sleeve calculator. **Legacy is read-only and never run** (D-005).
> Source: `legacy/locopack-web` (paths below are relative to it). Traced 2026-10-01. Packaging type **5** = `tag_and_sleeve`
> ("ป้ายลาเบล และปลอกแก้ว", `config/locopack.php:10`); Packio product type `tag_sleeve` (calculator key `tag_sleeve`).
> Treatment follows the folding / corrugate / label rule (user decision 2026-09-26): **maths ported exactly, orchestration and
> state bugs fixed and listed as deviations** in `docs/pricing-validation-tag-sleeve.md`.

Runtime: Laravel 5.7, `error_reporting(-1)` — every notice ("undefined index", "property of non-object") **aborts the
request**; reading an index on `null` is silent. Below, "throws" means the legacy request failed.

## 0. Main finding — it is the folding engine
`TagAndSleeveCalculator` has **no pricing maths of its own on the live path**. `fromCS:216-491` maps the CS input to a
folding factory request (`CStoFactoryFolding:493-720`) and calls **`FoldingCalculator::calculate`** (`:220,323` →
`FoldingCalculator.php:1293-1476`): folding engine **A** — `PrepareRequest` → `PatternArea` → `A/CalculateWaste` →
`A/CalculateCost` (offset) / `A/CalculateCostDigital` (digital) → `Object/Margin` → `Calculator::SaleMargin` (called with
packaging **1**). Everything else in the class is dead (§3).

It runs on **folding data**: folding print types (`print_type.packaging_type_id = 1`, `getPrintTypes:803-811`; 1 offset,
2 digital), folding papers (`setMasterData:723`), the factory's folding price rows, `factory_match_print_type` and
`locopack_margins`. The only tag-specific data is factory enablement (`factory_match_packaging.packaging_type_id = 5`,
`getFactories:787-801`) and the CS graphic design fee setting `SALE_MARGIN_GRAPHIC_DESIGN_FEE_TAG`.

Patterns 33–36 (`Libraries/Folding/PatternArea.php:637-656`), all `dw = w, dl = l, c = 0` (Packio geometry `flat`,
already mapped in `folding/geometry/types.ts`):

| pattern | name |
|---|---|
| 33 | ป้ายกระดาษ Tag ตัดมุม (tag, cut corners) |
| 34 | ป้ายกระดาษ Tag มุมมน (tag, rounded corners) |
| 35 | แผ่นพิมพ์กระดาษ (printed sheet) |
| 36 | ปลอกแก้ว (cup sleeve, priced flat — no glue flap) |

Holes, strings, eyelets and corner cuts are folding **assemblies** chosen by group (CS defaults 23 "เจาะรู 3 มม." and 25
"ตัดมุม" for 33/34, `cs-v2.vue:1548-1551`; SME always 25, `Converter.php:65`).

## 1. Entry points
| Route | Controller | Reaches | Status |
|---|---|---|---|
| `GET cs/tag/get-input-data` (`routes/web.php:836`) | `TagAndSleeveController@getCSInputData:35-123` | factories, patterns of packaging 5, folding papers / colours / finishes (F1 = `mapping_inputs` type 3, F2 = `finish_type` 2) / die-cut / assembly groups, `SALE_MARGIN_GRAPHIC_DESIGN_FEE_TAG` | live → `admin.csTagSleeve.inputData` |
| `POST /api/cs/tagAndSleeve` (`routes/api.php:575`) | `Api/TagAndSleeveAPIController@CScalculate:78-89` (no validation) | `fromCS` | **live CS** (`cs-v2.vue:1669`) → `admin.csTagSleeve.calculate` |
| `POST /api/products` (`api.php:272`) | `ProductAPIController@store` → `Calculator::FromSME:63-66` | `fromSME:120-178` → `Converter::tagAndSleeveSMEtoCS:43-84` → `fromCS` | **live customer web** → store quotes |
| `POST /api/validate-input` | `Calculator::validateInput:471-518` | size rules (packaging 5 skips height and `l ≥ w`) | live → `assertStoreRules` |
| `POST /api/orders`, `cs/change-factory/{order}` | re-price at order creation / factory change | `fromSME` / `fromCS` | B3 order operations (quote engine) |
| `GET /api/cs/tagAndSleeve`, `cs/tagAndSleeve` | old v1 UI | `fromCS` | not in the menu; not ported |
| `POST /api/orders-v2`, `POST /api/order/{id}/re-production` | `storev2:1482-1487`, `fromOrder:39-118` | throw (T22) | broken; not ported |
| Factory tool | none | — | Packio adds `partner.pricingTagSleeve.calculate` (as every calculator) |

## 2. Pipeline

### 2.0 Inputs
- **CS** (`cs-v2.vue:1605-1666`): `pattern_id` (33–36), `w`, `l` mm, `amount[]`, `paper_type_id` + `gsm`,
  `difficult_level_id` (group), `print_front` / `print_back` `{check, amount, color[] (groups), percent[] ∈ 25/50/75/100}`,
  `finish_front` / `finish_back` (mapping id → finish group, F1), `finish2[] {id, amount, w[], l[]}`, `asb[] {id, amount,
  w[], l[]}`, `diecut: 1` (always), `fix_margin`, `zipcode`, `delivery`, `custom_cost`, promotions.
- **SME** (`Converter::tagAndSleeveSMEtoCS:43-84`): w/l cm → mm, paper by mapping, difficulty group 5, `color == 1` → front
  4 × group 5 at 100 %, `enamel_id` → F1 front, `asb [25]`, special technics `[61..64]` → extra assemblies,
  `[20..23]` → finish 2 at the full w × l.

### 2.1 Orchestration — `fromCS:216-491`
Per factory enabled for packaging 5 × folding print type (no ORDER BY): `CStoFactoryFolding` (§2.2) → `false` skips the
pair; `FoldingCalculator::calculate` prices all quantities at once. Merge per quantity: the first print type of a factory
is stored; a later one replaces it only when its **factory `totalCost`** is strictly higher (`:336-341` — the comparison is
inverted, and the "add" branch reads undefined indexes and throws, T3); an empty result **deletes the factory's earlier
result** (T4). Lead time `ceil(lead_time)` (custom lead-time rule for SME, T15). Rows sorted by `summary.total`. `min_order_amount`
is selected but never checked (T16); `min_order_for_production` raises the production run inside `FoldingCalculator`.

### 2.2 `CStoFactoryFolding:493-720` — CS → factory ids per factory × print type
paper by type + gsm; difficulty by group; colours by group (digital: de-duplicated standard colours + specials, no percent;
offset: one entry per slot with its percent); F1 by finish group (`finish_type 1`); **F2: `if ($print_type->id == 2) return
false`** — finish 2 is offset only (T9); die-cut group 1 (always); assemblies by group, **amount / w / l not forwarded** (T8).
Request: `patternId`, `sub_id 0`, `w`, `l`, **`d = 0`**, no grain / `x` / `c` / cut-to-size / foil / sorting / packing.

### 2.3 Engine A (folding)
Identical to the folding port (`docs/legacy/05-folding-port-map.md`): `useMaxMinPaperTrim`, `min_order_for_production`
raise, `PatternArea` flat (`dw = w + plus_dw`, `dl = l + plus_dl`), lay-outs on the non-overlap `calLayoutAmount` branch,
the waste chain assembly → die-cut → F2 → F1 back → print back → F1 front → print front, offset `A/CalculateCost` /
digital `A/CalculateCostDigital`, `Object/Margin` (offset unrounded sale price, digital rounded on the production run),
`locopack_margins` tier (price half-open, amount inclusive on the production run), `SaleMargin` (packaging 1). Assembly
cost for tags: `depthCm = 0` unless `pattern_type == 1`; `required_amount` assemblies read the never-forwarded amount and
throw (T8).

### 2.4 Shipping
`ShippingUtils::calShippingCostFolding` with `Dmm = 0`, patterns 33–36 flat (thickness 0.5 mm, 60 cm carton stacks) —
already ported as `shipping/packing/folding-packing.ts` `flat`. Packio prices delivery as its own line (D-013).

## 3. Live / dead code
**Live:** `fromSME`, `fromCS`, `CStoFactoryFolding`, `setMasterData`, `getFactories`, `getPrintTypes`;
`FoldingCalculator::calculate` and the folding engine-A libraries; `Calculator::SaleMargin`, `FromSME`, `validateInput`;
`Converter::tagAndSleeveSMEtoCS`; `ShippingUtils::calShippingCostFolding`.
**Dead:** `TagAndSleeveCalculator::SMEtoCS`, `CStoFactory:813-1033`, `calculate:1035-1092` (calls an undefined method),
`calculateDimension` / `calculateLayout` / `calculateWaste` / the `*Waste` helpers / `calculateCost` / `PrintCost` /
`findPrintPrice`, `fromOrder`. Engine A paths never reached for tags: overlap / combine lay-outs, grain, cut-to-size, foil,
sorting, packing, engine B.

## 4. Data read (→ Packio source)
| Legacy | Packio |
|---|---|
| `factory_match_packaging` (packaging 5) | the factory's approved price list for product type `tag_sleeve` (price lists are per factory × product type) |
| `factory_match_print_type` (folding print types), `paper`, `paper_sizes` / `paper_sheets`, `paper_trim`, `paper_cannot_do_process`, `factory_rel_pattern_conditions`, colours, the four waste tables, plates, print / finish / die-cut / block / assembly prices, `assembly_sheets`, `paper_prices`, digital terms | the **folding price components** (`pl_print_type_terms` … `pl_assembly_sheets`) entered in the factory's `tag_sleeve` price list |
| `pattern` 33–36, `mapping_inputs`, finish / die-cut / assembly / difficulty groups | catalogue patterns of product type `tag_sleeve` (geometry `flat`), catalogue finishes, die-cuts, assemblies, difficulty levels |
| `locopack_margins` (folding rows), `SALE_MARGIN_GRAPHIC_DESIGN_FEE_TAG` | `sell_margin_tables` of product type `tag_sleeve` (margin, fix cost, `design_fee`) |
| `SALE_MARGIN_VAT` | `tax_rates` `vat_standard` |

## 5. Quirks and how the port treats them
| # | Legacy behaviour | Port |
|---|---|---|
| T1 | Priced on the factory's folding print types, papers, price rows and margins | **Changed (one price list per factory × product type, schema-design §3.4, D-043):** the folding components in the factory's `tag_sleeve` price list; the sell side of product type `tag_sleeve`. Same maths, separate data |
| T2 | No shape geometry: 33–36 are `dw = w, dl = l`; holes / corner cuts are assemblies | Kept: tag patterns must use geometry `flat` and have no parts; d = 0 |
| T3 | A factory with two print types throws when the later one is not strictly cheaper; through `FromSME` the whole customer quote fails | Fixed: one option per factory × print type; selection D-043 |
| T4 | A print type with no lay-out deletes the factory's earlier result | Fixed: each option stands alone |
| T5 | Per factory, keep the print type with the **higher** factory cost (inverted comparison) | Fixed: lowest buy price, then lead time (D-043, D-101) |
| T6 | Back-side product colours built from `print_front` (back-only print throws) | Not ported (SAP product record) |
| T7 | Product record amount = first quantity | Not ported (record only) |
| T8 | Assembly amount / width / length never forwarded: `required_amount` assemblies throw, width / length assemblies get perimeter 0 | Fixed: the given amount and sizes are forwarded (as folding) |
| T9 | Finish 2 is never digital (`CStoFactoryFolding:632-634`); finish-2 locations misaligned when an amount is 0 | Kept: a digital option with finish 2 is refused (`process_not_possible`); locations kept per finish |
| T10 | Offset F1 front missing price → 0; F1 back missing → throws | `price_line_missing` (folding Q14/Q16) |
| T11 | Missing print waste band or print price → throws | `price_line_missing` (folding) |
| T12 | 4-colour flat row read straight from the DB, `rand()` cache key | As folding Q19 |
| T13 | Print back uses the last percent set, front the max | Kept (folding engine) |
| T14 | Setup waste on the first process **flag** | Kept (folding waste method 2) |
| T15 | SME lead time 0 except factories 9 / 16; CS `ceil(lead_time)` | `⌈lead time⌉` term, bulk lead time as a term (folding) |
| T16 | `min_order_amount` ignored; `min_order_for_production` raises the production run | Kept as folding: the production minimum term raises the run; no refusal |
| T17 | Tier: price half-open, amount inclusive on the production run; tier without a base row throws | Shared `sell.ts` (folding) |
| T18 | Customer web charges the **folding** design fee, CS the tag fee; charged for design status 1–3, subtracted for 3 | Fixed: the `tag_sleeve` design fee once per quote when Packio designs; no structure fee (legacy charges none) |
| T19 | Offset sale price unrounded; digital rounded on the production run | Kept (folding `margin.ts`) |
| T20 | `selectedFactory` / custom cost filters with mixed `!==` | Not ported (CS selects in the result) |
| T21 | A quantity with no priced factory throws (`usort(null)`) | Fixed: no instant price for that quantity |
| T22 | `orders-v2` prices 1 piece then throws; `fromOrder` throws | Not ported |
| — | Die-cut always group 1 | Kept: `diecutTypeId` is required for a tag |
| — | Store size rules: packaging 5 skips the height and `l ≥ w` checks | Kept: width and length rules only |

Inherited folding quirks apply unchanged (Q6 process exclusions enforced, Q9/Q10 deterministic first match, Q11 factory ids
as terms, Q13 flip sheets, Q14 missing trim refuses, Q17, Q18, Q4).

## 6. Port
`tag_sleeve` = an input mapping and option filter over the folding engine A (`src/modules/pricing/calculators/tag-sleeve/`):
- `TagSleeveConfigurationDto` (flat: w × l, one set of processes, die-cut required, graphic design only) → a
  `FoldingConfiguration` with d = 0 and one part;
- `FoldingSnapshotLoader.resolve(cfg, db, 'tag_sleeve')`: patterns of the tag product type, geometry `flat`, no parts;
- `tagSleeveCalculator` wraps `foldingCalculator`: refuses finish 2 on digital (T9); engine B already refuses;
- packer: folding `flat`; CS `admin.csTagSleeve.*` (folding input data for tag patterns), `partner.pricingTagSleeve.calculate`;
- golden cases: tag patterns 33/34 with hole + corner-cut assemblies, 35 plain, 36 sleeve, offset 4-colour, digital, finish 2
  offset / refused on digital, the production minimum, tiers, two factories.
