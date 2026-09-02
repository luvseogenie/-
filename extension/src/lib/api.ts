/**
 * 백엔드 통신.
 * fetch는 service worker에서만 호출한다(CORS/권한 관리를 한 곳에 모으기 위해).
 */
import { log } from "@/lib/logger";
import type {
  CollectedProduct,
  CollectResponse,
  MonthlyReviewResponse,
  PageType,
} from "@/lib/types";

export const DEFAULT_API_BASE = "http://localhost:8000";
const API_BASE_KEY = "apiBaseUrl";

export async function getApiBase(): Promise<string> {
  try {
    const stored = await chrome.storage.local.get(API_BASE_KEY);
    const value = stored[API_BASE_KEY];
    if (typeof value === "string" && value.trim() !== "") return value.replace(/\/$/, "");
  } catch {
    // storage 접근 실패 시 기본값 사용
  }
  return DEFAULT_API_BASE;
}

export async function setApiBase(url: string): Promise<void> {
  await chrome.storage.local.set({ [API_BASE_KEY]: url.replace(/\/$/, "") });
}

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getApiBase();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (e) {
    const message = `백엔드(${base})에 연결할 수 없습니다. uvicorn이 실행 중인지 확인하세요.`;
    log.error(message, e);
    throw new ApiError(message);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const message = `백엔드 오류 ${res.status}: ${detail.slice(0, 200)}`;
    log.error(message);
    throw new ApiError(message);
  }
  return (await res.json()) as T;
}

export type CollectPayload = {
  source_url: string;
  page_type: PageType;
  category_code: string | null;
  category_name: string | null;
  job_id: number | null;
  products: CollectedProduct[];
  skipped: number;
  parse_errors: string[];
};

export type ReviewDatePayload = {
  product_id: string;
  product_url: string | null;
  reviews_in_window: number;
  sample_size: number;
  sample_span_days: number | null;
  covers_window: boolean;
  newest_review_date: string | null;
  oldest_review_date: string | null;
  total_review_count: number | null;
};

export const api = {
  health: () => request<{ status: string }>("/api/health"),
  activeJob: () => request<{ id: number } | null>("/api/collection-jobs/active"),
  collect: (payload: CollectPayload) =>
    request<CollectResponse>("/api/products/collect", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  submitReviewDates: (payload: ReviewDatePayload) =>
    request<MonthlyReviewResponse>("/api/products/review-dates", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
