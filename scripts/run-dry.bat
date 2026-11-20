@echo off
cd /d "%~dp0.."
where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm was not found. Open README.md and follow the install steps.
  exit /b 1
)
pnpm start --dry-run
exit /b %errorlevel%
