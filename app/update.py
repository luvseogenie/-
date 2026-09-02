"""프로그램 업데이트: GitHub 브랜치 ZIP을 받아 코드 파일만 덮어쓴다 (data, .venv 는 유지)."""
import io
import os
import shutil
import subprocess
import sys
import threading
import urllib.request
import zipfile
from pathlib import Path

from . import config, log

ZIP_URL = "https://codeload.github.com/luvseogenie/-/zip/refs/heads/claude/coupang-sourcing-program-2-5tg37d"
KEEP = {"data", ".venv", "설치기록.txt", "__pycache__"}


def current_version() -> str:
    try:
        return (config.BASE_DIR / "VERSION").read_text(encoding="utf-8").strip()
    except Exception:  # noqa: BLE001
        return "?"


def remote_version() -> str | None:
    """GitHub API 로 최신 VERSION 파일 내용을 읽는다 (raw 주소는 저장소 이름 때문에 안 열린다)."""
    try:
        import base64
        import json as _json
        url = "https://api.github.com/repos/luvseogenie/-/contents/VERSION?ref=claude/coupang-sourcing-program-2-5tg37d"
        req = urllib.request.Request(url, headers={"User-Agent": "coupang-sourcing-updater", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = _json.loads(r.read().decode("utf-8"))
        return base64.b64decode(d["content"]).decode("utf-8").strip()
    except Exception:  # noqa: BLE001
        return None


def apply_update() -> dict:
    log.info("업데이트 내려받는 중...")
    req = urllib.request.Request(ZIP_URL, headers={"User-Agent": "coupang-sourcing-updater"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = zf.namelist()
    if not names:
        raise RuntimeError("받은 파일이 비어 있습니다.")
    top = names[0].split("/")[0]
    changed = 0
    for name in names:
        if name.endswith("/"):
            continue
        rel = name[len(top) + 1:]
        if not rel:
            continue
        first = rel.split("/")[0]
        if first in KEEP:
            continue
        dest = config.BASE_DIR / rel
        new = zf.read(name)
        try:
            old = dest.read_bytes() if dest.exists() else None
        except Exception:  # noqa: BLE001
            old = None
        if old == new:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(new)
        changed += 1
    # 구성요소가 바뀌었을 수 있으니 조용히 다시 설치
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(config.BASE_DIR / "requirements.txt"),
                        "--quiet", "--disable-pip-version-check"], timeout=600, check=False)
    except Exception as e:  # noqa: BLE001
        log.warn(f"구성요소 재설치 건너뜀: {e}")
    ver = current_version()
    log.info(f"업데이트 완료: 파일 {changed}개 변경, 버전 {ver}")
    return {"changed": changed, "version": ver}


def restart_program():
    """윈도우에서 새 창으로 프로그램을 다시 띄우고 현재 프로세스를 끝낸다."""
    bat = config.BASE_DIR / "2_run.bat"

    def _go():
        try:
            if os.name == "nt" and bat.exists():
                subprocess.Popen(["cmd", "/c", "start", "", str(bat)], cwd=str(config.BASE_DIR),
                                 creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0))
            else:
                subprocess.Popen([sys.executable, "-m", "app.main"], cwd=str(config.BASE_DIR))
        finally:
            os._exit(0)

    threading.Timer(1.0, _go).start()


if __name__ == "__main__":
    print("업데이트를 시작합니다...")
    try:
        r = apply_update()
        print(f"완료: 파일 {r['changed']}개 변경, 현재 버전 {r['version']}")
    except Exception as e:  # noqa: BLE001
        print(f"업데이트 실패: {e}")
        sys.exit(1)
