#!/usr/bin/env bash
# 쿠팡 광고계산기 업데이트 (macOS). 더블클릭하면 이 폴더(확장 프로그램 폴더)를 GitHub 최신 버전으로 바꿉니다.
REPO='luvseogenie/-'; BRANCH='claude/coupang-ad-calculator-automation-28o2wh'
EXT="$(cd "$(dirname "$0")" && pwd)"
LOG="$EXT/update.log"; say() { echo "$1"; echo "[$(date '+%F %T')] $1" >> "$LOG"; }
finish() { echo; read -r -p "끝났습니다. Enter 를 누르면 닫힙니다 " _; exit "$1"; }
[ -f "$EXT/manifest.json" ] || { say "manifest.json 이 없습니다. extension 폴더 안에서 실행하세요."; finish 1; }
OLD=$(grep -o '"version": *"[^"]*"' "$EXT/manifest.json" | head -1 | cut -d'"' -f4); say "현재 버전: v$OLD"
TMP="$(mktemp -d)"
say "다운로드: https://github.com/$REPO/archive/refs/heads/$BRANCH.zip"
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.zip" -o "$TMP/src.zip" || { say "다운로드 실패"; finish 1; }
unzip -q "$TMP/src.zip" -d "$TMP/x" || { say "압축 해제 실패"; finish 1; }
TOP="$(find "$TMP/x" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -f "$TOP/extension/manifest.json" ] || { say "받은 파일에 extension/manifest.json 이 없습니다"; finish 1; }
NEW=$(grep -o '"version": *"[^"]*"' "$TOP/extension/manifest.json" | head -1 | cut -d'"' -f4); say "최신 버전: v$NEW"
find "$EXT" -mindepth 1 -maxdepth 1 ! -name '업데이트.command' ! -name 'update.log' -exec rm -rf {} +
cp -R "$TOP/extension"/. "$EXT"/
PARENT="$(dirname "$EXT")"
if [ -d "$PARENT/docs" ]; then for n in docs tools README.md; do [ -e "$TOP/$n" ] && { rm -rf "$PARENT/$n"; cp -R "$TOP/$n" "$PARENT/"; }; done; say "문서·도구 폴더도 갱신"; fi
rm -rf "$TMP"
say "업데이트 완료: v$OLD → v$NEW"; say "크롬이 켜져 있으면 확장 프로그램이 1분 안에 스스로 새로고침됩니다."
finish 0
