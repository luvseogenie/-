from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ScanConditions(BaseModel):
    """2단계 대상을 고를 때 쓰는 1차 조건 (목록 페이지에서 알 수 있는 값만)."""

    price_min: int | None = None
    price_max: int | None = None
    review_min: int | None = None
    review_max: int | None = None
    rating_min: float | None = None
    rating_max: float | None = None
    delivery_types: list[str] = Field(default_factory=list)


class ScanStartRequest(BaseModel):
    category_ids: list[int] = Field(default_factory=list)
    # 카테고리마다 훑을 목록 페이지 수 (판매량순이라 앞쪽이 중요하다)
    pages_per_category: int = Field(default=1, ge=1, le=20)
    sorter: str = "saleCountDesc"
    list_size: int = Field(default=120, ge=1, le=120)
    conditions: ScanConditions = Field(default_factory=ScanConditions)
    # 2단계에서 상세를 확인할 최대 상품 수 (0이면 2단계 생략)
    detail_limit: int = Field(default=50, ge=0, le=500)


class ScanTargetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: int
    kind: str
    url: str
    label: str | None
    page: int | None
    position: int
    status: str
    attempts: int


class ScanTargetDone(BaseModel):
    product_count: int | None = None
    error: str | None = None


class ScanPhaseProgress(BaseModel):
    total: int
    done: int
    failed: int
    pending: int


class ScanStatusOut(BaseModel):
    job_id: int
    status: str
    phase: str
    list: ScanPhaseProgress
    detail: ScanPhaseProgress
    total: int
    done: int
    failed: int
    current_label: str | None
    started_at: datetime
    finished_at: datetime | None


class ScanStartResponse(BaseModel):
    job_id: int
    list_targets: int
    message: str
