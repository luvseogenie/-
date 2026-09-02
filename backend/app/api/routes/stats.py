from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import product_filter_params
from app.db.session import get_db
from app.models.collection_job import CollectionJob
from app.models.product import Product
from app.schemas.stats import StatsOut
from app.services import estimation
from app.services.filtering import ProductFilter

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("", response_model=StatsOut)
def get_stats(
    filters: ProductFilter = Depends(product_filter_params),
    db: Session = Depends(get_db),
):
    # 수집 상품 수: 확장이 감지해 보낸 총 개수(중복 포함)
    collected = db.scalar(select(func.coalesce(func.sum(CollectionJob.total_products), 0))) or 0

    # 중복 제외 상품 수: products 테이블 행 수 (product_id UNIQUE)
    unique_stmt = select(func.count()).select_from(Product)

    scope = []
    if filters.category_ids:
        scope.append(Product.category_id.in_(filters.category_ids))
    if filters.keyword:
        like = f"%{filters.keyword.strip()}%"
        scope.append(or_(Product.product_name.ilike(like), Product.product_id.ilike(like)))
    for clause in scope:
        unique_stmt = unique_stmt.where(clause)
    unique_count = db.scalar(unique_stmt) or 0

    passed_stmt = select(func.count()).select_from(Product)
    for clause in scope:
        passed_stmt = passed_stmt.where(clause)
    expr = filters.condition_expression()
    if expr is not None:
        passed_stmt = passed_stmt.where(expr)
    passed_count = db.scalar(passed_stmt) or 0

    measured_stmt = select(func.count()).select_from(Product).where(
        Product.monthly_review_count.isnot(None)
    )
    for clause in scope:
        measured_stmt = measured_stmt.where(clause)
    measured_count = db.scalar(measured_stmt) or 0

    multiplier = estimation.get_multiplier(db)
    db.commit()

    return StatsOut(
        selected_categories=len(filters.category_ids),
        collected_products=int(collected),
        unique_products=int(unique_count),
        condition_passed_products=int(passed_count),
        monthly_measured_products=int(measured_count),
        review_sales_multiplier=multiplier,
    )
