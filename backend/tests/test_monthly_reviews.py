"""최근 30일 리뷰수 / 예상 판매량 테스트.

쿠팡은 최근 1달 리뷰수를 표시하지 않으므로 두 가지 방법으로 유도한다.
  1) 상세 페이지 리뷰 작성일 분석 (review_dates)
  2) 누적 리뷰수 스냅샷 차분 (snapshot_delta)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.product import Product
from app.models.review_snapshot import ReviewSnapshot
from app.services import monthly_reviews


def product_payload(pid: str, reviews: int):
    return {
        "product_id": pid,
        "product_name": f"상품 {pid}",
        "product_url": f"https://www.coupang.com/vp/products/{pid}",
        "price": 15000,
        "review_count": reviews,
        "rating": 4.5,
        "delivery_type": "rocket_growth",
    }


def collect(client, pid: str, reviews: int):
    return client.post(
        "/api/products/collect", json={"products": [product_payload(pid, reviews)]}
    ).json()


def shift_snapshots(db, product_db_id: int, days: float):
    """스냅샷 시각을 과거로 옮긴다(시간 경과 시뮬레이션)."""
    rows = db.scalars(
        select(ReviewSnapshot).where(ReviewSnapshot.product_id == product_db_id)
    ).all()
    for row in rows:
        captured = row.captured_at
        if captured.tzinfo is None:
            captured = captured.replace(tzinfo=timezone.utc)
        row.captured_at = captured - timedelta(days=days)
    db.commit()


# ---------------------------------------------------------------------------
# 스냅샷 차분
# ---------------------------------------------------------------------------
def test_first_collection_has_no_monthly_value(client):
    """수집이 한 번뿐이면 최근 30일 리뷰수를 알 수 없다 → null."""
    collect(client, "M001", 100)
    item = client.get("/api/products").json()["items"][0]
    assert item["monthly_review_count"] is None
    assert item["monthly_estimated_sales"] is None
    assert item["monthly_review_method"] is None


def test_snapshot_delta_over_30_days(client, db):
    """30일 간격 스냅샷 → 정확한 실측값."""
    collect(client, "M002", 100)
    product = db.scalar(select(Product).where(Product.product_id == "M002"))
    shift_snapshots(db, product.id, days=30)

    collect(client, "M002", 160)  # 30일 동안 리뷰 60건 증가

    item = client.get("/api/products").json()["items"][0]
    assert item["monthly_review_count"] == 60
    assert item["monthly_estimated_sales"] == 60 * 20
    assert item["monthly_review_method"] == "snapshot_delta"
    assert item["monthly_review_is_extrapolated"] is False
    assert item["monthly_review_window_days"] == 30


def test_snapshot_delta_short_window_is_extrapolated(client, db):
    """10일치만 있으면 30일로 환산하고 추정으로 표시한다."""
    collect(client, "M003", 100)
    product = db.scalar(select(Product).where(Product.product_id == "M003"))
    shift_snapshots(db, product.id, days=10)

    collect(client, "M003", 120)  # 10일간 20건 → 30일 환산 60건

    item = client.get("/api/products").json()["items"][0]
    assert item["monthly_review_count"] == 60
    assert item["monthly_review_is_extrapolated"] is True
    assert item["monthly_review_window_days"] == pytest.approx(10, abs=0.1)


def test_snapshot_interval_too_short_is_ignored(client):
    """같은 날 두 번 수집하면 30일 환산이 무의미하다 → null 유지."""
    collect(client, "M004", 100)
    collect(client, "M004", 101)
    item = client.get("/api/products").json()["items"][0]
    assert item["monthly_review_count"] is None


def test_review_count_decrease_is_clamped_to_zero(client, db):
    """리뷰가 줄어도 음수를 만들지 않는다."""
    collect(client, "M005", 200)
    product = db.scalar(select(Product).where(Product.product_id == "M005"))
    shift_snapshots(db, product.id, days=30)
    collect(client, "M005", 180)

    item = client.get("/api/products").json()["items"][0]
    assert item["monthly_review_count"] == 0
    assert item["monthly_estimated_sales"] == 0


# ---------------------------------------------------------------------------
# 리뷰 작성일 분석
# ---------------------------------------------------------------------------
def test_review_dates_exact_measurement(client):
    """표본이 30일 경계를 넘었으면 실측값 그대로 쓴다."""
    collect(client, "M010", 500)
    res = client.post(
        "/api/products/review-dates",
        json={
            "product_id": "M010",
            "reviews_in_window": 82,
            "sample_size": 120,
            "sample_span_days": 45.0,
            "covers_window": True,
        },
    ).json()

    assert res["applied"] is True
    assert res["monthly_review_count"] == 82
    assert res["monthly_estimated_sales"] == 82 * 20
    assert res["monthly_review_method"] == "review_dates"
    assert res["monthly_review_is_extrapolated"] is False
    assert "실측" in res["message"]


def test_review_dates_extrapolated_when_sample_too_recent(client):
    """표본이 전부 30일 안에 있으면 리뷰 속도로 30일치를 환산한다."""
    collect(client, "M011", 500)
    res = client.post(
        "/api/products/review-dates",
        json={
            "product_id": "M011",
            "reviews_in_window": 20,
            "sample_size": 20,
            "sample_span_days": 4.0,  # 4일에 20건 = 하루 5건 → 30일 150건
            "covers_window": False,
        },
    ).json()

    assert res["monthly_review_count"] == 150
    assert res["monthly_review_is_extrapolated"] is True
    assert "환산" in res["message"]


def test_review_dates_updates_total_review_count(client):
    """상세 페이지의 누적 리뷰수도 함께 갱신한다."""
    collect(client, "M012", 100)
    client.post(
        "/api/products/review-dates",
        json={
            "product_id": "M012",
            "reviews_in_window": 30,
            "sample_size": 40,
            "sample_span_days": 50.0,
            "covers_window": True,
            "total_review_count": 137,
        },
    )
    item = client.get("/api/products").json()["items"][0]
    assert item["review_count"] == 137
    assert item["estimated_sales"] == 137 * 20
    assert item["monthly_review_count"] == 30


def test_review_dates_requires_collected_product(client):
    res = client.post(
        "/api/products/review-dates",
        json={"product_id": "NOPE", "reviews_in_window": 5, "sample_size": 5, "covers_window": True},
    )
    assert res.status_code == 404
    assert "수집" in res.json()["detail"]


def test_empty_sample_is_not_invented(client):
    """리뷰 날짜를 하나도 못 읽으면 값을 만들지 않는다."""
    collect(client, "M013", 100)
    res = client.post(
        "/api/products/review-dates",
        json={"product_id": "M013", "reviews_in_window": 0, "sample_size": 0, "covers_window": False},
    ).json()
    assert res["applied"] is False
    assert res["monthly_review_count"] is None


def test_exact_measurement_beats_extrapolation(client, db):
    """실측값이 있으면 이후의 추정값이 덮어쓰지 않는다."""
    collect(client, "M014", 500)
    client.post(
        "/api/products/review-dates",
        json={
            "product_id": "M014",
            "reviews_in_window": 82,
            "sample_size": 120,
            "sample_span_days": 45.0,
            "covers_window": True,
        },
    )
    # 이후 짧은 구간의 스냅샷 추정이 들어와도 실측값을 유지한다.
    product = db.scalar(select(Product).where(Product.product_id == "M014"))
    shift_snapshots(db, product.id, days=3)
    collect(client, "M014", 520)

    item = client.get("/api/products").json()["items"][0]
    assert item["monthly_review_count"] == 82
    assert item["monthly_review_method"] == "review_dates"


# ---------------------------------------------------------------------------
# 배수 변경 / 필터 / 정렬
# ---------------------------------------------------------------------------
def test_multiplier_change_recalculates_monthly_sales(client):
    collect(client, "M020", 500)
    client.post(
        "/api/products/review-dates",
        json={
            "product_id": "M020",
            "reviews_in_window": 50,
            "sample_size": 90,
            "sample_span_days": 60.0,
            "covers_window": True,
        },
    )
    client.put("/api/settings", json={"review_sales_multiplier": 30})
    item = client.get("/api/products").json()["items"][0]
    assert item["monthly_review_count"] == 50
    assert item["monthly_estimated_sales"] == 50 * 30


@pytest.fixture()
def monthly_seeded(client):
    """최근 30일 예상 판매량이 각각 다른 상품 3건 + 미측정 1건."""
    for pid, monthly in (("S1", 10), ("S2", 100), ("S3", 400)):
        collect(client, pid, 1000)
        client.post(
            "/api/products/review-dates",
            json={
                "product_id": pid,
                "reviews_in_window": monthly,
                "sample_size": monthly + 10,
                "sample_span_days": 40.0,
                "covers_window": True,
            },
        )
    collect(client, "S4", 1000)  # 측정 안 된 상품
    return client


def test_monthly_condition_filter(monthly_seeded):
    # 최근 30일 예상 판매량 1,000 ~ 5,000  (배수 20 → 리뷰 50~250건)
    res = monthly_seeded.get(
        "/api/products",
        params={"monthly_sales_min": 1000, "monthly_sales_max": 5000, "condition_passed": "true"},
    ).json()
    assert [p["product_id"] for p in res["items"]] == ["S2"]


def test_unmeasured_product_does_not_pass_monthly_condition(monthly_seeded):
    """최근 30일 값이 없는 상품은 월간 조건을 통과하지 않는다(값을 지어내지 않으므로)."""
    res = monthly_seeded.get("/api/products", params={"monthly_sales_min": 1}).json()
    flags = {p["product_id"]: p["condition_passed"] for p in res["items"]}
    assert flags["S4"] is False


def test_monthly_sorting(monthly_seeded):
    desc = monthly_seeded.get("/api/products", params={"sort": "monthly_sales_desc"}).json()
    assert [p["product_id"] for p in desc["items"]][:3] == ["S3", "S2", "S1"]
    asc = monthly_seeded.get("/api/products", params={"sort": "monthly_sales_asc"}).json()
    assert [p["product_id"] for p in asc["items"]][:3] == ["S1", "S2", "S3"]


def test_stats_reports_measured_count(monthly_seeded):
    stats = monthly_seeded.get("/api/stats").json()
    assert stats["unique_products"] == 4
    assert stats["monthly_measured_products"] == 3


# ---------------------------------------------------------------------------
# 서비스 단위 계산
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "reviews_in_window,sample_size,span,covers,expected",
    [
        (82, 120, 45.0, True, 82),      # 실측
        (20, 20, 4.0, False, 150),      # 4일 20건 → 30일 150건
        (7, 7, 7.0, False, 30),         # 7일 7건 → 30일 30건
        (5, 5, 0.5, False, 5),          # 표본 기간이 하루 미만 → 하한값 유지
    ],
)
def test_review_date_math(reviews_in_window, sample_size, span, covers, expected):
    result = monthly_reviews.monthly_from_review_dates(
        reviews_in_window=reviews_in_window,
        sample_size=sample_size,
        sample_span_days=span,
        covers_window=covers,
    )
    assert result is not None
    assert result.count == expected
