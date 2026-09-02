"""FastAPI 애플리케이션 엔트리포인트."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    categories,
    export,
    jobs,
    products,
    scan,
    settings as settings_routes,
    stats,
    saved,
    diagnostics,
)
from app.config import settings
from app.core.logging import configure_logging, get_logger
from app.db.init_db import init_db

configure_logging(settings.log_level)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description=(
        "쿠팡 상품 소싱 분석 MVP. 리뷰수 기반 '예상 판매량'을 계산합니다. "
        "실제 판매량이 아닙니다."
    ),
    lifespan=lifespan,
)

# Chrome 확장의 origin(chrome-extension://<id>)은 설치 전에는 id를 알 수 없다.
# 로컬 대시보드는 포트가 바뀔 수 있으므로 localhost/127.0.0.1 전체를 허용한다.
# (로컬 개발 전용 설정이다. 외부에 배포할 때는 반드시 좁혀야 한다.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"^(chrome-extension://.*|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(categories.router)
app.include_router(products.router)
app.include_router(settings_routes.router)
app.include_router(stats.router)
app.include_router(jobs.router)
app.include_router(scan.router)
app.include_router(export.router)
app.include_router(saved.router)
app.include_router(diagnostics.router)


def app_version() -> str:
    """저장소 루트의 VERSION 파일. 대시보드에 표시해 어떤 버전을 쓰는지 바로 알 수 있게 한다."""
    from pathlib import Path

    for candidate in (Path(__file__).resolve().parents[2] / "VERSION", Path("VERSION")):
        try:
            return candidate.read_text(encoding="utf-8").strip()
        except OSError:
            continue
    return "unknown"


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.app_name, "version": app_version()}
