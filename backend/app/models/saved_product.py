"""보관함 — 사용자가 골라 둔 상품.

검색을 새로 해도 사라지지 않는다. 저장 시점의 핵심 지표를 함께 적어 두어,
나중에 다시 측정돼 값이 바뀌어도 "그때 왜 골랐는지"가 남는다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class SavedProduct(Base):
    __tablename__ = "saved_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 어느 검색에서 골랐는지
    scan_job_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # 저장 시점 스냅샷 (없던 값은 None 그대로)
    price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    review_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_review_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_estimated_sales: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_revenue: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_purchase_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_purchase_text: Mapped[str | None] = mapped_column(String(200), nullable=True)

    product: Mapped["object"] = relationship("Product", lazy="joined")
