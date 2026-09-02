@echo off
rem Runs the updater inside the extension folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0extension\update.ps1"
if errorlevel 1 pause
