# 프로그램 업데이트 (프로그램이 꺼진 상태에서 실행)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$venvPy = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) { Write-Host "먼저 '1_install.bat' 을 실행해 주세요." -ForegroundColor Yellow; exit 1 }
& $venvPy -m app.update
if ($LASTEXITCODE -eq 0) { Write-Host "이제 '2_run.bat' 으로 실행하세요." } else { Write-Host "이 화면을 캡처해서 보내주세요." -ForegroundColor Red }
exit $LASTEXITCODE
