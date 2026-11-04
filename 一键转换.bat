@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [X] Node.js not found.
  echo      Install it from https://nodejs.org  ^(LTS version^), then run this again.
  echo.
  pause
  exit /b 1
)

node merge.mjs %*

echo.
pause
