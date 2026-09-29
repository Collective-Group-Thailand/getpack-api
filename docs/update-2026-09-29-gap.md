# Update U1 (2026-09-29) — gap analysis

Session 0 of every U-B session (`docs/prompts/U1-update-2026-09-29.md`): one row per requirement → `met | partial | missing`, the evidence, and what the session changes. Requirements already `met` are not touched. Newest session on top.

## U-B0 steps 1–2 — contract release tag and contract-requests triage (2026-09-29)

| # | Requirement | Before | Evidence | This session |
|---|---|---|---|---|
| 1.1 | `package.json` bumped from `0.1.0` | missing | `package.json` `"version": "0.1.0"`; `APP_VERSION` (`src/bootstrap.ts:9`) → `info.version` via `buildOpenApiDocument` (`scripts/contract-build.ts:29`) | Bumped to `0.2.0` |
| 1.2 | `pnpm contract:build` at the release | met (drift-free) | Rebuild changed only `info.version` (745 paths) | Regenerated and committed |
| 1.3 | Tag `vX.Y.Z` with `contract/openapi.json` as release asset | partial | `.github/workflows/release.yml` publishes the asset on a `v*.*.*` tag push (checks contract drift, `contract:lint`, tag = `package.json`); `git tag -l` empty; this checkout has no git remote | Annotated tag `v0.2.0` created locally; the push that runs the release workflow is the user's |
| 1.4 | Tag written in `docs/PROGRESS.md` for packio-web to pin | missing | — | PROGRESS entry with version, release URL and sha256 |
| 2.1 | Both frontend files read from the sibling checkout | met | `../packio-web` at `9cbd99a`: `docs/contract-requests.md` (133 open ids), `docs/contract-requests.openapi.json` (115 ids, 293 operations) | — |
| 2.2 | `docs/contract-requests-triage.md`, one row per request id with a verdict | missing | — | Written (see the file's summary for counts) |
| 2.3 | The three known contract defects recorded | missing | `RateCardLineResponse` enum and DTO share a name (`src/modules/partners/pricing/pricing.dto.ts:315,319`); `AssemblyDto` defined twice (`src/modules/catalog/materials/materials.dto.ts:553`, `src/modules/pricing/quotes/quote.dto.ts:79`); `PriceSimulationDto.result` is `additionalProperties: true` without a named schema | Recorded as `implement here` rows with a non-breaking fix and a group |
| 3 | Implement the `implement here` rows (U-B0.1–0.3) | missing | — | Out of scope (later sessions) |
