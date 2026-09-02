from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
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
    ReviewDateAnalysis,
    ReviewDateAnalysisResult,
)
from app.services import estimation, monthly_reviews, product_collector
from app.services.filtering import ProductFilter, sort_expression

router = APIRouter(prefix="/api/products", tags=["products"])


@router.post("/collect", response_model=CollectResult)
def collect(payload: CollectRequest, db: Session = Depends(get_db)):
    """Chrome 확장이 현재 페이지에서 읽은 상품을 저장한다."""
    result = product_collector.collect_products(db, payload)
    db.commit()
    return result


@router.post("/review-dates", response_model=ReviewDateAnalysisResult)
def submit_review_dates(payload: ReviewDateAnalysis, db: Session = Depends(get_db)):
    """확장 프로그램이 상품 상세 페이지에서 읽은 리뷰 작성일 분석 결과를 받는다.

    쿠팡은 최근 1달 리뷰수를 표시하지 않으므로, 화면에 렌더된 리뷰의 작성일을
    직접 세어 최근 30일 리뷰수를 구한다.
    """
    product = db.scalar(select(Product).where(Product.product_id == payload.product_id))
    if product is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "먼저 이 상품을 수집해야 합니다. "
                "목록 페이지에서 수집하거나 상품 상세 페이지에서 [현재 페이지 수집]을 눌러주세요."
            ),
        )

    multiplier = estimation.get_multiplier(db)

    # 상세 페이지에서 읽은 누적 리뷰수도 스냅샷으로 남긴다(차분 정확도 향상).
    if payload.total_review_count is not None:
        product.review_count = payload.total_review_count
        product.estimated_sales = payload.total_review_count * multiplier
        monthly_reviews.record_snapshot(db, product, payload.total_review_count, source="detail")
        db.flush()

    result = monthly_reviews.monthly_from_review_dates(
        reviews_in_window=payload.reviews_in_window,
        sample_size=payload.sample_size,
        sample_span_days=payload.sample_span_days,
        covers_window=payload.covers_window,
    )
    applied = monthly_reviews.apply_result(product, result, multiplier)
    db.commit()
    db.refresh(product)

    if result is None:
        message = "리뷰 날짜를 하나도 읽지 못했습니다. 리뷰 영역이 화면에 표시되어 있는지 확인하세요."
    elif not applied:
        message = "이미 더 신뢰도 높은 측정값이 있어 기존 값을 유지했습니다."
    elif result.is_extrapolated:
        message = (
            f"표본 {payload.sample_size}건이 {result.window_days}일치라 30일로 환산했습니다(추정). "
            "리뷰를 더 불러온 뒤 다시 분석하면 정확해집니다."
        )
    else:
        message = f"최근 30일 리뷰 {result.count}건을 실측했습니다."

    return ReviewDateAnalysisResult(
        product_id=product.product_id,
        applied=applied,
        monthly_review_count=product.monthly_review_count,
        monthly_estimated_sales=product.monthly_estimated_sales,
        monthly_review_method=product.monthly_review_method,
        monthly_review_window_days=product.monthly_review_window_days,
        monthly_review_is_extrapolated=product.monthly_review_is_extrapolated,
        message=message,
    )


@router.get("", response_model=ProductListResponse)
def list_products(
    condition_passed: bool | None = Query(
        None, description="true면 조건을 통과한 상품만"
    ),
    sort: str = Query(
        "sales_desc",
        description=(
            "price_desc|price_asc|review_desc|review_asc|sales_desc|sales_asc|"
            "monthly_sales_desc|monthly_sales_asc|monthly_review_desc|monthly_review_asc|"
            "rating_desc|rating_asc|collected_desc|collected_asc"
        ),
    ),
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
