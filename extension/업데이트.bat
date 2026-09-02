@echo off
rem Coupang ad calculator updater. Runs update.ps1 in this folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
if errorlevel 1 (
  echo.
  echo Update failed. See update.log in this folder.
  pause
)
