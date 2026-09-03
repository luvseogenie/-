"""쿠팡 윙 연동.

1) 캡처 모드: 사용자가 윙에서 판매량이 보이는 화면을 여는 동안 통신 내용을 기록한다.
   기록 파일을 보고 조회 방식을 wing_config.json 으로 정한다.
2) 조회: wing_config.json 이 준비되면 상품마다 28일 판매·조회·가격을 가져온다.
"""
import json
import re
import threading
import time
from datetime import datetime
from urllib.parse import quote

from . import config, log


class WingNotConfigured(Exception):
    pass


class WingLoginRequired(Exception):
    pass


_capture_lock = threading.Lock()
_capture = {"active": False, "count": 0, "file": None, "started": None, "stop": False, "urls": {}}


def capture_status():
    with _capture_lock:
        d = dict(_capture)
    d.pop("stop", None)
    d["urls"] = sorted(d["urls"].items(), key=lambda x: -x[1])[:40]
    return d


def _strip_headers(h: dict) -> dict:
    return {k: v for k, v in (h or {}).items() if k.lower() not in ("cookie", "set-cookie", "authorization")}


def _summarize_json(obj, depth=0):
    """응답 구조만 간단히 요약한다 (값은 앞부분만)."""
    if depth > 4:
        return "..."
    if isinstance(obj, dict):
        return {k: _summarize_json(v, depth + 1) for k, v in list(obj.items())[:40]}
    if isinstance(obj, list):
        return [_summarize_json(obj[0], depth + 1)] + ([f"...({len(obj)}개)"] if len(obj) > 1 else []) if obj else []
    if isinstance(obj, str):
        return obj[:80]
    return obj


def run_capture(bt):
    """브라우저 스레드에서 실행. 중단 요청이 올 때까지 윙 통신을 기록한다."""
    ctx = bt.ensure_context()
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = config.CAPTURE_DIR / f"wing_capture_{stamp}.jsonl"
    summary_path = config.CAPTURE_DIR / f"wing_capture_{stamp}_요약.txt"
    f = open(path, "a", encoding="utf-8")
    summary = {}
    with _capture_lock:
        _capture.update({"active": True, "count": 0, "file": path.name, "started": stamp, "stop": False, "urls": {}})

    def on_response(resp):
        try:
            req = resp.request
            url = resp.url
            if "coupang" not in url:
                return
            rtype = req.resource_type
            ctype = (resp.headers.get("content-type") or "").lower()
            if rtype not in ("xhr", "fetch", "document") and "json" not in ctype:
                return
            if any(x in url for x in (".js", ".css", ".png", ".jpg", ".svg", ".woff", "analytics", "log.coupang", "collect")):
                return
            body = None
            parsed = None
            if "json" in ctype or rtype in ("xhr", "fetch"):
                try:
                    body = resp.text()
                    if len(body) > 400000:
                        body = body[:400000] + "...(잘림)"
                    parsed = json.loads(body) if body.strip().startswith(("{", "[")) else None
                except Exception:  # noqa: BLE001
                    body = None
            rec = {
                "ts": datetime.now().strftime("%H:%M:%S"),
                "method": req.method,
                "url": url,
                "status": resp.status,
                "resource_type": rtype,
                "request_headers": _strip_headers(req.headers),
                "post_data": (req.post_data or "")[:20000],
                "content_type": ctype,
                "body": body if (parsed is not None or rtype in ("xhr", "fetch")) else None,
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            f.flush()
            key = re.sub(r"\d{5,}", "{id}", url.split("?")[0])
            with _capture_lock:
                _capture["count"] += 1
                _capture["urls"][key] = _capture["urls"].get(key, 0) + 1
            if key not in summary:
                summary[key] = {"method": req.method, "example_url": url, "post_data": (req.post_data or "")[:2000],
                                "structure": _summarize_json(parsed) if parsed is not None else (body or "")[:500]}
        except Exception as e:  # noqa: BLE001
            log.warn(f"캡처 기록 오류: {e}")

    ctx.on("response", on_response)
    page = ctx.new_page()
    try:
        page.goto(config.WING_HOME, wait_until="domcontentloaded", timeout=60000)
    except Exception as e:  # noqa: BLE001
        log.warn(f"윙 페이지 열기 실패: {e}")
    log.info("윙 캡처 모드 시작. 윙에서 28일 판매량이 보이는 화면을 열고 상품을 하나 검색해 주세요.")
    try:
        while True:
            with _capture_lock:
                stop = _capture["stop"]
            if stop or bt._closed:
                break
            page.wait_for_timeout(500)
    finally:
        try:
            ctx.remove_listener("response", on_response)
        except Exception:  # noqa: BLE001
            pass
        f.close()
        lines = [f"윙 캡처 요약 ({stamp})", "이 파일 내용을 그대로 복사해서 보내주세요.", ""]
        for key, s in summary.items():
            lines.append("=" * 70)
            lines.append(f"{s['method']} {key}")
            lines.append(f"예시 주소: {s['example_url'][:500]}")
            if s["post_data"]:
                lines.append(f"보낸 데이터: {s['post_data'][:1500]}")
            lines.append("응답 구조: " + json.dumps(s["structure"], ensure_ascii=False)[:3000])
        summary_path.write_text("\n".join(lines), encoding="utf-8")
        with _capture_lock:
            _capture["active"] = False
            _capture["file"] = summary_path.name
        log.info(f"윙 캡처 종료. 요약 파일: data/wing-capture/{summary_path.name}")
    return {"file": summary_path.name}


def stop_capture():
    with _capture_lock:
        _capture["stop"] = True


def open_login(bt):
    ctx = bt.ensure_context()
    page = None
    for pg in ctx.pages:
        if "wing.coupang.com" in pg.url or "xauth.coupang.com" in pg.url:
            page = pg
            break
    if page is None:
        page = ctx.new_page()
    page.bring_to_front()
    page.goto(config.WING_HOME, wait_until="domcontentloaded", timeout=60000)
    log.info("윙 로그인 창을 열었습니다. 로그인 후 이 창은 그대로 두셔도 됩니다.")
    return True


# ---------------- 조회 ----------------
def load_config() -> dict | None:
    if not config.WING_CONFIG_PATH.exists():
        return None
    try:
        return json.loads(config.WING_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        log.error(f"wing_config.json 읽기 실패: {e}")
        return None


def is_configured() -> bool:
    return True   # 윙 인기상품검색 API 를 직접 쓰므로 로그인만 되어 있으면 된다


def _dig(obj, path: str):
    """'data.items.0.sales' 같은 경로로 값을 꺼낸다."""
    cur = obj
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except Exception:  # noqa: BLE001
                return None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur


def _to_int(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    m = re.search(r"-?[\d,]+", str(v))
    return int(m.group(0).replace(",", "")) if m else None


TRENDS_URL = "https://wing.coupang.com/tenants/rfm-ss/api/trends/search"

from .coupang_list import FETCH_JS  # noqa: E402


def _is_login_url(url: str) -> bool:
    u = (url or "").lower()
    return "xauth.coupang.com" in u or "/login" in u or "/sso/" in u


def wing_page(bt):
    """로그인된 윙 탭을 찾거나 연다. 로그인 페이지에 있으면 WingLoginRequired."""
    ctx = bt.ensure_context()
    page = None
    for pg in ctx.pages:
        try:
            if "wing.coupang.com" in pg.url and not _is_login_url(pg.url):
                page = pg
                break
        except Exception:  # noqa: BLE001
            continue
    if page is None:
        for pg in ctx.pages:
            try:
                if "wing.coupang.com" in pg.url or "xauth.coupang.com" in pg.url:
                    page = pg
                    break
            except Exception:  # noqa: BLE001
                continue
    if page is None:
        page = ctx.new_page()
        page.goto(config.WING_HOME, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1500)
    if _is_login_url(page.url):
        raise WingLoginRequired()
    return page


def _fetch_json(page, url: str, method: str = "GET", body=None, headers=None):
    """윙 탭 안에서 fetch 를 실행해 JSON 을 돌려준다. 로그인 페이지로 튕기면 WingLoginRequired."""
    hdrs = {"accept": "application/json, text/plain, */*"}
    if headers:
        hdrs.update(headers)
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False)
        hdrs["content-type"] = "application/json"
    try:
        r = page.evaluate(FETCH_JS, {"url": url, "method": method, "body": data, "headers": hdrs})
    except Exception as e:  # noqa: BLE001
        # 탭이 페이지를 넘기는 중이면 실행 문맥이 사라진다 → 잠깐 기다렸다 한 번 더
        if "Execution context" in str(e) or "navigation" in str(e):
            page.wait_for_timeout(1500)
            r = page.evaluate(FETCH_JS, {"url": url, "method": method, "body": data, "headers": hdrs})
        else:
            raise
    if r.get("error"):
        raise RuntimeError(f"요청 실패: {r['error'][:120]}")
    if r["status"] == 401 or _is_login_url(r.get("url")):
        raise WingLoginRequired()
    text = r.get("text") or ""
    if "json" not in (r.get("ctype") or "").lower():
        if "<title>쿠팡!</title>" in text or "error403" in text:
            raise RuntimeError(f"윙이 요청을 거부했습니다 (HTTP {r['status']})")
        if 'name="username"' in text or "login-actions" in text:
            raise WingLoginRequired()
        raise RuntimeError(f"윙 응답이 JSON 이 아닙니다 (HTTP {r['status']})")
    if r["status"] >= 400:
        raise RuntimeError(f"윙 응답 오류 HTTP {r['status']}")
    try:
        return json.loads(text)
    except Exception:
        raise RuntimeError("윙 응답을 해석하지 못했습니다")


def _clean_query(name: str) -> str:
    n = (name or "").split(",")[0].strip()
    return n[:40] if n else (name or "")[:40]


def _gmean(lo, hi):
    lo = lo or 0
    hi = hi or 0
    if lo and hi:
        return int(round((lo * hi) ** 0.5))
    return hi or lo or None


def _parse_item(it: dict) -> dict:
    sp = it.get("salesPrice") or {}
    cats = it.get("displayCategoryInfos") or []
    hierarchy = ""
    if cats and isinstance(cats, list):
        hierarchy = cats[0].get("categoryHierarchy") or ""
    lo = _to_int(it.get("lowerPvLast28d"))
    hi = _to_int(it.get("upperPvLast28d"))
    return {
        "sales_28": None,                       # 윙은 판매량 절대값을 주지 않는다 (조회수만)
        "views_28": _gmean(lo, hi),
        "pv_low": lo, "pv_high": hi,
        "pv_rank": _to_int(it.get("pvLast28dRank")),
        "wing_price": _to_int(sp.get("amount")),
        "wing_name": it.get("productName"),
        "wing_rating": it.get("rating"),
        "wing_review": _to_int(it.get("ratingCount")),
        "wing_category": hierarchy,
        "mergeable": it.get("mergeableStatus"),
        "eligibility": it.get("listingEligibility"),
    }


def _trends_body(query: str, limit: int = 100) -> dict:
    return {"searchCondition": {"start": 0, "limit": limit, "query": query, "sort": ["BEST_SELLING"], "filter": {},
            "context": {"bundleId": 62, "ip": "127.0.0.1", "viewType": "WEB", "sourcePage": "Srp", "pcid": "unknown",
                        "channel": "unknown", "userNo": 0, "uuid": "", "osType": "PC", "appVersion": "1.0.0",
                        "abTests": None, "engineParams": {}, "filteredAbTests": None, "swapSet": None}}}


def _trends_via_request(page, query: str, limit: int = 100) -> list:
    """브라우저 컨텍스트의 요청 기능으로 호출 (쿠키 공유)."""
    resp = page.request.post(TRENDS_URL, data=json.dumps(_trends_body(query, limit), ensure_ascii=False).encode("utf-8"),
                             headers={"content-type": "application/json", "accept": "application/json, text/plain, */*",
                                      "x-requested-with": "XMLHttpRequest"}, timeout=30000, max_redirects=0)
    if resp.status in (301, 302, 303, 307, 308):
        loc = resp.headers.get("location", "")
        if _is_login_url(loc):
            raise WingLoginRequired()
        raise RuntimeError(f"HTTP {resp.status} → {loc[:120]}")
    ctype = (resp.headers.get("content-type") or "").lower()
    text = resp.text()
    if resp.status == 401 or 'name="username"' in text:
        raise WingLoginRequired()
    if resp.status >= 400 or "json" not in ctype:
        raise RuntimeError(f"HTTP {resp.status} {ctype[:40]} {text[:160]!r}")
    return (json.loads(text) or {}).get("searchItems") or []


def _trends_via_ui(page, query: str) -> list:
    """실제 인기상품검색 화면의 검색창에 입력해서 화면이 받는 응답을 읽는다 (느리지만 확실)."""
    if "coupang-trends" not in page.url:
        page.goto(TRENDS_PAGE_URL, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(2000)
        if _is_login_url(page.url):
            raise WingLoginRequired()
    box = None
    for sel in ('input[placeholder*="검색"]', 'input[type="search"]', 'input[type="text"]', 'input:not([type])'):
        loc = page.locator(sel)
        for i in range(min(loc.count(), 5)):
            cand = loc.nth(i)
            try:
                if cand.is_visible():
                    box = cand
                    break
            except Exception:  # noqa: BLE001
                continue
        if box is not None:
            break
    if box is None:
        raise RuntimeError("검색창을 찾지 못했습니다")
    with page.expect_response(lambda r: "trends/search" in r.url, timeout=20000) as ri:
        box.fill("")
        box.fill(query)
        box.press("Enter")
    resp = ri.value
    if resp.status >= 400:
        raise RuntimeError(f"화면 검색 응답 HTTP {resp.status}")
    return (resp.json() or {}).get("searchItems") or []


def _trends_search(page, query: str, limit: int = 100) -> list:
    errors = []
    try:
        data = _fetch_json(page, TRENDS_URL, "POST", _trends_body(query, limit))
        return (data or {}).get("searchItems") or []
    except WingLoginRequired:
        raise
    except Exception as e:  # noqa: BLE001
        errors.append(f"fetch: {e}")
    try:
        return _trends_via_request(page, query, limit)
    except WingLoginRequired:
        raise
    except Exception as e:  # noqa: BLE001
        errors.append(f"request: {e}")
    if _state.get("ui_rank"):
        try:
            return _trends_via_ui(page, query)
        except WingLoginRequired:
            raise
        except Exception as e:  # noqa: BLE001
            errors.append(f"ui: {e}")
    raise RuntimeError(" / ".join(errors))


PREMATCH_URL = "https://wing.coupang.com/tenants/seller-web/vendor-inventory/productmatch/prematch/product-items"
TRENDS_PAGE_URL = "https://wing.coupang.com/tenants/rfm-ss/coupang-trends/popularity-search"
_state = {"trends_disabled": False, "trends_fail": 0, "warmed": False, "ui_rank": False}


def warmup(bt):
    """분석 시작 전에 윙 탭을 인기상품검색 화면으로 한 번 이동시켜 세션을 준비한다."""
    page = wing_page(bt)
    try:
        page.goto(TRENDS_PAGE_URL, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(2500)
        if _is_login_url(page.url):
            # 이 화면만 로그인을 다시 요구하는 경우: 윙 홈으로 돌아가 계속 진행
            log.warn("인기상품검색 화면이 로그인을 요구합니다. 순위 없이 진행합니다")
            _state["trends_disabled"] = True
            page.goto(config.WING_HOME, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(1500)
            if _is_login_url(page.url):
                raise WingLoginRequired()
            return
        _state["warmed"] = True
        log.info("윙 인기상품검색 화면을 열어 두었습니다")
    except WingLoginRequired:
        raise
    except Exception as e:  # noqa: BLE001
        log.warn(f"인기상품검색 화면 열기 실패(순위 없이 진행): {e}")
        try:
            page.goto(config.WING_HOME, wait_until="domcontentloaded", timeout=45000)
        except Exception:  # noqa: BLE001
            pass
PUBLIC_CATEGORY_URL = "https://www.coupang.com/next-api/review/batch?productId={pid}&viRoleCode=3"

_trends_cache: dict = {}        # product_id -> trends 필드 (한 실행 동안 재사용)
_category_cache: dict = {}      # product_id -> 내부 categoryId


def reset_caches():
    _trends_cache.clear()
    _category_cache.clear()
    _state.update({"trends_disabled": False, "trends_fail": 0, "warmed": False})


def set_ui_rank(enabled: bool):
    _state["ui_rank"] = bool(enabled)


def _coupang_page(bt):
    ctx = bt.ensure_context()
    for pg in ctx.pages:
        try:
            if "www.coupang.com" in pg.url:
                return pg
        except Exception:  # noqa: BLE001
            continue
    pg = ctx.new_page()
    pg.goto(config.COUPANG_HOME, wait_until="domcontentloaded", timeout=60000)
    return pg


def _public_category_id(bt, pid):
    """쿠팡 공개 API 로 내부 categoryId 를 얻는다 (쿠팡 탭에서 같은 출처로 요청)."""
    if pid in _category_cache:
        return _category_cache[pid]
    try:
        page = _coupang_page(bt)
        r = page.evaluate(FETCH_JS, {"url": PUBLIC_CATEGORY_URL.format(pid=pid), "method": "GET",
                                     "headers": {"accept": "application/json"}})
        if r.get("status") == 200 and "json" in (r.get("ctype") or ""):
            d = json.loads(r["text"])
            cid = _dig(d, "reviewable.contents.categoryId")
            if cid:
                _category_cache[pid] = cid
                return cid
    except Exception as e:  # noqa: BLE001
        log.warn(f"카테고리번호 조회 실패 {pid}: {e}")
    return None


_SALES_RE = re.compile(r"(sale|sold|order|purchase|buy).*(28|last|month|30)|(28|last|month|30).*(sale|sold|order|purchase|buy)", re.I)


def _scan_sales(data: dict, items: list):
    """응답에서 '28일 판매'처럼 보이는 숫자 항목을 찾는다. 상품 단위가 있으면 그것, 없으면 옵션 합."""
    for k, v in (data or {}).items():
        if _SALES_RE.search(k) and isinstance(v, (int, float)):
            return int(v), k
    total, key = 0, None
    for it in items or []:
        for k, v in (it or {}).items():
            if _SALES_RE.search(k) and isinstance(v, (int, float)):
                total += int(v)
                key = k
    return (total, key + " (옵션 합)") if key else (None, None)


def _prematch(page, product: dict, category_id=None) -> dict | None:
    """카탈로그 매칭 API: 정확한 28일 조회수, 아이템위너 가격, 경쟁 판매자 수."""
    pid = product.get("product_id")
    params = [f"productId={pid}", "allowSingleProduct=true"]
    if product.get("item_id"):
        params.append(f"itemId={product['item_id']}")
    if category_id:
        params.append(f"categoryId={category_id}")
    url = PREMATCH_URL + "?" + "&".join(params)
    try:
        data = _fetch_json(page, url, "GET", None, {"referer": "https://wing.coupang.com/tenants/seller-web/vendor-inventory/formV2"})
    except WingLoginRequired:
        raise
    except RuntimeError as e:
        log.warn(f"카탈로그 매칭 응답 없음 {pid}: {e}")
        return None
    if not isinstance(data, dict) or data.get("productId") is None:
        return None
    items = data.get("items") or []
    mine = None
    for it in items:
        if product.get("item_id") and _to_int(it.get("itemId")) == _to_int(product.get("item_id")):
            mine = it
            break
    if mine is None and items:
        mine = min(items, key=lambda x: (_to_int(x.get("buyboxWinnerPrice")) or 10**12))
    flags = (mine or {}).get("controlFlags") or {}
    do_not_merge = str(flags.get("DO_NOT_MERGE", "")).lower() == "true"
    valid = str(flags.get("VALID", "true")).lower() != "false"
    pv = _to_int(data.get("pvLast28Day"))
    sales28, sales_key = _scan_sales(data, items)
    return {
        "sales_28": sales28,
        "sales_28_key": sales_key,
        "views_28": pv, "pv_low": None, "pv_high": None,
        "pv_exact": True,
        "wing_price": _to_int((mine or {}).get("buyboxWinnerPrice")),
        "seller_count": _to_int((mine or {}).get("itemBuyboxCompetitorCount")),
        "wing_name": data.get("productName"),
        "wing_rating": data.get("productRating"),
        "wing_review": _to_int(data.get("ratingCount")),
        "wing_category": data.get("categoryPath") or "",
        "mergeable": "DECLINE" if do_not_merge else "MERGEABLE",
        "eligibility": "VALID" if valid else "INVALID",
        "option_total": len(items),
    }


def _trends_fill(page, product: dict):
    """인기상품검색으로 순위·조회수 범위를 가져와 캐시에 넣는다 (한 번에 최대 100개)."""
    want = product.get("product_id")
    queries = [_clean_query(product.get("name"))]
    short = " ".join((product.get("name") or "").split()[:3])
    if short and short not in queries:
        queries.append(short)
    for q in queries:
        if not q:
            continue
        for it in _trends_search(page, q):
            pid = _to_int(it.get("productId"))
            if pid is None:
                continue
            f = _parse_item(it)
            f["category_internal"] = _to_int(it.get("categoryId"))
            _trends_cache.setdefault(pid, f)
        if want in _trends_cache:
            break


def lookup(bt, product: dict):
    """상품 하나를 조회한다. 반환: (fields | None, others: {product_id: fields})

    모든 요청은 로그인된 윙 탭 안에서 보낸다 (봇 방어에 걸리지 않도록).
    1) 카탈로그 매칭 API 로 정확한 28일 조회수·아이템위너 가격·경쟁 판매자 수 (핵심)
    2) 인기상품검색으로 순위·범위 보조 (안 되면 건너뜀)
    """
    page = wing_page(bt)
    pid = product.get("product_id")
    before = set(_trends_cache.keys())
    if pid not in _trends_cache and not _state["trends_disabled"]:
        try:
            _trends_fill(page, product)
            _state["trends_fail"] = 0
        except WingLoginRequired as e:
            # 인기상품검색만 로그인 페이지로 돌려보내는 경우가 있다. 카탈로그 매칭이 되면 로그인은 살아 있는 것이므로
            # 여기서는 멈추지 않고 실패로만 센다.
            _state["trends_fail"] += 1
            if _state["trends_fail"] >= 3:
                _state["trends_disabled"] = True
                log.warn("인기상품검색이 로그인 페이지로 돌려보내 이번 분석에서는 순위 없이 진행합니다")
        except Exception as e:  # noqa: BLE001
            _state["trends_fail"] += 1
            if _state["trends_fail"] >= 3:
                _state["trends_disabled"] = True
                log.warn(f"인기상품검색이 계속 실패해 이번 분석에서는 순위 없이 진행합니다 ({e})")
            else:
                log.warn(f"인기상품검색 실패 {pid}: {e}")
    base = dict(_trends_cache.get(pid) or {})
    cat = base.get("category_internal")
    exact = _prematch(page, product, cat)
    if exact is None:
        cat2 = _public_category_id(bt, pid)
        if cat2 and cat2 != cat:
            exact = _prematch(page, product, cat2)
    if exact:
        merged = dict(base)
        merged.update({k: v for k, v in exact.items() if v is not None or k in ("pv_low", "pv_high")})
        if base.get("pv_rank"):
            merged["pv_rank"] = base["pv_rank"]
        self_fields = merged
    elif base:
        self_fields = base
    else:
        self_fields = None
    new_ids = set(_trends_cache.keys()) - before
    others = {k: _trends_cache[k] for k in new_ids if k != pid}
    return self_fields, others


def _goto_settle(page, url: str, timeout: int = 45000):
    """윙 홈은 SSO(xauth) 를 거쳐 되돌아오므로 이동이 중간에 끊겼다는 오류가 날 수 있다.
    그 경우 오류로 보지 않고 리다이렉트가 끝나기를 기다린다."""
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout)
    except Exception as e:  # noqa: BLE001
        if "interrupted by another navigation" not in str(e):
            raise
    page.wait_for_timeout(2500)
    # 아직 xauth 에 머물러 있으면(자동 로그인 처리 중) 조금 더 기다린다
    for _ in range(6):
        if "xauth.coupang.com" not in (page.url or ""):
            break
        page.wait_for_timeout(1000)


def recheck_login(bt) -> bool:
    """로그인 풀림 신호가 왔을 때 실제로 풀렸는지 확인한다. 윙 홈을 다시 열고 알려진 상품을 조회해 본다."""
    try:
        ctx = bt.ensure_context()
        page = None
        for pg in ctx.pages:
            if "wing.coupang.com" in pg.url or "xauth.coupang.com" in pg.url:
                page = pg
                break
        if page is None:
            page = ctx.new_page()
        _goto_settle(page, config.WING_HOME)
        if _is_login_url(page.url):
            return False
        sample = {"product_id": 8350616562, "item_id": 24124670002, "name": "코멧 비닐봉투"}
        return _prematch(page, sample, None) is not None
    except WingLoginRequired:
        return False
    except Exception as e:  # noqa: BLE001
        log.warn(f"로그인 재확인 실패: {e}")
        return False


def product_options(bt, product: dict) -> list:
    """카탈로그 매칭 API 로 상품의 옵션(itemId, vendorItemId, 가격) 목록을 얻는다."""
    page = wing_page(bt)
    pid = product.get("product_id")
    params = [f"productId={pid}", "allowSingleProduct=true"]
    if product.get("item_id"):
        params.append(f"itemId={product['item_id']}")
    data = _fetch_json(page, PREMATCH_URL + "?" + "&".join(params), "GET", None,
                       {"referer": "https://wing.coupang.com/tenants/seller-web/vendor-inventory/formV2"})
    out = []
    for it in (data or {}).get("items") or []:
        vids = it.get("vendorItemIds") or []
        attrs = ", ".join(str(a.get("attributeValue")) for a in (it.get("attributes") or []) if a.get("attributeValue"))
        out.append({"item_id": _to_int(it.get("itemId")), "vendor_item_id": _to_int(vids[0]) if vids else None,
                    "price": _to_int(it.get("buyboxWinnerPrice")), "name": attrs})
    return out


def test_connection(bt) -> dict:
    """윙 연결 테스트: 알려진 상품 하나로 API 들을 호출해 결과를 보여준다."""
    try:
        page = wing_page(bt)
    except WingLoginRequired:
        open_login(bt)
        raise RuntimeError("윙 로그인이 필요합니다. 방금 연 창에서 로그인한 뒤 다시 눌러주세요.")
    out = {"page_url": page.url}
    sample = {"product_id": 8350616562, "item_id": 24124670002, "name": "코멧 뽑아쓰는 분리수거 배접 비닐봉투, 200개, 60L"}
    try:
        ex = _prematch(page, sample, None)
        out["prematch_nocat"] = {k: ex.get(k) for k in ("views_28", "wing_price", "seller_count", "mergeable", "option_total")} if ex else None
    except WingLoginRequired:
        out["prematch_error"] = "로그인 필요"
    except Exception as e:  # noqa: BLE001
        out["prematch_error"] = str(e)
    try:
        raw = _fetch_json(page, PREMATCH_URL + f"?productId={sample['product_id']}&itemId={sample['item_id']}&allowSingleProduct=true", "GET", None,
                          {"referer": "https://wing.coupang.com/tenants/seller-web/vendor-inventory/formV2"})
        out["prematch_keys"] = sorted((raw or {}).keys())
        its = (raw or {}).get("items") or []
        out["item_keys"] = sorted(its[0].keys()) if its else []
        out["item_sample"] = {k: v for k, v in (its[0].items() if its else []) if not isinstance(v, (list, dict))}
        out["sales_scan"] = _scan_sales(raw, its)
    except Exception as e:  # noqa: BLE001
        out["prematch_keys_error"] = str(e)
    try:
        sr = _fetch_json(page, "https://wing.coupang.com/tenants/seller-web/pre-matching/search", "POST",
                         {"keyword": "코멧 분리수거 비닐봉투", "excludedProductIds": [], "searchPage": 0, "searchOrder": "DEFAULT",
                          "sortType": "BEST_SELLING", "searchPageSize": 4})
        res = (sr or {}).get("result") or []
        out["prematching_count"] = len(res)
        out["prematching_keys"] = sorted(res[0].keys()) if res else []
        out["prematching_sample"] = {k: v for k, v in (res[0].items() if res else []) if not isinstance(v, (list, dict))}
    except Exception as e:  # noqa: BLE001
        out["prematching_error"] = str(e)
    try:
        ex = _prematch(page, sample, 1839)
        out["prematch"] = {k: ex.get(k) for k in ("views_28", "sales_28", "sales_28_key", "wing_price", "seller_count", "mergeable", "option_total", "wing_category")} if ex else None
    except WingLoginRequired:
        out["prematch_error"] = "로그인 필요"
    except Exception as e:  # noqa: BLE001
        out["prematch_error"] = str(e)
    try:
        out["public_category"] = _public_category_id(bt, sample["product_id"])
    except Exception as e:  # noqa: BLE001
        out["public_category_error"] = str(e)
    try:
        warmup(bt)
        page = wing_page(bt)
    except WingLoginRequired:
        out["trends_error"] = "로그인 필요"
    prev = _state.get("ui_rank")
    _state["ui_rank"] = True
    try:
        items = _trends_search(page, "코멧 분리수거 비닐봉투")
        out["trends_count"] = len(items)
        out["trends_first"] = {k: items[0].get(k) for k in ("productId", "productName", "lowerPvLast28d", "upperPvLast28d", "pvLast28dRank")} if items else None
    except WingLoginRequired:
        out["trends_error"] = "로그인 필요"
    except Exception as e:  # noqa: BLE001
        out["trends_error"] = str(e)
    finally:
        _state["ui_rank"] = prev
    out["page_url_after"] = page.url
    return out


def lookup_generic(bt, product: dict) -> dict:
    """(예비) wing_config.json 에 적힌 방식으로 상품 하나를 조회한다.

    설정 예시:
    {
      "method": "GET",
      "url": "https://wing.coupang.com/.../search?productId={product_id}",
      "headers": {"accept": "application/json"},
      "body": null,
      "list_path": "data.items",
      "match_field": "productId",
      "fields": {"sales_28": "sales28d", "views_28": "views28d", "wing_price": "salePrice", "wing_name": "productName"},
      "login_check": "login"
    }
    """
    cfg = load_config()
    if not cfg:
        raise WingNotConfigured()
    ctx = bt.ensure_context()
    vals = {
        "product_id": product.get("product_id") or "",
        "item_id": product.get("item_id") or "",
        "vendor_item_id": product.get("vendor_item_id") or "",
        "name": quote(str(product.get("name") or "")),
        "name_raw": str(product.get("name") or ""),
    }
    url = cfg["url"].format(**vals)
    method = (cfg.get("method") or "GET").upper()
    headers = cfg.get("headers") or {}
    body = cfg.get("body")
    if isinstance(body, str):
        body = body.format(**vals)
    elif isinstance(body, dict):
        body = json.loads(json.dumps(body, ensure_ascii=False).format(**vals))
    if method == "GET":
        resp = ctx.request.get(url, headers=headers, timeout=30000)
    else:
        resp = ctx.request.fetch(url, method=method, headers=headers, data=body if isinstance(body, str) else None,
                                 json=body if isinstance(body, dict) else None, timeout=30000)
    if resp.status in (401, 403) or (cfg.get("login_check") and cfg["login_check"] in resp.url):
        raise WingLoginRequired()
    if resp.status >= 400:
        raise RuntimeError(f"윙 응답 오류 HTTP {resp.status}")
    data = resp.json()
    items = _dig(data, cfg["list_path"]) if cfg.get("list_path") else data
    if isinstance(items, dict):
        items = [items]
    if not items:
        return {}
    target = None
    mf = cfg.get("match_field")
    if mf:
        want = str(product.get(cfg.get("match_with", "product_id")))
        for it in items:
            if str(_dig(it, mf)) == want:
                target = it
                break
    if target is None:
        target = items[0]
    fields = cfg.get("fields") or {}
    out = {
        "sales_28": _to_int(_dig(target, fields.get("sales_28", ""))),
        "views_28": _to_int(_dig(target, fields.get("views_28", ""))),
        "wing_price": _to_int(_dig(target, fields.get("wing_price", ""))),
        "wing_name": _dig(target, fields.get("wing_name", "")),
        "seller_count": _to_int(_dig(target, fields.get("seller_count", ""))),
    }
    if out["sales_28"] is None and out["views_28"] is None:
        return {}
    return out
