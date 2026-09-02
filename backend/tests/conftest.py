from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

# 앱을 import 하기 전에 테스트 전용 DB를 지정해야 한다.
_tmpdir = tempfile.mkdtemp(prefix="coupang-test-")
os.environ["COUPANG_DATABASE_URL"] = f"sqlite:///{Path(_tmpdir) / 'test.db'}"

from fastapi.testclient import TestClient  # noqa: E402

from app.db.init_db import init_db  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    init_db()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def db():
    with SessionLocal() as session:
        yield session


SAMPLE_CATEGORIES = [
    {"category_code": "C-100", "category_name": "홈인테리어", "parent_category_code": None, "depth": 1, "category_url": "https://example.test/c/100"},
    {"category_code": "C-110", "category_name": "카페트/매트", "parent_category_code": "C-100", "depth": 2, "category_url": "https://example.test/c/110"},
    {"category_code": "C-111", "category_name": "발매트", "parent_category_code": "C-110", "depth": 3, "category_url": "https://example.test/c/111"},
    {"category_code": "C-200", "category_name": "주방용품", "parent_category_code": None, "depth": 1, "category_url": "https://example.test/c/200"},
    {"category_code": "C-210", "category_name": "조리도구", "parent_category_code": "C-200", "depth": 2, "category_url": "https://example.test/c/210"},
    {"category_code": "C-211", "category_name": "채칼/슬라이서", "parent_category_code": "C-210", "depth": 3, "category_url": "https://example.test/c/211"},
]
