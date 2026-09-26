# Folding calculator — legacy port map (B2.3)

> Reference for porting the legacy folding calculator. **Legacy is read-only and never run** (D-005).
> Source: `/Users/superball/Abbon/Loco_Pack/locopack-web`, whose `app/` is identical to `Packio-Web/legacy/locopack-web/app`. It is *not* at `legacy/locopack-web/` in this repo, despite CLAUDE.md.
> Paths below are relative to the legacy root. Traced 2026-09-26.

## 1. Entry points
| Route | Controller | Reaches |
|---|---|---|
| `POST /api/cs/folding` (`routes/api.php:571`) | `Api/FoldingBoxController@customerServiceCalculate:162` (no validation) | `FoldingCalculator::calculate_cs:874` |
| `GET /api/cs/folding` (`:569`) | `@customerServiceData:75` | master data + `SALE_MARGIN_*` CS form defaults |
| `POST /api/products` (`:272`) | `ProductAPIController@store:355` → `Calculator::FromSME:28` | `combinationCalculate:188` → `calculate_cs`, or `nonCombinationCalculate:287` → `Converter::SMEToCS` → `CStoFactory:437` → `calculate` |
| `POST /api/validate-input` (`:273`) | `ProductAPIController@validateInput:842` | `Calculator::validateInput:471` |
| `POST /api/folding/calculate` (`:560`) | `Api/FoldingBoxController@submitForm:157` (`FoldingBoxRequest`) | `FoldingCalculator::calculate:1293`, no sell side, top 10 layouts |
| `POST /cs/change-factory/{order}` (`routes/web.php:899`) | `ChangeFactoryController@changeData:40` | `calculate_cs` (then writes the order) |
| `POST /api/calculate` (`:254`) | `CalculateAPIController@store:13` | **broken**: calls methods that do not exist |

`calculate_cs` and `FromSME` price only **type-A** factories (`FoldingCalculator.php:414`, `factory_type_id = 1`). B is reachable only through `folding/calculate` or the factory-user tools, given a B `factory_id`.

## 2. Core pipeline — `FoldingCalculator::calculate:1293`
1. `PrepareRequest` (`:93` → `initialize:118` → `initProcessAll:135`) and `validCanDoProcess:363` (`paper_cannot_do_process`).
2. `min_order_for_production` raises `arrayBoxAmount`; `qty` keeps the requested quantity (`:1308-1318`).
3. `PatternArea` (`:42`; constructor `FoldingBox:13`) → `calculate:830` → `calPatternArea:162` (switch on pattern) → `getPaperSheet:771` → `calLayout:1094` → helper `calLayoutAmount`.
4. Waste:
   - A: `A/CalculateWaste::calculate:445`. Order: assembly → diecut → F2 → F1 back → print back → F1 front → print front.
   - B: `B/CalculateWaste::calculate:304` + `Process/{Printing,Finishing,Diecut,Sorting}`.
5. Cost:
   - A, print type 1: `A/CalculateCost::calculate:70`.
   - A, print type 2: `A/CalculateCostDigital::calculate:75`.
   - B: `B/CalculateCost::calculate:60`.
   - Each builds `Object/Layout` and ends in `calMargin` → `Object/Margin::calculate:92`. Layouts are sorted with `array_multisort`.
6. With `cs`: `locopack_margins` lookups (`:1409-1427`) → `Calculator::SaleMargin:223/400-449` → `ShippingUtils::calShippingCostFolding:463`. The first layout is kept.
7. `calculate_cs` then adds: `getCustomLeadTime`, `SpecDetail`, `Promotion::calculateDiscount` (discount type 1), order hierarchies (SAP, not ported), and sorts by `summary.total` (`:1234`).

## 3. Live / dead files
| Status | Files |
|---|---|
| Live, A (CS/SME) | `PrepareRequest`, `PatternArea`, `FoldingBox` (constructor only), `A/CalculateWaste`, `A/CalculateCost`, `A/CalculateCostDigital` (only `calculate()`, `initCost:1614`, inline costs `:107-498`, `calMargin:2379`; `:532-1612` and the HTTP getters are dead), `Object/{Layout,Margin,PrintPlate,Printting,Finish,Diecut,Assembly,Sort,Packing,Delivery}` |
| Live, B only | `B/CalculateWaste`, `B/CalculateCost`, `Process/{Printing,Finishing,Diecut,Sorting}`, `Object/{Foil,Point,Rectangle}` (foil inputs only) |
| Dead, not ported | `ProcessA/*` (referenced only in comments), `Process/Assembly`, root `CalculateCost`, root `CalculateWaste`, `CalCost`, `CalCostB`, `CalculatePrice`, `WastePrice`, `FoldingRequest`, `CalMargin` (empty), `Object/{Condition,CombineLine,RectangleBU}` |

Live helpers (`app/Helpers/helpers.php`): `convertUnderScoreToUpperCase:192`, `inch2toM2:224`, `convertToMm:231`, `calLayoutAmount:598`, `calWastePrice:903`, `calPrice:926`, `calPrintArea:937`, `calFinishingArea:944`, `calTotalWaste:951` (B), `calTotalWastePaperSize:1076`, `calPricePaperSizeBahtPerSheet:1100`, `swipePaperSheetSize:1141`, `calCostPaperSize:1175`, `groupArrayByKey:1245`, `calSortingCost:1294`, `arrayMultipleSort:1305`, `testArrayMultipleSort:1320`, `calPacking:1338`, `sumArrayByKey:1352`, `convertTo2Decimal:1692`, `convertTo2Decimal3Digit:1699`, `getCustomLeadTime:1981`, `convertNumberFloat:2687`. The PHP numerics are ported in `src/modules/pricing/engine/php.ts`.

## 4. Data read (→ Packio source)
Every legacy per-factory table becomes a `pl_*` component of the factory's folding price list (schema-design §3.4). Catalogue ids become platform catalogue rows (§3.3). B's HTTP reads (`/api/<resource>`, which add `*_status = 1`) become reads of the same component from the snapshot.

| Step | Legacy tables / columns |
|---|---|
| Factory, print type | `factory_match_packaging`, `factory` (`factory_type_id`, `calculate_waste_type`, `finish2_step_down_waste`, `can_flip_paper_size`, `zipcode`), `factory_match_print_type` (`margin`, `min_order_amount`, `min_order_for_production`, `locopack_margin`, `locopack_fix_cost`, `lead_time`, `trim_dl`, `trim_dw`, `use_paper_amount_for_cal`) |
| Group → factory mapping (`CSCombinetoFactory:618-872`) | `sub_patterns` (`nl`, `nw`, `nh`), `paper` (`paper_type_id`, `gsm`), `difficult_level`, `finish` (F2 order `[23,16,17,18]`), `diecut_type`, `color`, `assembly` |
| Pattern / layout | `pattern`, `sub_patterns`, `calculate_conditions`, `conditions`, `pattern_rel_standard_sizes`, `standard_sizes`, `factory_rel_pattern_conditions` (`plus_dl`, `plus_dw`), `paper_trim`, `paper` ⋈ `paper_sizes` ⋈ `paper_sheets` |
| Waste | `print_wastes`, `finish_wastes`, `diecut_wastes`, `assembly_wastes` (+ `assembly.skip_waste`); B also `semi_plate_wastes`, `sortings` |
| Cost, A offset | `print_plate`, `color`, `print_prices`, `diecut_price`, `diecut_block_price`, `finish_price` ⋈ `finish`, `finish_plate`, `assembly_prices` ⋈ `assembly`, `assembly_sheets` |
| Cost, A digital | `paper_prices`, `print_prices` (ink per m²), `finish_price`, `diecut_price`, `diecut_block_price`, `assembly_prices`, `paper_trim`, `zipcodes_delivery_zone` |
| Cost, B | `print-plates`, `print-prices`, `finish-prices` (+ foil), `diecut-prices`, `diecut-block-prices`, `assembly-prices`, `sortings`, `packing-prices`, `code-margins`, `delivery-costs` |
| Sell side | `locopack_margins` (→ `sell_margin_tables`), `SALE_MARGIN_*` (VAT → `tax_rates`; design fees → `sell_margin_tables`) |
| Summary | `spec_details` ⋈ `spec_titles`, `promotions` (B3.3) |

Not used by folding: `percent_reduces`, `difficult_match_margin`, `factory_fix_cost_percents`, `step_prices`. `code_margins` is B-only.

## 5. Quirks and how the port treats them
**Port exactly** (numbers): every formula; float arithmetic; PHP `round`/`ceil` placement; `convertNumberFloat` string round-trips; production quantity vs requested quantity in the margin step (`FoldingCalculator.php:1389,1442`); the digital per-component `convertTo2Decimal` rounding.

**Fixed, listed as deviations in `docs/pricing-validation-folding.md`** (user decision 2026-09-26):
| # | Legacy behaviour | Packio |
|---|---|---|
| Q1 | `summary` taken from the first print type that completes; per-part rows from the cheapest one; a failure on the last print type drops the factory (`FoldingCalculator.php:1065-1070,1186,1217-1222`) | cheapest **complete** configuration per factory |
| Q2 | structure design fee charged on every sub-pattern (`:1025-1035`) | once per quote |
| Q3 | input VAT ignored by an unparenthesised ternary (`Calculator.php:248,252`) | VAT from `tax_rates` |
| Q4 | `total_weight` = a per-box weight limit (`Calculator.php:383`) | computed by the B2.4 packing helper |
| Q5 | SME lead time falls to 0 for most factories (`Calculator.php:113`) | print-type-term lead time |
| Q6 | `validCanDoProcess` returns null when an exclusion row exists; the finish check reads keys that never exist (`PrepareRequest.php:363-403`) | exclusions evaluated as specified |
| Q7 | `calculate() != null` treats a cost failure as success with empty data | failure is an error |
| Q8 | A sorting cost uses an undefined `$costSort`, so it is always 0 (`A/CalculateCost.php:1702-1723`) | kept at 0 for A (numbers unchanged), flagged |
| Q9 | `rand()`-keyed caches (`A/CalculateCost.php:428,756`); Laravel caches whose keys leave out the factory | no caches: pure function of the snapshot |
| Q10 | `first()` without ORDER BY; unstable `usort` / `array_multisort` ties | explicit tie-break (price-list line order); stable sorts |
| Q11 | hard-coded factory ids: 9 (digital ×1.2, lead time), 16 (500 floor, lead time), 23 (overlap, diecut waste), 3/6/10/11/PFO (lamination mapping) | per-factory price-list terms, neutral by default |
| Q12 | `number_format` with its default `,` separator fed back into arithmetic (`convertToMm('in', …)`; `PatternArea.php:554` lock-bottom `dw`) truncates from 1,000 mm | rounded to 2 decimals without truncation; each call site listed as it is ported |
| Q13 | `swipePaperSheetSize` casts Eloquent models with `(array)`, losing every attribute, so factories with `can_flip_paper_size` never got a layout (`helpers.php:1140-1172`) | the intended rotation: each sheet plus its turned copy, marked against the grain |
| Q14 | a missing condition, band, standard blank or paper trim is read as `null`, i.e. 0, with a PHP notice (`PatternArea.php:185-723`) | the configuration is not priced (`GeometryError`), never priced on silently wrong geometry |
| Q15 | CS sends `isGrain` without `grainPararell`, so a fixed-grain request from CS yields no layout (`cs.vue:2189`, `PatternArea.php:947,1029`) | the orientation is a required input when the grain is fixed (API validation) |
| Q16 | a missing **price** row is read as `null`, i.e. the process costs 0 (print colour, finish 1, finish 2 on any machine, all die-cut or print-plate data); a missing **waste** band silently adds no waste (`A/CalculateCost.php` `calCost*`, `A/CalculateWaste.php` `cal*Waste`) | a missing price line refuses the configuration (`price_line_missing`), and an incomplete print plate is skipped rather than looking free; a missing waste band keeps legacy's no-waste result and is reported in `missingBands` for the staff breakdown |
| Q17 | finish-2 waste sets are compacted when an F2 has no waste rows, so later F2s read another F2's sheets and step-down percentages (`A/CalculateWaste.php:320-336`, `A/CalculateCost.php:1092`) | waste is kept by F2 position; an F2 without waste rows adds none |
| Q18 | per-process cost variables are not reset between layouts, so a layout missing a process would inherit the previous layout's cost (`A/CalculateCost.php:72-82, 190-244`) | computed per layout (unreachable in legacy when the data is complete, since every priced layout carries each requested process) |
| Q19 | the 4-colour flat print price is read straight from the database without the factory filter, behind a `rand()` cache key (`A/CalculateCost.php:428-455`) | read from the factory's own price list |
| Q20 | a band bound left `NULL` never matches in legacy (`NULL >= x` is false) | `NULL` bounds are open (“no lower / upper limit”) |

**Not in B2.3**: customer shipping and carrier engines (B2.4, D-013); promotions (B3.3); order hierarchies / SAP (D-030); `receiving_date` in calendar days (replaced by capacity + factory calendar, D-101).

## 6. Geometry formulas (legacy `PatternArea::calPatternArea` cases → `geometry_formula`)
| Legacy case | Name (Thai) | `geometry_formula` | Slots read |
|---|---|---|---|
| 1 | แบบฝาเปิดบน | `tuck_top` | dw, dl |
| 2 | ถาด | `tray` | dw |
| 3 | ปลอก | `sleeve` | dl |
| 4 | ฝาครอบ | `lid` | dw |
| 5 | ไส้ | `insert` | dw (uses `x`, default 3) |
| 6 | หูแขวนฝาเปิดบน | `hanger_tuck_top` | dw, dl |
| 7 | แบบป๊อปอัพฝาเปิดบน | `popup_tuck_top` | dw, dl |
| 8 | แบบป๊อปอัพหูแขวน | `popup_hanger` | dw, dl |
| 9 | แบบทรงบ้าน | `house` | aux_f (group 1 by l), dl, nd |
| 10 | แบบฝาพับ | `fold_flap` | dw (legacy also reads dl, unused) |
| 11 | แบบขนมญี่ปุ่น | `wagashi` | — |
| 12 | แบบขนมฝาเสียบข้าง | `wagashi_side_tuck` | — |
| 13 | แบบขนมฝาเปิด | `wagashi_open_top` | aux_f, aux_f10 (groups 1 and 10 by l) |
| 14 | แบบทั่วไป overlap | `flat_overlap` | — (input `c`) |
| 15, 33–36 | แบบทั่วไป non-overlap | `flat` | — |
| 16 | แบบเปิดฝาบน/ฝาล่างขัดล็อค | `lock_bottom_top` | dw (variable `b`, by w), aux_f (group 1 by l), dl |
| 17 | แบบทั่วไป overlap2 | `flat_overlap_combined` | — (input `c`) |
| 31 sub 5, 32 sub 7 | ฝาสไลด์ / ฝาครอบ (ถาด) | `slide_tray` (on the sub-pattern) | dw |
| 31 sub 6 | ฝาสไลด์ (ปลอก) | `slide_sleeve` (on the sub-pattern, `swap_dimensions`) | dl, looked up by d |
| 32 sub 8 | ฝาครอบ (ฐาน) | `cover_base` (on the sub-pattern) | dw |
| 37 | แบบทั่วไป non-overlap + dl | `flat_extended` | dl |
| 45–48 | กล่อง/ถาดอาหาร | `standard_blank` | `pattern_standard_blanks` |

Ported in `src/modules/pricing/calculators/folding/geometry/` (`formulas.ts`, `layout-amount.ts`, `pattern-area.ts`).

## 7. Engine A offset (slice 4)
Ported in `src/modules/pricing/calculators/folding/` — `request.ts` (the `PrepareRequest` process arrays), `tables.ts` (price-list rows), `a/waste.ts` (`A/CalculateWaste`), `a/cost.ts` (`A/CalculateCost` print / die-cut / finish / assembly / ordering), `margin.ts` (`calMargin` + `Object/Margin`), `a/engine.ts` (`FoldingCalculator::calculate` for one part).
Legacy per-factory definitions become price-list data: `color.color_type` → `pl_ink_colours.is_standard`; `finish.diecut_window_price` → `pl_finish_prices.adds_diecut_window`; `assembly.assembly_type` / `diecut_window_price` → `pl_assembly_prices`; `finish.required_*` / `assembly.required_*` / `assembly.skip_waste` come from the platform catalogue. Hard-coded factories become terms: `PFO` → `four_colour_price_by_max_percent`, `assembly_waste_by_assembly`; factory 23 → `diecut_waste_by_box_amount`. Legacy's unused `required_amount` quantity of finish 2 and assemblies stays unused.
