# Stage A — API report (getpack-api, branch `fix/uat-phase0`)

Each step ran in a subagent with its `· ฝั่ง API` block from `STAGE-A-PROMPTS.md`, then passed the gate:
`pnpm lint` · `pnpm typecheck` · `pnpm test` (unit) · the factory-data contract test
(`test/unit/storefront-factory-confidentiality.spec.ts`) · a scan of the step's diff for secrets and for the seed's
factory names/codes/locations.

Environment: cloud VM, Node 24.22.1, pnpm 10.18.1, PostgreSQL 16 + pgvector 0.6.0 (with a VM-only `uuidv7()`
polyfill), Redis. No Docker, so `pnpm test:int` and `pnpm test:e2e` were not run here.

---

## A1 — business · Phase 0 + Phase 3b — PASS

Commits: `7fb3dcff` fix(store)!: strip factory data from storefront responses (D-435) ·
`3d5ec27d` docs(business-redesign): API-side PLAN and API-CHANGES for A1 (the subagent committed and pushed
these itself, so they are not in the `stage-a(A1): …` form; pushed history was not rewritten).

Gate: lint ✔ · typecheck ✔ · unit 166 suites / 1212 tests ✔ · contract test 5/5 ✔ · diff scan clean ✔ ·
live check: `GET /v1/store/network/stats` → 404; public-config, styles, catalogue products and stock products
return no factory/partner/machine/plant/coverage keys.

### What changed (breaking for the storefront contract; web must run `pnpm gen:api`)
- `GET /v1/store/network/stats` removed, with its service and the four `trust.*` settings it used.
  D-201 and D-264 are marked superseded by the new D-435 in `docs/decisions.md`.
- `GET /v1/store/public-config`: `factoryCount` removed.
- `GET /v1/store/styles/{code}` and `/styles/compare`: `partnersCount` removed; variants no longer return the
  `not_makeable` reason.
- Agent area: `factoryName` removed from `/agent/commissions` and `/agent/statements/{id}`; `totals.factories`
  removed from `/agent`. Admin endpoints keep them.
- `/v1/store/call-off-agreements*`: separate customer schema without `factory` and `buyUnitPrice`.
- `/v1/store/orders/{id}/shipments` and the order timeline (`store.timeline.get`): an event `location` is sent only
  for out-for-delivery, delivered and failed-delivery events; pickup, in-transit and returned events send `null`.
- Customer label for `picked_up`: "จัดส่งออกแล้ว / Dispatched" (was "ออกจากโรงงานแล้ว / Left the factory").
- No migration (no schema change). Existing `trust.*` setting rows in seeded databases stay, unused.
- New contract test `test/unit/storefront-factory-confidentiality.spec.ts`: fails if any `/v1/store/*` response
  schema or success example gains a key matching factory/factories/partner/machine/plant/coverage (three agent
  bounty-term fields allowed, reason in the file), or if `/v1/store/network` returns.

API-CHANGES: `docs/design/business-redesign/API-CHANGES.md` · Plan: `docs/design/business-redesign/PLAN.md`

### Other leaks found, not fixed (details in PLAN.md §2)
1. Store responses carry `statusLabelAdminTh` (staff wording, e.g. "รอโรงงานรับงาน", "โรงงานปฏิเสธงาน"); the public
   `/v1/store/status-labels` lists it.
2. Status/reason codes on store responses name factories or capacity: `CallOffStatus.pending_factory`,
   `ClaimStatus.factory_review`, `ClaimOwner.factory`, `ClaimAction.factory_deduction`,
   `QuotePathReason.no_active_factory`, `QuoteNoPriceReason.capacity_unavailable`.
3. Flash Express / Deliveree bookings send the factory as sender (both carriers are off today).
4. Error `agents.lead_existing_factory` tells an agent a phone/tax id belongs to a factory (D-417/D-419).
5. A factory's call-off `declineReason` reaches the customer verbatim.
6. Proof files keep their original file names.
7. EXIF/GPS not stripped from uploaded photos; PDFs keep Chromium Producer/Creator metadata.
8. Factories see recipient name/phone on production jobs before dispatch and the claim description verbatim.

### Tests to run locally (Docker)
- `pnpm test:e2e` — at least the edited specs in `test/e2e/`: agents, call-offs, claims, logistics,
  phase4-contract, style-network, timeline.
- `pnpm test:int` — no spec touched; run for the Definition of Done.

### 124 vs 125 migrations
`prisma/migrations` holds 124 migration folders plus `migration_lock.toml`; a plain directory count gives 125.

### Open questions
1. Replace staff wording and factory-named codes on store responses now (breaking for web), or together with A2?
2. One neutral refusal for agents instead of `agents.lead_existing_factory`?
3. Contact reference format: pack asks `CT-YYYY-#####`, tickets today are `CS-YYMM-NNNNN`. Which one?
4. Remove the unused `trust.*` setting rows in UAT with a data migration, or leave them?
