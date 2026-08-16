@echo off
setlocal enabledelayedexpansion
REM scripts/start.bat - launch the dsh web UI (Node 18 green package, cmd.exe)
REM Foreground: keep this window open; press Ctrl-C to stop the server.
REM Mirrors scripts/start-dsh.ps1 but runs under cmd.exe (no PowerShell needed).

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
cd /d "%REPO%"

set "NODE=%REPO%\node18\node.exe"
if not exist "%NODE%" (
  echo ERROR: bundled Node not found at %NODE%
  echo Install Node 18+ or set DSH_NODE_BIN to a node.exe path.
  pause
  exit /b 1
)

set "HOST=%DSH_HOST%"
if "%HOST%"=="" set "HOST=127.0.0.1"
set "PORT=%DSH_PORT%"
if "%PORT%"=="" set "PORT=3080"
set "PROFILE=%DSH_PROFILE%"
if "%PROFILE%"=="" set "PROFILE=web"
set "PATCH=%DSH_PATCH%"
if "%PATCH%"=="" set "PATCH=%REPO%\config\deepseek-official.yml"
set "PERM=%DSH_PERMISSION_MODE%"
if "%PERM%"=="" set "PERM=danger-full-access"
set "DSH_PERMISSION_MODE=%PERM%"

echo node: %NODE%
echo profile=%PROFILE% host=%HOST% port=%PORT% permission=%PERM%
"%NODE%" --import "%REPO%\scripts\better-sqlite3-abi-loader.mjs" --import "%REPO%\scripts\node18-polyfills.mjs" "%REPO%\apps\cli\lib\bin.js" --profile %PROFILE% --patch "%PATCH%" --host %HOST% --port %PORT%
