from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import product_filter_params
from app.db.session import get_db
from app.models.category import Category
from app.models.product import Product
from app.schemas.product import (
    CollectRequest,
    CollectResult,
    ProductListResponse,
    ProductOut,
)
from app.services import product_collector
from app.services.filtering import ProductFilter, sort_expression

router = APIRouter(prefix="/api/products", tags=["products"])


@router.post("/collect", response_model=CollectResult)
def collect(payload: CollectRequest, db: Session = Depends(get_db)):
    """Chrome 확장이 현재 페이지에서 읽은 상품을 저장한다."""
    result = product_collector.collect_products(db, payload)
    db.commit()
    return result


@router.get("", response_model=ProductListResponse)
def list_products(
    condition_passed: bool | None = Query(
        None, description="true면 조건을 통과한 상품만"
    ),
    sort: str = Query("sales_desc", description="price_desc|price_asc|review_desc|review_asc|sales_desc|sales_asc|rating_desc|rating_asc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    filters: ProductFilter = Depends(product_filter_params),
    db: Session = Depends(get_db),
):
    base = select(Product)

    # 조회 범위 제한(카테고리/검색어)은 조건 판정과 별개다.
    scope = []
    if filters.category_ids:
        scope.append(Product.category_id.in_(filters.category_ids))
    if filters.keyword:
        like = f"%{filters.keyword.strip()}%"
        scope.append(or_(Product.product_name.ilike(like), Product.product_id.ilike(like)))
    for clause in scope:
        base = base.where(clause)

    condition_expr = filters.condition_expression()
    if condition_passed is True and condition_expr is not None:
        base = base.where(condition_expr)
    elif condition_passed is False and condition_expr is not None:
        base = base.where(~condition_expr)

    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    stmt = base.order_by(*sort_expression(sort)).offset((page - 1) * page_size).limit(page_size)
    rows = db.scalars(stmt).unique().all()

    category_names = {
        c.id: c.category_name for c in db.scalars(select(Category)).all()
    }

    items = []
    for product in rows:
        item = ProductOut.model_validate(product)
        item.category_name = category_names.get(product.category_id)
        item.condition_passed = filters.passes(product)
        items.append(item)

    return ProductListResponse(items=items, total=int(total), page=page, page_size=page_size)
