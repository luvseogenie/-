#!/usr/bin/env bash
# 매일 13:00 cron 이 실행하는 스크립트 (macOS/Linux)
# crontab -e 에 추가:  0 13 * * * /절대경로/scripts/run_daily.sh
set -u
cd "$(dirname "$0")/.."
PY=python3
[ -x .venv/bin/python ] && PY=.venv/bin/python
"$PY" -m coupang_calc run --headless >> data/run.log 2>&1 || echo "[$(date)] 실패. data/run.log 확인" >> data/run.log
