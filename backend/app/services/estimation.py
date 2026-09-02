"""예상 판매량 계산.

    예상 판매량 = 리뷰수 × review_sales_multiplier

주의: 이 값은 '예상 판매량'이다. 실제 판매량이 아니다.
배수는 settings 테이블에서 읽는다. 하드코딩하지 않는다.
"""

from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.product import Product
from app.models.setting import SETTINGS_ID, Setting

DEFAULT_MULTIPLIER = 20


def calculate_estimated_sales(review_count: int | None, multiplier: int) -> int:
    """리뷰수 × 배수. 리뷰가 없으면 0."""
    if not review_count or review_count < 0:
        return 0
    if multiplier <= 0:
        return 0
    return int(review_count) * int(multiplier)


def get_settings_row(db: Session) -> Setting:
    """settings 싱글턴 행을 가져온다. 없으면 기본값으로 만든다."""
    row = db.get(Setting, SETTINGS_ID)
    if row is None:
        row = Setting(id=SETTINGS_ID, review_sales_multiplier=DEFAULT_MULTIPLIER)
        db.add(row)
        db.flush()
    return row


def get_multiplier(db: Session) -> int:
    return get_settings_row(db).review_sales_multiplier


def recalculate_all(db: Session, multiplier: int) -> int:
    """배수가 바뀌면 저장된 모든 상품의 예상 판매량을 다시 계산한다."""
    db.execute(
        update(Product).values(estimated_sales=Product.review_count * multiplier)
    )
    count = db.scalar(select(func.count()).select_from(Product)) or 0
    return int(count)
