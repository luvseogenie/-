# 쿠팡 소싱 프로그램 실행 스크립트
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Host.UI.RawUI.WindowTitle = "쿠팡 소싱 프로그램 (이 창을 닫으면 프로그램이 꺼집니다)"
$venvPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
  Write-Host "아직 설치되지 않았습니다. 먼저 '1_install.bat' 을 실행해 주세요." -ForegroundColor Yellow
  exit 1
}
Write-Host "프로그램을 시작합니다. 잠시 후 브라우저에 대시보드가 열립니다."
Write-Host "주소: http://127.0.0.1:8765/   (이 창은 닫지 마세요)"
Write-Host ""
& $venvPy -m app.main
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "프로그램이 오류로 종료되었습니다. 위 내용을 캡처해서 보내주세요." -ForegroundColor Red
}
exit $LASTEXITCODE
