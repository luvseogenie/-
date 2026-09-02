import datetime as dt
from pathlib import Path

import pytest

from coupang_calc.ads_report import normalize_records, parse_ads_file
from coupang_calc.common import parse_date, parse_number, parse_percent, parse_ratio
from coupang_calc.mapping import export_mapping_csv, import_mapping_csv
from coupang_calc.sales_report import parse_sales_report
from coupang_calc.store import Store
from tests.make_fixtures import make

D = dt.date(2025, 6, 8)


@pytest.fixture(scope="module")
def fixtures(tmp_path_factory):
    return make(tmp_path_factory.mktemp("fx"))


def test_parse_helpers():
    assert parse_number("1,234") == 1234
    assert parse_number("7.8%") == pytest.approx(0.078)
    assert parse_percent(7.8) == pytest.approx(0.078)
    assert parse_percent(0.078) == pytest.approx(0.078)
    assert parse_ratio("400%") == 4.0
    assert parse_ratio(3.5) == 3.5
    assert parse_date("2025.06.08") == D
    assert parse_date("sales_20250608") == D
    assert parse_number("-") is None


def test_sales_report(fixtures):
    sales, _ = fixtures
    rows = parse_sales_report(sales, D)
    assert len(rows) == 7
    r = rows[0]
    assert r.option_id == "12340330543"
    assert r.revenue == 90000 and r.quantity == 9 and r.carts == 1
    assert r.conversion == pytest.approx(0.6429)
    assert rows[4].carts == 1.5


def test_sales_report_positional_fallback(tmp_path):
    """헤더가 없는 파일도 A~M 순서로 읽힌다."""
    from openpyxl import Workbook

    wb = Workbook(); ws = wb.active
    ws.append([12340330543, "옵션", "상품", 1, "카테고리", "로켓그로스", 1000, 1, 2, 3, 4, 5, "50%"])
    p = tmp_path / "x.xlsx"; wb.save(p)
    rows = parse_sales_report(p, D)
    assert rows[0].quantity == 2 and rows[0].conversion == 0.5


def test_ads_file(fixtures):
    _, ads = fixtures
    rows = parse_ads_file(ads, D)
    assert [r.campaign for r in rows] == ["1_버킷햇_240%", "2_조거팬츠_238%", "3_여행용파우치_247%"]  # 합계 제외
    r = rows[0]
    assert r.target_roas == 4.0 and r.budget == 70000 and r.spend == 67241
    assert r.conversion == pytest.approx(0.078) and r.ctr == pytest.approx(0.0015)
    assert r.impressions == 51328 and r.clicks == 153 and r.ad_orders == 12
    assert r.roas == pytest.approx(2.6769, abs=1e-3)
    assert r.cpc == pytest.approx(439.48, abs=0.01)


def test_ads_records_sheet2_headers():
    rec = {"캠페인 이름": "A", "목표효율": 4, "광고예산": 1, "집행\n광고비": 2, "광고전환\n매출": 3, "전환율": 0.1,
           "클릭률": 0.01, "노출수": 100, "클릭수": 10, "광고전환 판매수": 1, "ACTION": "메모"}
    r = normalize_records([rec], D)[0]
    assert r.spend == 2 and r.ad_revenue == 3 and r.action == "메모" and r.conversion == 0.1


def test_mapping_roundtrip(tmp_path):
    with Store(tmp_path / "t.db") as s:
        n = import_mapping_csv(s, Path("config/mapping.csv"))
        assert n == 6
        assert s.campaigns() == ["1_버킷햇_240%", "2_조거팬츠_238%", "3_여행용파우치_247%"]
        assert s.campaign_of(12340330543) == "1_버킷햇_240%"
        lk = s.margin_lookup()
        assert lk.margin("12340251323", D) == 8500
        assert lk.margin("0", D) == 0.0
        s.set_margin("12340251323", 7000, dt.date(2025, 7, 1), "쿠폰")
        out = export_mapping_csv(s, tmp_path / "m.csv")
        text = out.read_text(encoding="utf-8-sig")
        assert "2025-07-01" in text and "7000" in text
    # 다시 가져오면 이력이 그대로 복원된다
    with Store(tmp_path / "t2.db") as s2:
        import_mapping_csv(s2, out)
        lk = s2.margin_lookup()
        assert lk.margin("12340251323", dt.date(2025, 6, 30)) == 8500
        assert lk.margin("12340251323", dt.date(2025, 7, 1)) == 7000
