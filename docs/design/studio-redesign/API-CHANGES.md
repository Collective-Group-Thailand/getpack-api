# Studio redesign (C7) — API changes

Branch `design/studio-redesign` (getpack-api), decision **D-455**. Web types regenerated from this contract.

| # | Change | Where |
|---|---|---|
| 1 | `GET /v1/store/styles/studio-featured` (`store.styles.studioFeatured`, public): `{ source: curated \| usage \| none, data: StyleCardDto[] }` — up to 6 published styles for the Studio's "แบบที่คนเริ่มบ่อย". `curated` = the admins' ordered list in the setting; `usage` = once Studio designs started within `usage.windowDays` (a design's style variant's base, else the base linked to its pattern) reach `usage.minDesigns`, ranked by them; `none` = unset / nothing published → the storefront hides the section. | `src/modules/styles/styles-store.{controller,service,dto}.ts`, unit `studio-featured.spec.ts` |
| 2 | Setting `studio.featured_styles` (json, effective-dated, audited, owner Admin; Superadmin may change any setting): `{ styles: [{ code, enabled }] (≤ 12), usage: { minDesigns: int ≥ 1 \| null, windowDays: 7–365 } }`; **unset** in every seed (no invented choice). Back office: `/style-library/studio-featured` (web). | `prisma/seed/data/settings.ts`, `setting-keys.ts`, `docs/launch/SETTINGS-REVIEW.md` |
| 3 | Dev / UAT seed patterns get their `dielineKey` (engine drawing): DEV-RTE `rte`, DEV-RSC `rsc`, DEV-TELE `telescope`, DEV-FLAT `flat-rect`, DEV-TAG `tag-cut`, DEV-POUCH-STAND `pouch-standing`, DEV-POUCH-3SS `pouch-3-seal`; DEV-OPEN-TOP stays empty (no matching engine drawing). Without it the configurator hid "ออกแบบในสตูดิโอ" (e.g. `uat-postal-box-b`). | `prisma/seed/dev-*.ts` |
| 4 | UAT: `docs/design/studio-redesign/set-pattern-dieline-keys.mjs` — admin API (`PATCH /v1/admin/catalog/patterns/{id}`, If-Match), dry run by default, `--confirm`, idempotent; lists active patterns with no key and no mapping for Prepress. | this folder |

No migration (settings and seed only). Owner: `pnpm db:seed` (new setting row) + `pnpm test:int` locally.
