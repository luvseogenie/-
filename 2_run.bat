@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\run.ps1"
echo.
echo (Press any key to close this window)
pause >nul
