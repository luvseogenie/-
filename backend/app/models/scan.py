"""자동 스캔 작업.

카테고리를 고르고 시작 버튼 한 번을 누르면, 확장 프로그램이
아래 대상들을 순서대로 방문해 수집한다. 사용자는 클릭하지 않는다.

  1단계(list)   선택한 카테고리의 목록 페이지들
  2단계(detail) 1차 조건을 통과한 상품의 상세 페이지들
                → "한 달간 N명 구매" 문구와 최근 30일 리뷰수를 여기서 얻는다
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ScanStatus:
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    STOPPED = "stopped"

    ALL = (RUNNING, PAUSED, COMPLETED, STOPPED)


class TargetKind:
    LIST = "list"  # 카테고리 목록 페이지
    DETAIL = "detail"  # 상품 상세 페이지

    ALL = (LIST, DETAIL)


class TargetStatus:
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    FAILED = "failed"

    ALL = (PENDING, IN_PROGRESS, DONE, FAILED)


class ScanJob(Base, TimestampMixin):
    """소싱 한 번(= 시작 버튼 한 번)에 해당한다."""

    __tablename__ = "scan_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=ScanStatus.RUNNING, index=True
    )
    # 현재 진행 중인 단계 (list → detail)
    phase: Mapped[str] = mapped_column(String(16), nullable=False, default=TargetKind.LIST)

    # 시작할 때의 설정 (2단계 대상을 고를 때 다시 쓴다)
    category_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    pages_per_category: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    sorter: Mapped[str] = mapped_column(String(32), nullable=False, default="saleCountDesc")
    list_size: Mapped[int] = mapped_column(Integer, nullable=False, default=120)

    # 1차 조건 (2단계 대상 선정에 쓴다). JSON 문자열.
    conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 2단계에서 상세를 확인할 최대 상품 수
    detail_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    # 2단계 대상을 이미 만들었는지
    detail_prepared: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ScanTarget(Base):
    """스캔이 방문할 페이지 한 곳."""

    __tablename__ = "scan_targets"
    __table_args__ = (Index("ix_scan_targets_job_status", "job_id", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("scan_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default=TargetKind.LIST)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str | None] = mapped_column(String(300), nullable=True)

    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 순서대로 처리하기 위한 정렬 키
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=TargetStatus.PENDING, index=True
    )
    product_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
