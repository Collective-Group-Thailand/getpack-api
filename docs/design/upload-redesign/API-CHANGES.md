# Upload Phase 0 (A5) — API changes

**No API changes.** Branch `fix/uat-phase0` of `getpack-api`. The web can run its A5 side against the contract as it
already is (after A1–A4).

Endpoints added / changed / removed: none. DTOs: none. Migrations: none. Env vars: none. `contract/openapi.json`
unchanged.

## Why nothing changed

| Phase 0 item | API side |
|---|---|
| 1 · `/configure/<slug>?design=own_file` pre-selects "มีไฟล์งานแล้ว", the collapsed summary shows the chosen option | Web only. `GET /v1/store/catalog/products/{slug}/configurator` (`store.catalog.getConfigurator`) already returns `design.options` (`own_file`, `online_designer`, `hired_design`) and `design.default = 'own_file'`. The web reads `?design=` and shows the option in force. It must never show "ออกแบบออนไลน์" when `online_designer` is not offered for the pattern (the web already filters it with `designOptionsOf`). |
| 2 · Honest copy on `/studio/upload` | Web only (copy). The API facts behind the copy: files are uploaded **after the order is placed** (`POST /v1/store/orders/{orderId}/artwork-submissions` from `waiting_payment` until artwork approval), and the team checks them before production. Wording per GLOBAL-RULES §6: "อัปโหลดไฟล์หลังสั่งซื้อ ทีมงานตรวจไฟล์ให้ก่อนผลิต". No "ตรวจไฟล์อัตโนมัติ" claim. |
| 3 · FINDINGS | Documentation: `docs/design/upload-redesign/FINDINGS.md`. |
| ฿15.70 vs ฿17.26 | Already explained in A3/A4 (two inks sent). Pricing is A3's (GLOBAL-RULES §5). |

## Existing contract the web uses for this page (unchanged)

### Product list: the products shown on `/studio/upload`

`GET /v1/store/catalog/products?perPage=48` (`store.catalog.listProducts`). Show items with
`availability !== 'rfq'`, i.e. instant-priced products, plus the "สินค้าอื่น ขอใบเสนอราคา" link (DECISIONS-STAGE-A
§1). The card price is `startingPricePerPiece` (same value as the listing and the configurator default) and the
MOQ is `moq`. No factory data is in this response (A1 contract test).

```json
{
  "data": [
    {
      "slug": "uat-postal-box-b",
      "nameTh": "กล่องไปรษณีย์ ฝาชน 3 ชั้น (ลอน B)",
      "nameEn": "Postal box RSC 3-ply (B-flute)",
      "templateAvailability": "drawing",
      "startingPricePerPiece": "15.70",
      "moq": 100,
      "availability": "instant"
    }
  ],
  "meta": { "page": 1, "perPage": 48, "total": 5 }
}
```
(Abridged, values from the UAT rehearsal seed, which is fake data.)

### Configurator design options

`GET /v1/store/catalog/products/{slug}/configurator` (`store.catalog.getConfigurator`) → `design`:

```json
{ "design": { "options": ["own_file", "online_designer", "hired_design"], "default": "own_file" } }
```

The cart line carries the choice as `designOption` (`DesignOption` enum) on `POST /v1/store/cart/items`.

## Open questions (API work for later phases, not Phase 0)

These are the gaps in FINDINGS.md §1.5. None is implemented here; each needs approval and belongs to upload Phase 1–2:

1. **Retention (G1):** purge job and settings for `customer_content` (production files 2 years, unordered 90 days,
   delete on request; files deleted in the PDPA deletion flow).
2. **Anonymised production copy of the original (G2):** strip metadata, rename to the job code.
3. **Staff access (G3):** today every staff role can read every customer file and `customer_content` downloads are
   not audited. Restrict to the assigned Prepress / `artwork.read` and audit.
4. **Upload ceiling (G4):** purpose `artwork` allows 2 GiB; hard rule 5 says ≤ 200 MB per direct upload.
5. **Preflight (Phase 2):** extend the existing engine (ADR-0009, 9 checks, runs after ordering) to the 12 checks,
   before the cart. The prepress team's tool profile, if one exists, is business input.
6. **Dielines:** the 5 own-file products' patterns have no `dielineKey`, so no template is drawn automatically even
   with `drawing.engine` on. This needs either Prepress-supplied templates or a pattern → engine mapping.
