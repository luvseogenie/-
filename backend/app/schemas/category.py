from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class CategoryBase(BaseModel):
    category_code: str
    category_name: str
    depth: int = 1
    category_url: str | None = None
    is_leaf: bool = True


class CategoryOut(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    parent_id: int | None = None


class CategoryTreeNode(CategoryOut):
    children: list["CategoryTreeNode"] = Field(default_factory=list)


CategoryTreeNode.model_rebuild()


class CategoryImportRow(BaseModel):
    """JSON/CSV import 한 행. 요구사항 4의 포맷."""

    category_code: str
    category_name: str
    parent_category_code: str | None = None
    depth: int | None = None
    category_url: str | None = None


class CategoryImportRequest(BaseModel):
    rows: list[CategoryImportRow]


class CategoryImportResult(BaseModel):
    received: int
    created: int
    updated: int
    skipped: int
    errors: list[str] = Field(default_factory=list)
