# Label (sticker) calculator — legacy port map (U-B6, B2.3 Deliverable 2.3)

> Reference for porting the legacy label calculator. **Legacy is read-only and never run** (D-005).
> Source: `legacy/locopack-web` (paths below are relative to it). Traced 2026-10-01. Packaging type 2 = sticker / label (`config/locopack.php:6`).
> Treatment follows the folding / corrugate rule (user decision 2026-09-26): **maths ported exactly, orchestration and state bugs fixed and listed as deviations** in `docs/pricing-validation-label.md`.

Runtime: Laravel 5.7 with `error_reporting(-1)` — every notice ("undefined index", "property of non-object", division by zero) **aborts the request** (`HandleExceptions.php:32,59-62`); reading an index on `null`/`false` is silent (production PHP ≤ 7.3). Below, "throws" means the legacy request failed.

Legacy label print types (`database/seeds/updateLocopackMargin.php:19-92`, `LabelCalculator.php:1013,1081`): **3** offset (factory IDP), **4** digital (PFF, STF), **7** digital (UCI, PTS), **8** digital (PTS). In Packio the engine (`offset` | `digital`) is a print-type term, never an id (as corrugate C7).

## 1. Entry points
| Route | Controller | Reaches | Status |
|---|---|---|---|
| `POST /api/cs/label` (`routes/api.php:580`) | `Api/Label/LabelController@customerServiceCalculate:129-149` | `LabelCalculator::CSCalculate:374-434` → `calculate:436` (CS branch) | **live CS** (`resources/js/components/label/cs-v2.vue:1345`, menu `/cs/label-v2`) |
| `GET cs/label/get-input-data` (`routes/web.php:825`) | `Label/LabelController@getCSInputData:36-90` | CS master data: factories, patterns / papers / finishes (`mapping_inputs` types 1 / 2 / 3), difficulty / colour / die-cut groups, print types, `SALE_MARGIN_GRAPHIC_DESIGN_FEE_LABEL` | live |
| `POST /api/products` (`api.php:272`) | `ProductAPIController@store:355-409` → `Calculator::FromSME:28,57-59` | `LabelCalculator::nonCombinationCalculate:55-181` → `Converter::labelSMEtoCS:313-337` → `CStoFactory:209` → `calculate:436` (CS branch, `cs => true` `:342`) | **live customer web**; up to three quantities, each a separate run |
| `GET /api/rigids/{id}/customize` (`api.php:620`) | `RigidAPIController@customize:886-905` | `FromSME` with a fixed sticker (mapping pattern 25, paper type 28, colour) | live (rigid add-on; not in this port) |
| `POST /api/orders`, `POST /api/rigids`, `rigids/CreateOrderFromCS`, `cs/change-factory/{order}` | order creation / re-price | `nonCombinationCalculate` / `CSCalculate` | B3 order operations (re-price through the quote engine) |
| `POST /api/calculate/label` (`api.php:582`) | `Api/Label/LabelController@submitForm:151-166` | `calculate($data, null)` non-CS branch: top 10 layouts, factory margin only | factory tool → `partner.pricingLabel.calculate` |
| `POST /api/order/{id}/re-production` | `OrderAPIController@reProduction:3528-3548` → `fromOrder:10-53` | always throws (no `fix_margin.design_status`, `:542`) | broken |
| `POST /api/orders-v2` (`api.php:327`) | `OrderAPIController@storev2:1482-1485` | `FromSME(…, true)` returns `{status, data}`, not options | broken for labels |

## 2. Pipeline

### 2.0 Inputs
- **CS** (`cs-v2.vue:1286-1342`): `w`, `l` mm (strings), `box_amount[]`, `paper_type_id` (`mapping_inputs` type 2, default 28), `difficult_level_id` (group, default 5), `mapping_input_id` (no `pattern_id` sent → `CStoFactory:210-212` sets **18**), `print_front` / `print_back` `{check, amount 1–4, color_id[] = colour group ids}`, `finish_front` / `finish_back` `{check, finish_id = mapping_inputs type 3}`, `diecut_type_id: 1` (group), `fix_margin {manual, target_margin, fix_cost, design_status 0..3, graphic_design_fee}`, `zipcode`, `delivery`, `custom_cost`, promotions.
- **SME** (`Converter::labelSMEtoCS:313-337`): w/l cm → mm (`helpers.php:238-240`), paper `MappingInput::find(id)->sub_id`, die-cut group 1, difficulty group **5**, `box_amount [amount]`, `color == true` → front 4 colours of group 5; **`enamel_id` and `special_technic_id` ignored** (coating only through fixed options `nonCombinationCalculate:86-97`).

### 2.1 Orchestration — `CSCalculate:374-434`
Factories (`getFactories:183-197`): `factory_match_packaging.packaging_type_id = 2`, active, `factory_type_id = 1`; optional `selectedFactory` / `custom_cost` filter (`!==`, `:381-388`). Per factory × print type (`getPrintTypes:199-207`: `min_order_amount`, `min_sheet_per_job`, `lead_time`, `margin`) × quantity:
- `min_order_amount > 0 && amount < min` → skip (`:394-398`);
- `paper_type_id = paperSMEtoCS(...)` **inside the quantity loop** (`:400`, quirk L1); `CStoFactory` false → skip;
- `calculate` prices all quantities; per quantity keep the option with the lower `cost.total` per factory (`:409-418`); finally sort by `cost.total` (`:426-429`).

SME (`nonCombinationCalculate:55-181`): same loops; fixed options `fixed_options where factory, pattern 18, input_type 3 → finish_front` (`:86-97`); accept if `waste.total >= min_sheet_per_job` (`:100-104`); keep the lower `summary.per_pcs` per factory; sort by `total`.

`CStoFactory:209-344` per factory × print type: paper `paper where paper_type_id → paper_id` (`:221-230`); difficulty `difficult_level where group → id` (`:232-237`); finish front / back via `enamelSMEtoCS` (`Converter.php:240-247`) — gloss / matt names go through the hard-coded `F1SMEtoCS` (`Converter.php:249-279`: factories 6/10/11 → groups 3/4, factory 3 or `PFO` → 1/2, others → false), else `finish where finish_group_id, finish_type 1` (`:239-275`); die-cut type by group when `diecut_type_id > 0` and **factory ∉ {13, 14}** (else no die-cut, `:277-287`); colours: print type 4 de-duplicates standard colours then appends special colours (`amount = count`), others take the first colour of each group (`:289-330`); factory margin `{id: 2, percent: fmpt.margin}`.

`setData:346-372` resets state (no carry-over between calls) and sets the process flags, in this order: `print_front, print_back, finish_front, finish_back, finish2, diecut, assembly`.

### 2.2 Geometry — `patternArea:824-866`
`paper_trim where factory, print type, active → first`. Only pattern **18**: `dl = nl = l`, `dw = nw = w` (mm) — **every label is priced on its W × L bounding box** (no shape distinction). Returns `gap = paper_trim_gap`, `paper_trim_w/l`, `edge_trim`, `end_job_trim`, `trim_foil_mm`, `trim_finish_plate_mm / 2`, `c = 0`, `combine_layout = false`.

### 2.3 Layouts — `calculateLayouts:658-822`, `calLayoutAmount` (`helpers.php:598-878`)
Sheets (`getPaperSheets:868-881`): `paper ⨝ paper_sizes ⨝ paper_sheets` on the paper's size, factory's sheets, active. Per quantity × sheet (inches; trims mm), `factory_type_id == 1`:
```
roll (in_l == 0): w = (in_w - edge_trim)*25.4 - trim_w ; l = (in_l - edge_trim)*25.4 - trim_l   (negative)
in_w > in_l:      w = in_w*25.4 - trim_l - edge_trim ; l = in_l*25.4 - trim_w - edge_trim
else:             w = in_w*25.4 - trim_w - edge_trim ; l = in_l*25.4 - trim_l - edge_trim
```
Standard if `w >= dw && l >= dl || roll`; rotated if `w >= dl && l >= dw || roll` (`:720,768`). `calLayoutAmount(pw = w, pl = l, dw, dl, c = 0, …)`: `trim = pw < pl ? trimW : trimL`.
- **Sheet** standard: `ansW = floor(pw/dw)`, `ansL = floor(pl/dl)`; `areaWasteW = pw − (ansW·dw + (ansW−1)·gap)`; `layW = areaWasteW < 0 ? ansW − ceil(|areaWasteW|/(dw+gap)) : ansW` (same for L); `areaW = layW·dw + (layW−1)·gap + (pw > pl ? trimL : trimW)`, `areaL = layL·dl + (layL−1)·gap + (pw > pl ? trimW : trimL)`; rotated swaps `dw`/`dl`. `layout = layW·layL`.
- **Roll** (`sheet_cut_length == 0`): `layW` as above, `layL = ceil(qty/layW)`, `areaW = layW·dw + (layW−1)·gap + trim`, `areaL = layL·dl + (layL−1)·gap + trim`.
- **Roll-to-sheet** (`sheet_cut_length > 0`): `cut = (sheet_cut_length − edge_trim)·25.4 − trimL`; `layL = ceil(qty/layW)`; `ansL = floor(cut/dl)`; `layLcut` corrected by `(dl+gap)`; `sheet_amount = layL / layLcut` (float, at least `min_sheet_per_job`); `waste_length = sheet_waste·dl + (sheet_waste−1)·gap + trimL + end_job_trim` (0 if negative); `areaL = floor(sheet_amount)·sheet_cut_length·25.4 + waste_length`, `areaW = pw`; `layout = sheet_amount`.
`paper_amount = ceil(qty / layout_amount)` (`:725,773`).

### 2.4 Waste — `calculateWaste:895-984` (sheets only)
`x = max(paper_amount, min_sheet_per_job)`; chain **diecut → finish2 → finish_back → print_back → finish_front → print_front**, each `x = ceil(x + x·pct/100 + setup)` (`calWastePrice`, `helpers.php:903-907`) from the band `min_paper_sheet_amount ≤ x ≤ max` of `diecut_wastes` (by die-cut type), `finish_wastes` (finish ignored), `print_wastes` (colour ignored). Setup waste: always when `calculate_waste_type == 1`; when `== 2` only for the **first true process flag** (`checkSetupWaste:986-993`). `waste.total = x`; `paper sheets = ceil(x / paper_sheet_cut)`; `paper_size_price = cost_per_kg · gsm · in_w · in_l / (100·100·1000/(2.54·2.54))`; `paper.total = sheets × paper_size_price` (`helpers.php:1076-1194`).

### 2.5 Cost — `calculateCost:1009-1319`
**Offset** (print type 3, `:1013-1079`): `printCost:1321-1603` — plates fitting the sheet (without edge, inches) × colours; per colour band row: standard colours with ≥ 4 colours use the 4-colour flat price on the 4th (`flat + flat_per_pcs × waste`), others `per_sheet + per_pcs × waste`, plus `combine_special` and `operation_cost`; cheapest plate. `diecutCost:1605-1694` — block (`diecut_price + per_drawing × layout`) fitting the sheet and lay-out, price `diecut_price + waste × per_sheet`, cheapest machine. `finishCost:1696-1924` — `max(area_in2 × by_area × waste, min_price, waste × per_sheet) + tooling + area_in2 × block_per_in2 (+ half die block when `diecut_window_price`)`. `cost.total = paper + print front/back + finish front/back + diecut`.
**Digital** (4 / 7 / 8, `:1081-1274`): sheets — `paper = cost_per_m2 · m²(sheet) · waste.total`; print `Σ price_ink_per_m2 (distinct colours, band on waste) · m²(sheet) · waste`; finish `in² × by_area × waste`; die-cut row by type and band on `waste.total`: `diecut_price` if > 0, else `qty · per_m2 · m²(sheet) / layout`. Rolls — `area_m2 = areaL · in_w·25.4 / 1e6`; paper `cost_per_m2 · area_m2`; print `Σ price_roll_per_m2 · area_m2`; finish `area_m2 · 1550.0031 · by_area`; die-cut row by **quantity** band: `diecut_price` if > 0, else `qty·per_m2·area_m2/layout + block.diecut_price`.
**Factory margin** (`:1275-1300`): `sale = cost / (1 − pct/100)`; `suggest = round(sale/qty, 2)` (string, `convertNumberFloat`); `sale_price = suggest × qty`.
**Order** (`:1304-1316`): by `cost.total`, then layout desc, standard first (offset adds grain, plate and block sizes).

### 2.6 Sell side — `calculate:451-643` (CS)
Drop rolls (not roll-to-sheet) shorter than **300 m** (`areaL · 0.001 < 300`, `:456-458`). Packio margin tier `locopack_margins` by quantity and sale price (half-open `max_price >`), base tier at (1, 1); manual `target_margin`; `fix_cost` from input or `fmpt.locopack_fix_cost` → shared `Calculator::SaleMargin:223-450` with packaging 2 (graphic fee `SALE_MARGIN_GRAPHIC_DESIGN_FEE_LABEL`, label shipping). Lead time `getCustomLeadTime` (factory 16: 10 days from 500 pieces) else `ceil(lead_time)` (`:555-556`). Option = the first surviving layout (`:639`).

## 3. Live / dead code
Dead or unreachable: `setData` in the API controller; `diecutCost` / `printCost` else branches (Collections are never empty); `calculateCost` margin id 3 overwrite (`:1285`); unused trims (`:666-677`); overlap / combine lay-outs (`c = 0`); `finish2`, `assembly`, grain, `print_*.percent`, margin ids 0 / 3 (factory tool only); digital assembly (`AssemblyPrice` model does not exist); `diecut.blockPrice` never written (L14); `calculatePercentReduce` not used; `custom_cost`, promotions, order hierarchies (not pricing maths).

## 4. Data read (→ Packio source)
| Legacy | Packio |
|---|---|
| `paper` (`paper_type_id`, gsm, `cost_per_kg`, `cost_per_m2`) | catalogue `materials` (label paper, gsm) + `material_prices` (`costPerKg`, `costPerM2`) |
| `paper_sizes` ⨝ `paper_sheets` (`in_w`, `in_l` 0 = roll, `paper_sheet_cut`, `sheet_cut_length_inch`) | `paper_sizes` + **`label_paper_sheets`** (adds the roll-to-sheet cut length) |
| `paper_trim` | `paper_trims` |
| `difficult_level` (group → id) | catalogue `difficulty_levels` (direct id) |
| `color` (group → id, `color_type`) | catalogue `ink_colours` + `ink_colours` component (`isStandard`) |
| `finish` (group, `finish_type`, `diecut_window_price`) | catalogue `finishes` + `finish_prices.addsDiecutWindow` |
| `diecut_type` (group) | catalogue `diecut_types` |
| `diecut_wastes`, `finish_wastes`, `print_wastes` | same components |
| `print_plate` | `print_plates` |
| `print_prices` (offset columns, `price_ink_thb_per_m2`) | `print_prices`; **`label_roll_print_prices`** (`price_roll_thb_per_m2`) |
| `finish_price` | `finish_prices` |
| `diecut_price` (by type for digital; `per_m2`) | **`label_diecut_prices`** |
| `diecut_block_price` | `diecut_block_prices` |
| `factory_match_print_type` (`margin`, `min_order_amount`, `min_sheet_per_job`, `lead_time`, `locopack_*`), `factory.calculate_waste_type`, factory 13/14 no die-cut, factory 16 bulk lead time | **`label_print_type_terms`** |
| `locopack_margins`, `SALE_MARGIN_*` env | shared sell side (sell margins, settings) |
| `fixed_options` (pattern 18, coating) | catalogue product fixed inputs (as corrugate C9) |

## 5. Quirks and how the port treats them
| # | Legacy behaviour (file:line) | Port |
|---|---|---|
| L1 | `paper_type_id` re-converted inside the quantity loop (`:400`): 2nd quantity priced on the wrong paper or throws; a cheaper wrong-paper result can replace the right one | every quantity priced on the requested material |
| L2 | Offset (print type 3) always throws: `cost.finish_front/back` undefined unless both finishes are on (`:1065-1073`); `print_back.amount` read when unchecked (`:1394`); the offset branch also passes one lay-out row through list code (`groupArrayByKey((array) $tempLayouts…)`, `:1027-1030`) | **not priced** (`process_not_possible`): porting would invent numbers no one ever saw; the business decides at sign-off |
| L3 | Minimum order per quantity, but `calculate` prices all quantities (`:394-406`) | the minimum applies to each quantity (refused step) |
| L4 | CS keeps per factory the cheapest **factory cost**; SME the cheapest per piece | one option per factory × print type; the quote engine ranks (D-043, D-101) |
| L5 | SME reports the **last** print type iterated; `cs_data` appended on every improvement (`:117,164`) | the option's own print type |
| L6 | SME `waste.total` on a roll row → throws (`:103`) | rolls have no sheet waste; the minimum-sheets rule applies to sheets |
| L7 | Factories 13 / 14 never die-cut (`:277`, priced without the die-cut process); gloss / matt only for factories 3/6/10/11/PFO (`Converter.php:256-270`) | term `diecutAvailable` (false = priced without the die-cut process, as legacy); finishes priced only where the factory has a finish price line (no price line → `price_line_missing`) |
| L8 | `edge_trim` inches for rolls, mm for sheets (`:672,675-685`, `helpers.php:753`) | kept (same numbers), flagged |
| L9 | Rotated roll-to-sheet corrects with `(dl+gap)` instead of `(dw+gap)` (`helpers.php:796-799`) | kept (same numbers), flagged |
| L10 | Roll-to-sheet lay-out = number of sheets (float); `layLcut = 0` divides by zero | kept; `layLcut = 0` → the sheet is skipped |
| L11 | Offset 4-colour rule counts special colours in `amount >= 4`; per-colour rows matched with `percent_color` NULL / 0 | kept (same numbers), flagged |
| L12 | String-concatenated `usort` comparator (`:1304-1316`) | explicit order: cost, layout desc, the rotated lay-out first (`a.layout_standard <=> b`), stable on the sheet order (as folding Q10) |
| L13 | Short rolls unset then partly re-created (`:456-457,541,595`) | short rolls dropped |
| L14 | `diecut.blockPrice` never written: `summary.diecut_block = 0`, finish half-block 0 | kept (same numbers): no half-block, no tooling line |
| L15 | Digital print sums **distinct** price rows (repeated colours priced once); missing print row → 0, missing finish / die-cut row → throws, missing waste band → 0 waste | distinct colours kept (flagged); a missing price row → not priced (`price_line_missing`), as folding Q14; a missing waste band → 0 waste (parity) |
| L16 | Lookups ignore schema keys (finish waste by finish, print waste by colour, die-cut by type on offset / roll); `first()` without ORDER BY | same keys ignored (same numbers); explicit order (price-list line order) |
| L17 | 4-colour offset row taken without the `percent_color` filter | kept |
| L18 | No sheet fits → throws; other patterns → division by zero | `geometry_no_layout` / the label pattern only |
| L19 | `fromOrder` and `storev2` broken for labels | not ported (orders re-price through the quote engine) |
| L20 | `selectedFactory` / `custom_cost` with `!==` | not ported (CS picks the option in the response) |
| L21 | Missing base tier with a price tier → throws; half-open price bound | shared sell side, half-open bound (as folding) |
| L22 | Shipping: face area × gsm (no liner / core); rolls one 56 × 13 × 11 cm carton; no carrier → throws | the label packer ports the weight and cartons; delivery from the B2.4 rate cards, its own line (D-013) |
| L23 | Setup waste on the first **process flag**, not the first waste step (`:986-993`) | kept (same numbers), flagged |
| L24 | `convertNumberFloat` rounds the factory per-piece price to 2 decimals before × qty and the sell side | kept |

## 6. Port
- Slice 2: price components (`src/modules/pricing/calculators/label/price-components.ts`, migration A-71).
- Slices 3–4: `layout.ts` (`labelLayouts` on the shared `calLayoutAmount` — its roll and roll-to-sheet branches checked line by line against `helpers.php:745-857`; `labelWaste`), `digital.ts` (`labelDigitalCost`), `label-calculator.ts` (options, minimum order, colours, die-cut availability, short rolls, factory margin, shared `SaleMargin` with the half-open tier, lead time). Golden cases: `test/golden/label/cases.py` → `golden.json` with the expected values from `reference/label_reference.py` (an independent Python transcription of the PHP); `test/unit/label-golden.spec.ts` compares every number within 1e-6 and writes `docs/pricing-validation-label.md`.
- Slices 5–6: `label-snapshot.loader.ts` (configuration → catalogue ids; per price-list version one option per label print type; sheets = the material's paper sizes × `label_paper_sheets`), `label.adapter.ts` (quote engine; parts report the lay-out, press sheets or metres of roll, the blank area), `shipping/packing/label-packing.ts` (`calCostLabel_WithShipping:158-290` up to cartons: face × gsm weight, 0.5 mm per label on the 60 cm grid, the 56 × 13 × 11 cm roll carton; the quote packs sheets of labels), `admin.csLabel.*`, `partner.pricingLabel.calculate`, dev fixture `prisma/seed/dev-label.ts`.
- Slice 7: `docs/pricing-validation-label.md` generated, `label` in `SHIPPED_CALCULATORS`; the `label_sticker` type stays seeded `rfq` (A-16) until the business signs off the cases and the launch factory's label price list.
