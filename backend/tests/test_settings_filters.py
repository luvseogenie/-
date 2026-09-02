from __future__ import annotations

import pytest

from app.services.estimation import calculate_estimated_sales


@pytest.mark.parametrize(
    "reviews,multiplier,expected",
    [
        (50, 20, 1000),
        (82, 20, 1640),
        (250, 20, 5000),
        (82, 30, 2460),
        (0, 20, 0),
        (None, 20, 0),
    ],
)
def test_estimated_sales_formula(reviews, multiplier, expected):
    assert calculate_estimated_sales(reviews, multiplier) == expected


def make(pid, price, reviews, rating, delivery):
    return {
        "product_id": pid,
        "product_name": f"상품 {pid}",
        "product_url": f"https://www.coupang.com/vp/products/{pid}",
        "price": price,
        "review_count": reviews,
        "rating": rating,
        "delivery_type": delivery,
    }


@pytest.fixture()
def seeded(client):
    client.post(
        "/api/products/collect",
        json={
            "products": [
                make("A", 13900, 82, 4.7, "rocket_growth"),   # 예상 1640
                make("B", 5000, 300, 4.2, "rocket"),           # 예상 6000, 가격 미달
                make("C", 50000, 10, 4.9, "seller"),           # 예상 200, 판매량 미달
                make("D", 25000, 120, 3.1, "rocket"),          # 예상 2400, 평점 미달
                make("E", 99000, 240, 4.5, "rocket_growth"),   # 예상 4800, 전부 통과
                make("F", None, 100, None, None),              # 값 없음
            ]
        },
    )
    return client


def test_default_multiplier_is_20(client):
    assert client.get("/api/settings").json()["review_sales_multiplier"] == 20


def test_multiplier_change_recalculates(seeded):
    res = seeded.put("/api/settings", json={"review_sales_multiplier": 30}).json()
    assert res["review_sales_multiplier"] == 30
    assert res["recalculated_products"] == 6

    items = {p["product_id"]: p for p in seeded.get("/api/products").json()["items"]}
    assert items["A"]["estimated_sales"] == 82 * 30
    assert items["B"]["estimated_sales"] == 300 * 30


def test_multiplier_validation(client):
    assert client.put("/api/settings", json={"review_sales_multiplier": 0}).status_code == 422


CONDITIONS = {
    "price_min": 9000,
    "price_max": 100000,
    "review_min": 0,
    "review_max": 250,
    "sales_min": 1000,
    "sales_max": 10000,
    "rating_min": 4.0,
    "rating_max": 5.0,
}


def test_condition_passed_filter(seeded):
    res = seeded.get("/api/products", params={**CONDITIONS, "condition_passed": "true"}).json()
    assert sorted(p["product_id"] for p in res["items"]) == ["A", "E"]
    assert all(p["condition_passed"] for p in res["items"])


def test_condition_flag_present_without_filtering(seeded):
    res = seeded.get("/api/products", params=CONDITIONS).json()
    flags = {p["product_id"]: p["condition_passed"] for p in res["items"]}
    assert flags == {"A": True, "B": False, "C": False, "D": False, "E": True, "F": False}


def test_missing_values_do_not_pass_range_conditions(seeded):
    """가격/평점이 null인 상품은 범위 조건을 통과하지 않는다(값을 지어내지 않으므로)."""
    res = seeded.get(
        "/api/products", params={"price_min": 1, "condition_passed": "true"}
    ).json()
    assert "F" not in [p["product_id"] for p in res["items"]]


def test_delivery_type_filter(seeded):
    res = seeded.get("/api/products", params={"delivery_types": "rocket_growth"}).json()
    passed = [p["product_id"] for p in res["items"] if p["condition_passed"]]
    assert sorted(passed) == ["A", "E"]

    # 비우면 전체
    res_all = seeded.get("/api/products", params={"delivery_types": ""}).json()
    assert res_all["total"] == 6


@pytest.mark.parametrize(
    "sort,expected_first",
    [
        ("price_desc", "E"),
        ("price_asc", "B"),
        ("review_desc", "B"),
        ("review_asc", "C"),
        ("sales_desc", "B"),
        ("sales_asc", "C"),
        ("rating_desc", "C"),
        ("rating_asc", "D"),
    ],
)
def test_sorting(seeded, sort, expected_first):
    res = seeded.get("/api/products", params={"sort": sort}).json()
    assert res["items"][0]["product_id"] == expected_first


def test_search_and_pagination(seeded):
    res = seeded.get("/api/products", params={"q": "상품 A"}).json()
    assert res["total"] == 1

    page1 = seeded.get("/api/products", params={"page": 1, "page_size": 2, "sort": "review_desc"}).json()
    page2 = seeded.get("/api/products", params={"page": 2, "page_size": 2, "sort": "review_desc"}).json()
    assert page1["total"] == 6 and len(page1["items"]) == 2
    assert page1["items"][0]["product_id"] != page2["items"][0]["product_id"]


def test_stats(seeded):
    res = seeded.get("/api/stats", params={**CONDITIONS, "category_ids": "1,2,3"}).json()
    assert res["selected_categories"] == 3
    assert res["unique_products"] == 0  # 카테고리 1,2,3에 속한 상품 없음

    res2 = seeded.get("/api/stats", params=CONDITIONS).json()
    # 수집 상품 수는 확장이 보낸 총 개수(중복 포함)
    assert res2["collected_products"] == 6
    assert res2["unique_products"] == 6
    assert res2["condition_passed_products"] == 2
    assert res2["review_sales_multiplier"] == 20


def test_monthly_revenue_sort_and_measured_scope(client):
    """기본 정렬은 30일 예상매출(30일 예상 판매량 × 가격) 많은순, 미측정 상품은 뒤로 간다."""
    client.post("/api/products/collect", json={"source_url": "https://www.coupang.com/np/categories/1", "page_type": "category", "products": [
        {"product_id": "A", "product_name": "A", "product_url": "https://www.coupang.com/vp/products/A", "price": 10000, "review_count": 10},
        {"product_id": "B", "product_name": "B", "product_url": "https://www.coupang.com/vp/products/B", "price": 50000, "review_count": 10},
        {"product_id": "C", "product_name": "C(미측정)", "product_url": "https://www.coupang.com/vp/products/C", "price": 99000, "review_count": 999},
    ], "skipped": 0})
    for pid, n in (("A", 30), ("B", 10)):
        client.post("/api/products/review-dates", json={
            "product_id": pid, "product_url": f"https://www.coupang.com/vp/products/{pid}",
            "reviews_in_window": n, "sample_size": n + 5, "sample_span_days": 40, "covers_window": True,
            "newest_review_date": "2026-09-01", "oldest_review_date": "2026-07-23", "total_review_count": 10,
        })
    items = client.get("/api/products").json()["items"]
    # A: 30×20×10000 = 6,000,000 / B: 10×20×50000 = 10,000,000 / C: NULL → B, A, C
    assert [i["product_id"] for i in items] == ["B", "A", "C"]
    assert client.get("/api/products?measured=false").json()["total"] == 1
    stats = client.get("/api/stats?monthly_sales_min=300").json()
    assert stats["condition_passed_products"] == 1  # A(600)만 통과
    assert stats["passed_monthly_revenue"] == 6_000_000
    assert stats["monthly_pending_products"] == 1  # C


def test_condition_breakdown_explains_zero_results(client):
    """조건 통과 0건일 때 어떤 조건이 몇 개를 탈락시켰는지 알려준다 (값 없음도 탈락)."""
    client.post("/api/products/collect", json={"source_url": "https://www.coupang.com/np/categories/1", "page_type": "category", "products": [
        {"product_id": "A", "product_name": "A", "product_url": "https://www.coupang.com/vp/products/A", "price": 10000, "review_count": 10, "rating": 4.8, "delivery_type": "rocket"},
        {"product_id": "B", "product_name": "B", "product_url": "https://www.coupang.com/vp/products/B", "price": 50000, "review_count": 10, "rating": 4.0, "delivery_type": "seller"},
        {"product_id": "C", "product_name": "C", "product_url": "https://www.coupang.com/vp/products/C", "price": None, "review_count": 10, "rating": None, "delivery_type": None},
    ], "skipped": 0})
    stats = client.get("/api/stats?purchase_min=500&monthly_sales_min=500&rating_min=4.5&delivery_types=rocket,rocket_growth").json()
    assert stats["condition_passed_products"] == 0
    assert stats["condition_breakdown"] == {
        "rating": 2,          # B(4.0), C(없음)
        "monthly_sales": 3,   # 아무도 측정 안 됨
        "purchase": 3,        # 문구 없음
        "delivery": 2,        # B(seller), C(없음)
        "unmeasured": 3,
    }


def test_monthly_min_passes_by_label_or_estimate(client):
    """소싱 기준(monthly_min)은 쿠팡 문구 또는 30일 예상판매 중 하나만 넘어도 통과."""
    def prod(pid, **extra):
        base = {"product_id": pid, "product_name": pid, "product_url": f"https://www.coupang.com/vp/products/{pid}", "price": 10000, "review_count": 100}
        base.update(extra); return base
    client.post("/api/products/collect", json={"source_url": "https://www.coupang.com/np/categories/1", "page_type": "category", "products": [
        prod("LABEL", monthly_purchase_count=500, monthly_purchase_is_minimum=True, monthly_purchase_unit="명", monthly_purchase_text="한 달간 500명 이상 구매했어요"),
        prod("EST"), prod("NONE"), prod("LOW", monthly_purchase_count=100, monthly_purchase_is_minimum=True, monthly_purchase_unit="명", monthly_purchase_text="한 달간 100명 이상 구매했어요"),
    ], "skipped": 0})
    client.post("/api/products/review-dates", json={"product_id": "EST", "product_url": "https://www.coupang.com/vp/products/EST",
        "reviews_in_window": 30, "sample_size": 35, "sample_span_days": 40, "covers_window": True,
        "newest_review_date": "2026-09-01", "oldest_review_date": "2026-07-23", "total_review_count": 100})  # 30×20 = 600
    passed = client.get("/api/products?condition_passed=true&monthly_min=500").json()
    assert sorted(p["product_id"] for p in passed["items"]) == ["EST", "LABEL"]
    stats = client.get("/api/stats?monthly_min=500").json()
    assert stats["condition_passed_products"] == 2
    assert stats["condition_breakdown"]["monthly"] == 2  # NONE, LOW
