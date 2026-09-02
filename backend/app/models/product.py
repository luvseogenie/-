"""상품 — product_id 기준으로 중복 없이 하나만 유지한다."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class MonthlyReviewMethod:
    """최근 30일 리뷰수를 어떻게 구했는지."""

    REVIEW_DATES = "review_dates"  # 상세 페이지 리뷰 작성일 실측
    SNAPSHOT_DELTA = "snapshot_delta"  # 누적 리뷰수 스냅샷 차분

    ALL = (REVIEW_DATES, SNAPSHOT_DELTA)

    LABELS = {
        REVIEW_DATES: "리뷰 날짜 분석",
        SNAPSHOT_DELTA: "리뷰수 변화 추적",
    }


class DeliveryType:
    """배송 방식 코드. DB에는 문자열로 저장한다(PG 이관 시 enum 변환 용이)."""

    ROCKET = "rocket"  # 로켓배송
    ROCKET_GROWTH = "rocket_growth"  # 로켓그로스
    SELLER = "seller"  # 판매자배송
    UNKNOWN = "unknown"  # DOM에서 판별 불가

    ALL = (ROCKET, ROCKET_GROWTH, SELLER, UNKNOWN)

    LABELS = {
        ROCKET: "로켓배송",
        ROCKET_GROWTH: "로켓그로스",
        SELLER: "판매자배송",
        UNKNOWN: "미확인",
    }


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # 쿠팡 상품 ID. 중복 제거 기준(요구사항 12).
    product_id: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    product_name: Mapped[str] = mapped_column(String(500), nullable=False)
    product_url: Mapped[str] = mapped_column(Text, nullable=False)

    price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    review_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 예상 판매량 = review_count * settings.review_sales_multiplier
    # 실제 판매량이 아니다.
    estimated_sales: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivery_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 조회수: 현재 DOM에서 얻을 수 있는 원천이 없다. 항상 NULL로 둔다.
    # 임의의 숫자를 채워 넣지 않는다(요구사항 13).
    view_count: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)

    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # 마지막 수집 시점의 노출 순위(부가 정보). 없으면 NULL.
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ------------------------------------------------------------------
    # 최근 30일 지표
    #
    # 쿠팡은 "최근 1달 리뷰수"를 화면에 표시하지 않는다. 카드/상세의 리뷰수는
    # 누적값이다. 따라서 아래 값은 두 가지 방법으로 "유도"한 값이며,
    # 유도할 수 없으면 NULL로 둔다. 절대 임의 값을 만들지 않는다.
    #
    #   review_dates   : 상품 상세 페이지에서 실제 리뷰 작성일을 읽어 센 값
    #   snapshot_delta : 누적 리뷰수 스냅샷의 차분으로 구한 값
    # ------------------------------------------------------------------
    monthly_review_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_estimated_sales: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_review_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 실제로 관측한 구간(일). 30일보다 짧으면 30일로 환산한 값이다.
    monthly_review_window_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 표본이 30일 구간을 다 덮지 못해 환산(추정)한 경우 True
    monthly_review_is_extrapolated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    monthly_review_measured_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    first_collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    category: Mapped["object | None"] = relationship("Category", lazy="joined")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Product {self.product_id} {self.product_name[:20]!r}>"
