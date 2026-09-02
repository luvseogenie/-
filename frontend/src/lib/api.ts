import type {
  SavedProduct,
  CategoryTreeNode,
  CollectionJob,
  Conditions,
  ProductListResponse,
  ScanStatus,
  Settings,
  Stats,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      `백엔드에 연결할 수 없습니다 (${API_BASE}). uvicorn이 실행 중인지 확인하세요.`,
      0,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(`${res.status} ${res.statusText}${detail ? ` - ${detail}` : ""}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 조건 + 카테고리 선택을 쿼리스트링으로 바꾼다. 빈 값은 보내지 않는다. */
export function buildQuery(
  conditions: Conditions,
  categoryIds: number[],
  extra: Record<string, string | number | boolean | undefined> = {},
): string {
  const params = new URLSearchParams();
  const numeric: (keyof Conditions)[] = [
    "price_min",
    "price_max",
    "review_min",
    "review_max",
    "sales_min",
    "sales_max",
    "purchase_min",
    "purchase_max",
    "monthly_sales_min",
    "monthly_sales_max",
    "monthly_review_min",
    "monthly_review_max",
    "rating_min",
    "rating_max",
  ];
  for (const key of numeric) {
    const value = conditions[key] as string;
    if (value !== "" && value !== undefined && value !== null) params.set(key, value);
  }
  if (conditions.delivery_types.length > 0) {
    params.set("delivery_types", conditions.delivery_types.join(","));
  }
  if (categoryIds.length > 0) params.set("category_ids", categoryIds.join(","));
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const api = {
  categoryTree: () => request<CategoryTreeNode[]>("/api/categories?tree=true"),
  products: (query: string) => request<ProductListResponse>(`/api/products${query}`),
  stats: (query: string) => request<Stats>(`/api/stats${query}`),
  settings: () => request<Settings>("/api/settings"),
  updateSettings: (multiplier: number) =>
    request<Settings & { recalculated_products: number }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ review_sales_multiplier: multiplier }),
    }),
  startJob: (categoryIds: number[]) =>
    request<{ job: CollectionJob; target_urls: string[] }>("/api/collection-jobs", {
      method: "POST",
      body: JSON.stringify({ category_ids: categoryIds }),
    }),
  activeJob: () => request<CollectionJob | null>("/api/collection-jobs/active"),

  /** 자동 스캔 */
  scanStart: (body: {
    category_ids: number[];
    pages_per_category: number;
    detail_limit: number;
    conditions: {
      price_min?: number | null;
      price_max?: number | null;
      review_min?: number | null;
      review_max?: number | null;
      rating_min?: number | null;
      rating_max?: number | null;
      delivery_types: string[];
    };
  }) =>
    request<{ job_id: number; list_targets: number; message: string }>("/api/scan/start", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  scanStatus: () => request<ScanStatus | null>("/api/scan/status"),
  scanPause: () => request<ScanStatus | null>("/api/scan/pause", { method: "POST" }),
  scanResume: () => request<ScanStatus | null>("/api/scan/resume", { method: "POST" }),
  scanStop: () => request<ScanStatus | null>("/api/scan/stop", { method: "POST" }),

  /** 엑셀(CSV) 내려받기 주소 — 브라우저가 직접 열어 저장하게 한다 */
  exportUrl: (query: string) => `${API_BASE}/api/products/export${query}`,
  health: () => request<{ status: string; app: string; version?: string }>("/api/health"),
  diagnostics: () => request<Record<string, unknown>>("/api/diagnostics"),
  saved: () => request<SavedProduct[]>("/api/saved"),
  saveProducts: (productIds: number[], scanJobId?: number | null) =>
    request<{ added: number; skipped: number; total: number }>("/api/saved", {
      method: "POST",
      body: JSON.stringify({ product_ids: productIds, scan_job_id: scanJobId ?? null }),
    }),
  unsaveProduct: (productId: number) =>
    request<{ removed: number }>(`/api/saved/by-product/${productId}`, { method: "DELETE" }),
  removeSaved: (savedId: number) => request<{ removed: number }>(`/api/saved/${savedId}`, { method: "DELETE" }),
  updateSavedMemo: (savedId: number, memo: string) =>
    request<SavedProduct>(`/api/saved/${savedId}`, { method: "PATCH", body: JSON.stringify({ memo }) }),
  savedExportUrl: () => `${API_BASE}/api/saved/export`,
  finishJob: (id: number) =>
    request<CollectionJob>(`/api/collection-jobs/${id}/finish`, { method: "POST" }),
};
