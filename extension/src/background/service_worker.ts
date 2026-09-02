/**
 * Service worker (MV3 background).
 *
 * popup ↔ content script 중계 + 백엔드 전송을 담당한다.
 * fetch를 여기에 모아 두면 CORS/권한 문제를 한 곳에서 다룰 수 있다.
 */
import { api, ApiError, type CollectPayload } from "@/lib/api";
import {
  getRunnerState,
  pauseRunner,
  resumeRunner,
  startRunner,
  stopRunnerAndJob,
} from "@/background/scan_runner";
import { log } from "@/lib/logger";
import type {
  CollectResponse,
  MonthlyReviewResponse,
  ParseResult,
  ReviewDateResult,
} from "@/lib/types";

const COUPANG_HOST = /(^|\.)coupang\.com$/;

function isCoupangUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return COUPANG_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/** content script에게 현재 페이지를 스캔시킨다. */
async function scanTab(tabId: number): Promise<ParseResult> {
  const response = await chrome.tabs.sendMessage(tabId, { type: "SCAN" }).catch((e: unknown) => {
    throw new Error(
      `페이지와 통신할 수 없습니다. 쿠팡 페이지를 새로고침한 뒤 다시 시도하세요. (${
        e instanceof Error ? e.message : String(e)
      })`,
    );
  });
  if (!response?.ok) throw new Error(response?.error ?? "페이지 파싱에 실패했습니다.");
  return response.result as ParseResult;
}

async function handleScan(): Promise<{ ok: boolean; result?: ParseResult; error?: string }> {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: "활성 탭을 찾을 수 없습니다." };
  if (!tab.url) {
    return {
      ok: false,
      error: "현재 탭의 주소를 읽을 수 없습니다. 확장 프로그램 권한을 확인한 뒤 페이지를 새로고침하세요.",
    };
  }
  if (!isCoupangUrl(tab.url)) {
    return { ok: false, error: "쿠팡 페이지가 아닙니다. 쿠팡 카테고리/검색/상품 페이지를 열어주세요." };
  }
  try {
    return { ok: true, result: await scanTab(tab.id) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error("스캔 실패:", message);
    return { ok: false, error: message };
  }
}

async function handleCollect(): Promise<{
  ok: boolean;
  result?: CollectResponse;
  detected?: number;
  error?: string;
}> {
  const scan = await handleScan();
  if (!scan.ok || !scan.result) return { ok: false, error: scan.error };

  const parsed = scan.result;
  if (parsed.products.length === 0) {
    return {
      ok: false,
      error:
        parsed.errors[0] ??
        "현재 페이지에서 상품을 찾지 못했습니다. 목록이 모두 표시될 때까지 스크롤한 뒤 다시 시도하세요.",
    };
  }

  // 진행 중인 수집 작업이 있으면 거기에 연결한다(없으면 백엔드가 새로 만든다).
  let jobId: number | null = null;
  try {
    const job = await api.activeJob();
    jobId = job?.id ?? null;
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.message };
  }

  const payload: CollectPayload = {
    source_url: parsed.sourceUrl,
    page_type: parsed.pageType,
    category_code: parsed.categoryCode,
    category_name: parsed.categoryName,
    category_path: parsed.categoryPath ?? [],
    job_id: jobId,
    products: parsed.products,
    skipped: parsed.skipped,
    parse_errors: parsed.errors.slice(0, 50),
  };

  try {
    const result = await api.collect(payload);
    log.info("수집 결과", result);
    // 감지 개수는 popup의 '○개 감지' 표시와 같은 기준(파싱에 성공한 상품 수)을 쓴다.
    return { ok: true, result, detected: parsed.products.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

/**
 * 최근 30일 리뷰수 산출.
 *
 * 1) content script가 상세 페이지의 렌더된 리뷰 작성일을 읽는다.
 * 2) 그 결과를 백엔드에 보내 최근 30일 리뷰수 / 예상 판매량을 계산·저장한다.
 *
 * 상품이 아직 수집되지 않았으면 먼저 수집한다(상세 페이지도 수집 대상이다).
 */
async function handleAnalyzeReviews(): Promise<{
  ok: boolean;
  analysis?: ReviewDateResult;
  result?: MonthlyReviewResponse;
  error?: string;
}> {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: "활성 탭을 찾을 수 없습니다." };
  if (!isCoupangUrl(tab.url)) {
    return { ok: false, error: "쿠팡 상품 상세 페이지에서 실행하세요." };
  }

  let analysis: ReviewDateResult;
  try {
    const response = await chrome.tabs
      .sendMessage(tab.id, { type: "ANALYZE_REVIEWS" })
      .catch((e: unknown) => {
        throw new Error(
          `페이지와 통신할 수 없습니다. 새로고침 후 다시 시도하세요. (${
            e instanceof Error ? e.message : String(e)
          })`,
        );
      });
    if (!response?.ok) return { ok: false, error: response?.error ?? "리뷰 분석에 실패했습니다." };
    analysis = response.result as ReviewDateResult;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error("리뷰 분석 실패:", message);
    return { ok: false, error: message };
  }

  if (!analysis.productId) {
    return { ok: false, analysis, error: "URL에서 상품 ID를 찾지 못했습니다." };
  }
  if (analysis.sampleSize === 0) {
    return {
      ok: false,
      analysis,
      error: analysis.warnings[0] ?? "리뷰 작성일을 읽지 못했습니다.",
    };
  }

  const payload = {
    product_id: analysis.productId,
    product_url: analysis.productUrl,
    reviews_in_window: analysis.reviewsInWindow,
    sample_size: analysis.sampleSize,
    sample_span_days: analysis.sampleSpanDays,
    covers_window: analysis.coversWindow,
    newest_review_date: analysis.newestReviewDate,
    oldest_review_date: analysis.oldestReviewDate,
    total_review_count: analysis.totalReviewCount,
  };

  try {
    return { ok: true, analysis, result: await api.submitReviewDates(payload) };
  } catch (e) {
    // 아직 수집되지 않은 상품이면 먼저 수집한 뒤 한 번 더 시도한다.
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("404")) {
      const collected = await handleCollect();
      if (!collected.ok) return { ok: false, analysis, error: collected.error };
      try {
        return { ok: true, analysis, result: await api.submitReviewDates(payload) };
      } catch (retryError) {
        return {
          ok: false,
          analysis,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        };
      }
    }
    return { ok: false, analysis, error: message };
  }
}

async function handleResetReviews(): Promise<{ ok: boolean; error?: string }> {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: "활성 탭을 찾을 수 없습니다." };
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "RESET_REVIEWS" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** selector 진단 리포트를 content script에서 받아온다. */
async function handleDiagnose(): Promise<{ ok: boolean; report?: string; error?: string }> {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: "활성 탭을 찾을 수 없습니다." };
  if (!isCoupangUrl(tab.url)) {
    return { ok: false, error: "쿠팡 페이지에서 실행하세요." };
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "DIAGNOSE" });
    if (!response?.ok) return { ok: false, error: response?.error ?? "진단에 실패했습니다." };
    return { ok: true, report: response.report as string };
  } catch (e) {
    return {
      ok: false,
      error: `페이지와 통신할 수 없습니다. 새로고침 후 다시 시도하세요. (${
        e instanceof Error ? e.message : String(e)
      })`,
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SCAN_START") {
    void startRunner().then(sendResponse);
    return true;
  }
  if (message?.type === "SCAN_PAUSE") {
    void pauseRunner().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "SCAN_RESUME") {
    void resumeRunner().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "SCAN_STOP") {
    void stopRunnerAndJob().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "SCAN_STATE") {
    void api
      .scanStatus()
      .catch(() => null)
      .then((backend) => sendResponse({ ok: true, runner: getRunnerState(), backend }));
    return true;
  }
  if (message?.type === "DIAGNOSE") {
    void handleDiagnose().then(sendResponse);
    return true;
  }
  if (message?.type === "RESET_REVIEWS") {
    void handleResetReviews().then(sendResponse);
    return true;
  }
  if (message?.type === "ANALYZE_REVIEWS") {
    void handleAnalyzeReviews().then(sendResponse);
    return true;
  }
  if (message?.type === "SCAN") {
    void handleScan().then(sendResponse);
    return true;
  }
  if (message?.type === "COLLECT") {
    void handleCollect().then(sendResponse);
    return true;
  }
  return undefined;
});
