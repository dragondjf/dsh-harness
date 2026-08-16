@echo off
setlocal
REM scripts/install.bat - first-run setup for the dsh Node 18 green package
REM Writes .env with the DeepSeek API key so the server can make LLM calls.
REM Runs under cmd.exe (no PowerShell needed).

set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"

echo ============================================
echo  dsh Node 18 green package - setup
echo ============================================

set "NODE=%REPO%\node18\node.exe"
if not exist "%NODE%" (
  echo ERROR: bundled Node not found at %NODE%
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('"%NODE%" --version') do echo [OK] bundled Node: %%v

set "KEY=%DEEPSEEK_API_KEY%"
if "%KEY%"=="" set /p "KEY=Enter DEEPSEEK_API_KEY (blank to skip): "
if not "%KEY%"=="" (
  > "%REPO%\.env" echo DEEPSEEK_API_KEY=%KEY%
  echo [OK] wrote %REPO%\.env
) else (
  echo [!] No API key set; the server boots but LLM calls fail until DEEPSEEK_API_KEY is set.
)

echo.
echo Setup done. Start the web UI with:
echo   start.bat
echo then open http://127.0.0.1:3080
echo.
pause
