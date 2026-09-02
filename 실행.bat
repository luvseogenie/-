@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo 아직 설치되지 않았습니다. 먼저 "설치.bat" 을 실행해 주세요.
  pause & exit /b 1
)
title 쿠팡 소싱 프로그램 (이 창을 닫으면 프로그램이 꺼집니다)
echo 프로그램을 시작합니다. 잠시 후 브라우저에 대시보드가 열립니다.
echo 주소: http://127.0.0.1:8765/
echo.
".venv\Scripts\python.exe" -m app.main
if errorlevel 1 (
  echo.
  echo 프로그램이 오류로 종료되었습니다. 위 내용을 캡처해서 보내주세요.
  pause
)
