@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ==============================================
echo   쿠팡 소싱 프로그램 설치
echo   (처음 한 번만 실행하면 됩니다. 5~10분 걸립니다)
echo ==============================================
echo.

set "PY="
for %%P in ("%LOCALAPPDATA%\Programs\Python\Python312\python.exe" "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" "C:\Python312\python.exe" "C:\Python311\python.exe") do (
  if not defined PY if exist %%P set "PY=%%~P"
)
if not defined PY (
  where py >nul 2>nul && for /f "delims=" %%I in ('py -3 -c "import sys;print(sys.executable)" 2^>nul') do set "PY=%%I"
)
if not defined PY (
  where python >nul 2>nul && for /f "delims=" %%I in ('python -c "import sys;print(sys.executable)" 2^>nul') do set "PY=%%I"
)

if defined PY (
  echo [1/4] 파이썬 발견: %PY%
) else (
  echo [1/4] 파이썬이 없어서 내려받습니다...
  curl -L -o "%TEMP%\python-installer.exe" https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe
  if errorlevel 1 (
    echo   내려받기에 실패했습니다. 인터넷 연결을 확인하고 다시 실행해 주세요.
    pause & exit /b 1
  )
  echo   설치 중... (창이 뜨면 잠시 기다려 주세요)
  "%TEMP%\python-installer.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1
  set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
  if not exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    echo   파이썬 설치가 확인되지 않습니다. 컴퓨터를 재시작한 뒤 설치.bat 을 다시 실행해 주세요.
    pause & exit /b 1
  )
)

echo [2/4] 프로그램 전용 환경 만드는 중...
if not exist ".venv\Scripts\python.exe" "%PY%" -m venv .venv
if not exist ".venv\Scripts\python.exe" (
  echo   환경 생성에 실패했습니다. 이 화면을 캡처해서 보내주세요.
  pause & exit /b 1
)

echo [3/4] 필요한 구성요소 설치 중...
".venv\Scripts\python.exe" -m pip install --upgrade pip -q
".venv\Scripts\python.exe" -m pip install -r requirements.txt -q
if errorlevel 1 (
  echo   구성요소 설치에 실패했습니다. 이 화면을 캡처해서 보내주세요.
  pause & exit /b 1
)

echo [4/4] 브라우저 구성요소 설치 중... (크롬이 있으면 크롬을 그대로 사용합니다)
".venv\Scripts\python.exe" -m playwright install chromium

echo.
echo ==============================================
echo   설치 완료! 이제 "실행.bat" 을 더블클릭하세요.
echo ==============================================
pause
