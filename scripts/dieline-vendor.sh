#!/usr/bin/env bash
# ADR-0010: bundles @getpack/dieline from a getpack-web checkout into vendor/getpack-dieline (pinned, reviewed on change).
# Usage: pnpm dieline:vendor <path-to-getpack-web>
set -euo pipefail
WEB="${1:?usage: pnpm dieline:vendor <path-to-getpack-web>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$WEB/packages/dieline"
OUT="$ROOT/vendor/getpack-dieline"
ESBUILD="$(ls -d "$WEB"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild 2>/dev/null | sort -V | tail -1)"
[ -x "$ESBUILD" ] || { echo "esbuild not found under $WEB/node_modules (run pnpm install in getpack-web)" >&2; exit 1; }
mkdir -p "$OUT"
# One bundle of the main entry and `@getpack/dieline/library` (the whole style library: ALL_RECIPES, registerLibrary) —
# the drawing service draws every library style the web draws, not only the core recipes.
ENTRY='export * from "./packages/dieline/src/index.ts";
export { ALL_RECIPES, OVERRIDE_RECIPES, WAVE_RECIPES, registerLibrary } from "./packages/dieline/src/library.ts";'
( cd "$WEB" && printf '%s\n' "$ENTRY" | "$ESBUILD" --bundle --format=esm --platform=node --target=node24 --loader=ts \
    --sourcefile=getpack-dieline-vendor-entry.ts --legal-comments=inline --log-level=warning --outfile="$OUT/index.mjs" )
VERSION="$(node -p "require('$PKG/package.json').version")"
COMMIT="$(git -C "$WEB" rev-parse HEAD)"
# The engine's source as git sees it: getpack-web CI compares its own packages/dieline tree with this (contract info).
SOURCE_TREE="$(git -C "$WEB" rev-parse HEAD:packages/dieline)"
DIRTY="$(git -C "$WEB" status --porcelain -- packages/dieline | wc -l | tr -d ' ')"
SHA="$(shasum -a 256 "$OUT/index.mjs" | cut -d' ' -f1)"
cat > "$OUT/VERSION.json" <<JSON
{
  "package": "@getpack/dieline",
  "version": "$VERSION",
  "getpackWebCommit": "$COMMIT",
  "sourceTree": "$SOURCE_TREE",
  "uncommittedChanges": $DIRTY,
  "bundleSha256": "$SHA",
  "bundledAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "bundler": "$(echo "$ESBUILD" | grep -o 'esbuild@[^/]*' | head -1)"
}
JSON
echo "vendored @getpack/dieline@$VERSION ($COMMIT) sha256 $SHA"
