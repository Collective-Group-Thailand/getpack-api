# Service calculator — legacy port map (U-B6, B2.3 Deliverable 2.3)

> Reference for porting legacy service pricing ("บริการ"). **Legacy is read-only and never run** (D-005). Treatment follows
> the calculator rule (user decision 2026-09-26): **maths ported exactly, orchestration and state bugs fixed and listed as
> deviations** in `docs/pricing-validation-service.md`. §9 records how Packio ports it.

Legacy root: `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/`. Every `app/…`, `config/…`, `routes/…`, `resources/…`, `database/…` path below is under that root. Packio docs are under `/Users/superball/Collective/Packio/Packio-API/docs/`.

PHP 7.1 with `error_reporting(-1)`. "Throws" means a notice or warning that fails the request. One PHP 7.1 detail matters here: reading an index of `null` returns `null` silently (the notice only starts in 7.4), so it does **not** throw.

---

## 0. Main finding

**Legacy has no standalone service product priced by a factory price list, a table or a quantity formula.** The only standalone "service" sale is a **CS back-office page** (`/cs/service`, print type **11**). On that page CS picks a service kind (a SAP PH3 code 900–911) and **types one amount**. The browser then applies a single Packio margin, `config('locopack.service_locopack_margin') = 6.5` %, and VAT 7 % to get the other amount:

- **Design kinds** (PH3 900 / 909, hierarchy type 4): CS types the **VAT-inclusive sell price**. The browser works back to the net price and then the cost.
- **Every other kind** (plate, die block, molds, seal mold, mockup, delivery: hierarchy types 2, 3, 5, 6, 7): CS types the **cost**. The browser works forward to the net and gross sell price.
- Quantity is always **1**. The server **re-computes nothing**: it stores what the browser sent.

Every other "service" in legacy is a **fee attached to a product order**:

| Service-like charge | How it is priced | Where | Who is paid |
|---|---|---|---|
| Standalone CS service order: design (900 by designer / 909 by Locopack admin) | CS types gross sell T. net = round2(round3(T/1.07)), cost = round2(net × 93.5 %). Server also stores `design_cost = calculateServiceCost(T)` (ceil-based rounding) | `resources/js/components/service-orders/cs.vue:405-418`, `app/Http/Controllers/OrderController.php:327`, `app/Helpers/helpers.php:3724-3736` | External designer (`designers.designer_type` 1, design PO via SAP) or in-house (type 2, no PO). Packio keeps 6.5 % of net |
| Standalone CS service order: plate 902, mold print 904 (type 2); die block 903, mold die-cut 905 (type 3); mold seal 906 (type 6); delivery 901 (type 5); mockup 907/908 external, 910/911 internal (type 7) | CS types cost C. net = round2(C / 0.935), gross = round2(net × 1.07) | `cs.vue:419-429` | The factory CS picked (`products.factory_id`), cost stored in `total_cost` plus the matching `*_cost` column |
| Graphic design fee on a calculator quote | **Fixed setting** per packaging type (env, else AWS secret): `SALE_MARGIN_GRAPHIC_DESIGN_FEE_{FOLDING,LABEL,CORRUGATE,TAG}`; pouch and rigid/std use `DESIGN_COST_FOR_POUCH` / `DESIGN_COST_FOR_POP`. CS may type another amount. Added **once, VAT-inclusive, untouched** to the total. Free design (status 3) adds it, then subtracts it | `app/Models/Calculator.php:241-288,424-426`; per calculator, §2.4 | Designer gets `design_cost` = 93.5 % of net (`OrderController.php:327`, `Api/OrderAPIController.php:1040,1520`), only when `is_brief_design = 1` (hire) |
| Structure design fee | Fixed setting `SALE_MARGIN_STRUCTURE_DESIGN_FEE` when `fix_margin.structure_status`. Legacy charges it on every sub-pattern (folding Q2, corrugate C14) | `Calculator.php:251-255` | No cost or payee recorded (`products.structure_design_price` is never written) |
| Mockup inside a calculator order (legacy D-072 add-on) | **Fixed 500 THB per piece** (`config/locopack.php:80`) × `mockup_amount`. A 3 % fee for payment types 2/3/4 is stored apart. The mockup quantity only changes the **shipping packing quantity** in the calculators. On a reorder of a mockup order, `discount = mockup_total` | `OrderController.php:269-317`, `QuotationController.php:206-223`, `Calculator.php:305-307` | Not recorded (no `mockup_cost` on this path). Half-dead (V17) |
| Mockup as a standalone CS service order | CS-typed cost → margin → gross; `mockup_price = mockup_total = gross`, amount 1 | `cs.vue:475-481`, `OrderController.php:270` | Factory (cost in `total_cost` and `mockup_cost`) |
| Samples / prototypes / proofs / consulting / installation | **None exist.** `sample_products` is a showcase catalogue ("Product Groups") with no price (`app/Models/SampleProduct.php:76-83`). "Proof" only appears as quotation footer text (`app/Models/Converter.php:356-368`) | n/a | n/a |

**Conclusion for the port:** no legacy formula takes a quantity, a factory price list or a table and returns a service price. The "legacy calculator" behind D-100's "Services → Instant" (`docs/decisions.md:131`) is a **CS manual-entry form with a fixed 6.5 % margin and 7 % VAT**. The most conservative port (§8):

- a `service` calculator that reproduces that exact maths;
- run on a **service-item catalogue** (seeded from the 11 legacy PH3 rows, names only, no prices);
- with the margin taken from the `service` sell table (legacy 6.5);
- with the input amount entered by CS, unless an optional per-factory service price line exists (legacy has none, so none is seeded).

This matches D-194: "price entered by CS (as the mockup today) … no new formula".

---

## 1. Entry points

### 1.1 Standalone service orders and quotes (CS back office)

| Route | Controller | What it does | Status |
|---|---|---|---|
| `GET cs/service` — `routes/web.php:696` (group `web.admin`, `:545`) **and** `:844` (group `web.factory`, `:760`) | `ServiceOrderController@cs:11-13` → `resources/views/service-orders/cs.blade.php:6` → `<service-order-cs>` (`resources/js/app.js:100`) | Service page | **Live** in production (release branch, §7). The second registration overrides the first, so the effective middleware is `WebFactory` (factory **or** admin). CS-type users (`user_type 0`) see the menu (`resources/views/layouts/menu.blade.php:77,93`) but get 403 (V1) |
| `GET cs/service/get-input-data` — `web.php:697/845` | `ServiceOrderController@getInputData:15-24` | PH3 services with type, designer types, active designers, user, **all** factories, `service_locopack_margin` | Live |
| `POST cs/service/get-order-hierarchy` — `web.php:698/846` | `ServiceOrderController@getOrderHierarchy:26-29` → `Libraries/Hierarchy/GenerateService::GetOHFromPH3:14-42` | SAP order-hierarchy row for the chosen PH3 | Live. Throws on an unknown code (V14) |
| `POST orders` — `Route::resource('orders')` at `web.php:811` (group `web.factory`) | `OrderController@store:132-…` with `is_service: true` (`plugin-boxes/create-order.vue:1253-1263`) | Creates the order from the browser's numbers; mockup branch; `design_cost`; service WHT | Live, **admin only** (`OrderController.php:144-146`) |
| `POST quotations/export-from-cs` — `web.php:769` | `QuotationController@exportFromCS:33-292` with `form.isService` (`plugin-boxes/export-quotation.vue:304`) | Quotation PDF (+ save), service WHT | Live |
| `GET quotations/{id}/get-cs-input` — `web.php:771` | `QuotationController@getCSInput:544-551` | Reloads the form (`cs.vue:363-375`) | Live (fills `form` only, not `selected_ph3`) |
| `cs/service?edit_order_id=` / `?reorder_id=` | `cs.vue:350-353` call `getDataFromOrder`, which does not exist in `cs.vue` | — | **Broken** (JS TypeError). The order page links to `cs/other-products` (`helpers.php:2074`), which has no route (V13) |
| `POST order/update-designer` — `web.php:871` | `OrderController@updateDesigner:4930-4946` | Assigns `orders.designer_id` (needed before production when `is_brief_design > 0`, `:1198-1201`) | Live |

### 1.2 Service-like fees inside calculator flows

| Entry | Fee | Status |
|---|---|---|
| CS calculators (`cs/folding`, `cs/corrugate`, `cs/label-v2`, `cs/tag`, `cs/pouch`, `cs/standard-products`), customer API (`POST /api/orders-v2` → `Api/OrderAPIController@storev2:1503-1541`) | Graphic / structure design fee via `Calculator::SaleMargin` (folding, label, corrugate, tag) or the pouch's own engine; `design_cost` | Live (see the per-calculator port maps `docs/legacy/05-*-port-map.md`) |
| CS calculator mockup selector `<select-mockup>` (`resources/js/components/Mockup/SelectMockup.vue`; used in `folding/cs-v2.vue:432`, `corrugated/cs.vue:385`, label / tag / pouch views) | Mockup 500/pc; calculator shipping quantity | **Half-dead**: changes the calculator's shipping quantity and the quotation PDF, but new orders do not carry `mockup_type_id` (V17) |
| Customer web design price display: `Api/MappingInputAPIController.php:323-336` | `designPrice` per packaging type (fallback 2500) | Live (display) |
| Rigid / std product design: `RigidController@CreateOrderFromCS:958-1020`, `Api/RigidAPIController@store:43-56`, `StandardProduct.php:259-263` | `DESIGN_COST_FOR_POUCH` / `DESIGN_COST_FOR_POP` | Covered in `docs/legacy/05-standard-product-port-map.md` (S20, S21) |

---

## 2. Pipeline (verbatim)

### 2.1 Standalone CS service order: the only "service calculator"

**Input data** (`app/Http/Controllers/ServiceOrderController.php:15-24`):
```php
$data['ph3s'] = HierarchyPh3::services()->with('type')->get();
$data['designer_types'] = array_flip(config('locopack.designer_types'));
$data['designers'] = \App\Models\Designer::where('status', config('locopack.user_status.active'))->get();
$data['user'] = \App\Models\Users::where('id', \Auth::user()->id)->first();
$data['factories'] = \App\Models\Factory::get();
$data['locopack_margin'] = config('locopack.service_locopack_margin');
```

**The service list** (`app/Models/HierarchyPh3.php:19-33,65-83`):
```php
const DESIGNER_DESIGN_CODE = 900;  const LOCOPACK_DESIGN_CODE = 909;
const DELIVERY_PRICE_CODE = 901;   const PLATE_PRICE_CODE = 902;  const DIECUT_PRICE_CODE = 903;
const MOLD_PRINT_CODE = 904;       const MOLD_DIECUT_CODE = 905;  const MOLD_SEAL_CODE = 906;
const EXTERNAL_MOCKUP_PRINT_CODE = 907; const EXTERNAL_MOCKUP_NOT_PRINT_CODE = 908;
const INTERNAL_MOCKUP_PRINT_CODE = 910; const INTERNAL_MOCKUP_NOT_PRINT_CODE = 911;
...
public function scopeServices($query) { return $query->where('hierarchy_type_id', '!=', HierarchyType::ITEM); }
public function getIsDesignAttribute(): bool { return !empty($this->hierarchy_type_id) && $this->hierarchy_type_id == HierarchyType::DESIGN_PRICE ? true : false; }
public function getDesignerTypeAttribute(): int { return self::getDesignerTypeByDesignCode($this->code); }
```

Seed data (`database/json/hierarchies/ph3.json`) and hierarchy types (`database/seeds/importHierarchy.php:25-31`, `app/Models/HierarchyType.php:12-18`):

| PH3 | text | type id | type name |
|---|---|---|---|
| 900 | ค่าออกแบบโดย designer | 4 | ค่าบริการออกแบบ |
| 909 | ค่าออกแบบโดย admin | 4 | ค่าบริการออกแบบ |
| 901 | ค่าขนส่ง | 5 | ค่าบริการขนส่ง |
| 902 | ค่า Plate พิมพ์ | 2 | ค่าบริการทำแม่พิมพ์ |
| 904 | ค่า Mold พิมพ์ | 2 | ค่าบริการทำแม่พิมพ์ |
| 903 | ค่า Block Diecut | 3 | ค่าบริการทำไดคัท |
| 905 | ค่า Mold Diecut | 3 | ค่าบริการทำไดคัท |
| 906 | ค่า Mold Seal | 6 | ค่าบริการทำโมซีล |
| 907 / 908 | ค่า Mockup พร้อมพิมพ์ / ไม่พิมพ์ | 7 | ค่าบริการทำตัวอย่าง |
| 910 / 911 | ค่า Mockup พร้อมพิมพ์ / ไม่พิมพ์ internal | 7 | ค่าบริการทำตัวอย่าง |
| 000 | Other | null | — (excluded: SQL `NULL != 1` is not true, V15) |

**Formulas: browser only** (`resources/js/components/service-orders/cs.vue:381-429`):
```js
roundWithDecimal (value, digit = 2) {
    let pow_value = Math.pow(10, digit)
    return Math.round(value * pow_value) / pow_value
},
calculateCost () {            // design kinds: CS types ราคาขาย (gross)
    let total = parseFloat(this.form.total)
    if (total > 0) {
        let tax = 1.07 // 7%
        let without_sale_tax = this.roundWithDecimal(this.roundWithDecimal(total / tax, 3))
        this.form.sales_tax = total - without_sale_tax
        let without_margin = this.roundWithDecimal((without_sale_tax * ( 100 - this.locopackMargin )) / 100)
        this.form.margin_price = without_sale_tax - without_margin
        // this.form.cost = this.roundWithDecimal(this.roundWithDecimal(without_margin / tax, 3))
        this.form.cost = without_margin
        // this.form.input_tax = without_margin - this.form.cost
        this.form.input_tax = 0
    }
},
calculateTotal () {           // every other kind: CS types ต้นทุน (cost)
    let cost = parseFloat(this.form.cost)
    if (cost > 0) {
        let tax = 1.07 // 7%
        let with_margin = this.roundWithDecimal(cost / ((100 - this.locopackMargin) / 100))
        this.form.margin_price = with_margin - cost
        this.form.total = this.roundWithDecimal(with_margin * tax)
        this.form.sales_tax = this.form.total - with_margin
        this.form.input_tax = 0
    }
},
```

- The trigger is `@keyup` on the field CS types (`cs.vue:56` design / `:76` other).
- The **derived field stays editable** (`:65`, `:85`), so CS can override the result (V3).
- The margin default is `locopackMargin: 6.5` (`:308`), replaced by the server value (`:348`).
- Margin history: 0 % before 2024-09-27 → 5.5 % hard-coded (commit `a7e8f3925`, 2024-09-27) → config 6.5 % (commit `83ab9a88e`, 2024-10-01) (V5).

**Order payload** (`cs.vue:437-517`), where `hierarchy_type_id` selects the column:
```js
cost_per_pcs : parseFloat(this.form.cost), amount : 1, total_cost : parseFloat(this.form.cost),
price_per_pcs : parseFloat(this.form.total), sum : parseFloat(this.form.total),
print_plate_cost : this.selected_ph3.hierarchy_type_id == 2 ? parseFloat(this.form.cost) : 0,
print_plate_price : this.selected_ph3.hierarchy_type_id == 2 ? parseFloat(this.form.total) : 0,
plate_diecut_cost : this.selected_ph3.hierarchy_type_id == 3 ? parseFloat(this.form.cost) : 0,
plate_diecut_price : this.selected_ph3.hierarchy_type_id == 3 ? parseFloat(this.form.total) : 0,
design_price : this.selected_ph3.hierarchy_type_id == 4 ? parseFloat(this.form.total) : 0,
designer_id : this.selected_ph3.hierarchy_type_id == 4 ? parseInt(this.form.designer_id) : null,
is_brief_design : this.selected_ph3.hierarchy_type_id == 4 ? 1 : 0,
shipping_price : this.selected_ph3.hierarchy_type_id == 5 ? parseFloat(this.form.total) : 0,
seal_mold_cost : this.selected_ph3.hierarchy_type_id == 6 ? parseFloat(this.form.cost) : 0,
seal_mold_price : this.selected_ph3.hierarchy_type_id == 6 ? parseFloat(this.form.total) : 0,
sender : null, promotion_code : null, discount : 0,
total : parseFloat(this.form.total), quotation_id : this.quotation_id, zipcode : this.form.zipcode
...
if (this.selected_ph3.hierarchy_type_id == 7) {
    this.order.mockup_cost = parseFloat(this.form.cost)
    this.order.mockup_total = parseFloat(this.form.total)
    this.order.mockup_type_id = ["907", "910"].includes(this.selected_ph3.code) ? 1 : 2,
    this.order.mockup_price = parseFloat(this.form.total)
    this.order.mockup_amount = 1
}
this.products = [{ amount : 1, cost : this.order.total_cost, factory_id : this.form.factory_id,
    print_type_id : 11, pattern_id : 0, graphic_design_price : this.order.design_price,
    per_pcs_with_delivery : this.form.total, print_plate_cost/price, plate_diecut_cost/price,
    price_per_pcs : this.form.total, discount : 0, total : this.form.total, vat : this.form.sales_tax,
    production_lead_time : 7, detail : this.productStr }]
```
`create-order.vue:867` forces `payment_type = qr_code` (5) on mount. The selector offers 5 / 2 / 7 (`:557-560`).

**Hierarchy** (`app/Libraries/Hierarchy/GenerateService.php:14-42`): returns `[]` when the PH3 is not a service, else one row `{type_id: ph3.hierarchy_type_id, ph_code: 09 LC <ph3> 000 0000 0000 …}`. The browser refuses with "ไม่สามารถสร้าง Hierarchy ได้" when it is empty (`cs.vue:519-522`).

**Server** (`app/Http/Controllers/OrderController.php`):
```php
// :262-266 payment fee: computed then hidden
if ($request->has('order.payment_type') && paymentIsCalFee($request->order['payment_type']) && (!$request->has('order.mockup_type_id') || !array_key_exists($request->order['mockup_type_id'], config('locopack.mockup_type_ids')))) {
    $order['payment_fee'] = calFeeFor2C2P($order['total'], $order['amount']);
    // hide payment fee
    $order['payment_fee'] = 0;
}
// :269-281 mockup
if ($request->has('order.mockup_type_id') && array_key_exists($request->order['mockup_type_id'], config('locopack.mockup_type_ids'))) {
    $mockupPrice = $request->products[0]['print_type_id'] == config('locopack.print_types.service') && isset($request->order['mockup_price']) ? $request->order['mockup_price'] : config('locopack.mockup_price');
    $order['mockup_type_id'] = $request->order['mockup_type_id'];
    $order['mockup_price'] = $mockupPrice;
    $order['mockup_amount'] = $request->order['mockup_amount'];
    $total = $request->order['mockup_amount'] * $mockupPrice;
    $fee = 0;
    if (in_array($request->order['payment_type'], [config('locopack.payment_type.credit'), config('locopack.payment_type.online_banking'), config('locopack.payment_type.installment')])) {
        $fee = $total * 0.03;
    }
    $order['mockup_fee'] = $fee;
    $order['mockup_total'] = $total;
    $order['can_use_mockup_discount'] = true;
} else { /* :283-305 unset mockup_type_id, mockup_price, mockup_amount, mockup_fee, mockup_total, can_use_mockup_discount (not mockup_cost) */ }
// :327
$order['design_cost'] = !empty($order['design_price']) && $order['is_brief_design'] == config('locopack.is_brief_design.hire') ? calculateServiceCost($order['design_price']) : 0;
// :388-423 withholding tax
if ($request->has('order.require_withhold_tax') && $request->order['require_withhold_tax']) {
    if($request->order['tax_type'] == config('locopack.tax_type_ids.government_employee')) {
        $percentVat = 0.01;
        $orderPrice = calculateExcludeVat(($findOrder->amount * $findOrder->price_per_pcs) - $findOrder->discount);
    }
    if($findOrder->is_brief_design != 2) { $designPrice = calculateExcludeVat($findOrder->design_price); }
    ...
    $serviceTotal = $designPrice + $printPlatePrice + $plateDiecutPrice + $orderPrice;
    if($request->has('is_service') && $request->is_service) {
        $serviceTotal = calculateExcludeVat($request->order['total']);
    }
    $serviceTotalWithholdingTax = calculateWithholdingTax($serviceTotal, $percentVat);
    $paramUpdate['service_withholding_tax'] = $serviceTotalWithholdingTax;
    ...
}
```
The same `is_service` WHT rule repeats on the order edit page (`OrderController.php:4283-4296`, hidden input `resources/views/orders/components/order_tab.blade.php:195`, from `getOrderItemType`, `helpers.php:3738-3750`).

**Helpers** (`app/Helpers/helpers.php`):
```php
// :1692-1702
function convertTo2Decimal($per_pcs) { return floatval(round(ceil($per_pcs * 100) / 100, 2)); }
function convertTo2Decimal3Digit($per_pcs) { return floatval(round(ceil($per_pcs * 1000) / 1000, 2)); }
// :2977-2981
function calculateExcludeVat($value = 0) { $price = floatval($value); return round(round($price / 1.07, 3), 2); }
// :2985-2990
function calculateWithholdingTax($value = 0, $vat = 0.03) { $price = floatval($value); return round($price * $vat, 2); }
// :3724-3736
function calculateServiceCost($total)
{
    $tax = 1.07; // 7%
    $without_sale_tax = convertTo2Decimal(convertTo2Decimal3Digit($total / $tax));
    $sale_tax = $total - $without_sale_tax;
    $locopack_margin = config('locopack.service_locopack_margin');
    $without_margin = convertTo2Decimal(($without_sale_tax * ( 100 - $locopack_margin )) / 100);
    $margin_price = $without_sale_tax - $without_margin;
    /* $cost = convertTo2Decimal(convertTo2Decimal3Digit($without_margin / $tax));
    $input_tax = $without_margin - $cost; */
    $cost = $without_margin;
    return $cost;
}
```

**Documents**: the line list comes from the order's hierarchy types (`app/Models/Order.php:1294-1343`, `app/Http/Controllers/Api/DocumentController.php:43-87`). A service order has no ITEM hierarchy, so only its service column prints (`design_price`, `print_plate_price`, `plate_diecut_price`, `shipping_price`, `seal_mold_price` or `mockup_total`):
```php
public function getHasDesignServiceAttribute (): bool { ... return in_array(\App\Models\HierarchyType::DESIGN_PRICE, $types) && $this->is_brief_design == 1 && $this->design_price > 0; }
public function getHasMockupServiceAttribute (): bool { ... return in_array(\App\Models\HierarchyType::MOCKUP_PRICE, $types) && $this->mockup_total > 0; }
```
Credit notes split by kind: `config/locopack.php:99-144` (reasons 8–11, type SERVICE / BOTH) and `:197-205` (partial credit: design 2, mold 3, die-cut 4, delivery 5, seal mold 6, mockup 7).

### 2.2 Service quotation

`export-quotation.vue:265-323`:
- one item `{name: product_detail_str, amount: order.amount (1), per_pcs: Σ per_pcs_with_delivery, sum}`;
- `total: order.total`, `isService: true`;
- the service page passes `:packaging_type_id="7"` (`cs.vue:153`), so the plate / die-cut / design extra lines are skipped (`:311`).

`QuotationController@exportFromCS`:
```php
// :36-39
$isService = false;
if($request->has('isService') && $request->isService) { $isService = true; }
// :99-100
$lead_time = isset($data['create_order_data']['packaging_type_id']) && $data['create_order_data']['packaging_type_id'] == 7 ? $data['create_order_data']['products'][0]['production_lead_time'] : null;
$data['show_delivery'] = isset($data['create_order_data']['packaging_type_id']) && $data['create_order_data']['packaging_type_id'] !== 7 ? true : false;
// :131-160 (save + requireWithholdTax)
$servicePriceOfQuotation = prepareQuotationData($data);
if(isset($servicePriceOfQuotation->service_price)) { $beforeCalservicePrice = calculateExcludeVat($servicePriceOfQuotation->service_price); }
if($quotationData['type'] == config('locopack.tax_type_ids.juristic_persons')) {
    ...
    if(isset($data['isService']) && $data['isService']) { $serviceTotalWithholdingTax = calculateWithholdingTax($beforeCalservicePrice); }
} else if($quotationData['type'] == config('locopack.tax_type_ids.government_employee')) {
    ...
    if(isset($data['isService']) && $data['isService']) { $serviceTotalWithholdingTax = calculateWithholdingTax($beforeCalservicePrice, 0.01); }
}
// :265-269
$prepareQuotation = prepareQuotationData($data);
$data['summary'] = $data['total'];
$data['total_product_and_service_without_vat'] = totalProductAndServiceWithoutVat($prepareQuotation, $isService);
$data['quotation_vat_total'] = quotationVatTotal($prepareQuotation);
$data['total_service_without_vat'] = totalServiceWithoutVat($prepareQuotation);
```

Helpers (`helpers.php:3599-3701`):
- `prepareQuotationData` sets `service_price = decode['total']` when `isService` (`:3659-3661`). The item at index 0 gives `price_per_pcs` and `amount`. Other items are recognised by Thai name regex (แม่พิมพ์ / ไดคัท / ออกแบบ) or `key`.
- `totalProductAndServiceWithoutVat($d, true) = ROUND(ROUND(((price_per_pcs × amount) − discount)/1.07, 3), 2)` (`:3602-3605`).
- `totalServiceWithoutVat` adds `ROUND(ROUND(service_price/1.07, 3), 2)` (`:3626-3638`).

The PDF (`resources/views/quotations/pdf-from-cs.blade.php:252` → `summary-quotation-order.blade.php:19-95`) prints those values. `getTotalWithoutVat` / `getVatTotal` (`QuotationController.php:252-263`) count the service amount twice for design / plate / die-cut services (V8), but the PDF does not print them.

### 2.3 Mockup (D-072 add-on) in each calculator

Config: `config/locopack.php:76-80`: `mockup_type_ids [1 => 'mockup_with_print', 2 => 'mockup_no_print']`, `'mockup_price' => 500`. It reaches the browser through `window.configLocopack = {!! json_encode(config('locopack')) !!}` (`resources/views/layouts/app.blade.php:93`). Labels: `resources/lang/th/mockup/mockup.php` ("Mockup พร้อมพิมพ์" / "Mockup ไม่พิมพ์").

UI (`resources/js/components/Mockup/SelectMockup.vue:5-27,72-76`): type select ("ไม่ผลิต" = none) and `amountMockup` ≥ 1. Price display `mockupPrice = window.configLocopack.mockup_price`, total `amountMockup × mockupPrice`. `MockupSummaryDetail.vue:49-64`: `totalWithFee = mockupAmount × mockupPrice + paymentFee`, where the fee is 3 % for payment types **2 or 3** only (the server uses 2, 3, 4).

How mockup quantity enters the calculators. It is **never priced there**: it only replaces the shipping packing quantity.

| Calculator | Code | Effect |
|---|---|---|
| Shared `Calculator::SaleMargin` (folding, tag, label, corrugate) | `app/Models/Calculator.php:238-239` params `$mockupType = null, $mockupAmount = 1`; `:302-307`:<br>`$qty = $data['qty'];`<br>`if(isset($mockupType) && !empty($mockupType) && isMockupOrder($mockupType)) { $qty = $mockupAmount; }` | Packing / carrier quantity = mockup amount (cache keys `:311,337,362` include `$mockupType`). But per-piece delivery still divides by the bulk quantity: `$delivery_price_per_pcs = convertTo2Decimal($delivery_price/$data['qty']);` (`:401`). Margin and price run on the bulk quantity |
| Folding (CS + tag) | `FoldingCalculator.php:1444-1453` passes `mockup_type_id` / `mockup_amount` to `SaleMargin` | as above |
| Folding engines A / B / digital | `Libraries/Folding/A/CalculateCost.php:1732-1733`, `A/CalculateCostDigital.php:1979-1980`, `B/CalculateCost.php:1393-1394` add the mockup to the `delivery-costs` API params | **Dead**: only changes the cache key; the delivery-cost API never reads it. `B/CalculateCost.php:109-110` is commented out |
| Tag & sleeve | `TagAndSleeveCalculator.php:205-206,320-321` → `FoldingCalculator::calculate` | as folding |
| Corrugate | `CorrugateCalculator.php:915-931,1398-1404`; `Api/Corrugate/CorrugateController.php:532-538` | as SaleMargin |
| Label | `LabelCalculator.php:529-537` | as SaleMargin |
| Pouch | `PouchCalculator.php:293-294`; `:477-480`:<br>`if(isset($factory_data['mockup_type_id']) && array_key_exists($factory_data['mockup_type_id'], config('locopack.mockup_type_ids'))) { $factory_data['amount'] = $factory_data['mockup_amount']; }` | **Replaces the whole quantity** after the minimum check (pouch P33). The UI selector is commented out |

`helpers.php:2579-2583`:
```php
function isMockupOrder($mockupTypeId) { return in_array($mockupTypeId, array_keys(config('locopack.mockup_type_ids'))); }
```

Quotation mockup (`QuotationController.php:206-223`):
```php
if ($request->has('form.mockup_type_id') && array_key_exists($request->form['mockup_type_id'], config('locopack.mockup_type_ids'))) {
    $mockupPrice = config('locopack.mockup_price');
    $data['mockup_type_id'] = $request->form['mockup_type_id'];
    $data['mockup_price'] = $mockupPrice;
    $data['mockup_amount'] = $request->form['mockup_amount'];
    $total = convertNumber($request->form['mockup_amount'] * $mockupPrice, 2);
    $fee = 0;
    if (in_array($request->order['payment_type'], [config('locopack.payment_type.credit'), config('locopack.payment_type.online_banking'), config('locopack.payment_type.installment')])) {
        $fee = convertNumber($total * 0.03, 2);
    }
    $data['mockup_fee'] = $fee;
    $data['mockup_total'] = $total;
}
```
The PDF shows `mockup_total + mockup_fee` (`pdf-from-cs.blade.php:209-234`). `summary.blade.php:5-12` takes `without_vat` from the mockup when a mockup is present.

Order mockup: `OrderController.php:269-281` above. The amount is VAT-inclusive (docs divide by 1.07, `OrderController.php:2559-2561,2702`).

Mockup credit on reorder (`OrderController.php:309-317,511-514`):
```php
if ($request->has('order.reorder_order_id') && !empty($request->order['reorder_order_id'])) {
    $orderData = Order::find($request->order['reorder_order_id']);
    if ($orderData) {
        if (isMockupOrder($orderData->mockup_type_id) && $orderData->can_use_mockup_discount) {
            $mockupDiscount = $orderData->mockup_total;
            $order['discount'] = $mockupDiscount;
        }
    }
}
...
// change flag can_use_mockup_discount = false
$updateDiscount = $this->orderRepository->updateData($orderData, ['can_use_mockup_discount' => false]);
```

### 2.4 Design fees (graphic / structure / designer types / brief design)

Settings are read as `empty(env(KEY)) ? (float) config('aws_secrets.secrets.KEY') : (float) env(KEY)`:

| Key | Read sites | Dev `.env` value (`.env:67-75`) |
|---|---|---|
| `SALE_MARGIN_GRAPHIC_DESIGN_FEE_FOLDING` | `Calculator.php:258,279`; `FoldingBoxController.php:110`; `Api/FoldingBoxController.php:141`; `Api/MappingInputAPIController.php:324`; `Api/RigidAPIController.php:711` | 2500 |
| `SALE_MARGIN_GRAPHIC_DESIGN_FEE_LABEL` | `Calculator.php:260,282`; `Label/LabelController.php:87`; `Api/Label/LabelController.php:113`; `MappingInputAPIController.php:326`; `Api/RigidAPIController.php:698` | 1500 |
| `SALE_MARGIN_GRAPHIC_DESIGN_FEE_CORRUGATE` | `Calculator.php:262,284`; `Corrugated/CorrugatedController.php:103`; `Api/Corrugate/CorrugateController.php:78,173`; `MappingInputAPIController.php:328` | 1500 |
| `SALE_MARGIN_GRAPHIC_DESIGN_FEE_TAG` | `TagAndSleeveController.php:120`; `MappingInputAPIController.php:330` | absent (→ 0 in dev) |
| `SALE_MARGIN_STRUCTURE_DESIGN_FEE` | `Calculator.php:252`; `Api/FoldingBoxController.php:142`; `Api/Corrugate/CorrugateController.php:79,175`; `Api/Label/LabelController.php:114` | 1500 |
| `DESIGN_COST_FOR_POUCH` | `PouchCalculator.php:254`; `PouchController.php:56`; `StandardProduct.php:261`; `RigidController.php:917,960,970`; `Api/RigidAPIController.php:45,55`; `MappingInputAPIController.php:332`; `StandardProductController.php:449` | 3000 |
| `DESIGN_COST_FOR_POP` | `StandardProduct.php:263`; `RigidController.php:916,968`; `Api/RigidAPIController.php:53`; `StandardProductController.php:448` | 2500 |
| `SALE_MARGIN_VAT` | `Calculator.php:248,274` | 7 |

Production, UAT and sandbox `.env*` leave all of these empty (`.env.production:57-66`), so production uses AWS secrets. **Those values are not in the repository.**

**SaleMargin** (`app/Models/Calculator.php:241-288,400,424-426`):
```php
if (isset($data['fix_margin'])) {
    $default = [
        'fix_cost' => floatval($locopack_fix_cost),
        'base_margin' => (isset($data['fix_margin']['base_margin'])) ? $data['fix_margin']['base_margin'] :  floatval($locopack_base_margin),
        'target_margin' => floatval($locopack_margin),
        'vat' => (isset($data['fix_margin']['vat'])) ? $data['fix_margin']['vat'] : empty(env('SALE_MARGIN_VAT')) ? (float) config('aws_secrets.secrets.SALE_MARGIN_VAT') : (float) env('SALE_MARGIN_VAT')
    ];
    if (isset($data['fix_margin']['structure_status']) && $data['fix_margin']['structure_status'] == true) {
        $default['structure_design_fee'] = (isset($data['fix_margin']['structure_design_fee'])) ? $data['fix_margin']['structure_design_fee'] : empty(env('SALE_MARGIN_STRUCTURE_DESIGN_FEE')) ? (float) config('aws_secrets.secrets.SALE_MARGIN_STRUCTURE_DESIGN_FEE') : (float) env('SALE_MARGIN_STRUCTURE_DESIGN_FEE');
    } else {
        $default['structure_design_fee'] = 0;
    }
    if (isset($data['fix_margin']['graphic_design_fee']) && isset($data['fix_margin']['design_status']) && $data['fix_margin']['design_status'] == true) {
        $designFee = /* FOLDING */; if ($packaging_type_id == 2) { /* LABEL */ } else if ($packaging_type_id == 3) { /* CORRUGATE */ }
        $default['graphic_design_fee'] = (isset($data['fix_margin']['graphic_design_fee'])) ? $data['fix_margin']['graphic_design_fee'] : $designFee;
    } else {
        $default['graphic_design_fee'] = 0;
    }
} else {
    $default = [ 'structure_design_fee' => 0, ... ];
    if (isset($data['is_brief_design']) && $data['is_brief_design'] == true) {
        $default['graphic_design_fee'] = /* FOLDING; LABEL if pkg 2; CORRUGATE if pkg 3 */;
    } else {
        $default['graphic_design_fee'] = 0;
    }
}
...
$vatInclude = ((100 + $default['vat']) / 100);                       // :400
...
$sum_design_price = $default['graphic_design_fee'] + $default['structure_design_fee'];
// $total = $sum + $delivery_price + $sum_design_price;
$total = $sum_with_delivery + $sum_design_price; // LOC-681          // :424-426
```
The design fee is added **as configured, without VAT**, so the configured amounts are VAT-inclusive (folding port map §sell.ts, `docs/legacy/05-folding-port-map.md:142`).

**CS design selector** (folding v2, `resources/js/components/folding/cs-v2.vue:351-383,1298-1302,1695-1697`):
- `design.type`: 0 รับ template, 1 ออกแบบออนไลน์, 2 จ้างออกแบบ, 3 ออกแบบฟรี;
- the price box is shown for types 2 and 3 only;
- price default = `data.design_price` (the FOLDING setting, `:1375`);
- `designer_type` default 1.

Order mapping (`cs-v2.vue:1890-1895`):
```js
var is_brief_design = 0
if (summary.is_free_design && summary.is_free_design == 1) { is_brief_design = 2 }
else if (summary.design_price > 0) { is_brief_design = 1 }
```

Free design and designer type per calculator:

| Calculator | Free design subtracts the fee | Designer type → PH3 |
|---|---|---|
| Folding | `FoldingCalculator.php:1127-1128,1145` (`design_status == 3`) | `:1224-1228` forces locopack (909) when free |
| Corrugate | `CorrugateCalculator.php:938,987` (`is_brief_design == 3`) | `:1072-1075` forces locopack when free |
| Label | `LabelCalculator.php:542-543` | `:641` (no force when free, V27) |
| Tag | `TagAndSleeveCalculator.php:408,427-429` | `:467-470` forces locopack when free |
| Pouch | own engine: `PouchCalculator.php:438-444` (type 1 → `design_by_yourself`; 2 hire / 3 free; `design_price = !empty($cs_data['design']['price']) ? … : 2500`); `:528` `$total = $factory_data['is_brief_design'] == config('locopack.is_brief_design.free') ? $price_per_pcs_with_delivery * $factory_data['amount'] : $price_per_pcs_with_delivery * $factory_data['amount'] + $design_price;` | `:362-364` |

The design hierarchy is only added when `Σ graphic_design_price > 0` (`Libraries/Hierarchy/GenerateFromProduct.php:43-47`). Codes: `HierarchyPh3::getDesignCodeByDesignerType` (`:51-56`): designer (1) → 900, locopack (2) → 909.

`is_brief_design`: config `by_myself 0, hire 1, free 2` (`config/locopack.php:62-66`). Lang file: 0 ออกแบบบนเว็บ, 1 จ้างออกแบบ, 2 ออกแบบฟรี (`resources/lang/th/design/design.php`).

VAT and WHT exclude a free design (`helpers.php:3486-3515`):
```php
function getTotalWithoutVat($pricePerPcs = 0, $amount = 0, $printPlatePrice = 0, $plateDiecutPrice = 0, $isBriefDesign = 0, $designPrice = 0)
{
    $designPriceData = 0;
    if ($isBriefDesign != 2) { // ออกแบบฟรี
        $designPriceData = round(round($designPrice / 1.07, 3), 2);
    }
    return round(round(($pricePerPcs * $amount) / 1.07, 3), 2)
        + round(round($printPlatePrice / 1.07, 3), 2)
        + round(round($plateDiecutPrice / 1.07, 3), 2)
        + $designPriceData;
}
```

Designer payable: `design_cost` (`OrderController.php:327`; `Api/OrderAPIController.php:1040,1520`) applies `calculateServiceCost` to every **hired** design (calculator or service order), whoever the designer is. It is written but never read in this repository (the external SAP process reads the DB). The design PO is required only for PH3 900 (`OrderController.php:5195-5240`). Designer master: `designers` (`app/Models/Designer.php`; `DesignerController` CRUD `:34-114`).

### 2.5 Samples, prototypes, other services

None. `sample_products` / `sample_product_categories` / `sample_product_rel_products` are showcase groups without prices (`SampleProduct.php:76-83`). There is no consulting or installation service anywhere.

---

## 3. Live vs dead

| Live (production `release` branch, §7) | Half-dead / dead / broken |
|---|---|
| `/cs/service` page, input data, hierarchy, `POST orders` with `is_service`, quotation export with `isService`, service WHT on create and edit, per-service document lines, SERVICE / BOTH credit-note reasons | Edit / reorder of a service order (missing `getDataFromOrder`, `cs/other-products` route) — **broken** |
| Calculator design fees (CS + SME), free design, `design_cost`, designer assignment, design PO (900) | In-order mockup at 500/pc from CS calculators: `create-order.vue:1235-1236` commented out (`/* this.order.mockup_type_id = this.mockupTypeId; … */`), so a **new** order never sends `mockup_type_id`. The order mockup branch runs only on edits (`orderData`, `folding/cs-v2.vue:1927-1931`, `corrugated/cs.vue:1727-1731`) or for service orders — **half-dead** |
| Mockup quantity → shipping packing quantity in `SaleMargin`; pouch quantity override (UI hidden) | Folding A / B / digital mockup params to the delivery-cost API (cache key only) — **dead**; `Folding/B/CalculateCost.php:109-110` commented out |
| Mockup reorder credit (works only on orders that carry `mockup_type_id`, i.e. service mockup orders) | `CreateOrderRequest` mockup rule never applies (V18) — **dead** |
| | `products.structure_design_price` never written (`Product.php:183` fillable only) — **dead column** |
| | `payment_fee` computed then forced to 0 (`OrderController.php:263-265`) — **dead** |

---

## 4. Data read (and cross-check with `docs/legacy/03-legacy-schema.txt`)

| Read | Filter | Schema line |
|---|---|---|
| `hierarchy_ph3 (id, code, text, hierarchy_type_id)` + `hierarchy_types (name)` | `hierarchy_type_id != 1`, `deleted_at IS NULL`; by `code` | `:178`, `:175` ✔ |
| `designers (*)` | `status = 1` (`status` is a **string** column) | `:183` ✔ (`designer_type` default designer, `payment_term`, `supplier_type`) |
| `factory (*)` | none (inactive included, V12) | ✔ |
| `users` | `id = Auth::id()` | ✔ |
| `hierarchy_ph1/2/4/5/6` | default / OTHER codes (`Utils.php:34-218`) | ✔ (dropped by D-030) |
| `print_type` 11 | `QuotationController.php:59`; `FactoryMatchPrintType (factory_id, 11)` lead time in `OrderController.php:138-141` (skipped because `production_lead_time = 7`) and `Converter::quotationFooter:388` | `:105` ✔. The **rows** for print type 11 / packaging type 7 are data only (not in migrations or seeds) |
| `orders` written | `amount, cost_per_pcs, total_cost, price_per_pcs, sum, design_price, design_cost, designer_id, is_brief_design, print_plate_cost/price, plate_diecut_cost/price, shipping_price, seal_mold_cost/price, mockup_type_id/amount/price/fee/total/cost, can_use_mockup_discount, service_withholding_tax, require_withhold_tax, total, discount` | `:75` ✔ — all present (`mockup_cost`, `design_cost` added by migrations `2024_09_27_084403`, `2024_10_08_084815`; mockup columns by `2023_11_22_161803`) |
| `products` written | `print_type_id 11, pattern_id 0, factory_id, graphic_design_price, cost, total, vat, per_pcs_with_delivery, print_plate_*, plate_diecut_*, production_lead_time 7, detail` | `:111` ✔ (`difficult_level_group_id` is NOT NULL with no default; works because `config/database.php:55` `strict => false`) |
| `order_hierarchies`, `order_products`, `quotations.service_withholding_tax` | — | `:182`, `:115` ✔ |
| `order_receipt_references.credit_note_*` (incl. `credit_note_mockup_total`) | — | `:187` ✔ |

There is **no table holding a service, mockup or design price** in the schema. Prices come from config `locopack.service_locopack_margin` 6.5 (`config/locopack.php:286`), `mockup_price` 500 (`:80`), the env / AWS keys in §2.4, `print_types.service` 11 (`:162`), and `print_type_can_plate_diecut [6, 11]` (`:28`, used in `resources/views/emails/orders/from-cs-complete.blade.php:27`).

---

## 5. Input validation

- **Browser** (`cs.vue`, vee-validate):
  - service kind required (`:17`);
  - designer required for design kinds, filtered to the PH3's designer type (`:29-32`);
  - factory required otherwise (`:41`);
  - sell price and cost required (`:55,64,75,84`), but there is **no min / number rule**: values ≤ 0 skip the calculation and leave the other field as it was;
  - postcode required, length 5 (`:101`);
  - detail free text (create box refuses an empty `detail_text`, `create-order.vue:1241-1249`).
- **Server**:
  - `CreateOrderRequest::rules` (`app/Http/Requests/CreateOrderRequest.php:27-41`): `Order::$rules = []` (`Order.php:228`) plus `order.payment_type ∈ {7, 5, 2}`. The mockup rule `$this->request->has('order.mockup_type_id')` never matches (ParameterBag has no dot notation), and it targets the wrong key `mockup_amount` anyway;
  - `OrderController@store` requires an admin (`:144`);
  - **no check of amounts, no recompute**;
  - `$request->order['mockup_amount']` and `$request->order['tax_type']` are read without `isset`, so they throw when missing on those branches.
- `getOrderHierarchy`: no validation (V14). `exportFromCS`: no FormRequest.

---

## 6. Quirks

| # | Quirk (file:line) | Port treatment |
|---|---|---|
| V1 | `cs/service` registered twice (`web.php:696-698` admin group, `:844-846` factory group). The later one wins, so `WebFactory` applies (factory or admin, `Middleware/WebFactory.php`). The menu shows it to CS-type users (`menu.blade.php:77,93`), who get 403. Order creation is admin only (`OrderController.php:144`) | Not ported. Packio RBAC permission for CS quoting of services |
| V2 | Margin maths runs only in the browser; the server stores the client's totals (`OrderController.php:152-153,328`) | **Fix**: server-side calculator, client never trusted |
| V3 | Two input directions (design: gross → cost; others: cost → gross), and the derived field is editable (`cs.vue:65,85`), so the margin is not enforced | **Fix**: one priced direction per item, overrides only through discount memos (B3.5) |
| V4 | Rounding mismatch: browser `Math.round` (`cs.vue:381-384`) vs PHP `calculateServiceCost` ceil-based (`helpers.php:1692-1702,3724-3736`). `design_cost` can be 0.01–0.02 above `total_cost` (sell 1000 → 873.83 vs 873.84; sell 10000 → 8738.31 vs 8738.33) | **Keep both explicitly**: sell / net / VAT with half-up (what customers were quoted); designer payable with `calculateServiceCost` (what was paid). Golden cases cover both |
| V5 | Margin history 0 % → 5.5 % (2024-09-27, `a7e8f3925`) → 6.5 % (2024-10-01, `83ab9a88e`) | **Keep** as a versioned `service` sell-table margin (fallback 6.5). Historic goldens use the margin in force at the order date |
| V6 | Gross-margin form `net = cost / (1 − m)`, not `cost × (1 + m)`; design reverse `cost = net × (1 − m)` | **Keep** exactly |
| V7 | Cost is taken as net with input tax 0 ("ภาษีซื้อ" always 0; the `/1.07` is commented out at `cs.vue:413,415`) | **Keep** maths; the buy cost is net (accounting-design §11 handles a non-VAT vendor) |
| V8 | Service order amounts stored twice: `price_per_pcs` = `design_price` / `print_plate_price` / … = total, and `total_cost` = `print_plate_cost` / `seal_mold_cost` / `mockup_cost` = cost. `Order::summary_cost` (`Order.php:1429`) doubles plate / die-cut / seal-mold cost in reports (`Libraries/ReportOrderLib.php:401-406`); `QuotationController.php:252-263` doubles design / plate / die-cut in the unprinted `total_without_vat` | **Fix**: a service is one order line with one net / VAT / gross and one buy cost |
| V9 | Service-order WHT is 3 % of the whole ex-VAT total, including delivery (901) and mockup (`OrderController.php:413-417`, `:4293-4295`; `QuotationController.php:146-148`) | **Fix**: WHT per line category (D-174): design / service 3 %, hire of work 3 %, delivery = transport 1 % |
| V10 | Government customers: 1 % of the ex-VAT total (`OrderController.php:390-392`, `QuotationController.php:160-162`) | Keep (D-174 note: government uses the same rates until Finance decides) |
| V11 | Preview looks up the designer by `selected_ph3.designer_type` as an id (`cs.vue:114`), so it shows the wrong name | Not ported (display bug) |
| V12 | Factories list unfiltered (`ServiceOrderController.php:21`) | **Fix**: only active factories serving the item |
| V13 | Edit / reorder of service orders broken (`cs.vue:351,353`; `helpers.php:2074` → `cs/other-products` has no route) | Not ported (Packio edits through order revisions) |
| V14 | `GetOHFromPH3` on an unknown code: `$check_ph3->is_service` on null throws (`GenerateService.php:16-17`) | Not ported (PH hierarchy dropped, D-030); validate the item code |
| V15 | PH3 `000` Other (type null) excluded by SQL NULL semantics (`HierarchyPh3.php:67`), so there is no free-form "other service" | Keep (no invented catalogue rows); an `other` item only if the business asks |
| V16 | Service lead time hard-coded to 7 days (`cs.vue:515`); the quotation prints it for packaging 7 (`QuotationController.php:99`) | Setting / attribute per service item (legacy value 7) |
| V17 | In-order mockup at 500/pc: shown and quoted by the CS calculators, but new orders lose `mockup_type_id` (`create-order.vue:1235-1236`). `products[0].amount` is set to the mockup amount (`:1250-1252`) while `order.total` stays the bulk calculator total | **Not ported**: D-192 single `sample` entity; D-194 CS-entered price; 500 kept only as a documented legacy value |
| V18 | `CreateOrderRequest.php:31` dotted `has()` never matches, so `mockup_amount` is never validated; `OrderController.php:273` reads it unguarded | Fix (validated DTO) |
| V19 | Mockup card fee 3 % for payment types 2/3/4, stored as `mockup_fee`, not added to the stored total (`OrderController.php:276-280`); UI adds it for 2/3 only (`MockupSummaryDetail.vue:60`) | Not ported (no payment surcharge in Packio) |
| V20 | Mockup credit on reorder = full `mockup_total` (VAT included), overwrites any other discount, no time window (`OrderController.php:309-317,511-514`) | **Changed** per D-197: 100 % of the sample product price, freight excluded, same spec, 30 days, as its own discount line |
| V21 | Service mockup price = CS amount (`OrderController.php:270`, commit `6795b8945` "edit mockup price condition"); fixed 500 only for non-service | Keep the CS-entered price (D-194) through the `service` calculator |
| V22 | `design_status == true` is a loose comparison: CS "ออกแบบออนไลน์" (type 1) still sends the default fee (`cs-v2.vue:1695-1697`, default `FoldingBoxController.php:110`), so the fee is charged (`Calculator.php:257-265`) and the order becomes hire (`cs-v2.vue:1890-1895`) | **Fix**: the fee only for hired design. To verify against `calculate_logs`; cross-check with the folding / label / tag port maps |
| V23 | Nested-ternary precedence (PHP left-associative): `isset(x) ? x : empty(env) ? config : env` (`Calculator.php:248,252`; `RigidController.php:960`). A non-zero CS-entered structure fee / VAT / rigid design price is **replaced by the AWS-secret value**; a 0 becomes the env value | **Fix**: the sell-table value; CS changes through discount memos |
| V24 | Structure fee charged per sub-pattern (`FoldingCalculator.php:1025-1035`; corrugate C14) | Once per quote (already decided: folding Q2, corrugate C14) |
| V25 | Free design adds then subtracts the fee; stores `design_price > 0` with `is_brief_design = 2`; excluded from VAT / WHT by `!= 2` (`helpers.php:3489,3505`; `OrderController.php:395`) | Keep semantics: a zero-priced design line with a promotion reference (D-181 / D-053: free only through a real promotion) |
| V26 | `design_cost` = 93.5 % of net for **every** hired design, in-house too (`OrderController.php:327`); never read in this repo | Payable only to a freelancer vendor (`design_service_requests.assigned_vendor_id`); none for in-house |
| V27 | Label does not force designer type locopack on free design (`LabelCalculator.php:641`), unlike the other calculators | Not ported (PH dropped); the designer is assigned on the design request |
| V28 | Design fallback 2500 when no price: pouch (`PouchCalculator.php:444`), customer display for unknown packaging (`MappingInputAPIController.php:335`) | Not ported as a constant; a missing sell-table `design_fee` refuses the hired-design option |
| V29 | Production setting values live only in AWS secrets (`.env.production:57-66` empty); dev `.env:67-75` holds 3000 / 2500 / 2500 / 1500 / 1500 / 1500, TAG absent | Seed **no values**: the business enters the sell tables (D-063) |
| V30 | `exportFromCS` uses `$pattern_name` undefined when `detail_text` is empty and a factory is set on save (`QuotationController.php:76-78,185-194`), which throws | Fix: description required |
| V31 | No discount / promotion on service orders (`cs.vue:469-470`) | Packio: discount memos / promotions apply as on other lines |

---

## 7. Did it work in production?

**Yes, as a CS manual form.**

- `.gitlab-ci.yml:129-145` deploys branch `release` to production.
- `origin/release` (`04fbb4ae2`, 2025-03-20) contains "order service v2" (`253f3b454`, 2024-04-19), service WHT (`27929ed56`, 2024-09-27), the service mockup price rule (`6795b8945`, 2024-07-23) and the 6.5 % config (`83ab9a88e`, 2024-10-01).
- For the files in this trace, `HEAD` (`uat-to-dev-for-abbon`) differs from `release` only in unrelated credit-note / manual-GR code in `OrderController.php`.
- Signs of real use: dedicated SERVICE credit-note reasons, the `is_service` WHT paths, and the `design_cost` / `mockup_cost` migrations.

What cannot be confirmed from the repository:
- **how many** service orders exist (needs the DB: `products.print_type_id = 11`);
- the production design-fee settings (AWS secrets).

Service orders write no `calculate_logs` rows (no calculator), so goldens cannot come from `calculate_logs`. Use `orders` + `products` (print type 11) + `order_hierarchies.type_id` instead, together with the margin in force on the order date (V5).

Known broken in production: edit / reorder (V13), CS-type users (V1), in-order calculator mockups (V17).

---

## 8. Suggested port shape

### 8.1 What the new system already decided

- D-100: services are "Instant" from the "legacy calculator" (`docs/decisions.md:131`).
- D-071: hired-design SLA and revision fees (implemented in the `design-services` module).
- D-072 / D-192 / D-193 / D-194 / D-195 / D-197: mockup → one `sample` entity. **Price entered by CS until a signed sample rule set exists, no new formula**; 15-day validity; freight at the customer card; 100 % credit within 30 days.
- D-030: no PH hierarchy.
- D-174: WHT 3 % service / hire of work, 1 % transport.
- D-181: free items only through real promotions.
- Schema already has:
  - `product_types.code = service`, `calculator_key = service` (`docs/schema-design.md:378,1110`);
  - `order_line_type` `design_fee | structure_design_fee | mockup | plate | die_block | shipping | service | extra_revision` (`:678,1179`);
  - `revenue_category` `design_service | mockup | shipping | other_service`;
  - `quotes` check "catalogue product, stock product or product type `service` / RFQ" (`:596`);
  - `sell_margin_kind` `margin | design_fee | structure_design_fee | fix_cost | target_margin` (`prisma/schema/pricing.prisma:78-86`).
- Current code: `src/modules/artwork/mockups.service.ts:16-19` says the mockup is CS-quoted because "the `service` calculator is not ported".

### 8.2 Conclusion

Legacy has **no service calculator beyond "amount typed by CS ± 6.5 % margin + 7 % VAT"**. The most conservative port is a `service` calculator that reproduces exactly that maths over a seeded **service-item catalogue** (names only). It reads its margin from the `service` sell table (fallback 6.5, legacy `config/locopack.php:286`) and VAT from `tax_rates.vat_standard`. It takes its input amount from CS, or from an optional per-factory service price line when a factory has one (legacy has none, so none is seeded). Nothing goes on the storefront as instant unless a price line or sell-table fee exists. **No invented values.**

### 8.3 Catalogue (seed rows: codes and names only, from `ph3.json`)

| item code | legacy PH3 | name TH (legacy) | order `line_type` | revenue | WHT | provider kind | input direction (legacy) |
|---|---|---|---|---|---|---|---|
| `graphic_design` | 900 / 909 | ค่าออกแบบ (designer / admin) | `design_fee` | `design_service` | service | freelancer vendor / in-house | sell gross |
| `plate` | 902 | ค่า Plate พิมพ์ | `plate` | `other_service` | hire_of_work | factory | cost |
| `mold_print` | 904 | ค่า Mold พิมพ์ | `plate` | `other_service` | hire_of_work | factory | cost |
| `die_block` | 903 | ค่า Block Diecut | `die_block` | `other_service` | hire_of_work | factory | cost |
| `mold_diecut` | 905 | ค่า Mold Diecut | `die_block` | `other_service` | hire_of_work | factory | cost |
| `mold_seal` | 906 | ค่า Mold Seal | `service` | `other_service` | hire_of_work | factory | cost |
| `mockup_printed` / `mockup_unprinted` | 907, 910 / 908, 911 | ค่า Mockup พร้อมพิมพ์ / ไม่พิมพ์ | `mockup` (D-192 `sample`) | `mockup` | hire_of_work | factory (external) / in-house (internal) | cost |
| `delivery` | 901 | ค่าขนส่ง | `shipping` | `shipping` | transport | factory / carrier | cost (Packio: prefer `ShippingQuoteService`, D-013) |

The structure design fee has no standalone legacy service (only a calculator add-on). Keep it in the calculators' `structure_design_fee` sell tables; do not add a catalogue item unless asked.

### 8.4 Configuration DTO (`ServiceConfigurationDto`)

```ts
{
  itemCode: ServiceItemCode;                 // catalogue row above
  quantity: 1;                                // legacy always 1 (cs.vue:453-455); >1 only if the business asks
  provider: { kind: 'in_house' } | { kind: 'freelancer'; vendorId } | { kind: 'factory'; factoryId };
  amount:                                      // CS channel only, unless a price line exists
    | { basis: 'buy_cost_net'; value: Decimal }   // non-design items (cs.vue:419-429)
    | { basis: 'sell_gross'; value: Decimal };    // design items (cs.vue:405-418)
  description: string;                         // required (V30); legacy defaulted to the type name
  leadTimeBusinessDays?: number;               // legacy 7 (V16) → item setting
  relatedOrderId?/relatedQuoteId?;             // for samples D-192 / design D-071
  deliveryPostcode?: string;                   // legacy zipcode (required in cs.vue:101); for D-195 sample freight
}
```

**Calculation** (pure; m = `service` sell-table margin % at the quote date, vat = `vat_standard`):
- `buy_cost_net` C → `net = round2HalfUp(C / ((100 − m)/100))`; `gross = round2HalfUp(net × (1 + vat))`; `vatAmount = gross − net`; `margin = net − C`.
- `sell_gross` T → `net = round2HalfUp(round3HalfUp(T / (1 + vat)))`; `vatAmount = T − net`; `cost = round2HalfUp(net × (100 − m)/100)`; `margin = net − cost`.
- Freelancer payable (legacy `design_cost`) = `calculateServiceCost(T)` = `ceil2(ceil3r2(T/(1+vat))) × (100 − m)/100` → `ceil2`. Only for `provider.kind = freelancer` (V26).
- Use `engine/php.ts` for `round` / `ceil` parity. Use half-up for the browser `Math.round`: it is half-up on doubles, so its float artefacts must be reproduced or listed.
- Refuse: amount ≤ 0 or missing; inactive factory / vendor; missing sell-table margin with no fallback.

**Per-factory price list (optional, new)**: component `pl_service_items` (factory × itemCode × unit cost net, versioned, D-040/D-042 governance). When a line exists, `buy_cost_net` comes from it and the quote may be instant on the storefront. Otherwise CS only. **Seed no values.**

**Not ported**:
- fixed mockup 500/pc;
- mockup card fee 3 %;
- mockup quantity as shipping quantity;
- PH hierarchies;
- the duplicated price columns (V8);
- one WHT rate for every service (V9);
- the editable derived field (V3).

### 8.5 Golden cases (made-up inputs, legacy maths)

m = 6.5 % unless noted; VAT 7 %. "UI" = browser rounding; "payable" = `calculateServiceCost`. Values computed with an independent transcription of `cs.vue:381-429` and `helpers.php:1692-1702,2977-2990,3724-3736`. Confirm against PHP / Node before freezing, especially the ceil paths.

| # | Item / input | net | VAT | gross | cost (UI) | payable (PHP) | margin |
|---|---|---|---|---|---|---|---|
| G1 | graphic_design, sell 1000 | 934.58 | 65.42 | 1000.00 | 873.83 | **873.84** (V4) | 60.75 |
| G2 | graphic_design, sell 1500 | 1401.87 | 98.13 | 1500.00 | 1310.75 | 1310.75 | 91.12 |
| G3 | graphic_design, sell 2500 | 2336.45 | 163.55 | 2500.00 | 2184.58 | **2184.59** | 151.87 |
| G4 | graphic_design, sell 3000 | 2803.74 | 196.26 | 3000.00 | 2621.50 | 2621.50 | 182.24 |
| G5 | graphic_design, sell 107 | 100.00 | 7.00 | 107.00 | 93.50 | 93.50 | 6.50 |
| G6 | graphic_design, sell 999.99 | 934.57 | 65.42 | 999.99 | 873.82 | **873.83** | 60.75 |
| G7 | graphic_design, sell 10000 | 9345.79 | 654.21 | 10000.00 | 8738.31 | **8738.33** (PHP net 9345.80) | 607.48 |
| G8 | graphic_design, sell 1 | 0.94 | 0.06 | 1.00 | 0.88 | 0.88 | 0.06 |
| G9 | plate, cost 1000 | 1069.52 | 74.87 | 1144.39 | 1000.00 | — | 69.52 |
| G10 | die_block, cost 1500 | 1604.28 | 112.30 | 1716.58 | 1500.00 | — | 104.28 |
| G11 | mold_seal, cost 2000 | 2139.04 | 149.73 | 2288.77 | 2000.00 | — | 139.04 |
| G12 | plate, cost 935 (exact) | 1000.00 | 70.00 | 1070.00 | 935.00 | — | 65.00 |
| G13 | mockup_printed, cost 450 | 481.28 | 33.69 | 514.97 | 450.00 | — | 31.28 |
| G14 | delivery, cost 800 | 855.61 | 59.89 | 915.50 | 800.00 | — | 55.61 |
| G15 | mold_print, cost 3333.33 | 3565.06 | 249.55 | 3814.61 | 3333.33 | — | 231.73 |
| G16 | mold_diecut, cost 500 | 534.76 | 37.43 | 572.19 | 500.00 | — | 34.76 |
| G17 | G9 + juristic WHT | WHT base = `calculateExcludeVat(1144.39)` = 1069.52 → 3 % = **32.09** (legacy and port: hire of work 3 %) | | | | | |
| G18 | G9 + government WHT | 1 % of 1069.52 = **10.70** | | | | | |
| G19 | G14 + juristic WHT | legacy 3 % = 25.67 (V9); **port transport 1 % = 8.56** | | | | | |
| G20 | plate, cost 0.5 | 0.53 | 0.04 | 0.57 | 0.50 | — | 0.03 |
| G21 | plate, cost 1000 at margin **5.5** (2024-09-27..30) | 1058.20 | 74.07 | 1132.27 | 1000.00 | — | 58.20 |
| G22 | plate, cost 1000 at margin **0** (before 2024-09-27) | 1000.00 | 70.00 | 1070.00 | 1000.00 | — | 0 |
| G23 | graphic_design, sell 1000 at margin 5.5 | 934.58 | 65.42 | 1000.00 | 883.18 | — | 51.40 |
| G24 | refusals | cost 0 / negative / missing; inactive factory; unknown item code → `service.*` refusal (legacy: no computation, V14) | | | | | |
| G25 | reference only, **not ported** | legacy in-calc mockup 3 × 500 = 1500 gross (net 1401.87, VAT 98.13), card fee 45.00 for payment types 2/3/4 (`OrderController.php:274-279`) | | | | | |

### 8.6 Order and payables mapping

- **One order line per service** (`line_type` and `revenue_category` from §8.3), VAT on the line, WHT per `wht_category` (D-174).
- Buy side by provider:
  - **factory**: PO line (B5.3) at the buy cost;
  - **freelancer**: vendor payable = the `calculateServiceCost` amount (legacy `design_cost`), wired to `design_service_requests.assigned_vendor_id`;
  - **in-house**: no payable.
- Design items open a `design_service_request` (D-071). Mockup items become a D-192 `sample`: standalone or attached, approval holds production (D-193), 15-day quote (D-194), freight on the customer card (D-195), credit per D-197.
- Free services only through a promotion (D-181 / D-053).

### 8.7 Files

Legacy:
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Http/Controllers/ServiceOrderController.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/resources/js/components/service-orders/cs.vue`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Libraries/Hierarchy/GenerateService.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Libraries/Hierarchy/GenerateFromProduct.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Models/HierarchyPh3.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Models/HierarchyType.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/database/json/hierarchies/ph3.json`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/database/seeds/importHierarchy.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Http/Controllers/OrderController.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Http/Controllers/QuotationController.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Http/Requests/CreateOrderRequest.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Helpers/helpers.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Models/Calculator.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Models/Order.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Http/Controllers/Api/DocumentController.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/resources/js/components/plugin-boxes/create-order.vue`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/resources/js/components/plugin-boxes/export-quotation.vue`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/resources/js/components/Mockup/SelectMockup.vue`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/resources/js/components/Mockup/MockupSummaryDetail.vue`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/config/locopack.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/routes/web.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Models/PouchCalculator.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Models/FoldingCalculator.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Models/CorrugateCalculator.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Models/LabelCalculator.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Models/TagAndSleeveCalculator.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/app/Http/Controllers/RigidController.php`
- `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web/.gitlab-ci.yml`

Packio:
- `/Users/superball/Collective/Packio/Packio-API/docs/decisions.md` (D-030, D-071, D-072, D-100 note line 131, D-174, D-181, D-192–D-197)
- `/Users/superball/Collective/Packio/Packio-API/docs/legacy/00-domain-context.md` (lines 69, 71, 166, 170, 193, 264)
- `/Users/superball/Collective/Packio/Packio-API/docs/legacy/03-legacy-schema.txt` (lines 75, 105, 111, 115, 175, 178, 182, 183, 186, 187)
- `/Users/superball/Collective/Packio/Packio-API/docs/schema-design.md` (lines 378, 596, 678, 787, 1110, 1179-1181)
- `/Users/superball/Collective/Packio/Packio-API/src/modules/artwork/mockups.service.ts`
- `/Users/superball/Collective/Packio/Packio-API/src/modules/checkout/order-pricing.ts`
- `/Users/superball/Collective/Packio/Packio-API/prisma/schema/pricing.prisma`

Cross-references to existing port maps for the in-calculator design fees: folding Q2, corrugate C14, tag T18, pouch P31 / P33, standard product S20 / S21 (`/Users/superball/Collective/Packio/Packio-API/docs/legacy/05-*-port-map.md`).

---

## 9. Packio port (decisions, U-B6 service, 2026-10-01)

Accepted under the user's standing instruction (2026-10-01); recorded in `docs/update-2026-09-29-gap.md` §U-B6 service.

1. **No invented formula** (D-194, §8.2): the `service` calculator reproduces legacy's only service maths — the CS
   service page (`cs.vue:381-429`) — exactly: from a **net buy cost** C, `net = r₂(C ÷ (1 − m))`, `gross = r₂(net × (1 +
   VAT))`; from a **VAT-inclusive sell price** T (design), `net = r₂(r₃(T ÷ (1 + VAT)))`, `cost = r₂(net × (1 − m))`,
   where r is the browser's `Math.round` half-up (V4). The freelancer payable of a hired design keeps the PHP
   `calculateServiceCost` (ceiling) rounding (V4, V26).
2. **Service items** are catalogue products of product type `service` (no new table, no invented rows; the legacy PH3
   names are listed in §8.3 for the business to create).
3. **Instant path** (D-100, D-043): a factory may hold `pl_service_prices` lines (service item × print type → net buy
   cost per unit, lead time); with a line the quote engine prices it like any calculator (cost basis). No line = RFQ /
   CS. **No price lines are seeded** outside the dev fixture.
4. **CS path** (D-194): `admin.csService.price` applies the same maths to the amount CS enters (cost or, for design,
   the sell price) with Packio's margin and the dated VAT; nothing is trusted from the browser (V2, V3).
5. **Margin**: Packio's `service` sell table on the quantity (legacy `service_locopack_margin` 6.5 % — a business
   value entered in the table, not a constant; V5); VAT the dated `vat_standard` rate.
6. **Quantity**: legacy always 1; Packio prices a quantity as quantity × the unit amounts.
7. **Shipping**: a service ships nothing — the quote carries no shipping line (legacy delivery service 901 is its own
   item priced by cost).
8. **Not ported**: the fixed 500 THB in-order mockup and its card fee (V17, V19 — samples follow D-192–D-197), PH
   hierarchies (D-030), one WHT rate for every service (V9 — D-174 per line category), editable derived fields (V3),
   the broken edit / reorder paths (V13).
