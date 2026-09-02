from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.product import ProductOut


class SavedOut(BaseModel):
    """보관함 한 줄 — 저장 시점 스냅샷 + 현재 상품 값."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    saved_at: datetime
    memo: str | None
    scan_job_id: int | None
    category_name: str | None
    price: int | None
    review_count: int | None
    monthly_review_count: int | None
    monthly_estimated_sales: int | None
    monthly_revenue: int | None
    monthly_purchase_count: int | None
    monthly_purchase_text: str | None
    product: ProductOut


class SavedAddRequest(BaseModel):
    product_ids: list[int] = Field(default_factory=list)
    scan_job_id: int | None = None


class SavedAddResult(BaseModel):
    added: int
    skipped: int
    total: int


class SavedMemoUpdate(BaseModel):
    memo: str | None = None
