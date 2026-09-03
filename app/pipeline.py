"""수집·분석 작업 제어. 시작, 일시정지, 재개, 완전중단, 이어하기."""
import threading
import time

from . import config, db, log, wing
from .browser import browser, human_delay
from .categories import expand_to_leaves
from .coupang_list import BlockedError, fetch_listing, fetch_detail_price, fetch_option_buyers, fetch_quick_price, reset_debug_budget
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
        self.blocked_streak = 0

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
                    badge_map = db.get_setting("badge_map", {}) or {}
                    for it in items:
                        it["category_id"] = key if kind == "category" else None
                        it["category_path"] = path
                        it["page"] = page_no
                        bk = it.get("badge_key")
                        if bk and bk in badge_map:
                            it["delivery"] = badge_map[bk]
                            it["delivery_sure"] = True
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
            self._quick_prices(bt, run_id, cond)
            if cond.get("auto_continue") and wing.is_configured():
                self._analyze(bt, run_id, cond)
                self._auto_verify(bt, run_id, cond)
            elif cond.get("auto_continue"):
                self.message = "수집 완료. [28일 판매량 분석]을 누르면 윙 조회수 분석을 시작합니다."
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

    def _quick_prices(self, bt, run_id, cond):
        """수집 직후, 목록 가격이 조건 근처인 상품의 쿠폰 적용 최종가를 API 로 받아 온다 (페이지 안 열음)."""
        pmin = int(cond.get("price_min") or 0)
        pmax = int(cond.get("price_max") or 0)
        targets = []
        for p in db.products(run_id):
            if p.get("verified_price") or not p.get("vendor_item_id"):
                continue
            if cond.get("exclude_restricted") and p.get("restricted"):
                continue
            if cond.get("hide_ads") and p.get("is_ad"):
                continue
            lp = p.get("price") or 0
            if pmin and lp < pmin:          # 쿠폰은 가격을 내릴 뿐이므로 하한 미달은 그대로 제외
                continue
            if pmax and lp > pmax * 1.6:    # 상한의 1.6배를 넘으면 쿠폰으로도 못 들어온다고 본다
                continue
            targets.append(p)
        if not targets:
            return
        self._set("collecting", "쿠폰 적용가 확인 중", len(targets))
        log.info(f"쿠폰 적용가 확인: {len(targets)}개 (가격 조건 근처 상품, 가격 API 사용)")
        fails = 0
        moved_in = 0
        api_dead = False
        done_ids = set()
        for p in targets:
            self._check()
            self.progress["label"] = (p.get("name") or "")[:38]
            try:
                r = fetch_quick_price(bt.page(), p["product_id"], p.get("item_id"), p.get("vendor_item_id"))
                if r.get("price"):
                    db.save_quick_price(run_id, p["product_id"], r["price"], r.get("price_sale"), r.get("origin_price"))
                    done_ids.add(p["product_id"])
                    if pmax and (p.get("price") or 0) > pmax >= r["price"]:
                        moved_in += 1
                        log.info(f"쿠폰가로 조건 진입: {(p.get('name') or '')[:30]} 목록 {p.get('price'):,}원 → 최종 {r['price']:,}원")
                    fails = 0
                else:
                    fails += 1
            except BlockedError:
                log.warn("쿠팡이 접근을 막아 쿠폰 적용가 확인을 중단합니다")
                api_dead = True
                break
            except Exception as e:  # noqa: BLE001
                fails += 1
                log.warn(f"쿠폰 적용가 확인 실패 {p['product_id']}: {e}")
            if fails >= 10:
                log.warn("가격 API 가 계속 거부되어 API 방식은 중단합니다")
                api_dead = True
                break
            self.progress["done"] += 1
            human_delay(2.0, 4.0)          # 너무 빠르면 봇 방어에 걸린다
        if api_dead and pmax:
            # 예비 경로: 상한을 넘는 상품(쿠폰으로 조건에 들어올 수 있는 것)만 페이지를 열어 가격을 읽는다
            band = [p for p in targets if p["product_id"] not in done_ids and (p.get("price") or 0) > pmax]
            if band:
                log.info(f"예비 경로: 상한을 넘는 {len(band)}개는 페이지를 열어 최종가를 읽습니다")
                self._set("collecting", "쿠폰 적용가 확인(페이지) 중", len(band))
                for p in band:
                    self._check()
                    self.progress["label"] = (p.get("name") or "")[:38]
                    d = self._with_retry(lambda p=p: fetch_detail_price(bt.page(), p["product_id"], p.get("item_id"), p.get("vendor_item_id")))
                    if d and d.get("price"):
                        db.save_quick_price(run_id, p["product_id"], d["price"], d.get("price_sale"), d.get("origin_price"))
                        if d["price"] <= pmax:
                            moved_in += 1
                            log.info(f"쿠폰가로 조건 진입: {(p.get('name') or '')[:30]} 목록 {p.get('price'):,}원 → 최종 {d['price']:,}원")
                    self.progress["done"] += 1
                    human_delay(3.0, 5.0)
        self.progress["done"] = self.progress["total"]
        log.info(f"쿠폰 적용가 확인 완료 · 쿠폰가로 새로 조건에 들어온 상품 {moved_in}개")

    def _with_retry(self, fn, tries=3):
        for attempt in range(1, tries + 1):
            try:
                result = fn()
                self.blocked_streak = 0
                return result
            except BlockedError as e:
                self.message = f"차단 감지: {e}. {config.BLOCK_COOLDOWN}초 쉬었다가 다시 시도합니다 ({attempt}/{tries})"
                log.warn(self.message)
                self._sleep_checked(config.BLOCK_COOLDOWN)
                try:
                    browser.page().goto(config.COUPANG_HOME, wait_until="domcontentloaded", timeout=60000)
                    browser.page().wait_for_timeout(2000)
                except Exception:  # noqa: BLE001
                    pass
            except Exception as e:  # noqa: BLE001
                log.warn(f"페이지 오류 ({attempt}/{tries}): {e}")
                self._sleep_checked(3)
        self.blocked_streak = getattr(self, "blocked_streak", 0) + 1
        if self.blocked_streak >= 2:
            self.paused = True
            self.message = ("쿠팡이 계속 접근을 막고 있습니다(403). 30분~1시간 뒤에 브라우저 창에서 쿠팡 상품 페이지를 하나 직접 열어 "
                            "정상적으로 보이는지 확인한 뒤 [재개]를 눌러주세요. 보안 확인 화면이 뜨면 직접 통과해 주세요.")
            log.warn(self.message)
            self.blocked_streak = 0
            self._check()
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

    def _auto_verify(self, bt, run_id, cond):
        """손 놓으면 자동: 조건에 맞는(가격·리뷰·조회수 통과) 상품의 실제가격·구매자수·배송을 이어서 확인한다."""
        from .metrics import enrich
        rows = [enrich(p, cond) for p in db.products(run_id)]
        todo = [r for r in rows
                if r.get("pre_pass") and (not r.get("verified_at") or not r.get("verified_price") or not r.get("delivery_sure")
                                          or (cond.get("sum_options") and (r.get("option_total") or r.get("option_count") or 1) > 1 and not r.get("buyers_options")))]
        todo.sort(key=lambda r: -(r.get("views_28") or 0))      # 조회수 높은 상품부터
        ids = [r["product_id"] for r in todo]
        if not ids:
            log.info("상세 확인 대상 없음")
            return
        log.info(f"손 놓으면 자동: 조건 통과 후보 {len(ids)}개 상세 확인 시작")
        self._set("verifying", "실제가격·구매자수 확인 중", len(ids))
        self._verify_loop(bt, run_id, ids)

    def _analyze_wrapper(self, bt, run_id, cond, include_excluded):
        try:
            self._analyze(bt, run_id, cond, include_excluded)
            if cond.get("auto_continue"):
                self._auto_verify(bt, run_id, cond)
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
        self._set("analyzing", "윙 조회수 분석 중", len(pending) + already)
        self.progress["done"] = already
        db.set_run_status(run_id, "analyzing")
        log.info(f"윙 조회수 분석 시작: {len(pending)}개")
        pend_ids = {p["product_id"] for p in pending}
        done = set()
        fails = 0
        wing.reset_caches()
        wing.set_ui_rank(cond.get("fetch_rank"))
        try:
            wing.warmup(bt)
        except wing.WingLoginRequired:
            self.paused = True
            self.message = "윙 로그인이 필요합니다. 열린 브라우저 창에서 윙에 로그인한 뒤 [재개]를 눌러주세요."
            log.warn(self.message)
            try:
                wing.open_login(bt)
            except Exception:  # noqa: BLE001
                pass
            self._check()
        for p in pending:
            self._check()
            pid = p["product_id"]
            if pid in done:
                self.progress["done"] += 1
                continue
            self.progress["label"] = (p.get("name") or str(pid))[:38]
            try:
                self_fields, others = wing.lookup(bt, p)
                if self_fields:
                    db.save_analysis(run_id, pid, self_fields, None)
                else:
                    db.save_analysis(run_id, pid, None, "윙 인기상품검색에서 못 찾음")
                done.add(pid)
                # 같은 검색 결과에 들어있는 다른 상품은 순위·범위를 미리 채워 둔다 (정확한 조회수는 차례가 오면 가져온다)
                filled = 0
                for opid, f in others.items():
                    if opid in pend_ids and opid not in done:
                        db.save_analysis(run_id, opid, f, None)
                        filled += 1
                if filled:
                    log.info(f"'{self.progress['label']}' 검색으로 {filled}개 순위 미리 채움")
                fails = 0
            except wing.WingLoginRequired:
                # 진짜 풀렸는지 한 번 더 확인 (잠깐 튕긴 경우가 있다)
                if wing.recheck_login(bt):
                    log.info("로그인은 살아 있습니다. 계속 진행합니다")
                    self._sleep_checked(2)
                    continue
                self.paused = True
                self.message = ("윙 로그인이 풀렸습니다. 다른 브라우저나 탭에서 같은 계정으로 윙에 로그인하면 이쪽이 끊깁니다. "
                                "열린 크롬 창에서 윙에 다시 로그인한 뒤 [재개]를 눌러주세요.")
                log.warn(self.message)
                try:
                    wing.open_login(bt)
                except Exception:  # noqa: BLE001
                    pass
                self._check()
                continue
            except Exception as e:  # noqa: BLE001
                fails += 1
                db.save_analysis(run_id, pid, None, str(e)[:200])
                done.add(pid)
                log.warn(f"조회 실패 {pid}: {e}")
                if fails >= 8:
                    self.message = "연속 실패가 많아 60초 쉽니다."
                    self._sleep_checked(60)
                    fails = 0
            self.progress["done"] = already + len(done)
            human_delay(0.8, 1.8)
        db.set_run_status(run_id, "analyzed")
        log.info("윙 조회수 분석 완료")

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
            self._set("verifying", "실제가격·구매자수 확인 중", len(product_ids))
            self.message = ""
            self.future = browser.submit(lambda bt: self._verify(bt, run_id, product_ids), "실제가격 확인")

    def _sum_option_buyers(self, bt, run_id, p: dict, primary: dict, cond: dict):
        """옵션이 여러 개인 상품: 윙에서 옵션 목록을 받아 옵션마다 '월 N명 이상 구매'를 읽어 합산한다."""
        cap = int(cond.get("sum_options_max") or 12)
        try:
            options = wing.product_options(bt, p)
        except wing.WingLoginRequired:
            log.warn("옵션 목록을 받으려면 윙 로그인이 필요합니다. 이 상품은 첫 옵션 값만 씁니다")
            return
        except Exception as e:  # noqa: BLE001
            log.warn(f"옵션 목록 조회 실패 {p['product_id']}: {e}")
            return
        options = [o for o in options if o.get("vendor_item_id")]
        if len(options) <= 1:
            return
        truncated = len(options) > cap
        options = options[:cap]
        detail = []
        total = 0
        any_found = False
        done_vid = p.get("vendor_item_id")
        done_iid = p.get("item_id")
        base_label = (p.get("name") or "")[:30]
        log.info(f"  옵션 {len(options)}개 확인 시작" + (f" (전체 {len(options)}개 초과분은 생략)" if truncated else ""))
        for idx, o in enumerate(options, 1):
            self._check()
            self.progress["label"] = f"{base_label} · 옵션 {idx}/{len(options)}"
            if primary is not None and (o["vendor_item_id"] == done_vid or (done_iid and o.get("item_id") == done_iid)):
                b = primary.get("buyers_min")
            else:
                r = self._with_retry(lambda o=o: fetch_option_buyers(bt.page(), p["product_id"], o["item_id"], o["vendor_item_id"]))
                b = (r or {}).get("buyers_min")
                human_delay(2.0, 3.5)
            detail.append({"option": o.get("name") or str(o["item_id"]), "vendor_item_id": o["vendor_item_id"], "buyers_min": b,
                           "price": o.get("price"), "item_id": o.get("item_id")})
            if b:
                total += b
                any_found = True
        per = "/".join((f"{d['buyers_min']:,}" if d.get("buyers_min") else "-") for d in detail)
        if any_found:
            primary_b = (primary or {}).get("buyers_min") or 0
            if total < primary_b:      # 대표 옵션 값이 합산에 안 들어간 경우 보정
                total = primary_b
            db.save_buyers_sum(run_id, p["product_id"], total, len(options), detail)
            log.info(f"  옵션 {len(options)}개 합산: 월 구매 {total:,}명 이상 (옵션별 {per})" + (f" (옵션 {cap}개까지만 확인)" if truncated else ""))
        else:
            # 옵션 페이지에서 문구를 하나도 못 읽음: 대표 옵션 값은 유지한다
            keep = (primary or {}).get("buyers_min")
            db.save_buyers_sum(run_id, p["product_id"], keep, len(options), detail)
            log.info(f"  옵션 {len(options)}개에서 문구를 못 읽음 (옵션별 {per}) · 대표 옵션 값 {keep or '없음'} 유지")

    def _verify(self, bt, run_id, product_ids):
        try:
            self._verify_loop(bt, run_id, product_ids)
            self._finish()
        except Stopped:
            self.message = "완전중단됨"
            self._finish()
        except Exception as e:  # noqa: BLE001
            self.message = f"오류: {e}"
            log.error(f"실제가격 확인 오류: {e}")
            self._finish()

    def _verify_loop(self, bt, run_id, product_ids):
        if True:
            reset_debug_budget(3)
            cond = db.get_conditions()
            rows = {p["product_id"]: p for p in db.products(run_id)}
            for pid in product_ids:
                self._check()
                p = rows.get(pid)
                if not p:
                    continue
                self.progress["label"] = (p.get("name") or str(pid))[:40]
                data = self._with_retry(lambda: fetch_detail_price(bt.page(), pid, p.get("item_id"), p.get("vendor_item_id")))
                if data:
                    db.save_verified_price(run_id, pid, data.get("price"), data.get("buyers_min"), data.get("sellers"),
                                           data.get("price_sale"), data.get("origin_price"))
                    if data.get("delivery"):
                        sure = data.get("delivery_how") in ("badge", "text", "seller")
                        db.set_delivery(run_id, pid, data["delivery"], sure)
                        bk = p.get("badge_key")
                        if sure and bk and data.get("delivery_how") in ("badge", "seller"):
                            bm = db.get_setting("badge_map", {}) or {}
                            if bm.get(bk) != data["delivery"]:
                                bm[bk] = data["delivery"]
                                db.set_setting("badge_map", bm)
                                n = db.apply_badge_map(run_id, bk, data["delivery"])
                                log.info(f"배송 뱃지 학습: {bk} → {data['delivery']} (같은 뱃지 {n}개 반영)")
                    if cond.get("sum_options") and (p.get("option_total") or p.get("option_count") or 1) > 1:
                        self._sum_option_buyers(bt, run_id, p, data, cond)
                    parts = []
                    if data.get("price"):
                        extra = f", 일반가 {data['price_sale']:,}원" if data.get("price_sale") and data["price_sale"] != data["price"] else ""
                        parts.append(f"최종가 {data['price']:,}원{extra}")
                    parts.append(f"월 구매 {data['buyers_min']:,}명 이상" if data.get("buyers_min") else "구매자 문구 없음")
                    if data.get("delivery"):
                        parts.append(f"배송 {data['delivery']}" + (f" (판매자 {data['seller_name']} · {data.get('seller_flags', '-')})" if data.get("seller_name") else " (판매자 정보 없음)"))
                    log.info(f"{self.progress['label']}: " + " · ".join(parts))
                self.progress["done"] += 1
                human_delay(2.5, 4.5)
            log.info("상세 확인 완료")

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
