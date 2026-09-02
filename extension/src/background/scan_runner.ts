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
import type { ListSortState } from "@/parsers/coupang_list_sort";
import { MAX_REVIEW_PAGES_AUTO } from "@/parsers/selectors";

import { openBackgroundTab, sendWhenReady, sleep, waitForLoad } from "./tab_utils";

/**
 * 대상 사이 대기(ms) — 사람이 페이지를 넘기는 속도. 너무 빠르면 쿠팡이 접근을 막는다.
 * (실제로 상세 50개를 2.5초 간격으로 열자 Access Denied 가 떴다)
 */
const DELAY_LIST_MS: [number, number] = [3000, 5000];
/** 상세 방문 간격 — 대시보드 「속도」 설정 (기본 slow) */
const DELAY_DETAIL_BY_PACE: Record<string, [number, number]> = {
  fast: [2000, 4000],
  normal: [4000, 7000],
  slow: [6000, 10000],
};
/** 이만큼 처리할 때마다 잠깐 쉰다 */
const REST_EVERY = 10;
const REST_MS: [number, number] = [20000, 35000];
const BLOCKED_PREFIX = "[차단]";
/** 페이지 로드 후 Next.js가 데이터를 그릴 시간 */
const SETTLE_AFTER_LOAD_MS = 1500;
/** content script 응답 대기 한도 */
const CONTENT_READY_TIMEOUT_MS = 20000;
/** 연속 실패 허용 횟수 — 넘으면 멈춘다 */
const MAX_CONSECUTIVE_FAILURES = 5;
/** 리뷰 [다음 페이지]를 누른 뒤 새 리뷰가 그려질 시간 (사람 속도로 무작위) */
const REVIEW_PAGE_SETTLE_MS: [number, number] = [1500, 2600];

const jitter = ([min, max]: [number, number]) => min + Math.floor(Math.random() * (max - min));

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
  /** 상세 방문 속도 (대시보드 설정) */
  pace: string;
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
  pace: "slow",
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

/** 지금까지 화면에 나온 리뷰 작성일을 분석한다 */
async function analyzeOnce(tabId: number): Promise<ReviewDateResult | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "ANALYZE_REVIEWS" });
    return response?.ok ? (response.result as ReviewDateResult) : null;
  } catch {
    return null;
  }
}

/**
 * 상세 페이지에서 최근 30일 리뷰수를 센다.
 * 최신순으로 정렬한 뒤, 30일보다 오래된 리뷰가 나올 때까지 [다음 페이지]를 눌러 누적한다.
 * (상품당 최대 MAX_REVIEW_PAGES_AUTO 페이지 — 그 안에 못 덮으면 표본 기간으로 추정하고 신뢰도를 낮춘다)
 */
async function analyzeReviewsOnTab(tabId: number): Promise<(ReviewDateResult & { sortNote: string }) | null> {
  let sortNote = "리뷰 정렬: 확인 불가";
  try {
    const sorted = (await chrome.tabs.sendMessage(tabId, { type: "SORT_REVIEWS_NEWEST" })) as
      | { ok: boolean; clicked?: boolean; result?: ListSortState }
      | undefined;
    await sleep(1800);
    const after = (await chrome.tabs.sendMessage(tabId, { type: "READ_REVIEW_SORT" })) as
      | { ok: boolean; result?: ListSortState }
      | undefined;
    const afterState = after?.result;
    if (afterState?.isSalesDesc) sortNote = `리뷰 정렬: 최신순 확인됨${sorted?.result?.changed ? " (변경함)" : ""}`;
    else if (afterState && afterState.available.length === 0) sortNote = sorted?.clicked ? "리뷰 정렬: 최신순 클릭(확인 불가)" : "리뷰 정렬: 컨트롤 없음";
    else sortNote = `리뷰 정렬: ${afterState?.active ?? "알 수 없음"} (최신순 아님 — 30일 리뷰수가 적게 나올 수 있음)`;
  } catch {
    // 정렬 컨트롤이 없으면 그대로 진행한다.
  }
  let result = await analyzeOnce(tabId);
  let pages = 1;
  while (result && !result.coversWindow && result.sampleSize > 0 && pages < MAX_REVIEW_PAGES_AUTO) {
    let next: { clicked?: boolean } | undefined;
    try {
      next = (await chrome.tabs.sendMessage(tabId, { type: "NEXT_REVIEW_PAGE" })) as { clicked?: boolean };
    } catch {
      next = undefined;
    }
    if (!next?.clicked) break;
    await sleep(jitter(REVIEW_PAGE_SETTLE_MS));
    const again = await analyzeOnce(tabId);
    if (!again || again.sampleSize <= result.sampleSize) {
      // 새 리뷰가 안 들어왔다 = 마지막 페이지였거나 화면이 바뀌지 않았다.
      result = again ?? result;
      break;
    }
    result = again;
    pages += 1;
  }
  if (result) log.info("리뷰 30일 분석", { pages, sample: result.sampleSize, inWindow: result.reviewsInWindow, covers: result.coversWindow, sortNote });
  return result ? { ...result, sortNote } : null;
}

/** 차단/오류 페이지인지 판단한다. 우회하지 않고 멈추기 위한 감지다. */
function looksBlocked(parsed: ParseResult): boolean {
  if (parsed.blocked) return true;
  const url = parsed.sourceUrl.toLowerCase();
  return url.includes("captcha") || url.includes("access-denied") || url.includes("blocked");
}

/**
 * 목록 페이지를 끝까지 스크롤한다.
 * 쿠팡은 화면에 들어온 상품부터 그리므로, 스크롤하지 않으면 뒤쪽 상품이 DOM에 없을 수 있다.
 * 페이지를 조작하는 게 아니라 사람이 스크롤하는 것과 같은 동작이다.
 */
async function scrollToBottom(tabId: number): Promise<void> {
  try {
    for (let i = 0; i < 6; i += 1) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.scrollTo(0, document.documentElement.scrollHeight),
      });
      await sleep(400);
    }
    await chrome.scripting.executeScript({ target: { tabId }, func: () => window.scrollTo(0, 0) });
    await sleep(300);
  } catch (e) {
    log.warn("스크롤 실패(무시)", e);
  }
}

/**
 * 목록 페이지가 정말 판매량순인지 화면에서 확인하고, 아니면 "판매량순"을 눌러 맞춘다.
 * 주소의 sorter 파라미터를 쿠팡이 무시해도 결과가 랭킹순으로 바뀌지 않게 한다.
 */
async function ensureSalesSort(tabId: number, url: string): Promise<string> {
  try {
    const res = (await sendWhenReady<{ ok: boolean; result?: ListSortState; error?: string }>(
      tabId,
      { type: "ENSURE_LIST_SORT" },
      CONTENT_READY_TIMEOUT_MS,
    )).result;
    if (!res) return "정렬: 확인 불가";
    if (!res.changed) return `정렬: ${res.note}`;
    // 정렬을 바꾸면 쿠팡이 목록을 다시 그리거나 주소를 바꿔 다시 불러온다.
    await sleep(2500);
    await waitForLoad(tabId, url, 15000);
    await sleep(SETTLE_AFTER_LOAD_MS);
    const after = (await sendWhenReady<{ ok: boolean; result?: ListSortState }>(
      tabId,
      { type: "READ_LIST_SORT" },
      CONTENT_READY_TIMEOUT_MS,
    )).result;
    return `정렬: ${res.note}` + (after?.isSalesDesc ? " (적용 확인)" : " (적용 여부 불명)");
  } catch (e) {
    return `정렬: 확인 실패 (${e instanceof Error ? e.message : String(e)})`;
  }
}

async function processTarget(target: ScanTarget): Promise<{ count: number; discovered: DiscoveredChild[]; note: string | null }> {
  const tabId = await ensureTab(target.url);
  await waitForLoad(tabId, target.url, 25000);
  await sleep(SETTLE_AFTER_LOAD_MS);
  let note: string | null = null;
  if (target.kind === "list") {
    note = await ensureSalesSort(tabId, target.url);
    await scrollToBottom(tabId);
  }

  const parsed = await scanWhenReady(tabId);
  if (looksBlocked(parsed)) {
    throw new Error(
      `${BLOCKED_PREFIX} 쿠팡이 접근을 제한했습니다(Access Denied). 자동 수집을 멈췄습니다. ` +
        "30분~1시간 뒤 [재개]를 누르세요. 상세 확인 상품 수를 줄이면 덜 걸립니다.",
    );
  }
  if (parsed.products.length === 0) {
    const where = parsed.pageType === "product" ? "상세 페이지" : "목록 페이지";
    throw new Error(
      `${where}에서 상품을 읽지 못했습니다 (${parsed.errors[0] ?? "이유 불명"}). ` +
        "쿠팡 화면이 바뀌었을 수 있습니다 — 그 페이지에서 [진단 정보 복사]를 보내주세요.",
    );
  }

  const saved = await api.collect({
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
  // 받기는 했는데 하나도 저장되지 않았다면 성공으로 넘기지 않는다 — 사유를 실패로 남겨 화면에서 보이게 한다.
  if (saved.received > 0 && saved.saved === 0) {
    throw new Error(
      `상품 ${saved.received}개를 읽었지만 저장된 것이 없습니다 (건너뜀 ${saved.skipped}, 중복 ${saved.duplicates}). ` +
        (saved.errors[0] ?? "사유 없음"),
    );
  }

  // 목록 페이지면 좌측 메뉴의 하위 카테고리를 트리에 채우고, 직계 하위는 스캔 대상에도 추가되게 한다.
  let discovered: DiscoveredChild[] = [];
  if (target.kind === "list") discovered = await registerDiscoveredCategories(tabId, parsed.categoryCode);

  // 상세 페이지면 최근 30일 리뷰수도 함께 확보한다.
  if (target.kind === "detail" && parsed.pageType === "product") {
    const analysis = await analyzeReviewsOnTab(tabId);
    if (analysis) {
      note =
        `${analysis.sortNote} · 30일 리뷰 ${analysis.reviewsInWindow}건 (표본 ${analysis.sampleSize}건` +
        `${analysis.sampleSpanDays !== null ? `/${Math.round(analysis.sampleSpanDays)}일` : ""}` +
        `${analysis.coversWindow ? "" : ", 30일 못 덮음→추정"})`;
    } else {
      note = "리뷰 분석 실패(리뷰 영역을 못 찾음)";
    }
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
  const summary = `${note ?? ""}${note ? " · " : ""}읽음 ${parsed.products.length}개 · 저장 ${saved.saved}개 (신규 ${saved.inserted}, 갱신 ${saved.updated})`;
  return { count: parsed.products.length, discovered, note: summary };
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
      const { count, discovered, note } = await processTarget(target);
      await api.scanDone(target.id, { product_count: count, discovered_children: discovered, note });
      state.processed += 1;
      state.consecutiveFailures = 0;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn("스캔 대상 실패", target.url, message);
      await api.scanDone(target.id, { error: message }).catch(() => undefined);
      state.failures += 1;
      if (message.startsWith(BLOCKED_PREFIX)) {
        // 차단 화면: 계속 두드리면 더 오래 막힌다. 바로 멈추고 사용자에게 맡긴다.
        state.lastMessage = message;
        await api.scanPause().catch(() => undefined);
        stopRunner("쿠팡 접근 제한");
        break;
      }
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        state.lastMessage = `연속 ${MAX_CONSECUTIVE_FAILURES}회 실패로 멈췄습니다: ${message}`;
        await api.scanPause().catch(() => undefined);
        stopRunner("연속 실패");
        break;
      }
    }

    state.currentTarget = null;
    const detailDelay = DELAY_DETAIL_BY_PACE[state.pace] ?? DELAY_DETAIL_BY_PACE.slow!;
    await sleep(jitter(target.kind === "detail" ? detailDelay : DELAY_LIST_MS));
    if (state.pace !== "fast" && state.processed > 0 && state.processed % REST_EVERY === 0) {
      state.lastMessage = "잠깐 쉬는 중 (차단 방지)";
      await sleep(jitter(REST_MS));
    }
  }
}

export async function startRunner(): Promise<{ ok: boolean; error?: string }> {
  if (state.running) return { ok: true };
  const status = await api.scanStatus().catch(() => null);
  if (!status || (status.status !== "running" && status.status !== "paused")) {
    return { ok: false, error: "진행 중인 스캔 작업이 없습니다. 대시보드에서 [소싱 시작]을 먼저 누르세요." };
  }
  if (status.status === "paused") await api.scanResume().catch(() => undefined);
  state.pace = status.pace ?? "slow";

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
