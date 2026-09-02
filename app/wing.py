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
    page = bt.new_page()
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


def _trends_search(ctx, query: str, limit: int = 100) -> list:
    body = {"searchCondition": {"start": 0, "limit": limit, "query": query, "sort": ["BEST_SELLING"], "filter": {},
            "context": {"bundleId": 62, "ip": "127.0.0.1", "viewType": "WEB", "sourcePage": "Srp", "pcid": "unknown",
                        "channel": "unknown", "userNo": 0, "uuid": "", "osType": "PC", "appVersion": "1.0.0",
                        "abTests": None, "engineParams": {}, "filteredAbTests": None, "swapSet": None}}}
    resp = ctx.request.post(TRENDS_URL, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                            headers={"content-type": "application/json", "accept": "application/json",
                                     "referer": "https://wing.coupang.com/tenants/rfm-ss/", "origin": "https://wing.coupang.com"},
                            timeout=30000)
    if resp.status in (401, 403) or "login" in resp.url:
        raise WingLoginRequired()
    if resp.status >= 400:
        raise RuntimeError(f"윙 응답 오류 HTTP {resp.status}")
    try:
        data = resp.json()
    except Exception:
        raise RuntimeError("윙 응답을 해석하지 못했습니다 (로그인이 풀렸을 수 있습니다)")
    return data.get("searchItems") or []


def lookup(bt, product: dict):
    """상품 이름으로 윙 인기상품검색을 호출해 조회수·순위·매칭여부를 가져온다.

    반환: (self_fields | None, others: {product_id: fields})
    한 번 검색하면 비슷한 상품 최대 100개가 오므로, 같은 실행에서 아직 분석 안 한
    상품이 그 안에 있으면 함께 채워 호출 수를 줄인다.
    """
    ctx = bt.ensure_context()
    want = product.get("product_id")
    queries = [_clean_query(product.get("name"))]
    # 브랜드+대표명이 너무 길면 앞 두 단어로도 한 번 더 시도
    short = " ".join((product.get("name") or "").split()[:3])
    if short and short not in queries:
        queries.append(short)
    others = {}
    self_fields = None
    for q in queries:
        if not q:
            continue
        items = _trends_search(ctx, q)
        for it in items:
            pid = _to_int(it.get("productId"))
            if pid is None:
                continue
            f = _parse_item(it)
            others[pid] = f
            if pid == want:
                self_fields = f
        if self_fields is not None:
            break
    others.pop(want, None)
    return self_fields, others


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
