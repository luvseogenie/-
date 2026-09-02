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
        rating_min=rating_min,
        rating_max=rating_max,
        delivery_types=_split_strs(delivery_types),
        category_ids=_split_ints(category_ids),
        keyword=q,
    )
