from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.category import (
    CategoryImportRequest,
    CategoryImportResult,
    CategoryOut,
    CategoryTreeNode,
)
from app.services import category_service

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut] | list[CategoryTreeNode])
def list_categories(
    tree: bool = Query(False, description="true면 전체 트리를 중첩 구조로 반환"),
    parent_id: int | None = Query(None, description="특정 부모의 자식만 조회"),
    root_only: bool = Query(False, description="1차 카테고리만"),
    leaf_only: bool = Query(False, description="최하위 카테고리만"),
    db: Session = Depends(get_db),
):
    if tree:
        return category_service.build_tree(db)
    if root_only:
        return category_service.list_categories(db, parent_id=None, leaf_only=leaf_only)
    if parent_id is not None:
        return category_service.get_children(db, parent_id)
    return category_service.list_categories(db, include_all=True, leaf_only=leaf_only)


@router.get("/{category_id}/children", response_model=list[CategoryOut])
def get_children(category_id: int, db: Session = Depends(get_db)):
    from app.models.category import Category

    if db.get(Category, category_id) is None:
        raise HTTPException(status_code=404, detail="카테고리를 찾을 수 없습니다.")
    return category_service.get_children(db, category_id)


@router.post("/import", response_model=CategoryImportResult)
def import_categories_json(payload: CategoryImportRequest, db: Session = Depends(get_db)):
    """JSON 본문으로 카테고리 일괄 import."""
    result = category_service.import_categories(db, payload.rows)
    db.commit()
    return result


@router.post("/import/file", response_model=CategoryImportResult)
async def import_categories_file(
    file: UploadFile = File(..., description="JSON 또는 CSV 파일"),
    db: Session = Depends(get_db),
):
    raw = await file.read()
    try:
        rows = category_service.parse_rows(raw, file.filename)
    except Exception as exc:  # 파싱 실패 원인을 그대로 알려준다.
        raise HTTPException(status_code=400, detail=f"파일 파싱 실패: {exc}") from exc
    result = category_service.import_categories(db, rows)
    db.commit()
    return result
