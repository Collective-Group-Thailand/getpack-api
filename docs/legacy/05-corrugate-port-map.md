# Corrugate calculator (+ combine) — legacy port map (U-B6, B2.3 Deliverable 2.3)

> Reference for porting the legacy corrugate calculator. **Legacy is read-only and never run** (D-005).
> Source: `/Users/superball/Abbon/Loco_Pack/locopack-web` (same `app/` as `Packio-Web/legacy/locopack-web`). Paths below are relative to the legacy root. Traced 2026-09-29.
> Treatment follows the folding rule (user decision 2026-09-26): **maths ported exactly, orchestration and state bugs fixed and listed as deviations** in `docs/pricing-validation-corrugate.md`.

## 1. Entry points
| Route | Controller | Reaches |
|---|---|---|
| `GET /api/corrugate/calculate_cs` (`routes/api.php:268`) | `Api/Corrugate/CorrugateController@calculate_cs:269` (returns at `:273`; `:274-616` is dead) | `CorrugateCalculator::calculate_cs:310` (CS, `$sme = false`) |
| `GET /api/cs/corrugate` (`:263`) | `@getCSData:104` | CS master data: factories, patterns + sub-patterns, flutes per pattern type, paper groups (with `can_finish`), SME papers, coatings, assemblies, colours, print areas, difficulty groups, `SALE_MARGIN_*` defaults |
| `GET cs/corrugate/get-input-data` (`routes/web.php:831`) | `Corrugated\CorrugatedController@getCSInputData:28` | same data for the `cs-v2` view (+ promotions, print types, designer types) |
| `POST /api/products` (SME) | `ProductAPIController@store` → `Calculator::FromSME:28` → `:49,61` | `CorrugateCalculator::fromSME:179` → `convertCombine:219` → `calculate_cs(..., true)` |
| `GET /api/corrugate/calculate` (`:267`) | `@calculate:234` (validated) | `CorrugateCalculator::calculate:1099` — factory tool: one factory + print type, **all ten layouts**, sell side with margin 0 |
| `POST cs/corrugate` (`routes/web.php:832`) | `CorrugatedController@calculateCS:23` | `CorrugateCalculator::fromCS:195` → `ConvertCSDataToFactory:212` — **broken**: returns nothing |
| `cs/change-factory/corrugate/{order}` | `ChangeFactoryController` | re-prices an order (B3 order operations; not in this port) |
| order re-price | `CorrugateCalculator::fromOrder:100` | `calculate_cs((object) $cs_input, true)` |

"Combine" = combination products (`mapping_inputs.is_combination`, `Calculator::FromSME:45-52`): a pattern with several sub-pattern parts (Tele 29 body + lid, slide 30 tray + sleeve). Every part is priced per factory × print type and the parts are summed; a factory × print type that fails any part is dropped (`CorrugateCalculator.php:1047`).

## 2. Core pipeline — `CorrugateCalculator::calculate_cs:310-1097`
1. `setCSData:254-308`: main fields + one row per `sub_patterns[]`; **assembly group 22 (packing, "ค่าห่อ") is appended to every part** (`:292-301`).
2. For each factory (`getFactories:12`: `factory_match_packaging` type 3, active) × print type (`getPrintTypes:26`), for each part:
   - minimum order (`:389-395`) — skips the whole option;
   - max colours from `difficult_match_margin.color_amount` (flexo only, `:429-437`), 4-colour request refused on flexo (`:438-442`), factory `max_amount_color` (`:448-455`);
   - difficulty group → the factory's `difficult_level` (`:458-468`);
   - paper grade: CS `paper_groups` × flute → the factory's `paper_grade` (`:477-487`), SME via `Converter::corrugatePaperSMEtoCS:192` (`mapping_paper_rel_paper_grades`);
   - colour groups → the factory's colours (`:507-562`; digital de-duplicates colours `:514-520`);
   - coating front/back only on a `can_finish` grade (`:566-621`), SME names mapped by `Converter::F1SMEtoCS:249` (hard-coded factories 3/6/10/11/PFO);
   - assembly groups → the factory's assemblies (`:624-653`);
   - standard size (`:655-722`): `w/l/h_for_calculate` replace the size for flute id 1 (`:695-699`); the standard-size price path is commented out (`:700-721`);
   - engine `CalculatorCorrugate::calculate` (`:754`), result `[0]` kept (`:768`);
   - plate and die block for the sell side: `ceil(cost × (100 + vat)/100)`, 0 for print type 5 (`:835-836`);
   - Packio margin: `locopack_margins` tier at (qty, `sort_total_price`), base tier at (1, 1), fallback `factory_match_print_type.locopack_margin` (`:877-908`), then `Calculator::SaleMargin:223` (`:926-932`); `total += plate + die block` (`:937`); free design (`is_brief_design == 3`) subtracts the design price (`:938`);
   - summary per option = sums over parts (`:940-951`); lead time `getCustomLeadTime` (`:992-993`).
3. Promotion discount (`:1050-1070`, B3.3) and order hierarchies (`:1071-1078`, SAP — D-030) are not ported.
4. Options sorted by `summary.total` (`:1092-1094`).

### Engine — `CalculatorCorrugate::calculate:147-865`
1. Terms: `factory_match_print_type` (`:150`), `find_pattern_type` for factory × print type × flute (`:202`), paper grade price bands `paper_grade_match_flute` ordered by `min_sheet` (`:203`), difficulty (`:205`), `difficult_match_margin` at max(front, back) colours (`:206`), die blocks (`:208-215`; factory 20 also by flute).
2. Print margin percentages (flexo, print type 6: `:239-248`; min margin per unit `:267-280`; no print → the 0-colour row `:282-286`).
3. Flute take-ups `col_a, col_c, col_dd, col_g, col_fh, ct, z` (`:289-295`); condition bands `i, j, k, m` (`:309-312`).
4. Blank formula per pattern (`:314-463`, §6), factory `plus_dl/plus_dw` (`factory_rel_pattern_conditions` by factory × flute × pattern × sub-pattern, `:465-475`), `area_sqm` rounded to 4 (`:481`).
5. Print area (flexo, `:487-586`): per colour, % of the blank from its pattern area (`calculate_percent_from_pattern_area:1798`, §6.2) or the given %; digital type 2 keeps the max % per side (`:587-602`).
6. RSC vs D/C (`:613-660`): RSC only for pattern 19 inside the `find_pattern_type` limits (blank L/W in inches, flap, SLH, SLL, SLW); otherwise D/C needs a die block that fits (flexo) or a paper size that fits (digital) — else "ขนาดกระดาษไม่พอ".
7. Assemblies (`:662-669`) and fixed options (`:672-689`: `fixed_options` add an assembly or set die-cut delivery rounds per factory × pattern × sub-pattern × RSC/DC).
8. Engine by print-type **name**: RSC + Flexography → `CalRSCFlexo:867`; D/C + Flexography → `CalDCFlexo:1084`; D/C + Digital → `CalDigital:1337` (with digital print prices, fix cost, trims, coating, die-cut price loaded `:702-831`); anything else → empty result.

## 3. Live / dead code
| Status | Code |
|---|---|
| Live | `CorrugateCalculator::calculate_cs`, `setCSData`, `getFactories`, `getPrintTypes`, `fromSME`, `convertCombine`, `fromOrder`; `CalculatorCorrugate::calculate`, `CalRSCFlexo`, `CalDCFlexo`, `CalDigital`, `sort_data`, `limit_10`, `width_layout`, `cal1–cal29`, `Tele*`, `area_sqm`, `calculate_percent_from_pattern_area`, `top`, `side`, `top_side`, `allArea`, `calculate_factory_margin`, `calculateAssembly`, `getConditionValue`; `Calculator::SaleMargin`, `calculatePercentReduce`; `Converter::corrugatePaperSMEtoCS`, `paperGradeToSME`, `enamelSMEtoCS`, `F1SMEtoCS`, `recheckStandardSize`; `ShippingUtils::calShippingCostCorrugate`, `calCostCorrugate_WithShipping`, `isRSCPattern`, `getFluteType`, `convertFluteInt2Text`; helper `getCustomLeadTime:1981` |
| Live, factory tool only | `CorrugateCalculator::calculate:1099` (skips standard sizes and fixed options, margin 0) |
| Dead | `CorrugateCalculator::fromCS`, `ConvertCSDataToFactory`, `CStoFactory:37`, `has`; `CalculatorCorrugate::round_up`, `calculateDimension` (custom-cost path only; its pattern 26 differs from `calculate` and reads an undefined `$this->w`); `Api/Corrugate/CorrugateController::calculate_cs:274-616`, `setCSData:619`, `formatCSResult:661`; `Converter::corrugateSMEtoCS:85`, `corrugatePaperCStoSME:335` |
| Not ported (Packio has its own rule) | custom cost (`custom_cost`, `:340,723-752,785-792`), CS manual margin (`fix_margin.manual`, `:911-922` — B3.5 discount memos), fixed / distance delivery (`calType 1/2`, `:852-875`; `delivery_distance` → `delivery_cost` in the flexo total `:217-232`), promotions, order hierarchies (D-030), product image lookup (`:822-831`), mockup quantity for shipping (`isMockupOrder`, D-072 add-on is separate in Packio) |

## 4. Data read (→ Packio source)
Every legacy per-factory table becomes a component of the factory's corrugate price list (schema-design §3.4); catalogue ids become platform catalogue rows (§3.3). Target tables are fixed in slice 2 (schema-design A-49); folding `pl_*` tables are reused only where the legacy table and columns are the same.

| Legacy | Read at | Packio (proposed) |
|---|---|---|
| `flute_type` (`col_a, col_c, col_dd, col_g, col_fh, ct, z`) | `:201,289-295` | catalogue `flute_types` (+ `ct`) |
| `pattern_match_flute` | CS data | catalogue `pattern_flute_types` (exists) |
| `pattern`, `sub_patterns` (ids 19–30, 38, 39; subs 1–4) | `:314-463` | catalogue patterns / sub-patterns with a corrugate blank formula (§6) |
| `conditions` (`i, j, k, m` by `w` and `w/l`) | `:309-312` | catalogue geometry band tables (+ determinant `w/l`, slots `i j k m`) |
| `paper_groups`, `paper_grade` (group, flute, gsm, `can_finish`, colours, strength) | `calculate_cs:477-504` | catalogue materials of kind `corrugated_board` (flute, gsm, colours, strength exist; + coatable) |
| `paper_grade_match_flute` (sheet bands, THB/sq ft) | `:203,899-910,1141-1153,1379-1386` | corrugate board price bands per material × print type |
| `find_pattern_type` | `:202` | corrugate process terms per print type × flute |
| `paper_roll_widths` | `:874,1120` | roll widths per print type (`paper_roll_widths` component value exists) |
| `factory.paper_cut`, `factory.max_amount_color`, `factory_match_print_type` (`margin`, `min_order_amount`, `locopack_margin`, `locopack_fix_cost`, `lead_time`, `trim_dl/dw`, `print_fix_cost_thb_per_sqm`, `non_print_fix_cost_thb_per_sqm`, `corrugate_*` flags) | throughout | corrugate print-type terms |
| `difficult_level` (`print_plate_price`, `min_price`, digital waste % / setup sheets) | `:205` | corrugate difficulty terms |
| `difficult_match_margin` (`percent_margin`, `min_margin_thb`, `min_margin_per_job` by colours) | `:206,239-286` | difficulty margins (`difficulty_margins` component value exists) |
| `diecut_block_price` (flexo: max W/L, block price, `min1lay_diecut_price`, `step_diecut_price`, `price_per_pcs`, `min_diecut_price`, delivery cost, side; digital: pcs band, THB/m²) | `:215,634-638,1089-1224,1459-1469` | corrugate die blocks |
| `percent_reduces` | `Calculator::calculatePercentReduce:452` | `percent_reduces` component value exists |
| `factory_fix_cost_percents` | `CalDigital:1480-1497` | `fix_cost_pcts` component value exists |
| `fixed_options` | `:672-689` | fixed options per pattern × sub-pattern × RSC/DC |
| `factory_rel_pattern_conditions` (by flute) | `:465-475` | pattern conditions per flute |
| `print_prices` (digital: per pcs, ink THB/m², two-sided add-on, amount band, per paper grade) | `:711-771` | digital print prices |
| `finish_price` (`finish_price_by_area_thb_per_in2`, by difficulty) | `:784-823` | finish prices |
| `diecut_price` (digital: job / per pcs / per m², by order-amount band and difficulty) | `:825-830,1432-1438` | die-cut prices |
| `assembly`, `assembly_prices` (range, area band, dL band, min price, material THB/in²), `paper_trim.trim_finish_plate_mm` | `calculateAssembly:1961-2037` | assembly prices, paper trims |
| `paper_sizes` via `paper_grade_match_paper_sizes` (digital sheets) | `:640-653` | board sheet sizes per material × print type |
| `standard_sizes` + `pattern_rel_standard_sizes` (`*_for_calculate`) | `:661-699`, `Converter::recheckStandardSize:418` | catalogue standard sizes (`calc_*_mm` exist) |
| `locopack_margins`, `SALE_MARGIN_*` | `:877-908`, `Calculator::SaleMargin` | `sell_margin_tables` (corrugated product type), VAT from `tax_rates` |
| `mapping_paper_rel_paper_grades`, `mapping_inputs` | SME conversion | none — the configurator sends catalogue ids (materials, print areas, colours) |
| `delivery_cost`, `zipcodes_delivery_zone`, carrier tables | delivery | B2.4 rate cards and packer (§9) |

## 5. Quirks and how the port treats them
**Port exactly** (numbers): every formula and its operand order; float arithmetic (IEEE doubles, `decimal.js` at the engine boundary as folding); PHP `round`/`ceil`/`floor` placement; `number_format(x, 10, '.', '')` round-trips before `ceil` (`:696-697,888,1137`); the paper-band walk (`:899-910` RSC, `:1141-1153` D/C, including D/C's bump to the band's `min_sheet`); the order of the `find_pattern_type.min_sheet` bump relative to the band walk (before it in RSC, `:892-894`; after it in D/C, `:1155-1157`); the layout ordering key `show_total_sell_price` (before factory margin and before the plate / die-block split), then waste, roll width, die size (`sort_data:1556`); the digital waste chain order (`:1365-1376`); plate and die block sold at the factory's price × VAT, outside Packio's margin (`:835-836`); the sell-margin price tier read inclusive (`max_price >= price`, `:883,894`, unlike folding's half-open).

**Fixed, listed as deviations in `docs/pricing-validation-corrugate.md`:**
| # | Legacy behaviour | Packio |
|---|---|---|
| C1 | One `CalculatorCorrugate` instance serves every factory, print type and part of a request; `printing_area_sqinch_back` is never reset (the back plate grows with each call), `diecut_block_thb` survives into a later RSC total, `arr_2side_print_price_per_sqm` accumulates, `diecut_delivery_round` set by a fixed option persists, `printing_*_percent` are set only in one branch, `paper_cost` keeps the previous grade's price when a grade has no band (`:156,488,1211,728,685,588-601,899-910`) | every part priced from its own snapshot: a pure function, no carry-over |
| C2 | Digital results are not sorted; `calculate_cs` keeps the first paper size in query order (`CalDigital:1340-1544`, `:768`) | the cheapest digital layout (ordered like flexo) |
| C3 | Missing condition band, `difficult_match_margin` row (0 colours / max colours), assembly price, flute or terms row → `->first()->x` on null (PHP error or 0) (`:206,285,974,2046,1979`) | the option is not priced (`price_line_missing` / `geometry_band_missing`), never priced on silently wrong data (as folding Q14/Q16) |
| C4 | Bands `i j k m` are read for every pattern (`:309-312`), so any missing band breaks every pattern | only the patterns whose formula reads them need them (26, 27, 28) |
| C5 | Coating on flexo is accepted and resolved (`:566-621`) but never priced (only `CalDigital` prices finishes) — free coating | a flexo option with a coating is **refused** (`process_not_possible`); digital prices it (conservative, confirmed at planning 2026-09-29) |
| C6 | Hard-coded factories: 4 (no packing charge on RSC `:2010`; own top+side area formulas `:1901-1934`), 9 (digital print price by order-amount band `:720`; back print 15 × 1.2 THB/m² `:1411`; window assembly by area band `:1970`; packing 0.8 / 0.4 THB per piece by pattern family `:2001-2008`; bulk lead time `helpers.php:1989-1992`), 12 (no D/C `:691`), 16 (print price per grade + two-sided add-on `:716,727-728,1422-1425`; coating area expression `:793`; bulk lead time), 18 (no delivery on the factory tool `:1392`), 20 (die blocks by flute `:212`; glue / stitch side by blank-length band `:1974`); `F1SMEtoCS` coatings for 3/6/10/11/PFO | per-factory terms of the corrugate price list, neutral by default (as folding Q11) |
| C7 | Engine chosen by print-type **name** ("Flexography", "Digital"), print type ids 5 / 6 in conditions | engine variant on the print-type terms |
| C8 | Packing assembly group 22 appended to every part; a factory without it drops out (`:292-301,636-652`) | an automatic assembly declared in the catalogue is added to every part; a factory without its price line has no price path (parity), per-factory rules as terms (C6) |
| C9 | SME conversion hard-codes difficulty group 5, colour group 6, print area from `enamel_id`, paper via `mapping_paper_rel_paper_grades` (`convertCombine:219-252`) | the configurator publishes the catalogue ids and the product's fixed inputs (difficulty) |
| C10 | Digital die-block condition `term && (p19 && W≥300) \|\| L≥300 \|\| (D≥110 \|\| D≤850) \|\| …` is always true once the term is on (`:1451-1458`) | block price whenever the term is on and the size is not a standard size (same numbers, dead size test dropped, flagged) |
| C11 | `$this->length = $this->cpt->$this->cpt->min_length_m` (`:896,1159`) would fail but is unreachable (length is already ≥ the minimum) | not ported (no number change) |
| C12 | Standard-size calculation dimensions apply only for flute id 1 (`:695`) | apply for the flute they were measured for (standard size data) |
| C13 | The digital die-cut waste chain reads `diecut_check`, which no live path sends (`:1368`) | kept off (same numbers) |
| C14 | Structure design fee on every part when `structure_status` (`:847-849` resets only the graphic fee) | design fees once per quote (as folding Q2) |
| C15 | CS without `fix_margin.vat` grosses plate / die block by `(100 + false)/100 = 1` (`:346,835-836`) | VAT from `tax_rates` everywhere (as folding Q3) |
| C16 | Shipping priced per part with a carrier, folded into the per-piece price (`SaleMargin:291-403`); the flute text is mapped only for ids 1–3, others read as B (`ShippingUtils.php:38-50`) | one shipment per quote on the B2.4 rate cards (its own line, D-013); the part's own flute |
| C17 | `summary` built from the first part's print type; a failure on a later part drops the factory (`:1047`) | an option is complete only when every part priced (same outcome, explicit) |
| C18 | `usort` / `array_multisort` / `first()` without ORDER BY | explicit tie-break (price-list line order), stable sorts (as folding Q10) |
| C19 | A band bound left `NULL` never matches (`NULL >= x` is false) | `NULL` bounds are open (as folding Q20) |
| C20 | The digital fix cost per m² picks the printed rate on `!empty(selectFrontColor) \|\| !empty(selectBackcolor)`; `selectBackcolor` (lower-case c) never exists, so a back-only print pays the unprinted rate (`:774-778`) | kept (same numbers), flagged |

## 6. Geometry
### 6.1 Blank formulas (`CalculatorCorrugate::calculate:314-463`, `cal1–cal29:1580-1756`, `Tele*:1758-1784`)
| Legacy pattern (sub) | Name (Thai) | Formula (proposed name) | dW / dL | Flap, SLH | ODL / ODW / ODH |
|---|---|---|---|---|---|
| 19 | ฝาชน (RSC) | `rsc` | cal1 / cal2 | cal3, cal4 | cal5 / cal6 / cal7 |
| 20 | ฝาเสียบเดี่ยว | `single_tuck` | cal8 / cal9 | — | cal10 / cal11 / cal12 |
| 21 | ฝาเสียบคู่ | `double_tuck` | cal13 / cal14 | — | cal15 / cal16 / cal17 |
| 22 | ฝาเสียบคู่ ผนังบน 2 ชั้น | `double_tuck_top_wall` | cal18 / cal19 | — | cal20 / cal21 / cal22 |
| 23 | ฝาเสียบคู่ ผนังข้าง 2 ชั้น | `double_tuck_side_wall` | cal23 / cal24 | — | cal25 / cal26 / cal27 |
| 24 | ทั่วไป (flat sheet, no height) | `flat_sheet` | W / L | — | — |
| 25 | อาหารทะเล | `seafood` | cal8 / cal9 | — | L+4fh+5 / W+4fh+c / D+2fh |
| 26 | กล่องเปิดฝาบน | `open_top` | uses `i k m j` (`:379-380`) | — | L+2fh / W+2fh / D+3fh |
| 27 | หูหิ้ว ไม่มีขอบ | `handle` | `:387-388` | — | L+2fh / W+2fh / D+2fh+55 |
| 28 | หูหิ้ว มีขอบ | `handle_rim` | `:395-396` | — | L+2fh / W+2fh / D+2fh+55+(20+a) |
| 29 (1) | Tele ตัว | `tele_body` | TeleDW / TeleDL | TeleFlap, TeleSLH | TeleODL / TeleODW / TeleODH |
| 29 (2) | Tele ฝา | `tele_lid` | as body on W, L, D + 2fh − ct (`:412-414`) | as body | as body |
| 30 (3) | ฝาสไลด์ ถาด | `slide_tray` | `:425-426` | — | L+6fh / W+2fh / D+fh |
| 30 (4) | ฝาสไลด์ ฝา | `slide_sleeve` | on W' = D+fh, L' = W+2fh, D' = L+6fh (`:433-440`) | — | D' / L'+2fh+1 / W'+2fh+1 |
| 38 | ถาด | `tray` | as `slide_tray` | — | as `slide_tray` |
| 39 | ฝาซ้อน full overlap | `full_overlap` | 2W+2c+D+dd / cal2 | W+c, cal4 | cal5 / cal6 / D+6fh |

Condition values (`getConditionValue:2039`): `i` by W, `j` by W/L, `k` by W, `m` by W; inclusive bands.

### 6.2 Print area % (`calculate_percent_from_pattern_area:1798-1954`)
Pattern areas (legacy `mapping_inputs` type 3): 36 top (`top:1812`), 37 side (`side:1846`), 38 top + side (`top_side:1898`), 39 all round (`allArea:1938`); % = area ÷ blank area × 100. `side` and part of `top_side` switch on the factory term `corrugate_cal_pattern_area_percent_type` (1 | 2). Without a pattern area the colour's own % is used; with `printing_calculate_type = 2` the given % always wins (`:516-518`).

### 6.3 Port (slice 3)
Ported in `src/modules/pricing/calculators/corrugate/geometry.ts` (`blank`, `isRsc`, `printAreaPercent`). The unit vectors come from an independent Python transcription of the same PHP organised by legacy pattern / sub id (`test/golden/corrugate/reference/geometry_reference.py` → `geometry.vectors.json`): 18 blanks covering the 16 formulas, with and without the factory adjustment, and the four print areas × side-area methods 1 / 2 × the factory-4 rule. Two faithful oddities kept: the seafood top area adds the flute `a` outside the product (`:1826`, operator precedence), and a pattern without a branch prints on 0 % (38 `tray` top / side; side-area method 0 for tuck and seafood boxes).

## 7. Engines
- **RSC flexo** (`CalRSCFlexo:867-1082`): roll widths of the factory; width lay-out `floor((roll − trim) / dWlay)` within 1…`width_layout_max`; length lay-out, run length (minimum metres), sheets, paper band, paper area and waste, paper cost per sq ft; print price = paper ÷ (1 − margin%) (doubled margin for two sides); plates = printed area × plate price; total cost; profit floor per job and per unit (unless a percent reduce applies); × reduce; plate and die block split out; per-piece minimum; factory margin gross-up (`calculate_factory_margin:1956`). `paper_cut` (LOC-426) lays several blanks per cut sheet.
- **D/C flexo** (`CalDCFlexo:1084-1335`): per fitting die block: die lay-out across / along (gap, trims), cut-sheet size (at least the RSC minimum), roll lay-out as RSC, paper band with the band's `min_sheet` bump, plates × die lay-out, die block (0 for a standard size), die-cut per sheet (`min1lay + (lay − 1) × step`) or per piece, minimum die-cut price, delivery rounds; then as RSC.
- **Digital** (`CalDigital:1337-1545`): per sheet size: die lay-out (trims), sheets, waste chain (assembly, die-cut, print back, print front), paper band by sheets or order amount (term), paper cost on the trimmed blank, ink per m² per side (+ two-sided add-on), die-cut (job / per piece / per m²), die block per m² by pcs band, coating by area, printing fix cost per m² (printed or not), fix-cost % by blank area then pcs band, factory margin, minimum 500 (term).
- **Assemblies** (`calculateAssembly:1961-2037`): price row by range; per piece × qty, or the minimum price for digital; material by area when the assembly takes sizes; packing (group 22) and window rules as terms (C6, C8).

### 7.1 Port (slice 4)
Ported in `src/modules/pricing/calculators/corrugate/flexo.ts` (`priceFlexoPart`: print setup, `CalRSCFlexo`, `CalDCFlexo`, `sort_data` / `limit_10`, `calculatePercentReduce`, `calculate_factory_margin`) and `assemblies.ts` (`calculateAssembly`). Layout fields match legacy's: `buyPrice` = `sort_total_price` (after the factory margin, plates and die block excluded), `plates` / `dieBlock` = the factory's price after the reduction (legacy `print_paper_cost`, `diecut_price`), which the sell side rounds to the satang and grosses up by VAT (`calculate_cs:835-836`). Vectors from an independent Python transcription in the PHP's statement order (`test/golden/corrugate/reference/flexo_reference.py` + `phpnum.py`): 9 engine cases (RSC one side / both sides / paper cut unprinted / volume reduction; die-cut with delivery rounds, standard size, band-minimum raise, back only, no block) and 10 assembly cases (packing per piece, factory-9 families, factory-4 free RSC, range, digital minimum, window bands, blank-length bands, material by area).

### 7.2 Port (slice 5)
Ported in `src/modules/pricing/calculators/corrugate/digital.ts` (`priceDigitalPart`: sheet fit, print prices per colour with the per-board (legacy 16) and quantity-band (legacy 9) rows, type-2 front coverage, coating by area, die-cut price by order-quantity band, die lay-out on the sheet (bare-blank test, trimmed count), waste chain assembly → print back → print front, board band by sheets or order quantity, paper on the trimmed blank, ink per m², legacy 9's flat back rate, legacy 16's two-sided add-on, die-cut job / per piece / per m², die block per m² by pieces band, printing fix cost, fix-cost % by blank area then pieces, factory margin, minimum lot). The die block is inside the digital buy price (`calculate_cs:835-836` charge plate and die block apart only for flexo). Two float-order notes: legacy 9's back rate `qty × area × 15 × 1.2` becomes `qty × area × 18` (the term), and legacy 16's coating area `((dW·dL)/100)/(2.54²)` equals `(dL/25.4)(dW/25.4)` — both differ from legacy only in the last bits of a double. Vectors: `test/golden/corrugate/reference/digital_reference.py` (11 cases incl. the refusals).

## 8. Sell side and orchestration
- The sell side is the shared `SaleMargin` port (`src/modules/pricing/calculators/shared/sell.ts`, loader `shared/sell-snapshot.ts`) with `priceMaxInclusive` for corrugate; buy price = the option's `sort_total_price` (after factory margin, plate and die block excluded); plate and die block are added at the factory's price × VAT (legacy parity, `:835-837`).
- The quote engine is generic since slice 1: `CalculatorAdapter` (`src/modules/pricing/calculators/adapter.ts`), folding's `FoldingQuoteAdapter`; corrugate adds its adapter.
- Lead time: `ceil(lead_time)` or the bulk rule (`getCustomLeadTime`, factory 9: print type 5 from 300 pieces → 12 days) as the print-type terms `bulk_lead_time_*` (as folding).

### 8.1 Port (slice 6)
- `corrugate-calculator.ts` ports `calculate_cs` as a pure function over options. Checks that do not depend on the quantity refuse the option: the colour limits `:429-455`, the difficulty `:458-468`, board prices `:477-504`, colours the factory prints `:506-562`, coating on a board without `can_finish` `:569`, coating on flexo (C5), the process terms. The minimum order `:389-395` and engine refusals leave only that quantity unpriced. Every part is priced by its engine, the first layout kept, `SaleMargin` per part at run = quantity, plates / die block `ceil(round2(price) × VAT)` for flexo only. Design fees are charged once per quote (C14). Lead time is `ceil(lead_time)` or the bulk term. Buy price = Σ parts (`sort_total_price` + plates + die block). Step VAT = the product VAT plus the VAT inside the plates / die blocks.
- `corrugate-snapshot.loader.ts`: configuration → parts. The board is a `corrugated_board` material and its flute must be one the pattern offers. The flute take-ups `a c g fh` are required (`dd ct z` default 0, as legacy's NULLs). Condition bands `i j k m` come from the pattern slots with legacy's fixed determinants. The standard size of the catalogue product is matched on L × W × H, and its calculation size applies when set for the board's flute (C12); a missing calculation height keeps the height asked. Assemblies flagged `auto_add` are added to every part; requesting one is refused. Options: one per `pl_corrugate_print_type_terms` row with its rows in line order; die blocks with no flute or the board's flute; pattern conditions / fixed options per part (exact sub-pattern); sell side with `priceMaxInclusive`.
- `corrugate.adapter.ts` registers `corrugate` with the quote engine; parts report blank area (capacity in m²) and sheets (capacity in sheets); the production run is the quantity (corrugate has no minimum production run). `PricedStep.toolingAmount` carries the plates / die blocks (0 for folding).

## 9. Shipping packer (`ShippingUtils::calCostCorrugate_WithShipping:305-403`)
Weight per box `dW·dL/1e6 · gsm/1000` kg (blank without the factory's `plus`), total `⌈weight × qty⌉`; flat size `⌈dW/10⌉ × ⌈dL/10⌉` cm, stack height `⌈fh·qty/10⌉`; RSC family (19, 26–29) folds in half — L = `⌈((dL − g + 3)/2 + c)/10⌉`, thickness `fh × 2.5`; slide sleeve (30 sub 4) folds W the same way (height with `fh × 2.5`, thickness `fh`); lay-out on the 60 cm grid when W + L < 120 (`floor(60/side)` per side under 60); cartons by size `⌈(layH · thickness/10) / 60⌉` vs by weight; carton `W·layW × L·layL × ⌈layH·thickness/10/count⌉`, weight `⌈total/count + 0.5⌉`. Packio: the 60 cm grid, 120 cm (2 × grid) and 60 cm stack are `shipping.carton_spec` (as folding); carrier rate lookups are replaced by the B2.4 rate cards. Ported in `src/modules/shipping/packing/corrugate-packing.ts` (`packCorrugate`, shipment part kind `corrugate`); the flat blank is taken without the factory's adjustment and rounded to 2 places as legacy formats it (`:845-846`). Vectors: `test/golden/corrugate/reference/packing_reference.py`.

## 10. Golden cases and validation
No Locopack dump holds calculator **outputs** (`test/fixtures/legacy/calculate_logs_*.sql` has inputs only), so the expected values are derived from the PHP a second time, independently of the TypeScript port:
- `test/golden/corrugate/reference/` holds Python transcriptions that keep the PHP's statement order and line references — geometry (slice 3), flexo RSC / die-cut + assemblies (slice 4), digital (slice 5), packing (slice 6) and, for slice 8, `calculate_reference.py`: the `calculate_cs` orchestration (`:387-395` minimum order, `:429-569` refusals, `:604-626` RSC test, `:671-689` fixed options, `:768` first layout, `:835-836` plates / die block × VAT rounded up, `:877-907` sell tier and base tier, `:937` total, `:992` lead time) and `Calculator::SaleMargin:223-449` without delivery (D-013). The Packio deviations of §5 are applied explicitly and listed in its header. Python floats are IEEE doubles like PHP's; `phpnum.py` transcribes PHP 7 `round` / `number_format`.
- `test/golden/corrugate/cases.py` defines 20 complete, made-up configurations and price lists in the port's input shape and writes `golden.json` (inputs + expected values). They cover RSC one / both sides, paper cut, the print-price reduction, the minimum order, the sell tiers (one buy price exactly on an inclusive tier bound), single tuck die-cut with delivery rounds, a standard size, a window assembly, open top through `i j k m`, Tele (2 parts, design fee once), slide tray + sleeve, the factory blank adjustment on BC flute, packing per box family and the bulk lead time, the factory-4 top + side formula and free packing on RSC, design fees + fix cost + the print type's fallback margin, digital coating, digital two-sided add-on + die block per m² + fix cost %, CS digital coverage + flat back rate + board band by order quantity, and three options with one refused for its colour limit.
- `test/unit/corrugate-golden.spec.ts` runs the port on the same inputs; every number (step and part: buy price, plates, die block, per piece, sum, VAT, total, lead time, margin %, blank, layout) must agree within 1e-6, refusals by code. Mutation checks (plates not rounded up, a half-open tier bound, no automatic packing) each fail the spec.
- `UPDATE_GOLDEN=1 pnpm test -- corrugate-golden` regenerates `docs/pricing-validation-corrugate.md` for the business sign-off (Locopack staging replay). The expected values change only by rerunning `python3 cases.py`.
- `corrugate` is in `SHIPPED_CALCULATORS`; the `corrugated` type stays seeded `rfq` (A-16). The validation doc was signed off on 2026-09-30 after a Locopack staging replay (`test/golden/corrugate/sign-off.json`, tied to calculator version and the sha256 of `golden.json`: any change fails the golden spec until re-signed); going instant is an admin action per environment with `admin.catalogProductTypes.changeQuoteMode` (covered by e2e).
