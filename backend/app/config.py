"""애플리케이션 설정.

MVP는 SQLite를 쓰지만 DATABASE_URL만 바꾸면 PostgreSQL로 이관할 수 있도록
DB 접속 정보를 여기 한 곳에서만 관리한다.
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="COUPANG_", env_file=".env", extra="ignore")

    app_name: str = "Coupang Sourcing MVP"

    # PostgreSQL 이관 시: postgresql+psycopg://user:pw@host:5432/dbname
    database_url: str = f"sqlite:///{BASE_DIR / 'coupang_sourcing.db'}"

    # 대시보드(Next.js) origin. Chrome 확장(chrome-extension://<id>)은
    # id를 미리 알 수 없어 main.py에서 정규식으로 별도 허용한다.
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # settings 테이블이 비어 있을 때 시드할 기본 배수
    default_review_sales_multiplier: int = 20

    log_level: str = "INFO"


settings = Settings()
