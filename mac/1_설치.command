#!/bin/bash
# 쿠팡 상품 소싱 분석 - 설치 (맥)
cd "$(dirname "$0")/.." || exit 1

echo "============================================"
echo "  쿠팡 상품 소싱 분석 - 설치를 시작합니다"
echo "  (처음 한 번만 하면 됩니다. 5~10분 걸려요)"
echo "============================================"
echo

echo "[1/5] Python 확인 중..."
if ! command -v python3 >/dev/null 2>&1; then
  echo
  echo "  [X] Python이 없습니다."
  echo "      https://www.python.org/downloads/ 에서 설치 후 다시 실행하세요."
  read -n 1 -s -r -p "아무 키나 누르세요..."
  exit 1
fi
python3 --version
echo

echo "[2/5] Node.js 확인 중..."
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  [X] Node.js가 없습니다."
  echo "      https://nodejs.org/ 에서 LTS 버전 설치 후 다시 실행하세요."
  read -n 1 -s -r -p "아무 키나 누르세요..."
  exit 1
fi
node --version
echo

echo "[3/5] 백엔드 설치 중... (2~3분)"
cd backend || exit 1
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/python -m pip install --quiet --upgrade pip
./.venv/bin/python -m pip install --quiet -r requirements.txt || { echo "  [X] 설치 실패"; read -n 1 -s -r; exit 1; }
./.venv/bin/python -m app.cli init-db
cd ..
echo "  완료"; echo

echo "[4/5] 대시보드 설치 중... (3~5분)"
cd frontend && npm install --silent || { echo "  [X] 설치 실패"; read -n 1 -s -r; exit 1; }
cd ..
echo "  완료"; echo

echo "[5/5] 크롬 확장 만드는 중... (1분)"
cd extension && npm install --silent && npm run build || { echo "  [X] 실패"; read -n 1 -s -r; exit 1; }
cd ..
echo "  완료"; echo

echo "============================================"
echo "  설치가 끝났습니다!"
echo
echo "  다음: mac 폴더의 '2_실행.command' 를 더블클릭"
echo "============================================"
read -n 1 -s -r -p "아무 키나 누르세요..."
