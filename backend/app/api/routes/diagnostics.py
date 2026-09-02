"""문제 보고서 — 원격에서 원인을 잡을 수 있도록 서버 상태와 최근 로그를 한 번에 낸다."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.logging import recent_logs
from app.models.category import Category
from app.models.collection_job import CollectionJob
from app.models.product import Product
from app.models.scan import ScanJob, ScanTarget, TargetStatus

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])


@router.get("")
def diagnostics(db: Session = Depends(get_db)) -> dict:
    from app.main import app_version

    counts = {
        "products": int(db.scalar(select(func.count()).select_from(Product)) or 0),
        "products_measured": int(
            db.scalar(select(func.count()).select_from(Product).where(Product.monthly_review_count.isnot(None))) or 0
        ),
        "categories": int(db.scalar(select(func.count()).select_from(Category)) or 0),
        "collection_received": int(db.scalar(select(func.coalesce(func.sum(CollectionJob.total_products), 0))) or 0),
        "scan_jobs": int(db.scalar(select(func.count()).select_from(ScanJob)) or 0),
    }
    jobs = db.scalars(select(ScanJob).order_by(ScanJob.id.desc()).limit(3)).all()
    recent_jobs = []
    for job in jobs:
        failed = db.scalars(
            select(ScanTarget)
            .where(ScanTarget.job_id == job.id, ScanTarget.status == TargetStatus.FAILED)
            .order_by(ScanTarget.id.desc())
            .limit(10)
        ).all()
        done = db.scalars(
            select(ScanTarget)
            .where(ScanTarget.job_id == job.id, ScanTarget.status == TargetStatus.DONE)
            .order_by(ScanTarget.id.desc())
            .limit(10)
        ).all()
        recent_jobs.append({
            "id": job.id,
            "status": job.status,
            "phase": job.phase,
            "category_ids": job.category_ids,
            "pages_per_category": job.pages_per_category,
            "detail_limit": job.detail_limit,
            "conditions": job.conditions,
            "done": [{"label": t.label, "url": t.url, "products": t.product_count} for t in done],
            "failed": [{"label": t.label, "url": t.url, "error": t.error} for t in failed],
        })
    return {"version": app_version(), "counts": counts, "recent_scans": recent_jobs, "log": recent_logs()}
