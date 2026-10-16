# Pouch calculator — legacy port map (U-B6, B2.3 Deliverable 2.3)

> Reference for porting the legacy pouch calculator. **Legacy is read-only and never run** (D-005). Treatment follows the
> folding / corrugate / label rule (user decision 2026-09-26): **maths ported exactly, orchestration and state bugs fixed
> and listed as deviations** in `docs/pricing-validation-pouch.md`. §9 records how getpack ports it.

> Source: `/Users/superball/Collective/getpack/Getpack-API/legacy/locopack-web`. All paths below are relative to it unless they start with `docs/` or `test/` (those are relative to `Getpack-API`). Traced read-only on 2026-10-01.
> Packaging type **6** = `pouch` ("ซอง", `config/locopack.php:11`). Main class `app/Models/PouchCalculator.php` (724 lines).
> Runtime: Laravel 5.7, PHP 7.1, `error_reporting(-1)`. Any notice ("Undefined index/variable/offset", "property of non-object", "Division by zero", "non well formed numeric") **throws**.

---

## 0. Main finding

**Pouch has its own maths and delegates nothing.** It does not touch `FoldingCalculator`, the folding libraries or `Calculator::SaleMargin`. The whole engine is in `PouchCalculator`:
- geometry: `calculateDimension:557-581`
- minimum order: `recheckMinAmount:583-594`
- film on the roll: `calculate:482-487`
- material: `calculatePaperPrice:596-605`
- printing: `calculatePrinting:607-614`
- options and processes: `calculateAssembly:616-661`
- factory margin: `calculateCost:663-671`
- getpack margin and VAT: `calculateMargin:673-688`
- delivery: `calculateDeliveryPrice:690-723` → `ShippingUtils::calShippingCostPouch` (`app/Libraries/Shipping/ShippingUtils.php:710-788`)

**One engine, one print type.**
- Print types come from `print_type.packaging_type_id = 6` (`getPrintTypes:77-87`). In practice that is print type **10**: the CS input data hard-codes `color.print_type_id = '10'` and `assembly print_type_id = 10` (`Http/Controllers/PouchController.php:34,39`), and the seeds use it (`database/seeds/ImportKponFactory.php:34`).
- The colour groups 11–17 are "digital": "ไม่พิมพ์" (no print), "4 สี CMYK digital (พิมพ์เงา)", "+OPV (matt)", 5-colour, 6–8-colour (`database/seeds/UpdateKPONFactory.php:37-53`).
- So the only process is roll-fed **digital** printing. Print is priced per cm² of printed web. There is no gravure, flexo, cylinder, plate or per-colour setup cost.
- **Lamination is not a separate layer cost.** A material row (`paper`) is a ready laminate priced per cm² (e.g. "PET12mi/MPET12mi/LLDPE" 80 / 100 micron). The only lamination-like cost is the fixed process "ค่า drye" (group 36). Its formula `4 × 0.8 × run metres` reads as a dry-lamination charge of a 0.8 m web at 4 THB/m².
- Factories in the seeds: **KPON** (`KPO`, zip 74000, created by `ImportKponFactory`, tuned by `UpdateKPONFactory`, tickets LOC-2346 / LOC-2416) and **TNP** (factory 21, `UpdateKPONFactory.php:17,59-62,70,74,78,82`).

**Tables read:**
- `factory_match_packaging`, `factory`, `factory_match_print_type`, `print_type`
- `pattern` (40–44), `mapping_inputs`
- `paper`, `paper_types`, `color`, `color_groups`
- `assembly`, `assembly_groups`, `assembly_prices`
- `production_conditions` (type 1 = allowed options, type 2 = minimum quantity by area)
- `factory_margins`, `locopack_margins`
- `promotions`, `images`, `zipcodes_delivery_zone`, `users` (customer API only)
- the carrier rate tables behind `ShippingUtils` (shared)

Details in §4.

---

## 1. Entry points

| Route | Controller → calculator | Caller | Status |
|---|---|---|---|
| `GET cs/pouch` (`routes/web.php:838`) | `PouchController@cs:11-13` → view `pouch/cs.blade.php` (`<pouch-cs>`) | menu `layouts/menu.blade.php:92` (shown to CS/admin, `:78`) | **live** |
| `GET cs/pouch/get-input-data` (`web.php:839`) | `PouchController@getInputData:15-59`: patterns (`pattern` packaging 6, `pattern_status 1`), materials + microns, colour groups (print type 10), assembly groups (print type 10, `status 1`, so 36/37 are hidden), `getFactories()`, active promotions, user, print types of packaging 6, designer types, `DESIGN_COST_FOR_POUCH` | `pouch/cs.vue:820`, `form-edit-input/pouch.vue:831` | **live** |
| `GET cs/pouch/get-microns` (`web.php:840`) | `PouchController@getMicrons`, **method does not exist** (the controller has only `cs`, `getInputData`, `getActiveAssemblies`, `calculate`) | nobody | **broken** (BadMethodCallException); unused |
| `GET cs/pouch/get-active-assemblies` (`web.php:841`) | `PouchController@getActiveAssemblies:61-65` → `PouchCalculator::getActiveAssemblies:27-53` (hard-coded rules) | not called by any Vue | **dead** |
| `POST cs/pouch` (`web.php:842`) | `PouchController@calculate:67-77` → `fromCS($request->all())`; returns `result`, `errors`, `img_url`, `img_path` | `pouch/cs.vue:1015` | **live CS calculator** |
| `GET cs/change-factory/pouch/{order}` (`web.php:898`) + `POST cs/change-factory/{order}` (`web.php:899`) | `ChangeFactoryController@index:22-38`, `@changeData:40-…`, pouch case `:72-75` → `fromCS($request->input())`; takes `$calculated['result'][0]` (`:98-99`) | `change_factory/form_change_factory.blade.php:45-53` → `form-edit-input/pouch.vue:1032` | **live**, but throws when no option is priced (P27) |
| `GET /api/pouch/get-input-data` (`routes/api.php:229`, public) | `Api/PouchController@getInputData:68-80`: SME patterns (`mapping_inputs` type 1), materials (type 2) with `getMicrons(sub_id, show_in_web=1)`, spouts (type 5) | customer web (separate front end, not in this repo) | **live** |
| `GET /api/pouch/{id}` (`api.php:230`, public) | `Api/PouchController@show:12-66`: size limits in **cm** (`/10`), `required_b/s`, allowed special technics per material from `production_conditions` type 1, `spout` flag | customer web | **live** |
| `POST /api/pouch/calculate` (`api.php:231`, public, no auth) | `Api/PouchController@calculate:82-105` → `fromSME()` **twice** (`:85` and `:99`; the reward-point discount applied to the first result is thrown away) | customer web | **live customer quote** |
| `POST /api/orders-v2` (`api.php:327`, auth) | `OrderAPIController@storev2:1454-…`: `packagingModelName(6)` = `PouchCalculator` (`helpers.php:2254-2255`), `fromSME($request->input, true)` (`:1485`), `$calculated[$request->selected_key]` (`:1486`), stores products and hierarchies from the re-priced option | customer web checkout | **live customer order** |
| `POST /api/orders` (resource `store`, `api.php:326`) | `OrderAPIController@store:929-1452`: for 6 sets `pattern_id = mapping_pattern_id` and `SMEtoCS` → `PouchCalculator::ConvertSMEDataToCS` (`:1070-1073`, `Converter.php:35-37`). **No calculator branch for 6** (`:1074-1086`), so `$calculated` is undefined at `:1098`. Caught at `:1447` → HTTP 500. The pouch blocks at `:1148-1162` and `:1240-…` are unreachable | old order flow | **broken** (always fails for pouch) |
| `POST /api/order/{id}/re-production` (`api.php:512`) | `OrderAPIController@reProduction:3528` → `Order::getCSInput` (`Models/Order.php:971-1118`) → `PouchCalculator::fromOrder:98-142` | customer re-order | **broken** (P25) |
| `POST /api/products` (`api.php:272`) | `ProductAPIController@store:355-409` → `Calculator::FromSME:28-221`: `validateInput` rejects pouch (no `h`, P26). If it passed there is no pouch branch (`:54-66`), so `$calculated` is undefined → caught (`:215-217`) | admin sample-product builder `components/product/main.vue:27` → `product/pouch.vue:166` (which even loads special technics with `packaging_type_id: 1`, `:150`) | **broken / dead** for pouch |
| `POST /api/validate-input` (`api.php:273`) | `Calculator::validateInput:471-517` | — | always rejects pouch (P26) |
| `POST orders` (web, CS create order) / `POST orders/{id}/edit` | consume `products` + `order_hierarchies` built by `fromCS` (`plugin-boxes/create-order.vue:1263`, `pouch/cs.vue:946`); **no re-pricing** | CS | live (order ops, not pricing) |
| CalFlex (`ShowCalFlexController`, `calflexresult.blade.php:977-995`, "Pouch MC" costing via external `GetFlexCal` API) | routes commented out (`web.php:942-949`) | — | **dead**, external, not ported |
| Factory tool | none. Note: the CS routes sit in the `web.factory` group (`web.php:760-900`, `WebFactory.php:20`: factory **or admin** user; CS-type users (`Users::CS_TYPE = 0`) get 403 although the menu shows them the link) | — | getpack adds a partner price check as for the other calculators |

Cross-check: `docs/legacy/04-legacy-routes.txt:237-241,280,413-415` list the same routes.

---

## 2. Pipeline

### 2.0 Inputs and units (all sizes in the calculator are **mm**)

**CS payload** (`pouch/cs.vue:749-790`, sent as `this.form` at `:1015`):
- `pattern_id` (40–44)
- `w`, `l` (mm, labels "ความกว้าง" / "ความสูง", width and height including seals)
- `b` (bottom gusset incl. seal), `s` (side gusset incl. seal), `cs` (centre seal). Defaults w 140, l 200, b 60, s 60, cs 10.
- `amount` (default 3000, free text)
- `paper_type_id` + `micron` (micron reset to 80 on material change, `:996`)
- `color_id` (= colour **group**, default 11 "no print", `:826`)
- `assemblies[]` (assembly **group** ids, default `[33]`, V-Cut per the seed)
- `zipcode` (default 10900), `selected_factory`
- `design {type 0 template | 1 design online | 2 hire | 3 free, price, designer_type}`
- `promotion {type 0|1 code|2 manual discount, code, discount}` (initial key misspelt `diecount`, `:771`)
- `fix_margin {fix, margin, fix_cost}`
- `fix_delivery {fix, delivery_cost, amount_of_shipping_box, delivery_by}`
- `custom_cost {custom, print_type_id, factory_id, cost_per_pcs}`
- `mockup_type_id`, `mockup_amount` (`:1013-1014`; the mockup selector is commented out, `:241-243`)

**SME payload** (customer web → `ConvertSMEDataToCS:196-257`):

```php
'w' => $sme_input['w'] * 10,
'l' => $sme_input['l'] * 10,
'color_id' => 12,
'amount' => $sme_input['amount'],
'zipcode' => $sme_input['zipcode'],
...
$pattern = \App\Models\MappingInput::find($sme_input['pattern_id']);
$result['pattern_id'] = $pattern->sub_id;
...
if ($pattern_data->required_b == 1) { $result['b'] = $sme_input['b'] * 10; ... }
if ($pattern_data->required_s == 1) { $result['s'] = $sme_input['s'] * 10; ... }
if ($pattern_data->required_cs == 1) { $result['cs'] = 10; ... }
$material = \App\Models\MappingInput::find($sme_input['material_id']);
$result['paper_type_id'] = $material->sub_id;
$result['micron'] = $sme_input['micron'];
$sme_input['special_technic_id'][] = 93;
... $assemblies[] = $special_technic->sub_id;   // mapping type 4 → assembly group
if (!empty($sme_input['spout'])) { ... $assemblies[] = $spout->sub_id; } // mapping type 5
...
$result['design'] = [
    'designer_type' => config('locopack.designer_types.designer'),
    'type' => !empty($sme_input['is_brief_design']) ? 2 : 0,
    'price' => empty(env('DESIGN_COST_FOR_POUCH')) ? (float) config('aws_secrets.secrets.DESIGN_COST_FOR_POUCH') : (float) env('DESIGN_COST_FOR_POUCH')
];
```

- Sizes come in **cm** and are ×10. The centre seal is fixed at 10 mm.
- Print is always colour group 12 (4C CMYK digital, gloss).
- Mapping 93 is always appended. It is a DB row; by the CS default `[33]` it is presumably V-Cut. Verify in the DB.
- The promotion is set only if `Promotion::where('code', …)->first()` exists (`:242-250`).
- No fix margin, fix delivery, custom cost or selected factory on this path.
- `Api/PouchController@calculate:86` also reads `$param['firebase_uid']` unguarded, so the key must be present.
- A human `detail_text` is built in Thai (`:209-241`).

**Order re-pricing input** (`fromOrder:98-119`): `pattern_id, w, l, s, cs, amount, paper_type_id, micron, assemblies (from input[0].assemblies[].id), zipcode, selected_factory`, design 0, promotion "0", no fix margin or delivery. It has **no `b` and no `color_id`** (see P25).

### 2.1 Orchestration (`fromCS:259-376`)

```php
$selected_factory = (!empty($cs_input['selected_factory'])) ? $cs_input['selected_factory'] : null;
$custom_cost = (!empty($cs_input['custom_cost'])) ? $cs_input['custom_cost'] : [ 'custom' => 0 ];
$selected_factory = $custom_cost['custom'] == 1 && !empty($custom_cost['factory_id']) ? $custom_cost['factory_id'] : $selected_factory;
$factories = $this->getFactories($selected_factory);
foreach ($factories as $factory) {
    $print_types = $this->getPrintTypes($factory->id);
    foreach ($print_types as $print_type) {
        if ( $custom_cost['custom'] == 1 && $custom_cost['print_type_id'] !== $print_type->id ) { continue; }
        $convert_factory = $this->ConvertCSDataToFactory($cs_input, $factory->id, $print_type->id);
        if ($convert_factory['status'] == 0) { $errors[] = [...]; continue; }
        ...$factory_data['t'] = $print_type->t; ['min_dl'] ['max_dl'] ['min_material_length'] ['length_plus'] ['width_roll'] ['min_material_cost'] ['bridge'] ['mockup_type_id'] ['mockup_amount']
        $calculate_result = $this->calculate($factory_data);
        if ($calculate_result['status'] == 0) { $errors[] = [...]; continue; }
        $result[$factory->id] = $calculate; ... ['lead_time'] = $print_type->lead_time; ['is_free_design'] = ...
        $product = [ ... 'cost' => $calculate['cost']['per_pcs_with_margin'] * $calculate['amount'], 'delivery_price' => ..., 'price_per_pcs' => $calculate['margin']['sale_price_per_pcs'], 'per_pcs_with_delivery' => ..., 'vat' => $calculate['margin']['vat_price'] * $calculate['amount'], 'target_margin' => ..., 'production_lead_time' => $print_type->lead_time, 'colors' => [ [ 'color_group_id' => $cs_input['color_id'], 'percent' => 100, 'side' => 1 ] ] ];
        ... $result[$factory->id]['order_hierarchies'] = (new genHierarchyFromProduct(...))->getOrderHierarchy();   // SAP
    }
}
usort($result, function ($a, $b) { return $sort = $a['total'] <=> $b['total']; });
```

- **Factories** (`getFactories:55-75`): `factory_match_packaging` join `factory` where `fmp.factory_packaging_status = 1`, `factory.factory_status = 1`, `fmp.packaging_type_id = 6`, optionally `factory.factory_id`. No ORDER BY. `rating` comes from `fmp`.
- **Print types** (`getPrintTypes:77-87`): `factory_match_print_type` join `print_type` where `fmpt.factory_id`, `print_type.packaging_type_id = 6`. No status filter, no ORDER BY. Selects `locopack_margin, lead_time, min_dl, tolerances as t, max_dl, min_material_length, length_plus, width_roll, min_material_cost, bridge`.
- **Merge per factory**: `$result[$factory->id] = …` means the **last** successfully priced print type of a factory overwrites earlier ones. There is no comparison (P14).
- **Image**: the first `images` row with `type_id = 10` (`UploadFile::UPLOAD_IMG_TYPE_DIMENSION_PRODUCT`, `UploadFile.php:22`) and `sub_id = mapping_input_id` (`:295-299`).
- **Sort**: by `total` ascending (`:370-374`).

**`ConvertCSDataToFactory:378-466`** builds the per-factory request:

```php
$pattern = \App\Models\Pattern::where('pattern_id', $factory_data['pattern_id'])->first();
if (!empty($pattern->required_b) == 1) { $factory_data['b'] = $cs_data['b']; }
if ($pattern->required_s == 1) { $factory_data['s'] = $cs_data['s']; }
if ($pattern->required_cs == 1) { $factory_data['cs'] = $cs_data['cs']; }
$factory_data['mapping_input_id'] = \App\Models\MappingInput::where(['mapping_input_type_id' => 1, 'sub_id' => $pattern->pattern_id])->first()->id;
$paper = \App\Models\Paper::where($where)->where(['paper_type_id' => $cs_data['paper_type_id'], 'micron' => $cs_data['micron']])->first();
if ($paper) { $factory_data['paper_id'] = $paper->paper_id; } else { return ['status' => 0, 'error_msg' => 'ไม่รองรับวัสดุที่เลือก']; }
$color_group_id = !empty($cs_data['color_id']) ? $cs_data['color_id'] : 12; // default
$check_color = \App\Models\Color::where($where)->where('color_group_id', $color_group_id)->first();
if ( $check_color ) { $factory_data['color_id'] = $check_color->color_id; } else { return [ 'status' => 0, 'error_msg' => 'ไม่รองรับการพิมพ์ที่เลือก' ]; }
$drye_id = \App\Models\Assembly::where($where)->where('assembly_group_id', 36)->first()->assembly_id;
$making_id = \App\Models\Assembly::where($where)->where('assembly_group_id', 37)->first()->assembly_id;
$factory_data['assemblies'][] = $drye_id; // fix drye process
$factory_data['assemblies'][] = $making_id; // fix making process
if (!empty($cs_data['assemblies']) && count($cs_data['assemblies']) > 0) {
    $activeAssembly = \App\Models\ProductionCondition::where($where)->where(['type' => 1, 'pattern_id' => $factory_data['pattern_id'], 'paper_type_id' => $cs_data['paper_type_id'], 'status' => 1])->pluck('value')->toArray();
    $diff = array_diff($cs_data['assemblies'], $activeAssembly);
    if ($diff) { return ['status' => 0, 'error_msg' => 'ไม่รองรับ option เสริมที่เลือก']; }
    else { foreach ($cs_data['assemblies'] as $assembly_id) { $assembly = \App\Models\Assembly::where($where)->where(['assembly_group_id' => $assembly_id])->first(); $factory_data['assemblies'][] = $assembly->assembly_id; } }
}
$factory_data['is_brief_design'] = 0;
if ($cs_data['design']['type'] == 1) { $factory_data['design_by_yourself'] = 1; }
else if (in_array(intval($cs_data['design']['type']), [2, 3])) {
    $factory_data['is_brief_design'] = $cs_data['design']['type'] == 3 ? config('locopack.is_brief_design.free') : config('locopack.is_brief_design.hire');
    $factory_data['design_price'] = !empty($cs_data['design']['price']) ? $cs_data['design']['price'] : 2500;
}
promotion: type 1 + code → promotion_code; type 2 + discount → discount
fix_delivery / fix_margin default ['fix' => 0]
```

Here `$where = ['factory_id' => $factory_id, 'print_type_id' => $print_type_id]`. `is_brief_design`: hire = 1, free = 2 (`config/locopack.php:62-66`).

### 2.2 `calculate:468-555`, step by step

```php
$dimension = $this->calculateDimension($factory_data);
if ( $dimension['cal_dl'] > $factory_data['max_dl'] ) { return ['status' => 0, 'error_msg' => 'ขนาด DL เกินที่โรงงานผลิตได้']; }
$recheck_min_amount = $this->recheckMinAmount($factory_data['factory_id'], $factory_data['print_type_id'], $dimension['cal_sqcm'], $factory_data['amount']);
$factory_data['amount'] = $recheck_min_amount['value'];
if(isset($factory_data['mockup_type_id']) && array_key_exists($factory_data['mockup_type_id'], config('locopack.mockup_type_ids'))) {
    $factory_data['amount'] = $factory_data['mockup_amount'];
}
```

**Geometry (`calculateDimension:557-581`).** `dl` is the film **across** the web, `dw` the advance per piece **along** the web. `t` = `fmpt.tolerances` (allowance, "ค่าเผื่อ"; KPON 30 mm).

```php
if ($pattern->pattern_id == 40) { // 3 side seal
    $dl = $factory_data['l'] + $factory_data['l'] + $factory_data['t'];
    $dw = $factory_data['w'];
} else if ($pattern->pattern_id == 41) { // center seal pillow bag
    $dl = (2 * $factory_data['w']) + (2 * $factory_data['cs']) + $factory_data['t'];
    $dw = $factory_data['l'];
} else if ($pattern->pattern_id == 42) { // center seal gusset
    $dl = (2 * $factory_data['w']) + (2 * $factory_data['s']) + (2 * $factory_data['cs']) + $factory_data['t'];
    $dw = $factory_data['l'];
} else if ($pattern->pattern_id == 43) { // 4 side seal
    $dl = (2 * $factory_data['w']) + (2 * $factory_data['s']) + $factory_data['t'];
    $dw = $factory_data['l'];
} else if ($pattern->pattern_id == 44) { // standing pouch
    $dl = $factory_data['l'] + $factory_data['b'] + $factory_data['l'] + $factory_data['t'];
    $dw = $factory_data['w'];
}
$sqcm = ($dl * $dw) / 100;
$cal_dl = floatval(max($dl, $factory_data['min_dl']));
$cal_sqcm = ($cal_dl * $dw) / 100;
return ['dl' => $dl, 'dw' => $dw, 'sqcm' => $sqcm, 'cal_dl' => $cal_dl, 'cal_sqcm' => $cal_sqcm];
```

| pattern | shape | needs | film across (dl) | advance (dw) |
|---|---|---|---|---|
| 40 | 3-side seal (flat, folded bottom) | w, l | 2l + t | w |
| 41 | centre-seal pillow | w, l, cs | 2w + 2cs + t | l |
| 42 | centre-seal with side gusset | w, l, s, cs | 2w + 2s + 2cs + t | l |
| 43 | "4 side seal" (quad, side gusset, no centre seal) | w, l, s | 2w + 2s + t | l |
| 44 | stand-up (bottom gusset) | w, l, b | 2l + b + t | w |

The "needs" column is inferred from the formulas; the `required_*` flags are DB data. Zipper, valve and spout do not change the geometry. Any other pattern id leaves `$dl` undefined and throws (P10).

**Minimum order (`recheckMinAmount:583-594`):**

```php
$check_min_amount = \App\Models\ProductionCondition::where(['factory_id' => $factory_id, 'print_type_id' => $print_type_id, 'type' => 2, 'status' => 1])
    ->where('min_sqcm', '<=', $sqcm)->where('max_sqcm', '>=', $sqcm)->first();
return ['status' => ($amount < $check_min_amount->value) ? 1 : 0, 'value' => max($amount, $check_min_amount->value)];
```

It is called with `cal_sqcm`. KPON seed: one band 1–999999 cm² → 1000 pcs (`ImportKponFactory.php:126`). `fmpt.min_order_amount` is **not** used.

**Layout on the roll (`calculate:482-487`).** One lane across the web; no multi-up.

```php
$pow_condition = [];
$pow_condition[] = ($factory_data['min_material_length'] * 1000) / $factory_data['amount'];
$pow_condition[] = ($dimension['dw'] + $factory_data['bridge']) + (($factory_data['length_plus'] * 1000) / $factory_data['amount']);
$pow = max($pow_condition);
$pol = max($dimension['cal_dl'], $factory_data['width_roll']);
$min_material_cost = $factory_data['min_material_cost'] / $factory_data['amount'];
```

- `pow` = film length charged per piece (mm). It is the larger of:
  - the minimum run (`min_material_length` in **metres** → ×1000 mm) shared over the quantity, and
  - repeat `dw + bridge` (gap between pieces, mm) plus the setup length (`length_plus`, metres) shared over the quantity.
- `pol` = web width charged (mm), never below `width_roll`.
- KPON (`UpdateKPONFactory.php:23-25`, `ImportKponFactory.php:37-41`): `max_dl 800`, `min_material_length 300`, `length_plus 150`, `width_roll 800`, `min_material_cost 3500`, `bridge 4`, `tolerances 30`, `min_dl 400`. So **material is always charged on the full 800 mm web**.
- **Waste:** there is no percentage waste. Waste is carried by `t`, `min_dl`, the setup length `length_plus`, the minimum run and `min_material_cost`.

**Material (`calculatePaperPrice:596-605`):**

```php
$paper = \App\Models\Paper::where('paper_id', $paper_id)->first();
$paper_price = ( ( $pol * $pow ) / 100 ) * $paper->price_per_sqcm;
$final_price = max($paper_price, $min_material_cost);
```

mm × mm / 100 = cm². That is dimensionally correct; the code comments call it "sqcm".

**Printing (`calculatePrinting:607-614`).** It uses `cal_dl`, not `pol`.

```php
$color = \App\Models\Color::where('color_id', $color_id)->first();
$print_price = ( ( $dl * $pow ) / 100 ) * $color->price_per_sqcm;
```

**Options and processes (`calculateAssembly:616-661`).** It receives `($factory_data['assemblies'], amount, cal_sqcm, w, pow)`.

```php
$assemblyData = \App\Models\AssemblyPrices::join('assembly', 'assembly.assembly_id', 'assembly_prices.assembly_id')
    ->where('assembly.assembly_id', $assembly_id)
    ->where('assembly_prices.range_amount_min', '<=', $amount)
    ->where('assembly_prices.range_amount_max', '>=', $amount)
    ->select('assembly.assembly_id as id','assembly.assembly_name as name','assembly.assembly_group_id as group_id','assembly_price_per_pcs','assembly_price_per_cm','price_per_sqcm','min_price')->first();
$items[$key] = ['id' => $assemblyData->id, 'name' => $assemblyData->name, 'group_id' => $assemblyData->group_id];
if ($assemblyData->group_id == 28) { // รองพื้นขาว
    $items[$key]['price_per_pcs'] = $assemblyData->price_per_sqcm * $sqcm;
} else if ($assemblyData->group_id == 29) { // ซิบ
    if ( $assemblyData->assembly_price_per_pcs > 0 ) {
        $items[$key]['price_per_pcs'] = $assemblyData->assembly_price_per_pcs;
    } else if ( $assemblyData->assembly_price_per_cm > 0 ) {
        $asembly_prices[$key]['w'] = $w; ...
        $items[$key]['price_per_pcs'] = ($w / 10) * $assemblyData->assembly_price_per_cm;
    }
} else if ( $assemblyData->group_id == 36 ) { // drye
    $assembly_prices[$key]['pow'] = $pow;
    $items[$key]['price_per_pcs'] = max(4 * (0.8 * (( $pow * $amount )/1000)), $assemblyData->min_price) / $amount;
} else if ( $assemblyData->group_id == 37 ) { // making
    $items[$key]['price_per_pcs'] = $amount * 0.5 > 5000 ? ($amount * 0.2) / $amount : $assemblyData->min_price / $amount;
} else {
    $items[$key]['price_per_pcs'] = floatval($assemblyData->assembly_price_per_pcs);
}
$total_per_pcs += $items[$key]['price_per_pcs'];
```

Groups:
- 28 white base: per cm² of the pouch area.
- 29 zipper: per piece, or per cm of width `w`.
- 30 degassing valve, 31 spout S, 32 spout M, 33 V-Cut (tear notch) and any other group: per piece. Names are from the `getActiveAssemblies` comments `:31-47` and the seeds.
- 36 "drye" (dry lamination) and 37 "ค่าทำซอง" (pouch making): always added, hard-coded formulas. Only `min_price` comes from the DB.

There is **no hang hole and no separate notch price mode**. If such options exist they are "other groups" priced per piece.

**Factory margin (`calculate:491-497`, `calculateCost:663-671`):**

```php
$factory_match_print_type = \App\Models\FactoryMatchPrintType::where(['factory_id' => ..., 'print_type_id' => ...])->first();
$check_factory_margin = \App\Models\FactoryMargin::where(['factory_id' => ..., 'print_type_id' => ...])
    ->where('min_amount', '<=', $factory_data['amount'])->where('max_amount', '>=', $factory_data['amount'])->first();
$factory_margin = !empty($check_factory_margin) ? $check_factory_margin->value : $factory_match_print_type->margin;
$cost = $this->calculateCost($paper['price'], $printing['price'], $assembly['total_per_pcs'], $factory_margin);
...
$cost['per_pcs'] = convertTo2Decimal($paper_price + $printing_price + $assembly_price);
$cost['margin'] = floatval($margin);
$cost['per_pcs_with_margin'] = roundUp($cost['per_pcs'] * (1 + ($cost['margin'] / 100)), 1);
$cost['margin_price'] = floatval(number_format($cost['per_pcs_with_margin'] - $cost['per_pcs'], 2, '.', ''));
```

Helpers (`app/Helpers/helpers.php`):
- `convertTo2Decimal:1692` = `floatval(round(ceil($v * 100) / 100, 2))`, i.e. **ceil to 0.01**.
- `roundUp:1706-1711` = `floatval(round(ceil($value * 10^digit) / 10^digit, $decimal))`, i.e. **ceil to 0.1 THB** here.

The KPON tiers are `factory_margins` 1000–2999: 20, 3000–4999: 15, 5000+: 10 (`UpdateKPONFactory.php:19-21`); the fallback is `fmpt.margin`.

**Custom cost (CS, `calculate:498-506`):**

```php
if ( $factory_data['custom_cost']['custom'] == 1 ) {
    $cost = ['per_pcs' => floatval($cost['per_pcs_with_margin']), 'margin' => 0, 'per_pcs_with_margin' => floatval($factory_data['custom_cost']['cost_per_pcs']), 'margin_price' => 0];
}
$cost['total'] = $cost['per_pcs_with_margin'] * $factory_data['amount'];
```

**Sell side.** It does **not** call `Calculator::SaleMargin` (so there is no packaging argument). Its own code is `calculate:507-518`, `calculateMargin:673-688`:

```php
$locopack_margin = 10; // default
if ($factory_data['fix_margin']['fix'] == 1) { $locopack_margin = $factory_data['fix_margin']['margin']; }
else {
    $check_locopack_margin = \App\Models\LocopackMargin::where(['factory_id' => ..., 'print_type_id' => ...])
        ->where('min_amount', '<=', $factory_data['amount'])->where('max_amount', '>=', $factory_data['amount'])->first();
    $locopack_margin = $check_locopack_margin ? $check_locopack_margin->value : $factory_match_print_type->locopack_margin;
}
$locopack_fix_cost = $factory_data['fix_margin']['fix'] == 1 ? $factory_data['fix_margin']['fix_cost'] : $factory_match_print_type->locopack_fix_cost;
$margin = $this->calculateMargin($cost['per_pcs_with_margin'], $factory_data['amount'], floatval($locopack_margin), floatval($locopack_fix_cost));
...
$result['fix_cost_per_pcs'] = ($locopack_fix_cost / $amount);
$result['per_pcs_with_fix_cost'] = $cost_per_pcs + $result['fix_cost_per_pcs'];
$result['per_pcs_with_margin'] = $result['per_pcs_with_fix_cost'] / ((100 - $locopack_margin) / 100);
$result['margin_price'] = $result['per_pcs_with_margin'] - $result['per_pcs_with_fix_cost'];
$result['sale_price_per_pcs'] = convertTo2Decimal($result['per_pcs_with_margin'] * 1.07);
$result['vat_price'] = $result['sale_price_per_pcs'] - $result['per_pcs_with_margin'];
```

- **Tiers** (`locopack_margins`): `min_amount <= amount AND max_amount >= amount` (both ends inclusive), `deleted_at IS NULL` (SoftDeletes, `LocopackMargin.php:10`), no status column. **Price bounds `min_price/max_price` are ignored.** No ORDER BY, `first()`. Fallback `fmpt.locopack_margin`. The `= 10` default is always overwritten (dead).
- KPON rows: 1000–4999 → 15, 5000–999999 → 22 (`database/seeds/updateLocopackMargin.php:102-103`; `UpdateKPONFactory.php:27-28` fixed the bounds to 4999 / 5000).
- **VAT** is a hard-coded `1.07`, not `SALE_MARGIN_VAT`.
- **Design fee:** setting `DESIGN_COST_FOR_POUCH` (env, else `aws_secrets`): SME at `:254`, CS default at `PouchController.php:56`, exposed to the customer web at `Api/MappingInputAPIController.php:332`. The server fallback when the price is empty is `2500` (`:444`). The **same setting** prices "pouch printing" standard products (`StandardProduct.php:259-261`) and the rigid default (`Api/RigidAPIController.php:45,55`).

**Delivery (`calculate:519-524`, `calculateDeliveryPrice:690-723`):**

```php
$factory_data = \App\Models\Factory::where('factory_id', $factory_id)->first()->toArray();
if (isset($fix_delivery['fix']) && $fix_delivery['fix'] == 1) {
    $delivery_cost = $fix_delivery['delivery_cost']; $amount_of_shipping_box = $fix_delivery['amount_of_shipping_box']; $delivery_by = $fix_delivery['delivery_by'];
} else {
    $oShippingUtil = new \App\Libraries\Shipping\ShippingUtils($this->zipcodeDeliveryZone);
    $delivery_result = $oShippingUtil->calShippingCostPouch($amount, $factory_data['zipcode'], $zipcode, $factory_data);
    $delivery_cost = $delivery_result[0][0]; $amount_of_shipping_box = $delivery_result[0][1]; $delivery_by = $delivery_result[0][3];
}
if ($delivery_cost == 0) { return ['status' => 0]; }
$delivery_price_with_vat = convertTo2Decimal($delivery_cost * 1.07);
$delivery_price_per_pcs = convertTo2Decimal($delivery_price_with_vat / $amount);
$vat_price = $delivery_price_with_vat - $delivery_cost;
...
$price_per_pcs_with_delivery = convertTo2Decimal($margin['sale_price_per_pcs'] + $delivery['delivery_price_per_pcs']);
```

`zipcodeDeliveryZone` is cached 60 minutes under the key `zipcodeDeliveryZone` (`:14-25`, comment says 10).

**`ShippingUtils::calShippingCostPouch:710-788` (verbatim core).** The weight is 10 g per pouch whatever the size or micron. The carriers come from `filterShippingByFactory:790-822` (factory `shipping_enabled_*` flags), which must be a subset of `ENABLE_SHIPPING_LIST` (`:19`).

```php
$weightPerPcs = 0.01000;
foreach ($shipper as $shipping) {
  $canReceive = $this->checkCanReceiveArea($fromPostalCode, $toPostalCode, $shipping);
  if ($canReceive) {
    $totalDeliveryCost = 0; $remainAmount = $qty; ...
    $maxWeightPerBox = $this->findMaximizeBoxFromWeight($qty*$weightPerPcs, $fromPostalCode, $toPostalCode, $shipping);
    $countAmtBox = 0;
    while ($remainAmount > 0) {
        $boxWLH = $d = $l = $w = 0;
        $adjustWeightSpacial = ($shipping===SHIPPING_NINJA_VAN)?1950:2000;
        if ($remainAmount >= 2100 && $maxWeightPerBox > (3000*$weightPerPcs) ) {
            $amt = ($remainAmount  <= 3000)?$remainAmount:2000;
            $remainAmount = $remainAmount  - 3000;
            $w = 33; $l = 52; $d = 23;
            $amt = 3000;
        }
        else if (($remainAmount >= 500 && $remainAmount <= $adjustWeightSpacial)
            || ($remainAmount >=$adjustWeightSpacial && $maxWeightPerBox > ($adjustWeightSpacial*$weightPerPcs))) {
            $amt = ($remainAmount  <= $adjustWeightSpacial)?$remainAmount:$adjustWeightSpacial;
            $remainAmount = $remainAmount  -  $adjustWeightSpacial;
            $w = 26.7; $l = 44.5; $d = 16.5;
        }
        else if ($remainAmount >= 100 && $remainAmount <= 400) {
            $remainAmount = $remainAmount  - 100;
            $w = 16; $l = 29; $d = 5;
            $amt = 100;
        }
        $boxWLH = $w + $l + $d;
        if ($boxWLH > 0) {
            $weightPerBox = ceil(($weightPerPcs*$amt) + 0.5);
            $cost = $obj->findCostByWeightAndSize($weightPerBox, $toPostalCode, $fromPostalCode, $zoneOfShippingTo, $zoneOfShippingFrom, $boxWLH, $w, $l, $d);
            $totalDeliveryCost = $totalDeliveryCost + $cost;
        } else {
            $remainAmount = 0;
        }
        $countAmtBox++;
    }
    if ($totalDeliveryCost > 0) { $aCostShipping[$shipping] = array($totalDeliveryCost, $countAmtBox, null, $shipping); }
  }
}
usort($aCostShipping, function($a, $b) { return $a[0] - $b[0]; });
$first_key = array_keys($aCostShipping);
return array ($first_key[0] => $aCostShipping[$first_key[0]]);
```

The same function also prices **standard products** (`Libraries/StandardProduct/CalculateDelivery.php:186-196` `ByPouch`) and rigid (`Models/Rigid.php:478`, `Api/RigidAPIController.php:867`). The KPON-only carriers `kpon1` / `kpon2` read the `shipping_provider_*` repositories (`Libraries/Shipping/KPon1.php:79-161`).

**Total, design and discount (`calculate:525-537`):**

```php
$design_price = !empty($factory_data['design_price']) ? $factory_data['design_price'] : 0;
$total = $factory_data['is_brief_design'] == config('locopack.is_brief_design.free') ? $price_per_pcs_with_delivery * $factory_data['amount'] : $price_per_pcs_with_delivery * $factory_data['amount'] + $design_price;
if (!empty($factory_data['promotion_code'])) {
    $discount_data = (new \App\Models\Promotion)->calculateDiscount($total, $factory_data['promotion_code']);
    $discount = $discount_data['discount']; $promotion_code = $factory_data['promotion_code'];
} else if (!empty($factory_data['discount'])) { $discount = $factory_data['discount']; }
$total -= $discount;
```

`Promotion::calculateDiscount:144-188`:
- looks up `code` with `status = 1` and `start_date <= today <= end_date` (SoftDeletes);
- requires `total >= min_price`;
- type 1: fixed `value`; type 2: `round($total * ($promotion->value / 100))`; type 3: step `calculateDiscountTypeStep:190-213` (3000–4999.9999 → 20, 5000–7499.9999 → 50, 7500–14999.9999 → 100, 15000–999999.9999 → 300, > 1000000 → 300);
- capped at `max_price`;
- `limit` / `limit_per_user` are not checked.

### 2.3 Lead time

`lead_time = fmpt.lead_time` raw: `fromCS:319`, product `production_lead_time` `:351`. It is not ceiled and does not use `getCustomLeadTime`. SME and order shapes give `receiving_date = today + lead_time days` in calendar days (`:128-129`, `:158-159`). The CS copy text hard-codes "ระยะเวลาผลิต 30 วัน" (`cs.vue:1071`). KPON `lead_time 30`.

### 2.4 SME selection (`fromSME:144-194`)

The output per option is `factory_alphabet, print_type_name, rating, lead_time, receiving_date(_ts), per_pcs = price_per_pcs_with_delivery, per_pcs_orig, design_price, discount, discount_diff 0, total, specs []`. It adds `min_amount` when raised. With `$raw_data` it adds `detail_text`, `products`, `order_hierarchies`.

```php
$diff = array_diff_key($result, $min_amount);
if (count($diff) > 0) { $result = $diff; }   // drop options whose quantity was raised to the minimum
else if (count($diff) == 0) {                // all raised: keep only the smallest minimum
    $min_amount_key = array_search(min($min_amount), $min_amount);
    foreach ($result as $key => $value) { if ($key !== $min_amount_key) { unset($result[$key]); } }
}
usort($result, function ($a, $b) { return $sort = $a['total'] <=> $b['total']; });
```

Then, in `Api/PouchController@calculate:86-98`, reward points (discount_type 3) are applied to the first result and lost when `:99` recomputes. In `storev2:1490-1499` the points **are** applied to the products, so the order total differs from the quote (P23).

---

## 3. Live vs dead code in `PouchCalculator`

- **Live:** `__construct`, `getFactories`, `getPrintTypes`, `getMicrons` (CS input data: all microns; SME: `show_in_web = 1`), `fromSME`, `ConvertSMEDataToCS` (also via `Converter::SMEToCS:35-37`, only from the broken `store`), `fromCS`, `ConvertCSDataToFactory`, `calculate`, `calculateDimension`, `recheckMinAmount`, `calculatePaperPrice`, `calculatePrinting`, `calculateAssembly` (all branches reachable by data), `calculateCost`, `calculateMargin`, `calculateDeliveryPrice`; `ShippingUtils::calShippingCostPouch`, `filterShippingByFactory`.
- **Dead or never effective:**
  - `getActiveAssemblies:27-53`: route exists, no caller. Its rules: no zip (29) or spouts (31/32) for 41–43; no valve (30) for 40/41 or paper types 24/25/28. In practice `production_conditions` type 1 enforces the allowed options.
  - `fromOrder:98-142`: always throws (P25).
  - Mockup override `:478-480`: the UI selector is commented out (`cs.vue:241-243`).
  - `design_by_yourself` and `factory_data['design']` are set but never read.
  - `$locopack_margin = 10` default.
  - `$asembly_prices` / `$assembly_prices` scratch arrays (`:644-646`, `:650`).
  - `$amt = (...)?...:2000` in shipping branch 1 (overwritten).
  - `getFactories` selects `factory.margin` but it is never used.

---

## 4. Data read (checked against `docs/legacy/03-legacy-schema.txt`)

| Table (schema line) | Columns read | WHERE / status filters | Where |
|---|---|---|---|
| `factory_match_packaging` (:38) | factory_id, packaging_type_id, factory_packaging_status (char), rating | `factory_packaging_status = 1`, `packaging_type_id = 6`; no deleted_at (model has no SoftDeletes) | `getFactories:61-74` |
| `factory` (:41) | factory_id, factory_name, margin, zipcode, factory_detail (alphabet), factory_status (char), shipping_enabled_scgexpress/ninjavan/deliveree/flash/kob/dhl/kpon1/kpon2 | join: `factory_status = 1` (deleted_at **not** applied on the join); `Factory::where(factory_id)->first()` applies `deleted_at IS NULL` | `:61-74`, `:692`, `ShippingUtils.php:790-820` |
| `factory_match_print_type` (:40) | factory_id, print_type_id, margin, locopack_margin, locopack_fix_cost, lead_time, tolerances, min_dl, max_dl, min_material_length, length_plus, width_roll, min_material_cost, bridge. **Not read:** min_order_amount, min_order_for_production | factory_id (+ print_type_id); no status | `getPrintTypes:79-86`, `calculate:491` |
| `print_type` (:105) | print_type_id, print_type_name, packaging_type_id | `packaging_type_id = 6`; `print_type_status` and deleted_at **not** checked | `:79-80`; CS `PouchController.php:54` |
| `pattern` (:97) | pattern_id, required_b/s/cs, min/max w/l/b/s/cs (CS + SME show). `pattern.min_dl/max_dl/min_dw/max_dw` exist (pouch migration `2023_01_10_165715`) but are **unused** | by pattern_id, `deleted_at IS NULL`; no status / packaging filter in the calculator; CS list: `packaging_type_id 6, pattern_status 1` | `:208, :391, :559`; `PouchController.php:18` |
| `mapping_inputs` (:67) | id, sub_id, name_th, mapping_input_type_id (1 pattern, 2 material, 4 special technic, 5 spout), packaging_type_id, status | `find()` with `deleted_at IS NULL`, **no status**; `:401` `mapping_input_type_id = 1 AND sub_id = pattern` (no packaging filter); SME lists: `packaging_type_id 6, status 1` | `:206, :222, :230, :236, :401`; `Api/PouchController.php:13,71-78` |
| `paper` (:89) | paper_id, paper_name, paper_type_id, micron, price_per_sqcm, show_in_web, paper_status, packaging_type_id, factory_id, print_type_id | calculator: factory_id, print_type_id, paper_type_id, micron, deleted_at; **no paper_status, no packaging filter**; `getMicrons`: paper_type_id (+ show_in_web 1), group by micron; CS material list: `packaging_type_id 6, paper_status 1` | `:402, :598, :95`; `PouchController.php:24-29` |
| `paper_types` (:91) | paper_type_id, paper_type_name | deleted_at | CS input data |
| `color` (:17) | color_id, color_name, color_group_id, price_per_sqcm | factory_id, print_type_id, color_group_id; **no color_status**, no deleted_at | `:409, :608` |
| `color_groups` (:16) | id, name, status | CS list: `color.print_type_id = '10'`, `status 1` | `PouchController.php:33-37` |
| `assembly` (:7) | assembly_id, assembly_name, assembly_group_id | factory_id, print_type_id, group; **no assembly_status**, no deleted_at | `:415-416, :433, :621` |
| `assembly_groups` (:4) | id, name, status | CS list: `print_type_id = 10`, `status = 1` (36/37 have status 0) | `PouchController.php:38-43` |
| `assembly_prices` (:5) | assembly_price_per_pcs, assembly_price_per_cm, price_per_sqcm, min_price, range_amount_min/max | assembly_id + amount band (inclusive); **no status, no difficult_level, no deleted_at** | `:621-633` |
| `production_conditions` (:165) | type, pattern_id, paper_type_id, min_sqcm, max_sqcm, value (assembly group id or min qty), status | type 1: factory, print type, pattern, paper type, `status 1`; type 2: factory, print type, `status 1`, `min_sqcm <= cal_sqcm <= max_sqcm` | `:420-427, :585-592`; `Api/PouchController.php:34-52` |
| `factory_margins` (:169) | min_amount, max_amount, value. `min_price/max_price` **ignored** | factory, print type, amount inclusive; no deleted_at column | `:492-495` |
| `locopack_margins` (:62) | min_amount, max_amount, value. `min_price/max_price` **ignored** | factory, print type, amount inclusive, `deleted_at IS NULL` | `:511-514` |
| `promotions` (:113) | code, status, start/end_date, min_price, max_price, value, promotion_type_id | SME: code only (+ deleted_at); discount: code, `status 1`, dates | `:243`; `Promotion.php:152-155` |
| `images` (:59) | path | `type_id = 10`, `sub_id = mapping_input_id`, deleted_at | `:296` |
| `zipcodes_delivery_zone` (:152) | shipping, type, zipcode, areacode | all rows (model SoftDeletes is commented out) | `:22` |
| `users` (:150) | firebase_uid, total_points | `firebase_uid = ? AND firebase_uid != NULL` | `Api/PouchController.php:86-88` |

Every column above exists in `docs/legacy/03-legacy-schema.txt`.

**Settings and env:**
- `DESIGN_COST_FOR_POUCH` (env, else `config('aws_secrets.secrets.DESIGN_COST_FOR_POUCH')`)
- `AWS_PATH` (image URL)
- `ENABLE_SHIPPING_LIST`: production `flash,ninjavan,scgexpress,deliveree,dhl,kpon1,kpon2` (`.env.production:96`; `kob` missing)
- `config/locopack.php`: `packaging_type_ids.pouch`, `is_brief_design`, `designer_types`, `mockup_type_ids`
- `config('services.shipping_providers.kpon1')` (KPon1)
- Cache key `zipcodeDeliveryZone` (60 min)

**Not used:** `SALE_MARGIN_VAT` and the other `SALE_MARGIN_*` settings.

---

## 5. Input validation

- **Vue CS (`pouch/cs.vue`; `form-edit-input/pouch.vue` has the same rules):**
  - `w` / `l` required with min/max from the pattern in mm (`:29,38`).
  - `b` / `s` / `cs` required when the pattern requires them, with min/max (`:47,56,65`).
  - `amount` required only (no number, integer or minimum rule, `:77`).
  - Material, micron and print are required (`:86,98,110`).
  - Each option row is required (`:125`).
  - Zipcode: required, exactly 5 characters (`:146`).
  - Design price and designer type are required for design 2/3 (`:177,186`).
  - Promo code (type 1) or discount (type 2) required (`:211,223`).
  - Fix margin and fix cost (`:248,257`), fix delivery fields (`:279,299,308`) and custom-cost fields (`:328-348`) required when chosen.
- **Server:** no Validator or FormRequest on any pouch route (`use Validator` is imported but unused). The calculator does not check size limits. The only server-side gates are:
  - `cal_dl > max_dl` (refusal);
  - unsupported material, print or option → per-factory errors;
  - everything else throws on missing keys.
- An amount of 0, a negative amount or a string number is silently raised to the type-2 minimum (`recheckMinAmount` runs before any division). `"3,000"` throws ("non well formed").
- **SME:** the customer front end is not in this repo. Limits come from `GET /api/pouch/{id}` in cm. The server does not validate.
- **`Calculator::validateInput:471-517` for packaging 6:** pouch is not in `[2,5]`, so `h` is required (`:480`). With an `h`, `h > floatval(max_h)` where pouch patterns carry no height limits (null → 0) rejects (`:503`). The pouch SME payload also uses `pattern_id`, not `mapping_pattern_id`, which gives "กรุณาตรวจสอบข้อมูล" (`:516`). So it never validates a pouch.

---

## 6. Quirks P1..P35 and port treatment

| # | Legacy behaviour (file:line) | Port |
|---|---|---|
| P1 | Own engine; no `SaleMargin`, no folding | **Keep** as a separate `pouch` calculator |
| P2 | Material charged on `pol = max(cal_dl, width_roll)`: the full 800 mm web even for a small pouch; one lane, no multi-up (`:486`) | **Keep** (exact) |
| P3 | Printing charged on `cal_dl × pow`, material on `pol × pow` (`:488-489`) | Keep |
| P4 | `pow` = max(min-run length / qty, dw + bridge + setup length / qty); setup and minimum run are not added together (`:483-485`) | Keep |
| P5 | `min_dl` raises the film width before pricing **and** before the minimum-qty band lookup (`cal_sqcm`) (`:578-579, :474`) | Keep |
| P6 | Drye: `max(4 × 0.8 × pow·qty/1000, min_price)/qty`. Hard-coded 4 THB/m² and 0.8 m width; DB per-piece prices (3 / 1 / 0.62) ignored; TNP's 0 row still costs 3.2·pow/1000 per piece (`:651`) | **Keep the numbers** as price-list terms (rate per m², web width) with the legacy defaults |
| P7 | Making: `qty > 10000 → 0.2/pc else min_price/qty`; per-piece DB prices ignored; jump at 10000/10001 (0.3 → 0.2 with min 3000) (`:653`) | Keep as terms (threshold, rate, minimum) |
| P8 | Zipper with both prices 0 → `price_per_pcs` unset → Undefined index throws (`:639-648, :658`) | Fix: `price_line_missing` for that factory |
| P9 | No `assembly_prices` row for the qty band, a missing group-36/37 assembly, or an allowed option without an `assembly` row → property of non-object → **whole request fails** (`:634, :415-416, :434`) | Fix: refuse that factory only (`price_line_missing`) |
| P10 | Pattern outside 40–44 → `$dl` undefined throws (`:560-577`) | Fix: geometry required on the pattern (validation) |
| P11 | No type-2 minimum band for the area → `->value` on null throws for the whole request (`:593`) | Fix: no band = no minimum (or refuse the factory); choose and document |
| P12 | Minimum quantity from `production_conditions` type 2 by area; `fmpt.min_order_amount` / `min_order_for_production` ignored | Keep (minimum by area band) |
| P13 | Raised quantity flagged `use_min_amount`; SME keeps only un-raised options, else only the smallest minimum (`:179-189`) | Keep the selection rule (customer quote); CS shows all |
| P14 | One result per factory, last print type wins with no comparison (`:311`) | Fix: one option per factory × print type (as tag map T3/T5) |
| P15 | `usort` by total, PHP 7 unstable on ties; no ORDER BY on factories, print types, margins (`:371`, `:190`) | Explicit tie-break (factory id, print type id) |
| P16 | Factory cost per piece: `convertTo2Decimal` (ceil 0.01), then `roundUp(…,1)` ceil to 0.1 after the margin (`:666-668`) | **Keep exactly**; add `roundUp` to `engine/php.ts` (only `convertTo2Decimal` exists) |
| P17 | Float ceil artefacts (`ceil(x*100)` on e.g. 1.1×100 = 110.00000000000001 → 1.11) | Keep (IEEE port as other calculators) |
| P18 | `factory_margins` and `locopack_margins` tiers use the amount only, inclusive both ends; price bounds ignored; fallback `fmpt.margin` / `fmpt.locopack_margin` (null → 0 %) | Keep amount-only tiers for pouch (`priceMin/Max` null); null fallback → `price_line_missing` |
| P19 | Margin as gross margin on the sale price: `(cost + fix/qty)/((100−m)/100)`; `m = 100` → division by zero throws (`:683`) | Keep the formula; reject m ≥ 100 |
| P20 | VAT hard-coded 1.07 in the price and the delivery (`:685, :707`) | Fix: dated `vat_standard` rate (7 % today) |
| P21 | Delivery folded into the per-piece price (each component ceiled to 0.01, then re-multiplied by qty) (`:524`) | Changed: delivery is its own quote line (D-013 as in the other maps); keep the per-piece maths only if the legacy compare needs it |
| P22 | Fix delivery with cost 0 refuses the option ("free shipping" impossible) (`:704-706`); the auto path never returns 0, it **throws** when no carrier prices (`ShippingUtils.php:786-787`) | Fix: 0 allowed for manual; no carrier → no delivery line / shipping refusal, not a crash |
| P23 | `Api/PouchController@calculate` computes twice; reward-point discount discarded (`:85-99`) but applied at `storev2:1490-1499`; `firebase_uid` key required (`:86`) | Fix: single computation; points per getpack loyalty rules (D-130+) |
| P24 | `custom_cost` filter uses strict `!==` between JSON int and DB value (`:272`); works only if both are ints | Not ported (CS chooses in the result / admin override) |
| P25 | `fromOrder`: no `color_id` → Undefined index at `fromCS:352`; no `b` → throws for pattern 44 (`:393`); saved assemblies include 36/37 → "ไม่รองรับ option เสริม" for every factory → `reProduction:3550` `$calculated[0]` throws. **Always fails** | Not ported (re-order = new quote from the stored configuration) |
| P26 | `Calculator::FromSME` / `validateInput` have no pouch branch: always rejected / undefined `$calculated` (`Calculator.php:54-66, :480, :503`); admin pouch sample products (`product/pouch.vue`) can never be saved | Not ported (store size rules come from the pouch pattern: w, l, b, s, cs; no h) |
| P27 | Change factory: reads `$calculated['error']` but pouch returns `errors`; empty result → `['result'][0]` undefined offset throws; uses the cheapest option, then stamps `cost_data.select_factory_id` on products priced for another factory (`ChangeFactoryController.php:85, :99, :149`) | B3 order operations: re-price on the chosen factory only |
| P28 | `POST /api/orders` (`store`) for pouch: no calculator branch, `$calculated` undefined (`OrderAPIController.php:1074-1098`) | Not ported |
| P29 | Paper lookup ignores `paper_status` and packaging (KPON MOPP papers disabled in `UpdateKPONFactory.php:30` still price); colour and assembly ignore status; `getMicrons` lists microns of every factory and status | Fix: active rows only |
| P30 | SME always adds special technic 93 (duplicate if sent); print always group 12; centre seal fixed 10 mm; design only "hire" | Keep defaults as the customer-web configuration; de-duplicate options |
| P31 | Free design (type 3) shows `design_price` but does not add it; hire adds it once per quote; fallback 2500 when empty (`:444, :528`) | Keep semantics; fee from the `pouch` sell table (`DESIGN_COST_FOR_POUCH`) |
| P32 | Shipping: 10 g per piece whatever size or micron; cartons of 3000 (always 31 kg), ≤1950/2000, or 100 pcs; remainders <100 or 401–499 pieces **not charged**; a quantity alone in those gaps → no cost → throws; box count over-counted by the empty last loop; carriers ordered by `$a[0]-$b[0]` (int-cast, <1 THB ties); factory carrier not in `ENABLE_SHIPPING_LIST` (e.g. `kob`) → Undefined index throws (`ShippingUtils.php:58`) | Port the packer exactly (shared with standard products `ByPouch`) **except**: charge remainders (or document), correct box count, min-cost with explicit tie-break, unknown carrier skipped |
| P33 | Mockup override replaces the quantity after the minimum check, so delivery and margins are computed on the mockup qty (`:478-480`); UI hidden; `cs.vue:907` `setMockup` on a null ref | Not ported (getpack samples/mockups are a service) |
| P34 | Lead time raw `fmpt.lead_time`; receiving date in calendar days; fractional days break `strtotime` | `⌈lead time⌉` term, business-day rules as other calculators |
| P35 | CS copy text: `text +=` before `let text` (`cs.vue:1067-1070`), so the withholding / payable lines are lost; says "ค่าส่ง : ฟรี" (shipping folded in) | Not ported (UI) |
| — | `!empty($pattern->required_b) == 1` (`:392`): harmless | Keep semantics (`required_b` truthy) |
| — | Promotion `limit` / per-user limit not checked; discount can drive the total negative (`:537`) | getpack promotion rules |
| — | Results built per request: `new ShippingUtils` (all carriers) per factory × print type | Performance only |

---

## 7. Did it work in production?

**Yes, on the two live paths, given complete data:**
1. CS `POST cs/pouch` (with create order, quotation, edit order, change factory).
2. Customer `POST /api/pouch/calculate` → `POST /api/orders-v2`.

Evidence: the KPON factory was seeded and re-tuned (2023-08 `import_kpon_factory`, 2023-11 `update_kpon_factory`, LOC-2346 / LOC-2416), dedicated KPON carriers (`kpon1/kpon2`, migration `2023_10_04_171351`), the pouch-specific product fields (`products.b/s/cs/dl/dw/paper_id/...`, schema `:111`), and the full CS order / quotation wiring. Usage volume cannot be measured: the pouch path writes **no `calculate_logs`**.

**Paths that always throw or fail:**
- `POST /api/orders` for pouch (P28).
- `POST /api/order/{id}/re-production` → `fromOrder` (P25).
- `POST /api/products` / `Calculator::FromSME` for a pouch mapping (P26); admin pouch sample products.
- `POST /api/validate-input` for pouch (P26).
- `GET cs/pouch/get-microns` (missing method).
- Change factory when no option prices (P27).

**Data-dependent whole-request failures** (one bad factory kills every factory's quote): P8, P9, P10, P11, P19, P22 (no carrier), P32 (carrier not enabled, quantity in a gap), a soft-deleted factory still matched by the join (`:692` `->first()->toArray()` on null).

**Fixtures:**
- `test/fixtures/legacy/calculate_logs_202609232216.sql`: 97,614 lines, 8,874 INSERTs.
- It holds inputs only (`mapping_input_id, rigid_id, amount, w, l, h, zipcode, promotion_code, created_at`). **No outputs.**
- mapping_input_ids present: 1–11, 24–26, 30–32, 48–52, 55–60, 65–67, 96–99. 96–99 are "fix size" patterns (`DesignsAPIController.php:753`).
- By code path there are **no pouch rows**: `PouchCalculator::fromSME` never logs; the only logger is `Calculator::FromSME:88-100`, which pouch cannot reach past `validateInput`.
- Pouch mapping ids cannot be confirmed because `mapping_inputs` is not in the fixtures.

**Docs:** `docs/legacy/00-domain-context.md:68` only names `PouchCalculator`; `:123` lists `POST /api/pouch/calculate` and CS `cs/pouch`; `:264` lists `DESIGN_COST_FOR_POUCH`. No other pouch notes. No pouch port map yet.

---

## 8. Suggested port shape and golden tests

**Shape.** `src/modules/pricing/calculators/pouch/`. The `CalculatorKey` enum already has `pouch` (`src/generated/prisma/enums.ts:35`). Same rule as the other maps: maths ported exactly, orchestration and state bugs fixed and listed as deviations.
- `geometry.ts`: pattern geometry keys `three_side_seal` (40), `pillow_center_seal` (41), `center_seal_gusset` (42), `quad_seal` (43), `stand_up` (44), each mapped to `{dl, dw}` per the §2.2 table. Inputs w, l, b, s, cs in mm (customer cm × 10; cs default 10).
- `web.ts`: `cal_dl`, `cal_sqcm`, `pow`, `pol`, `max_dl` refusal.
- `cost.ts`:
  - material `max(pol·pow/100·price_cm2, min_material_cost/qty)`;
  - print `cal_dl·pow/100·price_cm2`;
  - assemblies by **price mode**: `per_cm2` (28), `per_cm_width` / `per_pcs` (29), `drye` (rate 4, width 0.8, min), `making` (threshold 10000, 0.2, min), `per_pcs` (others), with qty bands;
  - `convertTo2Decimal`;
  - factory margin tier (amount only) → `roundUp(…,1)`.
- `sell.ts` (pouch variant): amount-only tiers inclusive, fallback, fix cost, gross-margin formula, VAT from the tax rate, `convertTo2Decimal`. The design fee comes from the `pouch` sell table (legacy `DESIGN_COST_FOR_POUCH`, also used by pouch-printing standard products).
- **Data:** per factory × product type `pouch` price list. Print type terms are `tolerance, min_dl, max_dl, min_material_length_m, length_plus_m, width_roll, min_material_cost, bridge, lead_time, margin fallbacks`. It also holds materials (structure + micron, price/cm², active), print colour groups (price/cm²), assemblies + bands, minimum-qty bands by cm², and the allowed-options matrix (pattern × material → option groups, from `production_conditions` type 1).
- **Shipping:** `shipping/packing/pouch-packing.ts` (10 g/pc, three carton sizes, `ninjavan` 1950 vs 2000), shared with standard products. Delivery is a separate quote line.
- Add `roundUp` to `src/modules/pricing/engine/php.ts`.
- **Not ported:** SAP hierarchies, `fromOrder`, `getActiveAssemblies` hard-codes, mockup override, the `custom_cost` `!==` filter (an admin override can replace it), CalFlex.

**Golden cases.** Data = KPON seed values: `t 30`, `min_dl 400`, `max_dl 800`, `min_material_length 300`, `length_plus 150`, `width_roll 800`, `min_material_cost 3500`, `bridge 4`; factory tiers 20 / 15 / 10; getpack tiers 1000–4999: 15, 5000+: 22; fix cost 0; MPET80 0.0014, ALU80 0.0024; colour 12 0.005, colour 13 0.0055; drye / making min 3000; zipper 0.3 / cm; V-Cut 0; minimum 1000.
- G1–G3 were computed with IEEE doubles (`node -e`, same order of operations). Re-verify them with `php.ts`.
- Delivery is fixed (CS `fix_delivery`) in G1–G3 to isolate pricing.
- **These are seed values, not production data.**

1. **G1 stand-up (44)**, w140 l200 b60, qty 3000, MPET80, colour 12, [33], fix delivery 500 →
   - dl 490, cal_dl 490, cal_sqcm 686, pow 194, pol 800
   - paper 2.1728, print 4.753, assemblies 2.0 (drye 1.0, making 1.0)
   - per_pcs 8.93, factory 10.3, sale 12.97
   - delivery 535 → 0.18/pc, per_pcs_with_delivery 13.15, total 39 450
2. **G2 pillow (41)**, w100 l150 cs10, qty 1000, ALU80, colour 12, fix delivery 300 →
   - dl 250 → cal_dl 400 (min_dl raise), pow 304
   - paper 5.8368, print 6.08, assemblies 6.0, per_pcs 17.92
   - factory tier 20 → 21.6, sale 27.2, delivery 321 → 0.33, ppwd 27.53, total 27 530
3. **G3 3-side seal (40)**, w120 l200, qty 12000, MPET80, colour 13, zipper [29], fix delivery 900 →
   - dl 430, pow 136.5 (setup branch), paper 1.5288, print 3.228225
   - drye 0.4368 (formula > min), making 0.2 (> 10000), zipper 3.6, per_pcs 9.00
   - factory tier 10 → 9.9, getpack tier 22 → sale 13.59, delivery 963 → 0.09, ppwd 13.68, total 164 160
4. Centre-seal gusset (42): dl = 2w + 2s + 2cs + t.
5. Quad seal (43): dl = 2w + 2s + t.
6. `cal_dl > max_dl` (e.g. 44 with l 400, b 60 → 890) → refusal for that factory.
7. Minimum raise: qty 500 → amount 1000, `use_min_amount`; customer selection keeps un-raised factories only.
8. All factories raised → customer keeps the smallest minimum.
9. Minimum-run branch dominates `pow` (small dw, e.g. qty 1000, dw 80 → pow 300).
10. `min_material_cost/qty` dominates material (tiny pouch, qty 1000, cheap film).
11. Making at qty 10000 (3000/qty = 0.3) vs 10001 (0.2).
12. Drye at the minimum (qty 1000) vs formula (large qty).
13. White base (28): price_per_sqcm × cal_sqcm.
14. Zipper priced per piece vs per cm of width; zipper with both prices 0 → `price_line_missing` (P8 fix).
15. Option not allowed for pattern × material → "unsupported option" for that factory; unsupported micron → "unsupported material".
16. Factory-margin fallback (no tier) and getpack-margin fallback; `fix_margin` (margin + fix cost) override.
17. Custom cost (admin override of the buy price).
18. Design: hire adds the fee once; free shows it but does not add it; template adds 0.
19. Promotions: fixed, percent (`round`), step tiers, `min_price` gate, `max_price` cap; manual discount.
20. Two factories: one option per factory × print type, sorted by total with a deterministic tie-break.
21. Shipping packer (pure): qty 1000 → one 26.7×44.5×16.5 box (11 kg); 2450 on a ≤ 30 kg carrier → 2000 + 450 remainder (legacy free; decide); 3000 on a > 30 kg carrier → one 31 kg box; 300 → three 100-pc boxes (2 kg each); carrier ordering tie-break.
22. Rounding edge: a cost whose ×100 is a float just above an integer (e.g. a 1.1 component) → `convertTo2Decimal` ceil artefact preserved.

---

## 9. getpack port (decisions, U-B6 pouch, 2026-10-01)

Accepted under the user's standing instruction (2026-10-01); recorded in `docs/update-2026-09-29-gap.md` §U-B6 pouch.

1. **Own calculator** `pouch` (P1): `src/modules/pricing/calculators/pouch/`, pure, no folding or `SaleMargin` code.
2. **Shapes** are a pattern column `pouch_formula` (`three_side_seal` 40, `pillow_center_seal` 41, `center_seal_gusset` 42,
   `quad_seal` 43, `stand_up` 44), never together with the folding / corrugate formulas (P10: a pattern without a formula
   is not priceable). The gussets `b` / `s` and the centre seal `cs` are required by the formula, not by data flags.
3. **Price components** (one price list per factory × product type `flexible_pouch`, schema-design §3.4), every legacy
   number a row or a term, never a constant in code:
   - `pouch_print_type_terms`: tolerance `t`, `min_dl`, `max_dl`, minimum run (m), setup length (m), web width
     (`width_roll`), minimum material cost, bridge, factory-margin fallback, lead time, and the constants legacy hard-coded
     in the lamination (`4` THB/m² × `0.8` m web) and pouch-making (`> 10000` pieces → `0.2` per piece) formulas (P6, P7);
   - `pouch_material_prices` (material → price per cm²), `pouch_print_prices` (print colour → price per cm²);
   - `pouch_option_prices` (option × quantity band → price mode `per_piece` | `per_cm2` | `zipper`, legacy groups 28 / 29 /
     others);
   - `pouch_process_prices` (lamination / making × quantity band → minimum price, legacy groups 36 / 37 rows);
   - `pouch_min_quantities` (pouch area band → minimum order, `production_conditions` type 2);
   - `pouch_factory_margins` (quantity band → factory margin, `factory_margins`);
   - `pouch_option_rules` (pattern × material × option offered, `production_conditions` type 1, P29: active rows only).
4. **Minimum order** (P11–P13): a quantity below the factory's minimum for the pouch's area is **refused for that
   factory** (`process_not_possible`), as label L3; legacy raised the quantity and charged the raised run. No band = no
   price (`price_line_missing`), not a crash.
5. **Missing rows** (P8, P9): an option, process or zipper price that is missing refuses that factory only.
6. **One option per factory × print type** (P14, P15), selection by buy price then lead time (D-043, D-101).
7. **Sell side**: getpack's `flexible_pouch` sell tables — margin tiers on the quantity (inclusive, no price bounds, P18),
   fix cost, design fee (legacy `DESIGN_COST_FOR_POUCH`, P31); VAT the dated `vat_standard` rate (P20). The per-piece
   price keeps legacy's order of operations: `⌈((buy per piece + fix ÷ qty) ÷ (1 − m)) × VAT⌉₀.₀₁` (`calculateMargin`).
8. **Rounding** kept exactly (P16, P17): cost per piece `convertTo2Decimal`, factory price per piece `roundUp(…, 1)`.
9. **Delivery** is its own quote line (D-013, P21, P22). The pouch packer ports `calShippingCostPouch`: 10 g per pouch and
   legacy's three carton sizes; the remainders legacy left uncharged (P32) go into the smallest carton that holds them, the
   box count is not over-counted, and the carrier weight limit is the `shipping.carton_spec` setting.
10. **Not ported**: custom cost, fix margin / fix delivery (CS overrides), mockup quantities (P33), promotions inside the
    calculator (getpack promotions, D-130+), `fromOrder` (P25), `getActiveAssemblies` (dead), SAP hierarchies, CalFlex.
