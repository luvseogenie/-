"""설정 — id=1 싱글턴 행."""

from __future__ import annotations

from sqlalchemy import Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

SETTINGS_ID = 1


class Setting(Base, TimestampMixin):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=SETTINGS_ID)

    # 예상 판매량 배수. 하드코딩 금지 — 사용자가 화면에서 바꾼다.
    review_sales_multiplier: Mapped[int] = mapped_column(
        Integer, nullable=False, default=20
    )
