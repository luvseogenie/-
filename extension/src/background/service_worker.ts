/**
 * Service worker (MV3 background).
 *
 * popup ↔ content script 중계 + 백엔드 전송을 담당한다.
 * fetch를 여기에 모아 두면 CORS/권한 문제를 한 곳에서 다룰 수 있다.
 */
import { api, ApiError, type CollectPayload } from "@/lib/api";
import { log } from "@/lib/logger";
import type { CollectResponse, ParseResult } from "@/lib/types";

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
