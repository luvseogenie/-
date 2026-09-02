"""누적 리뷰수 스냅샷.

수집할 때마다 (상품, 리뷰수, 시각)을 한 줄씩 남긴다.
나중에 두 시점의 차이를 빼면 그 구간에 실제로 늘어난 리뷰수를 알 수 있다.
→ 최근 30일 리뷰수를 "추정"이 아니라 "실측"할 수 있는 유일한 확장 가능한 방법이다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ReviewSnapshot(Base):
    __tablename__ = "review_snapshots"
    __table_args__ = (
        Index("ix_review_snapshots_product_captured", "product_id", "captured_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    review_count: Mapped[int] = mapped_column(Integer, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # 어디에서 읽은 값인지: list(목록/검색) / detail(상품 상세)
    source: Mapped[str | None] = mapped_column(String(16), nullable=True)
