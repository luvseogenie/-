@echo off
chcp 65001 >nul
title 쿠팡 소싱 분석 - 실행
setlocal
set "ROOT=%~dp0.."

if not exist "%ROOT%\backend\.venv\Scripts\python.exe" (
    echo.
    echo   [X] 아직 설치가 끝나지 않았습니다.
    echo.
    echo       1^) 같은 폴더의 "0_진단.bat" 을 더블클릭하세요.
    echo          무엇이 빠졌는지 알려줍니다.
    echo.
    echo       2^) 그 다음 "1_설치.bat" 을 더블클릭하세요.
    echo.
    echo       설치가 실패하면 windows 폴더에 생기는
    echo       "설치기록.txt" 파일을 보내주세요.
    echo.
    pause
    exit /b 1
)

echo ============================================
echo   쿠팡 상품 소싱 분석을 시작합니다
echo ============================================
echo.
echo   검은 창 2개가 새로 열립니다. 끄지 마세요!
echo   (프로그램을 종료할 때 그 창들을 닫으면 됩니다)
echo.

start "쿠팡소싱 - 서버 (닫지 마세요)" /D "%ROOT%\backend" cmd /k .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
timeout /t 3 /nobreak >nul
start "쿠팡소싱 - 화면 (닫지 마세요)" /D "%ROOT%\frontend" cmd /k npm run dev

echo   준비 중입니다. 10초만 기다려주세요...
timeout /t 10 /nobreak >nul

start "" http://localhost:3000

echo.
echo   크롬에 화면이 열렸습니다.
echo   안 열리면 크롬 주소창에 직접 입력하세요:  localhost:3000
echo.
pause
