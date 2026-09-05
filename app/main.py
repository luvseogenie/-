"""웹 서버. 대시보드 화면과 API를 제공한다."""
import json
import random
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, log, wing
from .browser import browser
from .categories import discover_children, load_home_tree, top_categories, tree
from .coupang_list import PAGE_INFO_JS, diagnose_category, diagnose_site, fetch_listing, parse_scope_url
from .export import build_xlsx
from .metrics import enrich, summarize
from . import update as updater
from .pipeline import job, Stopped

app = FastAPI(title="쿠팡 소싱 프로그램")
STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
app.mount("/debug-files", StaticFiles(directory=str(config.DEBUG_DIR)), name="debug")


@app.on_event("startup")
def _startup():
    db.init_db()
    db.ensure_top_categories()
    log.info("서버 시작")


@app.middleware("http")
async def no_cache(request: Request, call_next):
    """브라우저가 예전 화면 파일을 캐시에서 꺼내 쓰지 않도록 한다."""
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp


@app.get("/", response_class=HTMLResponse)
def index():
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    v = updater.current_version()
    return html.replace("/static/app.js", f"/static/app.js?v={v}").replace("/static/style.css", f"/static/style.css?v={v}")


@app.get("/favicon.ico")
def favicon():
    return PlainTextResponse("", status_code=204)


def _err(e):
    msg = str(e)
    if not msg:
        name = type(e).__name__
        msg = {"WingLoginRequired": "윙 로그인이 필요합니다. 도구 › 윙 로그인 창 열기 로 로그인한 뒤 다시 눌러주세요.",
               "BlockedError": "쿠팡이 접근을 막았습니다. 잠시 뒤 다시 시도해 주세요."}.get(name, f"오류 ({name})")
    return JSONResponse({"ok": False, "error": msg}, status_code=400)


# ---------- 기본 정보 ----------
@app.get("/api/bootstrap")
def bootstrap():
    run = db.latest_run()
    return {
        "top_categories": top_categories(),
        "conditions": db.get_conditions(),
        "scope": db.get_setting("scope", []),
        "checked": db.get_setting("checked", []),
        "run": dict(run) if run else None,
        "status": job.status(),
        "version": updater.current_version(),
    }


@app.get("/api/categories/{cid}/tree")
def category_tree(cid: int):
    return tree(cid, 3)


@app.post("/api/categories/{cid}/discover")
def category_discover(cid: int, force: bool = False):
    if job.is_running():
        return _err("작업이 진행 중일 때는 카테고리를 불러올 수 없습니다.")
    try:
        browser.call(lambda bt: discover_children(bt, cid, force), "하위 카테고리 찾기", timeout=120)
        return {"ok": True, "tree": tree(cid, 3)}
    except Exception as e:  # noqa: BLE001
        return _err(e)


@app.get("/api/conditions")
def get_conditions():
    return db.get_conditions()


@app.post("/api/conditions")
async def set_conditions(req: Request):
    body = await req.json()
    cond = db.get_conditions()
    for k in config.DEFAULT_CONDITIONS:
        if k in body:
            v = body[k]
            if k in ("exclude_restricted", "hide_ads", "auto_continue", "sum_options", "quick_price", "review_estimate", "auto_verify"):
                cond[k] = bool(v)
            elif k == "conv_min":
                cond[k] = float(v or 0)
            else:
                cond[k] = int(v or 0)
    db.set_setting("conditions", cond)
    return cond


@app.post("/api/scope")
async def save_scope(req: Request):
    body = await req.json()
    db.set_setting("scope", body.get("scope", []))
    db.set_setting("checked", body.get("checked", []))
    return {"ok": True}


@app.post("/api/scope/parse")
async def parse_scope(req: Request):
    body = await req.json()
    out = []
    for line in (body.get("text") or "").splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("http"):
            item = parse_scope_url(s)
            if item:
                out.append(item)
        else:
            out.append({"type": "keyword", "q": s})
    return {"items": out}


# ---------- 실행 제어 ----------
@app.post("/api/run/start")
async def run_start(req: Request):
    body = await req.json()
    scope = body.get("scope") or []
    if not scope:
        return _err("조사할 범위를 먼저 선택해 주세요.")
    cond = db.get_conditions()
    try:
        run_id = job.start_sourcing(scope, cond)
        return {"ok": True, "run_id": run_id}
    except Exception as e:  # noqa: BLE001
        return _err(e)


def _current_run_id():
    run = db.latest_run()
    if not run:
        raise HTTPException(400, "아직 실행한 소싱이 없습니다.")
    return run["id"]


@app.post("/api/run/analyze")
async def run_analyze(req: Request):
    body = await req.json() if req.headers.get("content-length") not in (None, "0") else {}
    try:
        job.start_analyze(_current_run_id(), bool(body.get("include_excluded")))
        return {"ok": True}
    except Exception as e:  # noqa: BLE001
        return _err(e)


@app.post("/api/run/quick_prices")
def run_quick_prices():
    try:
        run_id = _current_run_id()
        with job.lock:
            if job.is_running():
                return _err("이미 작업이 진행 중입니다.")
            cond = db.get_conditions()
            job.run_id = run_id
            job._set("collecting", "쿠폰 적용가 확인 준비")

            def task(bt):
                try:
                    job._quick_prices(bt, run_id, cond)
                finally:
                    job._finish()
            job.future = browser.submit(task, "쿠폰 적용가 확인")
        return {"ok": True}
    except Exception as e:  # noqa: BLE001
        return _err(e)


@app.post("/api/run/review_estimate")
def run_review_estimate():
    try:
        run_id = _current_run_id()
        with job.lock:
            if job.is_running():
                return _err("이미 작업이 진행 중입니다.")
            cond = db.get_conditions()
            job.run_id = run_id
            job._set("analyzing", "리뷰로 판매량 추정 준비")

            def task(bt):
                try:
                    job._review_estimate(bt, run_id, cond)
                except Stopped:
                    job.message = "완전중단됨"
                finally:
                    job._finish()
            job.future = browser.submit(task, "리뷰 판매량 추정")
        return {"ok": True}
    except Exception as e:  # noqa: BLE001
        return _err(e)


@app.post("/api/run/pause")
def run_pause():
    job.pause()
    return {"ok": True}


@app.post("/api/run/resume")
def run_resume():
    job.resume()
    return {"ok": True}


@app.post("/api/run/stop")
def run_stop():
    job.stop()
    return {"ok": True}


@app.post("/api/run/retry_unmatched")
def run_retry():
    try:
        n = job.retry_unmatched(_current_run_id())
        return {"ok": True, "count": n}
    except Exception as e:  # noqa: BLE001
        return _err(e)


@app.post("/api/run/verify")
async def run_verify(req: Request):
    body = await req.json()
    ids = [int(x) for x in body.get("product_ids") or []]
    run_id = _current_run_id()
    cond = db.get_conditions()
    rows = [enrich(p, cond) for p in db.products(run_id)]
    # 조건에 맞는(가격·리뷰·조회수 통과) 상품만 확인한다. 체크한 상품이라도 조건에 안 맞으면 제외.
    eligible_ids = {r["product_id"] for r in rows if r.get("pre_pass")}
    # 아직 확인 안 했거나, 최종가·배송 형태가 확정되지 않은 상품은 다시 연다
    todo = {r["product_id"] for r in rows
            if r.get("pre_pass") and (not r.get("verified_at") or not r.get("verified_price") or not r.get("delivery_sure")
                                      or (cond.get("sum_options") and (r.get("option_total") or r.get("option_count") or 1) > 1 and not r.get("buyers_options")))}
    if ids:
        skipped = len([i for i in ids if i not in eligible_ids])
        ids = [i for i in ids if i in eligible_ids]
        if skipped:
            log.info(f"조건에 맞지 않는 {skipped}개는 확인에서 제외했습니다")
    else:
        by_views = {r["product_id"]: (r.get("views_28") or 0) for r in rows}
        ids = sorted(todo, key=lambda i: -by_views.get(i, 0))    # 조회수 높은 상품부터
    if not ids:
        return _err("확인할 상품이 없습니다. 조건에 맞고 아직 확인하지 않은 상품이 없습니다.")
    try:
        job.start_verify(run_id, ids)
        return {"ok": True, "count": len(ids)}
    except Exception as e:  # noqa: BLE001
        return _err(e)


# ---------- 상태 ----------
def _rows(run_id, cond):
    return [enrich(p, cond) for p in db.products(run_id)]


@app.get("/api/status")
def status():
    run = db.latest_run()
    st = job.status()
    stats = None
    restricted = {}
    if run:
        cond = db.get_conditions()
        rows = _rows(run["id"], cond)
        seen = db.get_setting(f"seen_total_{run['id']}", 0) or sum(r.get("seen_count") or 1 for r in rows)
        for r in rows:
            if r.get("restricted"):
                restricted[r["restricted"]] = restricted.get(r["restricted"], 0) + 1
        # 못 파는 물건 빼기가 켜져 있으면 통계에서도 뺀다 (화면 표와 숫자를 맞추기 위해)
        if cond.get("exclude_restricted"):
            rows = [r for r in rows if not r.get("restricted")]
        if cond.get("hide_ads"):
            rows = [r for r in rows if not r.get("is_ad")]
        stats = summarize(rows, db.run_categories(run["id"]), seen)
    excluded_n = sum(1 for r in rows if r["verdict"] == "excluded") if run else 0
    return {"status": st, "run": dict(run) if run else None, "stats": stats, "restricted": restricted,
            "excluded": excluded_n, "logs": log.recent(60)}


def _apply_filters(rows, cond, flt, q, leaf, sort, direction):
    if cond.get("exclude_restricted") and flt != "restricted":
        rows = [r for r in rows if not r.get("restricted")]
    if cond.get("hide_ads"):
        rows = [r for r in rows if not r.get("is_ad")]
    if flt == "hidden":
        rows = [r for r in rows if r.get("hidden")]
    else:
        rows = [r for r in rows if not r.get("hidden")]
        if flt == "all":
            # "전체"는 조건에 맞는 상품 전체 (가격·리뷰 조건 제외 상품은 전용 칩에서만)
            rows = [r for r in rows if r["verdict"] != "excluded"]
        if flt in ("pass", "below", "excluded", "unmatched", "pending"):
            rows = [r for r in rows if r["verdict"] == flt]
        elif flt == "coupon":
            rows = [r for r in rows if r.get("coupon_flag")]
        elif flt == "restricted":
            rows = [r for r in rows if r.get("restricted")]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in (r.get("name") or "").lower() or ql in str(r.get("product_id"))
                or ql in (r.get("category_path") or "").lower()]
    if leaf:
        rows = [r for r in rows if str(r.get("category_id")) == str(leaf) or r.get("category_path") == leaf]
    keymap = {
        "sales": lambda r: (r.get("sales_est") or r.get("buyers_min") or -1, r.get("views_28") or -1),
        "conversion": lambda r: ((r.get("sales_est") or 0) / r["views_28"] * 100) if (r.get("sales_est") and r.get("views_28")) else (r.get("conversion_min") or -1),
        "reviews": lambda r: r.get("review_count") or 0,
        "price": lambda r: r.get("effective_price") or 0,
        "views": lambda r: r.get("views_28") or -1,
        "revenue": lambda r: r.get("revenue_est") or r.get("revenue_min") or -1,
        "rankpv": lambda r: -(r.get("pv_rank") or 9999),
        "rank": lambda r: (r.get("category_path") or "", r.get("rank") or 0),
    }
    key = keymap.get(sort or "sales", keymap["sales"])
    reverse = (direction or "desc") == "desc"
    if sort == "rank":
        reverse = False
    rows.sort(key=key, reverse=reverse)
    return rows


@app.get("/api/products")
def products(filter: str = "all", q: str = "", leaf: str = "", sort: str = "sales", dir: str = "desc",
             page: int = 1, size: int = 100):
    run = db.latest_run()
    if not run:
        return {"rows": [], "total": 0, "all": 0}
    cond = db.get_conditions()
    all_rows = _rows(run["id"], cond)
    rows = _apply_filters(all_rows, cond, filter, q, leaf, sort, dir)
    start = (page - 1) * size
    return {"rows": rows[start:start + size], "total": len(rows), "all": len(all_rows), "page": page, "size": size}


@app.get("/api/leaves")
def leaves():
    run = db.latest_run()
    if not run:
        return []
    counts = {}
    for p in db.products(run["id"]):
        key = (p.get("category_id"), p.get("category_path"))
        counts[key] = counts.get(key, 0) + 1
    out = [{"id": k[0], "path": k[1], "count": v} for k, v in counts.items()]
    out.sort(key=lambda x: x["path"] or "")
    return out


@app.post("/api/products/hide")
async def hide_products(req: Request):
    body = await req.json()
    db.set_hidden(_current_run_id(), [int(x) for x in body.get("product_ids", [])], bool(body.get("hidden", True)))
    return {"ok": True}


# ---------- 보관함 / 내려받기 ----------
@app.post("/api/archive")
async def archive_add(req: Request):
    body = await req.json()
    run_id = _current_run_id()
    cond = db.get_conditions()
    rows = _rows(run_id, cond)
    ids = set(int(x) for x in body.get("product_ids") or [])
    if not ids:
        rows = [r for r in rows if r["verdict"] == "pass"]
    else:
        rows = [r for r in rows if r["product_id"] in ids]
    n = db.archive_add(run_id, rows)
    return {"ok": True, "added": n, "total": len(db.archive_list())}


@app.get("/api/archive")
def archive_list():
    return db.archive_list()


@app.post("/api/archive/delete")
async def archive_delete(req: Request):
    body = await req.json()
    db.archive_delete([int(x) for x in body.get("ids", [])])
    return {"ok": True}


@app.get("/api/export")
def export(filter: str = "all", q: str = "", leaf: str = "", sort: str = "sales", dir: str = "desc", source: str = "results",
           day: str = "", cat: str = ""):
    if source == "archive":
        rows = db.archive_list()
        if day:
            rows = [r for r in rows if (r.get("saved_at") or "").startswith(day)]
        if cat:
            rows = [r for r in rows if (r.get("category_path") or "") == cat]
    else:
        run = db.latest_run()
        if not run:
            raise HTTPException(400, "내려받을 결과가 없습니다.")
        cond = db.get_conditions()
        rows = _apply_filters(_rows(run["id"], cond), cond, filter, q, leaf, sort, dir)
    path = build_xlsx(rows)
    return FileResponse(path, filename=Path(path).name,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ---------- 도구 ----------
@app.post("/api/tools/{name}")
def tools(name: str):
    try:
        if name == "open_browser":
            browser.call(lambda bt: bt.page().goto(config.COUPANG_HOME, wait_until="domcontentloaded", timeout=60000), "브라우저 열기", timeout=90)
            return {"ok": True, "message": "브라우저 창을 열었습니다."}
        if name == "test_coupang":
            def t(bt):
                page = bt.page()
                data = fetch_listing(page, "category", 184555, 1)
                info = page.evaluate(PAGE_INFO_JS)
                return {"count": len(data["items"]), "title": data.get("title"), "sample": data["items"][:5], "info": info,
                        "redirected_home": data.get("redirected_home", False)}
            r = browser.call(t, "쿠팡 연결 테스트", timeout=120)
            msg = f"홈인테리어 1페이지에서 상품 {r['count']}개를 읽었습니다."
            if r["count"] == 0:
                msg += " 하나도 못 읽었습니다. data/debug 폴더의 화면 캡처를 보내주세요."
            log.info(msg)
            lines = [msg, f"주소: {r['info'].get('url')}", f"제목: {r['title']}", f"상품 카드 요소 수: {r['info'].get('product_units')}",
                     "정렬 옵션: " + " | ".join(r['info'].get('sorts') or []) , "페이지 링크: " + " | ".join(r['info'].get('pagination') or []), "", "== 읽은 상품 예시 =="]
            for it in r["sample"]:
                lines.append(json.dumps(it, ensure_ascii=False))
            lines.append("")
            lines.append("== 상품 카드 원본 (배송 뱃지 확인용) ==")
            for c in r["info"].get("cards") or []:
                lines.append(c)
                lines.append("-----")
            return {"ok": True, "message": msg, "result": r, "text": "\n".join(lines)}
        if name == "test_wing":
            if job.is_running():
                return _err("다른 작업이 진행 중입니다. 끝나거나 완전중단한 뒤 눌러주세요.")
            r = browser.call(wing.test_connection, "윙 연결 테스트", timeout=240)
            lines = [f"윙 탭 주소: {r.get('page_url')} → {r.get('page_url_after')}", "",
                     f"[카탈로그 매칭 · 카테고리번호 없이] {'오류: ' + r['prematch_error'] if r.get('prematch_error') else ('응답 없음' if not r.get('prematch_nocat') else '정상')}",
                     json.dumps(r.get("prematch_nocat"), ensure_ascii=False) if r.get("prematch_nocat") else "",
                     f"[카탈로그 매칭 · 카테고리번호 1839] {'응답 없음' if not r.get('prematch') else '정상'}",
                     json.dumps(r.get("prematch"), ensure_ascii=False) if r.get("prematch") else "",
                     f"[쿠팡 공개 카테고리번호] {r.get('public_category') or ('오류: ' + str(r.get('public_category_error')) if r.get('public_category_error') else '없음')}",
                     "",
                     "[카탈로그 매칭 응답 항목] " + (", ".join(r.get("prematch_keys") or []) or ("오류: " + str(r.get("prematch_keys_error")))),
                     "[옵션 항목] " + ", ".join(r.get("item_keys") or []),
                     "[옵션 예시] " + json.dumps(r.get("item_sample") or {}, ensure_ascii=False),
                     f"[판매 항목 자동 탐지] {r.get('sales_scan')}",
                     "",
                     f"[사전매칭 검색] {('오류: ' + str(r['prematching_error'])) if r.get('prematching_error') else str(r.get('prematching_count')) + '개'}",
                     "[사전매칭 검색 항목] " + ", ".join(r.get("prematching_keys") or []),
                     "[사전매칭 검색 예시] " + json.dumps(r.get("prematching_sample") or {}, ensure_ascii=False),
                     "",
                     f"[인기상품검색] {'오류: ' + r['trends_error'] if r.get('trends_error') else '상품 ' + str(r.get('trends_count')) + '개'}",
                     json.dumps(r.get("trends_first"), ensure_ascii=False) if r.get("trends_first") else ""]
            ok = bool(r.get("prematch")) or bool(r.get("prematch_nocat"))
            msg = "윙 연결 정상입니다 (정확한 조회수 조회 가능)." if ok else "윙 조회가 되지 않습니다. 결과 창 내용을 보내주세요."
            log.info(msg)
            return {"ok": True, "message": msg, "text": "\n".join(lines)}
        if name in ("browser_msedge", "browser_chrome", "browser_whale"):
            if job.is_running():
                return _err("작업이 진행 중입니다. 완전중단한 뒤 눌러주세요.")
            pick = name.split("_", 1)[1]
            config.BROWSER_PREF_FILE.write_text(pick, encoding="utf-8")
            try:
                browser.call(lambda bt: bt.reset_profile_soft(), "브라우저 닫기", timeout=60)
            except Exception:  # noqa: BLE001
                pass
            label = {"msedge": "엣지", "chrome": "크롬", "whale": "웨일"}[pick]
            return {"ok": True, "message": f"프로그램이 쓸 브라우저를 {label}로 정했습니다. 도구 › 브라우저 창 열기 를 누르면 {label}가 열립니다."}
        if name == "use_my_profile":
            if job.is_running():
                return _err("작업이 진행 중입니다. 완전중단한 뒤 눌러주세요.")
            pname, ppath = config.my_browser_profile()
            if not ppath:
                return _err("평소 쓰는 브라우저(웨일·엣지·크롬)의 프로필 폴더를 찾지 못했습니다.")
            if config.USE_MY_PROFILE_FLAG.exists():
                config.USE_MY_PROFILE_FLAG.unlink()
                mode_msg = "프로그램 전용 프로필로 되돌렸습니다."
            else:
                config.USE_MY_PROFILE_FLAG.write_text(str(ppath), encoding="utf-8")
                mode_msg = f"평소 쓰는 {pname} 프로필을 쓰도록 설정했습니다: {ppath}"
            try:
                browser.call(lambda bt: bt.reset_profile_soft(), "브라우저 닫기", timeout=60)
            except Exception:  # noqa: BLE001
                pass
            return {"ok": True, "message": mode_msg + " 평소 쓰는 브라우저 창을 모두 닫은 뒤, 도구 › 브라우저 창 열기 를 눌러주세요. (윙 로그인은 그 브라우저에 되어 있는 상태를 그대로 씁니다)"}
        if name == "reset_profile":
            if job.is_running():
                return _err("작업이 진행 중입니다. 완전중단한 뒤 눌러주세요.")
            browser.call(lambda bt: bt.reset_profile(), "브라우저 초기화", timeout=60)
            browser.call(lambda bt: bt.page().goto(config.COUPANG_HOME, wait_until="domcontentloaded", timeout=60000), "브라우저 열기", timeout=90)
            return {"ok": True, "message": f"브라우저 저장 데이터를 새로 만들고 다시 열었습니다 ({browser.channel}). 윙은 다시 로그인해야 합니다: 도구 › 윙 로그인 창 열기"}
        if name == "unblock":
            if job.is_running():
                return _err("작업이 진행 중입니다. 완전중단한 뒤 눌러주세요.")

            def t(bt):
                ctx = bt.ensure_context()
                names = ("_abck", "bm_sz", "bm_sv", "bm_mi", "ak_bmsc", "bm_s", "bm_so", "bm_ss", "bm_lso", "sbsd", "sbsd_o", "bmuid", "x-coupang-accept-language")
                removed = 0
                try:
                    before = ctx.cookies()
                    for n in names:
                        try:
                            ctx.clear_cookies(name=n)
                        except TypeError:
                            pass
                    after = ctx.cookies()
                    removed = len(before) - len(after)
                except Exception as e:  # noqa: BLE001
                    log.warn(f"쿠키 정리 실패: {e}")
                page = bt.page()
                page.goto(config.COUPANG_HOME, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(2500)
                def probe(url):
                    rr = page.goto(url, wait_until="domcontentloaded", timeout=60000)
                    page.wait_for_timeout(2000)
                    body = page.evaluate("() => document.body ? document.body.innerText.slice(0, 400) : ''")
                    return (rr.status if rr else None), ((rr and rr.status in (403, 429)) or ("사용권한이 제한" in body) or ("Access Denied" in body))
                st_www, b_www = probe(config.PRODUCT_URL.format(pid=8350616562))
                st_m, b_m = probe(config.PRODUCT_URL_MOBILE.format(pid=8350616562))
                return {"removed": removed, "status": st_www, "blocked": b_www, "status_m": st_m, "blocked_m": b_m, "driver": browser.driver}
            r = browser.call(t, "차단 해제 시도", timeout=240)
            drv = "패치 구동" if r.get("driver") == "rebrowser" else "기본 구동"
            if r["blocked"] and r["blocked_m"]:
                msg = (f"[{drv}] 봇 방어 쿠키 {r['removed']}개를 지웠지만 www({r['status']})와 모바일({r['status_m']}) 모두 막혀 있습니다. "
                       "평소 브라우저로 상품 페이지가 열리는지 확인해 보세요. 거기서도 막히면 IP 차단이니 공유기를 껐다 켜거나 핫스팟으로 바꾼 뒤 다시 눌러주세요.")
            elif r["blocked"]:
                msg = f"[{drv}] www 상품 페이지는 막혀 있지만 모바일 페이지는 열립니다. 확인 작업을 시작하면 자동으로 모바일 페이지를 씁니다."
            else:
                msg = f"[{drv}] 봇 방어 쿠키 {r['removed']}개를 지웠고, 상품 페이지가 정상적으로 열립니다. 이제 확인 작업을 다시 시작해도 됩니다."
            log.info(msg)
            return {"ok": True, "message": msg}
        if name == "wing_login":
            browser.call(wing.open_login, "윙 로그인", timeout=90)
            return {"ok": True, "message": "윙 로그인 창을 열었습니다. 로그인해 주세요."}
        if name == "capture_start":
            job.start_capture()
            return {"ok": True, "message": "윙 캡처 모드를 시작했습니다. 브라우저에서 윙 판매량 화면을 열고 상품을 검색해 주세요."}
        if name == "capture_stop":
            job.stop_capture()
            return {"ok": True, "message": "캡처를 종료합니다. 잠시 후 요약 파일이 만들어집니다."}
        if name == "demo":
            rid = make_demo()
            return {"ok": True, "message": f"데모 데이터를 넣었습니다 (실행 번호 {rid})."}
        if name == "reset_categories":
            c = db.conn()
            c.execute("DELETE FROM categories")
            c.execute("DELETE FROM settings WHERE key='home_tree_loaded_at'")
            c.commit()
            db.ensure_top_categories()
            n = browser.call(load_home_tree, "카테고리 전체 불러오기", timeout=180)
            return {"ok": True, "message": f"쿠팡 홈 메뉴에서 카테고리 {n}개를 새로 읽었습니다."}
        if name == "clear_run":
            run = db.latest_run()
            if run and not job.is_running():
                db.clear_run_products(run["id"])
                db.set_run_status(run["id"], "cleared")
            return {"ok": True, "message": "현재 결과를 비웠습니다."}
        return _err("알 수 없는 도구")
    except Exception as e:  # noqa: BLE001
        return _err(e)


@app.post("/api/diag/category")
async def diag_category(req: Request):
    body = await req.json()
    cid = int(body.get("cid") or 184555)
    if job.is_running():
        return _err("작업이 진행 중일 때는 진단할 수 없습니다.")
    try:
        data = browser.call(lambda bt: diagnose_category(bt.page(), cid), "카테고리 진단", timeout=120)
    except Exception as e:  # noqa: BLE001
        return _err(e)
    lines = [f"카테고리 진단 (id={cid})", f"제목: {data.get('title')}", f"주소: {data.get('url')}", f"HTTP: {data.get('http_status')}",
             f"상품 링크 수: {data.get('product_links')}", f"카테고리 링크 수: {data.get('category_links')}",
             f"차단: {data.get('blocked', '없음')}", f"본문 앞부분: {data.get('body_head')}", "", "== 카테고리 링크가 2개 이상 들어있는 목록(ul) =="]
    for l in data.get("lists", []):
        lines.append(f"[{l['links']}개 링크 / li {l['direct_li']}개] {l['chain']}")
    lines.append("")
    lines.append("== 카테고리 링크 (id | 이름 | 위치) ==")
    for c in data.get("cats", []):
        lines.append(f"{c['id']} | {c['name']} | {c['chain']}")
    # 브라우저 정보
    lines.append("")
    lines.append(f"브라우저: {browser.channel}")
    text = "\n".join(lines)
    log.info(f"카테고리 진단 완료: 링크 {data.get('category_links')}개, 상품 {data.get('product_links')}개")
    return {"ok": True, "text": text, "screenshot": data.get("screenshot")}


@app.get("/api/update/check")
def update_check():
    return {"current": updater.current_version(), "remote": updater.remote_version()}


@app.post("/api/update/apply")
def update_apply():
    if job.is_running():
        return _err("작업이 진행 중일 때는 업데이트할 수 없습니다. 완전중단 후 다시 눌러주세요.")
    try:
        r = updater.apply_update()
    except Exception as e:  # noqa: BLE001
        tail = ""
        try:
            lines = (config.BASE_DIR / "업데이트기록.txt").read_text(encoding="utf-8").splitlines()[-6:]
            tail = " | ".join(lines)
        except Exception:  # noqa: BLE001
            pass
        log.error(f"업데이트 실패: {e}")
        return _err(f"업데이트 실패: {e}  [기록: {tail}]")
    updater.restart_program()
    return {"ok": True, "message": f"업데이트 완료 (파일 {r['changed']}개, 버전 {r['version']}). 프로그램을 다시 시작합니다. 10초 뒤 이 페이지를 새로고침 하세요.", **r}


@app.post("/api/diag/site")
def diag_site():
    if job.is_running():
        return _err("작업이 진행 중일 때는 진단할 수 없습니다.")
    names = [n for _, n in config.TOP_CATEGORIES]
    try:
        d = browser.call(lambda bt: diagnose_site(bt.page(), names), "사이트 진단", timeout=240)
    except Exception as e:  # noqa: BLE001
        return _err(e)
    L = []
    L.append("사이트 진단 (카테고리 주소 방식 찾기)")
    L.append(f"홈 주소: {d.get('home_url')} / 메뉴 열기: {d.get('opened')} / 열고 난 뒤 주소: {d.get('after_url')}")
    b, a = d.get("before", {}), d.get("after", {})
    L.append(f"링크 수: 메뉴 열기 전 {b.get('total_links')} → 후 {a.get('total_links')}")
    L.append("")
    L.append("== 1차 카테고리 이름과 같은 글자의 링크 ==")
    for x in a.get("byName", [])[:60]:
        L.append(f"{x['text']} -> {x['href']}  [{x['chain']}]")
    L.append("")
    L.append("== 카테고리처럼 보이는 링크 (최대 200) ==")
    for x in a.get("catLike", [])[:200]:
        L.append(f"{x['text']} -> {x['href']}  [{x['chain']}]")
    L.append("")
    L.append("== 링크가 5개 이상인 메뉴 덩어리 ==")
    for r in a.get("roots", []):
        L.append(f"[{r['links']}개] {r['chain']}")
        for smp in r["sample"]:
            L.append(f"     · {smp}")
    L.append("")
    L.append(f"== 1차 카테고리 클릭 결과: {d.get('clicked_name')} ==")
    if d.get("clicked_url"):
        L.append(f"이동한 주소: {d['clicked_url']} / 상품 링크 {d.get('clicked_products')}개")
        cp = d.get("clicked_page") or {}
        L.append(f"제목: {cp.get('title')} / 카테고리 링크 {cp.get('category_links')}개")
        for l in cp.get("lists", [])[:15]:
            L.append(f"  [{l['links']}개 링크] {l['chain']}")
        for c in cp.get("cats", [])[:80]:
            L.append(f"  {c['id']} | {c['name']} | {c['chain']}")
    L.append("")
    L.append("== 주소 직접 접근 결과 ==")
    for c in d.get("checks", []):
        L.append(str(c))
    L.append("")
    for st in d.get("steps", []):
        L.append("메모: " + st)
    L.append(f"브라우저: {browser.channel}")
    shots = [d.get(k) for k in ("screenshot_menu", "screenshot_cat", "screenshot_search") if d.get(k) and str(d.get(k)).endswith(".png")]
    log.info("사이트 진단 완료")
    return {"ok": True, "text": "\n".join(L), "screenshots": shots}


@app.get("/api/capture/headers", response_class=PlainTextResponse)
def capture_headers():
    """캡처 기록에서 인기상품검색·카탈로그 매칭 요청의 헤더를 보여준다 (쿠키 제외)."""
    files = sorted(config.CAPTURE_DIR.glob("wing_capture_*.jsonl"))
    if not files:
        return "캡처 기록 파일이 없습니다."
    out = []
    keys = ("trends/search", "prematch/product-items", "pre-matching/search", "coupang-trends")
    for f in files[-3:]:
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            try:
                rec = json.loads(line)
            except Exception:  # noqa: BLE001
                continue
            if any(k in rec.get("url", "") for k in keys):
                out.append("=" * 60)
                out.append(f"{rec.get('method')} {rec.get('url')}  → HTTP {rec.get('status')} ({rec.get('resource_type')})")
                for k, v in (rec.get("request_headers") or {}).items():
                    out.append(f"  {k}: {str(v)[:300]}")
                if rec.get("post_data"):
                    out.append("  [보낸 데이터] " + rec["post_data"][:400])
                body = rec.get("body") or ""
                out.append("  [응답 앞부분] " + body[:300].replace("\n", " "))
    return "\n".join(out) if out else "해당 요청이 캡처 기록에 없습니다."


@app.post("/api/diag/options")
async def diag_options(req: Request):
    """옵션별 '월 N명 이상 구매' 문구가 다른지 비교한다 (옵션이 여러 개인 상품 1개, 최대 4옵션)."""
    body = await req.json() if req.headers.get("content-length") not in (None, "0") else {}
    if job.is_running():
        return _err("작업이 진행 중일 때는 진단할 수 없습니다.")
    run_id = _current_run_id()
    cond = db.get_conditions()
    rows = [enrich(p, cond) for p in db.products(run_id)]
    pid = body.get("product_id")
    cands = [r for r in rows if (r["product_id"] == int(pid))] if pid else \
            sorted([r for r in rows if r.get("pre_pass") and (r.get("option_total") or 0) > 1], key=lambda r: -(r.get("option_total") or 0))
    if not cands:
        return _err("옵션이 여러 개인 조건 통과 상품이 없습니다.")
    target = cands[0]

    def task(bt):
        from .coupang_list import fetch_detail_price
        opts = wing.product_options(bt, target)[:4]
        results = []
        for o in opts:
            if not o.get("vendor_item_id"):
                continue
            d = fetch_detail_price(bt.page(), target["product_id"], o["item_id"], o["vendor_item_id"])
            results.append({"option": o.get("name") or o["item_id"], "vendor_item_id": o["vendor_item_id"],
                            "buyers_min": d.get("buyers_min"), "price": d.get("price")})
            from .browser import human_delay
            human_delay(1.5, 3.0)
        return {"product": target["name"], "product_id": target["product_id"], "options_total": target.get("option_total"), "results": results}
    try:
        r = browser.call(task, "옵션별 구매자 비교", timeout=300)
    except Exception as e:  # noqa: BLE001
        return _err(e)
    lines = [f"상품: {r['product']} (ID {r['product_id']}, 옵션 {r['options_total']}개 중 {len(r['results'])}개 확인)", ""]
    vals = set()
    for x in r["results"]:
        b = x["buyers_min"]
        vals.add(b)
        lines.append(f"- 옵션 [{x['option']}] (vendorItemId {x['vendor_item_id']}): 월 구매 {('%s명 이상' % format(b, ',')) if b else '표시 없음'} · 가격 {x['price'] or '-'}")
    lines.append("")
    if len([v for v in vals if v]) > 1:
        lines.append("→ 옵션마다 문구가 다릅니다. '월 구매' 문구는 옵션(판매 단위) 기준입니다.")
    elif len(r["results"]) >= 2:
        lines.append("→ 모든 옵션에 같은 문구가 뜹니다. '월 구매' 문구는 상품 전체 기준으로 보입니다.")
    else:
        lines.append("→ 비교할 옵션이 부족합니다.")
    return {"ok": True, "text": "\n".join(lines)}


@app.get("/api/capture/summary", response_class=PlainTextResponse)
def capture_summary():
    files = sorted(config.CAPTURE_DIR.glob("*_요약.txt"))
    if not files:
        return "아직 캡처 요약 파일이 없습니다."
    return files[-1].read_text(encoding="utf-8")


@app.get("/api/logs")
def logs():
    return log.recent(300)


@app.get("/api/paths")
def paths():
    return {"data": str(config.DATA_DIR), "debug": str(config.DEBUG_DIR), "capture": str(config.CAPTURE_DIR),
            "exports": str(config.EXPORT_DIR), "wing_config": str(config.WING_CONFIG_PATH)}


# ---------- 데모 데이터 ----------
DEMO_CATS = [
    (184555, "홈인테리어 > 카페트/매트 > 러그"), (184556, "홈인테리어 > 침구 > 이불세트"),
    (185569, "주방용품 > 조리도구 > 채칼/슬라이서"), (178155, "가전디지털 > 계절환경가전 > 선풍기"),
    (176522, "뷰티 > 스킨케어 > 크림"), (221934, "출산/유아동 > 완구 > 블록"),
]
DEMO_WORDS = ["프리미엄", "초강력", "무타공", "접착식", "대용량", "국산", "친환경", "고급형", "휴대용", "다용도"]
DEMO_NOUNS = ["러그 카페트", "극세사 이불", "채칼 슬라이서", "벽걸이 선풍기", "수분 크림", "블록 세트",
              "후크 걸이", "발매트", "커튼", "쿠션 방석", "행거", "수납함"]


def make_demo() -> int:
    if job.is_running():
        raise RuntimeError("작업 중에는 데모 데이터를 넣을 수 없습니다.")
    cond = db.get_conditions()
    run_id = db.create_run([{"type": "demo"}], cond)
    rnd = random.Random(7)
    seen = 0
    for cid, path in DEMO_CATS:
        db.add_run_category(run_id, cid, path.split(" > ")[-1], path)
        for i in range(15):
            pid = 1000000 + cid * 10 + i + rnd.randint(0, 9) * 100000
            price = rnd.choice([3750, 4200, 7090, 9800, 12700, 13900, 14900, 25000, 39900, 46800, 120000])
            reviews = rnd.choice([12, 33, 38, 60, 70, 132, 226, 253, 377, 853, 2966, 15273])
            p = {"product_id": pid, "item_id": pid * 3, "vendor_item_id": pid * 7,
                 "name": f"{rnd.choice(DEMO_WORDS)} {rnd.choice(DEMO_NOUNS)} {rnd.choice(['1개', '2개입', '대형', '40cm', '세트'])}",
                 "url": config.PRODUCT_URL.format(pid=pid), "price": price, "review_count": reviews,
                 "rating": rnd.choice([4.2, 4.5, 4.7, 4.8, 5.0]), "delivery": rnd.choice(["WING", "WING", "ROCKET_GROWTH", "ROCKET"]),
                 "is_ad": rnd.random() < 0.1, "sold_out": False, "category_id": cid, "category_path": path,
                 "rank": i + 1, "page": 1}
            from .metrics import restricted_reason
            db.upsert_product(run_id, p, restricted_reason(p["name"], path))
            seen += 1
            if rnd.random() < 0.9:
                lo = rnd.choice([1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 400000])
                hi = lo * 2
                exact = rnd.random() < 0.7
                db.save_analysis(run_id, pid, {"sales_28": None, "views_28": int((lo * hi) ** 0.5) if not exact else int(lo * rnd.uniform(1.0, 1.9)),
                                               "pv_low": None if exact else lo, "pv_high": None if exact else hi, "pv_exact": exact,
                                               "pv_rank": i + 1, "wing_price": price, "wing_rating": 4.7, "wing_review": reviews, "option_total": rnd.choice([1, 3, 12]),
                                               "wing_category": path.replace(" > ", ">"),
                                               "mergeable": rnd.choice(["MERGEABLE", "MERGEABLE", "DECLINE"]),
                                               "eligibility": "VALID", "seller_count": rnd.choice([None, 1, 3, 9]),
                                               "coupon_flag": rnd.random() < 0.5}, None)
            elif rnd.random() < 0.5:
                db.save_analysis(run_id, pid, None, "윙에서 찾지 못함")
        db.update_run_category(run_id, cid, status="done", pages_done=1, products_seen=15)
    # 일부는 상세 확인(구매자 수)까지 된 상태로
    for p in db.products(run_id):
        if rnd.random() < 0.85:
            db.save_review_velocity(run_id, p["product_id"], rnd.choice([3, 8, 15, 40, 90, 160]), 28.0, "최근 28일 리뷰")
    for p in db.products(run_id)[::3]:
        db.save_verified_price(run_id, p["product_id"], p["price"], rnd.choice([100, 500, 1000, 5000, 10000]), rnd.choice([1, 3, 9]))
        if rnd.random() < 0.5:
            opts = [{"option": f"옵션 {i + 1}", "vendor_item_id": p["product_id"] * 10 + i, "buyers_min": rnd.choice([100, 200, 300, 500]), "price": p["price"] + i * 500} for i in range(4)]
            db.save_buyers_sum(run_id, p["product_id"], sum(o["buyers_min"] for o in opts), 4, opts)
    db.set_setting(f"seen_total_{run_id}", seen + 40)
    db.set_run_status(run_id, "analyzed", "데모")
    log.info("데모 데이터 생성")
    return run_id


def _open_dashboard():
    time.sleep(1.5)
    try:
        webbrowser.open(f"http://{config.HOST}:{config.PORT}/")
    except Exception:  # noqa: BLE001
        pass


def _wait_port_free(timeout=25):
    import socket
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((config.HOST, config.PORT))
                return True
            except OSError:
                time.sleep(0.5)
    return False


def main():
    print(f"쿠팡 소싱 프로그램 v{updater.current_version()}: http://{config.HOST}:{config.PORT}/  (이 창을 닫으면 프로그램이 종료됩니다)")
    if not _wait_port_free():
        print("이미 프로그램이 실행 중인 것 같습니다. 기존 창을 닫고 다시 실행해 주세요.")
    threading.Thread(target=_open_dashboard, daemon=True).start()
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="warning")


if __name__ == "__main__":
    main()
