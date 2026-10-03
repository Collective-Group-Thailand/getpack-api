#!/usr/bin/env bash
# ADR-0010: bundles @packio/dieline from a packio-web checkout into vendor/packio-dieline (pinned, reviewed on change).
# Usage: pnpm dieline:vendor <path-to-packio-web>
set -euo pipefail
WEB="${1:?usage: pnpm dieline:vendor <path-to-packio-web>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$WEB/packages/dieline"
OUT="$ROOT/vendor/packio-dieline"
ESBUILD="$(ls -d "$WEB"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild 2>/dev/null | sort -V | tail -1)"
[ -x "$ESBUILD" ] || { echo "esbuild not found under $WEB/node_modules (run pnpm install in packio-web)" >&2; exit 1; }
mkdir -p "$OUT"
( cd "$WEB" && "$ESBUILD" packages/dieline/src/index.ts --bundle --format=esm --platform=node --target=node24 \
    --legal-comments=inline --log-level=warning --outfile="$OUT/index.mjs" )
VERSION="$(node -p "require('$PKG/package.json').version")"
COMMIT="$(git -C "$WEB" rev-parse HEAD)"
DIRTY="$(git -C "$WEB" status --porcelain -- packages/dieline | wc -l | tr -d ' ')"
SHA="$(shasum -a 256 "$OUT/index.mjs" | cut -d' ' -f1)"
cat > "$OUT/VERSION.json" <<JSON
{
  "package": "@packio/dieline",
  "version": "$VERSION",
  "packioWebCommit": "$COMMIT",
  "uncommittedChanges": $DIRTY,
  "bundleSha256": "$SHA",
  "bundledAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "bundler": "$(echo "$ESBUILD" | grep -o 'esbuild@[^/]*' | head -1)"
}
JSON
echo "vendored @packio/dieline@$VERSION ($COMMIT) sha256 $SHA"
