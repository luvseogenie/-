"""수집·분석 작업 제어. 시작, 일시정지, 재개, 완전중단, 이어하기."""
import threading
import time

from . import config, db, log, wing
from .browser import browser, human_delay
from .categories import expand_to_leaves
from .coupang_list import BlockedError, fetch_listing, fetch_detail_price
from .metrics import restricted_reason


class Stopped(Exception):
    pass


class JobController:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = "idle"          # idle | collecting | analyzing | verifying | capturing
        self.paused = False
        self._stop = False
        self.progress = {"done": 0, "total": 0, "label": ""}
        self.message = ""
        self.run_id = None
        self.future = None

    # ----- 상태 -----
    def status(self):
        return {
            "state": self.state, "paused": self.paused, "progress": dict(self.progress),
            "message": self.message, "run_id": self.run_id,
            "browser_open": browser.is_open(), "browser_busy": browser.busy,
            "wing_configured": wing.is_configured(), "capture": wing.capture_status(),
        }

    def is_running(self):
        return self.state != "idle"

    def _check(self):
        """일시정지면 기다리고, 중단이면 예외를 던진다. 작업 루프 곳곳에서 호출."""
        while True:
            if self._stop:
                raise Stopped()
            if not self.paused:
                return
            time.sleep(0.3)

    def _set(self, state, label="", total=0):
        self.state = state
        self.progress = {"done": 0, "total": total, "label": label}

    def _finish(self):
        self.state = "idle"
        self.paused = False
        self._stop = False

    def _sleep_checked(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            self._check()
            time.sleep(0.5)

    # ----- 제어 -----
    def pause(self):
        if self.is_running():
            self.paused = True
            self.message = "일시정지됨"
            log.info("일시정지")

    def resume(self):
        if self.is_running():
            self.paused = False
            self.message = ""
            log.info("재개")

    def stop(self):
        if self.is_running():
            self._stop = True
            self.paused = False
            self.message = "완전중단 요청"
            log.warn("완전중단 요청")

    # ----- 소싱 시작 (수집) -----
    def start_sourcing(self, scope: list[dict], conditions: dict) -> int:
        with self.lock:
            if self.is_running():
                raise RuntimeError("이미 작업이 진행 중입니다. 완전중단 후 다시 시작해 주세요.")
            run_id = db.create_run(scope, conditions)
            self.run_id = run_id
            self._set("collecting", "범위 확인 중")
            self.message = ""
            self.future = browser.submit(lambda bt: self._collect(bt, run_id, scope, conditions), "소싱 수집")
            return run_id

    def _collect(self, bt, run_id, scope, cond):
        try:
            db.set_run_status(run_id, "collecting")
            targets = []   # (kind, key, name, path)
            for item in scope:
                self._check()
                if item["type"] == "category":
                    self.progress["label"] = f"최하위 카테고리 찾는 중: {item.get('name', item['id'])}"
                    leaves = expand_to_leaves(bt, int(item["id"]), lambda: self._stop)
                    for leaf in leaves:
                        targets.append(("category", leaf["id"], leaf["name"], leaf["path"]))
                elif item["type"] == "keyword":
                    targets.append(("keyword", item["q"], item["q"], f"검색: {item['q']}"))
                elif item["type"] == "product":
                    db.upsert_product(run_id, {"product_id": int(item["id"]), "name": item.get("name") or f"상품 {item['id']}",
                                               "url": config.PRODUCT_URL.format(pid=item["id"]), "category_path": "링크 상품",
                                               "delivery": "WING"}, None)
            # 중복 제거
            uniq = {}
            for t in targets:
                uniq[(t[0], t[1])] = t
            targets = list(uniq.values())
            for kind, key, name, path in targets:
                db.add_run_category(run_id, key if kind == "category" else abs(hash(key)) % 10**9, name, path)
            pages = max(1, int(cond.get("pages") or 1))
            total = len(targets) * pages
            self._set("collecting", "상품 목록 수집 중", total)
            log.info(f"수집 대상 {len(targets)}곳 × {pages}페이지")
            seen_total = 0
            for idx, (kind, key, name, path) in enumerate(targets):
                cat_key = key if kind == "category" else abs(hash(key)) % 10**9
                db.update_run_category(run_id, cat_key, status="running")
                cat_seen = 0
                for page_no in range(1, pages + 1):
                    self._check()
                    self.progress["label"] = f"{path} · {page_no}페이지"
                    data = self._with_retry(lambda: fetch_listing(bt.page(), kind, key, page_no))
                    items = data["items"] if data else []
                    for it in items:
                        it["category_id"] = key if kind == "category" else None
                        it["category_path"] = path
                        it["page"] = page_no
                        restricted = restricted_reason(it.get("name"), path)
                        db.upsert_product(run_id, it, restricted)
                    cat_seen += len(items)
                    seen_total += len(items)
                    self.progress["done"] += 1
                    log.info(f"[{idx + 1}/{len(targets)}] {path} {page_no}p: {len(items)}개")
                    if not items:
                        break
                    human_delay()
                db.update_run_category(run_id, cat_key, status="done", pages_done=pages, products_seen=cat_seen)
            db.set_setting(f"seen_total_{run_id}", seen_total)
            db.set_run_status(run_id, "collected")
            log.info(f"수집 완료: 상품 {seen_total}개 훑음")
            if cond.get("auto_continue") and wing.is_configured():
                self._analyze(bt, run_id, cond)
            elif cond.get("auto_continue"):
                self.message = "수집 완료. 윙 조회 방식이 아직 설정되지 않아 판매량 분석은 건너뜁니다."
            self._finish()
        except Stopped:
            db.set_run_status(run_id, "stopped")
            self.message = "완전중단됨"
            self._finish()
        except Exception as e:  # noqa: BLE001
            db.set_run_status(run_id, "error", str(e))
            self.message = f"오류: {e}"
            log.error(f"수집 오류: {e}")
            self._finish()

    def _with_retry(self, fn, tries=3):
        for attempt in range(1, tries + 1):
            try:
                return fn()
            except BlockedError as e:
                self.message = f"차단 감지: {e}. {config.BLOCK_COOLDOWN}초 쉬었다가 다시 시도합니다 ({attempt}/{tries})"
                log.warn(self.message)
                self._sleep_checked(config.BLOCK_COOLDOWN)
            except Exception as e:  # noqa: BLE001
                log.warn(f"페이지 오류 ({attempt}/{tries}): {e}")
                self._sleep_checked(3)
        return None

    # ----- 28일 판매량 분석 -----
    def start_analyze(self, run_id: int, include_excluded=False) -> None:
        with self.lock:
            if self.is_running():
                raise RuntimeError("이미 작업이 진행 중입니다.")
            if not wing.is_configured():
                raise RuntimeError("윙 조회 방식이 아직 설정되지 않았습니다. 도구 > 윙 캡처 모드를 먼저 진행해 주세요.")
            self.run_id = run_id
            cond = db.get_conditions()
            self._set("analyzing", "판매량 분석 준비")
            self.message = ""
            self.future = browser.submit(lambda bt: self._analyze_wrapper(bt, run_id, cond, include_excluded), "판매량 분석")

    def _analyze_wrapper(self, bt, run_id, cond, include_excluded):
        try:
            self._analyze(bt, run_id, cond, include_excluded)
            self._finish()
        except Stopped:
            db.set_run_status(run_id, "stopped")
            self.message = "완전중단됨"
            self._finish()
        except Exception as e:  # noqa: BLE001
            self.message = f"오류: {e}"
            log.error(f"분석 오류: {e}")
            self._finish()

    def _analyze(self, bt, run_id, cond, include_excluded=False):
        pending = db.pending_products(run_id, include_excluded, cond)
        already = sum(1 for p in db.products(run_id) if p["analyzed"])
        self._set("analyzing", "판매량 분석 수집 중", len(pending) + already)
        self.progress["done"] = already
        db.set_run_status(run_id, "analyzing")
        log.info(f"판매량 분석 시작: {len(pending)}개")
        fails = 0
        for p in pending:
            self._check()
            try:
                result = wing.lookup(bt, p)
                if result:
                    db.save_analysis(run_id, p["product_id"], result, None)
                    fails = 0
                else:
                    db.save_analysis(run_id, p["product_id"], None, "윙에서 찾지 못함")
            except wing.WingLoginRequired:
                self.paused = True
                self.message = "윙 로그인이 필요합니다. 브라우저 창에서 로그인한 뒤 [재개]를 눌러주세요."
                log.warn(self.message)
                try:
                    wing.open_login(bt)
                except Exception:  # noqa: BLE001
                    pass
                self._check()
                continue
            except Exception as e:  # noqa: BLE001
                fails += 1
                db.save_analysis(run_id, p["product_id"], None, str(e)[:200])
                log.warn(f"조회 실패 {p['product_id']}: {e}")
                if fails >= 8:
                    self.message = "연속 실패가 많아 60초 쉽니다."
                    self._sleep_checked(60)
                    fails = 0
            self.progress["done"] += 1
            human_delay(0.4, 1.2)
        db.set_run_status(run_id, "analyzed")
        log.info("판매량 분석 완료")

    def retry_unmatched(self, run_id):
        n = db.reset_unmatched(run_id)
        log.info(f"미매칭 {n}개를 다시 분석 대기로 돌렸습니다")
        if n:
            self.start_analyze(run_id)
        return n

    # ----- 실제가격 확인 -----
    def start_verify(self, run_id, product_ids: list[int]):
        with self.lock:
            if self.is_running():
                raise RuntimeError("이미 작업이 진행 중입니다.")
            self.run_id = run_id
            self._set("verifying", "실제가격 확인 중", len(product_ids))
            self.message = ""
            self.future = browser.submit(lambda bt: self._verify(bt, run_id, product_ids), "실제가격 확인")

    def _verify(self, bt, run_id, product_ids):
        try:
            rows = {p["product_id"]: p for p in db.products(run_id)}
            for pid in product_ids:
                self._check()
                p = rows.get(pid)
                if not p:
                    continue
                self.progress["label"] = (p.get("name") or str(pid))[:40]
                data = self._with_retry(lambda: fetch_detail_price(bt.page(), pid, p.get("item_id"), p.get("vendor_item_id")))
                if data:
                    db.save_verified_price(run_id, pid, data.get("price"))
                    if data.get("sellers"):
                        db.conn().execute("UPDATE products SET seller_count=? WHERE run_id=? AND product_id=?", (data["sellers"], run_id, pid))
                        db.conn().commit()
                self.progress["done"] += 1
                human_delay()
            self._finish()
        except Stopped:
            self.message = "완전중단됨"
            self._finish()
        except Exception as e:  # noqa: BLE001
            self.message = f"오류: {e}"
            log.error(f"실제가격 확인 오류: {e}")
            self._finish()

    # ----- 윙 캡처 -----
    def start_capture(self):
        with self.lock:
            if self.is_running():
                raise RuntimeError("다른 작업이 진행 중입니다. 완전중단 후 캡처를 시작해 주세요.")
            self._set("capturing", "윙 캡처 모드")
            self.message = "윙 캡처 모드: 윙에서 판매량이 보이는 화면을 열어 주세요."

            def task(bt):
                try:
                    return wing.run_capture(bt)
                finally:
                    self._finish()
                    self.message = "윙 캡처가 저장되었습니다. data/wing-capture 폴더의 요약 파일을 보내주세요."
            self.future = browser.submit(task, "윙 캡처")

    def stop_capture(self):
        wing.stop_capture()


job = JobController()
