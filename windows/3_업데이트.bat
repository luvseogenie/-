@echo off
chcp 65001 >nul
title 쿠팡 소싱 분석 - 업데이트
setlocal
set "ROOT=%~dp0.."
set "ZIPNAME=--claude-coupang-sourcing-mvp-73sxqd"
set "DL=%USERPROFILE%\Downloads"
set "TMP_DIR=%TEMP%\coupang_sourcing_update"

echo ============================================
echo   쿠팡 상품 소싱 분석 - 업데이트
echo ============================================
echo.
echo   순서:
echo     1^) GitHub 에서 브랜치 ZIP 을 "내려받기" 폴더에 받아 두세요.
echo        (브랜치: claude/coupang-sourcing-mvp-73sxqd, 파일명 %ZIPNAME%.zip)
echo     2^) 이 파일을 더블클릭하면 가장 최근 ZIP 을 찾아 코드만 새로 덮어씁니다.
echo        수집한 데이터^(DB^)와 설치된 것들은 그대로 둡니다.
echo.

set "ZIP="
for /f "delims=" %%F in ('dir /b /o-d "%DL%\%ZIPNAME%*.zip" 2^>nul') do (
    if not defined ZIP set "ZIP=%DL%\%%F"
)
if not defined ZIP goto :no_zip

echo   찾은 파일: %ZIP%
echo.
echo   [1/4] 압축 푸는 중...
if exist "%TMP_DIR%" rmdir /s /q "%TMP_DIR%"
mkdir "%TMP_DIR%"
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%TMP_DIR%' -Force"
if errorlevel 1 goto :err_unzip

set "SRC="
for /d %%D in ("%TMP_DIR%\*") do (
    if not defined SRC set "SRC=%%D"
)
if not defined SRC goto :err_unzip
if not exist "%SRC%\backend\app" goto :err_layout

echo   [2/4] 코드 덮어쓰는 중... (데이터와 설치 파일은 보존)
for %%S in (backend frontend extension docs windows mac tools) do (
    if exist "%SRC%\%%S" (
        robocopy "%SRC%\%%S" "%ROOT%\%%S" /E /XD .venv node_modules .next __pycache__ /XF *.db *.db-wal *.db-shm 설치기록.txt >nul
    )
)
for %%F in (README.md 시작하기.md VERSION) do (
    if exist "%SRC%\%%F" copy /y "%SRC%\%%F" "%ROOT%\%%F" >nul
)

echo   [3/4] 서버/화면 의존성 갱신 중... (바뀐 게 없으면 금방 끝납니다)
if exist "%ROOT%\backend\.venv\Scripts\python.exe" (
    "%ROOT%\backend\.venv\Scripts\python.exe" -m pip install -q -r "%ROOT%\backend\requirements.txt" >nul 2>&1
)
if exist "%ROOT%\frontend\node_modules" (
    pushd "%ROOT%\frontend"
    call npm install --no-audit --no-fund --loglevel=error >nul 2>&1
    popd
)

echo   [4/4] 정리 중...
rmdir /s /q "%TMP_DIR%" >nul 2>&1
set /p VER=<"%ROOT%\VERSION"
echo.
echo ============================================
echo   업데이트 완료  (버전 %VER%)
echo ============================================
echo.
echo   남은 일 2가지:
echo     1^) 실행 중이던 검은 창들을 닫고 "2_실행.bat" 을 다시 더블클릭
echo     2^) 크롬 주소창에 chrome://extensions 입력 → "쿠팡 소싱 수집기" 카드의
echo        새로고침^(둥근 화살표^) 버튼 클릭  ^(같은 폴더라 다시 로드할 필요 없음^)
echo.
echo   대시보드 오른쪽 위에 "v%VER%" 이 보이면 새 버전입니다.
echo.
pause
exit /b 0

:no_zip
echo   [X] "내려받기" 폴더에서 %ZIPNAME%*.zip 을 찾지 못했습니다.
echo.
echo       https://github.com/luvseogenie/- 에서 브랜치 버튼을 눌러
echo       claude/coupang-sourcing-mvp-73sxqd 를 고른 뒤 Code → Download ZIP 을 받고
echo       이 파일을 다시 더블클릭하세요.
echo.
pause
exit /b 1

:err_unzip
echo   [X] 압축을 풀지 못했습니다. ZIP 파일이 손상됐을 수 있습니다. 다시 받아 주세요.
pause
exit /b 1

:err_layout
echo   [X] ZIP 안에 backend 폴더가 없습니다. 브랜치를 잘못 골라 받은 ZIP 입니다.
echo       브랜치 claude/coupang-sourcing-mvp-73sxqd 를 선택한 뒤 다시 받아 주세요.
pause
exit /b 1
