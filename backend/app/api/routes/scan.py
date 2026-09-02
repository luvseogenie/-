"""자동 스캔 API.

대시보드가 [소싱 시작]으로 작업을 만들고, 확장 프로그램이 next → done 을
반복하며 대상을 처리한다. 대시보드는 status 를 폴링해 진행률을 보여준다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.scan import ScanStatus
from app.schemas.scan import (
    ScanStartRequest,
    ScanStartResponse,
    ScanStatusOut,
    ScanTargetDone,
    ScanTargetOut,
)
from app.services import scan_service

router = APIRouter(prefix="/api/scan", tags=["scan"])


@router.post("/start", response_model=ScanStartResponse)
def start(payload: ScanStartRequest, db: Session = Depends(get_db)):
    if not payload.category_ids:
        raise HTTPException(status_code=400, detail="카테고리를 하나 이상 선택하세요.")
    job, count = scan_service.start_scan(
        db,
        category_ids=payload.category_ids,
        pages_per_category=payload.pages_per_category,
        sorter=payload.sorter,
        list_size=payload.list_size,
        conditions=payload.conditions.model_dump(),
        detail_limit=payload.detail_limit,
    )
    if count == 0:
        job.status = ScanStatus.STOPPED
        db.commit()
        raise HTTPException(
            status_code=400,
            detail="선택한 카테고리에 훑을 페이지가 없습니다. 카테고리 코드가 있는지 확인하세요.",
        )
    db.commit()
    return ScanStartResponse(
        job_id=job.id,
        list_targets=count,
        message=f"목록 {count}페이지를 순서대로 수집합니다. 확장 프로그램에서 [자동 수집 시작]을 누르세요.",
    )


@router.get("/next", response_model=ScanTargetOut | None)
def next_target(db: Session = Depends(get_db)):
    """확장 프로그램이 다음 방문 대상을 가져간다. 없으면 null."""
    target = scan_service.next_target(db)
    db.commit()
    return target


@router.post("/targets/{target_id}/done", response_model=ScanTargetOut)
def finish(target_id: int, payload: ScanTargetDone, db: Session = Depends(get_db)):
    target = scan_service.finish_target(
        db,
        target_id,
        product_count=payload.product_count,
        error=payload.error,
        discovered_children=[c.model_dump() for c in payload.discovered_children],
    )
    if target is None:
        raise HTTPException(status_code=404, detail="대상을 찾을 수 없습니다.")
    db.commit()
    return target


@router.get("/status", response_model=ScanStatusOut | None)
def status(db: Session = Depends(get_db)):
    job = scan_service.active_job(db)
    if job is None:
        # 가장 최근 끝난 작업이라도 보여준다.
        from sqlalchemy import select

        from app.models.scan import ScanJob

        job = db.scalar(select(ScanJob).order_by(ScanJob.id.desc()).limit(1))
        if job is None:
            return None
    return scan_service.job_status(db, job)


@router.post("/pause", response_model=ScanStatusOut | None)
def pause(db: Session = Depends(get_db)):
    job = scan_service.set_status(db, ScanStatus.PAUSED)
    db.commit()
    return scan_service.job_status(db, job) if job else None


@router.post("/resume", response_model=ScanStatusOut | None)
def resume(db: Session = Depends(get_db)):
    job = scan_service.set_status(db, ScanStatus.RUNNING)
    db.commit()
    return scan_service.job_status(db, job) if job else None


@router.post("/stop", response_model=ScanStatusOut | None)
def stop(db: Session = Depends(get_db)):
    job = scan_service.set_status(db, ScanStatus.STOPPED)
    db.commit()
    return scan_service.job_status(db, job) if job else None
