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
const AUTO_COLLECT_KEY = "autoCollectProductPages";

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

/**
 * 상품 상세 페이지를 열면 자동으로 수집할지.
 *
 * 쿠팡의 "한 달간 N명 이상 구매했어요" 문구는 상품 상세 페이지에만 있다.
 * 후보 상품을 하나씩 열어 확인해야 하는데, 매번 버튼을 누르는 건 번거롭다.
 * 이 옵션을 켜면 사용자가 연 상품 페이지를 자동으로 저장한다.
 * (사용자가 직접 연 페이지만 읽는다. 자동으로 페이지를 열지 않는다.)
 */
export async function getAutoCollect(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(AUTO_COLLECT_KEY);
    return stored[AUTO_COLLECT_KEY] === true;
  } catch {
    return false;
  }
}

export async function setAutoCollect(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [AUTO_COLLECT_KEY]: enabled });
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
  /** 카테고리 경로 — 백엔드가 이 계층을 자동으로 만든다 */
  category_path: { code: string | null; name: string }[];
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

export type ScanTarget = {
  id: number;
  job_id: number;
  kind: "list" | "detail";
  url: string;
  label: string | null;
  page: number | null;
  position: number;
  status: string;
  attempts: number;
};

export type ScanStatus = {
  job_id: number;
  status: "running" | "paused" | "completed" | "stopped";
  phase: "list" | "detail";
  list: { total: number; done: number; failed: number; pending: number };
  detail: { total: number; done: number; failed: number; pending: number };
  total: number;
  done: number;
  failed: number;
  current_label: string | null;
};

export type CategoryImportRow = {
  category_code: string;
  category_name: string;
  parent_category_code: string | null;
  category_url: string | null;
};

export type CategoryImportResult = {
  received: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export const api = {
  health: () => request<{ status: string }>("/api/health"),
  importCategories: (rows: CategoryImportRow[]) =>
    request<CategoryImportResult>("/api/categories/import", {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),
  activeJob: () => request<{ id: number } | null>("/api/collection-jobs/active"),
  collect: (payload: CollectPayload) =>
    request<CollectResponse>("/api/products/collect", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  scanNext: () => request<ScanTarget | null>("/api/scan/next"),
  scanDone: (
    targetId: number,
    body: {
      product_count?: number | null;
      error?: string | null;
      discovered_children?: { category_code: string; category_name: string; category_url: string | null }[];
    },
  ) =>
    request<ScanTarget>(`/api/scan/targets/${targetId}/done`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  scanStatus: () => request<ScanStatus | null>("/api/scan/status"),
  scanPause: () => request<ScanStatus | null>("/api/scan/pause", { method: "POST" }),
  scanResume: () => request<ScanStatus | null>("/api/scan/resume", { method: "POST" }),
  scanStop: () => request<ScanStatus | null>("/api/scan/stop", { method: "POST" }),
  submitReviewDates: (payload: ReviewDatePayload) =>
    request<MonthlyReviewResponse>("/api/products/review-dates", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
