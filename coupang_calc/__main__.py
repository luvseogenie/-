"""명령줄 진입점.

  python -m coupang_calc serve                    웹 화면 실행 (http://127.0.0.1:8765)
  python -m coupang_calc run                      전일 자동 수집 → DB 저장 (스케줄러용)
  python -m coupang_calc import --sales F [--ads G] [--date D]   파일로 가져오기
  python -m coupang_calc report [--date D]        터미널에서 하루치 장부 보기
  python -m coupang_calc mapping-import [CSV]     config/mapping.csv → DB
  python -m coupang_calc mapping-export [CSV]     DB → CSV 백업
  python -m coupang_calc ads-template / ads-entry 광고 데이터 CSV 템플릿 / 대화식 입력
  python -m coupang_calc login                    브라우저 로그인 세션 저장(최초 1회)
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

from .ads_report import normalize_records, parse_ads_file, prompt_ads_rows, write_ads_template
from .common import date_from_filename, parse_date, yesterday
from .ledger import METRICS, ledger_from_store
from .mapping import DEFAULT_MAPPING, export_mapping_csv, import_mapping_csv
from .sales_report import parse_sales_report
from .store import DEFAULT_DB, Store

INBOX = Path("data/inbox")


def _date_arg(value, fallback_path: Path | None = None) -> dt.date:
    if value:
        d = parse_date(value)
        if not d:
            raise SystemExit(f"날짜 형식을 알 수 없습니다: {value} (예: 2025-06-08)")
        return d
    if fallback_path:
        d = date_from_filename(fallback_path)
        if d:
            return d
    return yesterday()


def _ensure_mapping(store: Store, mapping_path: Path):
    """DB 에 옵션이 하나도 없고 CSV 가 있으면 자동으로 읽어 온다."""
    if not store.options() and mapping_path.exists():
        n = import_mapping_csv(store, mapping_path)
        print(f"[매핑] {mapping_path} 에서 {n}행 가져옴")


def cmd_serve(args) -> int:
    from .web import serve

    with Store(Path(args.db)) as s:
        _ensure_mapping(s, Path(args.mapping))
    serve(Path(args.db), Path(args.config), host=args.host, port=args.port, open_browser=not args.no_browser)
    return 0


def cmd_import(args) -> int:
    with Store(Path(args.db)) as store:
        _ensure_mapping(store, Path(args.mapping))
        if not args.sales and not args.ads:
            print("가져올 파일이 없습니다. --sales 또는 --ads 를 지정하세요.")
            return 2
        if args.sales:
            p = Path(args.sales); d = _date_arg(args.date, p)
            n = store.upsert_sales(parse_sales_report(p, d))
            print(f"[매출] {d} {n}개 옵션 저장 ({p.name})")
        if args.ads:
            p = Path(args.ads); d = _date_arg(args.date, p)
            rows = parse_ads_file(p, d)
            n = store.upsert_ads(rows)
            print(f"[광고] {d} {n}개 캠페인 저장 ({p.name})")
            zero = [r.campaign for r in rows if r.spend == 0]
            if zero:
                print(f"  ! 광고비가 0인 캠페인: {', '.join(zero)} (광고센터 갱신 전이면 다시 받으세요)")
        unmapped = store.unmapped_option_ids()
        if unmapped:
            print(f"  ! 캠페인이 연결되지 않은 옵션ID {len(unmapped)}개: {', '.join(unmapped)} → 웹 화면 '옵션 · 마진 관리' 에서 추가")
    return 0


def cmd_report(args) -> int:
    d = _date_arg(args.date)
    with Store(Path(args.db)) as store:
        led = ledger_from_store(store, d, d)
    key = d.isoformat()
    print(f"=== {key} 광고 장부 ===")
    for c in led.campaigns:
        cell = c.days.get(key)
        if not cell:
            continue
        print(f"\n[{c.campaign}]")
        for k, label, f in METRICS:
            v = getattr(cell, k)
            s = f"{v*100:.2f}%" if f in ("pct1", "pct2") else f"{v*100:.0f}%" if f == "ratio" else f"{v:,.0f}"
            print(f"  {label:<18} {s:>14}")
        if cell.action:
            print(f"  ACTION: {cell.action}")
    print(f"\n전체 순이익 (광고비제외): {led.total_profit.get(key, 0):,.0f}")
    if led.unmapped_options:
        print(f"! 캠페인 미연결 옵션: {', '.join(led.unmapped_options)}")
    return 0


def cmd_mapping_import(args) -> int:
    with Store(Path(args.db)) as store:
        n = import_mapping_csv(store, Path(args.csv or args.mapping))
    print(f"[매핑] {n}행 가져옴")
    return 0


def cmd_mapping_export(args) -> int:
    with Store(Path(args.db)) as store:
        p = export_mapping_csv(store, Path(args.csv or "data/mapping_export.csv"))
    print(f"[매핑] 내보냄: {p}")
    return 0


def cmd_ads_template(args) -> int:
    d = _date_arg(args.date)
    with Store(Path(args.db)) as store:
        _ensure_mapping(store, Path(args.mapping))
        camps = store.campaigns()
    p = write_ads_template(INBOX / f"ads_{d:%Y-%m-%d}.csv", camps, d)
    print(f"템플릿 생성: {p}\n광고센터 > 광고 관리 > 매출 성장 > 어제 의 숫자를 채운 뒤:\n  python -m coupang_calc import --ads {p}")
    return 0


def cmd_ads_entry(args) -> int:
    d = _date_arg(args.date)
    with Store(Path(args.db)) as store:
        _ensure_mapping(store, Path(args.mapping))
        rows = prompt_ads_rows(store.campaigns(), d)
        n = store.upsert_ads(rows)
    print(f"[광고] {d} {n}개 캠페인 저장")
    return 0


def cmd_login(args) -> int:
    from .collector import interactive_login, load_config

    interactive_login(load_config(Path(args.config)))
    return 0


def cmd_run(args) -> int:
    from .collector import Collector, load_config

    cfg = load_config(Path(args.config))
    d = _date_arg(args.date)
    failures = []
    with Store(Path(args.db)) as store, Collector(cfg, debug=args.debug, headless=args.headless) as col:
        _ensure_mapping(store, Path(args.mapping))
        if not args.skip_sales:
            try:
                path = col.download_sales_report(d)
                rows = parse_sales_report(path, d)
                store.upsert_sales(rows)
                print(f"[매출] {d} {len(rows)}개 옵션 저장 ({path.name})")
            except Exception as e:  # noqa: BLE001
                failures.append(f"매출 수집 실패: {e}")
        if not args.skip_ads:
            try:
                rows = normalize_records(col.scrape_ads_table(d), d)
                store.upsert_ads(rows)
                print(f"[광고] {d} {len(rows)}개 캠페인 저장")
                if rows and all(r.spend == 0 for r in rows):
                    failures.append("광고비가 모두 0입니다. 광고센터 갱신 전일 수 있으니 나중에 다시 실행하세요.")
            except Exception as e:  # noqa: BLE001
                failures.append(f"광고 수집 실패: {e}")
    for f in failures:
        print("!!", f, file=sys.stderr)
    if failures:
        print("실패한 항목은 웹 화면 '데이터 가져오기' 또는 import 명령으로 넣을 수 있습니다.", file=sys.stderr)
        return 1
    return cmd_report(args)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="coupang_calc", description="쿠팡 광고계산기")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--mapping", default=str(DEFAULT_MAPPING), help="초기 옵션/마진 CSV (DB 가 비어 있을 때 자동 로드)")
    ap.add_argument("--config", default="config/collector.json")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("serve", help="웹 화면 실행")
    p.add_argument("--host", default="127.0.0.1"); p.add_argument("--port", type=int, default=8765)
    p.add_argument("--no-browser", action="store_true")
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("run", help="전일 데이터 자동 수집 (스케줄러용)")
    p.add_argument("--date"); p.add_argument("--headless", action="store_true"); p.add_argument("--debug", action="store_true")
    p.add_argument("--skip-sales", action="store_true"); p.add_argument("--skip-ads", action="store_true")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("import", help="다운로드한 파일로 가져오기")
    p.add_argument("--sales"); p.add_argument("--ads"); p.add_argument("--date")
    p.set_defaults(func=cmd_import)

    p = sub.add_parser("report", help="하루치 장부를 터미널에 출력")
    p.add_argument("--date"); p.set_defaults(func=cmd_report)

    p = sub.add_parser("mapping-import"); p.add_argument("csv", nargs="?"); p.set_defaults(func=cmd_mapping_import)
    p = sub.add_parser("mapping-export"); p.add_argument("csv", nargs="?"); p.set_defaults(func=cmd_mapping_export)
    p = sub.add_parser("ads-template"); p.add_argument("--date"); p.set_defaults(func=cmd_ads_template)
    p = sub.add_parser("ads-entry"); p.add_argument("--date"); p.set_defaults(func=cmd_ads_entry)
    p = sub.add_parser("login"); p.set_defaults(func=cmd_login)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
