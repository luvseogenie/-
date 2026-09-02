# 쿠팡 광고계산기 업데이트 (Windows). 업데이트.bat 이 이 파일을 실행합니다.
# 이 파일이 있는 폴더(= 확장 프로그램 폴더)의 내용을 GitHub 최신 버전으로 바꿉니다. 데이터는 크롬 안에 있어 영향이 없습니다.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$Repo   = 'luvseogenie/-'
$Branch = 'claude/coupang-ad-calculator-automation-28o2wh'
$ExtDir = $PSScriptRoot
$Log    = Join-Path $ExtDir 'update.log'
function Say($m) { Write-Host $m; try { Add-Content -Path $Log -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding UTF8 } catch {} }
function Finish($code) { Write-Host ''; Read-Host '끝났습니다. Enter 를 누르면 창이 닫힙니다' | Out-Null; exit $code }

try {
  Say "확장 프로그램 폴더: $ExtDir"
  if (-not (Test-Path (Join-Path $ExtDir 'manifest.json'))) { throw "이 폴더에 manifest.json 이 없습니다. 업데이트.bat 은 extension 폴더 안에서 실행해야 합니다." }
  $old = (Get-Content (Join-Path $ExtDir 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  Say "현재 버전: v$old"

  $Tmp = Join-Path $env:TEMP ('coupang_calc_' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $Tmp | Out-Null
  $Zip = Join-Path $Tmp 'src.zip'
  $Url = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
  Say "다운로드: $Url"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  try { Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing }
  catch { throw "다운로드 실패: $($_.Exception.Message)  (인터넷 연결이나 회사 보안 프로그램을 확인하세요)" }
  Say ("받은 크기: {0:N0} bytes" -f (Get-Item $Zip).Length)

  Say "압축 해제 중…"
  Expand-Archive -Path $Zip -DestinationPath (Join-Path $Tmp 'x') -Force
  $Top = Get-ChildItem (Join-Path $Tmp 'x') -Directory | Select-Object -First 1
  $NewExt = Join-Path $Top.FullName 'extension'
  if (-not (Test-Path (Join-Path $NewExt 'manifest.json'))) { throw "받은 파일 안에 extension/manifest.json 이 없습니다." }
  $new = (Get-Content (Join-Path $NewExt 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  Say "최신 버전: v$new"
  if ($new -eq $old) { Say "이미 최신 버전입니다. 그래도 파일을 새로 덮어씁니다." }

  # 1) 확장 폴더 교체: 실행 중인 업데이트.bat 과 로그만 남기고 지운 뒤 새 파일 복사
  Say "파일 교체 중…"
  Get-ChildItem -LiteralPath $ExtDir -Force | Where-Object { $_.Name -notin @('업데이트.bat', 'update.log') } | Remove-Item -Recurse -Force
  Get-ChildItem -LiteralPath $NewExt -Force | Where-Object { $_.Name -ne '업데이트.bat' } | Copy-Item -Destination $ExtDir -Recurse -Force
  # 업데이트.bat 자체가 바뀌었으면 옆에 새 파일로 둔다 (실행 중인 파일은 덮어쓰지 않음)
  $newBat = Join-Path $NewExt '업데이트.bat'; $curBat = Join-Path $ExtDir '업데이트.bat'
  if ((Test-Path $newBat) -and (Test-Path $curBat)) {
    if ((Get-FileHash $newBat).Hash -ne (Get-FileHash $curBat).Hash) { Copy-Item $newBat (Join-Path $ExtDir '업데이트.new.bat') -Force; Say "참고: 업데이트.bat 도 새 버전이 있어 '업데이트.new.bat' 으로 두었습니다. 다음부터 그 파일을 쓰세요." }
  }

  # 2) 저장소 전체를 받아둔 경우(상위 폴더에 docs 가 있음) 문서·도구도 갱신
  $Parent = Split-Path -Parent $ExtDir
  if (Test-Path (Join-Path $Parent 'docs')) {
    foreach ($name in @('docs', 'tools', 'README.md', '업데이트.command')) {
      $src = Join-Path $Top.FullName $name
      if (Test-Path $src) { if (Test-Path (Join-Path $Parent $name)) { Remove-Item (Join-Path $Parent $name) -Recurse -Force }; Copy-Item $src -Destination $Parent -Recurse -Force }
    }
    Say "문서·도구 폴더도 갱신했습니다."
  }
  Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue

  Say ""
  Say "업데이트 완료: v$old → v$new"
  Say "크롬이 켜져 있으면 확장 프로그램이 1분 안에 스스로 새로고침됩니다."
  Say "안 되면 chrome://extensions 에서 카드의 새로고침(↻) 을 누르세요."
  Finish 0
}
catch {
  Say ""
  Say "!! 업데이트 실패: $($_.Exception.Message)"
  Say "이 창의 내용(또는 $Log 파일)을 캡처해서 보내 주세요."
  Say "임시 방법: https://github.com/$Repo 에서 Code → Download ZIP 을 받아 extension 폴더를 바꾸세요."
  Finish 1
}
