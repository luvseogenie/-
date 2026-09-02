"""자동 스캔 서비스.

사용자가 카테고리를 고르고 시작 버튼을 한 번 누르면, 방문할 페이지 목록을
만들어 두고 확장 프로그램이 하나씩 가져가 처리한다.

  1단계(list)   선택한 카테고리(하위 포함)의 목록 페이지
  2단계(detail) 1차 조건을 통과했지만 아직 상세를 확인하지 않은 상품

2단계가 필요한 이유: "한 달간 N명 구매" 문구와 리뷰 작성일은 상품 상세
페이지에만 있어서, 목록만 수집해서는 최근 30일 지표를 구할 수 없다.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.category import Category
from app.models.product import Product
from app.models.scan import ScanJob, ScanStatus, ScanTarget, TargetKind, TargetStatus
from app.services.filtering import ProductFilter

logger = get_logger(__name__)

COUPANG_CATEGORY_URL = "https://www.coupang.com/np/categories/{code}"

# 쿠팡 목록 정렬. 판매량순으로 훑으면 잘 팔리는 상품이 앞에 온다.
DEFAULT_SORTER = "saleCountDesc"
DEFAULT_LIST_SIZE = 120
MAX_PAGES = 20
MAX_DETAIL = 500


def build_list_url(code: str, page: int, sorter: str, list_size: int) -> str:
    """카테고리 목록 페이지 주소를 만든다."""
    base = COUPANG_CATEGORY_URL.format(code=code)
    params = [f"listSize={list_size}", f"sorter={sorter}"]
    if page > 1:
        params.append(f"page={page}")
    return f"{base}?{'&'.join(params)}"


def _leaf_categories(db: Session, category_ids: list[int]) -> list[Category]:
    """선택한 카테고리와 그 하위의 최하위 카테고리들을 모은다.

    사용자가 상위 카테고리 하나만 체크해도 그 아래 전부를 훑는다.
    """
    if not category_ids:
        return []
    all_rows = db.scalars(select(Category)).all()
    by_id = {row.id: row for row in all_rows}
    children_of: dict[int | None, list[Category]] = {}
    for row in all_rows:
        children_of.setdefault(row.parent_id, []).append(row)

    result: list[Category] = []
    seen: set[int] = set()
    stack = [by_id[cid] for cid in category_ids if cid in by_id]
    while stack:
        node = stack.pop()
        if node.id in seen:
            continue
        seen.add(node.id)
        kids = children_of.get(node.id, [])
        if kids:
            stack.extend(kids)
        else:
            result.append(node)
    # 선택한 것 자체가 최하위가 아니어도 자식이 없으면 그대로 쓴다.
    result.sort(key=lambda c: (c.depth, c.category_name))
    return result


def start_scan(
    db: Session,
    *,
    category_ids: list[int],
    pages_per_category: int = 1,
    sorter: str = DEFAULT_SORTER,
    list_size: int = DEFAULT_LIST_SIZE,
    conditions: dict | None = None,
    detail_limit: int = 50,
) -> tuple[ScanJob, int]:
    """스캔 작업을 만들고 1단계 대상을 채운다."""
    # 진행 중인 작업이 있으면 정리한다.
    for stale in db.scalars(
        select(ScanJob).where(ScanJob.status.in_([ScanStatus.RUNNING, ScanStatus.PAUSED]))
    ).all():
        stale.status = ScanStatus.STOPPED
        stale.finished_at = datetime.now(timezone.utc)

    pages = max(1, min(pages_per_category, MAX_PAGES))
    job = ScanJob(
        status=ScanStatus.RUNNING,
        phase=TargetKind.LIST,
        category_ids=json.dumps(category_ids),
        pages_per_category=pages,
        sorter=sorter,
        list_size=max(1, min(list_size, 120)),
        conditions=json.dumps(conditions or {}, ensure_ascii=False),
        detail_limit=max(0, min(detail_limit, MAX_DETAIL)),
    )
    db.add(job)
    db.flush()

    leaves = _leaf_categories(db, category_ids)
    position = 0
    for category in leaves:
        for page in range(1, pages + 1):
            db.add(
                ScanTarget(
                    job_id=job.id,
                    kind=TargetKind.LIST,
                    url=build_list_url(category.category_code, page, job.sorter, job.list_size),
                    label=f"{category.category_name} {page}페이지",
                    category_id=category.id,
                    page=page,
                    position=position,
                )
            )
            position += 1

    db.flush()
    logger.info(
        "스캔 시작: job=%s 카테고리 %d개 → 목록 %d페이지", job.id, len(leaves), position
    )
    return job, position


def _conditions_filter(job: ScanJob) -> ProductFilter:
    """작업에 저장된 1차 조건을 필터로 되살린다."""
    raw = json.loads(job.conditions or "{}")
    return ProductFilter(
        price_min=raw.get("price_min"),
        price_max=raw.get("price_max"),
        review_min=raw.get("review_min"),
        review_max=raw.get("review_max"),
        rating_min=raw.get("rating_min"),
        rating_max=raw.get("rating_max"),
        delivery_types=raw.get("delivery_types") or [],
    )


def prepare_detail_targets(db: Session, job: ScanJob) -> int:
    """1차 조건을 통과했지만 상세를 아직 안 본 상품을 2단계 대상으로 만든다.

    "한 달간 N명 구매" 문구와 리뷰 작성일은 상세 페이지에만 있으므로
    여기서 확보한다. 리뷰가 많은 순으로 우선 확인한다.
    """
    if job.detail_prepared or job.detail_limit <= 0:
        return 0

    filters = _conditions_filter(job)
    stmt = select(Product).where(Product.monthly_purchase_count.is_(None))

    category_ids = json.loads(job.category_ids or "[]")
    if category_ids:
        leaves = _leaf_categories(db, category_ids)
        if leaves:
            stmt = stmt.where(Product.category_id.in_([c.id for c in leaves]))

    expr = filters.condition_expression()
    if expr is not None:
        stmt = stmt.where(expr)

    # 리뷰가 많을수록 잘 팔릴 가능성이 높으므로 먼저 확인한다.
    stmt = stmt.order_by(Product.review_count.desc()).limit(job.detail_limit)
    products = db.scalars(stmt).unique().all()

    start = db.scalar(
        select(func.coalesce(func.max(ScanTarget.position), -1)).where(ScanTarget.job_id == job.id)
    )
    position = int(start or -1) + 1

    created = 0
    for product in products:
        db.add(
            ScanTarget(
                job_id=job.id,
                kind=TargetKind.DETAIL,
                url=product.product_url,
                label=product.product_name[:200],
                category_id=product.category_id,
                position=position,
            )
        )
        position += 1
        created += 1

    job.detail_prepared = True
    job.phase = TargetKind.DETAIL
    db.flush()
    logger.info("스캔 2단계 대상 %d건 준비: job=%s", created, job.id)
    return created


def active_job(db: Session) -> ScanJob | None:
    stmt = (
        select(ScanJob)
        .where(ScanJob.status.in_([ScanStatus.RUNNING, ScanStatus.PAUSED]))
        .order_by(ScanJob.id.desc())
        .limit(1)
    )
    return db.scalar(stmt)


def next_target(db: Session) -> ScanTarget | None:
    """확장이 다음으로 방문할 대상을 하나 내준다.

    1단계가 모두 끝나면 2단계 대상을 만들어 이어서 내보낸다.
    """
    job = active_job(db)
    if job is None or job.status != ScanStatus.RUNNING:
        return None

    target = _take_pending(db, job)
    if target is not None:
        return target

    # 1단계가 끝났으면 2단계를 준비한다.
    if not job.detail_prepared:
        prepare_detail_targets(db, job)
        target = _take_pending(db, job)
        if target is not None:
            return target

    # 남은 대상이 없으면 작업 완료.
    job.status = ScanStatus.COMPLETED
    job.finished_at = datetime.now(timezone.utc)
    db.flush()
    logger.info("스캔 완료: job=%s", job.id)
    return None


def _take_pending(db: Session, job: ScanJob) -> ScanTarget | None:
    stmt = (
        select(ScanTarget)
        .where(ScanTarget.job_id == job.id, ScanTarget.status == TargetStatus.PENDING)
        .order_by(ScanTarget.position)
        .limit(1)
    )
    target = db.scalar(stmt)
    if target is None:
        return None
    target.status = TargetStatus.IN_PROGRESS
    target.attempts += 1
    target.started_at = datetime.now(timezone.utc)
    db.flush()
    return target


def finish_target(
    db: Session, target_id: int, *, product_count: int | None = None, error: str | None = None
) -> ScanTarget | None:
    target = db.get(ScanTarget, target_id)
    if target is None:
        return None
    now = datetime.now(timezone.utc)
    target.status = TargetStatus.FAILED if error else TargetStatus.DONE
    target.product_count = product_count
    target.error = error
    target.finished_at = now
    if target.started_at is not None:
        started = target.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        target.duration_seconds = round((now - started).total_seconds(), 2)
    db.flush()
    return target


def set_status(db: Session, status: str) -> ScanJob | None:
    """일시정지 / 재개 / 중단."""
    job = active_job(db)
    if job is None:
        return None
    job.status = status
    if status in (ScanStatus.STOPPED, ScanStatus.COMPLETED):
        job.finished_at = datetime.now(timezone.utc)
        # 남은 대기 대상은 정리한다.
        for target in db.scalars(
            select(ScanTarget).where(
                ScanTarget.job_id == job.id,
                ScanTarget.status.in_([TargetStatus.PENDING, TargetStatus.IN_PROGRESS]),
            )
        ).all():
            target.status = TargetStatus.FAILED
            target.error = "사용자가 중단함"
    db.flush()
    return job


def job_status(db: Session, job: ScanJob) -> dict:
    """진행률 요약."""
    rows = db.execute(
        select(ScanTarget.kind, ScanTarget.status, func.count())
        .where(ScanTarget.job_id == job.id)
        .group_by(ScanTarget.kind, ScanTarget.status)
    ).all()

    counts: dict[str, dict[str, int]] = {}
    for kind, status, count in rows:
        counts.setdefault(kind, {})[status] = int(count)

    def part(kind: str) -> dict[str, int]:
        data = counts.get(kind, {})
        done = data.get(TargetStatus.DONE, 0)
        failed = data.get(TargetStatus.FAILED, 0)
        pending = data.get(TargetStatus.PENDING, 0)
        running = data.get(TargetStatus.IN_PROGRESS, 0)
        return {
            "total": done + failed + pending + running,
            "done": done,
            "failed": failed,
            "pending": pending + running,
        }

    current = db.scalar(
        select(ScanTarget)
        .where(ScanTarget.job_id == job.id, ScanTarget.status == TargetStatus.IN_PROGRESS)
        .order_by(ScanTarget.position)
        .limit(1)
    )

    list_part = part(TargetKind.LIST)
    detail_part = part(TargetKind.DETAIL)
    return {
        "job_id": job.id,
        "status": job.status,
        "phase": job.phase,
        "list": list_part,
        "detail": detail_part,
        "total": list_part["total"] + detail_part["total"],
        "done": list_part["done"] + detail_part["done"],
        "failed": list_part["failed"] + detail_part["failed"],
        "current_label": current.label if current else None,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }
