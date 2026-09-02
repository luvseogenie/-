from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class SettingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    review_sales_multiplier: int


class SettingUpdate(BaseModel):
    # 화면에서 10/15/20/25/30/50 등으로 바꾼다. 하드코딩하지 않는다.
    review_sales_multiplier: int = Field(ge=1, le=1000)


class SettingUpdateResult(SettingOut):
    recalculated_products: int = 0
