/**
 * 자동 스캔 루프.
 *
 * 백엔드의 스캔 큐에서 다음 대상을 받아 탭에서 열고, 수집하고, 완료를 알리고,
 * 다음 대상으로 넘어간다. 사용자는 시작 버튼만 누른다.
 *
 * 원칙
 *  - 탭 하나를 재사용한다 (매번 열고 닫지 않는다)
 *  - 대상 사이에 간격을 둔다 (사람이 페이지를 넘기는 속도 수준)
 *  - 차단·오류 감지 시 그 대상은 실패로 기록하고 계속 진행하되,
 *    연속으로 여러 번 실패하면 멈추고 사용자에게 알린다
 *  - CAPTCHA 등 차단 우회는 하지 않는다
 */

import { api, getAutoCollect, type ScanTarget } from "@/lib/api";
import { log } from "@/lib/logger";
import type { ParseResult, ReviewDateResult } from "@/lib/types";
import type { CategoryTreeResult } from "@/parsers/coupang_category_parser";

import { openBackgroundTab, sendWhenReady, sleep, waitForLoad } from "./tab_utils";

/** 대상 사이 대기(ms). 너무 빠르면 차단 위험이 커진다. */
const DELAY_BETWEEN_TARGETS_MS = 2500;
/** 페이지 로드 후 Next.js가 데이터를 그릴 시간 */
const SETTLE_AFTER_LOAD_MS = 1500;
/** content script 응답 대기 한도 */
const CONTENT_READY_TIMEOUT_MS = 20000;
/** 연속 실패 허용 횟수 — 넘으면 멈춘다 */
const MAX_CONSECUTIVE_FAILURES = 5;

type RunnerState = {
  running: boolean;
  paused: boolean;
  tabId: number | null;
  currentTarget: ScanTarget | null;
  processed: number;
  failures: number;
  consecutiveFailures: number;
  lastMessage: string;
  stopReason: string | null;
};

const state: RunnerState = {
  running: false,
  paused: false,
  tabId: null,
  currentTarget: null,
  processed: 0,
  failures: 0,
  consecutiveFailures: 0,
  lastMessage: "",
  stopReason: null,
};

export function getRunnerState(): RunnerState {
  return { ...state };
}

/** 스캔 전용 탭을 확보한다. 없거나 닫혔으면 새로 연다. */
async function ensureTab(url: string): Promise<number> {
  if (state.tabId !== null) {
    try {
      await chrome.tabs.get(state.tabId);
      await chrome.tabs.update(state.tabId, { url });
      return state.tabId;
    } catch {
      state.tabId = null;
    }
  }
  state.tabId = await openBackgroundTab(url);
  return state.tabId;
}

/** content script가 응답할 때까지 SCAN을 재시도한다. */
async function scanWhenReady(tabId: number): Promise<ParseResult> {
  const res = await sendWhenReady<{ ok: boolean; result?: ParseResult; error?: string }>(
    tabId,
    { type: "SCAN" },
    CONTENT_READY_TIMEOUT_MS,
  );
  if (!res.result) throw new Error("파싱 결과가 없습니다.");
  return res.result;
}

/**
 * 목록 페이지 좌측 메뉴에 보이는 하위 카테고리를 트리에 등록한다.
 * 화면에 있는 것만 등록하고, 계층을 알 수 없는 링크(부모 없음)는 다른 행의 부모로
 * 쓰이는 경우에만 포함한다 — 트리를 어지럽히지 않기 위해서다.
 */
type DiscoveredChild = { category_code: string; category_name: string; category_url: string | null };

async function registerDiscoveredCategories(
  tabId: number,
  currentCode: string | null,
): Promise<DiscoveredChild[]> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, { type: "SCAN_CATEGORIES" })) as
      | { ok: boolean; result?: CategoryTreeResult }
      | undefined;
    if (!res?.ok || !res.result) return [];
    const withParent = res.result.rows.filter((r) => r.parent_category_code);
    const referenced = new Set(withParent.map((r) => r.parent_category_code));
    const rows = res.result.rows.filter((r) => r.parent_category_code || referenced.has(r.category_code));
    if (rows.length > 0) {
      const out = await api.importCategories(rows);
      if (out.created > 0) log.info("하위 카테고리 등록", out.created);
    }
    // 현재 페이지 카테고리의 직계 하위 → 백엔드가 이번 스캔 대상에 추가한다
    if (!currentCode) return [];
    return res.result.rows
      .filter((r) => r.parent_category_code === currentCode)
      .map((r) => ({ category_code: r.category_code, category_name: r.category_name, category_url: r.category_url }));
  } catch (e) {
    log.warn("하위 카테고리 등록 실패", e);
    return [];
  }
}

/** 상세 페이지에서 리뷰 작성일까지 읽는다 (최신순 정렬 시도 포함). */
async function analyzeReviewsOnTab(tabId: number): Promise<ReviewDateResult | null> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "SORT_REVIEWS_NEWEST" });
    await sleep(1500);
  } catch {
    // 정렬 컨트롤이 없으면 그대로 진행한다.
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "ANALYZE_REVIEWS" });
    return response?.ok ? (response.result as ReviewDateResult) : null;
  } catch {
    return null;
  }
}

/** 차단/오류 페이지인지 간단히 판단한다. 우회하지 않고 멈추기 위한 감지다. */
function looksBlocked(parsed: ParseResult): boolean {
  const url = parsed.sourceUrl.toLowerCase();
  return url.includes("captcha") || url.includes("access-denied") || url.includes("blocked");
}

async function processTarget(target: ScanTarget): Promise<{ count: number; discovered: DiscoveredChild[] }> {
  const tabId = await ensureTab(target.url);
  await waitForLoad(tabId, target.url, 25000);
  await sleep(SETTLE_AFTER_LOAD_MS);

  const parsed = await scanWhenReady(tabId);
  if (looksBlocked(parsed)) {
    throw new Error("쿠팡이 접근을 제한한 것으로 보입니다. 잠시 후 다시 시도하세요.");
  }
  if (parsed.products.length === 0) {
    throw new Error(parsed.errors[0] ?? "상품을 찾지 못했습니다.");
  }

  await api.collect({
    source_url: parsed.sourceUrl,
    page_type: parsed.pageType,
    category_code: parsed.categoryCode,
    category_name: parsed.categoryName,
    category_path: parsed.categoryPath ?? [],
    job_id: null,
    products: parsed.products,
    skipped: parsed.skipped,
    parse_errors: parsed.errors.slice(0, 20),
  });

  // 목록 페이지면 좌측 메뉴의 하위 카테고리를 트리에 채우고, 직계 하위는 스캔 대상에도 추가되게 한다.
  let discovered: DiscoveredChild[] = [];
  if (target.kind === "list") discovered = await registerDiscoveredCategories(tabId, parsed.categoryCode);

  // 상세 페이지면 최근 30일 리뷰수도 함께 확보한다.
  if (target.kind === "detail" && parsed.pageType === "product") {
    const analysis = await analyzeReviewsOnTab(tabId);
    if (analysis && analysis.productId && analysis.sampleSize > 0) {
      try {
        await api.submitReviewDates({
          product_id: analysis.productId,
          product_url: analysis.productUrl,
          reviews_in_window: analysis.reviewsInWindow,
          sample_size: analysis.sampleSize,
          sample_span_days: analysis.sampleSpanDays,
          covers_window: analysis.coversWindow,
          newest_review_date: analysis.newestReviewDate,
          oldest_review_date: analysis.oldestReviewDate,
          total_review_count: analysis.totalReviewCount,
        });
      } catch (e) {
        log.warn("리뷰 날짜 전송 실패", e);
      }
    }
  }
  return { count: parsed.products.length, discovered };
}

async function loop(): Promise<void> {
  while (state.running) {
    if (state.paused) {
      await sleep(1000);
      continue;
    }

    let target: ScanTarget | null;
    try {
      target = await api.scanNext();
    } catch (e) {
      state.lastMessage = `백엔드 연결 실패: ${e instanceof Error ? e.message : String(e)}`;
      await sleep(3000);
      continue;
    }

    if (!target) {
      // 백엔드가 일시정지 상태이거나 모두 끝났다.
      const status = await api.scanStatus().catch(() => null);
      if (status && status.status === "paused") {
        state.paused = true;
        state.lastMessage = "일시정지됨";
        continue;
      }
      state.lastMessage = status?.status === "completed" ? "모든 수집이 끝났습니다." : "대상이 없습니다.";
      stopRunner(status?.status === "completed" ? "완료" : "대상 없음");
      break;
    }

    state.currentTarget = target;
    state.lastMessage = `${target.kind === "list" ? "목록" : "상세"} · ${target.label ?? target.url}`;
    log.info("스캔 대상", target.label, target.url);

    try {
      const { count, discovered } = await processTarget(target);
      await api.scanDone(target.id, { product_count: count, discovered_children: discovered });
      state.processed += 1;
      state.consecutiveFailures = 0;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn("스캔 대상 실패", target.url, message);
      await api.scanDone(target.id, { error: message }).catch(() => undefined);
      state.failures += 1;
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        state.lastMessage = `연속 ${MAX_CONSECUTIVE_FAILURES}회 실패로 멈췄습니다: ${message}`;
        await api.scanPause().catch(() => undefined);
        stopRunner("연속 실패");
        break;
      }
    }

    state.currentTarget = null;
    await sleep(DELAY_BETWEEN_TARGETS_MS);
  }
}

export async function startRunner(): Promise<{ ok: boolean; error?: string }> {
  if (state.running) return { ok: true };
  const status = await api.scanStatus().catch(() => null);
  if (!status || (status.status !== "running" && status.status !== "paused")) {
    return { ok: false, error: "진행 중인 스캔 작업이 없습니다. 대시보드에서 [소싱 시작]을 먼저 누르세요." };
  }
  if (status.status === "paused") await api.scanResume().catch(() => undefined);

  // 상세 페이지 자동 수집이 꺼져 있어도 스캔은 직접 수집하므로 상관없다.
  void getAutoCollect();

  state.running = true;
  state.paused = false;
  state.stopReason = null;
  state.processed = 0;
  state.failures = 0;
  state.consecutiveFailures = 0;
  state.lastMessage = "시작";
  void loop();
  return { ok: true };
}

export async function pauseRunner(): Promise<void> {
  state.paused = true;
  state.lastMessage = "일시정지";
  await api.scanPause().catch(() => undefined);
}

export async function resumeRunner(): Promise<void> {
  await api.scanResume().catch(() => undefined);
  state.paused = false;
  state.lastMessage = "재개";
  if (!state.running) await startRunner();
}

export function stopRunner(reason = "사용자 중단"): void {
  state.running = false;
  state.paused = false;
  state.currentTarget = null;
  state.stopReason = reason;
  if (state.tabId !== null) {
    chrome.tabs.remove(state.tabId).catch(() => undefined);
    state.tabId = null;
  }
}

export async function stopRunnerAndJob(): Promise<void> {
  stopRunner("사용자 중단");
  await api.scanStop().catch(() => undefined);
}
