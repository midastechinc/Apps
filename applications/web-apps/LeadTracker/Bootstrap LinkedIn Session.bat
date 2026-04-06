@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\run_linkedin_pull.ps1" -Bootstrap -Visible
pause
