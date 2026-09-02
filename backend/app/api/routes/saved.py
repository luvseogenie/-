"""보관함 — 골라 둔 상품을 검색과 무관하게 보관한다."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.product import Product
from app.models.saved_product import SavedProduct
from app.schemas.saved import SavedAddRequest, SavedAddResult, SavedMemoUpdate, SavedOut

router = APIRouter(prefix="/api/saved", tags=["saved"])


def _snapshot(product: Product, scan_job_id: int | None) -> SavedProduct:
    revenue = (
        product.monthly_estimated_sales * product.price
        if product.monthly_estimated_sales is not None and product.price is not None
        else None
    )
    return SavedProduct(
        product_id=product.id,
        scan_job_id=scan_job_id if scan_job_id is not None else product.last_scan_job_id,
        category_name=product.category.category_name if product.category else None,
        price=product.price,
        review_count=product.review_count,
        monthly_review_count=product.monthly_review_count,
        monthly_estimated_sales=product.monthly_estimated_sales,
        monthly_revenue=revenue,
        monthly_purchase_count=product.monthly_purchase_count,
        monthly_purchase_text=product.monthly_purchase_text,
    )


@router.get("", response_model=list[SavedOut])
def list_saved(db: Session = Depends(get_db)):
    rows = db.scalars(select(SavedProduct).order_by(SavedProduct.saved_at.desc(), SavedProduct.id.desc())).all()
    for row in rows:
        row.product.saved = True
    return rows


@router.post("", response_model=SavedAddResult)
def add_saved(payload: SavedAddRequest, db: Session = Depends(get_db)):
    existing = set(db.scalars(select(SavedProduct.product_id)).all())
    added = skipped = 0
    for pid in payload.product_ids:  # 같은 id 가 두 번 오면 두 번째는 skipped
        if pid in existing:
            skipped += 1
            continue
        product = db.get(Product, pid)
        if product is None:
            skipped += 1
            continue
        db.add(_snapshot(product, payload.scan_job_id))
        existing.add(pid)
        added += 1
    db.commit()
    return SavedAddResult(added=added, skipped=skipped, total=len(existing))


@router.patch("/{saved_id}", response_model=SavedOut)
def update_memo(saved_id: int, payload: SavedMemoUpdate, db: Session = Depends(get_db)):
    row = db.get(SavedProduct, saved_id)
    if row is None:
        raise HTTPException(status_code=404, detail="보관함 항목을 찾을 수 없습니다.")
    row.memo = (payload.memo or "").strip() or None
    db.commit()
    db.refresh(row)
    row.product.saved = True
    return row


@router.delete("/{saved_id}")
def remove_saved(saved_id: int, db: Session = Depends(get_db)):
    row = db.get(SavedProduct, saved_id)
    if row is None:
        raise HTTPException(status_code=404, detail="보관함 항목을 찾을 수 없습니다.")
    db.delete(row)
    db.commit()
    return {"removed": saved_id}


@router.delete("/by-product/{product_id}")
def remove_by_product(product_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(SavedProduct).where(SavedProduct.product_id == product_id))
    if row is None:
        raise HTTPException(status_code=404, detail="보관되지 않은 상품입니다.")
    db.delete(row)
    db.commit()
    return {"removed": row.id}


COLUMNS = [
    "저장일", "메모", "상품명", "카테고리",
    "저장 당시 30일 리뷰수", "저장 당시 30일 예상판매량", "저장 당시 30일 예상매출(원)",
    "저장 당시 한 달 구매(쿠팡)", "저장 당시 가격(원)",
    "현재 30일 리뷰수", "현재 30일 예상판매량", "현재 30일 예상매출(원)", "현재 가격(원)",
    "상품 ID", "상품 링크",
]


@router.get("/export")
def export_saved(db: Session = Depends(get_db)):
    rows = db.scalars(select(SavedProduct).order_by(SavedProduct.saved_at.desc())).all()
    buf = io.StringIO()
    buf.write("﻿")
    writer = csv.writer(buf)
    writer.writerow(COLUMNS)
    for r in rows:
        p = r.product
        now_revenue = (
            p.monthly_estimated_sales * p.price
            if p.monthly_estimated_sales is not None and p.price is not None
            else None
        )
        writer.writerow([
            r.saved_at.strftime("%Y-%m-%d %H:%M") if r.saved_at else "",
            r.memo or "",
            p.product_name,
            r.category_name or "",
            r.monthly_review_count if r.monthly_review_count is not None else "",
            r.monthly_estimated_sales if r.monthly_estimated_sales is not None else "",
            r.monthly_revenue if r.monthly_revenue is not None else "",
            r.monthly_purchase_text or "",
            r.price if r.price is not None else "",
            p.monthly_review_count if p.monthly_review_count is not None else "",
            p.monthly_estimated_sales if p.monthly_estimated_sales is not None else "",
            now_revenue if now_revenue is not None else "",
            p.price if p.price is not None else "",
            p.product_id,
            p.product_url,
        ])
    filename = f"coupang_saved_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
