#!/bin/bash
# 쿠팡 상품 소싱 분석 - 실행 (맥)
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

if [ ! -d backend/.venv ]; then
  echo "  [X] 아직 설치가 안 되어 있습니다. 먼저 '1_설치.command' 를 더블클릭하세요."
  read -n 1 -s -r; exit 1
fi

echo "쿠팡 상품 소싱 분석을 시작합니다..."
osascript -e "tell app \"Terminal\" to do script \"cd '$ROOT/backend' && ./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000\""
sleep 3
osascript -e "tell app \"Terminal\" to do script \"cd '$ROOT/frontend' && npm run dev\""

echo "준비 중... 10초만 기다려주세요"
sleep 10
open http://localhost:3000
echo "크롬에 화면이 열렸습니다. 안 열리면 주소창에 localhost:3000 입력하세요."
read -n 1 -s -r -p "아무 키나 누르세요..."
