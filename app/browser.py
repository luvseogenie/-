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
                log.info(f"브라우저 창을 열었습니다 ({self.channel})")
                return self.context
            except Exception as e:  # noqa: BLE001
                last = e
        raise RuntimeError(f"브라우저를 열 수 없습니다. 설치.bat 을 다시 실행해 주세요. ({last})")

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
