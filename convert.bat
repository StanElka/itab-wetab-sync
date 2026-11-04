@echo off
rem English-named entry point for systems where the Chinese file name is awkward.
chcp 65001 >nul
cd /d "%~dp0"
node merge.mjs %*
pause
