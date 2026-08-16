#!/usr/bin/env bash
#
# scripts/start-dsh.sh — start the dsh web profile on Node 18 (build-free path).
#
# This is the single command to (re)launch the dsh browser UI. It wraps the
# canonical Node-18 launch that the `dsh` CLI needs:
#
#   node --import ./scripts/better-sqlite3-abi-loader.mjs \
#        --import ./scripts/node18-polyfills.mjs \
#        apps/cli/lib/bin.js --profile web [--patch ...] [--host/--port ...]
#
# On the `node18` branch, apps/cli/lib is committed, so no `pnpm build` is
# needed — only `pnpm install` (for node_modules: better-sqlite3 native binary,
# @hpcc-js/wasm-zstd wasm). The two `--import` shims auto-select the correct
# better-sqlite3 ABI and polyfill Node 22+ APIs on Node 18.
#
# Full deploy + backend-rebuild flow: see NODE18-DEPLOY.md (repo root).
#
# Usage:
#   ./scripts/start-dsh.sh [start|stop|status|restart]   (default: start)
#
# Env overrides:
#   DSH_NODE_BIN        explicit node binary (default: /home/yfjz/node18/bin/node, else PATH)
#   DSH_PROFILE         profile to boot                    (default: web)
#   DSH_HOST            bind host                          (default: 127.0.0.1)
#   DSH_PORT            listen port                        (default: 3080)
#   DSH_PATCH           provider/model overlay yml path    (default: config/deepseek-official.yml if present)
#   DSH_PERMISSION_MODE web UI tool-exec policy           (default: danger-full-access)
#                        - danger-full-access: tools run with NO approval (unattended/demo)
#                        - workspace-write:    tools run, but only write inside the workspace
#                        - read-only:          no tool execution
#   DSH_LOG             log path                            (default: /tmp/dsh-<port>.log)
#   DSH_FOREGROUND      1 => run in foreground (no daemon) (default: 0)
#
# Examples:
#   ./scripts/start-dsh.sh                       # boot web UI on :3080
#   DSH_PORT=8080 ./scripts/start-dsh.sh         # boot on :8080
#   DSH_PERMISSION_MODE=workspace-write ./scripts/start-dsh.sh
#   DSH_FOREGROUND=1 ./scripts/start-dsh.sh       # run in terminal (Ctrl-C to stop)
#
set -euo pipefail

# ---- resolve repo root (symlink-safe) ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ---- node: prefer an explicit Node 18+ ----
NODE_BIN="${DSH_NODE_BIN:-}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  for cand in /home/yfjz/node18/bin/node "$REPO_ROOT/node18/bin/node"; do
    if [[ -x "$cand" ]]; then NODE_BIN="$cand"; break; fi
  done
fi
if [[ -z "${NODE_BIN:-}" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "✗ node not found. Install Node 18+ or set DSH_NODE_BIN." >&2
  exit 1
fi

node_version() { "$1" -v 2>/dev/null | sed -E 's/^v([0-9]+)\..*/\1/'; }
NODE_VER="$("$NODE_BIN" -v)"
NODE_MAJOR="$(node_version "$NODE_BIN")"
if [[ -n "$NODE_MAJOR" && "$NODE_MAJOR" -lt 18 ]]; then
  echo "✗ Node $NODE_VER < 18; dsh needs Node 18+. Set DSH_NODE_BIN." >&2
  exit 1
fi

# ---- config (env overridable) ----
PROFILE="${DSH_PROFILE:-web}"
HOST="${DSH_HOST:-127.0.0.1}"
PORT="${DSH_PORT:-3080}"
PERMISSION_MODE="${DSH_PERMISSION_MODE:-danger-full-access}"
DEFAULT_PATCH="$REPO_ROOT/config/deepseek-official.yml"
PATCH="${DSH_PATCH:-$DEFAULT_PATCH}"
LOG_FILE="${DSH_LOG:-/tmp/dsh-$PORT.log}"
PID_FILE="/tmp/dsh-$PORT.pid"

# built entry (build-free: apps/cli/lib is committed on the node18 branch)
ENTRY="apps/cli/lib/bin.js"
IMPORTS=(--import ./scripts/better-sqlite3-abi-loader.mjs --import ./scripts/node18-polyfills.mjs)

usage() {
  grep -E '^#' "$0" | sed 's/^# \{0,1\}//' | sed '/^$/q'
  echo "Commands: start (default) | stop | status | restart"
}

# ---- helpers ----
port_listening() {
  curl -s -o /dev/null -m 2 "http://$HOST:$PORT/" 2>/dev/null
}

pid_alive() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid; pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

preflight() {
  if [[ ! -f "$ENTRY" ]]; then
    echo "✗ $ENTRY missing. Run 'pnpm install && pnpm build:lib' once," >&2
    echo "  or use source mode: pnpm dsh --profile $PROFILE" >&2
    exit 1
  fi
  for f in scripts/better-sqlite3-abi-loader.mjs scripts/node18-polyfills.mjs; do
    if [[ ! -f "$f" ]]; then echo "✗ $f missing." >&2; exit 1; fi
  done
  # Path A (fresh box) gotcha: the web frontend bundle is gitignored and NOT in
  # the committed lib/. Forgetting `pnpm build:web` makes the server boot fine
  # but serve a blank page. Catch it up front with the fix command.
  if [[ "$PROFILE" == "web" && ! -f "$REPO_ROOT/apps/web/dist/index.html" ]]; then
    echo "⚠ apps/web/dist missing — the web UI will serve a blank page." >&2
    echo "  Fix (Path A): pnpm build:web   # regenerates apps/web/dist" >&2
    echo "  Fix (Path B): ensure apps/web/dist was copied with the repo tree" >&2
  fi
  if [[ -n "${DEEPSEEK_API_KEY:-}" ]]; then
    export DEEPSEEK_API_KEY
  elif [[ ! -f "$REPO_ROOT/.env" ]]; then
    echo "⚠ DEEPSEEK_API_KEY not set and no repo-root .env found." >&2
    echo "  The web UI will boot, but LLM calls fail until the key is available." >&2
    echo "  Export it (export DEEPSEEK_API_KEY=...) or add it to .env." >&2
  fi
  if [[ -n "$PATCH" && ! -f "$PATCH" ]]; then
    echo "⚠ --patch file not found: $PATCH (continuing without overlay)" >&2
    PATCH=""
  fi
}

build_args() {
  # Launcher-known flags (--profile, --patch) MUST come before app flags
  # (--host, --port): with commander passThroughOptions, the first unknown
  # option pauses parsing of further known options, so --patch after --host
  # would leak through to the web app and error "unknown option '--patch'".
  local -a a=(--profile "$PROFILE")
  [[ -n "$PATCH" ]] && a+=(--patch "$PATCH")
  a+=(--host "$HOST" --port "$PORT")
  echo "${a[@]}"
}

start() {
  preflight
  if pid_alive || port_listening; then
    echo "▸ dsh already running on http://$HOST:$PORT/ (pid $(cat "$PID_FILE" 2>/dev/null || echo '?'))"
    exit 0
  fi
  export DSH_PERMISSION_MODE="$PERMISSION_MODE"
  local args; args="$(build_args)"
  local -a cmd=("$NODE_BIN" "${IMPORTS[@]}" "$ENTRY" $args)
  echo "▸ node: $NODE_BIN ($NODE_VER)"
  echo "▸ profile=$PROFILE host=$HOST port=$PORT permission=$PERMISSION_MODE"
  [[ -n "$PATCH" ]] && echo "▸ patch: $PATCH"
  echo "▸ starting: ${cmd[*]}"

  if [[ "${DSH_FOREGROUND:-0}" == "1" ]]; then
    exec "${cmd[@]}"
  fi
  nohup "${cmd[@]}" >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 2
  if pid_alive; then
    if port_listening; then
      echo "▸ ✓ up: http://$HOST:$PORT/  (log: $LOG_FILE, pid $(cat "$PID_FILE"))"
    else
      echo "▸ process alive but not yet serving — check: tail -f $LOG_FILE"
    fi
  else
    echo "✗ process exited early; tail of $LOG_FILE:" >&2
    tail -n 25 "$LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
}

stop() {
  local stopped=0
  if pid_alive; then
    local pid; pid="$(cat "$PID_FILE")"
    echo "▸ stopping pid $pid"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || { stopped=1; break; }; sleep 0.5; done
    if [[ $stopped -eq 0 ]]; then kill -9 "$pid" 2>/dev/null || true; fi
    rm -f "$PID_FILE"
  fi
  # fall back: if still listening, free the port
  if port_listening; then
    if command -v fuser >/dev/null 2>&1; then
      fuser -k "${PORT}/tcp" 2>/dev/null || true
    else
      pkill -f "apps/cli/lib/bin.js --profile $PROFILE" 2>/dev/null || true
    fi
  fi
  echo "▸ stopped."
}

status() {
  if pid_alive && port_listening; then
    echo "● running: http://$HOST:$PORT/ (pid $(cat "$PID_FILE"))"
  elif pid_alive; then
    echo "● process alive (pid $(cat "$PID_FILE")) but not serving on :$PORT"
  elif port_listening; then
    echo "● port :$PORT answered but no tracked pid (started elsewhere?)"
  else
    echo "○ not running on http://$HOST:$PORT/"
  fi
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  status)  status ;;
  restart) stop; sleep 1; start ;;
  -h|--help|help) usage ;;
  *) echo "✗ unknown command: $1" >&2; usage; exit 1 ;;
esac
