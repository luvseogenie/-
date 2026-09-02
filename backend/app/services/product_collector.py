"""상품 수집 서비스 (카테고리 서비스와 분리된 모듈).

책임:
  - 확장 프로그램이 보낸 상품 목록을 저장한다.
  - product_id 기준으로 중복을 제거한다(요구사항 12).
  - 예상 판매량을 계산해 함께 저장한다.
  - 실패 원인을 로그에 남긴다.

원칙: DOM에 없어서 None으로 들어온 값은 절대 임의로 채우지 않는다.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.category import Category
from app.models.collection_job import CollectionJob, JobStatus
from app.models.product import DeliveryType, Product
from app.schemas.product import (
    CategoryPathItem,
    CollectedProduct,
    CollectRequest,
    CollectResult,
)
from app.services import monthly_reviews
from app.services.estimation import calculate_estimated_sales, get_multiplier

logger = get_logger(__name__)


def _normalize_delivery(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip().lower()
    if v in DeliveryType.ALL:
        return v
    # 한글 라벨로 들어온 경우도 받아준다.
    korean = {
        "로켓배송": DeliveryType.ROCKET,
        "로켓그로스": DeliveryType.ROCKET_GROWTH,
        "판매자배송": DeliveryType.SELLER,
        "판매자로켓": DeliveryType.ROCKET_GROWTH,
    }
    return korean.get(value.strip(), DeliveryType.UNKNOWN)


def _resolve_category(
    db: Session,
    code: str | None,
    name: str | None,
    path: list[CategoryPathItem] | None = None,
) -> tuple[Category | None, int]:
    """수집 요청의 카테고리를 찾고, 없으면 breadcrumb 경로대로 만들어 둔다.

    쿠팡 페이지에서 읽은 계층(홈인테리어 > 카페트/매트 > 발매트)을 그대로
    저장하므로, 사용자가 카테고리를 따로 import 하지 않아도
    수집하는 것만으로 트리가 채워진다.

    이름은 페이지에서 실제로 읽은 값만 쓴다. 만들어내지 않는다.

    Returns:
        (카테고리, 새로 만든 개수)
    """
    created = 0
    items = [item for item in (path or []) if item.code and item.name]

    # 경로가 없으면 현재 카테고리 한 칸만이라도 만든다.
    if not items and code and name:
        items = [CategoryPathItem(code=code, name=name)]

    parent: Category | None = None
    current: Category | None = None
    for depth, item in enumerate(items, start=1):
        category = db.scalar(select(Category).where(Category.category_code == item.code))
        if category is None:
            category = Category(
                category_code=item.code,
                category_name=item.name,
                parent_id=parent.id if parent else None,
                depth=depth,
                is_leaf=True,
            )
            db.add(category)
            db.flush()
            created += 1
            logger.info("카테고리 자동 등록: [%d] %s <%s>", depth, item.name, item.code)
        else:
            # 이름과 계층 정보를 최신 값으로 보정한다.
            category.category_name = item.name
            if parent is not None and category.parent_id != parent.id and category.id != parent.id:
                category.parent_id = parent.id
            category.depth = depth
        if parent is not None:
            parent.is_leaf = False
        parent = category
        current = category

    if current is None and code:
        current = db.scalar(select(Category).where(Category.category_code == code))
        if current is None:
            logger.warning("카테고리를 찾지도 만들지도 못함: code=%s name=%s", code, name)

    if created:
        db.flush()
    return current, created


def _valid(item: CollectedProduct) -> str | None:
    """필수값 검증. 문제가 있으면 사유 문자열을 돌려준다."""
    if not item.product_id or not str(item.product_id).strip():
        return "product_id 없음"
    if not item.product_name or not item.product_name.strip():
        return f"product_name 없음 (product_id={item.product_id})"
    if not item.product_url or not item.product_url.strip():
        return f"product_url 없음 (product_id={item.product_id})"
    return None


def collect_products(db: Session, payload: CollectRequest) -> CollectResult:
    now = datetime.now(timezone.utc)
    multiplier = get_multiplier(db)
    category, categories_created = _resolve_category(
        db, payload.category_code, payload.category_name, payload.category_path
    )

    result = CollectResult(
        job_id=payload.job_id,
        received=len(payload.products),
        inserted=0,
        updated=0,
        duplicates=0,
        skipped=payload.skipped,
        saved=0,
        categories_created=categories_created,
    )

    # 확장에서 파싱 실패한 카드의 사유를 서버 로그에도 남긴다.
    for message in payload.parse_errors[:50]:
        logger.warning("확장 파싱 실패: %s (url=%s)", message, payload.source_url)

    seen_in_payload: set[str] = set()

    for item in payload.products:
        reason = _valid(item)
        if reason:
            result.skipped += 1
            result.errors.append(reason)
            logger.warning("상품 저장 건너뜀: %s (url=%s)", reason, payload.source_url)
            continue

        pid = str(item.product_id).strip()
        if pid in seen_in_payload:
            # 같은 페이지에 같은 상품이 두 번 노출된 경우
            result.duplicates += 1
            continue
        seen_in_payload.add(pid)

        estimated = calculate_estimated_sales(item.review_count or 0, multiplier)
        existing = db.scalar(select(Product).where(Product.product_id == pid))

        if existing is None:
            product = Product(
                product_id=pid,
                product_name=item.product_name.strip(),
                product_url=item.product_url.strip(),
                price=item.price,
                review_count=item.review_count or 0,
                estimated_sales=estimated,
                rating=item.rating,
                delivery_type=_normalize_delivery(item.delivery_type),
                thumbnail_url=item.thumbnail_url,
                # 조회수 원천이 없으면 None 그대로 저장한다. 숫자를 만들어내지 않는다.
                view_count=item.view_count,
                monthly_purchase_count=item.monthly_purchase_count,
                monthly_purchase_is_minimum=item.monthly_purchase_is_minimum,
                monthly_purchase_unit=item.monthly_purchase_unit,
                monthly_purchase_text=item.monthly_purchase_text,
                monthly_purchase_collected_at=now if item.monthly_purchase_count is not None else None,
                category_id=category.id if category else None,
                rank=item.rank,
                first_collected_at=now,
                last_collected_at=now,
            )
            db.add(product)
            db.flush()  # product.id 확보(스냅샷 FK)
            monthly_reviews.record_snapshot(
                db, product, product.review_count, source=payload.page_type
            )
            result.inserted += 1
        else:
            # 이미 있는 상품: 최신 값으로 갱신하고 마지막 수집 시각만 업데이트한다.
            existing.product_name = item.product_name.strip()
            existing.product_url = item.product_url.strip()
            if item.price is not None:
                existing.price = item.price
            # 상세 페이지에서 리뷰수를 못 읽었을 때(None) 목록에서 얻은 값을 0으로 덮어쓰지 않는다.
            if item.review_count is not None:
                existing.review_count = item.review_count
                existing.estimated_sales = estimated
            if item.rating is not None:
                existing.rating = item.rating
            delivery = _normalize_delivery(item.delivery_type)
            if delivery and delivery != DeliveryType.UNKNOWN:
                existing.delivery_type = delivery
            if item.thumbnail_url:
                existing.thumbnail_url = item.thumbnail_url
            if item.view_count is not None:
                existing.view_count = item.view_count
            # 쿠팡 월간 구매 문구는 최신 값으로 갱신한다.
            # 이번에 문구가 없다면(카드에는 없고 상세에만 있는 경우 등) 기존 값을 지우지 않는다.
            if item.monthly_purchase_count is not None:
                existing.monthly_purchase_count = item.monthly_purchase_count
                existing.monthly_purchase_is_minimum = item.monthly_purchase_is_minimum
                existing.monthly_purchase_unit = item.monthly_purchase_unit
                existing.monthly_purchase_text = item.monthly_purchase_text
                existing.monthly_purchase_collected_at = now
            if category is not None:
                existing.category_id = category.id
            if item.rank is not None:
                existing.rank = item.rank
            existing.last_collected_at = now
            # 이번에 리뷰수를 실제로 읽은 경우에만 스냅샷을 남긴다 (옛 값을 새 측정처럼 기록하지 않는다).
            if item.review_count is not None:
                monthly_reviews.record_snapshot(
                    db, existing, existing.review_count, source=payload.page_type
                )
            db.flush()
            # 누적 리뷰수 변화로 최근 30일 리뷰수를 다시 구한다.
            monthly_reviews.refresh_from_snapshots(db, existing, multiplier)
            result.updated += 1

    result.saved = result.inserted + result.updated

    # job 통계 갱신
    job = _attach_job(db, payload.job_id)
    if job is not None:
        job.total_products += result.received
        job.collected_products += result.saved
        result.job_id = job.id

    db.flush()
    logger.info(
        "수집 완료: url=%s received=%d inserted=%d updated=%d duplicates=%d skipped=%d",
        payload.source_url, result.received, result.inserted,
        result.updated, result.duplicates, result.skipped,
    )
    return result


def _attach_job(db: Session, job_id: int | None) -> CollectionJob | None:
    """수집 요청을 job에 연결한다.

    job_id가 오면 그 job을, 없으면 진행 중인 최신 job을 쓴다.
    진행 중인 job도 없으면(확장에서 바로 수집한 경우) 새 job을 만들어 붙인다.
    → 모든 수집이 이력에 남고 KPI '수집 상품 수'가 정확해진다.
    """
    if job_id is not None:
        job = db.get(CollectionJob, job_id)
        if job is not None:
            return job
        logger.warning("존재하지 않는 job_id: %s → 새 job을 생성합니다", job_id)
    active = get_active_job(db)
    if active is not None:
        return active
    return start_job(db)


def get_active_job(db: Session) -> CollectionJob | None:
    stmt = (
        select(CollectionJob)
        .where(CollectionJob.status == JobStatus.RUNNING)
        .order_by(CollectionJob.id.desc())
        .limit(1)
    )
    return db.scalar(stmt)


def start_job(db: Session) -> CollectionJob:
    """새 수집 작업을 시작한다.

    이전 작업이 running으로 남아 있으면 함께 종료한다.
    (수집은 사용자가 브라우저에서 수동으로 하므로 명시적 종료 시점이 없다.)
    """
    for stale in db.scalars(
        select(CollectionJob).where(CollectionJob.status == JobStatus.RUNNING)
    ).all():
        stale.status = JobStatus.COMPLETED
        stale.finished_at = datetime.now(timezone.utc)
        logger.info("이전 수집 job 자동 종료: id=%s", stale.id)

    job = CollectionJob(status=JobStatus.RUNNING, total_products=0, collected_products=0)
    db.add(job)
    db.flush()
    logger.info("수집 job 시작: id=%s", job.id)
    return job


def finish_job(db: Session, job_id: int, status: str = JobStatus.COMPLETED,
               error_message: str | None = None) -> CollectionJob | None:
    job = db.get(CollectionJob, job_id)
    if job is None:
        return None
    job.status = status
    job.finished_at = datetime.now(timezone.utc)
    if error_message:
        job.error_message = error_message
    db.flush()
    logger.info("수집 job 종료: id=%s status=%s", job.id, status)
    return job
