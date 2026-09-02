"""Playwright 로 판매자센터(윙)·광고센터에서 전일 데이터를 자동 수집한다.

동작 방식
- data/browser_profile 에 로그인 세션을 보존한다. 첫 실행은 창이 뜨고 사용자가 직접 로그인한다
  (이메일 인증 포함). 이후 실행은 세션이 남아 있는 동안 로그인 없이 진행된다.
- 화면 요소는 config/collector.json 의 '보이는 글자' 로 찾는다. 쿠팡 화면 개편 시 설정만 바꾼다.
- 실패 시 data/raw/error_*.png 스크린샷을 남긴다. `--debug` 로 실행하면 각 단계에서 멈춰 확인할 수 있다.

주의: 이 모듈은 실제 쿠팡 화면에서 최종 검증이 필요하다. 첫 실행은 반드시 headless=false 로 하고,
메뉴 글자가 다르면 config/collector.json 을 수정한다.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

DEFAULT_CONFIG = Path("config/collector.json")


class CollectError(RuntimeError):
    pass


def load_config(path: Path = DEFAULT_CONFIG) -> Dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class Collector:
    def __init__(self, config: Dict[str, Any], debug: bool = False, headless: Optional[bool] = None):
        try:
            from playwright.sync_api import sync_playwright  # noqa: F401
        except ImportError as e:  # pragma: no cover
            raise CollectError(
                "playwright 가 설치되어 있지 않습니다. `pip install playwright && python -m playwright install chromium`"
            ) from e
        self.cfg = config
        self.debug = debug
        self.headless = config.get("headless", False) if headless is None else headless
        self.timeout = int(config.get("step_timeout_ms", 30000))
        self.download_dir = Path(config.get("download_dir", "data/raw"))
        self.download_dir.mkdir(parents=True, exist_ok=True)
        self._pw = None
        self.ctx = None

    # ---- 브라우저 수명주기 ---------------------------------------------------
    def __enter__(self):
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        profile = Path(self.cfg.get("profile_dir", "data/browser_profile"))
        profile.mkdir(parents=True, exist_ok=True)
        self.ctx = self._pw.chromium.launch_persistent_context(
            str(profile),
            headless=self.headless,
            accept_downloads=True,
            viewport={"width": 1400, "height": 900},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        self.ctx.set_default_timeout(self.timeout)
        return self

    def __exit__(self, *exc):
        if self.ctx:
            self.ctx.close()
        if self._pw:
            self._pw.stop()

    # ---- 공통 ------------------------------------------------------------
    def _page(self, url: str):
        page = self.ctx.new_page()
        page.goto(url, wait_until="domcontentloaded")
        return page

    def _ensure_login(self, page, section: Dict[str, Any], name: str):
        """로그인 페이지면 사용자가 로그인할 때까지(최대 N분) 기다린다."""
        marker = section.get("logged_in_marker_text")
        keyword = section.get("login_url_keyword", "login")
        wait_min = float(self.cfg.get("login_wait_minutes", 10))
        deadline = time.time() + wait_min * 60
        while time.time() < deadline:
            url = page.url.lower()
            try:
                if marker and page.get_by_text(marker, exact=False).first.is_visible(timeout=3000):
                    return
            except Exception:
                pass
            if keyword not in url and not marker:
                return
            if self.headless:
                raise CollectError(
                    f"[{name}] 로그인이 필요합니다. headless 를 끄고 `python -m coupang_calc login` 으로 먼저 로그인하세요."
                )
            print(f"[{name}] 로그인 대기 중... 브라우저 창에서 로그인해 주세요 (남은 시간 {int(deadline - time.time())}초)")
            time.sleep(5)
        raise CollectError(f"[{name}] 로그인 대기 시간이 지났습니다.")

    def _click_text(self, page, text: str):
        loc = page.get_by_role("link", name=text, exact=False)
        if loc.count() == 0:
            loc = page.get_by_role("button", name=text, exact=False)
        if loc.count() == 0:
            loc = page.get_by_text(text, exact=False)
        loc.first.click()
        page.wait_for_load_state("networkidle")
        if self.debug:
            page.pause()

    def _screenshot(self, page, tag: str):
        try:
            p = self.download_dir / f"error_{tag}_{dt.datetime.now():%Y%m%d_%H%M%S}.png"
            page.screenshot(path=str(p), full_page=True)
            print(f"스크린샷 저장: {p}")
        except Exception:
            pass

    # ---- 1) 판매분석 > 상품별 판매 리포트 -------------------------------------
    def download_sales_report(self, date: dt.date) -> Path:
        sec = self.cfg["sales"]
        page = self._page(self.cfg["wing_url"])
        try:
            self._ensure_login(page, sec, "판매자센터")
            for text in sec["menu_texts"]:
                self._click_text(page, text)
            self._click_text(page, sec["yesterday_text"])
            with page.expect_download(timeout=self.timeout * 2) as dl:
                self._click_text(page, sec["download_button_text"])
                item = sec.get("report_item_text")
                if item:
                    try:
                        page.get_by_text(item, exact=False).first.click(timeout=5000)
                    except Exception:
                        pass  # 버튼 하나로 바로 받는 화면이면 무시
            download = dl.value
            suffix = Path(download.suggested_filename).suffix or ".xlsx"
            target = self.download_dir / f"sales_{date:%Y-%m-%d}{suffix}"
            download.save_as(str(target))
            return target
        except Exception:
            self._screenshot(page, "sales")
            raise
        finally:
            page.close()

    # ---- 2) 광고센터 > 광고 관리 > 매출 성장 > 어제 -------------------------------
    def scrape_ads_table(self, date: dt.date) -> List[Dict[str, Any]]:
        sec = self.cfg["ads"]
        page = self._page(self.cfg["ads_url"])
        try:
            self._ensure_login(page, sec, "광고센터")
            for text in sec["menu_texts"]:
                self._click_text(page, text)
            self._click_text(page, sec["yesterday_text"])
            page.wait_for_timeout(1500)
            records = self._read_table(page, sec)
            if not records:
                raise CollectError("캠페인 표를 찾지 못했습니다. config/collector.json 의 ads.table_selector 를 확인하세요.")
            # 원본 사본도 남겨 둔다(디버깅·재처리용)
            raw = self.download_dir / f"ads_{date:%Y-%m-%d}.json"
            raw.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
            return records
        except Exception:
            self._screenshot(page, "ads")
            raise
        finally:
            page.close()

    def _read_table(self, page, sec) -> List[Dict[str, Any]]:
        """캠페인 헤더가 있는 첫 표를 헤더:값 dict 목록으로 읽는다."""
        keyword = sec.get("campaign_header_keyword", "캠페인")
        tables = page.locator(sec.get("table_selector", "table"))
        for i in range(tables.count()):
            t = tables.nth(i)
            headers = [h.strip() for h in t.locator("thead th, thead td").all_inner_texts()]
            if not headers:
                first = t.locator("tr").first
                headers = [h.strip() for h in first.locator("th, td").all_inner_texts()]
            headers = [re.sub(r"\s+", " ", h) for h in headers]
            if not any(keyword in h for h in headers):
                continue
            rows = t.locator("tbody tr")
            out = []
            for r in range(rows.count()):
                cells = [c.strip() for c in rows.nth(r).locator("td, th").all_inner_texts()]
                if len(cells) < 2:
                    continue
                rec = {headers[j] if j < len(headers) else f"col{j}": cells[j] for j in range(len(cells))}
                out.append(rec)
            if out:
                return out
        return []


def interactive_login(config: Dict[str, Any]):
    """창을 띄워 두 사이트에 로그인만 하고 세션을 프로필에 저장한다."""
    with Collector(config, headless=False) as c:
        for key, name in (("wing_url", "판매자센터"), ("ads_url", "광고센터")):
            page = c._page(config[key])
            print(f"{name} 창에서 로그인한 뒤 Enter 를 누르세요...")
            input()
            page.close()
    print("로그인 세션을 저장했습니다:", config.get("profile_dir", "data/browser_profile"))
