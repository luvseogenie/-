/** 백엔드 API 타입 정의 (backend/app/schemas 와 1:1 대응) */

export type Category = {
  id: number;
  parent_id: number | null;
  category_code: string;
  category_name: string;
  depth: number;
  category_url: string | null;
  is_leaf: boolean;
};

export type CategoryTreeNode = Category & { children: CategoryTreeNode[] };

/** 배송 방식 코드. 백엔드 DeliveryType 과 동일하게 유지한다. */
export const DELIVERY_TYPES = {
  rocket_growth: "로켓그로스",
  rocket: "로켓배송",
  seller: "판매자배송",
  unknown: "미확인",
} as const;

export type DeliveryType = keyof typeof DELIVERY_TYPES;

/** 최근 30일 리뷰수를 어떻게 구했는지 */
export const MONTHLY_METHODS = {
  review_dates: { label: "리뷰 날짜", hint: "상품 상세 페이지의 리뷰 작성일을 직접 세어 구한 값" },
  snapshot_delta: { label: "리뷰 추적", hint: "수집할 때마다 저장한 누적 리뷰수의 차이로 구한 값" },
} as const;

export type MonthlyMethod = keyof typeof MONTHLY_METHODS;

export type Product = {
  id: number;
  product_id: string;
  product_name: string;
  product_url: string;
  price: number | null;
  review_count: number;
  /** 예상 판매량 = 리뷰수 x 배수. 실제 판매량이 아니다. */
  estimated_sales: number;
  rating: number | null;
  delivery_type: DeliveryType | null;
  thumbnail_url: string | null;
  /** 데이터 원천이 없어 항상 null. UI에는 "-" 로 표시한다. */
  view_count: number | null;
  category_id: number | null;
  category_name: string | null;
  rank: number | null;

  /** 최근 30일 리뷰수. 아직 구할 수 없으면 null (임의 값 생성 안 함). */
  monthly_review_count: number | null;
  /** 최근 30일 예상 판매량 = 최근 30일 리뷰수 × 배수. 실제 판매량 아님. */
  monthly_estimated_sales: number | null;
  monthly_review_method: MonthlyMethod | null;
  /** 실제로 관측한 구간(일) */
  monthly_review_window_days: number | null;
  /** 30일을 다 못 덮어 환산한 추정값인지 */
  monthly_review_is_extrapolated: boolean;
  monthly_review_measured_at: string | null;

  first_collected_at: string;
  last_collected_at: string;
  condition_passed: boolean;
};

export type ProductListResponse = {
  items: Product[];
  total: number;
  page: number;
  page_size: number;
};

export type Stats = {
  selected_categories: number;
  collected_products: number;
  unique_products: number;
  condition_passed_products: number;
  /** 최근 30일 리뷰수를 확보한 상품 수 */
  monthly_measured_products: number;
  review_sales_multiplier: number;
};

export type Settings = {
  id: number;
  review_sales_multiplier: number;
};

export type CollectionJob = {
  id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  total_products: number;
  collected_products: number;
  error_message: string | null;
};

/** 상품 조건 (요구사항 8) */
export type Conditions = {
  price_min: string;
  price_max: string;
  review_min: string;
  review_max: string;
  sales_min: string;
  sales_max: string;
  monthly_sales_min: string;
  monthly_sales_max: string;
  monthly_review_min: string;
  monthly_review_max: string;
  rating_min: string;
  rating_max: string;
  /** 빈 배열 = 전체 */
  delivery_types: DeliveryType[];
};

export const DEFAULT_CONDITIONS: Conditions = {
  price_min: "",
  price_max: "",
  review_min: "",
  review_max: "",
  sales_min: "",
  sales_max: "",
  monthly_sales_min: "",
  monthly_sales_max: "",
  monthly_review_min: "",
  monthly_review_max: "",
  rating_min: "",
  rating_max: "",
  delivery_types: [],
};

export const SORT_OPTIONS = [
  { value: "monthly_sales_desc", label: "최근 30일 판매량 많은순" },
  { value: "monthly_sales_asc", label: "최근 30일 판매량 적은순" },
  { value: "monthly_review_desc", label: "최근 30일 리뷰 많은순" },
  { value: "monthly_review_asc", label: "최근 30일 리뷰 적은순" },
  { value: "sales_desc", label: "예상 판매량 많은순" },
  { value: "sales_asc", label: "예상 판매량 적은순" },
  { value: "price_desc", label: "가격 높은순" },
  { value: "price_asc", label: "가격 낮은순" },
  { value: "review_desc", label: "리뷰 많은순" },
  { value: "review_asc", label: "리뷰 적은순" },
  { value: "rating_desc", label: "평점 높은순" },
  { value: "rating_asc", label: "평점 낮은순" },
  { value: "collected_desc", label: "최근 수집순" },
] as const;

/** 배수 프리셋. 사용자가 직접 입력도 할 수 있어야 하므로 하드코딩된 값만 쓰지 않는다. */
export const MULTIPLIER_PRESETS = [10, 15, 20, 25, 30, 50];
