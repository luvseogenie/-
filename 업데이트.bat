@echo off
chcp 65001 >nul
REM 쿠팡 광고계산기 업데이트: GitHub 에서 최신 파일을 받아 이 폴더의 extension 을 교체합니다.
REM 실행 후 크롬이 켜져 있으면 확장 프로그램이 1분 안에 스스로 새로고침됩니다. (안 되면 chrome://extensions 에서 ↻)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update.ps1"
pause
