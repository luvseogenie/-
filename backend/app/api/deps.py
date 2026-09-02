"""FastAPI 의존성."""

from __future__ import annotations

from fastapi import Query

from app.db.session import get_db  # noqa: F401  (라우터에서 재수출)
from app.services.filtering import ProductFilter


def _split_ints(raw: str | None) -> list[int]:
    if not raw:
        return []
    out: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if part.isdigit():
            out.append(int(part))
    return out


def _split_strs(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


def product_filter_params(
    price_min: int | None = Query(None, ge=0, description="판매가격 최소"),
    price_max: int | None = Query(None, ge=0, description="판매가격 최대"),
    review_min: int | None = Query(None, ge=0, description="리뷰수 최소"),
    review_max: int | None = Query(None, ge=0, description="리뷰수 최대"),
    sales_min: int | None = Query(None, ge=0, description="예상 판매량 최소"),
    sales_max: int | None = Query(None, ge=0, description="예상 판매량 최대"),
    monthly_sales_min: int | None = Query(None, ge=0, description="최근 30일 예상 판매량 최소"),
    monthly_sales_max: int | None = Query(None, ge=0, description="최근 30일 예상 판매량 최대"),
    monthly_review_min: int | None = Query(None, ge=0, description="최근 30일 리뷰수 최소"),
    monthly_review_max: int | None = Query(None, ge=0, description="최근 30일 리뷰수 최대"),
    monthly_min: int | None = Query(
        None, ge=0, description="월 판매량 하한: 쿠팡 '한 달간 N명 구매' 문구 또는 30일 예상 판매량 중 하나가 넘으면 통과"
    ),
    purchase_min: int | None = Query(
        None, ge=0, description="쿠팡 월간 구매자 수 최소 (한 달간 N명 이상 구매)"
    ),
    purchase_max: int | None = Query(None, ge=0, description="쿠팡 월간 구매자 수 최대"),
    min_confidence: str | None = Query(
        None,
        description="최근 30일 값 신뢰도 하한: low|medium|high (표본 부족 값 제외용)",
    ),
    rating_min: float | None = Query(None, ge=0, le=5, description="평점 최소"),
    rating_max: float | None = Query(None, ge=0, le=5, description="평점 최대"),
    delivery_types: str | None = Query(
        None,
        description="쉼표 구분. rocket,rocket_growth,seller. 비우면 전체",
    ),
    category_ids: str | None = Query(None, description="쉼표 구분 카테고리 id"),
    q: str | None = Query(None, description="상품명 검색어"),
) -> ProductFilter:
    return ProductFilter(
        price_min=price_min,
        price_max=price_max,
        review_min=review_min,
        review_max=review_max,
        sales_min=sales_min,
        sales_max=sales_max,
        monthly_sales_min=monthly_sales_min,
        monthly_sales_max=monthly_sales_max,
        monthly_review_min=monthly_review_min,
        monthly_review_max=monthly_review_max,
        monthly_min=monthly_min,
        purchase_min=purchase_min,
        purchase_max=purchase_max,
        min_confidence=min_confidence if min_confidence in {"low", "medium", "high"} else None,
        rating_min=rating_min,
        rating_max=rating_max,
        delivery_types=_split_strs(delivery_types),
        category_ids=_split_ints(category_ids),
        keyword=q,
    )
