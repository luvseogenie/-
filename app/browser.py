"""브라우저 관리. Playwright는 한 스레드에서만 써야 하므로 전용 스레드가 작업을 순서대로 처리한다."""
import queue
import random
import threading
import time
from concurrent.futures import Future

from . import config
from . import log


class BrowserThread(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="browser")
        self.q: "queue.Queue" = queue.Queue()
        self.pw = None
        self.context = None
        self.channel = None
        self.driver = None
        self.busy = None
        self._closed = True

    # ----- 작업 큐 -----
    def run(self):
        while True:
            fn, fut, desc = self.q.get()
            self.busy = desc
            try:
                fut.set_result(fn(self))
            except Exception as e:  # noqa: BLE001
                log.error(f"{desc} 실패: {e}")
                fut.set_exception(e)
            finally:
                self.busy = None

    def submit(self, fn, desc="작업") -> Future:
        fut: Future = Future()
        self.q.put((fn, fut, desc))
        return fut

    def call(self, fn, desc="작업", timeout=None):
        return self.submit(fn, desc).result(timeout=timeout)

    # ----- 브라우저 -----
    def ensure_context(self):
        if self.context is not None and not self._closed:
            return self.context
        if self.pw is None:
            import os as _os
            _os.environ.setdefault("REBROWSER_PATCHES_RUNTIME_FIX_MODE", "addBinding")
            try:
                # 자동 조작 탐지(CDP 흔적)를 피하도록 패치된 구동 라이브러리 (있으면 우선 사용)
                from rebrowser_playwright.sync_api import sync_playwright
                self.driver = "rebrowser"
            except Exception:  # noqa: BLE001
                from playwright.sync_api import sync_playwright
                self.driver = "playwright"
            self.pw = sync_playwright().start()
            log.info(f"브라우저 구동: {self.driver}")
        # 1) 브라우저를 손으로 켠 것과 같은 상태로 직접 실행하고, 프로그램은 거기에 접속해 조종한다 (차단 회피)
        try:
            ctx = self._attach_launch()
            if ctx is not None:
                return ctx
        except Exception as e:  # noqa: BLE001
            log.warn(f"일반 실행 방식 실패, 기존 방식으로 엽니다: {e}")
        last = None
        for channel in self._candidates():
            try:
                kwargs = dict(headless=False, viewport=None, locale="ko-KR",
                              args=["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
                              ignore_default_args=["--enable-automation"])
                if isinstance(channel, tuple):          # (이름, 실행파일 경로)
                    kwargs["executable_path"] = channel[1]
                    label = channel[0]
                else:
                    kwargs["channel"] = channel
                    label = channel or "chromium"
                self.context = self.pw.chromium.launch_persistent_context(str(config.profile_dir()), **kwargs)
                self.channel = label
                self._closed = False
                self.context.on("close", self._on_close)
                self._install_stealth()
                if config.LIGHT_MODE:
                    self._install_lightweight_routes()
                log.info(f"브라우저 창을 열었습니다 ({self.channel})")
                return self.context
            except Exception as e:  # noqa: BLE001
                last = e
        if self.driver == "rebrowser":
            log.warn(f"패치 구동으로 브라우저를 못 열어 기존 방식으로 다시 시도합니다 ({last})")
            try:
                self.pw.stop()
            except Exception:  # noqa: BLE001
                pass
            from playwright.sync_api import sync_playwright as _sp
            self.pw = _sp().start()
            self.driver = "playwright"
            for channel in self._candidates():
                try:
                    kwargs = dict(headless=False, viewport=None, locale="ko-KR",
                                  args=["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
                                  ignore_default_args=["--enable-automation"])
                    if isinstance(channel, tuple):
                        kwargs["executable_path"] = channel[1]
                        label = channel[0]
                    else:
                        kwargs["channel"] = channel
                        label = channel or "chromium"
                    self.context = self.pw.chromium.launch_persistent_context(str(config.profile_dir()), **kwargs)
                    self.channel = label
                    self._closed = False
                    self.context.on("close", self._on_close)
                    self._install_stealth()
                    log.info(f"브라우저 창을 열었습니다 ({self.channel}, playwright)")
                    return self.context
                except Exception as e:  # noqa: BLE001
                    last = e
        raise RuntimeError(f"브라우저를 열 수 없습니다. 1_install.bat 을 다시 실행해 주세요. ({last})")

    # ---------- 일반 실행 + 접속 ----------
    @staticmethod
    def _exe_candidates():
        """설치된 브라우저 실행파일을 찾는다: 웨일 → 엣지 → 크롬 (설정으로 순서 변경 가능)"""
        import os as _os
        env = _os.environ.get("CS_BROWSER_EXE")
        if env and _os.path.exists(env):
            return [("custom", env)]
        la = _os.environ.get("LOCALAPPDATA", "")
        pf = _os.environ.get("PROGRAMFILES", "C:\\Program Files")
        pfx = _os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)")
        cands = {
            "whale": [_os.path.join(la, "Naver", "Naver Whale", "Application", "whale.exe"),
                      _os.path.join(pf, "Naver", "Naver Whale", "Application", "whale.exe"),
                      _os.path.join(pfx, "Naver", "Naver Whale", "Application", "whale.exe")],
            "msedge": [_os.path.join(pfx, "Microsoft", "Edge", "Application", "msedge.exe"),
                       _os.path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe")],
            "chrome": [_os.path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
                       _os.path.join(pfx, "Google", "Chrome", "Application", "chrome.exe"),
                       _os.path.join(la, "Google", "Chrome", "Application", "chrome.exe")],
        }
        pref = (config.browser_pref() or "auto").lower()
        order = [pref] + [k for k in ("msedge", "chrome", "whale") if k != pref] if pref in cands else ["msedge", "chrome", "whale"]
        out = []
        for name in order:
            for path in cands[name]:
                if path and _os.path.exists(path):
                    out.append((name, path))
                    break
        return out

    @staticmethod
    def _free_port():
        import socket
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    def _port_alive(self, port) -> bool:
        from urllib.request import urlopen
        try:
            urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1).read()
            return True
        except Exception:  # noqa: BLE001
            return False

    def _attach_launch(self):
        """브라우저를 자동화 옵션 없이 직접 실행(원격 디버깅 포트만 열어서)하고 접속한다."""
        import os as _os
        import subprocess
        import time as _t
        cands = self._exe_candidates()
        if not cands:
            return None
        port_file = config.DATA_DIR / "browser-port.txt"
        port = None
        try:
            port = int(port_file.read_text().strip())
        except Exception:  # noqa: BLE001
            port = None
        proc = getattr(self, "proc", None)
        if not (port and self._port_alive(port)):
            name, exe = cands[0]
            prof = config.profile_dir()
            if prof != config.PROFILE_DIR:
                pname, _ = config.my_browser_profile()
                match = [c for c in cands if c[0] == pname]
                if match:
                    name, exe = match[0]
                log.info(f"평소 쓰는 {name} 프로필로 실행합니다: {prof}")
            port = self._free_port()
            args = [exe, f"--remote-debugging-port={port}", f"--user-data-dir={prof}",
                    "--no-first-run", "--no-default-browser-check", "--start-maximized", "--lang=ko-KR"]
            if _os.environ.get("CS_BROWSER_HEADLESS"):
                args += ["--headless=new", "--no-sandbox"]
            args.append("about:blank")
            flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
            self.proc = proc
            for _ in range(100):
                if self._port_alive(port):
                    break
                _t.sleep(0.2)
            else:
                if prof != config.PROFILE_DIR:
                    raise RuntimeError(f"{name} 이(가) 이미 열려 있어 프로필을 쓸 수 없습니다. 평소 쓰는 {name} 창을 모두 닫고 다시 시도해 주세요")
                raise RuntimeError(f"{name} 실행 후 접속 포트가 열리지 않았습니다")
            port_file.write_text(str(port))
            self.channel = name
            log.info(f"브라우저를 일반 방식으로 실행했습니다 ({name})")
        else:
            self.channel = getattr(self, "channel", None) or cands[0][0]
            log.info("이미 실행 중인 브라우저에 다시 접속합니다")
        browser = self.pw.chromium.connect_over_cdp(f"http://127.0.0.1:{port}", timeout=30000)
        self.browser = browser
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        self.context = ctx
        self._closed = False
        self.mode = "attach"
        ctx.on("close", self._on_close)
        browser.on("disconnected", self._on_close)
        self._install_stealth()
        if config.LIGHT_MODE:
            self._install_lightweight_routes()
        return ctx

    @staticmethod
    def _whale_path():
        import os as _os
        for p in (_os.path.join(_os.environ.get("LOCALAPPDATA", ""), "Naver", "Naver Whale", "Application", "whale.exe"),
                  _os.path.join(_os.environ.get("PROGRAMFILES", ""), "Naver", "Naver Whale", "Application", "whale.exe"),
                  _os.path.join(_os.environ.get("PROGRAMFILES(X86)", ""), "Naver", "Naver Whale", "Application", "whale.exe")):
            if p and _os.path.exists(p):
                return p
        return None

    def _candidates(self):
        """설정(BROWSER)에 따라 시도 순서를 정한다. auto: 웨일 → 엣지 → 크롬 → 크로미움"""
        pref = (config.browser_pref() or "auto").lower()
        whale = self._whale_path()
        order = []
        if pref == "whale" and whale:
            order.append(("whale", whale))
        elif pref in ("chrome", "msedge"):
            order.append(pref)
        for ch in ("msedge", "chrome"):
            if ch not in order:
                order.append(ch)
        if whale and ("whale", whale) not in order:
            order.append(("whale", whale))
        order.append(None)
        return order

    _STEALTH_JS = """
(() => {
  try {
    // 최소한만: 자동 조작 표시(webdriver)만 감춘다. 다른 속성을 흉내내면 오히려 의심 요소가 된다.
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch (e) {}
})();
"""

    def _install_stealth(self):
        try:
            self.context.add_init_script(self._STEALTH_JS)
        except Exception as e:  # noqa: BLE001
            log.warn(f"위장 스크립트 설정 실패: {e}")

    _BLOCK_HOSTS = ("mercury.coupang.com", "ljc.coupang.com", "asset.coupang.com/ad", "ads.coupang.com",
                    "googletagmanager.com", "google-analytics.com", "doubleclick.net", "facebook.net", "criteo")

    def _install_lightweight_routes(self):
        """이미지·동영상·폰트·광고 요청을 막아 페이지 로딩을 가볍게 한다 (글자·가격·문구는 그대로)."""
        def handler(route, request):
            try:
                rt = request.resource_type
                url = request.url
                if rt in ("image", "media", "font"):
                    return route.abort()
                if any(h in url for h in self._BLOCK_HOSTS):
                    return route.abort()
            except Exception:  # noqa: BLE001
                pass
            return route.continue_()
        try:
            self.context.route("**/*", handler)
            log.info("가벼운 모드: 이미지·동영상·광고 요청을 차단합니다 (설정 LIGHT_MODE)")
        except Exception as e:  # noqa: BLE001
            log.warn(f"가벼운 모드 설정 실패: {e}")

    def _on_close(self, *_):
        self._closed = True
        self.context = None
        log.warn("브라우저 창이 닫혔습니다. 다음 작업 때 다시 엽니다.")

    def reset_profile_soft(self):
        """브라우저만 닫는다 (저장 데이터는 유지)."""
        import time as _t
        try:
            if getattr(self, "mode", None) == "attach" and getattr(self, "browser", None) is not None:
                try:
                    self.browser.close()
                except Exception:  # noqa: BLE001
                    pass
                proc = getattr(self, "proc", None)
                if proc is not None:
                    try:
                        proc.terminate()
                    except Exception:  # noqa: BLE001
                        pass
            elif self.context is not None and not self._closed:
                self.context.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            (config.DATA_DIR / "browser-port.txt").unlink()
        except Exception:  # noqa: BLE001
            pass
        self.context = None
        self._closed = True
        _t.sleep(1.0)
        return True

    def reset_profile(self):
        """브라우저를 닫고 저장 데이터(쿠키·캐시·로그인)를 통째로 새로 만든다."""
        import shutil, time as _t
        try:
            if getattr(self, "mode", None) == "attach" and getattr(self, "browser", None) is not None:
                try:
                    self.browser.close()
                except Exception:  # noqa: BLE001
                    pass
                proc = getattr(self, "proc", None)
                if proc is not None:
                    try:
                        proc.terminate()
                    except Exception:  # noqa: BLE001
                        pass
            elif self.context is not None and not self._closed:
                self.context.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            (config.DATA_DIR / "browser-port.txt").unlink()
        except Exception:  # noqa: BLE001
            pass
        self.context = None
        self._closed = True
        _t.sleep(1.5)
        old = config.PROFILE_DIR
        bak = old.parent / f"browser-profile-old-{int(_t.time())}"
        try:
            if old.exists():
                old.rename(bak)
        except Exception:  # noqa: BLE001
            shutil.rmtree(old, ignore_errors=True)
        old.mkdir(parents=True, exist_ok=True)
        log.info("브라우저 저장 데이터를 초기화했습니다 (윙 로그인 다시 필요)")
        return True

    def page(self):
        ctx = self.ensure_context()
        pages = ctx.pages
        return pages[0] if pages else ctx.new_page()

    def new_page(self):
        return self.ensure_context().new_page()

    def is_open(self) -> bool:
        return self.context is not None and not self._closed


def human_delay(lo=None, hi=None):
    lo = config.DELAY_MIN if lo is None else lo
    hi = config.DELAY_MAX if hi is None else hi
    time.sleep(random.uniform(lo, hi))


browser = BrowserThread()
browser.start()
