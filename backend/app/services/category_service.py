"""카테고리 서비스 (상품 수집과 완전히 분리된 모듈).

역할:
  - JSON / CSV 파일 또는 요청 본문으로 카테고리 계층 import
  - parent_id 기반 무한 depth 트리 조회
  - is_leaf 자동 재계산

import 포맷 (요구사항 4):
    category_code, category_name, parent_category_code, depth, category_url

쿠팡 공식 카테고리 데이터를 확보하면 `fetch_official_categories()` 자리에
연결만 하면 되도록 구조를 열어 둔다. 지금은 구현하지 않는다
(임의 데이터를 만들어내지 않기 위해서다).
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.category import Category
from app.schemas.category import (
    CategoryImportResult,
    CategoryImportRow,
    CategoryTreeNode,
)

logger = get_logger(__name__)

REQUIRED_COLUMNS = ("category_code", "category_name")


# --------------------------------------------------------------------------
# 파싱 (JSON / CSV)
# --------------------------------------------------------------------------
def parse_rows(raw: str | bytes, filename: str | None = None) -> list[CategoryImportRow]:
    """JSON 또는 CSV 텍스트를 CategoryImportRow 리스트로 바꾼다."""
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8-sig")
    text = raw.strip()
    if not text:
        return []

    is_csv = (filename or "").lower().endswith(".csv") or not text.startswith(("[", "{"))
    if is_csv:
        return _parse_csv(text)
    return _parse_json(text)


def _parse_json(text: str) -> list[CategoryImportRow]:
    data: Any = json.loads(text)
    if isinstance(data, dict):
        data = data.get("categories") or data.get("rows") or []
    if not isinstance(data, list):
        raise ValueError("JSON 최상위는 배열이거나 {\"categories\": [...]} 형태여야 합니다.")
    return [CategoryImportRow(**_clean(item)) for item in data]


def _parse_csv(text: str) -> list[CategoryImportRow]:
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ValueError("CSV 헤더가 없습니다.")
    missing = [c for c in REQUIRED_COLUMNS if c not in reader.fieldnames]
    if missing:
        raise ValueError(f"CSV에 필수 컬럼이 없습니다: {', '.join(missing)}")
    return [CategoryImportRow(**_clean(row)) for row in reader]


def _clean(item: dict) -> dict:
    """빈 문자열을 None으로, depth를 int로 정리한다."""
    out: dict[str, Any] = {}
    for key in ("category_code", "category_name", "parent_category_code", "category_url", "depth"):
        value = item.get(key)
        if isinstance(value, str):
            value = value.strip()
            if value == "":
                value = None
        out[key] = value
    if out.get("depth") is not None:
        out["depth"] = int(out["depth"])
    return out


# --------------------------------------------------------------------------
# Import
# --------------------------------------------------------------------------
def import_categories(db: Session, rows: Iterable[CategoryImportRow]) -> CategoryImportResult:
    """2-pass import.

    1) 모든 행을 code 기준으로 upsert (parent는 아직 연결하지 않음)
    2) parent_category_code로 parent_id 연결 + depth 계산
    → 부모가 파일 뒤쪽에 있어도 정상 처리된다.

    parent_category_code 가 비어 있는 행은 "부모를 모른다"는 뜻이다.
    이미 부모가 연결된 카테고리라면 기존 부모를 유지한다 (확장 프로그램이 목록 페이지에서
    보이는 카테고리를 조금씩 추가할 때 트리가 무너지지 않도록). 새 카테고리면 루트가 된다.
    """
    rows = list(rows)
    result = CategoryImportResult(received=len(rows), created=0, updated=0, skipped=0)

    parent_of: dict[str, str | None] = {}
    declared_depth: dict[str, int | None] = {}
    seen: set[str] = set()

    # ---- pass 1 : upsert
    for row in rows:
        code = (row.category_code or "").strip()
        if not code or not (row.category_name or "").strip():
            result.skipped += 1
            result.errors.append(f"category_code/category_name 누락: {row!r}")
            continue
        if code in seen:
            result.skipped += 1
            result.errors.append(f"파일 내 중복 category_code: {code}")
            continue
        seen.add(code)

        existing = db.scalar(select(Category).where(Category.category_code == code))
        if existing is None:
            existing = Category(category_code=code, category_name=row.category_name)
            db.add(existing)
            result.created += 1
        else:
            existing.category_name = row.category_name
            result.updated += 1
        if row.category_url is not None:
            existing.category_url = row.category_url

        parent_of[code] = (row.parent_category_code or None)
        declared_depth[code] = row.depth

    db.flush()

    # ---- pass 2 : parent 연결
    all_by_code = {c.category_code: c for c in db.scalars(select(Category)).all()}
    for code, parent_code in parent_of.items():
        node = all_by_code.get(code)
        if node is None:
            continue
        if parent_code:
            parent = all_by_code.get(parent_code)
            if parent is None:
                result.errors.append(f"부모 카테고리를 찾을 수 없음: {code} → {parent_code}")
                node.parent_id = None
            elif parent.id == node.id:
                result.errors.append(f"자기 자신을 부모로 지정할 수 없음: {code}")
                node.parent_id = None
            else:
                node.parent_id = parent.id
        # parent_code 가 없으면 기존 연결을 그대로 둔다 (신규 행은 parent_id=None 상태 그대로 루트)

    db.flush()

    # ---- depth 계산 (선언값보다 실제 트리 구조를 우선)
    recalculate_depth(db)
    recalculate_is_leaf(db)
    db.flush()

    logger.info(
        "카테고리 import 완료: received=%d created=%d updated=%d skipped=%d errors=%d",
        result.received, result.created, result.updated, result.skipped, len(result.errors),
    )
    return result


def recalculate_depth(db: Session, max_depth: int = 30) -> None:
    """루트에서 내려오며 depth를 다시 매긴다(1부터). 순환 참조는 끊는다."""
    nodes = db.scalars(select(Category)).all()
    children_of: dict[int | None, list[Category]] = {}
    for node in nodes:
        children_of.setdefault(node.parent_id, []).append(node)

    visited: set[int] = set()
    stack: list[tuple[Category, int]] = [(n, 1) for n in children_of.get(None, [])]
    while stack:
        node, depth = stack.pop()
        if node.id in visited:
            logger.warning("카테고리 순환 참조 감지, 건너뜀: %s", node.category_code)
            continue
        visited.add(node.id)
        node.depth = depth
        if depth < max_depth:
            for child in children_of.get(node.id, []):
                stack.append((child, depth + 1))

    # 순환 등으로 방문하지 못한 노드는 원래 depth를 유지하되 최소 1로 보정
    for node in nodes:
        if node.id not in visited and (node.depth is None or node.depth < 1):
            node.depth = 1


def recalculate_is_leaf(db: Session) -> None:
    """자식이 없는 노드를 leaf로 표시한다."""
    nodes = db.scalars(select(Category)).all()
    has_child = {n.parent_id for n in nodes if n.parent_id is not None}
    for node in nodes:
        node.is_leaf = node.id not in has_child


# --------------------------------------------------------------------------
# 조회
# --------------------------------------------------------------------------
def list_categories(
    db: Session,
    parent_id: int | None = None,
    include_all: bool = False,
    leaf_only: bool = False,
) -> list[Category]:
    stmt = select(Category)
    if not include_all:
        stmt = stmt.where(Category.parent_id.is_(parent_id) if parent_id is None else Category.parent_id == parent_id)
    if leaf_only:
        stmt = stmt.where(Category.is_leaf.is_(True))
    stmt = stmt.order_by(Category.depth, Category.category_name)
    return list(db.scalars(stmt).all())


def get_children(db: Session, category_id: int) -> list[Category]:
    stmt = (
        select(Category)
        .where(Category.parent_id == category_id)
        .order_by(Category.category_name)
    )
    return list(db.scalars(stmt).all())


def build_tree(db: Session) -> list[CategoryTreeNode]:
    """전체 카테고리를 한 번에 읽어 메모리에서 트리로 만든다(N+1 방지)."""
    nodes = db.scalars(select(Category).order_by(Category.depth, Category.category_name)).all()
    lookup: dict[int, CategoryTreeNode] = {}
    for node in nodes:
        lookup[node.id] = CategoryTreeNode(
            id=node.id,
            parent_id=node.parent_id,
            category_code=node.category_code,
            category_name=node.category_name,
            depth=node.depth,
            category_url=node.category_url,
            is_leaf=node.is_leaf,
            children=[],
        )

    roots: list[CategoryTreeNode] = []
    for node in nodes:
        item = lookup[node.id]
        if node.parent_id and node.parent_id in lookup:
            lookup[node.parent_id].children.append(item)
        else:
            roots.append(item)
    return roots


def collect_leaf_urls(db: Session, category_ids: list[int]) -> list[str]:
    """선택된 카테고리(및 그 하위 leaf)의 URL을 모은다. URL이 없으면 제외."""
    if not category_ids:
        return []
    nodes = db.scalars(select(Category)).all()
    children_of: dict[int | None, list[Category]] = {}
    by_id = {n.id: n for n in nodes}
    for n in nodes:
        children_of.setdefault(n.parent_id, []).append(n)

    urls: list[str] = []
    stack = [by_id[cid] for cid in category_ids if cid in by_id]
    seen: set[int] = set()
    while stack:
        node = stack.pop()
        if node.id in seen:
            continue
        seen.add(node.id)
        kids = children_of.get(node.id, [])
        if kids:
            stack.extend(kids)
        elif node.category_url:
            urls.append(node.category_url)
    return urls


def fetch_official_categories() -> list[CategoryImportRow]:
    """쿠팡 공식 카테고리 데이터 연동 자리(미구현).

    공식 API/공개 데이터 접근 권한을 확보하면 여기서만 구현하면 된다.
    확보 전까지는 임의의 카테고리를 만들어내지 않는다.
    """
    raise NotImplementedError(
        "쿠팡 공식 카테고리 데이터 연동은 아직 구현하지 않았습니다. "
        "JSON/CSV import(POST /api/categories/import)를 사용하세요."
    )
