from __future__ import annotations

from pydantic import BaseModel


class StatsOut(BaseModel):
    """상단 KPI 카드용."""

    selected_categories: int  # 요청에 담겨온 선택 카테고리 수
    collected_products: int  # 지금까지 수집(감지)된 총 개수 — 중복 포함
    unique_products: int  # 중복 제외 상품 수 (products 테이블 행 수)
    condition_passed_products: int  # 현재 조건을 통과한 상품 수
    # 최근 30일 리뷰수를 확보한 상품 수 (전체 대비 얼마나 측정됐는지)
    monthly_measured_products: int = 0
    # 쿠팡 월간 구매 문구를 확보한 상품 수
    purchase_labeled_products: int = 0
    # 조건은 통과했지만 아직 구매 문구를 확인하지 못한 상품 수 (= 상세 확인 대기)
    purchase_pending_products: int = 0
    # 1차 조건은 통과했지만 최근 30일 리뷰수를 아직 못 잰 상품 수 (= 2단계 대기)
    monthly_pending_products: int = 0
    # 조건 통과 상품의 30일 예상매출 합계(원) — 30일 예상 판매량 × 가격
    passed_monthly_revenue: int = 0
    review_sales_multiplier: int
