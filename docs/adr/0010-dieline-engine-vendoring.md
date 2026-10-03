# ADR-0010 — Consuming `@packio/dieline` in the API

**Status:** Accepted (2026-10-03) — implemented in U3.B4 / U3.B5
**Decision ids:** D-002 · D-241 · D-266–D-271 · U3 prompt ("pinned version"; thumbnails "choose in an ADR")

## Context
`@packio/dieline` is Packio's box geometry engine, owned and published by `packio-web` (D-002, its ADR-0007). It
builds every style from a recipe, solves the valid size ranges per material, names the processes a recipe needs,
checks a dieline against machine envelopes, draws SVG / DXF / PDF and renders 2D / 3D thumbnails with its own
software rasteriser (raw RGBA, no GL). The API needs it for the drawing service, dieline-derived quantities,
blank-fit makeability, free dieline downloads and style assets (U3.B4, U3.B5).

The package is published to GitHub Packages, which needs a registry token this repository and its CI do not have
yet; its source is TypeScript compiled with `moduleResolution: "bundler"` (extensionless imports) and its only
runtime dependency, `clipper2-ts`, is ESM-only — neither loads as-is in the API's CommonJS / NodeNext build.

## Decision
1. **A vendored, pinned bundle.** `pnpm dieline:vendor <path-to-packio-web>` bundles the package source with esbuild
   (`--bundle --format=esm --platform=node`, `clipper2-ts` and the recipe JSON included) into
   `vendor/packio-dieline/index.mjs` and writes `vendor/packio-dieline/VERSION.json` — package version, the
   packio-web commit, the bundle's sha256 and the date. The bundle is committed; a change to it is a reviewed diff
   like any dependency bump. The API never edits it.
2. **One adapter.** `src/integrations/dieline/packio-dieline.engine.ts` loads the bundle with a dynamic `import()`
   and exposes only what the API uses (build from a recipe, quantities, SVG / DXF / PDF, size ranges, processes,
   envelope fit, thumbnails). The rest of the code depends on the port, so switching to the registry package
   later changes one import path.
3. **Thumbnails without GL.** The worker renders `render2D` / `render3D` into RGBA and encodes PNG with `sharp`
   (already a dependency).
4. **The `drawing.engine` flag still gates use** (off by default); tests and `pnpm dev` keep the fake engine; unit
   tests exercise the real bundle directly.
5. **Version in every output.** Drawings, quantities and assets record `@packio/dieline@<version>+<sha8>`; caches
   key on it, so a new bundle never serves an old drawing.

## Consequences
- No registry token is needed to build, test or deploy; the bundle (≈ 0.5 MB) is reviewed on change.
- When CI gets GitHub Packages access, `@packio/dieline` becomes a normal pinned dependency and the vendor folder
  is deleted (the adapter's import changes; nothing else).
- Geometry changes stay packio-web's: a new bundle is taken deliberately (`dieline:vendor`), never automatically.
