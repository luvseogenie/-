# 쿠팡 광고계산기 업데이트 스크립트 (Windows). 업데이트.bat 이 이 파일을 실행합니다.
$ErrorActionPreference = 'Stop'
$Repo   = 'luvseogenie/-'
$Branch = 'claude/coupang-ad-calculator-automation-28o2wh'
$Root   = Split-Path -Parent $PSScriptRoot          # 저장소 폴더 (extension 폴더가 있는 곳)
$Zip    = Join-Path $env:TEMP 'coupang_calc_update.zip'
$Tmp    = Join-Path $env:TEMP 'coupang_calc_update'
$Url    = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"

Write-Host "최신 버전을 받는 중… ($Url)"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force }
Expand-Archive -Path $Zip -DestinationPath $Tmp -Force
$Src = Get-ChildItem $Tmp | Select-Object -First 1     # 압축 안의 최상위 폴더

$old = (Get-Content (Join-Path $Root 'extension\manifest.json') -Raw | ConvertFrom-Json).version
$new = (Get-Content (Join-Path $Src.FullName 'extension\manifest.json') -Raw | ConvertFrom-Json).version

# extension 폴더는 통째로 교체(삭제된 파일도 정리), 나머지는 덮어쓰기
$ext = Join-Path $Root 'extension'
if (Test-Path $ext) { Remove-Item $ext -Recurse -Force }
Copy-Item -Path (Join-Path $Src.FullName '*') -Destination $Root -Recurse -Force
Remove-Item $Zip -Force; Remove-Item $Tmp -Recurse -Force

Write-Host ""
Write-Host "업데이트 완료: v$old → v$new"
Write-Host "크롬이 켜져 있으면 확장 프로그램이 곧 스스로 새로고침됩니다. 안 되면 chrome://extensions 에서 카드의 ↻ 를 누르세요."
