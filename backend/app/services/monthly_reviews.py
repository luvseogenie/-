"""최근 30일 리뷰수 / 최근 30일 예상 판매량.

쿠팡은 "최근 1달 리뷰수"를 어디에도 표시하지 않는다.
상품 카드와 상세 페이지의 리뷰수는 모두 **누적** 리뷰수다.
따라서 최근 30일 리뷰수는 아래 두 방법 중 하나로 **유도**해야 한다.

  1) review_dates   — 상품 상세 페이지에서 실제 리뷰 작성일을 읽어 30일 이내 개수를 센다.
                      확장 프로그램이 화면에 렌더된 리뷰만 읽는다(자동 크롤링 없음).
                      표본이 30일을 다 덮으면 실측, 못 덮으면 리뷰 속도로 환산(추정)한다.

  2) snapshot_delta — 수집할 때마다 누적 리뷰수를 스냅샷으로 남기고,
                      30일 전 스냅샷과의 차이를 구한다. 구간이 30일보다 짧으면 환산한다.
                      목록 페이지만으로 수천 개 상품에 적용할 수 있다.

두 값이 모두 있으면 실측 구간이 더 긴 쪽(=신뢰도가 높은 쪽)을 쓴다.
어느 쪽도 구할 수 없으면 NULL을 유지한다. 임의 값을 만들지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.product import MonthlyReviewMethod, Product
from app.models.review_snapshot import ReviewSnapshot

logger = get_logger(__name__)

WINDOW_DAYS = 30

# 스냅샷 차분을 신뢰하려면 최소 이만큼의 간격이 필요하다.
# 너무 짧은 구간(예: 2시간)을 30일로 환산하면 오차가 폭발한다.
MIN_SNAPSHOT_WINDOW_DAYS = 1.0

# 리뷰 날짜 표본이 이보다 짧은 구간만 덮으면 환산하지 않는다(표본 부족).
MIN_REVIEW_DATE_WINDOW_DAYS = 1.0


@dataclass(slots=True)
class MonthlyReviewResult:
    """최근 30일 리뷰수 산출 결과."""

    count: int
    method: str
    window_days: float
    is_extrapolated: bool
    measured_at: datetime


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite는 naive datetime을 돌려주므로 UTC로 간주해 맞춘다."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# 1) 스냅샷 차분
# ---------------------------------------------------------------------------
def record_snapshot(
    db: Session, product: Product, review_count: int, source: str | None = None
) -> ReviewSnapshot:
    """수집 시점의 누적 리뷰수를 남긴다."""
    snapshot = ReviewSnapshot(
        product_id=product.id,
        review_count=max(0, int(review_count or 0)),
        captured_at=_now(),
        source=source,
    )
    db.add(snapshot)
    return snapshot


def monthly_from_snapshots(db: Session, product: Product) -> MonthlyReviewResult | None:
    """누적 리뷰수 스냅샷의 차분으로 최근 30일 리뷰수를 구한다.

    - 30일 전 이전의 스냅샷이 있으면 그것을 기준으로 쓴다(실측).
    - 없으면 가장 오래된 스냅샷을 쓰고 30일로 환산한다(추정).
    - 스냅샷이 하나뿐이거나 간격이 너무 짧으면 None.
    """
    now = _now()
    rows = db.scalars(
        select(ReviewSnapshot)
        .where(ReviewSnapshot.product_id == product.id)
        .order_by(ReviewSnapshot.captured_at.asc())
    ).all()
    if len(rows) < 2:
        return None

    latest = rows[-1]
    latest_at = _as_utc(latest.captured_at)
    if latest_at is None:
        return None

    cutoff = now - timedelta(days=WINDOW_DAYS)

    # 30일 경계 바로 이전(또는 그 시점)의 스냅샷 — 있으면 정확한 30일 구간을 만든다.
    baseline = None
    for row in rows[:-1]:
        captured = _as_utc(row.captured_at)
        if captured is not None and captured <= cutoff:
            baseline = row
    exact = baseline is not None
    if baseline is None:
        baseline = rows[0]

    baseline_at = _as_utc(baseline.captured_at)
    if baseline_at is None:
        return None

    window_days = (latest_at - baseline_at).total_seconds() / 86400
    if window_days < MIN_SNAPSHOT_WINDOW_DAYS:
        return None

    delta = latest.review_count - baseline.review_count
    if delta < 0:
        # 리뷰가 줄어드는 경우(삭제 등)는 0으로 본다. 음수 판매량은 만들지 않는다.
        logger.info(
            "리뷰수 감소 감지 product_id=%s %d → %d",
            product.product_id, baseline.review_count, latest.review_count,
        )
        delta = 0

    if exact and window_days >= WINDOW_DAYS:
        # 30일보다 긴 구간이면 일평균으로 30일치를 맞춘다.
        count = round(delta * WINDOW_DAYS / window_days)
        is_extrapolated = False
        effective_window = WINDOW_DAYS
    else:
        count = round(delta * WINDOW_DAYS / window_days)
        is_extrapolated = True
        effective_window = window_days

    return MonthlyReviewResult(
        count=int(max(0, count)),
        method=MonthlyReviewMethod.SNAPSHOT_DELTA,
        window_days=round(effective_window, 2),
        is_extrapolated=is_extrapolated,
        measured_at=latest_at,
    )


# ---------------------------------------------------------------------------
# 2) 리뷰 작성일 분석 (확장 프로그램이 상세 페이지에서 읽어 보낸 결과)
# ---------------------------------------------------------------------------
def monthly_from_review_dates(
    *,
    reviews_in_window: int,
    sample_size: int,
    sample_span_days: float | None,
    covers_window: bool,
) -> MonthlyReviewResult | None:
    """확장이 읽은 리뷰 작성일 정보로 최근 30일 리뷰수를 만든다.

    covers_window=True  → 표본이 30일 경계를 넘어섰다. reviews_in_window가 곧 실측값.
    covers_window=False → 표본 전체가 30일 안에 있다. 더 오래된 리뷰를 못 봤다는 뜻이므로
                          리뷰 속도(표본 수 ÷ 표본 기간)로 30일치를 환산한다.
    """
    if sample_size <= 0:
        return None

    now = _now()

    if covers_window:
        return MonthlyReviewResult(
            count=int(max(0, reviews_in_window)),
            method=MonthlyReviewMethod.REVIEW_DATES,
            window_days=float(WINDOW_DAYS),
            is_extrapolated=False,
            measured_at=now,
        )

    if sample_span_days is None or sample_span_days < MIN_REVIEW_DATE_WINDOW_DAYS:
        # 표본 기간이 하루도 안 되면 환산 오차가 너무 크다.
        # 대신 "적어도 이만큼은 있다"는 실측 하한값을 그대로 쓴다.
        if reviews_in_window <= 0:
            return None
        return MonthlyReviewResult(
            count=int(reviews_in_window),
            method=MonthlyReviewMethod.REVIEW_DATES,
            window_days=round(float(sample_span_days or 0), 2),
            is_extrapolated=True,
            measured_at=now,
        )

    per_day = sample_size / sample_span_days
    return MonthlyReviewResult(
        count=int(max(reviews_in_window, round(per_day * WINDOW_DAYS))),
        method=MonthlyReviewMethod.REVIEW_DATES,
        window_days=round(float(sample_span_days), 2),
        is_extrapolated=True,
        measured_at=now,
    )


# ---------------------------------------------------------------------------
# 저장
# ---------------------------------------------------------------------------
def _quality(result: MonthlyReviewResult) -> tuple[int, float]:
    """어느 결과를 채택할지 비교하는 기준. 클수록 좋다."""
    return (0 if result.is_extrapolated else 1, result.window_days)


def apply_result(
    product: Product, result: MonthlyReviewResult | None, multiplier: int
) -> bool:
    """산출 결과를 상품에 반영한다. 더 신뢰도 높은 기존 값이 있으면 유지한다."""
    if result is None:
        return False

    if product.monthly_review_method is not None and product.monthly_review_measured_at:
        current = MonthlyReviewResult(
            count=product.monthly_review_count or 0,
            method=product.monthly_review_method,
            window_days=product.monthly_review_window_days or 0.0,
            is_extrapolated=product.monthly_review_is_extrapolated,
            measured_at=_as_utc(product.monthly_review_measured_at) or _now(),
        )
        # 같은 방법이면 항상 최신 값으로 갱신하고,
        # 다른 방법이면 신뢰도가 높은 쪽을 남긴다.
        if current.method != result.method and _quality(current) > _quality(result):
            return False

    product.monthly_review_count = result.count
    product.monthly_estimated_sales = result.count * max(0, int(multiplier))
    product.monthly_review_method = result.method
    product.monthly_review_window_days = result.window_days
    product.monthly_review_is_extrapolated = result.is_extrapolated
    product.monthly_review_measured_at = result.measured_at
    return True


def refresh_from_snapshots(db: Session, product: Product, multiplier: int) -> bool:
    """수집 직후 호출: 스냅샷 차분으로 최근 30일 값을 갱신한다."""
    return apply_result(product, monthly_from_snapshots(db, product), multiplier)


def recalculate_monthly_sales(db: Session, multiplier: int) -> int:
    """배수가 바뀌면 최근 30일 예상 판매량도 다시 계산한다."""
    products = db.scalars(
        select(Product).where(Product.monthly_review_count.isnot(None))
    ).all()
    for product in products:
        product.monthly_estimated_sales = (product.monthly_review_count or 0) * multiplier
    return len(products)
