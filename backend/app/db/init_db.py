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
    _add_missing_columns()
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


# 이미 만들어진 DB 에 나중에 추가된 컬럼. (컬럼명, 테이블, DDL 타입)
_LATE_COLUMNS = [
    ("products", "last_scan_job_id", "INTEGER"),
    ("scan_targets", "note", "VARCHAR(300)"),
    ("scan_jobs", "pace", "VARCHAR(16)"),
]


def _add_missing_columns() -> None:
    """create_all 은 기존 테이블에 컬럼을 더하지 않으므로 직접 확인해 추가한다 (SQLite/PostgreSQL 공통 문법)."""
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, column, ddl in _LATE_COLUMNS:
            if table not in inspector.get_table_names():
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                logger.info("DB 컬럼 추가: %s.%s", table, column)
