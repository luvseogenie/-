# 프로그램 업데이트 (프로그램이 꺼진 상태에서 실행)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$venvPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) { Write-Host "먼저 '1_install.bat' 을 실행해 주세요." -ForegroundColor Yellow; exit 1 }

# 1) 윈도우 기능으로 먼저 내려받는다
$zip = Join-Path $Root "data\update\latest.zip"
New-Item -ItemType Directory -Force -Path (Split-Path $zip) | Out-Null
$url = "https://codeload.github.com/luvseogenie/-/zip/refs/heads/claude/coupang-sourcing-program-2-5tg37d"
Write-Host "최신 파일 내려받는 중..."
$downloaded = $false
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  $downloaded = (Test-Path $zip) -and ((Get-Item $zip).Length -gt 1000)
} catch { Write-Host "  윈도우 다운로드 실패: $($_.Exception.Message)" }

# 2) 파이썬 쪽에서 적용 (내려받기가 실패했으면 파이썬이 직접 다시 시도)
if ($downloaded) { & $venvPy -m app.update $zip } else { & $venvPy -m app.update }
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "업데이트 완료. 이제 '2_run.bat' 으로 실행하세요." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "업데이트에 실패했습니다. 이 화면과 폴더의 '업데이트기록.txt' 를 캡처해서 보내주세요." -ForegroundColor Red
}
exit $LASTEXITCODE
