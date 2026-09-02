from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.collection_job import CollectionJob, JobStatus
from app.schemas.job import JobCreateRequest, JobCreateResponse, JobOut
from app.services import category_service, product_collector

router = APIRouter(prefix="/api/collection-jobs", tags=["collection-jobs"])


@router.post("", response_model=JobCreateResponse)
def create_job(payload: JobCreateRequest, db: Session = Depends(get_db)):
    """대시보드 「수집 시작」.

    실제 수집은 Chrome 확장이 한다. 여기서는 job을 만들고,
    사용자가 열어야 할 카테고리 URL을 돌려준다.
    """
    job = product_collector.start_job(db)
    urls = category_service.collect_leaf_urls(db, payload.category_ids)
    db.commit()
    db.refresh(job)
    return JobCreateResponse(job=JobOut.model_validate(job), target_urls=urls)


@router.get("/active", response_model=JobOut | None)
def get_active_job(db: Session = Depends(get_db)):
    """확장 프로그램이 현재 진행 중인 job에 자동으로 붙기 위해 호출한다."""
    return product_collector.get_active_job(db)


@router.get("", response_model=list[JobOut])
def list_jobs(limit: int = 20, db: Session = Depends(get_db)):
    stmt = select(CollectionJob).order_by(CollectionJob.id.desc()).limit(limit)
    return list(db.scalars(stmt).all())


@router.post("/{job_id}/finish", response_model=JobOut)
def finish_job(job_id: int, db: Session = Depends(get_db)):
    job = product_collector.finish_job(db, job_id, JobStatus.COMPLETED)
    if job is None:
        raise HTTPException(status_code=404, detail="job을 찾을 수 없습니다.")
    db.commit()
    db.refresh(job)
    return job
