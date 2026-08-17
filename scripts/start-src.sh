#!/usr/bin/env bash
#
# scripts/start-src.sh — launch dsh from SOURCE (packages/*/src) via tsx.
#
# The green package ships BOTH the compiled lib/ AND the source tree
# (packages/*/src, vendor/). Use this launcher to run from source so you can
# patch an unknown issue in place and have it take effect without a rebuild.
# Other workspace packages still resolve through their built lib/ (pnpm
# symlinks); to fully rebuild from source run `pnpm build:lib` (devDeps are
# included in node_modules).
#
# Usage: ./scripts/start-src.sh   (env overrides same as start-dsh.sh)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$(basename "$SCRIPT_DIR")" == "scripts" ]]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  REPO_ROOT="$SCRIPT_DIR"
fi
cd "$REPO_ROOT"

NODE_BIN="${DSH_NODE_BIN:-}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  for cand in "$REPO_ROOT/node18/bin/node" /home/yfjz/node18/bin/node; do
    [[ -x "$cand" ]] && NODE_BIN="$cand" && break
  done
fi
[[ -z "${NODE_BIN:-}" ]] && NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then echo "node not found"; exit 1; fi

HOST="${DSH_HOST:-127.0.0.1}"; PORT="${DSH_PORT:-3080}"; PROFILE="${DSH_PROFILE:-web}"
PATCH="${DSH_PATCH:-$REPO_ROOT/config/deepseek-official.yml}"
export DSH_PERMISSION_MODE="${DSH_PERMISSION_MODE:-danger-full-access}"

if [[ ! -f "$REPO_ROOT/apps/cli/src/bin.ts" ]]; then
  echo "✗ apps/cli/src/bin.ts missing — source tree not included in this package." >&2
  exit 1
fi
exec "$NODE_BIN" \
  --import tsx/esm \
  --import "$REPO_ROOT/scripts/better-sqlite3-abi-loader.mjs" \
  --import "$REPO_ROOT/scripts/node18-polyfills.mjs" \
  "$REPO_ROOT/apps/cli/src/bin.ts" --profile "$PROFILE" \
  ${PATCH:+"--patch" "$PATCH"} --host "$HOST" --port "$PORT"
