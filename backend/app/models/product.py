"""상품 — product_id 기준으로 중복 없이 하나만 유지한다."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


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

    first_collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    category: Mapped["object | None"] = relationship("Category", lazy="joined")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Product {self.product_id} {self.product_name[:20]!r}>"
