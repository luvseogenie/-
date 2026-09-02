@echo off
chcp 65001 >nul
title 쿠팡 소싱 분석 - 진단
setlocal
set "ROOT=%~dp0.."
set "LOG=%~dp0진단결과.txt"

echo ============================================
echo   무엇이 문제인지 확인합니다 (10초)
echo ============================================
echo.

> "%LOG%" echo === 쿠팡 소싱 분석 진단 결과 ===
>>"%LOG%" echo 시각: %date% %time%
>>"%LOG%" echo 폴더: %ROOT%
>>"%LOG%" echo.

echo [현재 위치]
echo   %ROOT%
>>"%LOG%" echo [현재 위치] %ROOT%
echo.

echo [1] 압축을 제대로 풀었는지
echo %~dp0 | find /i "\AppData\Local\Temp\" >nul
if not errorlevel 1 (
    echo   [X] 문제 발견!  ZIP 파일 안에서 바로 실행하고 있습니다.
    echo.
    echo       ZIP 파일에 마우스 우클릭  →  "압축 풀기"  →  풀린 폴더에서 다시 실행하세요.
    echo.
    >>"%LOG%" echo [1] 실패 - ZIP 내부에서 실행 중
    goto :end
)
echo   OK
>>"%LOG%" echo [1] OK - 압축 풀림
echo.

echo [2] 필요한 폴더가 있는지
set MISSING=0
for %%D in (backend frontend extension) do (
    if exist "%ROOT%\%%D" (
        echo   OK  %%D
        >>"%LOG%" echo [2] OK %%D
    ) else (
        echo   [X] %%D 폴더가 없습니다
        >>"%LOG%" echo [2] 실패 - %%D 없음
        set MISSING=1
    )
)
if "%MISSING%"=="1" (
    echo.
    echo       압축을 푼 폴더가 아닌 곳에서 실행 중입니다.
    echo       backend, frontend, extension 폴더가 보이는 위치의 windows 폴더에서 실행하세요.
    goto :end
)
echo.

echo [3] Python 설치 여부
python --version >>"%LOG%" 2>&1
if errorlevel 1 (
    echo   [X] Python이 없습니다  ^(또는 PATH에 등록되지 않았습니다^)
    echo.
    echo       https://www.python.org/downloads/ 에서 설치
    echo       설치 창 맨 아래 "Add python.exe to PATH" 를 꼭 체크하세요
    echo       설치 후 컴퓨터를 재시작하세요
    >>"%LOG%" echo [3] 실패 - Python 없음
) else (
    for /f "tokens=*" %%V in ('python --version 2^>^&1') do echo   OK  %%V
    >>"%LOG%" echo [3] OK Python
)
echo.

echo [4] Node.js 설치 여부
node --version >>"%LOG%" 2>&1
if errorlevel 1 (
    echo   [X] Node.js가 없습니다
    echo.
    echo       https://nodejs.org/ 에서 왼쪽 LTS 버전 설치
    echo       설치 후 컴퓨터를 재시작하세요
    >>"%LOG%" echo [4] 실패 - Node 없음
) else (
    for /f "tokens=*" %%V in ('node --version 2^>^&1') do echo   OK  Node.js %%V
    >>"%LOG%" echo [4] OK Node
)
echo.

echo [5] 설치가 끝났는지
if exist "%ROOT%\backend\.venv\Scripts\python.exe" (
    echo   OK  백엔드 설치됨
    >>"%LOG%" echo [5] OK backend
) else (
    echo   아직  백엔드 설치 안 됨  ^(1_설치.bat 을 실행하세요^)
    >>"%LOG%" echo [5] 미설치 backend
)
if exist "%ROOT%\frontend\node_modules" (
    echo   OK  대시보드 설치됨
    >>"%LOG%" echo [5] OK frontend
) else (
    echo   아직  대시보드 설치 안 됨
    >>"%LOG%" echo [5] 미설치 frontend
)
if exist "%ROOT%\extension\dist\manifest.json" (
    echo   OK  크롬 확장 준비됨
    >>"%LOG%" echo [5] OK extension
) else (
    echo   아직  크롬 확장 준비 안 됨
    >>"%LOG%" echo [5] 미준비 extension
)

:end
echo.
echo ============================================
echo   진단이 끝났습니다.
echo   결과가 windows 폴더의 "진단결과.txt" 에 저장되었습니다.
echo   위 내용이나 그 파일을 그대로 보내주세요.
echo ============================================
echo.
pause
