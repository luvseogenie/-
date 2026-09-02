from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CollectedProduct(BaseModel):
    """확장 프로그램이 DOM에서 실제로 읽어낸 값.

    DOM에 없던 값은 None으로 온다. 백엔드는 None을 임의 값으로 채우지 않는다.
    """

    product_id: str
    product_name: str
    product_url: str
    price: int | None = None
    review_count: int = 0
    rating: float | None = None
    delivery_type: str | None = None
    thumbnail_url: str | None = None
    rank: int | None = None
    # 조회수 원천이 확보되면 여기로 들어온다. 지금은 항상 None.
    view_count: int | None = None


class CollectRequest(BaseModel):
    source_url: str | None = None
    page_type: str | None = None  # category / search / list / product
    category_code: str | None = None
    category_name: str | None = None
    job_id: int | None = None
    products: list[CollectedProduct] = Field(default_factory=list)
    # 확장에서 파싱 실패한 카드 수와 사유(로그 목적)
    skipped: int = 0
    parse_errors: list[str] = Field(default_factory=list)


class CollectResult(BaseModel):
    job_id: int | None = None
    received: int
    inserted: int
    updated: int
    duplicates: int  # 같은 요청 안에서 product_id가 중복된 개수
    skipped: int
    saved: int
    errors: list[str] = Field(default_factory=list)


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: str
    product_name: str
    product_url: str
    price: int | None
    review_count: int
    estimated_sales: int
    rating: float | None
    delivery_type: str | None
    thumbnail_url: str | None
    view_count: int | None
    category_id: int | None
    category_name: str | None = None
    rank: int | None
    first_collected_at: datetime
    last_collected_at: datetime
    condition_passed: bool = False


class ProductListResponse(BaseModel):
    items: list[ProductOut]
    total: int
    page: int
    page_size: int
