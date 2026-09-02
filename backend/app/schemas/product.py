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


class ReviewDateAnalysis(BaseModel):
    """확장 프로그램이 상품 상세 페이지에서 읽은 리뷰 작성일 분석 결과.

    쿠팡은 최근 1달 리뷰수를 표시하지 않으므로, 화면에 렌더된 리뷰의
    작성일을 직접 세어 보낸다.
    """

    product_id: str
    product_url: str | None = None
    # 30일 이내로 확인된 리뷰 개수
    reviews_in_window: int = Field(ge=0)
    # 날짜를 읽어낸 전체 리뷰 개수(표본 크기)
    sample_size: int = Field(ge=0)
    # 표본의 가장 오래된 리뷰 ~ 가장 최근 리뷰 사이 일수
    sample_span_days: float | None = None
    # 표본이 30일 경계를 넘었는지(= 30일보다 오래된 리뷰를 봤는지)
    covers_window: bool = False
    # 참고용 원본 날짜(최대 200개)
    newest_review_date: str | None = None
    oldest_review_date: str | None = None
    # 상세 페이지에서 읽은 누적 리뷰수(있으면 스냅샷으로도 남긴다)
    total_review_count: int | None = None


class ReviewDateAnalysisResult(BaseModel):
    product_id: str
    applied: bool
    monthly_review_count: int | None = None
    monthly_estimated_sales: int | None = None
    monthly_review_method: str | None = None
    monthly_review_window_days: float | None = None
    monthly_review_is_extrapolated: bool = False
    message: str


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

    # 최근 30일 지표. 유도할 수 없으면 None (임의 값 생성 금지).
    monthly_review_count: int | None = None
    monthly_estimated_sales: int | None = None
    monthly_review_method: str | None = None
    monthly_review_window_days: float | None = None
    monthly_review_is_extrapolated: bool = False
    monthly_review_measured_at: datetime | None = None

    first_collected_at: datetime
    last_collected_at: datetime
    condition_passed: bool = False


class ProductListResponse(BaseModel):
    items: list[ProductOut]
    total: int
    page: int
    page_size: int
