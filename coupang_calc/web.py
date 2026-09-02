"""로컬 웹 화면 (Flask). `python -m coupang_calc serve` 로 띄우고 브라우저에서 http://127.0.0.1:8765 접속.

화면: 광고 장부(캠페인×일자), 일별 광고 입력, 옵션/마진 관리(마진 이력), 파일 가져오기, 자동 수집 실행.
"""
from __future__ import annotations

import datetime as dt
import io
import csv
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from flask import Flask, jsonify, request, send_from_directory

from .ads_report import AdsRow, normalize_records, parse_ads_file
from .common import parse_date, parse_number, parse_percent, parse_ratio, yesterday
from .ledger import METRICS, ledger_from_store
from .sales_report import parse_sales_report
from .store import Store

STATIC = Path(__file__).parent / "static"


def create_app(db_path: Path, collector_config: Optional[Path] = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config["DB_PATH"] = Path(db_path)
    app.config["COLLECTOR_CONFIG"] = collector_config
    collect_state: Dict[str, Any] = {"running": False, "log": [], "last": None}
    lock = threading.Lock()

    def store() -> Store:
        return Store(app.config["DB_PATH"])

    # ---- 화면 ----------------------------------------------------------------
    @app.get("/")
    def index():
        return send_from_directory(STATIC, "index.html")

    # ---- 장부 ----------------------------------------------------------------
    @app.get("/api/ledger")
    def api_ledger():
        start = parse_date(request.args.get("start"))
        end = parse_date(request.args.get("end"))
        with store() as s:
            led = ledger_from_store(s, start, end)
        return jsonify(led.to_dict())

    @app.get("/api/ledger.csv")
    def api_ledger_csv():
        start = parse_date(request.args.get("start")); end = parse_date(request.args.get("end"))
        with store() as s:
            led = ledger_from_store(s, start, end)
        buf = io.StringIO(); w = csv.writer(buf)
        w.writerow(["캠페인", "항목"] + led.dates)
        for c in led.campaigns:
            for key, label, _ in METRICS:
                w.writerow([c.campaign, label] + [round(getattr(c.days[d], key), 4) if d in c.days else "" for d in led.dates])
        w.writerow(["전체", "순이익 (광고비제외)"] + [round(led.total_profit.get(d, 0), 2) for d in led.dates])
        data = "﻿" + buf.getvalue()
        return app.response_class(data, mimetype="text/csv",
                                  headers={"Content-Disposition": "attachment; filename=ledger.csv"})

    @app.get("/api/summary")
    def api_summary():
        with store() as s:
            dates = s.dates()
            return jsonify({
                "first_date": dates[0].isoformat() if dates else None,
                "last_date": dates[-1].isoformat() if dates else None,
                "days": len(dates),
                "campaigns": s.campaigns(),
                "unmapped_options": s.unmapped_option_ids(),
                "yesterday": yesterday().isoformat(),
            })

    # ---- 옵션 / 마진 ----------------------------------------------------------
    @app.get("/api/options")
    def api_options():
        with store() as s:
            hist: Dict[str, list] = {}
            for e in s.margin_history():
                hist.setdefault(e.option_id, []).append({
                    "effective_from": None if e.effective_from.year == 1 else e.effective_from.isoformat(),
                    "margin": e.margin, "note": e.note})
            today = dt.date.today(); lk = s.margin_lookup()
            return jsonify([{
                "option_id": o.option_id, "product_name": o.product_name, "campaign": o.campaign,
                "sort_order": o.sort_order, "current_margin": lk.margin(o.option_id, today),
                "margins": hist.get(o.option_id, []),
            } for o in s.options()])

    @app.post("/api/options")
    def api_option_save():
        body = request.get_json(force=True)
        oid = str(body.get("option_id", "")).strip()
        if not oid:
            return jsonify({"error": "옵션ID 가 필요합니다"}), 400
        with store() as s:
            s.upsert_option(oid, body.get("product_name", ""), body.get("campaign", ""),
                            body.get("sort_order"))
            if body.get("margin") not in (None, ""):
                eff = parse_date(body.get("effective_from"))
                s.set_margin(oid, parse_number(body["margin"]) or 0.0, eff, body.get("note", ""))
        return jsonify({"ok": True})

    @app.delete("/api/options/<option_id>")
    def api_option_delete(option_id):
        with store() as s:
            s.delete_option(option_id)
        return jsonify({"ok": True})

    @app.post("/api/margins")
    def api_margin_save():
        body = request.get_json(force=True)
        oid = str(body.get("option_id", "")).strip()
        margin = parse_number(body.get("margin"))
        if not oid or margin is None:
            return jsonify({"error": "옵션ID 와 마진이 필요합니다"}), 400
        eff = parse_date(body.get("effective_from"))
        with store() as s:
            s.set_margin(oid, margin, eff, body.get("note", ""))
        return jsonify({"ok": True})

    @app.delete("/api/margins")
    def api_margin_delete():
        body = request.get_json(force=True)
        with store() as s:
            s.delete_margin(str(body["option_id"]), parse_date(body.get("effective_from")))
        return jsonify({"ok": True})

    # ---- 광고 입력 ------------------------------------------------------------
    @app.get("/api/ads")
    def api_ads_get():
        d = parse_date(request.args.get("date")) or yesterday()
        with store() as s:
            rows = {a.campaign: a.as_dict() for a in s.ads(d, d)}
            camps = s.campaigns()
        return jsonify({"date": d.isoformat(), "campaigns": camps, "rows": rows})

    @app.post("/api/ads")
    def api_ads_save():
        body = request.get_json(force=True)
        d = parse_date(body.get("date")) or yesterday()
        rows = []
        for r in body.get("rows", []):
            if not str(r.get("campaign", "")).strip():
                continue
            rows.append(AdsRow(
                date=d, campaign=r["campaign"].strip(),
                target_roas=parse_ratio(r.get("target_roas"), percent_units=True) or 0.0, budget=parse_number(r.get("budget")) or 0.0,
                spend=parse_number(r.get("spend")) or 0.0, ad_revenue=parse_number(r.get("ad_revenue")) or 0.0,
                conversion=parse_percent(r.get("conversion"), percent_units=True) or 0.0,
                ctr=parse_percent(r.get("ctr"), percent_units=True) or 0.0,
                impressions=parse_number(r.get("impressions")) or 0.0, clicks=parse_number(r.get("clicks")) or 0.0,
                ad_orders=parse_number(r.get("ad_orders")) or 0.0, action=str(r.get("action") or ""),
            ))
        with store() as s:
            n = s.upsert_ads(rows)
        return jsonify({"ok": True, "saved": n})

    @app.delete("/api/ads")
    def api_ads_delete():
        body = request.get_json(force=True)
        d = parse_date(body.get("date"))
        with store() as s:
            s.delete_ads(d, body["campaign"])
        return jsonify({"ok": True})

    # ---- 파일 가져오기 --------------------------------------------------------
    @app.post("/api/import")
    def api_import():
        d = parse_date(request.form.get("date")) or yesterday()
        out = {"date": d.isoformat()}
        tmp = Path(app.config["DB_PATH"]).parent / "uploads"
        tmp.mkdir(parents=True, exist_ok=True)
        with store() as s:
            f = request.files.get("sales")
            if f and f.filename:
                p = tmp / f"sales_{d:%Y-%m-%d}{Path(f.filename).suffix or '.xlsx'}"
                f.save(p)
                rows = parse_sales_report(p, d)
                out["sales"] = s.upsert_sales(rows)
            f = request.files.get("ads")
            if f and f.filename:
                p = tmp / f"ads_{d:%Y-%m-%d}{Path(f.filename).suffix or '.csv'}"
                f.save(p)
                rows = parse_ads_file(p, d)
                out["ads"] = s.upsert_ads(rows)
            out["unmapped_options"] = s.unmapped_option_ids()
        return jsonify(out)

    # ---- 자동 수집 ------------------------------------------------------------
    @app.post("/api/collect")
    def api_collect():
        cfg_path = app.config.get("COLLECTOR_CONFIG")
        if not cfg_path or not Path(cfg_path).exists():
            return jsonify({"error": "config/collector.json 이 없습니다"}), 400
        body = request.get_json(silent=True) or {}
        d = parse_date(body.get("date")) or yesterday()
        with lock:
            if collect_state["running"]:
                return jsonify({"error": "이미 수집 중입니다"}), 409
            collect_state.update(running=True, log=[f"{d} 수집 시작"], last=None)

        def worker():
            from .collector import Collector, load_config

            log = collect_state["log"]
            try:
                cfg = load_config(Path(cfg_path))
                with Store(app.config["DB_PATH"]) as s, Collector(cfg) as col:
                    try:
                        p = col.download_sales_report(d)
                        n = s.upsert_sales(parse_sales_report(p, d)); log.append(f"매출 {n}개 옵션 저장")
                    except Exception as e:  # noqa: BLE001
                        log.append(f"매출 수집 실패: {e}")
                    try:
                        rec = col.scrape_ads_table(d)
                        n = s.upsert_ads(normalize_records(rec, d)); log.append(f"광고 {n}개 캠페인 저장")
                    except Exception as e:  # noqa: BLE001
                        log.append(f"광고 수집 실패: {e}")
            except Exception as e:  # noqa: BLE001
                log.append(f"수집 실패: {e}")
            finally:
                collect_state["running"] = False
                collect_state["last"] = dt.datetime.now().isoformat(timespec="seconds")

        threading.Thread(target=worker, daemon=True).start()
        return jsonify({"ok": True})

    @app.get("/api/collect/status")
    def api_collect_status():
        return jsonify(collect_state)

    return app


def serve(db_path: Path, collector_config: Optional[Path], host: str = "127.0.0.1", port: int = 8765,
          open_browser: bool = True):
    app = create_app(db_path, collector_config)
    if open_browser:
        import webbrowser

        threading.Timer(1.0, lambda: webbrowser.open(f"http://{host}:{port}/")).start()
    print(f"쿠팡 광고계산기: http://{host}:{port}/  (종료: Ctrl+C)")
    app.run(host=host, port=port, debug=False, threaded=True)
