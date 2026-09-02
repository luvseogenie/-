#!/bin/bash
# 쿠팡 소싱 분석 - 업데이트 (Mac)
# 1) GitHub 에서 브랜치 ZIP 을 다운로드 폴더에 받는다  2) 이 파일을 더블클릭한다
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ZIPNAME="--claude-coupang-sourcing-mvp-73sxqd"
ZIP=$(ls -t "$HOME/Downloads/$ZIPNAME"*.zip 2>/dev/null | head -1)
if [ -z "$ZIP" ]; then
  echo "[X] 다운로드 폴더에서 $ZIPNAME*.zip 을 찾지 못했습니다."
  echo "    https://github.com/luvseogenie/- → 브랜치 claude/coupang-sourcing-mvp-73sxqd → Code → Download ZIP"
  read -p "아무 키나 누르면 닫힙니다" -n1; exit 1
fi
echo "찾은 파일: $ZIP"
TMP_DIR=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP_DIR" || { echo "[X] 압축 해제 실패"; exit 1; }
SRC=$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)
[ -d "$SRC/backend/app" ] || { echo "[X] ZIP 안에 backend 폴더가 없습니다 (브랜치 확인)"; exit 1; }
for d in backend frontend extension docs windows mac tools; do
  [ -d "$SRC/$d" ] && rsync -a --exclude .venv --exclude node_modules --exclude .next --exclude __pycache__ --exclude '*.db' --exclude '*.db-wal' --exclude '*.db-shm' "$SRC/$d/" "$ROOT/$d/"
done
for f in README.md 시작하기.md VERSION; do [ -f "$SRC/$f" ] && cp "$SRC/$f" "$ROOT/$f"; done
[ -x "$ROOT/backend/.venv/bin/python" ] && "$ROOT/backend/.venv/bin/python" -m pip install -q -r "$ROOT/backend/requirements.txt" >/dev/null 2>&1
[ -d "$ROOT/frontend/node_modules" ] && (cd "$ROOT/frontend" && npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1)
rm -rf "$TMP_DIR"
echo "업데이트 완료 (버전 $(cat "$ROOT/VERSION"))"
echo "  1) 실행 중이던 터미널을 닫고 2_실행.command 을 다시 더블클릭"
echo "  2) 크롬 chrome://extensions → 쿠팡 소싱 수집기 → 새로고침(둥근 화살표)"
read -p "아무 키나 누르면 닫힙니다" -n1
