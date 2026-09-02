from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.setting import SettingOut, SettingUpdate, SettingUpdateResult
from app.services import estimation

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingOut)
def get_settings(db: Session = Depends(get_db)):
    row = estimation.get_settings_row(db)
    db.commit()
    return row


@router.put("", response_model=SettingUpdateResult)
def update_settings(payload: SettingUpdate, db: Session = Depends(get_db)):
    """배수를 바꾸면 저장된 모든 상품의 예상 판매량을 다시 계산한다."""
    row = estimation.get_settings_row(db)
    row.review_sales_multiplier = payload.review_sales_multiplier
    recalculated = estimation.recalculate_all(db, payload.review_sales_multiplier)
    db.commit()
    db.refresh(row)
    return SettingUpdateResult(
        id=row.id,
        review_sales_multiplier=row.review_sales_multiplier,
        recalculated_products=recalculated,
    )
