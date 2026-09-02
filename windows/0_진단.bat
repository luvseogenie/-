@echo off
chcp 65001 >nul
title 쿠팡 소싱 분석 - 진단
setlocal
set "ROOT=%~dp0.."
set "LOG=%~dp0진단결과.txt"

echo ============================================
echo   무엇이 문제인지 확인합니다
echo ============================================
echo.

> "%LOG%" echo === 쿠팡 소싱 분석 진단 결과 ===
>>"%LOG%" echo 시각: %date% %time%
>>"%LOG%" echo 폴더: %ROOT%
>>"%LOG%" echo.

echo [1] 압축을 제대로 풀었는지
echo %~dp0 | find /i "\AppData\Local\Temp\" >nul
if not errorlevel 1 goto :inzip
echo       OK
>>"%LOG%" echo [1] OK - 압축 풀림
echo.

echo [2] 필요한 폴더가 있는지
if not exist "%ROOT%\backend\requirements.txt" goto :nofolder
if not exist "%ROOT%\frontend\package.json" goto :nofolder
if not exist "%ROOT%\extension\package.json" goto :nofolder
echo       OK  backend, frontend, extension
>>"%LOG%" echo [2] OK - 폴더 정상
echo.

echo [3] Python 설치 여부
>>"%LOG%" echo --- python --version ---
python --version >>"%LOG%" 2>&1
if errorlevel 1 goto :nopython
for /f "tokens=*" %%V in ('python --version 2^>^&1') do echo       OK  %%V
>>"%LOG%" echo [3] OK - Python
goto :step4

:nopython
echo       [X] Python이 없습니다. 또는 PATH에 등록되지 않았습니다.
echo.
echo           https://www.python.org/downloads/ 에서 설치하세요.
echo           설치 창 맨 아래 "Add python.exe to PATH" 를 꼭 체크하세요.
echo           설치 후 컴퓨터를 재시작하세요.
>>"%LOG%" echo [3] 실패 - Python 없음
echo.

:step4
echo [4] Node.js 설치 여부
>>"%LOG%" echo --- node --version ---
node --version >>"%LOG%" 2>&1
if errorlevel 1 goto :nonode
for /f "tokens=*" %%V in ('node --version 2^>^&1') do echo       OK  Node.js %%V
>>"%LOG%" echo [4] OK - Node
goto :step5

:nonode
echo       [X] Node.js가 없습니다.
echo.
echo           https://nodejs.org/ 에서 왼쪽 LTS 버전을 설치하세요.
echo           설치 후 컴퓨터를 재시작하세요.
>>"%LOG%" echo [4] 실패 - Node 없음
echo.

:step5
echo [5] 설치가 끝났는지
if exist "%ROOT%\backend\.venv\Scripts\python.exe" goto :b_ok
echo       아직  서버 설치 안 됨
>>"%LOG%" echo [5] 미설치 - backend
goto :f_check
:b_ok
echo       OK    서버 설치됨
>>"%LOG%" echo [5] OK - backend

:f_check
if exist "%ROOT%\frontend\node_modules" goto :f_ok
echo       아직  화면 설치 안 됨
>>"%LOG%" echo [5] 미설치 - frontend
goto :e_check
:f_ok
echo       OK    화면 설치됨
>>"%LOG%" echo [5] OK - frontend

:e_check
if exist "%ROOT%\extension\dist\manifest.json" goto :e_ok
echo       아직  크롬 확장 준비 안 됨
>>"%LOG%" echo [5] 미준비 - extension
goto :done
:e_ok
echo       OK    크롬 확장 준비됨
>>"%LOG%" echo [5] OK - extension
goto :done

:inzip
echo       [X] 문제 발견! ZIP 파일 안에서 바로 실행하고 있습니다.
echo.
echo           ZIP 파일에 마우스 우클릭  -^>  "압축 풀기"
echo           풀린 폴더에서 다시 실행하세요.
>>"%LOG%" echo [1] 실패 - ZIP 내부에서 실행 중
goto :done

:nofolder
echo       [X] 프로그램 폴더를 찾지 못했습니다.
echo.
echo           backend, frontend, extension 폴더가 함께 있는 위치의
echo           windows 폴더 안에서 실행해야 합니다.
>>"%LOG%" echo [2] 실패 - 폴더 구조 이상
goto :done

:done
echo.
echo ============================================
echo   진단 완료
echo.
echo   결과가 windows 폴더의 "진단결과.txt" 에 저장되었습니다.
echo   위 화면이나 그 파일을 보내주세요.
echo ============================================
echo.
pause
