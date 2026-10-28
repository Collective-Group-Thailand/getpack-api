# Cart & checkout redesign — API changes (Stage C block C5, branch `design/checkout-redesign`)

Decision: **D-452** (`docs/decisions.md`). Additive only: no endpoint removed, no field renamed, no pricing, shipping,
discount, points, tax or payment logic changed. Contract: `contract/openapi.json` (regenerated, spectral clean).

| # | Change | Where |
|---|---|---|
| C5-API-1 | `CartDto.vatAmount` — VAT included in `productGrossAmount`: the order lines checkout builds before shipping (`priceOrderLines` + shared VAT helper, each quotation's VAT rate). `CartDto.maxCodes`, `CartDto.quantityStep` from settings. Set by every `store.cart.*` / `admin.cart.*` and code endpoint (`CartFigures.view`); null in carts returned by other modules (claims, RFQ basket, call-offs, samples) — read the cart again. | `checkout/cart-figures(.service).ts`, `carts/cart-views.ts` |
| C5-API-2 | `CartItemDto.quantityEditable`, `quantityLimits {min,max}` (catalogue `quantity_min/max`), `tierHint {quoteOptionId, quantity, unitPrice, productGrossAmount}` (the same locked quotation's smallest larger, cheaper option), `earliestShipDate` (quotation's, while ahead), `leadTimeDays`. | `carts.dto.ts`, `cart-views.ts` |
| C5-API-3 | `POST /v1/store/cart/items/{itemId}/actions/change-quantity` `{quantity}` (`store.cart.changeQuantity`, admin twin; `If-Match`): existing option of the locked quotation, else a new saved quotation priced by the quote engine (today's price, new lock); one destination follows, a split is cleared; refuses RFQ / Studio pin / reorder / pending re-price (`cart.quantity_unavailable`, new 409). Event + activity `cart.item_quantity_changed`. | `carts.service.ts`, `carts.controller.ts` |
| C5-API-4 | `POST /v1/store/cart/actions/estimate-shipping` `{postcode}` (`store.cart.estimateShipping`, 30/min/client): shipping of every item to the postcode incl. VAT (quote engine `destinationShipping`, customer rate card), zone name, ready date (as checkout promises it, D-436), arrival window (`shipping.transit_days`), unavailable items. Writes nothing. `DestinationShipping` now carries the zone (internal). | `cart-figures.service.ts`, `quote-engine.service.ts` |
| C5-API-5 | Settings `promotions.max_codes_per_cart` = 3 (Marketing; was constant 5) and `storefront.cart_quantity_step` = 50 (Admin), effective-dated, audited; `SETTINGS-REVIEW.md` regenerated. | `prisma/seed/data/settings.ts`, `setting-keys.ts`, `promotion-codes.service.ts` |

No migration (no schema change). Unit tests: `checkout/cart-figures.spec.ts` (cart VAT = checkout's lines; goods + shipping = the
order total for any shipping; ฿5,178.00 → ฿338.75; tier hint), `carts/cart-views.spec.ts`.

**Owner must run locally:** `pnpm db:seed` (creates the two settings), `pnpm test:int` + `pnpm test:e2e` (cart and checkout
specs, `promotions` code limit now 3), then on UAT check `changeQuantity` on an instant line (switch inside the quotation and a
new quantity) and `estimateShipping` with a Bangkok and an upcountry postcode.
