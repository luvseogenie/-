@echo off
REM 매일 13:00 작업 스케줄러가 실행하는 스크립트 (Windows)
cd /d "%~dp0.."
if exist .venv\Scripts\python.exe (set PY=.venv\Scripts\python.exe) else (set PY=python)
%PY% -m coupang_calc run --headless >> data\run.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] 실패. data\run.log 를 확인하세요. >> data\run.log
)
