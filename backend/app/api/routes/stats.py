from __future__ import annotations

from dataclasses import replace

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import product_filter_params
from app.db.session import get_db
from app.models.collection_job import CollectionJob
from app.models.product import Product
from app.schemas.stats import StatsOut
from app.services import estimation
from app.services.filtering import ProductFilter
from app.services.filtering import MONTHLY_REVENUE

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("", response_model=StatsOut)
def get_stats(
    has_purchase: bool | None = Query(
        None, description="쿠팡 구매 문구 확보 여부로 범위 제한"
    ),
    measured: bool | None = Query(None, description="최근 30일 리뷰수 측정 여부로 범위 제한"),
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
    if has_purchase is True:
        scope.append(Product.monthly_purchase_count.isnot(None))
    elif has_purchase is False:
        scope.append(Product.monthly_purchase_count.is_(None))
    if measured is True:
        scope.append(Product.monthly_review_count.isnot(None))
    elif measured is False:
        scope.append(Product.monthly_review_count.is_(None))
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

    # 통과 상품의 30일 예상매출 합계 (30일 예상 판매량 × 가격, 측정된 상품만 더해진다)
    revenue_stmt = select(func.coalesce(func.sum(MONTHLY_REVENUE), 0))
    for clause in scope:
        revenue_stmt = revenue_stmt.where(clause)
    if expr is not None:
        revenue_stmt = revenue_stmt.where(expr)
    passed_revenue = db.scalar(revenue_stmt) or 0

    measured_stmt = select(func.count()).select_from(Product).where(
        Product.monthly_review_count.isnot(None)
    )
    for clause in scope:
        measured_stmt = measured_stmt.where(clause)
    measured_count = db.scalar(measured_stmt) or 0

    labeled_stmt = select(func.count()).select_from(Product).where(
        Product.monthly_purchase_count.isnot(None)
    )
    for clause in scope:
        labeled_stmt = labeled_stmt.where(clause)
    labeled_count = db.scalar(labeled_stmt) or 0

    # 2단계 작업량: 구매 문구를 제외한 나머지 조건은 통과했는데 문구가 아직 없는 상품
    pending_stmt = select(func.count()).select_from(Product).where(
        Product.monthly_purchase_count.is_(None)
    )
    for clause in scope:
        pending_stmt = pending_stmt.where(clause)
    pending_filters = replace(filters, purchase_min=None, purchase_max=None)
    pending_expr = pending_filters.condition_expression()
    if pending_expr is not None:
        pending_stmt = pending_stmt.where(pending_expr)
    pending_count = db.scalar(pending_stmt) or 0

    # 30일 리뷰수를 아직 못 잰 상품 중 1차 조건(30일·구매 문구 제외)은 통과한 것 = 2단계 대기
    monthly_pending_stmt = select(func.count()).select_from(Product).where(
        Product.monthly_review_count.is_(None)
    )
    for clause in scope:
        monthly_pending_stmt = monthly_pending_stmt.where(clause)
    first_stage = replace(
        filters,
        purchase_min=None, purchase_max=None,
        monthly_review_min=None, monthly_review_max=None,
        monthly_sales_min=None, monthly_sales_max=None,
        min_confidence=None,
    )
    first_expr = first_stage.condition_expression()
    if first_expr is not None:
        monthly_pending_stmt = monthly_pending_stmt.where(first_expr)
    monthly_pending_count = db.scalar(monthly_pending_stmt) or 0

    multiplier = estimation.get_multiplier(db)
    db.commit()

    return StatsOut(
        selected_categories=len(filters.category_ids),
        collected_products=int(collected),
        unique_products=int(unique_count),
        condition_passed_products=int(passed_count),
        monthly_measured_products=int(measured_count),
        purchase_labeled_products=int(labeled_count),
        purchase_pending_products=int(pending_count),
        monthly_pending_products=int(monthly_pending_count),
        passed_monthly_revenue=int(passed_revenue),
        review_sales_multiplier=multiplier,
    )
