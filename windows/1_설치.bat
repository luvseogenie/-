@echo off
chcp 65001 >nul
title 쿠팡 소싱 분석 - 설치
setlocal
cd /d "%~dp0.."

echo ============================================
echo   쿠팡 상품 소싱 분석 - 설치를 시작합니다
echo   (처음 한 번만 하면 됩니다. 5~10분 걸려요)
echo ============================================
echo.

echo [1/5] Python 확인 중...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo   [X] Python이 설치되어 있지 않습니다.
    echo.
    echo   1) https://www.python.org/downloads/ 에서 다운로드
    echo   2) 설치할 때 맨 아래 "Add python.exe to PATH" 를 꼭 체크하세요
    echo   3) 설치 후 이 파일을 다시 실행하세요
    echo.
    pause
    exit /b 1
)
python --version
echo.

echo [2/5] Node.js 확인 중...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo   [X] Node.js가 설치되어 있지 않습니다.
    echo.
    echo   1) https://nodejs.org/ 에서 왼쪽 LTS 버전 다운로드
    echo   2) 계속 "다음"만 눌러서 설치
    echo   3) 설치 후 이 파일을 다시 실행하세요
    echo.
    pause
    exit /b 1
)
node --version
echo.

echo [3/5] 백엔드 설치 중... (2~3분)
cd backend
if not exist .venv (
    python -m venv .venv
)
.venv\Scripts\python.exe -m pip install --quiet --upgrade pip
.venv\Scripts\python.exe -m pip install --quiet -r requirements.txt
if errorlevel 1 (
    echo   [X] 백엔드 설치 실패. 인터넷 연결을 확인하세요.
    pause
    exit /b 1
)
.venv\Scripts\python.exe -m app.cli init-db
cd ..
echo   완료
echo.

echo [4/5] 대시보드 설치 중... (3~5분)
cd frontend
call npm install --silent
if errorlevel 1 (
    echo   [X] 대시보드 설치 실패. 인터넷 연결을 확인하세요.
    pause
    exit /b 1
)
cd ..
echo   완료
echo.

echo [5/5] 크롬 확장 만드는 중... (1분)
cd extension
call npm install --silent
call npm run build
if errorlevel 1 (
    echo   [X] 확장 만들기 실패.
    pause
    exit /b 1
)
cd ..
echo   완료
echo.

echo ============================================
echo   설치가 끝났습니다!
echo.
echo   다음에 할 일:
echo   1) windows 폴더의 "2_실행.bat" 을 더블클릭
echo   2) 크롬 확장 등록 (시작하기.md 4단계 참고)
echo ============================================
echo.
pause
