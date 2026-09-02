from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class JobCreateRequest(BaseModel):
    category_ids: list[int] = Field(default_factory=list)


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    started_at: datetime
    finished_at: datetime | None
    total_products: int
    collected_products: int
    error_message: str | None = None


class JobCreateResponse(BaseModel):
    job: JobOut
    # 사용자가 Chrome에서 열어야 할 카테고리 URL 목록
    target_urls: list[str] = Field(default_factory=list)
