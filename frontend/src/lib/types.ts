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

  /**
   * 쿠팡이 직접 표시한 월간 구매 데이터.
   *   "한 달간 3,000명 이상 구매했어요"
   * 우리 추정치가 아니라 쿠팡이 계산한 실제 판매 데이터다.
   * 문구가 없는 상품은 null.
   */
  monthly_purchase_count: number | null;
  /** "이상"이 붙은 구간값인지 */
  monthly_purchase_is_minimum: boolean | null;
  /** "명"(구매자 수) 또는 "개"(수량) */
  monthly_purchase_unit: string | null;
  /** 원문 문구 */
  monthly_purchase_text: string | null;
  monthly_purchase_collected_at: string | null;

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
  monthly_review_sample_size: number | null;
  monthly_review_confidence: "high" | "medium" | "low" | null;

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
  /** 쿠팡 월간 구매 문구를 확보한 상품 수 */
  purchase_labeled_products: number;
  /** 다른 조건은 통과했지만 아직 구매 문구를 확인하지 못한 상품 수 */
  purchase_pending_products: number;
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
  purchase_min: string;
  purchase_max: string;
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
  purchase_min: "",
  purchase_max: "",
  monthly_sales_min: "",
  monthly_sales_max: "",
  monthly_review_min: "",
  monthly_review_max: "",
  rating_min: "",
  rating_max: "",
  delivery_types: [],
};

export const SORT_OPTIONS = [
  { value: "purchase_desc", label: "한 달 구매 많은순" },
  { value: "purchase_asc", label: "한 달 구매 적은순" },
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

/**
 * 소싱 기준 프리셋.
 * 쿠팡이 표시하는 "한 달간 N명 이상 구매했어요" 문구를 기준으로 한다.
 * (우리가 추정한 값이 아니라 쿠팡의 실제 판매 데이터)
 */
export const SOURCING_PRESETS = [
  { label: "월 500개 이상", purchaseMin: 500, note: "최소 기준" },
  { label: "월 1,000개 이상", purchaseMin: 1000, note: "주력 기준" },
  { label: "월 3,000개 이상", purchaseMin: 3000, note: "상위" },
] as const;

/** 측정 신뢰도 라벨 */
export const CONFIDENCE_LABELS = {
  high: { label: "높음", tone: "success" },
  medium: { label: "보통", tone: "warning" },
  low: { label: "낮음", tone: "muted" },
} as const;

/** 배수 프리셋. 사용자가 직접 입력도 할 수 있어야 하므로 하드코딩된 값만 쓰지 않는다. */
export const MULTIPLIER_PRESETS = [10, 15, 20, 25, 30, 50];


/** 자동 스캔 진행 상태 (backend/app/schemas/scan.py 와 대응) */
export type ScanPhaseProgress = { total: number; done: number; failed: number; pending: number };

export type ScanStatus = {
  job_id: number;
  status: "running" | "paused" | "completed" | "stopped";
  phase: "list" | "detail";
  list: ScanPhaseProgress;
  detail: ScanPhaseProgress;
  total: number;
  done: number;
  failed: number;
  current_label: string | null;
  started_at: string;
  finished_at: string | null;
};

/** 카테고리마다 훑을 목록 페이지 수 선택지 (판매량순이라 앞쪽이 중요) */
export const PAGES_OPTIONS = [1, 2, 3, 5, 10] as const;
/** 2단계에서 상세를 확인할 상품 수 선택지 */
export const DETAIL_LIMIT_OPTIONS = [20, 50, 100, 200] as const;
