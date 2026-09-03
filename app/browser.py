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
            from playwright.sync_api import sync_playwright
            self.pw = sync_playwright().start()
        last = None
        for channel in ("chrome", "msedge", None):
            try:
                self.context = self.pw.chromium.launch_persistent_context(
                    str(config.PROFILE_DIR),
                    headless=False,
                    channel=channel,
                    viewport=None,
                    locale="ko-KR",
                    args=["--disable-blink-features=AutomationControlled", "--start-maximized", "--lang=ko-KR"],
                    ignore_default_args=["--enable-automation"],
                )
                self.channel = channel or "chromium"
                self._closed = False
                self.context.on("close", self._on_close)
                self._install_stealth()
                if config.LIGHT_MODE:
                    self._install_lightweight_routes()
                log.info(f"브라우저 창을 열었습니다 ({self.channel})")
                return self.context
            except Exception as e:  # noqa: BLE001
                last = e
        raise RuntimeError(f"브라우저를 열 수 없습니다. 1_install.bat 을 다시 실행해 주세요. ({last})")

    _STEALTH_JS = """
(() => {
  try {
    // 자동 조작 흔적 줄이기: webdriver 표시 제거, 플러그인/언어/권한을 일반 크롬처럼
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    if (!navigator.plugins || navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    }
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
    if (!window.chrome) { window.chrome = { runtime: {}, loadTimes: function () {}, csi: function () {} }; }
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
      window.navigator.permissions.query = (p) => (p && p.name === 'notifications')
        ? Promise.resolve({ state: Notification.permission }) : origQuery(p);
    }
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
