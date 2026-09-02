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
from app.schemas.category import CategoryImportRow
from app.services import category_service
from app.services.filtering import ProductFilter

logger = get_logger(__name__)

COUPANG_CATEGORY_URL = "https://www.coupang.com/np/categories/{code}"

# 쿠팡 목록 정렬. 판매량순으로 훑으면 잘 팔리는 상품이 앞에 온다.
DEFAULT_SORTER = "saleCountDesc"
DEFAULT_LIST_SIZE = 120
MAX_PAGES = 20
MAX_DETAIL = 500
# 하위 카테고리를 발견해 대상이 늘어나도 이 수를 넘지 않는다 (한 번의 스캔이 끝없이 커지지 않도록)
MAX_LIST_TARGETS = 300


def build_list_url(code: str, page: int, sorter: str, list_size: int) -> str:
    """카테고리 목록 페이지 주소를 만든다."""
    base = COUPANG_CATEGORY_URL.format(code=code)
    params = [f"listSize={list_size}", f"sorter={sorter}"]
    if page > 1:
        params.append(f"page={page}")
    return f"{base}?{'&'.join(params)}"


def _scope_categories(db: Session, category_ids: list[int]) -> list[Category]:
    """선택한 카테고리와 그 아래 전부(중간 단계 포함)를 모은다.

    최하위만 훑지 않고 중간 카테고리 페이지도 방문하는 이유: 쿠팡 첫 화면 메뉴에는
    하위 카테고리가 일부만 실려 있어, 실제 카테고리 페이지의 좌측 메뉴를 봐야
    나머지 하위를 발견할 수 있다. 발견된 하위는 스캔 도중 대상에 추가된다.
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
        result.append(node)
        stack.extend(children_of.get(node.id, []))
    result.sort(key=lambda c: (c.depth, c.category_name))
    return result


def _add_list_targets(
    db: Session, job: ScanJob, categories: list[Category], *, position: int, budget: int
) -> int:
    """카테고리마다 pages_per_category 페이지씩 목록 대상을 만든다. budget 을 넘지 않는다."""
    created = 0
    for category in categories:
        for page in range(1, job.pages_per_category + 1):
            if created >= budget:
                return created
            db.add(
                ScanTarget(
                    job_id=job.id,
                    kind=TargetKind.LIST,
                    url=build_list_url(category.category_code, page, job.sorter, job.list_size),
                    label=f"{category.category_name} {page}페이지",
                    category_id=category.id,
                    page=page,
                    position=position + created,
                )
            )
            created += 1
    return created


def start_scan(
    db: Session,
    *,
    category_ids: list[int],
    pages_per_category: int = 1,
    sorter: str = DEFAULT_SORTER,
    list_size: int = DEFAULT_LIST_SIZE,
    conditions: dict | None = None,
    detail_limit: int = 50,
    pace: str = "slow",
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
        pace=pace,
    )
    db.add(job)
    db.flush()

    scope = _scope_categories(db, category_ids)
    position = _add_list_targets(db, job, scope, position=0, budget=MAX_LIST_TARGETS)
    db.flush()
    logger.info(
        "스캔 시작: job=%s 카테고리 %d개 → 목록 %d페이지", job.id, len(scope), position
    )
    return job, position


def review_floor(db: Session, job: ScanJob) -> int:
    """상세 방문 후보의 누적 리뷰 하한 = 월 판매량 기준 ÷ 배수 (기준이 없으면 0)."""
    raw = json.loads(job.conditions or "{}")
    target = raw.get("monthly_min") or raw.get("monthly_sales_min")
    if not target:
        return 0
    from app.services.estimation import get_multiplier

    multiplier = max(1, int(get_multiplier(db)))
    return -(-int(target) // multiplier)  # 올림


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
    """1차 조건을 통과했지만 최근 30일 리뷰수를 아직 못 잰 상품을 2단계 대상으로 만든다.

    핵심 지표(30일 리뷰수 → 30일 예상 판매량 → 30일 예상매출)는 상세 페이지의 리뷰를
    최신순으로 세어야 나온다. 같은 방문에서 "한 달간 N명 구매" 문구도 함께 저장한다(2차 확인용).
    누적 리뷰가 많은 순으로 우선 확인한다.
    """
    if job.detail_prepared or job.detail_limit <= 0:
        return 0

    filters = _conditions_filter(job)
    stmt = select(Product).where(Product.monthly_review_count.is_(None))

    category_ids = json.loads(job.category_ids or "[]")
    if category_ids:
        scope = _scope_categories(db, category_ids)
        if scope:
            stmt = stmt.where(Product.category_id.in_([c.id for c in scope]))

    expr = filters.condition_expression()
    if expr is not None:
        stmt = stmt.where(expr)

    # 헛방문 줄이기: 월 N개 기준이면 30일 리뷰가 N÷배수 건은 있어야 하고, 누적 리뷰가 그보다 적으면
    # 절대 통과할 수 없으므로 상세를 열지 않는다. (쿠팡 문구는 못 보게 되지만 방문 수를 크게 줄인다)
    floor = review_floor(db, job)
    if floor > 0:
        stmt = stmt.where(Product.review_count >= floor)

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


def latest_job_id(db: Session) -> int | None:
    """가장 최근 검색(자동 스캔) 번호. 진행 중이든 끝났든 마지막 것."""
    return db.scalar(select(ScanJob.id).order_by(ScanJob.id.desc()).limit(1))


def resolve_scan_scope(db: Session, scan: str | None):
    """?scan=latest|<번호> → products.last_scan_job_id 조건. 검색이 없거나 미지정이면 None(전체)."""
    if not scan:
        return None
    if scan == "latest":
        job_id = latest_job_id(db)
    else:
        try:
            job_id = int(scan)
        except ValueError:
            return None
    if job_id is None:
        return None
    return Product.last_scan_job_id == job_id


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


def register_discovered_children(db: Session, target: ScanTarget, children: list[dict]) -> int:
    """목록 페이지 좌측 메뉴에서 발견한 하위 카테고리를 트리에 넣고, 이번 스캔 대상에도 더한다.

    화면에 보인 것만 등록한다. 이미 대상인 카테고리는 다시 넣지 않는다.
    2단계(상세)로 넘어간 뒤에는 대상을 늘리지 않는다.
    """
    if target.kind != TargetKind.LIST or target.category_id is None or not children:
        return 0
    parent = db.get(Category, target.category_id)
    if parent is None:
        return 0
    rows = [
        CategoryImportRow(
            category_code=str(c.get("category_code") or "").strip(),
            category_name=str(c.get("category_name") or "").strip(),
            parent_category_code=parent.category_code,
            category_url=c.get("category_url"),
        )
        for c in children
    ]
    rows = [r for r in rows if r.category_code and r.category_name and r.category_code != parent.category_code]
    if not rows:
        return 0
    result = category_service.import_categories(db, rows)
    if result.created:
        logger.info("스캔 중 하위 카테고리 %d개 발견: %s 아래", result.created, parent.category_name)

    job = db.get(ScanJob, target.job_id)
    if job is None or job.status not in (ScanStatus.RUNNING, ScanStatus.PAUSED) or job.detail_prepared:
        return 0
    targeted = set(
        db.scalars(
            select(ScanTarget.category_id).where(
                ScanTarget.job_id == job.id, ScanTarget.kind == TargetKind.LIST
            )
        ).all()
    )
    total = int(
        db.scalar(
            select(func.count(ScanTarget.id)).where(
                ScanTarget.job_id == job.id, ScanTarget.kind == TargetKind.LIST
            )
        )
        or 0
    )
    codes = [r.category_code for r in rows]
    fresh = [
        c
        for c in db.scalars(select(Category).where(Category.category_code.in_(codes))).all()
        if c.id not in targeted
    ]
    if not fresh:
        return 0
    fresh.sort(key=lambda c: c.category_name)
    start = db.scalar(
        select(func.coalesce(func.max(ScanTarget.position), -1)).where(ScanTarget.job_id == job.id)
    )
    created = _add_list_targets(
        db, job, fresh, position=int(start or -1) + 1, budget=max(0, MAX_LIST_TARGETS - total)
    )
    db.flush()
    if created:
        logger.info("스캔 대상 %d페이지 추가: job=%s", created, job.id)
    return created


def finish_target(
    db: Session,
    target_id: int,
    *,
    product_count: int | None = None,
    error: str | None = None,
    note: str | None = None,
    discovered_children: list[dict] | None = None,
) -> ScanTarget | None:
    target = db.get(ScanTarget, target_id)
    if target is None:
        return None
    now = datetime.now(timezone.utc)
    target.status = TargetStatus.FAILED if error else TargetStatus.DONE
    target.product_count = product_count
    target.error = error
    target.note = (note or "")[:300] or None
    target.finished_at = now
    if target.started_at is not None:
        started = target.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        target.duration_seconds = round((now - started).total_seconds(), 2)
    db.flush()
    if not error and discovered_children:
        register_discovered_children(db, target, discovered_children)
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

    # 최근 실패 사유 — 2단계가 왜 안 되는지 화면에서 바로 볼 수 있게
    failed_rows = db.scalars(
        select(ScanTarget)
        .where(ScanTarget.job_id == job.id, ScanTarget.status == TargetStatus.FAILED)
        .order_by(ScanTarget.finished_at.desc(), ScanTarget.id.desc())
        .limit(3)
    ).all()
    recent_errors = [
        {"kind": t.kind, "label": (t.label or t.url)[:80], "error": (t.error or "")[:200]}
        for t in failed_rows
    ]
    last_done = db.scalar(
        select(ScanTarget)
        .where(ScanTarget.job_id == job.id, ScanTarget.status == TargetStatus.DONE)
        .order_by(ScanTarget.finished_at.desc(), ScanTarget.id.desc())
        .limit(1)
    )

    list_part = part(TargetKind.LIST)
    detail_part = part(TargetKind.DETAIL)
    return {
        "recent_errors": recent_errors,
        "last_done_label": last_done.label if last_done else None,
        "last_product_count": last_done.product_count if last_done else None,
        "last_done_note": last_done.note if last_done else None,
        "pace": job.pace,
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
