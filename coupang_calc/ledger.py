"""광고 장부 계산 (원본 시트4 의 SUMIFS 를 파이썬으로).

캠페인 × 날짜 마다 아래 항목을 만든다.
  목표효율, 광고수익률, 광고예산, 집행광고비(부가세 10% 포함), CPC, 노출수, 클릭률, 전환율,
  광고전환 판매수, 실제 판매수, 광고 마진(= Σ 판매량 × 그 날짜에 유효한 옵션 마진), 순이익(= 광고 마진 - 광고비)
월 합계는 광고비/판매수/마진/순이익의 합, 월 광고수익률 = Σ전환매출 / Σ광고비.
"""
from __future__ import annotations

import calendar
import datetime as dt
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence

from .ads_report import AdsRow
from .sales_report import SalesRow
from .store import MarginLookup, Store

VAT = 1.1

METRICS = [
    ("target_roas", "목표효율", "ratio"),
    ("roas", "광고수익률", "ratio"),
    ("budget", "광고예산", "won"),
    ("spend_vat", "집행 광고비*10%", "won"),
    ("cpc", "CPC 단가", "won"),
    ("impressions", "노출수", "int"),
    ("ctr", "클릭률", "pct2"),
    ("conversion", "전환율", "pct1"),
    ("ad_orders", "광고 전환 판매 수", "int"),
    ("actual_qty", "실제 판매 수", "int"),
    ("margin_total", "광고 마진", "won"),
    ("profit", "순이익 (광고비제외)", "won"),
]
SUM_METRICS = ["spend_vat", "spend", "ad_revenue", "budget", "impressions", "clicks",
               "ad_orders", "actual_qty", "margin_total", "profit"]


@dataclass
class DayCell:
    target_roas: float = 0.0
    roas: float = 0.0
    budget: float = 0.0
    spend: float = 0.0
    spend_vat: float = 0.0
    ad_revenue: float = 0.0
    cpc: float = 0.0
    impressions: float = 0.0
    clicks: float = 0.0
    ctr: float = 0.0
    conversion: float = 0.0
    ad_orders: float = 0.0
    actual_qty: float = 0.0
    margin_total: float = 0.0
    profit: float = 0.0
    action: str = ""
    has_ads: bool = False
    has_sales: bool = False
    unmapped_qty: float = 0.0  # 마진이 0인(마진 미등록) 옵션의 판매량 → 화면에서 경고


@dataclass
class CampaignLedger:
    campaign: str
    days: Dict[str, DayCell] = field(default_factory=dict)  # ISO 날짜 → 값
    months: Dict[str, DayCell] = field(default_factory=dict)  # 'YYYY-MM' → 월 합계


@dataclass
class Ledger:
    start: dt.date
    end: dt.date
    dates: List[str]
    campaigns: List[CampaignLedger]
    total_profit: Dict[str, float]  # 날짜 → 전체 순이익
    month_profit: Dict[str, float]  # 'YYYY-MM' → 전체 순이익
    unmapped_options: List[str]

    def to_dict(self):
        return {
            "start": self.start.isoformat(), "end": self.end.isoformat(), "dates": self.dates,
            "metrics": [{"key": k, "label": l, "fmt": f} for k, l, f in METRICS],
            "campaigns": [
                {"campaign": c.campaign, "days": {d: asdict(v) for d, v in c.days.items()},
                 "months": {m: asdict(v) for m, v in c.months.items()}}
                for c in self.campaigns
            ],
            "total_profit": self.total_profit, "month_profit": self.month_profit,
            "unmapped_options": self.unmapped_options,
        }


def compute_ledger(
    ads: Sequence[AdsRow], sales: Sequence[SalesRow], campaign_of: Dict[str, str], margins: MarginLookup,
    campaigns: Iterable[str], start: dt.date, end: dt.date,
) -> Ledger:
    order = list(campaigns)
    for a in ads:
        if a.campaign not in order:
            order.append(a.campaign)
    cells: Dict[str, Dict[str, DayCell]] = {c: defaultdict(DayCell) for c in order}

    for a in ads:
        if not (start <= a.date <= end):
            continue
        c = cells[a.campaign][a.date.isoformat()]
        c.has_ads = True
        c.target_roas, c.budget, c.spend, c.ad_revenue = a.target_roas, a.budget, a.spend, a.ad_revenue
        c.spend_vat = a.spend * VAT
        c.roas = a.ad_revenue / a.spend if a.spend else 0.0
        c.cpc = a.spend / a.clicks if a.clicks else 0.0
        c.impressions, c.clicks, c.ctr, c.conversion, c.ad_orders = a.impressions, a.clicks, a.ctr, a.conversion, a.ad_orders
        c.action = a.action or ""

    unmapped = set()
    for s in sales:
        if not (start <= s.date <= end):
            continue
        camp = campaign_of.get(s.option_id, "")
        if not camp:
            unmapped.add(s.option_id)
            continue
        if camp not in cells:
            cells[camp] = defaultdict(DayCell); order.append(camp)
        c = cells[camp][s.date.isoformat()]
        c.has_sales = True
        m = margins.margin(s.option_id, s.date)
        c.actual_qty += s.quantity
        c.margin_total += s.quantity * m
        if m == 0 and s.quantity:
            c.unmapped_qty += s.quantity

    dates = [d.isoformat() for d in _date_range(start, end)]
    total_profit: Dict[str, float] = defaultdict(float)
    month_profit: Dict[str, float] = defaultdict(float)
    result: List[CampaignLedger] = []
    for camp in order:
        cl = CampaignLedger(campaign=camp)
        month_acc: Dict[str, DayCell] = defaultdict(DayCell)
        for d in dates:
            c = cells[camp].get(d)
            if c is None:
                continue
            c.profit = c.margin_total - c.spend_vat
            cl.days[d] = c
            total_profit[d] += c.profit
            mk = d[:7]
            month_profit[mk] += c.profit
            ma = month_acc[mk]
            for k in SUM_METRICS:
                setattr(ma, k, getattr(ma, k) + getattr(c, k))
        for mk, ma in month_acc.items():
            ma.roas = ma.ad_revenue / ma.spend if ma.spend else 0.0
            ma.cpc = ma.spend / ma.clicks if ma.clicks else 0.0
            ma.ctr = ma.clicks / ma.impressions if ma.impressions else 0.0
            ma.conversion = ma.ad_orders / ma.clicks if ma.clicks else 0.0
        cl.months = dict(month_acc)
        result.append(cl)
    return Ledger(start=start, end=end, dates=dates, campaigns=result,
                  total_profit={d: total_profit.get(d, 0.0) for d in dates if d in total_profit},
                  month_profit=dict(month_profit), unmapped_options=sorted(unmapped))


def ledger_from_store(store: Store, start: Optional[dt.date] = None, end: Optional[dt.date] = None) -> Ledger:
    all_dates = store.dates()
    if not all_dates:
        today = dt.date.today()
        start = start or today.replace(day=1)
        end = end or today
    else:
        start = start or all_dates[0].replace(day=1)
        last = all_dates[-1]
        end = end or last.replace(day=calendar.monthrange(last.year, last.month)[1])
    campaign_of = {o.option_id: o.campaign for o in store.options()}
    return compute_ledger(store.ads(start, end), store.sales(start, end), campaign_of, store.margin_lookup(),
                          store.campaigns(), start, end)


def _date_range(start: dt.date, end: dt.date) -> List[dt.date]:
    out, cur = [], start
    while cur <= end:
        out.append(cur); cur += dt.timedelta(days=1)
    return out
