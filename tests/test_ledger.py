"""장부 계산이 원본 엑셀(2025-06-08)과 같은 값을 내는지, 마진 이력이 날짜별로 적용되는지."""
import datetime as dt
from pathlib import Path

import pytest

from coupang_calc.ads_report import parse_ads_file
from coupang_calc.ledger import ledger_from_store
from coupang_calc.mapping import import_mapping_csv
from coupang_calc.sales_report import SalesRow, parse_sales_report
from coupang_calc.store import Store
from tests.make_fixtures import make

D = dt.date(2025, 6, 8)


@pytest.fixture
def store(tmp_path):
    sales, ads = make(tmp_path / "fx")
    s = Store(tmp_path / "t.db")
    import_mapping_csv(s, Path("config/mapping.csv"))
    s.upsert_sales(parse_sales_report(sales, D))
    s.upsert_ads(parse_ads_file(ads, D))
    # 같은 날짜를 다시 넣어도 중복되지 않는다
    s.upsert_sales(parse_sales_report(sales, D))
    yield s
    s.close()


def test_matches_original_workbook(store):
    led = ledger_from_store(store, D, D)
    by = {c.campaign: c.days[D.isoformat()] for c in led.campaigns if D.isoformat() in c.days}
    b = by["1_버킷햇_240%"]
    assert b.spend_vat == pytest.approx(73965.1)
    assert b.roas == pytest.approx(2.6769, abs=1e-3)
    assert b.cpc == pytest.approx(439.48, abs=0.01)
    assert b.actual_qty == 12 and b.margin_total == 72000
    assert b.profit == pytest.approx(-1965.1, abs=0.01)
    assert by["2_조거팬츠_238%"].profit == pytest.approx(64639.2, abs=0.01)
    assert by["3_여행용파우치_247%"].profit == pytest.approx(198.6, abs=0.01)
    assert led.total_profit[D.isoformat()] == pytest.approx(62872.7, abs=0.01)
    assert led.unmapped_options == ["99999999999"]
    # 월 합계
    m = led.campaigns[0].months["2025-06"]
    assert m.profit == pytest.approx(-1965.1, abs=0.01) and m.roas == pytest.approx(2.6769, abs=1e-3)


def test_margin_history_applies_from_effective_date(store):
    """6/10 부터 버킷햇 마진을 6000 → 4000 으로 내리면 6/8·6/9 는 그대로, 6/10 부터만 바뀐다."""
    d9, d10 = dt.date(2025, 6, 9), dt.date(2025, 6, 10)
    for d in (d9, d10):
        store.upsert_sales([SalesRow(d, "12340330543", "버킷햇 블랙", "버킷햇", "1", "패션", "로켓그로스",
                                     100000, 10, 10, 0, 0, 0, None)])
    store.set_margin("12340330543", 4000, d10, "가격 인하")
    store.set_margin("12340330547", 4000, d10)
    led = ledger_from_store(store, D, d10)
    c = next(c for c in led.campaigns if c.campaign == "1_버킷햇_240%")
    assert c.days[D.isoformat()].margin_total == 72000  # 9×6000 + 3×6000 (변경 전)
    assert c.days[d9.isoformat()].margin_total == 60000  # 10×6000 (변경 전날)
    assert c.days[d10.isoformat()].margin_total == 40000  # 10×4000 (변경일부터)
    # 변경일 이후에 다시 올리면 그 날부터만 반영
    store.set_margin("12340330543", 6500, dt.date(2025, 6, 11))
    lk = store.margin_lookup()
    assert lk.margin("12340330543", d10) == 4000
    assert lk.margin("12340330543", dt.date(2025, 6, 11)) == 6500
    assert lk.margin("12340330543", dt.date(2025, 1, 1)) == 6000


def test_unmapped_margin_flag(store):
    """캠페인은 연결됐지만 마진이 없는 옵션은 0원으로 계산하고 표시한다."""
    store.upsert_option("555", "새 상품", "1_버킷햇_240%")
    store.upsert_sales([SalesRow(D, "555", "새", "새", "1", "c", "r", 1000, 1, 3, 0, 0, 0, None)])
    led = ledger_from_store(store, D, D)
    cell = led.campaigns[0].days[D.isoformat()]
    assert cell.actual_qty == 15 and cell.unmapped_qty == 3 and cell.margin_total == 72000


def test_default_range_covers_whole_months(store):
    led = ledger_from_store(store)
    assert led.dates[0] == "2025-06-01" and led.dates[-1] == "2025-06-30"
