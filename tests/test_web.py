import datetime as dt
import io
from pathlib import Path

import pytest

from coupang_calc.mapping import import_mapping_csv
from coupang_calc.store import Store
from coupang_calc.web import create_app
from tests.make_fixtures import make


@pytest.fixture
def client(tmp_path):
    db = tmp_path / "t.db"
    with Store(db) as s:
        import_mapping_csv(s, Path("config/mapping.csv"))
    app = create_app(db, None)
    app.config["TESTING"] = True
    return app.test_client(), tmp_path


def test_index_and_summary(client):
    c, _ = client
    assert c.get("/").status_code == 200
    assert "쿠팡 광고계산기" in c.get("/").get_data(as_text=True)
    s = c.get("/api/summary").get_json()
    assert s["days"] == 0 and len(s["campaigns"]) == 3


def test_import_and_ledger(client):
    c, tmp = client
    sales, ads = make(tmp / "fx")
    r = c.post("/api/import", data={"date": "2025-06-08", "sales": (open(sales, "rb"), "sales.xlsx"),
                                    "ads": (open(ads, "rb"), "ads.csv")}, content_type="multipart/form-data")
    j = r.get_json()
    assert j["sales"] == 7 and j["ads"] == 3 and j["unmapped_options"] == ["99999999999"]
    led = c.get("/api/ledger?start=2025-06-08&end=2025-06-08").get_json()
    assert led["total_profit"]["2025-06-08"] == pytest.approx(62872.7, abs=0.01)
    assert led["campaigns"][0]["days"]["2025-06-08"]["profit"] == pytest.approx(-1965.1, abs=0.01)
    csv_text = c.get("/api/ledger.csv?start=2025-06-08&end=2025-06-08").get_data(as_text=True)
    assert "순이익 (광고비제외)" in csv_text and "2025-06-08" in csv_text


def test_ads_and_margin_endpoints(client):
    c, _ = client
    r = c.post("/api/ads", json={"date": "2025-06-09", "rows": [
        {"campaign": "1_버킷햇_240%", "target_roas": "400%", "budget": "70,000", "spend": "10,000", "ad_revenue": "30,000",
         "conversion": "7.8%", "ctr": "0.15", "impressions": "1000", "clicks": "20", "ad_orders": "3", "action": "테스트"},
        {"campaign": "", "spend": "999"},
    ]})
    assert r.get_json()["saved"] == 1
    g = c.get("/api/ads?date=2025-06-09").get_json()
    row = g["rows"]["1_버킷햇_240%"]
    assert row["spend"] == 10000 and row["ctr"] == pytest.approx(0.0015) and row["action"] == "테스트"

    # 마진 변경 (적용일) → 옵션 목록에 이력이 보인다
    r = c.post("/api/margins", json={"option_id": "12340330543", "margin": 4000, "effective_from": "2025-06-10", "note": "쿠폰"})
    assert r.get_json()["ok"]
    opts = {o["option_id"]: o for o in c.get("/api/options").get_json()}
    hist = opts["12340330543"]["margins"]
    assert [h["effective_from"] for h in hist] == [None, "2025-06-10"]
    assert opts["12340330543"]["current_margin"] == 4000  # 오늘 기준 (2025-06-10 이후)

    # 새 옵션 추가 + 삭제
    assert c.post("/api/options", json={"option_id": "777", "product_name": "새", "campaign": "4_새캠페인", "margin": "3000"}).get_json()["ok"]
    assert "777" in {o["option_id"] for o in c.get("/api/options").get_json()}
    assert c.delete("/api/options/777").get_json()["ok"]
    assert c.post("/api/options", json={"product_name": "x"}).status_code == 400
    assert c.delete("/api/ads", json={"date": "2025-06-09", "campaign": "1_버킷햇_240%"}).get_json()["ok"]
    assert c.get("/api/ads?date=2025-06-09").get_json()["rows"] == {}


def test_records_endpoint_from_extension(client):
    c, _ = client
    sales_records = [
        {"옵션ID": "12,340,330,543", "옵션명": "사뚜 여성 빅사이즈 버킷햇, 블랙", "상품명": "버킷햇", "등록상품ID": "7088112678",
         "카테고리": "패션/잡화", "판매방식": "로켓그로스", "매출": "90,000", "주문": "9", "판매량": "9", "방문자": "14",
         "조회": "14", "장바구니": "1", "구매전환율": "64.29%"},
        {"옵션ID": "합계", "옵션명": "", "매출": "90,000"},
    ]
    r = c.post("/api/records", json={"kind": "sales", "date": "2025-06-08", "records": sales_records})
    j = r.get_json()
    assert r.status_code == 200 and j["saved"] == 1 and j["received"] == 2
    ads_records = [{"캠페인": "1_버킷햇_240%", "목표 광고수익률": "400%", "일 예산": "70,000", "광고비": "67,241",
                    "광고전환 매출": "180,000", "구매전환율": "7.80%", "클릭률": "0.15%", "노출수": "51,328", "클릭수": "153", "총 판매수량": "12"}]
    r = c.post("/api/records", json={"kind": "ads", "date": "2025-06-08", "records": ads_records})
    assert r.get_json()["saved"] == 1
    led = c.get("/api/ledger?start=2025-06-08&end=2025-06-08").get_json()
    cell = led["campaigns"][0]["days"]["2025-06-08"]
    assert cell["actual_qty"] == 9 and cell["margin_total"] == 54000 and cell["spend_vat"] == pytest.approx(73965.1)
    # 인식 불가 → 422, 잘못된 kind → 400
    assert c.post("/api/records", json={"kind": "sales", "records": [{"a": 1}]}).status_code == 422
    assert c.post("/api/records", json={"kind": "x", "records": []}).status_code == 400
    # CORS preflight
    pre = c.options("/api/records")
    assert pre.status_code in (200, 204) and pre.headers["Access-Control-Allow-Origin"] == "*"
    assert c.get("/api/ping").headers["Access-Control-Allow-Origin"] == "*"
