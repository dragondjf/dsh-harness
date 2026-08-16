# scripts/start-src.ps1 - launch dsh from SOURCE (packages/*/src) via tsx.
# Mirrors start-src.sh for PowerShell. Needs node_modules (tsx) present.
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

$Host2   = if ($env:DSH_HOST)  { $env:DSH_HOST }  else { '127.0.0.1' }
$Port    = if ($env:DSH_PORT)  { $env:DSH_PORT }  else { '3080' }
$Profile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'web' }
$Patch   = if ($env:DSH_PATCH) { $env:DSH_PATCH } else { "$RepoRoot/config/deepseek-official.yml" }
$env:DSH_PERMISSION_MODE = if ($env:DSH_PERMISSION_MODE) { $env:DSH_PERMISSION_MODE } else { 'danger-full-access' }

if (-not (Test-Path "$RepoRoot/apps/cli/src/bin.ts")) {
  Write-Error "apps/cli/src/bin.ts missing — source tree not included in this package."
  exit 1
}

& $NodeBin --import tsx/esm `
  --import "$RepoRoot/scripts/better-sqlite3-abi-loader.mjs" `
  --import "$RepoRoot/scripts/node18-polyfills.mjs" `
  "$RepoRoot/apps/cli/src/bin.ts" --profile $Profile `
  $(if (Test-Path $Patch) { @('--patch', $Patch) }) `
  --host $Host2 --port $Port
