"""SQLite 저장소. 모든 데이터는 data/ledger.db 한 파일에 들어간다.

테이블
- options        : 옵션ID ↔ 상품명 ↔ 광고 캠페인 (원본 시트1)
- margin_history : 옵션별 마진 이력. (옵션ID, 적용시작일) 마다 한 줄.
                   날짜 d 의 마진 = 적용시작일 <= d 인 것 중 가장 최근 값.
                   → 마진을 바꿔도 변경일 이전 데이터는 그대로 유지된다.
- sales_daily    : 일별 옵션 판매 (원본 시트3). (날짜, 옵션ID) 기준 덮어쓰기
- ads_daily      : 일별 캠페인 광고 (원본 시트2). (날짜, 캠페인) 기준 덮어쓰기
"""
from __future__ import annotations

import datetime as dt
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .ads_report import AdsRow
from .sales_report import SalesRow

DEFAULT_DB = Path("data/ledger.db")
MIN_DATE = "0001-01-01"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS options (
    option_id TEXT PRIMARY KEY,
    product_name TEXT NOT NULL DEFAULT '',
    campaign TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS margin_history (
    option_id TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    margin REAL NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (option_id, effective_from)
);
CREATE TABLE IF NOT EXISTS sales_daily (
    date TEXT NOT NULL, option_id TEXT NOT NULL,
    option_name TEXT, product_name TEXT, product_id TEXT, category TEXT, sales_type TEXT,
    revenue REAL, orders REAL, quantity REAL, visitors REAL, views REAL, carts REAL, conversion REAL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (date, option_id)
);
CREATE TABLE IF NOT EXISTS ads_daily (
    date TEXT NOT NULL, campaign TEXT NOT NULL,
    target_roas REAL, budget REAL, spend REAL, ad_revenue REAL, conversion REAL, ctr REAL,
    impressions REAL, clicks REAL, ad_orders REAL, action TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (date, campaign)
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_daily(date);
CREATE INDEX IF NOT EXISTS idx_ads_date ON ads_daily(date);
"""


@dataclass
class Option:
    option_id: str
    product_name: str
    campaign: str
    sort_order: int = 0


@dataclass
class MarginEntry:
    option_id: str
    effective_from: dt.date
    margin: float
    note: str = ""


class Store:
    def __init__(self, path: Path = DEFAULT_DB):
        self.path = Path(path)
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_SCHEMA)

    def close(self):
        self.conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ---- 옵션 / 캠페인 매핑 ---------------------------------------------------
    def options(self) -> List[Option]:
        rows = self.conn.execute("SELECT * FROM options ORDER BY sort_order, rowid").fetchall()
        return [Option(r["option_id"], r["product_name"], r["campaign"], r["sort_order"]) for r in rows]

    def upsert_option(self, option_id: str, product_name: str = "", campaign: str = "",
                      sort_order: Optional[int] = None):
        option_id = _clean_id(option_id)
        if sort_order is None:
            cur = self.conn.execute("SELECT sort_order FROM options WHERE option_id=?", (option_id,)).fetchone()
            if cur:
                sort_order = cur["sort_order"]
            else:
                mx = self.conn.execute("SELECT COALESCE(MAX(sort_order),0) FROM options").fetchone()[0]
                sort_order = mx + 1
        self.conn.execute(
            """INSERT INTO options(option_id, product_name, campaign, sort_order) VALUES (?,?,?,?)
               ON CONFLICT(option_id) DO UPDATE SET product_name=excluded.product_name,
               campaign=excluded.campaign, sort_order=excluded.sort_order""",
            (option_id, product_name.strip(), campaign.strip(), sort_order),
        )
        self.conn.commit()

    def delete_option(self, option_id: str):
        option_id = _clean_id(option_id)
        self.conn.execute("DELETE FROM options WHERE option_id=?", (option_id,))
        self.conn.execute("DELETE FROM margin_history WHERE option_id=?", (option_id,))
        self.conn.commit()

    def campaigns(self) -> List[str]:
        """옵션 등록 순서를 유지한 고유 캠페인 목록 + 광고 데이터에만 있는 캠페인."""
        out: List[str] = []
        for o in self.options():
            if o.campaign and o.campaign not in out:
                out.append(o.campaign)
        for r in self.conn.execute("SELECT DISTINCT campaign FROM ads_daily ORDER BY campaign"):
            if r[0] not in out:
                out.append(r[0])
        return out

    def campaign_of(self, option_id) -> str:
        r = self.conn.execute("SELECT campaign FROM options WHERE option_id=?", (_clean_id(option_id),)).fetchone()
        return r[0] if r else ""

    # ---- 마진 이력 ------------------------------------------------------------
    def margin_history(self, option_id: Optional[str] = None) -> List[MarginEntry]:
        q = "SELECT * FROM margin_history"
        args: tuple = ()
        if option_id is not None:
            q += " WHERE option_id=?"
            args = (_clean_id(option_id),)
        rows = self.conn.execute(q + " ORDER BY option_id, effective_from").fetchall()
        return [MarginEntry(r["option_id"], _to_date(r["effective_from"]), r["margin"], r["note"]) for r in rows]

    def set_margin(self, option_id: str, margin: float, effective_from: Optional[dt.date] = None, note: str = ""):
        """effective_from 이 없으면 '처음부터' 적용(초기 마진)."""
        eff = effective_from.isoformat() if effective_from else MIN_DATE
        self.conn.execute(
            """INSERT INTO margin_history(option_id, effective_from, margin, note) VALUES (?,?,?,?)
               ON CONFLICT(option_id, effective_from) DO UPDATE SET margin=excluded.margin, note=excluded.note""",
            (_clean_id(option_id), eff, float(margin), note),
        )
        self.conn.commit()

    def delete_margin(self, option_id: str, effective_from: Optional[dt.date]):
        eff = effective_from.isoformat() if effective_from else MIN_DATE
        self.conn.execute("DELETE FROM margin_history WHERE option_id=? AND effective_from=?", (_clean_id(option_id), eff))
        self.conn.commit()

    def margin_lookup(self) -> "MarginLookup":
        return MarginLookup(self.margin_history())

    # ---- 일별 데이터 쓰기 ----------------------------------------------------------
    def upsert_sales(self, rows: Iterable[SalesRow]) -> int:
        now = _now()
        data = [(*_sales_tuple(r), now) for r in rows]
        self.conn.executemany(
            """INSERT INTO sales_daily VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(date, option_id) DO UPDATE SET
               option_name=excluded.option_name, product_name=excluded.product_name,
               product_id=excluded.product_id, category=excluded.category, sales_type=excluded.sales_type,
               revenue=excluded.revenue, orders=excluded.orders, quantity=excluded.quantity,
               visitors=excluded.visitors, views=excluded.views, carts=excluded.carts,
               conversion=excluded.conversion, updated_at=excluded.updated_at""",
            data,
        )
        self.conn.commit()
        return len(data)

    def upsert_ads(self, rows: Iterable[AdsRow]) -> int:
        now = _now()
        data = [(r.date.isoformat(), r.campaign, r.target_roas, r.budget, r.spend, r.ad_revenue, r.conversion,
                 r.ctr, r.impressions, r.clicks, r.ad_orders, r.action, now) for r in rows]
        self.conn.executemany(
            """INSERT INTO ads_daily VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(date, campaign) DO UPDATE SET
               target_roas=excluded.target_roas, budget=excluded.budget, spend=excluded.spend,
               ad_revenue=excluded.ad_revenue, conversion=excluded.conversion, ctr=excluded.ctr,
               impressions=excluded.impressions, clicks=excluded.clicks, ad_orders=excluded.ad_orders,
               action=CASE WHEN excluded.action='' THEN ads_daily.action ELSE excluded.action END,
               updated_at=excluded.updated_at""",
            data,
        )
        self.conn.commit()
        return len(data)

    def delete_ads(self, date: dt.date, campaign: str):
        self.conn.execute("DELETE FROM ads_daily WHERE date=? AND campaign=?", (date.isoformat(), campaign))
        self.conn.commit()

    def delete_sales_date(self, date: dt.date):
        self.conn.execute("DELETE FROM sales_daily WHERE date=?", (date.isoformat(),))
        self.conn.commit()

    # ---- 읽기 -------------------------------------------------------------
    def sales(self, start: Optional[dt.date] = None, end: Optional[dt.date] = None) -> List[SalesRow]:
        q, args = _range_query("sales_daily", start, end)
        rows = self.conn.execute(q + " ORDER BY date, rowid", args).fetchall()
        return [
            SalesRow(
                date=_to_date(r["date"]), option_id=r["option_id"], option_name=r["option_name"],
                product_name=r["product_name"], product_id=r["product_id"], category=r["category"],
                sales_type=r["sales_type"], revenue=r["revenue"], orders=r["orders"], quantity=r["quantity"],
                visitors=r["visitors"], views=r["views"], carts=r["carts"], conversion=r["conversion"],
            )
            for r in rows
        ]

    def ads(self, start: Optional[dt.date] = None, end: Optional[dt.date] = None) -> List[AdsRow]:
        q, args = _range_query("ads_daily", start, end)
        rows = self.conn.execute(q + " ORDER BY date, rowid", args).fetchall()
        return [
            AdsRow(
                date=_to_date(r["date"]), campaign=r["campaign"], target_roas=r["target_roas"],
                budget=r["budget"], spend=r["spend"], ad_revenue=r["ad_revenue"], conversion=r["conversion"],
                ctr=r["ctr"], impressions=r["impressions"], clicks=r["clicks"], ad_orders=r["ad_orders"],
                action=r["action"] or "",
            )
            for r in rows
        ]

    def dates(self) -> List[dt.date]:
        rows = self.conn.execute(
            "SELECT date FROM sales_daily UNION SELECT date FROM ads_daily ORDER BY date"
        ).fetchall()
        return [_to_date(r[0]) for r in rows]

    def unmapped_option_ids(self) -> List[str]:
        rows = self.conn.execute(
            """SELECT DISTINCT s.option_id FROM sales_daily s LEFT JOIN options o ON o.option_id=s.option_id
               WHERE o.option_id IS NULL OR o.campaign='' ORDER BY s.option_id"""
        ).fetchall()
        return [r[0] for r in rows]


class MarginLookup:
    """옵션별 마진 이력을 메모리에 올려 (옵션, 날짜) → 마진 을 빠르게 찾는다."""

    def __init__(self, entries: Iterable[MarginEntry]):
        self._by_option: Dict[str, List[MarginEntry]] = {}
        for e in sorted(entries, key=lambda e: (e.option_id, e.effective_from)):
            self._by_option.setdefault(e.option_id, []).append(e)

    def margin(self, option_id: str, date: dt.date) -> float:
        hist = self._by_option.get(_clean_id(option_id))
        if not hist:
            return 0.0
        chosen = 0.0
        for e in hist:  # 적용시작일 오름차순, date 이하인 마지막 값
            if e.effective_from <= date:
                chosen = e.margin
            else:
                break
        return chosen


def _sales_tuple(r: SalesRow):
    return (r.date.isoformat(), r.option_id, r.option_name, r.product_name, r.product_id, r.category,
            r.sales_type, r.revenue, r.orders, r.quantity, r.visitors, r.views, r.carts, r.conversion)


def _range_query(table, start, end):
    q = f"SELECT * FROM {table}"
    conds, args = [], []
    if start:
        conds.append("date >= ?"); args.append(start.isoformat())
    if end:
        conds.append("date <= ?"); args.append(end.isoformat())
    if conds:
        q += " WHERE " + " AND ".join(conds)
    return q, args


def _to_date(s: str) -> dt.date:
    return dt.date.fromisoformat(s) if s != MIN_DATE else dt.date.min


def _now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def _clean_id(v) -> str:
    s = str(v).strip()
    return s[:-2] if s.endswith(".0") else s
