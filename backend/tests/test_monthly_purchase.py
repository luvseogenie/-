"""쿠팡이 표시하는 월간 구매 데이터 ("한 달간 3,000명 이상 구매했어요").

우리가 추정한 값이 아니라 쿠팡이 계산해 붙여 준 실제 판매 데이터이므로
소싱 기준(월 500개/1,000개 이상) 판단의 1순위 근거로 쓴다.
"""

from __future__ import annotations

import pytest


def product(pid: str, purchase=None, **kwargs):
    base = {
        "product_id": pid,
        "product_name": f"상품 {pid}",
        "product_url": f"https://www.coupang.com/vp/products/{pid}",
        "price": 28610,
        "review_count": 13633,
        "rating": 4.5,
        "delivery_type": "rocket",
    }
    if purchase is not None:
        base.update(
            {
                "monthly_purchase_count": purchase,
                "monthly_purchase_is_minimum": True,
                "monthly_purchase_unit": "명",
                "monthly_purchase_text": f"한 달간 {purchase:,}명 이상 구매",
            }
        )
    base.update(kwargs)
    return base


def collect(client, *products):
    return client.post("/api/products/collect", json={"products": list(products)}).json()


def test_purchase_label_is_stored(client):
    collect(client, product("P1", purchase=3000))
    item = client.get("/api/products").json()["items"][0]

    assert item["monthly_purchase_count"] == 3000
    assert item["monthly_purchase_is_minimum"] is True
    assert item["monthly_purchase_unit"] == "명"
    assert item["monthly_purchase_text"] == "한 달간 3,000명 이상 구매"
    assert item["monthly_purchase_collected_at"] is not None


def test_missing_label_stays_null(client):
    """문구가 없는 상품은 값을 만들어내지 않는다."""
    collect(client, product("P2"))
    item = client.get("/api/products").json()["items"][0]
    assert item["monthly_purchase_count"] is None
    assert item["monthly_purchase_text"] is None
    assert item["monthly_purchase_collected_at"] is None


def test_label_is_not_erased_when_absent_later(client):
    """목록 페이지에는 문구가 없고 상세에만 있는 경우, 재수집으로 값이 지워지면 안 된다."""
    collect(client, product("P3", purchase=1000))
    collect(client, product("P3"))  # 문구 없이 재수집
    item = client.get("/api/products").json()["items"][0]
    assert item["monthly_purchase_count"] == 1000


def test_label_is_updated_when_present(client):
    collect(client, product("P4", purchase=500))
    collect(client, product("P4", purchase=3000))
    item = client.get("/api/products").json()["items"][0]
    assert item["monthly_purchase_count"] == 3000


@pytest.fixture()
def sourcing_candidates(client):
    """소싱 기준 판별용 표본."""
    collect(
        client,
        product("A", purchase=3000),   # 월 3,000명 이상
        product("B", purchase=1000),   # 월 1,000명 이상
        product("C", purchase=500),    # 월 500명 이상
        product("D", purchase=100),    # 미달
        product("E"),                  # 문구 없음
    )
    return client


def test_find_products_over_1000_per_month(sourcing_candidates):
    """월 1,000개 이상 판매되는 상품 찾기."""
    res = sourcing_candidates.get(
        "/api/products", params={"purchase_min": 1000, "condition_passed": "true"}
    ).json()
    assert sorted(p["product_id"] for p in res["items"]) == ["A", "B"]


def test_find_products_over_500_per_month(sourcing_candidates):
    """최소 기준: 월 500개 이상."""
    res = sourcing_candidates.get(
        "/api/products", params={"purchase_min": 500, "condition_passed": "true"}
    ).json()
    assert sorted(p["product_id"] for p in res["items"]) == ["A", "B", "C"]


def test_unlabeled_product_does_not_pass(sourcing_candidates):
    """문구가 없는 상품은 조건을 통과하지 않는다(값을 지어내지 않으므로)."""
    res = sourcing_candidates.get("/api/products", params={"purchase_min": 1}).json()
    flags = {p["product_id"]: p["condition_passed"] for p in res["items"]}
    assert flags["E"] is False


def test_combined_with_price_condition(sourcing_candidates):
    """소싱 조건 조합: 월 1,000개 이상 + 가격 9,000~100,000원."""
    res = sourcing_candidates.get(
        "/api/products",
        params={
            "purchase_min": 1000,
            "price_min": 9000,
            "price_max": 100000,
            "condition_passed": "true",
        },
    ).json()
    assert sorted(p["product_id"] for p in res["items"]) == ["A", "B"]


def test_sorting_by_purchase(sourcing_candidates):
    res = sourcing_candidates.get("/api/products", params={"sort": "purchase_desc"}).json()
    assert [p["product_id"] for p in res["items"]][:4] == ["A", "B", "C", "D"]


def test_stats_reports_labeled_count(sourcing_candidates):
    stats = sourcing_candidates.get("/api/stats", params={"purchase_min": 1000}).json()
    assert stats["unique_products"] == 5
    assert stats["purchase_labeled_products"] == 4  # E는 문구 없음
    assert stats["condition_passed_products"] == 2  # A, B


# ---------------------------------------------------------------------------
# 2단계 워크플로: 상세 확인이 필요한 후보 찾기
#
# 쿠팡 구매 문구는 상품 상세 페이지에만 있다. 목록 페이지로 1차 필터를 건 뒤,
# 아직 문구를 확인하지 못한 후보만 골라 상세 페이지를 방문해야 한다.
# ---------------------------------------------------------------------------
@pytest.fixture()
def two_stage(client):
    collect(
        client,
        product("S1", purchase=3000, price=28610, rating=4.5),  # 확인됨·통과
        product("S2", purchase=100, price=11000, rating=4.7),   # 확인됨·미달
        product("S3", price=15900, rating=4.6),                 # 미확인 (1차 통과)
        product("S4", price=23000, rating=4.4),                 # 미확인 (1차 통과)
        product("S5", price=250000, rating=4.1),                # 1차 탈락(가격)
    )
    return client


PRIMARY = {"price_min": 9000, "price_max": 100000, "rating_min": 4.0}


def test_pending_list_shows_only_unchecked_candidates(two_stage):
    """1차 조건은 통과했지만 구매 문구가 없는 상품만 나와야 한다."""
    res = two_stage.get(
        "/api/products",
        params={**PRIMARY, "condition_passed": "true", "has_purchase": "false"},
    ).json()
    assert sorted(p["product_id"] for p in res["items"]) == ["S3", "S4"]
    assert all(p["monthly_purchase_count"] is None for p in res["items"])


def test_has_purchase_true_shows_checked_only(two_stage):
    res = two_stage.get("/api/products", params={"has_purchase": "true"}).json()
    assert sorted(p["product_id"] for p in res["items"]) == ["S1", "S2"]


def test_stats_reports_pending_count(two_stage):
    """구매수 조건을 제외한 나머지 조건을 통과한 미확인 상품 수."""
    stats = two_stage.get("/api/stats", params={**PRIMARY, "purchase_min": 1000}).json()
    assert stats["purchase_labeled_products"] == 2
    assert stats["purchase_pending_products"] == 2  # S3, S4
    assert stats["condition_passed_products"] == 1  # S1만


def test_detail_visit_fills_purchase_and_moves_out_of_pending(two_stage):
    """상세 페이지를 방문해 수집하면 대기 목록에서 빠진다."""
    collect(two_stage, product("S3", purchase=1500, price=15900, rating=4.6))

    pending = two_stage.get(
        "/api/products",
        params={**PRIMARY, "condition_passed": "true", "has_purchase": "false"},
    ).json()
    assert [p["product_id"] for p in pending["items"]] == ["S4"]

    passed = two_stage.get(
        "/api/products", params={**PRIMARY, "purchase_min": 1000, "condition_passed": "true"}
    ).json()
    assert sorted(p["product_id"] for p in passed["items"]) == ["S1", "S3"]
