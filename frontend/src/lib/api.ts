import type {
  CategoryTreeNode,
  CollectionJob,
  Conditions,
  ProductListResponse,
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
  finishJob: (id: number) =>
    request<CollectionJob>(`/api/collection-jobs/${id}/finish`, { method: "POST" }),
};
