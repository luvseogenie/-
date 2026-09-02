from __future__ import annotations

from pydantic import BaseModel


class StatsOut(BaseModel):
    """상단 KPI 카드용."""

    selected_categories: int  # 요청에 담겨온 선택 카테고리 수
    collected_products: int  # 지금까지 수집(감지)된 총 개수 — 중복 포함
    unique_products: int  # 중복 제외 상품 수 (products 테이블 행 수)
    condition_passed_products: int  # 현재 조건을 통과한 상품 수
    review_sales_multiplier: int
