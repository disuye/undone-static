#!/usr/bin/env bash
# Rebuild babylon.module.js: a minified subset of @babylonjs/core (only what bb-scene/ imports),
# plus the area-light LTC table that Babylon would otherwise fetch from its CDN at runtime.
# Usage: assets/babylon/bb-vendor/bb-build.sh [babylon-version]   — add new names to bb-entry.js first.
set -euo pipefail

VERSION="${1:-9.33.2}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$HERE/bb-entry.js" "$TMP/"
cd "$TMP"
npm init -y >/dev/null
npm i --silent "@babylonjs/core@$VERSION" esbuild@0.25.10
npx esbuild bb-entry.js --bundle --format=esm --minify --legal-comments=none --target=es2022 --outfile=bundle.js

{ printf '/*! Babylon.js %s — Apache-2.0 licence, see LICENSE-babylon.txt. Bundled subset: bb-vendor/bb-build.sh */\n' "$VERSION"; cat bundle.js; } > "$HERE/babylon.module.js"
cp node_modules/@babylonjs/core/license.md "$HERE/LICENSE-babylon.txt" 2>/dev/null || cp node_modules/@babylonjs/core/LICENSE* "$HERE/LICENSE-babylon.txt"

# RectAreaLight LTC lookup table, served locally (Tools.AssetBaseUrl in bb-index.js points here).
mkdir -p "$HERE/areaLights"
curl -fsSL https://assets.babylonjs.com/core/areaLights/areaLightsLTC.bin -o "$HERE/areaLights/areaLightsLTC.bin"

echo "@babylonjs/core@$VERSION → $HERE/babylon.module.js ($(wc -c < "$HERE/babylon.module.js") bytes)"
