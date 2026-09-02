#!/usr/bin/env bash
# 저장소 최상위용: extension 폴더 안의 업데이트 스크립트를 실행합니다.
exec "$(cd "$(dirname "$0")" && pwd)/extension/업데이트.command"
