/** 확장 ↔ 백엔드 공통 타입 (backend/app/schemas/product.py 와 대응) */

export type DeliveryType = "rocket" | "rocket_growth" | "seller" | "unknown";

export type CollectedProduct = {
  product_id: string;
  product_name: string;
  product_url: string;
  price: number | null;
  review_count: number;
  rating: number | null;
  delivery_type: DeliveryType | null;
  thumbnail_url: string | null;
  rank: number | null;
  /** 현재 DOM에서 조회수를 얻을 수 없다. 항상 null로 보낸다. */
  view_count: null;

  /**
   * 쿠팡이 표시하는 월간 구매 문구 ("한 달간 3,000명 이상 구매했어요").
   * 우리가 추정한 값이 아니라 쿠팡이 계산한 실제 데이터다.
   * 문구가 없으면 전부 null — 만들어내지 않는다.
   */
  monthly_purchase_count: number | null;
  monthly_purchase_is_minimum: boolean | null;
  monthly_purchase_unit: string | null;
  monthly_purchase_text: string | null;
};

export type PageType = "category" | "search" | "list" | "product" | "unknown";

export type ParseResult = {
  products: CollectedProduct[];
  /** 카드는 찾았지만 필수값이 없어 제외한 개수 */
  skipped: number;
  /** 제외 사유 (로그용) */
  errors: string[];
  pageType: PageType;
  categoryCode: string | null;
  categoryName: string | null;
  /** 카테고리 경로 (홈인테리어 > 카페트/매트 > 발매트) */
  categoryPath: { code: string | null; name: string }[];
  sourceUrl: string;
  /** 어떤 selector로 카드를 찾았는지 (디버깅용) */
  matchedCardSelector: string | null;
};

export type CollectResponse = {
  job_id: number | null;
  received: number;
  inserted: number;
  updated: number;
  duplicates: number;
  skipped: number;
  saved: number;
  errors: string[];
};

/** popup ↔ background ↔ content 메시지 */
export type ReviewDateResult = {
  reviewsInWindow: number;
  sampleSize: number;
  sampleSpanDays: number | null;
  coversWindow: boolean;
  newestReviewDate: string | null;
  oldestReviewDate: string | null;
  totalReviewCount: number | null;
  sortedByNewest: boolean | null;
  warnings: string[];
  productId: string | null;
  productUrl: string;
  /** 지금까지 누적한 리뷰 페이지 수 */
  pagesSeen: number;
};

export type MonthlyReviewResponse = {
  product_id: string;
  applied: boolean;
  monthly_review_count: number | null;
  monthly_estimated_sales: number | null;
  monthly_review_method: string | null;
  monthly_review_window_days: number | null;
  monthly_review_is_extrapolated: boolean;
  message: string;
};

export type ScanMessage = { type: "SCAN" };
export type CollectMessage = { type: "COLLECT" };
export type GetStateMessage = { type: "GET_STATE" };

export type AnalyzeReviewsMessage = { type: "ANALYZE_REVIEWS" };
export type ResetReviewsMessage = { type: "RESET_REVIEWS" };
export type DiagnoseMessage = { type: "DIAGNOSE" };

export type ExtensionMessage =
  | ScanMessage
  | CollectMessage
  | GetStateMessage
  | AnalyzeReviewsMessage
  | ResetReviewsMessage
  | DiagnoseMessage;

export type ScanSummary = {
  detected: number;
  skipped: number;
  pageType: PageType;
  categoryName: string | null;
  matchedCardSelector: string | null;
  errors: string[];
};
