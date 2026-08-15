#!/usr/bin/env bash
# Regenerate better-sqlite3 prebuilt native modules for every supported Node ABI.
# Run after a better-sqlite3 version bump or when adding a new target Node.
#
# Usage: bash scripts/build-better-sqlite3-all.sh
# Override the Node binaries via NODE18_BIN / NODE23_BIN env vars if needed.
set -euo pipefail

cd "$(dirname "$0")/.."

NODE18_BIN="${NODE18_BIN:-/home/yfjz/node18/bin/node}"
NODE23_BIN="${NODE23_BIN:-/home/yfjz/.hermes/node/bin/node}"

PKG="node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3"
mkdir -p "$PKG/prebuilt"

build_for() {
  local node_bin="$1" label="$2"
  echo "==> building better-sqlite3 for $label ($node_bin)"
  ( cd "$PKG"
    PATH="$(dirname "$node_bin"):$PATH" \
      node "$(dirname "$(dirname "$node_bin")")/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js" \
      rebuild --release
  )
  local abi
  abi="$($node_bin -p process.versions.modules)"
  cp -f "$PKG/build/Release/better_sqlite3.node" "$PKG/prebuilt/better_sqlite3.abi${abi}.node"
  echo "    saved prebuilt/better_sqlite3.abi${abi}.node ($(stat -c%s "$PKG/prebuilt/better_sqlite3.abi${abi}.node") bytes)"
}

build_for "$NODE18_BIN" "Node 18"
build_for "$NODE23_BIN" "Node 23"

# Leave the default generic binding as the Node 18 (ABI 108) build so dsh runs on
# Node 18 out of the box. Node 23 (ABI 131) is still served at runtime by
# scripts/better-sqlite3-abi-loader.mjs, which swaps in the matching prebuilt
# before better-sqlite3 is required.
cp -f "$PKG/prebuilt/better_sqlite3.abi108.node" "$PKG/build/Release/better_sqlite3.node"
echo "default generic set to Node 18 ($(stat -c%s "$PKG/build/Release/better_sqlite3.node") bytes)"

echo "done."
