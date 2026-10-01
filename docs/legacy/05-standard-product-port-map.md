# Standard product calculator — legacy port map (U-B6, B2.3 Deliverable 2.3)

> Reference for porting legacy standard-product pricing ("สินค้ามาตรฐาน"). **Legacy is read-only and never run** (D-005).
> Treatment follows the folding / corrugate / label rule (user decision 2026-09-26): **maths ported exactly, orchestration
> and state bugs fixed and listed as deviations** in `docs/pricing-validation-standard-product.md`. §9 records how Packio
> ports it.

Source root: `/Users/superball/Collective/Packio/Packio-API/legacy/locopack-web` (written as `LW/` below). Every reference is file:line. "Throws" means a PHP notice or warning that the error handler turns into an exception (error_reporting(-1)).

---

## 0. Main finding

- **What it is.** A flat catalogue of ready-made SKUs. Each row in `standard_products` is one sellable SKU from **one factory**: `factory_id` and `locopack_code`. It has descriptive attributes: material, type, shape, shoulder, neck, colour, size and `cc` (FKs to the `standard_product_*` lookup tables). It also has dimensions `w/l/h` in **mm**, shipping data, `stock`, `status` and `design_status` (`LW/database/migrations/2024_08_16_094222_modify_standard_products_table.php`, `LW/app/Models/StandardProduct.php:14-55`).
  - There are **no variants**. A colour or size variant is a separate row. Attributes are filters only and never change the price.
  - `product_type` (`StandardProduct.php:84-90`) has 7 values: 1 bottle & tube (ขวดและหลอด), 2 mailbox / shipping packaging, 3 pouch (ซอง), 4 printable pouch (ซองพิมพ์ได้), 5 seasonal, 6 P.O.P display, 7 food tray.
- **Pricing is a price-table lookup plus a formula.** `standard_product_prices` holds quantity tiers per SKU: `min`, `max` and `price`. `price` is the **factory buy price per piece**, `decimal(10,4)` (`2024_08_20_091351_create_standard_product_prices_table.php`). The sell price per tier is built like this:
  1. Add the factory's `locopack_fix_cost` to the buy price.
  2. Apply a gross margin, `locopack_margin`, from `factory_match_print_type` (factory × print type 9), as cost/(1−m). Round up to 0.01.
  3. Add VAT (`SALE_MARGIN_VAT`). Round up to 0.01.
  4. Add a VAT-inclusive delivery charge per piece, from one of 5 shipping methods. Round up to 0.01.
  - Source: `LW/app/Libraries/StandardProduct/Utils.php:13-30`, `CalculatePrice.php:12-73`.
- **Factory buy vs sell.** Buy price = `standard_product_prices.price` (stored as `cost_per_pcs` / `cost`). Sell = margin + VAT. **No `locopack_margins` tiers and no `Calculator::SaleMargin`.** The margin is one flat percentage per factory. There is no base margin and no discount_from_margin.
- **Printing options.** None in the price. The only add-on is a **design fee** (`StandardProduct::getDesignPriceAttribute:257-268`):
  - pouch-printing (type 4) uses `DESIGN_COST_FOR_POUCH` — the same setting the pouch calculator uses;
  - POP and tray (6, 7) use `DESIGN_COST_FOR_POP`;
  - any other type returns `null`.
  - The customer API records the fee but **does not add it to the total**. CS adds it on the client.
- **Relation to rigid.** `Rigid` (`rigids`, `rigid_prices`, `Models/Rigid.php`, `Api/RigidAPIController.php`) is the **v1 predecessor**, from 2022 to mid-2024.
  - In 2024-08 the attribute tables were renamed (`materials`→`standard_product_materials`, `types`, `shapes`, `shoulders`, `necks`, `rigid_colors`→`standard_product_colors`, `size_texts`→`standard_product_sizes`) (`2024_08_16_094222_modify_standard_products_table.php`).
  - Seeders copied the rigid "sets" (`category = 3`, body/cap flattened) into `standard_products` and `rigid_prices` into `standard_product_prices` (`database/seeds/MigrateDataFromRigidsToStandardProductsSeeder.php:18-88`, `MigrateDataFromRigidPricesToStandardProductPricesSeeder.php:18-37`).
  - Both `config/locopack.php:8-9` ids `rigid` and `standard_product` = **4**, and both use print type `std_product` = **9** (`config/locopack.php:161`).
  - The algorithm is the same family: tiers, `recheckPrice`/`sortPrices`, the fixed last-step delivery 0.88/1.67/0.15 and the hard-coded box table. StandardProduct is a cleaned-up copy.
- **Pouch "printing" standard products** (type 4) are just catalogue SKUs. Their only link to the pouch calculator is the design fee setting (`DESIGN_COST_FOR_POUCH`) and the shared pouch shipping packer (`ShippingUtils::calShippingCostPouch`).
- **DB tables holding prices:**
  - `standard_product_prices` — buy tiers;
  - `factory_match_print_type` where `print_type_id = 9` — `locopack_margin`, `locopack_fix_cost`, `lead_time`;
  - `standard_products` — shipping inputs and `min_price_per_pcs_with_delivery`, a cached display price;
  - `zipcodes_delivery_zone` and carrier rate classes, for delivery;
  - hard-coded box/zone prices in `Utils.php:41-54`.

---

## 1. Entry points

| Route | Controller | Purpose | Status |
|---|---|---|---|
| `GET api/standard-products/{id}` (`routes/api.php:643`, public) | `Api/StandardProductAPIController@show:23-51` | product detail + tracking log; `per_pcs` = cached `min_price_per_pcs_with_delivery`; `is_contact_admin` hard-coded `false` (:46) | live; unknown id → `null->makeHidden` throws (:49) |
| `GET api/standard-products/{id}/zipcode/{zipcode}/step-prices` (`api.php:644`, zipcode regex `[0-9]{5}`) | `@getStepPrices:53-57` → `CalculatePrice::getSteps($id,$zip)` (not raw) | customer tier table `{price,min,max}` | live |
| `GET api/standard-products/{id}/checkout?amount&zipcode&promo_code&is_redeem&reward_id` (`api.php:645`) | `@checkout:59-91` → `findPrice` | customer total for a quantity incl. promo / redeem discount | live; amount outside the tiers throws (:74/:88 `Undefined index: total`) |
| `POST api/standard-products/create-order` (`api.php:551`, inside the `auth:api` group 302-552) | `@createOrder:93-320` | customer order: re-prices server-side, inserts order/product, decrements stock, hierarchy, promo/redeem logs, LINE/Teams notification | live |
| `GET api/standard-products/product-type/{type_id}` (`api.php:646`) | `@getProductByType:322-334` | list by **attribute** `type_id`, `status = 1` | live, not pricing |
| `GET api/v2/products`, `GET api/product-categories`, `GET api/categories` | `ProductAPIController@allProducts:861-884` / `productCategory:849` → `LW/app/Libraries/ProductData.php:88-93,200-226` | listing shows `min_price_per_pcs_with_delivery as per_pcs`; statuses [1,2]; v2 also needs `ph6_id NOT NULL` | live |
| `GET cs/standard-products` (`web.php:685`, admin group `web.admin` 545-754 inside `auth:web`+`checkApiAuth` 535) | `StandardProductController@cs:424-427` → view `standard-products/cs.blade.php` → Vue `resources/js/components/standard-products/cs.vue` | CS quoting screen | live |
| `GET cs/standard-products/get-data` (`web.php:687`) | `@getCSData:429-453` | factories (packaging 4, active), product types, active promos, zipcodes, both design fees, designer types | live |
| `GET cs/standard-products/get-products?factory_id&product_type` (`web.php:692`) | `@getProducts:455-469` | SKUs with `status != 0` (includes 3 = backend-only) | live |
| `GET cs/standard-products/{id}/get-prices?zipcode` (`web.php:688` admin **and** `web.php:1099` **public, no auth**) | `@getPrices:471-485` → `getSteps($id,$zip,true)` | **raw** tiers incl. `cost_per_pcs`, `target_margin`, delivery cost | live; the public duplicate leaks buy price and margin; missing zipcode → TypeError (string param, `CalculatePrice.php:12`) |
| `POST cs/standard-products/get-order-hierarchy` (`web.php:690`) | `@getOrderHierarchy:487-492` | SAP PH codes | live |
| CS create order → `POST orders` (`OrderController@store:132+`) via `plugin-boxes/create-order.vue` | trusts client prices from cs.vue; decrements stock `OrderController.php:362-368` | live |
| CS quotation → `export-quotation-box` (`cs.vue:173-184`) | client prices | live |
| CS edit / reorder / from quotation (`cs.vue:86-92,100-143`) → `orders/{id}/get-cs-input` (`Order::getCSInput:971-1030`), `quotations/{id}/get-cs-input` | | **broken**: neither returns `standard_product_id` (Order.php:1001-1030 returns `rigid_id` only), so `changeProduct()` never fires |
| `cs/change-factory/standard-products/{order}` (`web.php:897`) | `ChangeFactoryController@index:22-37` / `changeData:40-` | | **unsupported**: no packaging-4 case (`:45-72`); packaging resolved from pattern only (`:30-31`) |
| `GET standardProduct/update-min-price-per-pcs-with-delivery` (`web.php:1058`, group 1039-1071 `auth:web`+`checkApiAuth`, no admin check) | `@updateMinPricePerPcsWithDelivery:915-937` | recomputes the cached listing price (zipcode 10900) | live, **manual only**; one throwing SKU rolls back the whole batch |
| Admin CRUD / import / export: `standardProducts` (`web.php:1050-1059`), `standardProductPrices` (`web.php:1061-1065`), stock `stocks/*` (`web.php:648-651`) | `StandardProductController`, `StandardProductPriceController`, `StockHistoryController` | catalogue and tier maintenance | live |
| `GET move-standard-product-images` (`web.php:1116`, public) | `@moveImages:939-961` | S3 housekeeping | live, unauthenticated |
| Rigid v1: `GET api/rigids/{id}/getPrices|calculate|customize`, `rigids/calculate-delivery`, `POST api/rigids` (`api.php:524,616-622`); web `rigids/*`, `rigids/CreateOrderFromCS` (`web.php:663-671`) | `RigidAPIController:623-679`, `Rigid::getPrices/calculate:306-585` | | routed but **orphaned**: the CS route moved to StandardProduct (`web.php:684-692`, old ones commented); customer listing calls to `Rigid::get_products` commented out (`ProductAPIController.php:88-128`, `MappingInputAPIController.php:562-570`). Not ported |

**Front-end callers.**
- CS: `cs.vue` only (registered at `resources/js/app.js:94`).
- The customer site (Nuxt) is **not in this repo**. Only the API contracts above can be verified.
- `standard_products` has no `calculate_logs` (`Calculator.php:99` is the only writer). The fixture `test/fixtures/legacy/calculate_logs_202609232216.sql` has **no** `rigid_id` and no standard product rows.

---

## 2. Pipeline (verbatim PHP)

### 2.1 Inputs
- Customer:
  - `id`, `zipcode` (5 digits), `amount` in **pieces**, integer ≥ 1 (`Requests/API/CheckoutStandardProductRequest.php:26-29`, `StandardProductCreateOrderRequest.php:26-36`);
  - `promo_code`, `is_redeem` ("true"/"false" string), `reward_id`, `design` ('design' | 'online' | other), `uuid`.
- CS (`cs.vue`):
  - `zipcode` (default 10900, :36), SKU, amount in **packs** when `packsize` and `delivery_packsize_per_pack` are set;
  - pieces = packs × packsize × dppp (`cs.vue:460-465` = script `setAmount`);
  - design mode, design fee (editable), discount type (0 none / 1 promo code / 2 manual baht).

### 2.2 Tier table — `CalculatePrice::getSteps` (`LW/app/Libraries/StandardProduct/CalculatePrice.php:12-73`)
```php
$std_product = StandardProduct::find($id);                                   // :14 (SoftDeletes scope)
...
$steps = StandardProductPrice::where('standard_product_id', $id)->orderBy('min')->get(); // :18 (SoftDeletes scope)
foreach ($steps as $s => $step) {
    $last_step = $steps->count() == ($s + 1) ? true : false;
    $min = $steps->count() > 1 && $last_step ? $steps[$s - 1]->max : $step->min;   // last tier starts at previous max
    $max = $step->max;
    $amount = $last_step ? $step->min : $step->max;                                  // only for cost/sum display
    $delivery_amount = $last_step ? Utils::FIX_DELIVERY_AMOUNT_IN_LAST_STEP : $step->min; // 10000 (Utils.php:11) or tier min

    $total_cost = $step->price * $amount;
    $sale_price_data = Utils::costToSalePrice($step->price, $std_product->factory_id);
    $sale_price_per_pcs = $sale_price_data['sale_price'];
    $target_margin = $sale_price_data['target_margin'];
    $sum = $sale_price_per_pcs * $amount;

    $cal_delivery_result = self::getDelivery($id, $std_product->shipping_cal_method, $delivery_amount, $zipcode);
    if ($cal_delivery_result['status'] == false) { return ['status' => false, 'msg' => $cal_delivery_result['msg']]; }
    $delivery_data = $cal_delivery_result['data'];
    if ($last_step) {
        $fix_delivery_price_last_step = Utils::getFixDeliveryPerPcsInLastStep($std_product->product_type);
        if (!empty($fix_delivery_price_last_step)) {
            $delivery_data['delivery_per_pcs'] = $fix_delivery_price_last_step;
            $delivery_sales_vat = calculateVat($delivery_data['delivery_per_pcs']);      // default 7 %
            $delivery_data['delivery_per_pcs'] = $delivery_sales_vat['with_vat'];
            $delivery_data['delivery_price'] = $delivery_data['delivery_per_pcs'] * $amount;
        }
    }
    $per_pcs_with_delivery = convertTo2Decimal($sale_price_per_pcs + $delivery_data['delivery_per_pcs']);
    $sales_data = ['price' => $per_pcs_with_delivery, 'min' => $min, 'max' => $max];
    // get_raw: merges $delivery_data + cost, cost_per_pcs, per_pcs, sum, target_margin, per_pcs_with_delivery, total
}
$result = self::sortPrices($result);                                                 // :71
```
Notes:
- Tier bounds are **inclusive on both ends**. The last tier's displayed `min` is the previous tier's `max`, so the boundary quantity belongs to both tiers.
- Units: `price` is per **piece**. Tiers are in pieces. There is no pack-level pricing.
- The fixed last-step delivery (`Utils.php:56-65`) is per product type: `1 => 0.88, 2 => 1.67, 3 => 0.15, 4 => 0.15`. Types 5, 6 and 7 return `null` (no override). Values are ex-VAT; 7 % is added, so they become 0.95, 1.79, 0.17, 0.17.
- `delivery_cost` and `delivery_cost_per_pcs` are **not** overridden. They stay at the carrier cost for 10000 pieces.
- The carrier is still called at qty 10000 for the last tier even when the override applies. If that call fails, the whole table fails.

`sortPrices` (`CalculatePrice.php:133-149`; same as `Rigid::recheckPrice:365-380`):
```php
foreach ($data as $key => $row) {
    if (isset($data[$key - 1]) && $row['price'] >= $data[$key - 1]['price']) {
        for ($i = $key - 1; $i >= 0; $i--) {
            if (isset($data[$i]) && $data[$key]['price'] >= $data[$i]['price']) {
                $data[$key]['min'] = $data[$i]['min'];
                unset($data[$i]);
            }
        }
    }
}
usort($data, function ($a, $b) { return $a['min'] <=> $b['min']; });
```
A later (larger-quantity) tier whose price is ≥ an earlier tier's price **absorbs** that earlier tier's range at its own (higher) price.

### 2.3 Sell price per piece — `Utils::costToSalePrice` (`Utils.php:13-30`)
```php
$factory_match_print_type = FactoryMatchPrintType::where(['factory_id' => $factory_id, 'print_type_id' => config('locopack.print_types.std_product')])->first();
$fix_cost = $factory_match_print_type->locopack_fix_cost;
$margin_percent = $factory_match_print_type->locopack_margin;
$sum = $cost + $fix_cost;
$vat_percent = empty(env('SALE_MARGIN_VAT')) ? (float) config('aws_secrets.secrets.SALE_MARGIN_VAT') : (float) env('SALE_MARGIN_VAT');
$margin = calculateMargin($sum, $margin_percent);
$vat = calculateVat($margin['with_margin'], $vat_percent);
return ['target_margin' => $margin_percent, 'fix_cost' => $fix_cost, 'margin' => $margin, 'vat' => $vat, 'sale_price' => $vat['with_vat']];
```
Helpers (`LW/app/Helpers/helpers.php`):
```php
function convertTo2Decimal($per_pcs) { return floatval(round(ceil($per_pcs * 100) / 100, 2)); }          // :1692  ceil to 0.01, IEEE noise (1.1 → 1.11, 0.07 → 0.08)
function calculateMargin($price = 0, $margin_percent = 3) {                                              // :1735
    if ($price > 0) { $sale_price = $price / (1 - ($margin_percent / 100)); $margin_price = $sale_price - $price;
        return ['with_margin' => convertTo2Decimal($sale_price), 'margin_price' => convertTo2Decimal($margin_price)]; }
    else { return []; } }
function calculateVat($price = 0, $vat_percent = 7) {                                                    // :1751
    if ($price > 0) { $with_vat = $price * (1 + ($vat_percent / 100)); $vat_price = $with_vat - $price;
        return ['vat_price' => convertTo2Decimal($vat_price), 'with_vat' => convertTo2Decimal($with_vat)]; }
    else { return []; } }
```
So `sale = ceil2( ceil2((buy + fix) / (1 − m/100)) × (1 + VAT/100) )`. This is two-step rounding, unlike `sell.ts::saleMargin`, which rounds once.

### 2.4 Quantity lookup — `CalculatePrice::findPrice` (`:75-104`)
```php
$prices = self::getSteps($id, $zipcode, true);
$delivery_data = self::getDelivery($id, $std_product->shipping_cal_method, $amount, $zipcode);   // real amount, used only for real_* fields
$selected_step = array_values(array_filter($prices['data'], function ($step) use ($amount) {
    return $amount >= $step['min'] && $amount <= $step['max'];
}));
$first_key = array_key_first($selected_step);           // polyfill symfony/polyfill-php73
if ($first_key !== null) {
    $result = $selected_step[$first_key];
    $result['cost'] = $result['cost_per_pcs'] * $amount;
    $result['sum'] = $result['per_pcs'] * $amount;
    $result['total'] = $result['per_pcs_with_delivery'] * $amount;
    $result['real_shipping_box'] = $delivery_detail['amount_of_shipping_box'];
    $result['real_delivery_by'] = $delivery_detail['delivery_by'];
    $result['real_delivery_cost'] = $delivery_detail['delivery_cost'];
    $result['real_delivery_vehicle'] = $delivery_detail['delivery_vehicle'];
    $result['delivery_amount'] = $amount;
}
return ['status' => true, 'data' => $result];          // [] when no tier matches, still status true
```
- The **delivery charge per piece comes from the tier.** It is computed at the tier's `min`, or at 10000 for the last tier. It is not computed at the ordered quantity.
- Delivery for the real quantity is computed and must not fail, but it only fills the `real_*` fields.

### 2.5 Delivery — `CalculateDelivery` (`LW/app/Libraries/StandardProduct/CalculateDelivery.php`)

**Dispatch** (`CalculatePrice.php:106-131`) on `shipping_cal_method` (`StandardProduct.php:78-82`):
- 1 `ByBoxAndZone`, 2 `ByCorrugate`, 3 `ByWLH`, 4 `ByPouch`, 5 `ByPack`;
- anything else → `['status'=>false,'msg'=>"Cannot found shipping_cal_method : X"]`.

**Constructor** (`:20-27`): `StandardProduct::find`, then `Factory::where('factory_id', …)->first()`. A missing factory throws later on `$this->factory->zipcode`.

**ByBoxAndZone (`:29-92`)** — bottles/tubes. Flash zone of the **destination** only. The factory origin is ignored.
```php
$delivery_zone = ZipcodeDeliveryZone::where(['shipping' => ZipcodeDeliveryZone::DELIVERY_FLASH, 'zipcode' => $this->zipcode])->first();  // no type FROM/TO filter
$zone = $delivery_zone->areacode ?? 'UPCC';
$item_size = ($this->std_product->w * $this->std_product->l * $this->std_product->h) / 1000;   // mm³ → cm³
foreach ($boxs as $box) {                                   // Utils::getBoxes :32-39: 40x60x40, 40x60x30, 30x44x22 cm
    $box_size = $box['w'] * $box['l'] * $box['d'];
    $item_amount_per_box = floor(($box_size / $item_size) * 0.6);
    $box_amount = ceil($this->amount / $item_amount_per_box);
    $box_price = $box_prices->where('zone', $zone)->where('box_id', $box['id'])->first()['price'];   // Utils::getBoxPrices :41-54
    if ($zone == 'REMOTE') { $box_price += $box_prices->where('zone', 'UPCC')->where('box_id', $box['id'])->first()['price']; }
    $sum = $box_price * $box_amount;
    $vat_percent = empty(env('SALE_MARGIN_VAT')) ? (float) config('aws_secrets.secrets.SALE_MARGIN_VAT') : (float) env('SALE_MARGIN_VAT');
    $vat = calculateVat($sum, $vat_percent);
    $calculated[] = [... 'sum' => $sum, 'vat_price' => $vat['vat_price'], 'total' => $vat['with_vat']];
}
usort($calculated, function ($a, $b) { return $sort = $a['total'] <=> $b['total']; });
$best_option = $calculated[0];
$delivery_price_per_pcs = convertTo2Decimal($best_option['total'] / $this->amount);
$delivery_cost_per_pcs = convertTo2Decimal($best_option['sum'] / $this->amount);
$delivery_cost = ceil($delivery_cost_per_pcs * $this->amount);
$sales_vat = calculateVat($delivery_price_per_pcs);          // second VAT (default 7 %)
$delivery_price_per_pcs = $sales_vat['with_vat'];
$delivery_price = $delivery_price_per_pcs * $this->amount;
// data: delivery_from = factory zipcode, amount_of_shipping_box/delivery_by/delivery_vehicle = null
```
Box prices per box, in THB:

| box | BKK/GBKK | UPCC | REMOTE |
|---|---|---|---|
| 1 | 225 | 170 | 50 (+UPCC) |
| 2 | 195 | 150 | 50 (+UPCC) |
| 3 | 105 | 90 | 50 (+UPCC) |

**ByCorrugate (`:94-140`)** — mailbox / RSC SKUs:
```php
$pattern_id = $this->std_product->box_type == 'RSC' ? 19 : 99;
$calculated = $oShippingUtil->calShippingCostCorrugate($this->std_product->gsm, $this->std_product->dl, $this->std_product->dw, $this->amount,
    $this->factory->zipcode, $this->zipcode, $pattern_id, $this->std_product->flute_type, '', '', floatval($this->std_product->weight_per_box_gram), $this->factory->toArray());
if (empty($calculated[0]) || empty($calculated[0][0])) { return ['status' => 0, 'msg' => 'Calculate delivery byCorrugate failed.']; }
$best_option = $calculated[0];
$delivery_cost = $best_option[0];
$delivery_cost_per_pcs = convertTo2Decimal($delivery_cost / $this->amount);
$delivery_price = $best_option[0];
$delivery_price_per_pcs = convertTo2Decimal($delivery_price / $this->amount);
$sales_vat = calculateVat($delivery_price_per_pcs);
$delivery_price_per_pcs = $sales_vat['with_vat'];
$delivery_price = $delivery_price_per_pcs * $this->amount;
// amount_of_shipping_box = $best_option[1] ? $best_option[1] / $this->amount : null  (cartons per piece)
```
- Packer: `ShippingUtils::calCostCorrugate_WithShipping:305-461`. Weight per box = `$weight_per_box_gram/1000` when `gsm === NULL`, else `((dW*dL)/1e6*gsm)/1000` (`:317-322`). Total weight = `ceil(w*qty)` (`:324`).
- Lay-out on 60 cm (`:349-361`), RSC fold (`:333-339`), `amtBoxFromSize = ceil(((layH*tickness)/10)/60)` (`:377`), `weightPerCorrugateBox = ceil((weightAllBox/amtBoxFinal)+0.5)` (`:403`), oversize / plus-size (`:427-440`), `totalCost = ceil(amtBoxFinal * costPerBox)` (`:439`).
- Cheapest carrier: `calShippingCostCorrugate:602-642`. Already ported in `05-corrugate-port-map.md` §9 (`shipping/packing/corrugate-packing.ts`).

**ByWLH (`:142-184`)** — seasonal / POP. The cost of **one** shipping pack, spread over the pieces in it:
```php
$amount_per_box = $this->std_product->delivery_packsize_per_pack * $this->std_product->packsize;
$calculated = $oShippingUtil->calShippingCostByWLH(1, $this->factory->zipcode, $this->zipcode, $this->factory->toArray(),
    $this->std_product->w_for_shipping / 10, $this->std_product->l_for_shipping / 10, $this->std_product->h_for_shipping / 10,
    $this->std_product->delivery_weight_kg_per_pack);
if (empty($calculated[0]) || empty($calculated[0][0])) { return ['status' => 0, 'msg' => 'Calculate delivery byWLH failed.']; }
$delivery_cost = $best_option[0];
$delivery_cost_per_pcs = convertTo2Decimal($delivery_cost / $amount_per_box);
$delivery_price_per_pcs = convertTo2Decimal($delivery_price / $amount_per_box);
$sales_vat = calculateVat($delivery_price_per_pcs);
$delivery_price_per_pcs = $sales_vat['with_vat'];
$delivery_price = $delivery_price_per_pcs * $amount_per_box;
// delivery_amount = $amount_per_box (not the ordered amount)
```
`ShippingUtils::calShippingCostByWLH:671-708`:
```php
foreach ($shipper as $shipping) {
    $canReceive = $this->checkCanReceiveArea($fromPostalCode, $toPostalCode, $shipping);
    if ($canReceive) {
        $boxWLHcm = $w + $l + $d;
        list($stdWLH, $maxWLH) = $this->getBox_WLHcm_FromArea($toPostalCode, $fromPostalCode, $shipping);
        if ($boxWLHcm > 0 && $boxWLHcm < $maxWLH) {
            $cost = $obj->findCostByWeightAndSize($weightPerPcs, $toPostalCode, $fromPostalCode, $zoneOfShippingTo, $zoneOfShippingFrom, $boxWLHcm, $w, $l, $d);
            $plusSizeCost = $obj->findWeightSizePlus(19, 1, $weightPerPcs, $w, $l, $d);
            $totalDeliveryCost = $qty * ($cost + $plusSizeCost);
        }
    }
    if ( !empty($totalDeliveryCost) && $totalDeliveryCost > 0 ) { $aCostShipping[$shipping] = array($totalDeliveryCost, $qty, null, $shipping); }
}
usort($aCostShipping, function($a, $b) { return $a[0] - $b[0]; });
$first_key = array_keys($aCostShipping);
return array ($first_key[0] => $aCostShipping[$first_key[0]]);
```
- `$aCostShipping` is not initialised, and `$totalDeliveryCost` is not reset per carrier.
- With no carrier available, this throws before CalculateDelivery's failure check.

**ByPouch (`:186-218`)** — pouch / pouch-printing:
```php
$calculated = $oShippingUtil->calShippingCostPouch($this->amount, $this->factory->zipcode, $this->zipcode, $this->factory->toArray());
if (empty($calculated[0]) || empty($calculated[0][0])) { return ['status' => 0, 'msg' => 'Calculate delivery byWLH failed.']; }  // msg copy-paste
$delivery_cost = $best_option[0];
$delivery_cost_per_pcs = convertTo2Decimal($delivery_cost / $this->amount);
$delivery_price_per_pcs = convertTo2Decimal($delivery_price / $this->amount);
$sales_vat = calculateVat($delivery_price_per_pcs);
$delivery_price_per_pcs = $sales_vat['with_vat'];
$delivery_price = $delivery_price_per_pcs * $this->amount;
// amount_of_shipping_box = $best_option[1] / $this->amount
```
`ShippingUtils::calShippingCostPouch:710-788`:
- `$weightPerPcs = 0.01000` kg;
- `findMaximizeBoxFromWeight($qty*$weightPerPcs, $fromPostalCode, $toPostalCode, …)` — the from/to arguments are **swapped** relative to the signature at `:113`.

The loop:
```php
$adjustWeightSpacial = ($shipping===SHIPPING_NINJA_VAN)?1950:2000;
if ($remainAmount >= 2100 && $maxWeightPerBox > (3000*$weightPerPcs) ) { $amt = ($remainAmount <= 3000)?$remainAmount:2000; $remainAmount = $remainAmount - 3000; $w = 33; $l = 52; $d = 23; $amt = 3000; }
else if (($remainAmount >= 500 && $remainAmount <= $adjustWeightSpacial) || ($remainAmount >=$adjustWeightSpacial && $maxWeightPerBox > ($adjustWeightSpacial*$weightPerPcs))) {
    $amt = ($remainAmount <= $adjustWeightSpacial)?$remainAmount:$adjustWeightSpacial; $remainAmount = $remainAmount - $adjustWeightSpacial; $w = 26.7; $l = 44.5; $d = 16.5; }
else if ($remainAmount >= 100 && $remainAmount <= 400) { $remainAmount = $remainAmount - 100; $w = 16; $l = 29; $d = 5; $amt = 100; }
$boxWLH = $w + $l + $d;
if ($boxWLH > 0) { $weightPerBox = ceil(($weightPerPcs*$amt) + 0.5); $cost = $obj->findCostByWeightAndSize($weightPerBox, ...); $totalDeliveryCost += $cost; }
else { $remainAmount = 0; }
$countAmtBox++;
```
- Remainders of 1–99 or 401–499 pieces get **no box and no cost**. A quantity made only of such a gap → no carrier entry → `$first_key[0]` Undefined offset → **throws**.
- Already documented and ported (`05-pouch-port-map.md` P32, `shipping/packing/pouch-packing.ts`).

**ByPack (`:220-253`)** — a fixed price per shipping pack:
```php
if (empty($this->std_product->delivery_price_per_pack) || empty($this->std_product->delivery_packsize_per_pack) || empty($this->std_product->packsize)) {
    return ['status' => 0, 'msg' => 'Calculate delivery byPack failed.'];
}
$amount_per_box = $this->std_product->delivery_packsize_per_pack * $this->std_product->packsize;
$delivery_cost = $this->std_product->delivery_price_per_pack * ceil(($this->std_product->delivery_packsize_per_pack * $this->std_product->packsize) / $amount_per_box);  // always × 1
$delivery_cost_per_pcs = $delivery_cost / $amount_per_box;              // not rounded
$delivery_price_per_pcs = convertTo2Decimal($delivery_cost/$amount_per_box);
$sales_vat = calculateVat($delivery_price_per_pcs);
$delivery_price_per_pcs = $sales_vat['with_vat'];
$delivery_price = $delivery_price_per_pcs * $amount_per_box;
```
The charge per piece is `ceil2(ceil2(price_per_pack / pcs_per_pack) × 1.07)`. It does not depend on quantity, so a partial pack is never charged extra.

**Shared carrier plumbing** (`ShippingUtils.php`):
- constructor `:18-36` — carriers from `ENABLE_SHIPPING_LIST`; zones from `zipcodes_delivery_zone` split by `type` FROM/TO;
- `filterShippingByFactory:790-821` — `factory.shipping_enabled_*`. A factory flag for a carrier not in `ENABLE_SHIPPING_LIST` → `objShipping[$shipping]` undefined → throws;
- comparators `$a[0] - $b[0]` truncate to int (`:631-633, :701-703, :783-785`).

### 2.6 Options and variants
- No options in the price. Attribute FKs are display and filter only (`Rigid::filter_data:270-303`, `getProductByType`).
- `cc`, `size_id` and `color_id` are separate SKUs, never price modifiers.

### 2.7 Design fee (`StandardProduct.php:257-268`)
```php
if ($this->design_status == self::DESIGN_STATUS_CAN_DESIGN) {
    if ($this->product_type == self::PRODUCT_TYPE_POUCH_PRINTING) { return empty(env('DESIGN_COST_FOR_POUCH')) ? (float) config('aws_secrets.secrets.DESIGN_COST_FOR_POUCH') : (float) env('DESIGN_COST_FOR_POUCH'); }
    else if (in_array($this->product_type, [self::PRODUCT_TYPE_POP, self::PRODUCT_TYPE_TRAY])) { return empty(env('DESIGN_COST_FOR_POP')) ? ... 'DESIGN_COST_FOR_POP' ...; }
} else { return 0; }       // can-design with another type → null
```
- **Customer order** (`StandardProductAPIController.php:171,186-190`): `graphic_design_price = design=='design' ? design_price : 0`, `is_brief_design = 1`, `template_status_id = 1`, `graphic_status = 2`, `design_price` stored, but **`total` excludes it** (`:149, :170, :199`). `orders.design_cost` is not set.
- **CS** (`cs.vue:496-500`): `this.sum = (step.price * amount) + this.designPrice - this.discount; if (this.form.design == 'free') this.sum -= this.designPrice`.
  - The design fee input is shown only for types 4 and 6 (`cs.vue:66, 77-82`).
  - The default fee is chosen with `data.product_type == 4`, but the get-prices response has no `product_type`, so it always picks `DesignPOP` (`cs.vue:446-451`).
  - `is_brief_design`: free = 2, design = 1 (`cs.vue:532-537`).

### 2.8 Discounts (API, `StandardProductAPIController.php:70-82, 118-149`)
- **Promo:** applied only when `!empty(promo_code) && $request->is_redeem == "false"` (the literal string). It calls `Promotion::calculateDiscount($price['total'], $code)` (`Models/Promotion.php:144-188`, described in `05-pouch-port-map.md`: fixed / percent `round` / step; `min_price`, `max_price`; limits not checked).
- **Redeem:** `is_redeem === "true"` → `HelperService::calculateRedeemPoint($reward->points)` = `intval(round(points * 0.1))` (`Services/HelperService.php:111-116`, `config/locopack.php:231`).
- Then `total -= discount`. The discount is taken off the VAT-inclusive goods + delivery total.
- **CS:** promo via `api/promotions/calculate` on `perPcs * amount` (`cs.vue:473-480`), or a manual baht amount.

### 2.9 VAT
- All customer prices include VAT.
- Product price: `SALE_MARGIN_VAT` (env, else aws_secrets), applied once after the margin.
- Delivery: `calculateVat` with its **default 7 %** (not the setting). `ByBoxAndZone` also applies `SALE_MARGIN_VAT` to the box cost first, so VAT is charged twice.

### 2.10 Margins
- Only `factory_match_print_type.locopack_margin` and `locopack_fix_cost` for (factory, print_type 9), first row, no status filter (`Utils.php:15-17`).
- No `locopack_margins` and no SaleMargin (grep confirms).
- `margin` and `min_order_amount` in that table are not read.

### 2.11 Stock (`LW/app/Libraries/StandardProduct/Stock.php:12-41`)
```php
$amount_before_update = $std_product->stock;
$amount = $order->amount;
$amount_after_update = $std_product->stock - $amount;
if ($std_product->stock <= 0 || $amount_after_update < 0) { return ['status' => 0, 'msg' => 'Out of stock']; }
StockHistory::create([... 'action' => StockHistory::ACTION_MINUS, ..., 'remark' => "order: {$order->order_code} ({$order->id})", 'user_id' => $order->user_id]);
$std_product->stock = $amount_after_update; $std_product->save();
```
- Stock is checked only **after** the order row is inserted (API `:204-215`, CS `OrderController.php:362-368`).
- There is no row lock. There is no restock on cancellation; `ACTION_PLUS` is only used by the manual form.
- Manual adjustment (`StockHistoryController@store:28-48`) trusts the client-computed `amount_after_update` (`resources/views/stocks/create.blade.php:36,148`).
- Pricing endpoints ignore stock. CS shows it (`cs.vue:52`).
- Default stock is 10000 (`2024_09_17_133232_add_stock_column_to_standard_products_table.php`).

### 2.12 Minimum order
- No explicit minimum. The effective minimum is the first tier's `min`: quantities outside every tier throw (§7).
- CS adds a client-side minimum (`cs.vue:419-427`):
  - one pack = `packsize × dppp` if set; else type 6 → 1, type 4 → 1000, others → 100;
  - then overridden by `prices[0].min`.

### 2.13 Lead time (`StandardProduct.php:240-255`)
- pouch 3 days; pouch printing 30; seasonal 15; POP 9;
- tray: 3 if it cannot be designed, else 30;
- otherwise `ceil(factoryMatchPrintType->lead_time)`.
- Stored as `products.production_lead_time` (API `:173`).

### 2.14 Order persistence (API `createOrder:151-201`)
- `products`:
  - `price_per_pcs = per_pcs` (ex delivery);
  - `per_pcs_with_delivery`;
  - `delivery_cost = delivery_cost_per_pcs(tier) × amount`;
  - `delivery_price = delivery_per_pcs(tier) × amount`;
  - `amount_of_shipping_box = real_shipping_box` (a fraction per piece, into an integer column);
  - `cost = cost_per_pcs × amount`;
  - `total`, `target_margin`, `print_type_id = 9`, `factory_id`.
- `orders`: `price_per_pcs = per_pcs_with_delivery`, `shipping_price`, `sum = per_pcs × amount`, `cost_per_pcs`, `total_cost`, `discount_type`, `discount`, `total`.
- Hierarchy: `GenerateFromProduct::generateStandardItem:62-72` (PH3 STD code, PH4/PH5 OTHER, PH6 = `standard_products.ph6_id`, `Hierarchy/Utils.php:182-187`). An empty hierarchy returns 200 with "(C:PH00)" and no commit (`:220-222`).
- CS orders: client-built payload (`cs.vue:538-591`), stored by `OrderController@store`, which re-rounds `cost` per piece to 2 decimals (`OrderController.php:342-345`) but **does not re-price**.

### 2.15 Cached listing price (`StandardProductController.php:915-937`)
```php
$std_products = StandardProduct::whereIn('status', [1, 2, 3])->whereNotNull('ph6_id')->get()->each->setAppends([]);
foreach ($std_products as $std_product) {
    $prices = CalPriceLib::getSteps($std_product->id, $default_zipcode);      // 10900
    if ($prices['status'] == 1 && isset($prices['data']) && isset($prices['data'][count($prices['data']) - 1])) {
        StandardProduct::where('id', $std_product->id)->update(['min_price_per_pcs_with_delivery' => $prices['data'][count($prices['data']) - 1]['price']]);
    }
}
```
The cached price is the price of the last (cheapest) tier.

---

## 3. Live vs dead code

| Code | Status |
|---|---|
| `Libraries/StandardProduct/CalculatePrice.php` (all), `Utils.php` (all), `CalculateDelivery.php` (all 5 methods), `Stock.php` | live |
| `StandardProduct` accessors `unit_name`, `delivery_day`, `design_price`, `show_paper_modal` (factory 24 only, :270-273), `product_detail` | live (appended to every serialisation, :59-65) |
| `StandardProductAPIController` show / getStepPrices / checkout / createOrder / getProductByType | live |
| `StandardProductController` cs, getCSData, getProducts, getPrices, getOrderHierarchy, CRUD, import/export, updateMinPricePerPcsWithDelivery, storeUpload, moveImages | live (min price: manual only) |
| `StandardProductPriceController` CRUD / import / export; `StockHistoryController` | live |
| CS edit / reorder / from-quotation paths in cs.vue | broken (no `standard_product_id` in get-cs-input) |
| `cs/change-factory/standard-products/{order}` | broken / unsupported |
| `sample-product:update-min-price` cron (`Console/Commands/SampleProduct.php:38-67`, `Kernel.php:33`) | **does not touch standard products** (reprices sample products via `Calculator::FromSME`) |
| `Models/Rigid.php` pricing (`getPrices`, `recheckPrice`, `findPrice`, `calculate`, `calculateDelivery`, `costToSalePrice`), `Api/RigidAPIController` pricing, `RigidController@updateMinPrice:1210-1228`, `CreateOrderFromCS` | v1, routed but orphaned (listing calls commented); **not ported** |
| `Rigid::get_products` from `ProductAPIController` / `MappingInputAPIController` | dead (commented) |
| `CalculateDelivery` commented `delivery_calculated` debug (:88,136,180,214,245-249) | dead |
| `Utils::getBoxes/getBoxPrices` hard-coded tables | live (data in code) |

---

## 4. Data read

| Table (03 schema line) | Columns read | Filters | Where |
|---|---|---|---|
| `standard_products` (03:192 **incomplete**: only `stock`; the full DDL is in `2024_08_16_094222_modify_standard_products_table.php`) | id, factory_id, product_type, shipping_cal_method, w, l, h, w/l/h_for_shipping, dl, dw, gsm, flute_type, box_type, weight_per_box_gram, packsize, delivery_packsize_per_pack, delivery_price_per_pack, delivery_weight_kg_per_pack, design_status, stock, ph6_id, locopack_code, name, description, min_price_per_pcs_with_delivery, status | `find` → `deleted_at IS NULL` only; **no status filter** in getSteps / checkout / createOrder; listing: status IN (1,2) (+ph6 NOT NULL for v2); CS: status != 0; min price: status IN (1,2,3) + ph6 NOT NULL | `CalculatePrice.php:14,77`, `CalculateDelivery.php:25`, `ProductData.php:91,206-207`, `StandardProductController.php:464-467,918-920` |
| `standard_product_prices` (03:191) | standard_product_id, min, max, price | `standard_product_id = ?`, `deleted_at IS NULL`, order by `min` | `CalculatePrice.php:18` |
| `factory_match_print_type` (03:40) | locopack_fix_cost, locopack_margin, lead_time | `factory_id = ?`, `print_type_id = 9`, `first()`, no status, no deleted_at (no SoftDeletes) | `Utils.php:15`, `StandardProduct.php:224-227,253` |
| `factory` (03:41) | zipcode, shipping_enabled_* (whole row → `toArray()`) | `factory_id = ?` first, no status | `CalculateDelivery.php:26` |
| `zipcodes_delivery_zone` (03:152) | shipping, type, zipcode, areacode | ByBoxAndZone: `shipping='flash' AND zipcode=?` (no `type`); other methods: whole table | `CalculateDelivery.php:31,96,144,188` |
| carrier rate classes (`Libraries/Shipping/{Ninjavan,Scgexpress,Deliveree,Dhl,Flash,Kob,KPon1,KPon2}.php`), `flute_type` (`ShippingUtils::getFluteType:142-156`), `shipping_provider_*` (KPON) | | | via ShippingUtils |
| `standard_product_{materials,types,shapes,shoulders,necks,colors,sizes}` (03 lists the **pre-rename** names `materials:70`, `necks:71`, `shapes:126`, `shoulders:127`, `types:145`, `rigid_colors:116`, `size_texts:129`) | id, name | `status = 1`, `deleted_at IS NULL` | admin / import only |
| `hierarchy_ph6` (03:181) | id, code, text | via `standard_products.ph6_id` (cached 600 s) | `Hierarchy/Utils.php:182-187` |
| `images` (03:59) | path | `type_id = 35` cover / 36 images, `sub_id = std id` | `StandardProductController.php:479`, `StandardProduct.php:174-177,214-217` |
| `stock_histories` (03:137) | written | | `Stock.php:24-32` |
| `products` (03:111) `standard_product_id`; `user_designs` (03:162) `standard_product_id`; `orders`, `order_products`, `order_hierarchies`, `promotions`, `promotion_logs`, `user_promotions`, `rewards`, `rewards_configs`, `tracking_product_logs` (03:142) | written / read on order | | `StandardProductAPIController.php:25-26,127-139,204-258` |
| `factory_match_packaging` (03:38) | packaging_type_id = 4, factory_packaging_status = 1, factory_status = 1 | CS factory list | `StandardProductController.php:432-438` |

**Settings / env**
- `SALE_MARGIN_VAT`, `DESIGN_COST_FOR_POUCH`, `DESIGN_COST_FOR_POP` (env, else `config('aws_secrets.secrets.*')`);
- `ENABLE_SHIPPING_LIST`, `AWS_PATH`, `APP_ENV` (notifications);
- config: `locopack.print_types.std_product` = 9, `packaging_type_ids.standard_product` = 4, `discount_type.*`, `bathPerPoint` = 0.1, `designer_types`.

**Cross-check vs docs**
- `00-domain-context.md:79`:
  - "attributes … cap_type/sub_type" — those are rigid-only, not on `standard_products`;
  - "`min_price_per_pcs_with_delivery` recomputed nightly" — wrong (manual endpoint only; the 00:00 cron at `:240` reprices sample products).
- `00-domain-context.md:82`: "30 standard product" image type — StandardProduct uses **35/36** (`UploadFile.php:42,47-48`); 30 is the old `UPLOAD_STANDARD_PRODUCT`.
- `03-legacy-schema.txt:192`: the `standard_products` definition is missing (the extractor read only the later add-column migration).
- `03-legacy-schema.txt:70,71,116,126,127,129,145`: old names of tables renamed in 2024-08.

---

## 5. Input validation

- **Customer** (`CheckoutStandardProductRequest.php:26-29`, `StandardProductCreateOrderRequest.php:26-36`):
  - `zipcode` `required|digits:5`, `amount` `required|integer|min:1`;
  - create-order adds `id` `required|exists:standard_products,id`, which accepts soft-deleted rows (then `findPrice` fails → 401 JSON);
  - `promo_code`, `is_redeem`, `reward_id`, `design`, `uuid` are not validated (commented :30-35);
  - `status` is never checked, so inactive (0) and backend-only (3) SKUs can be priced and ordered by id;
  - there is no check that the amount fits a tier, is a pack multiple or is in stock before pricing.
- **getStepPrices:** route regex only (`api.php:644`).
- **CS get-prices:** none (a null zipcode gives a TypeError).
- **Admin:**
  - `StandardProduct::$rules = []` (`StandardProduct.php:57`).
  - `StandardProductPrice::$rules` is a **list** `['standard_product_id','min','max','price']` (`StandardProductPrice.php:21-26`), so the rules are bound to attributes "0".."3". They are never present, so no validation runs. Null min/max/price hit DB NOT NULL → 500.
- **Price Excel import** (`StandardProductPriceController.php:146-175`):
  - every field is in the `null` list, so the `number` type check is skipped (`HelperService.php:83`);
  - `uniqueBy = locopack_code` with `checkFieldExists = []` → no duplicate rejection;
  - no min ≤ max, overlap or gap checks;
  - an unknown `locopack_code` → `$standardProduct[0]` Undefined offset throws (`:213`, outside try).
- **Product Excel import** (`StandardProductController.php:327-422, 494-715`):
  - not-null and number checks;
  - lookups by name; errors are collected and the import rolls back.

---

## 6. Quirks (S1..S30)

| # | Quirk (file:line) | Port treatment |
|---|---|---|
| S1 | Two-step rounding: `ceil2(margin)` then `ceil2(VAT)`; `convertTo2Decimal` IEEE artefacts (1.1→1.11, 0.07→0.08, 2.2→2.21) (`helpers.php:1692,1735-1764`, `Utils.php:21-22`) | **Keep** (as pouch P17); add `calculateMargin` / `calculateVat` ports to `engine/php.ts` |
| S2 | Margin = flat `factory_match_print_type.locopack_margin` per factory, no quantity / price tiers, no base margin (`Utils.php:15-17`) | Keep the semantics: seed a `standard` sell-margin table with one line per factory (or fallback pct); allow tiers later |
| S3 | `calculateMargin` / `calculateVat` return `[]` for price ≤ 0 → buy + fix = 0 throws (`Utils.php:21-22`) | Fix: reject a 0 buy price at import / `PricingError` |
| S4 | Missing `factory_match_print_type` (factory, 9) row → throws (`Utils.php:16`, `StandardProduct.php:253`) | Fix: `price_line_missing` error |
| S5 | Last tier `min` = previous tier `max` → the boundary qty is in two tiers; the first wins (`CalculatePrice.php:25`, `:87-93`) | Keep the inclusive bounds; at a shared bound take the lower-quantity tier (document) |
| S6 | Delivery per piece per tier is computed at the tier **min** (or 10000 for the last tier), not the ordered qty; the ordered-qty result only fills `real_*` (`CalculatePrice.php:28,36`, `:82-101`) | Keep for parity in "catalogue mode"; Packio target: delivery as its own quote line (D-013) on the real qty |
| S7 | Fixed last-tier delivery 0.88 / 1.67 / 0.15 / 0.15 (ex-VAT) by product type, VAT 7 % hard-coded; `delivery_cost` not overridden (`Utils.php:56-65`, `CalculatePrice.php:41-49`) | Keep as data (per-product-type "flat delivery per piece" setting), VAT from `vat_standard` |
| S8 | `sortPrices` merges a later tier whose price ≥ an earlier tier: the earlier range takes the **higher** price; non-adjacent absorption; `isset($data[$key-1])` skips after an unset (`CalculatePrice.php:133-149`) | Keep (golden C, B); flag to business — fix candidate is to keep the cheaper price |
| S9 | No tier matches → `findPrice` returns `[]` with status true → checkout throws (`StandardProductAPIController.php:74,88`); createOrder → 500 "Server error" | Fix: `qty_out_of_range` error with min / max |
| S10 | ByBoxAndZone: **double VAT** (`SALE_MARGIN_VAT` on the box sum, then 7 % again) (`CalculateDelivery.php:48-49,72-73`) | Not ported in that form (carrier rate cards); if kept for parity, flag |
| S11 | ByBoxAndZone: destination flash zone only, no `type` filter, origin ignored; unknown zone (e.g. `island`, `Flash.php:178`) → null price → `calculateVat(0)` → throws (`:31-49`) | Fix: proper zone / rate card |
| S12 | ByBoxAndZone: `h` null → item size 0 → division by zero throws; item > 60 % of the 30×44×22 box → `item_amount_per_box = 0` → throws (`:33,41-42`) | Fix: skip cartons that don't fit; error if none |
| S13 | ByBoxAndZone: `delivery_cost = ceil(ceil2(sum/amount) × amount)` over-states cost (14850 → 14900 at 10000 pcs) (`:70-71`) | Keep for parity in cost fields; Packio uses the real carrier cost |
| S14 | ByWLH: `amount_per_box = dppp × packsize`; null → division by zero throws; one pack only, cost spread over its pieces (`:146-167`) | Fix: validate pack data; real packing in the shipping module |
| S15 | ByWLH carrier loop: `$aCostShipping` uninitialised, `$totalDeliveryCost` leaks to the next carrier, no carrier → throws (`ShippingUtils.php:671-707`) | Fix |
| S16 | ByPouch: quantities in 1–99 / 401–499 gaps get no carton; alone → throws; from/to swapped in `findMaximizeBoxFromWeight` (`ShippingUtils.php:727,730-775`) | As pouch P32 (`pouch-packing.ts`) |
| S17 | ByPack: `ceil(pack/pack)` always 1 → delivery per piece independent of qty, partial packs not charged; `delivery_cost_per_pcs` unrounded (`:225-228`) | Keep the per-piece formula if parity is needed; Packio: packs = ceil(qty / pack_pcs) in the shipping module |
| S18 | Delivery VAT uses `calculateVat` default 7 %, product VAT uses `SALE_MARGIN_VAT` (`CalculateDelivery.php:72,121,165,199,229`) | Fix: one dated `vat_standard` |
| S19 | `shipping_cal_method = 0` (seeder maps null → 0, `MigrateDataFromRigidsToStandardProductsSeeder.php:83`) → "Cannot found shipping_cal_method" (`CalculatePrice.php:126-127`) | Data-migration check: such SKUs are unpriceable |
| S20 | Design fee recorded but **not added** to the API order total (`StandardProductAPIController.php:149,171,199`); CS adds it (`cs.vue:497`); `design_cost` not set | Fix: add the design fee once per quote (as pouch P31) |
| S21 | `design_price` accessor returns null for can-design types other than 4/6/7 (`StandardProduct.php:257-268`); CS defaults to the POP fee because `data.product_type` is undefined (`cs.vue:446-451`) | Fix: design fee per product type from the sell table |
| S22 | Promo applied only when `is_redeem == "false"` (string) (`:72,121`) | Fix: explicit discount input |
| S23 | No status check on the price / checkout / order API; soft-deleted passes `exists` (`StandardProductCreateOrderRequest.php:27`) | Fix: sellable = active (1, 2); backend-only (3) for CS only |
| S24 | Stock: checked after insert, no lock (race), no restock on cancel; manual adjustment trusts the client total (`Stock.php:14-34`, `StockHistoryController.php:36-40`) | Fix: reserve / commit in the stock module, server-computed adjustments |
| S25 | Public `GET cs/standard-products/{id}/get-prices` leaks buy price and margin (`web.php:1099`) | Not ported (CS endpoint behind auth) |
| S26 | Cached `min_price_per_pcs_with_delivery`: manual endpoint, zipcode 10900, one failure rolls back all; new imports set 0 (`StandardProductController.php:656,915-937`) | Fix: compute "from" price on demand / on price-list publish |
| S27 | `products.amount_of_shipping_box` gets a per-piece fraction (`StandardProductAPIController.php:165`, `CalculateDelivery.php:130`) | Fix: store cartons |
| S28 | CS edit / reorder / quotation load fails (`Order.php:1001-1030`, no `standard_product_id`); change-factory unsupported (`ChangeFactoryController.php:45-72`) | Not ported as-is; new order edit re-prices from a catalogue variant |
| S29 | `Order.php:586` `config('packaging_type_ids.standard_product')` (missing `locopack.`) → null | Fix |
| S30 | Price import: `Log::info(msg, $ex->getMessage())` TypeError on the failure path (`StandardProductPriceController.php:234`); replaces tiers by soft delete with no versioning (`:224-225`) | Fix: effective-dated price-list versions |

---

## 7. Did it work in production?

**Evidence it ran in production:**
- the 2024-08/09 migrations and seeders moved real rigid data;
- the CS screen and customer endpoints are wired;
- `ProductData` lists `standard_products` on the home page and in v2 product search.

**Missing evidence:** there are no `calculate_logs` or fixtures for standard products, so traffic volume can't be confirmed.

**The happy path works** when the SKU has all of these:
- an FMPT row for (factory, 9);
- a factory row;
- valid shipping data for its method;
- contiguous tiers;
- an amount inside the tiers.

**Paths that always throw or fail:**
1. SKU whose factory has no `factory_match_print_type` row for print type 9 → every price call throws (`Utils.php:16`).
2. A tier with buy + fix ≤ 0 → throws (`helpers.php:1737-1747` → `Utils.php:22`).
3. `shipping_cal_method` 0 or unknown → status false for every call (`CalculatePrice.php:126`). All migrated rigids with null method.
4. ByBoxAndZone with `h` null, an item larger than 60 % of the small carton, or a destination flash zone other than BKK/GBKK, UPCC or REMOTE → throws.
5. ByWLH with null `packsize` or `delivery_packsize_per_pack`, or no carrier able to deliver → throws.
6. ByPouch SKU with a tier `min` (or last-tier qty 10000 failing carriers) in 1–99 or 401–499 → the **whole tier table** throws, so the SKU is unpriceable. Customer amounts in those gaps also throw in `findPrice`.
7. ByPack with any of its 3 fields empty → status false.
8. Checkout with an amount below the first `min` or above the last `max` → 500 (`StandardProductAPIController.php:74/88`). createOrder → 500 "Server error".
9. `show` / `checkout` for an unknown id → throws (`:49`, `:64`).
10. CS get-prices without zipcode → TypeError.
11. CS edit / reorder / from-quotation for a standard product → no product loaded (broken UI). change-factory → unsupported.
12. A factory with a carrier flag not in `ENABLE_SHIPPING_LIST` → throws for methods 2, 3 and 4.
13. Price import failure path → TypeError (S30). Unknown `locopack_code` in the price file → throws.

---

## 8. Suggested port shape

**Catalogue.**
- One catalogue product per legacy family, or 1:1 per legacy SKU initially.
- Each legacy `standard_products` row → a **variant / SKU**: `sku = locopack_code`, `factory_sku = factory_code`, attributes as variant options (material, type, shape, shoulder, neck, colour, size, cc), dimensions `w/l/h` mm, `product_type` → catalogue category.
- Unit from `unit_name` (`StandardProduct.php:229-238`): bottle & tube → `piece`, shown as "ขวด" (bottle, a label only); pouch and pouch printing → `pouch`; others → `piece`.
- Pack data:
  - `packsize × delivery_packsize_per_pack` = pieces per shipping pack;
  - an optional sell-in-packs flag (legacy CS only);
  - shipping attributes per variant: method, carton dims, weight per pack, price per pack, corrugate gsm / dl / dw / flute / box_type.
- Stock: the variant stock in the `stock` module (unit piece / pouch). Reserve on order, commit on payment, release on cancel (fixes S24). Pricing does not read stock; the order step checks it.
- Status: active / contact-admin / backend-only / inactive. Sellable on web = 1, 2; CS = 1, 2, 3.
- Lead time: per product type (3 / 30 / 15 / 9 / tray 3|30) or from the factory price list `lead_time`.

**Factory price list.**
- One list per **factory × product type "standard"** (print type 9), with **effective-dated versions**.
- Lines: `variant_id`, `qty_min`, `qty_max` (inclusive), `unit_buy_price` per piece (4 dp).
- Optional `fix_cost` per factory, from legacy `locopack_fix_cost`.
- Import: one version per upload. Validate:
  - `min ≤ max`, no overlap;
  - contiguity — warn on gaps;
  - price > 0;
  - SKU exists.

**Sell side.**
- A `standard` sell-margin table: margin % (legacy flat `locopack_margin` per factory → fallback line; quantity / price tiers possible later), `fixCost`, design fee per product type:
  - pouch printing → legacy `DESIGN_COST_FOR_POUCH`;
  - POP / tray → `DESIGN_COST_FOR_POP`;
  - others → null.
- VAT = dated `vat_standard`.
- Implement `standardSell(buy, fix, marginPct, vatPct)` = `ceil2(ceil2((buy+fix)/(1-m)) * (1+vat))` with the IEEE `convertTo2Decimal`. Do **not** reuse `saleMargin`, whose rounding differs.

**Calculator** (`src/modules/pricing/calculators/standard/`):
- `standard-snapshot.loader.ts` — variant + active price-list version + sell table.
- `standard-calculator.ts` — `tierTable()` reproduces `getSteps`, using the last-tier min = previous max and the `sortPrices` merge (S8, keep), and `priceFor(qty)` reproduces `findPrice`. Out of range → `PricingError('qty_out_of_range')`.
- Delivery has two modes:
  - **(a) parity mode**: legacy per-piece delivery folded into the displayed tier price — needed for the catalogue "from" price and to match legacy quotes. The five methods are ported as packers: `box-zone` (hard-coded cartons and zone prices, double VAT behind a flag), `corrugate` (reuse `corrugate-packing.ts`), `wlh` (one pack), `pouch` (reuse `pouch-packing.ts`), `pack` (price per pack). The fixed last-tier delivery per product type comes from settings.
  - **(b) Packio mode (target)**: goods price without delivery plus a separate `ShippingQuoteService` line on the real quantity (D-013).
- `standard.adapter.ts` — quote engine. Design fee added once when hired, 0 when free. Discount after the total.
- The cached "from" price (`min_price_per_pcs_with_delivery`) is computed on price-list publish (S26).

**Golden test cases** (computed with the legacy PHP helpers; VAT 7; zipcode zone BKK/GBKK unless stated):

| # | Setup | Expected |
|---|---|---|
| G1 | `costToSalePrice(2.50, fix 0.5, m 30, vat 7)` | 3.00/0.7 = 4.2857 → 4.29; ×1.07 = 4.5903 → **4.60** |
| G2 | `costToSalePrice(1.1, fix 0, m 0)` | margin 1.1 → **1.11** (IEEE); ×1.07 → **1.19** |
| G3 | `costToSalePrice(2.50, 0.5, 30, vat 0)` (`SALE_MARGIN_VAT` empty) | **4.29** |
| G4 | buy 0, fix 0 | throws (S3) → port: PricingError |
| G5 | ByPack price 150 / pack, dppp 10 × packsize 50 | per piece ceil2(0.3) = 0.30 → ×1.07 → **0.33**; cost per piece 0.3 |
| G6 | POP (type 6), ByPack as G5, tiers [100-499 @2.50],[500-999 @2.20],[1000-99999 @2.00], fix 0.5, m 30 | table **[100-499: 4.93], [500-999: 4.47], [999-99999: 4.17]** (per_pcs 4.60 / 4.14 / 3.84, delivery 0.33) |
| G7 | G6 at qty 999 | both tiers 2 and 3 match → **4.47** (first wins, S5); total 4465.53 |
| G8 | G6 at qty 1000 | **4.17**; total 4170; cost 2000; sum 3840 |
| G9 | same as G6 but type 1 (bottle): last tier delivery override 0.88 → 0.95 | tier 3 = ceil2(3.84 + 0.95) = 4.79 ≥ 4.47 → merge: **[100-499: 4.93], [500-99999: 4.79]** (S8 + S7) |
| G10 | POP ByPack, tiers [100-499 @2.50],[500-999 @2.20],[1000-4999 @2.30],[5000-99999 @1.80], fix 0, m 30 | **[100-499: 4.17], [500-4999: 3.86], [4999-99999: 3.10]** (the 500-999 tier at 3.71 is absorbed by 3.86) |
| G11 | Single tier [1-99999 @10.00], m 25, ByPack 60 / pack, pack 20 pcs, type 6 | min stays 1; sale 13.34 → 14.28; delivery 3.00 → 3.21; **17.49** |
| G12 | ByBoxAndZone item 50×50×150 mm, qty 100, BKK/GBKK | best box 2 (115/box, 1 box): sum 195, total 208.65; per piece 2.09 → 2nd VAT **2.24**; delivery_cost 195; cost per piece 1.95 |
| G13 | same, UPCC | sum 150 → **1.73** per piece |
| G14 | same, REMOTE | 50 + 150 = 200 → **2.29** per piece |
| G15 | same, qty 10000 | box 1 ×66, sum 14850, total 15889.51 (IEEE); per piece 1.59 → **1.71**; delivery_cost **14900** (S13) |
| G16 | bottle (type 1), ByBoxAndZone item G12, tiers [100-499 @3.00],[500-999 @2.80],[1000-99999 @2.50], fix 0, m 30 | delivery @100 = 2.24, @500 = 2.07, last = 0.95 → **[100-499: 6.84], [500-999: 6.35], [999-99999: 4.79]** |
| G17 | G16 `findPrice(750)` | 6.35; total **4762.50**; cost 2100; sum 3210; delivery_per_pcs 2.07 (from the tier at 500); order delivery_price 1552.50, delivery_cost 1.8 × 750 = 1350 |
| G18 | G16 qty 99 or 100000 | no tier → legacy throws (S9); port `qty_out_of_range` |
| G19 | ByBoxAndZone item 300×300×200 mm | box 3 fits 0 → legacy throws (S12); port: skip carton |
| G20 | pouch printing (type 4), ByPouch, tier min 50 | the carton gap → legacy throws (S16); port per the `pouch-packing` decision |
| G21 | pouch printing, last-tier override 0.15 | delivery **0.17** per piece; design hired → fee = `DESIGN_COST_FOR_POUCH` added once in the port (legacy API omits it, S20) |
| G22 | Promo percent 10 % on G8 total 4170 | discount round(417) = 417 → **3753**; redeem 500 points → discount 50 |
| G23 | Stock 600, order 600 → ok (after 0); stock 500, order 600 → "Out of stock"; stock 0 → out | port: reservation fails with `insufficient_stock` |
| G24 | Lead time: type 3 → 3; type 4 → 30; type 7 cannot design → 3 / can design → 30; type 1 → ceil(FMPT lead_time) | |

Key files:
- `LW/app/Libraries/StandardProduct/{CalculatePrice,CalculateDelivery,Utils,Stock}.php`
- `LW/app/Models/StandardProduct.php`, `StandardProductPrice.php`, `Rigid.php`
- `LW/app/Http/Controllers/Api/StandardProductAPIController.php`, `StandardProductController.php`, `StandardProductPriceController.php`, `StockHistoryController.php`
- `LW/app/Libraries/Shipping/ShippingUtils.php`, `LW/app/Helpers/helpers.php:1692-1764`
- `LW/resources/js/components/standard-products/cs.vue`
- migrations `2024_08_16_094222_*`, `2024_08_20_091351_*`, `2024_09_17_13*`; seeders `MigrateDataFromRigids*`

---

## 9. Packio port (decisions, U-B6 standard product, 2026-10-01)

Accepted under the user's standing instruction (2026-10-01); recorded in `docs/update-2026-09-29-gap.md` §U-B6 standard
product.

1. **A standard product is a Packio stock product** (`stock_products`, product type `standard_product`, schema-design
   §3.3): one SKU, its unit, dimensions, weight, attributes, stock per factory. Legacy attributes never change the price
   (§2.6), so a variant is its own stock product, as legacy.
2. **Buy prices** are the factory's price-list lines `pl_stock_product_prices` (schema-design §3.4): stock product ×
   print type × quantity band (inclusive) → buy price per piece, lead time. The print type is legacy's `std_product`
   (9); legacy keyed one factory per SKU, Packio allows several and selects by buy price then lead time (D-043, D-101).
3. **Sell price per piece** keeps legacy's two roundings (`Utils::costToSalePrice`, S1):
   `⌈⌈(buy + fix) ÷ (1 − m)⌉₀.₀₁ × (1 + VAT)⌉₀.₀₁`. The margin is Packio's `standard_product` sell table (legacy's flat
   `locopack_margin` per factory = a fallback line; quantity tiers allowed), the fix cost its `fix_cost` **per piece**
   (legacy adds `locopack_fix_cost` to the buy price per piece), VAT the dated `vat_standard` rate (S18). A buy price of
   0 is refused (S3).
4. **Tiers** as legacy (§2.2–2.4): ordered by the minimum, the last tier starts at the previous tier's maximum (S5, the
   lower tier wins at the shared bound), and a later tier whose price is not lower absorbs the earlier ranges at its own
   price (`sortPrices`, S8 — kept, flagged for the business). Packio applies them to the **goods price**: delivery is
   its own quote line (D-013), so legacy's per-tier delivery (at the tier minimum or 10 000, S6, S7) is not part of the
   price. A quantity outside every tier is refused (S9).
5. **Delivery** (D-013): the five legacy methods (box-and-zone, corrugate, W × L × H, pouch, pack) are replaced by the
   B2.4 rate cards on the shipment's weight: the stock product's `weight_g` × quantity; a stock product sold by the pouch
   uses the pouch packer (legacy `ByPouch`). A stock product without a weight has no instant price (the shipping line
   could not be priced).
6. **Design fee**: Packio's `standard_product` `design_fee` once per quote when Packio designs (S20, S21).
7. **Stock** is not read by pricing (legacy); the order step reserves it (S24, the stock module).
8. **Not ported**: promotions / redeem inside the price (Packio promotions, D-130+), the cached listing price (the price
   hints compute the "starting from" price, S26), Rigid v1, CS edit / change-factory paths (S28).
