#!/usr/bin/env bash
# 쿠팡 광고계산기 업데이트 (macOS). 더블클릭하면 GitHub 에서 최신 파일을 받아 extension 폴더를 교체합니다.
set -e
REPO='luvseogenie/-'; BRANCH='claude/coupang-ad-calculator-automation-28o2wh'
ROOT="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
echo "최신 버전을 받는 중…"
curl -sSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.zip" -o "$TMP/u.zip"
unzip -q "$TMP/u.zip" -d "$TMP"
SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
OLD=$(grep -o '"version": *"[^"]*"' "$ROOT/extension/manifest.json" | head -1 | cut -d'"' -f4)
NEW=$(grep -o '"version": *"[^"]*"' "$SRC/extension/manifest.json" | head -1 | cut -d'"' -f4)
rm -rf "$ROOT/extension"; cp -R "$SRC"/. "$ROOT"/
rm -rf "$TMP"
echo "업데이트 완료: v$OLD → v$NEW"
echo "크롬이 켜져 있으면 확장 프로그램이 곧 스스로 새로고침됩니다. 안 되면 chrome://extensions 에서 ↻ 를 누르세요."
