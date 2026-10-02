# Folding engine B — legacy port map (U-B6 tail)

> Reference for porting legacy folding **engine B** (type-2 factories). **Legacy is read-only and never run** (D-005).
> Source: `/Users/superball/Abbon/Loco_Pack/locopack-web` (same `app/` as `Packio-Web/legacy/locopack-web/app`); paths are relative to it. Traced 2026-10-02; every formula is re-read in the PHP when it is ported (slice 3).
> Engine A (offset, digital), the geometry and the sell side are in `docs/legacy/05-folding-port-map.md`; this document covers only what B does differently. Decision: **D-233**.

## 1. Reachability and dispatch
No live legacy screen reaches B. The B Vue form (`resources/js/components/folding/b/CalFoldingTemplateB.vue`) is mounted only by `resources/views/folding/b/calculate_folding_box.blade.php:62`, rendered only by `FoldingBoxController@calculateFoldingBox:129` — unreachable after the unconditional `return` at `:120` — and by the unrouted `Api/Folding/FoldingBoxController@calculateFoldingBox:34`. CS, SME and the factory tool select factories through `FoldingCalculator::getFactories:410-424` (`factory.factory_type_id = 1`); the only seeder creates a type-1 factory (`database/seeds/PffOssetFactorySeeder.php:50`).

| Route | Controller | Reaches B |
|---|---|---|
| `POST /api/folding/calculate` (`routes/api.php:560`, outside `auth:api`, which closes at `:552`) | `Api/FoldingBoxController@submitForm:157` → `FoldingCalculator::calculate:1293` | given a type-2 `factory_id` (waste `:1333`, cost `:1352`); no live caller |
| `POST /calculate-folding-box-ajax` (`routes/web.php:766`) | `FoldingBoxController@calculateFoldingBoxAjax:150` (waste `:195`, cost `:216`) | factory user of a type-2 factory; every Vue caller is unmounted |
| `POST /api/calculate-folding-box-ajax` (`routes/api.php:502`) | `Api/Folding/FoldingBoxController@calculateFoldingBoxAjax:49` (waste `:94`, cost `:115`) | any `factory_id` sent; no live caller |

Dispatch (identical at `FoldingCalculator.php:1304-1355`, `FoldingBoxController.php:179-219`, `Api/Folding/FoldingBoxController.php:77-118`): `factory_type_id == 1` → A waste + A cost (offset or digital by print type) with `useMaxMinPaperTrim`; `== 2` → `B\CalculateWaste` + `B\CalculateCost` with the plain paper trim. B never reads `calculate_waste_type` or `finish2_step_down_waste` (only `A/CalculateWaste.php:780,822,840` do). The production minimum (`min_order_for_production`) raises the run as for A (`:1308-1318`).

Packio: `pl_print_type_terms.engine_variant = 'b'` (A-26) is the dispatch; `useMaxMinPaperTrim: engine !== 'b'` is already in `folding-snapshot.loader.ts`.

## 2. Live / dead files
| Status | Files |
|---|---|
| Live, B | `B/CalculateWaste`, `B/CalculateCost`, `Process/{Printing,Finishing,Diecut,Sorting}`, `Object/{Foil,Point,Rectangle}`; `Object/{Layout,Margin}` (B fills `axisFoil`, `totalCostFoil`, `finish2[k].foil`) |
| Dead | `Process/Assembly` (only the uninstantiated root `CalculateWaste.php:188` uses it); `B/CalculateWaste` `validObjPrepareRequest:629`, `getFinish1FrontWaste/BackWaste`, `getAmountSemiF/B`; `B/CalculateCost` `use Object\CostPrint`, placeholders `:14-18,28`, `validObjPrepareRequest:1882`, commented `initCostAssembly:1320-1356`, `validLayouts:52-58` (cannot fail), sale / suggest price in `calMargin:1807-1813` (overwritten); `Object/Foil` `calWidthFoilAllBackup:387-479`, `setLineAmount`, `getC:527`/`getCd:547`; `Process/Printing` `$print[]:84-91`; helpers `calPrintSemiWastePrice:910`, `calPrintPrice:917`, `calMargin:1345` |

Live helpers used by B besides engine A's: `calTotalWaste:951`, `calPacking:1338`, `calSortingCost:1294`.

## 3. Request (`PrepareRequest.php`) — what B reads beyond A
- Print (`:166-232`): `color_amount = front/backPrintColorAmount`; `print_amount = array_count_values(colorId)`; semi-tones: for every non-empty `amountAW[i]`, `print_amount[colorId[i]] += AW_i − 1` (extra plates) and `amount_semi_color = Σ AW`. B ignores `percentColor*` (A's coverage).
- F2 (`:248-270`), foil (`:332-349`, `setFoil:404-437`): per F2 position `p`, `foil[p][i] = {x, y, width, length}` mm for `i < finishing2AmountLocation[p][0]`.
- Sorting `isSorting` (`:284`), packing `packingTypeId[] / packingAmount[]` (`:302-309`), margin `marginComputeId / codeMarginId / percentContribution / suggestPrice` (`:311-327`), `distance`, `foilAxis` (`''` = automatic).

## 4. Waste — `B/CalculateWaste::calculate:304` → `calWasteData:318`
`P` = net press sheets of the layout. Every waste is taken on the same `P` (**no cascade**, unlike A), and every lookup takes the first row with no band (`print_type` sent only for F2 and assembly).

| Process | Data | Formula |
|---|---|---|
| Print side | one `print_wastes` row by factory, difficulty, the **last distinct colour id** and the colour count (`Process/Printing.php:84-98`, `getPrintWasteData:137-170`); only if `count(colorId) == colorAmount` (`:48`) | `⌈⌈P·pct/100 + setup⌉⌉` (`calPrintWaste:580-585`) |
| Semi side | `semi_plate_waste.setup_waste_per_aw` by factory, difficulty (`Printing.php:57-80,172-203`) | `⌈setup_waste_per_aw × Σ AW⌉` (`:594-611`) |
| F1 side | `finish_wastes` by finish, factory, difficulty (`Process/Finishing.php:42-82`) | `⌈P·pct/100 + setup⌉` (`calFinish1Waste:533-555`) |
| F2 *k* | `finish_wastes` by factory, difficulty, print type; first row per finish id (`initFinish2Waste:182-207`) | `⌈P·pct/100 + setup⌉` (`calFinish2Waste:557-572`) |
| Die-cut | `diecut_wastes` by die-cut type, factory, difficulty (`Process/Diecut.php:42-105`) | `⌈P·pct/100 + setup⌉` (`calDiecutWaste:521-531`) |
| Assembly *k* | `assembly_wastes` by factory, difficulty, print type; first row per id (`initAssemblyWaste:257-280`); `skip_waste` ignored | `⌈P·pct/100 + setup⌉` (`calAssemblyWaste:502-519`) |
| Sorting | `sortings` by factory, difficulty (`Process/Sorting.php:42-96`) | `⌈P·pct/100⌉` (`calSortingWaste:489-500`) |

Total `T = P + Σ wastes` (`calTotalWaste`, `helpers.php:951-1010`); paper size waste / price / cost as A (`calTotalWastePaperSize`, `calPricePaperSizeBahtPerSheet`, `calCostPaperSize`, already ported in `a/waste.ts`). Sheets entering each process (`:405-476`, forward subtraction, `abs`): print front `T`; print back `T − front − frontSemi`; F1 front `… − back − backSemi`; F1 back `… − F1F`; F2 `… − F1B`; die-cut `… − ΣF2`; assembly `… − diecut`; sorting `… − Σassembly`.

## 5. Cost — `B/CalculateCost::calculate:60`
Units per layout: `areaMM2 = areaW·areaL/1e6` (m² of the print area, `calPrintArea`), `areaInch2 = areaMM2 × 1550`, `areaF1 = sheetW_in × sheetL_in` (cut sheet without edge, in²), `areaM2 = areaF1 × 0.00064516`.

1. **Print** (`calCostPrint:319-445`): a layout copy per fitting plate row (`paperSheetIsAvailableBlock:302-317`, as A's `fits`). `plate = Σ print_amount × print_plate_price`; `print = Σ_rows(machine = plate machine) areaMM2 × price_ink_thb_per_m2 × sheets_side`; `combine = Σ price_color_combine_special_color`; price rows looked up per distinct colour with the count of that colour (`calPrintPriceCost:1524`).
2. **Die-cut** (`calCostDiecut:447-503`): `areaM2 × diecut_price × sheets_diecut` + a flat `blockPrice` per fitting block row (one layout copy each).
3. **F1** (`calCostFinish:602-650`): `max(areaF1 × by_area × sheets, min_price) + tooling + block`, block `× areaF1` on the front, **flat on the back** (QB16).
4. **F2 non-foil** (`:755-796`): `area = areaF1`, or `(w/25.4)(l/25.4)` when the finish requires width and length and `required_location == 0`; `amount = 1`, or the F2 amount when it requires an amount and `required_location == 0`; `total = tooling + material_thb_in2 + block_per_in2 + max(area × by_area × sheets_F2 × amount, min_price)` (material and block **flat**, QB17); `sheets_F2 = |sheets_F2_entry − Σ earlier F2 waste|`.
5. **F2 foil** (`:797-989`): block fit `min/max_block_w/l_inch` against the sheet; `wage = by_area × areaInch2`; `foilPerM2 = baht_per_roll / (roll_w_in·0.0254 · roll_l_in·0.0254)`; per axis `ax ∈ {md, cd}`: `max((wage + foilPerM2 × area_ax) × sheets_F2, baht_per_roll + wage × sheets_F2) + tooling`; axis = `foilAxis`, else fewer total lines, tie → cheaper, full tie → `cd` (`:838-873`); `totalCostFoil = Σ` chosen-axis totals (`:995-1057`).
6. **Assembly** (`calCostAssembly:1085-1245`, rows by quantity band `range_amount_min/max`): `amount` = run (or the assembly amount when required); type 1 `amount × price_per_depth_m × dw·0.001`, total `+ block + material_price_per_in2 × (dw/25.4)²`; type 2 `amount × min_price_per_area_in2 × (w/25.4)(l/25.4)` + block; types 3 = 4 `amount × price_per_pcs` + block; each `max(price, min_price)`.
7. Packing (`:505-535`), delivery (`:537-557`), sorting (`:559-582`) — not reached by Packio (§7).
8. **Total** (`:234-256`): paper + print F/B + F1 F/B + ΣF2 + Σassembly + die-cut (+ sort + packing + delivery).
9. **Margin** (`calMargin:1780-1836` → `Object/Margin::calculate:65-110`): type 2 looks up the smallest `code_margin.max_range_cont > percentContribution` (`initMargin:1258-1282`); `contribution = total/(1 − pct/100) − total`; `salePrice = total + max(min_cont_baht_per_lot, contribution)`; `suggestPrice = convertNumberFloat(salePrice / qty)`. Types 1 (code chosen by the user) and 3 (from a suggested price) are factory-tool features.
10. **Sort** (`:271-298`): A's keys (`A/CalculateCost.php:313-329`).

## 6. Foil geometry (`Object/Foil`, `Point`, `Rectangle`)
A rect `{x, y, width, length}` (mm on the blank, x from the left, y from the top) grows by `trim_foil_mm` (`Point:34-86`). `calWidthFoilAll:72-158` merges strictly overlapping rects along x and along y into strips (`Rectangle::checkRectangleOverlapX/Y:5-79`); `calAreaFoilAll:160-380` turns strips into m² per sheet per axis (standard / rotated layout, `c` subtracted on dw runs only); line counts per axis (`B/CalculateCost.php:689-700`). With **one** rect each axis gets one strip of spans `length + 2t` and `width + 2t`, so x and y do not change the cost; with two or more, x and y decide the merging.

## 7. Packio treatment (D-233)
**Inputs** (`FoldingConfiguration` → B request):
| Legacy input | Packio |
|---|---|
| `printColorAmount` | number of colours of the side |
| `amountAW` (semi-tones) | none (legacy default when unticked) → no extra plates, no semi waste; no `pl_semi_plate_wastes` |
| foil `x/y/width/length` | one location per foil F2 → `{x: 0, y: 0, width: w, length: l}`; 2+ locations, or a foil F2 without a size → option refused (`process_not_possible`; legacy priced a foil without coordinates at 0, QB21) |
| `foilAxis` | automatic |
| `isSorting`, packing, `distance` | none — sorting / packing / delivery cost 0 (delivery is its own line, D-013) |
| margin | type 2 at `pl_print_type_terms.factory_margin_pct`, code margin from `pl_code_margins` |
| non-foil F2 `w/l/amount` | equal sizes → that size × amount; unequal → Σ areas (generalisation, documented) |
| `required_location` | `pl_finish_prices.required_location` (per factory finish line) |

**Quirks**:
| # | Legacy | Packio |
|---|---|---|
| QB1 | colour count ≠ colour ids → print waste silently 0 (`Printing.php:48`) | cannot happen (count derived) |
| QB2 | print waste keyed by the last distinct colour + total count (`Printing.php:84-98`) | **ported** (one lookup per side, last distinct colour in input order) |
| QB3 | missing print / semi / die-cut waste aborts; F1 / F2 / assembly / sorting waste missing → none | missing waste → no waste + `missingBands` (as A, Q16) |
| QB4, QB5 | waste not banded, first row without ORDER BY | B waste lines carry no band; one line per dimension set (line key) |
| QB6 | most reads ignore the print type | read from the option's print type (one price list per factory × type, rows per print type) |
| QB7 | die-cut blocks not filtered by die-cut type | ported (blocks per difficulty, as A's `pl_diecut_block_prices`) |
| QB8 | duplicate price rows summed | impossible: one line per dimension set |
| QB9–QB11, QB14, QB21 | missing plates / die-cut / F2 price / foil coordinates → free; F2 without any price row drops every layout | `price_line_missing` (Q16) |
| QB12, QB13 | F2 / assembly waste compacted; repeated finish reads the first position | kept by position (Q17) |
| QB15 | the last foil's block fit decides for all | every foil must fit, else the layout is dropped |
| QB16, QB17 | F1 back block flat; F2 material and block flat | **ported**, flagged in the validation doc |
| QB18 | `@` hides INF / NAN for zero roll sizes | roll sizes > 0 enforced by the price-line validator |
| QB19 | forced axis shows the opposite label | no forced axis in Packio |
| QB20 | foil geometry failure `dd()` | `GeometryError` refusal |
| QB22, QB23 | y-sort secondary key; strict overlap | ported (numerically harmless / exact) |
| QB24 | per-layout totals not reset | computed per layout (Q18) |
| QB26 | no code margin row → sale price 0 | `price_line_missing` (`code_margins`) |
| QB27, QB28 | dead sale price; type 3 per-piece base | type 2 only |
| QB29–QB32 | packing / delivery / sorting aborts and undeclared property | not reached (inputs none) |
| QB31 | assembly types 3 and 4 identical; `totalCost` unfloored | ported (sum uses the floored total) |
| QB34 | 30-min caches | none: pure function of the snapshot (Q9) |
| QB35 | — | no hard-coded factory ids in B |
| QB41 | unauthenticated E1 with any factory | n/a: Packio prices only the configuration's candidate factories |

**Data** (new or extended `pl_*`, migration in slice 2):
| Legacy | Packio |
|---|---|
| `print_wastes` by colour id + count | `pl_print_wastes` + nullable `ink_colour_id`, `colour_count` (B lines; A lines leave them null) |
| `print_prices` by colour + count of that colour, `price_ink_thb_per_m2`, `price_color_combine_special_color` | `pl_print_prices` + nullable `colour_count` |
| `finish_price.finish_price_baht_per_roll`, `finish.{width,length}_of_roll_foil_inch`, `min/max_block_w/l_inch`, `required_location` | `pl_finish_prices` + nullable foil roll and block columns, `required_location` |
| `assembly_prices.price_per_depth_m`, `min_price_per_area_in2` | `pl_assembly_prices` + nullable columns |
| `code_margin` (`max_range_cont`, `percent_cont`, `min_cont_baht_per_lot`) | new `pl_code_margins` |
| `semi_plate_waste`, `sorting`, `packing_price`, `delivery_cost` | not created (inputs none, D-233) |

**Gate**: feature flag `pricing.folding_engine_b` (off): customer and CS quotes refuse B options; staff and factory breakdowns price them. Tags & sleeves keep refusing B.
