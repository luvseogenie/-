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

export type ExtensionMessage =
  | ScanMessage
  | CollectMessage
  | GetStateMessage
  | AnalyzeReviewsMessage;

export type ScanSummary = {
  detected: number;
  skipped: number;
  pageType: PageType;
  categoryName: string | null;
  matchedCardSelector: string | null;
  errors: string[];
};
