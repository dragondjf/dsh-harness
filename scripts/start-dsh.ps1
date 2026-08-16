# scripts/start-dsh.ps1 — launch the dsh web profile on Windows (build-free path).
#
# Mirrors scripts/start-dsh.sh: wraps the canonical Node-18 launch that the
# `dsh` CLI needs, auto-selecting the bundled Node 18 runtime (node18/node.exe)
# so the green package runs without a system Node install.
#
# Usage (PowerShell):
#   .\scripts\start-dsh.ps1                 # boot web UI on :3080
#   $env:DSH_PORT = 8080; .\scripts\start-dsh.ps1
#
# Env overrides: DSH_NODE_BIN, DSH_PROFILE, DSH_HOST, DSH_PORT, DSH_PATCH,
# DSH_PERMISSION_MODE (read-only | workspace-write | danger-full-access).

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $RepoRoot

$NodeBin = if ($env:DSH_NODE_BIN) {
  $env:DSH_NODE_BIN
} elseif (Test-Path "$RepoRoot/node18/node.exe") {
  "$RepoRoot/node18/node.exe"
} else {
  (Get-Command node -ErrorAction Stop).Source
}

$Host2  = if ($env:DSH_HOST)  { $env:DSH_HOST }  else { '127.0.0.1' }
$Port   = if ($env:DSH_PORT)  { $env:DSH_PORT }  else { '3080' }
$Profile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'web' }
$Patch  = if ($env:DSH_PATCH) { $env:DSH_PATCH } else { "$RepoRoot/config/deepseek-official.yml" }
$Perm   = if ($env:DSH_PERMISSION_MODE) { $env:DSH_PERMISSION_MODE } else { 'danger-full-access' }
$env:DSH_PERMISSION_MODE = $Perm

if (-not (Test-Path "$RepoRoot/apps/cli/lib/bin.js")) {
  Write-Error "apps/cli/lib/bin.js missing — run 'pnpm install && pnpm build:lib' first."
  exit 1
}

$args = @(
  '--import', "$RepoRoot/scripts/better-sqlite3-abi-loader.mjs",
  '--import', "$RepoRoot/scripts/node18-polyfills.mjs",
  "$RepoRoot/apps/cli/lib/bin.js",
  '--profile', $Profile
)
if (Test-Path $Patch) { $args += @('--patch', $Patch) }
$args += @('--host', $Host2, '--port', $Port)

Write-Host "node: $NodeBin"
Write-Host "profile=$Profile host=$Host2 port=$Port permission=$Perm"
& $NodeBin @args
