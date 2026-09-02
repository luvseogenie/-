"""공통 로깅 설정.

수집 실패 원인을 반드시 로그로 남기기 위해 사용한다(개발 원칙 18).
"""

from __future__ import annotations

import logging
import sys

_CONFIGURED = False

# 최근 로그를 메모리에 남겨 두어 대시보드 [문제 보고서 복사]가 가져갈 수 있게 한다.
RECENT_LOG_LIMIT = 400
_recent: list[str] = []


class _RecentLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            _recent.append(self.format(record))
            if len(_recent) > RECENT_LOG_LIMIT:
                del _recent[: len(_recent) - RECENT_LOG_LIMIT]
        except Exception:  # 로그 때문에 본 작업이 죽으면 안 된다
            pass


def recent_logs(limit: int = RECENT_LOG_LIMIT) -> list[str]:
    return list(_recent[-limit:])


def configure_logging(level: str = "INFO") -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-7s [%(name)s] %(message)s")
    )
    root = logging.getLogger()
    root.setLevel(level.upper())
    root.addHandler(handler)
    recent = _RecentLogHandler()
    recent.setFormatter(handler.formatter)
    root.addHandler(recent)
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
