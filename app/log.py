"""간단한 로그. 화면에 최근 로그를 보여주고 파일에도 남긴다."""
import threading
import time
from collections import deque
from datetime import datetime

from . import config

_lock = threading.Lock()
_buffer = deque(maxlen=400)
_file = None


def _open_file():
    global _file
    if _file is None:
        path = config.LOG_DIR / f"{datetime.now():%Y%m%d}.log"
        _file = open(path, "a", encoding="utf-8")
    return _file


def log(level: str, msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    line = {"ts": ts, "level": level, "msg": str(msg)}
    with _lock:
        _buffer.append(line)
        try:
            f = _open_file()
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} [{level}] {msg}\n")
            f.flush()
        except Exception:
            pass
    print(f"[{ts}] [{level}] {msg}", flush=True)


def info(msg):
    log("info", msg)


def warn(msg):
    log("warn", msg)


def error(msg):
    log("error", msg)


def recent(n=120):
    with _lock:
        return list(_buffer)[-n:]
