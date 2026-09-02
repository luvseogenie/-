"""프로그램 업데이트: GitHub 브랜치 ZIP을 받아 코드 파일만 덮어쓴다 (data, .venv 는 유지)."""
import io
import os
import shutil
import subprocess
import sys
import threading
import traceback
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

from . import config, log

BRANCH = "claude/coupang-sourcing-program-2-5tg37d"
ZIP_URL = f"https://codeload.github.com/luvseogenie/-/zip/refs/heads/{BRANCH}"
KEEP = {"data", ".venv", "설치기록.txt", "업데이트기록.txt", "__pycache__", ".git"}
UPDATE_DIR = config.DATA_DIR / "update"


def _note(msg):
    """화면 로그 + 업데이트기록.txt 에 남긴다."""
    log.info(msg)
    try:
        with open(config.BASE_DIR / "업데이트기록.txt", "a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")
    except Exception:  # noqa: BLE001
        pass


def current_version() -> str:
    try:
        return (config.BASE_DIR / "VERSION").read_text(encoding="utf-8").strip()
    except Exception:  # noqa: BLE001
        return "?"


def remote_version() -> str | None:
    """GitHub API 로 최신 VERSION 파일 내용을 읽는다."""
    try:
        import base64
        import json as _json
        url = f"https://api.github.com/repos/luvseogenie/-/contents/VERSION?ref={BRANCH}"
        req = urllib.request.Request(url, headers={"User-Agent": "coupang-sourcing-updater", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = _json.loads(r.read().decode("utf-8"))
        return base64.b64decode(d["content"]).decode("utf-8").strip()
    except Exception as e:  # noqa: BLE001
        _note(f"최신 버전 확인 실패(무시함): {e}")
        return None


def _download_python() -> bytes:
    req = urllib.request.Request(ZIP_URL, headers={"User-Agent": "coupang-sourcing-updater"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def _download_powershell() -> bytes:
    UPDATE_DIR.mkdir(parents=True, exist_ok=True)
    out = UPDATE_DIR / "latest.zip"
    if out.exists():
        out.unlink()
    cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
           "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; "
           f"Invoke-WebRequest -Uri '{ZIP_URL}' -OutFile '{out}' -UseBasicParsing"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if r.returncode != 0 or not out.exists():
        raise RuntimeError(f"PowerShell 다운로드 실패: {(r.stderr or r.stdout or '').strip()[:300]}")
    return out.read_bytes()


def download_zip() -> bytes:
    errors = []
    for name, fn in (("python", _download_python), ("powershell", _download_powershell)):
        if name == "powershell" and os.name != "nt":
            continue
        try:
            data = fn()
            if len(data) < 1000:
                raise RuntimeError("받은 파일이 너무 작습니다")
            _note(f"내려받기 성공 ({name}, {len(data)} bytes)")
            return data
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")
            _note(f"내려받기 실패 ({name}): {e}")
    raise RuntimeError("내려받기 실패 - " + " / ".join(errors))


def apply_update(zip_path: str | None = None) -> dict:
    _note(f"업데이트 시작 (현재 {current_version()})")
    data = Path(zip_path).read_bytes() if zip_path else download_zip()
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = zf.namelist()
    if not names:
        raise RuntimeError("받은 파일이 비어 있습니다.")
    top = names[0].split("/")[0]
    changed, failed = 0, []
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
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_suffix(dest.suffix + ".new")
            tmp.write_bytes(new)
            os.replace(tmp, dest)
            changed += 1
        except Exception as e:  # noqa: BLE001
            failed.append(f"{rel}: {e}")
            _note(f"파일 쓰기 실패 {rel}: {e}")
    # 구성요소가 바뀌었을 수 있으니 조용히 다시 설치
    try:
        subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(config.BASE_DIR / "requirements.txt"),
                        "--quiet", "--disable-pip-version-check"], timeout=600, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:  # noqa: BLE001
        _note(f"구성요소 재설치 건너뜀: {e}")
    ver = current_version()
    _note(f"업데이트 완료: 파일 {changed}개 변경, 실패 {len(failed)}개, 버전 {ver}")
    if failed and changed == 0:
        raise RuntimeError("파일을 하나도 쓰지 못했습니다: " + "; ".join(failed[:3]))
    return {"changed": changed, "failed": failed, "version": ver}


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
    zip_arg = sys.argv[1] if len(sys.argv) > 1 else None
    try:
        r = apply_update(zip_arg)
        print(f"완료: 파일 {r['changed']}개 변경, 현재 버전 {r['version']}")
        if r["failed"]:
            print("다음 파일은 쓰지 못했습니다 (프로그램이 켜져 있으면 끄고 다시 시도):")
            for f in r["failed"]:
                print("  - " + f)
    except Exception as e:  # noqa: BLE001
        print(f"업데이트 실패: {e}")
        print(traceback.format_exc())
        _note("업데이트 실패: " + traceback.format_exc())
        sys.exit(1)
