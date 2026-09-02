"""수집 작업 이력."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class JobStatus:
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

    ALL = (RUNNING, COMPLETED, FAILED)


class CollectionJob(Base, TimestampMixin):
    __tablename__ = "collection_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default=JobStatus.RUNNING, index=True
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # 확장 프로그램이 페이지에서 감지해 보낸 총 개수(중복 포함)
    total_products: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 실제로 DB에 저장(신규+갱신)된 개수
    collected_products: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 실패 원인 기록용(개발 원칙 18)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
