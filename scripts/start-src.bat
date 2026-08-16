@echo off
setlocal
REM scripts/start-src.bat - launch dsh from SOURCE via tsx (cmd.exe)
REM For fixing unknown issues in place: edits to packages/*/src take effect
REM without a rebuild. Other packages still resolve through their built lib/.
set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
cd /d "%REPO%"
set "NODE=%REPO%\node18\node.exe"
if not exist "%NODE%" if defined DSH_NODE_BIN set "NODE=%DSH_NODE_BIN%"
if not exist "%NODE%" (echo ERROR: node not found & pause & exit /b 1)
set "HOST=%DSH_HOST%"
if "%HOST%"=="" set "HOST=127.0.0.1"
set "PORT=%DSH_PORT%"
if "%PORT%"=="" set "PORT=3080"
set "PROFILE=%DSH_PROFILE%"
if "%PROFILE%"=="" set "PROFILE=web"
set "PATCH=%DSH_PATCH%"
if "%PATCH%"=="" set "PATCH=%REPO%\config\deepseek-official.yml"
if "%DSH_PERMISSION_MODE%"=="" set "DSH_PERMISSION_MODE=danger-full-access"
"%NODE%" --import tsx/esm --import "%REPO%\scripts\better-sqlite3-abi-loader.mjs" --import "%REPO%\scripts\node18-polyfills.mjs" "%REPO%\apps\cli\src\bin.ts" --profile %PROFILE% --patch "%PATCH%" --host %HOST% --port %PORT%
