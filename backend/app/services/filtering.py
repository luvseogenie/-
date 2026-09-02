"""상품 조건 필터.

요구사항 8의 조건(가격/리뷰수/예상 판매량/평점/배송방식)을 하나의 객체로 묶고,
  - SQLAlchemy where 절 생성
  - 개별 상품의 condition_passed 판정
두 가지 용도로 함께 쓴다. 두 경로가 항상 같은 규칙을 쓰도록 한 곳에 둔다.

condition_passed는 DB 컬럼이 아니다. 조건이 바뀌면 결과도 바뀌어야 하므로
조회 시점에 계산한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import ColumnElement, and_

from app.models.product import MonthlyConfidence, Product

# "이 수준 이상"에 해당하는 신뢰도 값들
CONFIDENCE_AT_LEAST: dict[str, list[str]] = {
    MonthlyConfidence.LOW: [MonthlyConfidence.LOW, MonthlyConfidence.MEDIUM, MonthlyConfidence.HIGH],
    MonthlyConfidence.MEDIUM: [MonthlyConfidence.MEDIUM, MonthlyConfidence.HIGH],
    MonthlyConfidence.HIGH: [MonthlyConfidence.HIGH],
}


@dataclass(slots=True)
class ProductFilter:
    price_min: int | None = None
    price_max: int | None = None
    review_min: int | None = None
    review_max: int | None = None
    sales_min: int | None = None
    sales_max: int | None = None
    # 최근 30일 예상 판매량 / 리뷰수
    monthly_sales_min: int | None = None
    monthly_sales_max: int | None = None
    monthly_review_min: int | None = None
    monthly_review_max: int | None = None
    # 쿠팡이 표시한 월간 구매자 수 ("한 달간 3,000명 이상 구매했어요")
    # 소싱 기준(월 500개/1,000개 이상)을 판단하는 1순위 근거다.
    purchase_min: int | None = None
    purchase_max: int | None = None
    # 신뢰도가 이 수준 미만인 측정값은 조건 통과로 보지 않는다.
    # (표본 부족으로 튄 값이 소싱 후보에 섞이는 것을 막는다)
    min_confidence: str | None = None
    rating_min: float | None = None
    rating_max: float | None = None
    # 빈 리스트 또는 None = 전체(배송방식 무관)
    delivery_types: list[str] = field(default_factory=list)
    category_ids: list[int] = field(default_factory=list)
    keyword: str | None = None

    # ---------------- SQL 조건 ----------------
    def where_clauses(self) -> list[ColumnElement[bool]]:
        clauses: list[ColumnElement[bool]] = []
        if self.price_min is not None:
            clauses.append(Product.price.isnot(None) & (Product.price >= self.price_min))
        if self.price_max is not None:
            clauses.append(Product.price.isnot(None) & (Product.price <= self.price_max))
        if self.review_min is not None:
            clauses.append(Product.review_count >= self.review_min)
        if self.review_max is not None:
            clauses.append(Product.review_count <= self.review_max)
        if self.sales_min is not None:
            clauses.append(Product.estimated_sales >= self.sales_min)
        if self.sales_max is not None:
            clauses.append(Product.estimated_sales <= self.sales_max)
        if self.monthly_sales_min is not None:
            clauses.append(
                Product.monthly_estimated_sales.isnot(None)
                & (Product.monthly_estimated_sales >= self.monthly_sales_min)
            )
        if self.monthly_sales_max is not None:
            clauses.append(
                Product.monthly_estimated_sales.isnot(None)
                & (Product.monthly_estimated_sales <= self.monthly_sales_max)
            )
        if self.monthly_review_min is not None:
            clauses.append(
                Product.monthly_review_count.isnot(None)
                & (Product.monthly_review_count >= self.monthly_review_min)
            )
        if self.monthly_review_max is not None:
            clauses.append(
                Product.monthly_review_count.isnot(None)
                & (Product.monthly_review_count <= self.monthly_review_max)
            )
        if self.purchase_min is not None:
            clauses.append(
                Product.monthly_purchase_count.isnot(None)
                & (Product.monthly_purchase_count >= self.purchase_min)
            )
        if self.purchase_max is not None:
            clauses.append(
                Product.monthly_purchase_count.isnot(None)
                & (Product.monthly_purchase_count <= self.purchase_max)
            )
        if self.min_confidence:
            allowed = CONFIDENCE_AT_LEAST.get(self.min_confidence)
            if allowed:
                clauses.append(Product.monthly_review_confidence.in_(allowed))
        if self.rating_min is not None:
            clauses.append(Product.rating.isnot(None) & (Product.rating >= self.rating_min))
        if self.rating_max is not None:
            clauses.append(Product.rating.isnot(None) & (Product.rating <= self.rating_max))
        if self.delivery_types:
            clauses.append(Product.delivery_type.in_(self.delivery_types))
        return clauses

    def condition_expression(self) -> ColumnElement[bool] | None:
        clauses = self.where_clauses()
        if not clauses:
            return None
        return and_(*clauses)

    # ---------------- 파이썬 판정 ----------------
    def passes(self, product: Product) -> bool:
        """DB에서 가져온 상품 한 건이 조건을 모두 만족하는지."""
        if not self._in_range(product.price, self.price_min, self.price_max, required=True):
            return False
        if not self._in_range(product.review_count, self.review_min, self.review_max, required=True):
            return False
        if not self._in_range(product.estimated_sales, self.sales_min, self.sales_max, required=True):
            return False
        if not self._in_range(
            product.monthly_purchase_count, self.purchase_min, self.purchase_max, required=True
        ):
            return False
        if not self._in_range(
            product.monthly_estimated_sales, self.monthly_sales_min, self.monthly_sales_max, required=True
        ):
            return False
        if not self._in_range(
            product.monthly_review_count, self.monthly_review_min, self.monthly_review_max, required=True
        ):
            return False
        if not self._in_range(product.rating, self.rating_min, self.rating_max, required=True):
            return False
        if self.delivery_types and product.delivery_type not in self.delivery_types:
            return False
        if self.min_confidence:
            allowed = CONFIDENCE_AT_LEAST.get(self.min_confidence)
            if allowed and product.monthly_review_confidence not in allowed:
                return False
        return True

    @staticmethod
    def _in_range(value, low, high, required: bool) -> bool:
        if low is None and high is None:
            return True
        if value is None:
            # 값이 없는데 범위 조건이 걸려 있으면 통과로 볼 수 없다.
            # (없는 값을 임의로 채워 통과시키지 않는다.)
            return not required
        if low is not None and value < low:
            return False
        if high is not None and value > high:
            return False
        return True

    def is_empty(self) -> bool:
        return not self.where_clauses()


SORT_FIELDS = {
    "purchase_desc": (Product.monthly_purchase_count, "desc"),
    "purchase_asc": (Product.monthly_purchase_count, "asc"),
    "monthly_sales_desc": (Product.monthly_estimated_sales, "desc"),
    "monthly_sales_asc": (Product.monthly_estimated_sales, "asc"),
    "monthly_review_desc": (Product.monthly_review_count, "desc"),
    "monthly_review_asc": (Product.monthly_review_count, "asc"),
    "price_desc": (Product.price, "desc"),
    "price_asc": (Product.price, "asc"),
    "review_desc": (Product.review_count, "desc"),
    "review_asc": (Product.review_count, "asc"),
    "sales_desc": (Product.estimated_sales, "desc"),
    "sales_asc": (Product.estimated_sales, "asc"),
    "rating_desc": (Product.rating, "desc"),
    "rating_asc": (Product.rating, "asc"),
    "collected_desc": (Product.last_collected_at, "desc"),
    "collected_asc": (Product.last_collected_at, "asc"),
}


def sort_expression(sort: str | None):
    column, direction = SORT_FIELDS.get(sort or "sales_desc", SORT_FIELDS["sales_desc"])
    # NULL이 정렬 결과를 어지럽히지 않도록 뒤로 보낸다.
    if direction == "desc":
        return [column.is_(None), column.desc(), Product.id.desc()]
    return [column.is_(None), column.asc(), Product.id.asc()]
