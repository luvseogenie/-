@echo off
chcp 65001 >nul
title 쿠팡 소싱 분석 - 설치
setlocal
set "ROOT=%~dp0.."
set "LOG=%~dp0설치기록.txt"

> "%LOG%" echo === 설치 기록 ===
>>"%LOG%" echo 시각: %date% %time%
>>"%LOG%" echo 폴더: %ROOT%

echo ============================================
echo   쿠팡 상품 소싱 분석 - 설치
echo   처음 한 번만 하면 됩니다 (5~10분)
echo ============================================
echo.
echo   * 이 창은 저절로 닫히지 않습니다.
echo   * 문제가 생기면 windows 폴더의 "설치기록.txt" 를 보내주세요.
echo.

REM ---------- ZIP 안에서 실행하는 실수 막기 ----------
echo %~dp0 | find /i "\AppData\Local\Temp\" >nul
if not errorlevel 1 (
    echo   [X] ZIP 파일 안에서 바로 실행하고 있습니다.
    echo.
    echo       ZIP 파일에 우클릭  →  "압축 풀기"
    echo       풀린 폴더에서 다시 실행하세요.
    >>"%LOG%" echo 실패: ZIP 내부 실행
    goto :fail
)

REM ---------- 폴더 확인 ----------
if not exist "%ROOT%\backend\requirements.txt" (
    echo   [X] 프로그램 폴더를 찾지 못했습니다.
    echo.
    echo       backend, frontend, extension 폴더가 함께 있는 위치의
    echo       windows 폴더 안에서 실행해야 합니다.
    >>"%LOG%" echo 실패: 폴더 구조 이상
    goto :fail
)

echo [1/5] Python 확인 중...
python --version >>"%LOG%" 2>&1
if errorlevel 1 (
    echo.
    echo   [X] Python이 설치되어 있지 않습니다.
    echo.
    echo       1^) https://www.python.org/downloads/ 에서 노란 버튼 클릭해 다운로드
    echo       2^) 설치 창 맨 아래 "Add python.exe to PATH" 를 반드시 체크
    echo       3^) 설치 후 컴퓨터를 재시작
    echo       4^) 이 파일을 다시 실행
    >>"%LOG%" echo 실패: Python 없음
    goto :fail
)
for /f "tokens=*" %%V in ('python --version 2^>^&1') do echo       %%V
echo.

echo [2/5] Node.js 확인 중...
node --version >>"%LOG%" 2>&1
if errorlevel 1 (
    echo.
    echo   [X] Node.js가 설치되어 있지 않습니다.
    echo.
    echo       1^) https://nodejs.org/ 에서 왼쪽 "LTS" 버튼 클릭해 다운로드
    echo       2^) 계속 "다음"만 눌러 설치
    echo       3^) 설치 후 컴퓨터를 재시작
    echo       4^) 이 파일을 다시 실행
    >>"%LOG%" echo 실패: Node 없음
    goto :fail
)
for /f "tokens=*" %%V in ('node --version 2^>^&1') do echo       Node.js %%V
echo.

echo [3/5] 서버 설치 중... 2~3분 걸립니다. 기다려주세요.
>>"%LOG%" echo --- backend ---
cd /d "%ROOT%\backend"
if not exist .venv (
    python -m venv .venv >>"%LOG%" 2>&1
)
if not exist .venv\Scripts\python.exe (
    echo   [X] 파이썬 환경을 만들지 못했습니다.
    >>"%LOG%" echo 실패: venv 생성 실패
    goto :fail
)
.venv\Scripts\python.exe -m pip install --upgrade pip >>"%LOG%" 2>&1
.venv\Scripts\python.exe -m pip install -r requirements.txt >>"%LOG%" 2>&1
if errorlevel 1 (
    echo   [X] 서버 설치에 실패했습니다. ^(인터넷 연결 확인^)
    >>"%LOG%" echo 실패: pip install
    goto :fail
)
.venv\Scripts\python.exe -m app.cli init-db >>"%LOG%" 2>&1
if errorlevel 1 (
    echo   [X] 데이터베이스 준비에 실패했습니다.
    >>"%LOG%" echo 실패: init-db
    goto :fail
)
echo       완료
echo.

echo [4/5] 화면 설치 중... 3~5분 걸립니다. 기다려주세요.
>>"%LOG%" echo --- frontend ---
cd /d "%ROOT%\frontend"
call npm install >>"%LOG%" 2>&1
if errorlevel 1 (
    echo   [X] 화면 설치에 실패했습니다. ^(인터넷 연결 확인^)
    >>"%LOG%" echo 실패: npm install frontend
    goto :fail
)
echo       완료
echo.

echo [5/5] 크롬 확장 준비 중... 1분
>>"%LOG%" echo --- extension ---
cd /d "%ROOT%\extension"
call npm install >>"%LOG%" 2>&1
call npm run build >>"%LOG%" 2>&1
if not exist "%ROOT%\extension\dist\manifest.json" (
    echo   [X] 크롬 확장 준비에 실패했습니다.
    >>"%LOG%" echo 실패: extension build
    goto :fail
)
echo       완료
echo.

>>"%LOG%" echo 성공
echo ============================================
echo   설치가 모두 끝났습니다!
echo.
echo   다음에 할 일:
echo     1^) 같은 폴더의 "2_실행.bat" 더블클릭
echo     2^) 크롬 확장 등록 ^(시작하기.md 5단계^)
echo ============================================
echo.
pause
exit /b 0

:fail
echo.
echo ============================================
echo   설치를 마치지 못했습니다.
echo   windows 폴더의 "설치기록.txt" 파일을 보내주시면
echo   원인을 찾아드리겠습니다.
echo ============================================
echo.
pause
exit /b 1
