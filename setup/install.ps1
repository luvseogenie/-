# 쿠팡 소싱 프로그램 설치 스크립트 (PowerShell)
$ErrorActionPreference = "Continue"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$LogPath = Join-Path $Root "설치기록.txt"
try { Start-Transcript -Path $LogPath -Force | Out-Null } catch {}

function Say($msg) { Write-Host $msg }
function Fail($msg) {
  Write-Host ""
  Write-Host "!! 설치 실패: $msg" -ForegroundColor Red
  Write-Host "   폴더 안의 '설치기록.txt' 파일과 이 화면을 캡처해서 보내주세요."
  try { Stop-Transcript | Out-Null } catch {}
  exit 1
}

Say "=============================================="
Say "  쿠팡 소싱 프로그램 설치"
Say "  (처음 한 번만. 5~10분 걸립니다)"
Say "=============================================="
Say "설치 위치: $Root"
Say ""

# ---------- 1. 파이썬 찾기 ----------
function Test-Python($exe) {
  if (-not $exe) { return $false }
  if (-not (Test-Path $exe)) { return $false }
  try {
    $v = & $exe -c "import sys;print(sys.version_info[0]*100+sys.version_info[1])" 2>$null
    return ([int]$v -ge 310)
  } catch { return $false }
}

$Py = $null
$candidates = @(
  "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
  "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
  "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
  "$env:ProgramFiles\Python312\python.exe",
  "$env:ProgramFiles\Python311\python.exe",
  "C:\Python312\python.exe", "C:\Python311\python.exe"
)
foreach ($c in $candidates) { if (-not $Py -and (Test-Python $c)) { $Py = $c } }
if (-not $Py) {
  try {
    $p = & py -3 -c "import sys;print(sys.executable)" 2>$null
    if ($p -and (Test-Python $p.Trim())) { $Py = $p.Trim() }
  } catch {}
}
if (-not $Py) {
  try {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notlike "*WindowsApps*" -and (Test-Python $cmd.Source)) { $Py = $cmd.Source }
  } catch {}
}

if ($Py) {
  Say "[1/4] 파이썬 발견: $Py"
} else {
  Say "[1/4] 파이썬이 없어서 내려받습니다..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $installer = Join-Path $env:TEMP "python-3.12.7-amd64.exe"
  $ok = $false
  try {
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe" -OutFile $installer -UseBasicParsing
    $ok = (Test-Path $installer) -and ((Get-Item $installer).Length -gt 10MB)
  } catch { Say "  python.org 내려받기 실패: $($_.Exception.Message)" }
  if ($ok) {
    Say "  설치 중... (1~3분, 아무것도 누르지 마세요)"
    $proc = Start-Process -FilePath $installer -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1" -Wait -PassThru
    Say "  설치 프로그램 종료 코드: $($proc.ExitCode)"
    $Py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
  } else {
    Say "  winget 으로 다시 시도합니다..."
    try {
      & winget install --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements --silent
      $Py = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
    } catch { Say "  winget 실패: $($_.Exception.Message)" }
  }
  if (-not (Test-Python $Py)) { Fail "파이썬 설치가 확인되지 않습니다. 컴퓨터를 다시 시작한 뒤 1_install.bat 을 한 번 더 실행해 보세요." }
  Say "  파이썬 설치 완료: $Py"
}

# ---------- 2. 전용 환경 ----------
Say "[2/4] 프로그램 전용 환경 만드는 중..."
$venvPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
  & $Py -m venv (Join-Path $Root ".venv")
}
if (-not (Test-Path $venvPy)) { Fail "전용 환경(.venv)을 만들지 못했습니다." }

# ---------- 3. 구성요소 ----------
Say "[3/4] 필요한 구성요소 설치 중... (2~5분)"
& $venvPy -m pip install --upgrade pip --quiet --disable-pip-version-check
& $venvPy -m pip install -r (Join-Path $Root "requirements.txt") --quiet --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { Fail "구성요소 설치에 실패했습니다. 인터넷 연결을 확인해 주세요." }
$chk = & $venvPy -c "import fastapi, uvicorn, playwright, openpyxl; print('ok')" 2>$null
if ($chk -ne "ok") { Fail "구성요소 확인에 실패했습니다." }

# ---------- 4. 브라우저 ----------
Say "[4/4] 브라우저 구성요소 설치 중... (크롬이 있으면 크롬을 그대로 씁니다)"
& $venvPy -m playwright install chromium
if ($LASTEXITCODE -ne 0) { Say "  (브라우저 구성요소 설치에 실패했지만, 크롬이나 엣지가 있으면 실행에는 문제 없습니다)" }

Say ""
Say "=============================================="
Say "  설치 완료!  이제 '2_run.bat' 을 더블클릭하세요."
Say "=============================================="
try { Stop-Transcript | Out-Null } catch {}
exit 0
