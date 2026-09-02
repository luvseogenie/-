"""DB 초기화."""

from __future__ import annotations

from app.config import settings as app_settings
from app.core.logging import get_logger
from app.db.session import SessionLocal, engine
from app.models import Base  # noqa: F401 - 모든 모델 등록
from app.models.setting import SETTINGS_ID, Setting

logger = get_logger(__name__)


def init_db() -> None:
    """테이블 생성 + settings 기본 행 시드.

    MVP는 create_all로 충분하다. 스키마 변경이 잦아지면 Alembic을 붙인다.
    """
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if db.get(Setting, SETTINGS_ID) is None:
            db.add(
                Setting(
                    id=SETTINGS_ID,
                    review_sales_multiplier=app_settings.default_review_sales_multiplier,
                )
            )
            db.commit()
            logger.info(
                "settings 기본값 생성: review_sales_multiplier=%d",
                app_settings.default_review_sales_multiplier,
            )
    logger.info("DB 준비 완료: %s", app_settings.database_url)
