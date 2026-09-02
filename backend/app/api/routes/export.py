"""엑셀 내보내기.

엑셀에서 바로 열리는 CSV(UTF-8 BOM)로 내려준다. 조건 필터를 그대로 적용한다.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import product_filter_params
from app.db.session import get_db
from app.models.category import Category
from app.models.product import DeliveryType, MonthlyConfidence, Product
from app.services.filtering import ProductFilter, sort_expression
from app.services import scan_service

router = APIRouter(prefix="/api/products", tags=["export"])

COLUMNS = [
    ("판정", "verdict"),
    ("상품명", "product_name"),
    ("카테고리", "category_name"),
    ("30일 리뷰수", "monthly_review_count"),
    ("30일 예상판매량", "monthly_estimated_sales"),
    ("30일 예상매출(원)", "monthly_revenue"),
    ("한 달 구매(쿠팡 표시)", "monthly_purchase"),
    ("가격(원)", "price"),
    ("누적 리뷰수", "review_count"),
    ("누적 예상판매량", "estimated_sales"),
    ("평점", "rating"),
    ("배송", "delivery"),
    ("측정 방식", "monthly_method"),
    ("신뢰도", "monthly_confidence"),
    ("상품 ID", "product_id"),
    ("상품 링크", "product_url"),
    ("최근 수집", "last_collected_at"),
]


@router.get("/export")
def export_csv(
    condition_passed: bool | None = Query(True, description="기본은 조건 통과 상품만"),
    sort: str = Query("monthly_revenue_desc"),
    scan: str | None = Query(None, description="검색 범위: latest = 마지막 검색만, 숫자 = 그 검색 번호"),
    filters: ProductFilter = Depends(product_filter_params),
    db: Session = Depends(get_db),
):
    base = select(Product)
    scan_clause = scan_service.resolve_scan_scope(db, scan)
    if scan_clause is not None:
        base = base.where(scan_clause)
    if filters.category_ids:
        base = base.where(Product.category_id.in_(filters.category_ids))
    if filters.keyword:
        like = f"%{filters.keyword.strip()}%"
        base = base.where(or_(Product.product_name.ilike(like), Product.product_id.ilike(like)))
    expr = filters.condition_expression()
    if condition_passed is True and expr is not None:
        base = base.where(expr)

    rows = db.scalars(base.order_by(*sort_expression(sort))).unique().all()
    categories = {c.id: c.category_name for c in db.scalars(select(Category)).all()}

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([label for label, _ in COLUMNS])

    for p in rows:
        purchase = ""
        if p.monthly_purchase_count is not None:
            purchase = f"{p.monthly_purchase_count:,}{'+' if p.monthly_purchase_is_minimum else ''}{p.monthly_purchase_unit or '명'}"
        # 30일 예상 매출 = 30일 예상 판매량 × 가격 (둘 다 있을 때만)
        revenue = ""
        if p.monthly_estimated_sales is not None and p.price is not None:
            revenue = p.monthly_estimated_sales * p.price
        writer.writerow(
            [
                "조건 통과" if filters.passes(p) else "미달",
                p.product_name,
                categories.get(p.category_id, ""),
                p.price if p.price is not None else "",
                p.review_count,
                p.estimated_sales,
                purchase,
                p.monthly_review_count if p.monthly_review_count is not None else "",
                p.monthly_estimated_sales if p.monthly_estimated_sales is not None else "",
                revenue,
                {"review_dates": "리뷰 날짜", "snapshot_delta": "리뷰 추적"}.get(
                    p.monthly_review_method or "", ""
                ),
                MonthlyConfidence.LABELS.get(p.monthly_review_confidence or "", ""),
                p.rating if p.rating is not None else "",
                DeliveryType.LABELS.get(p.delivery_type or "", ""),
                p.product_id,
                p.product_url,
                p.last_collected_at.strftime("%Y-%m-%d %H:%M") if p.last_collected_at else "",
            ]
        )

    # 엑셀이 한글을 제대로 읽도록 UTF-8 BOM 을 붙인다.
    data = "﻿" + buffer.getvalue()
    filename = f"coupang_sourcing_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        iter([data.encode("utf-8")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
