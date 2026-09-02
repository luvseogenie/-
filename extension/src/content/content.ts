/**
 * 중복 주입 방지.
 * manifest 선언으로 한 번, 자동 스캔이 chrome.scripting 으로 한 번 더 넣을 수 있다.
 * 두 번째는 아무것도 하지 않는다 (리스너·리뷰 누적이 두 배가 되는 것을 막는다).
 */
declare global {
  interface Window {
    __coupangSourcingInjected?: boolean;
  }
}
if (window.__coupangSourcingInjected) {
  throw new Error("coupang-sourcing content script already injected");
}
window.__coupangSourcingInjected = true;

/**
 * Content script.
 *
 * 현재 Chrome에 렌더링된 쿠팡 페이지의 DOM만 읽는다.
 * 추가 네트워크 요청을 보내지 않고, 페이지를 조작하지도 않는다.
 */
import { detectPageType, parseProductList } from "@/parsers/coupang_product_parser";
import {
  analyzeReviewDates,
  extractReviewEntries,
  type ReviewEntry,
} from "@/parsers/coupang_review_parser";
import { parseCategoryTree, type CategoryTreeResult } from "@/parsers/coupang_category_parser";
import { ensureListSortSalesDesc, readListSort } from "@/parsers/coupang_list_sort";
import { detectBlockedPage } from "@/parsers/blocked_page";
import { buildDiagnosticsReport } from "@/parsers/diagnostics";
import {
  CATEGORY_MENU_TRIGGER_TEXTS,
  MIN_CATEGORY_MENU_LINKS,
  PRODUCT_ID_URL_PATTERNS,
  REVIEW_CURRENT_PAGE_SELECTORS,
  REVIEW_NEXT_PAGE_SELECTORS,
  REVIEW_NEXT_PAGE_TEXTS,
  REVIEW_SECTION_SELECTORS,
} from "@/parsers/selectors";
import { log } from "@/lib/logger";
import type { ParseResult, ReviewDateResult } from "@/lib/types";

function scan(): ParseResult {
  const result = parseProductList(document, location.href);
  result.blocked = detectBlockedPage(document);
  if (result.blocked) log.warn("쿠팡 접근 제한 화면 감지:", result.blocked);
  if (result.products.length === 0) {
    log.warn("상품을 찾지 못했습니다.", {
      url: location.href,
      pageType: result.pageType,
      errors: result.errors,
    });
  } else {
    log.info(
      `상품 ${result.products.length}개 감지 (제외 ${result.skipped}개, selector=${result.matchedCardSelector})`,
    );
    for (const reason of result.errors) log.warn("제외:", reason);
  }
  return result;
}

function currentProductId(): string | null {
  for (const pattern of PRODUCT_ID_URL_PATTERNS) {
    const match = location.href.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// 리뷰 누적 수집
//
// 쿠팡 리뷰 목록은 페이지네이션 방식이라, 다음 페이지로 넘기면 이전 리뷰가
// DOM에서 사라진다. 한 페이지(보통 5건)만 봐서는 30일 구간을 덮을 수 없다.
// 그래서 페이지를 넘기는 동안 화면에 나타난 리뷰의 작성일을 여기에 누적해 둔다.
// 수동 모드에서는 사용자가 넘긴 것만 읽고, 자동 스캔은 NEXT_REVIEW_PAGE 로 [다음]을 눌러 넘긴다.
// ---------------------------------------------------------------------------
const reviewStore = new Map<string, Date>();
let reviewStoreProductId: string | null = null;
/** 새 리뷰가 들어온 횟수 ≒ 사용자가 넘겨 본 페이지 수 */
let reviewPagesSeen = 0;
let harvestTimer: ReturnType<typeof setTimeout> | null = null;

function resetReviewStore(reason: string) {
  if (reviewStore.size > 0) log.info(`리뷰 누적 초기화 (${reason})`);
  reviewStore.clear();
  reviewPagesSeen = 0;
  reviewStoreProductId = currentProductId();
}

/** 현재 DOM의 리뷰를 누적 저장소에 합친다. 새로 들어온 개수를 돌려준다. */
function harvestReviews(): number {
  const productId = currentProductId();
  if (productId !== reviewStoreProductId) resetReviewStore("다른 상품으로 이동");

  const { entries } = extractReviewEntries(document);
  let added = 0;
  for (const entry of entries) {
    if (!reviewStore.has(entry.key)) {
      reviewStore.set(entry.key, entry.date);
      added += 1;
    }
  }
  if (added > 0) {
    reviewPagesSeen += 1;
    log.info(`리뷰 ${added}건 누적 (총 ${reviewStore.size}건, ${reviewPagesSeen}페이지)`);
  }
  return added;
}

function scheduleHarvest() {
  if (harvestTimer !== null) clearTimeout(harvestTimer);
  harvestTimer = setTimeout(() => {
    harvestTimer = null;
    harvestReviews();
  }, 400);
}

/** 리뷰 목록이 바뀔 때마다(페이지 이동/더보기) 자동으로 누적한다. */
function startReviewObserver() {
  if (detectPageType(location.href) !== "product") return;
  resetReviewStore("페이지 진입");

  const observer = new MutationObserver(() => scheduleHarvest());
  observer.observe(document.body, { childList: true, subtree: true });

  // 최초 렌더분도 한 번 담는다.
  scheduleHarvest();
  log.info("리뷰 누적 수집 시작 — 리뷰 페이지를 넘기면 자동으로 모읍니다.");
}

function storedEntries(): ReviewEntry[] {
  return [...reviewStore.entries()].map(([key, date]) => ({ key, date }));
}

/**
 * 최근 30일 리뷰수를 구하기 위해 지금까지 누적된 리뷰 작성일을 분석한다.
 * 추가 페이지를 자동으로 불러오지 않는다.
 */
function analyzeReviews(): ReviewDateResult {
  harvestReviews();
  const analysis = analyzeReviewDates(document, new Date(), storedEntries());
  const result: ReviewDateResult = {
    ...analysis,
    productId: currentProductId(),
    productUrl: location.href,
    pagesSeen: reviewPagesSeen,
  };
  log.info("리뷰 날짜 분석", {
    표본: result.sampleSize,
    "30일이내": result.reviewsInWindow,
    "표본기간(일)": result.sampleSpanDays,
    "30일커버": result.coversWindow,
    "읽은페이지": reviewPagesSeen,
  });
  for (const warning of result.warnings) log.warn(warning);
  return result;
}

function isClickable(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  const cls = el.getAttribute("class") ?? "";
  if (/disabled|inactive/i.test(cls)) return false;
  return true;
}

/**
 * 리뷰 목록의 [다음 페이지]를 누른다 (자동 스캔용).
 * 1) 알려진 selector → 2) "다음" 텍스트 버튼 → 3) 현재 페이지 번호 + 1 번호 버튼.
 * 사람이 페이지를 넘기는 것과 같은 클릭이며, 마지막 페이지면 아무것도 하지 않는다.
 */
function tryNextReviewPage(): { clicked: boolean; how: string | null } {
  for (const selector of REVIEW_NEXT_PAGE_SELECTORS) {
    const el = document.querySelector(selector);
    if (isClickable(el)) {
      el.click();
      return { clicked: true, how: selector };
    }
  }
  let section: ParentNode = document;
  for (const selector of REVIEW_SECTION_SELECTORS) {
    const found = document.querySelector(selector);
    if (found) {
      section = found;
      break;
    }
  }
  const texts = new Set<string>(REVIEW_NEXT_PAGE_TEXTS.map((t) => t.toLowerCase()));
  for (const el of Array.from(section.querySelectorAll("button, a, li, span, div"))) {
    if (el.children.length > 1) continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const label = (el.getAttribute("aria-label") ?? "").trim().toLowerCase();
    if ((texts.has(text) || texts.has(label)) && isClickable(el)) {
      el.click();
      return { clicked: true, how: `text:${text || label}` };
    }
  }
  for (const selector of REVIEW_CURRENT_PAGE_SELECTORS) {
    const current = document.querySelector(selector);
    const n = Number((current?.textContent ?? "").trim());
    if (!current || !Number.isInteger(n) || n <= 0) continue;
    const container = current.parentElement?.parentElement ?? current.parentElement;
    if (!container) continue;
    for (const el of Array.from(container.querySelectorAll("button, a, li, span"))) {
      if ((el.textContent ?? "").trim() === String(n + 1) && isClickable(el)) {
        el.click();
        return { clicked: true, how: `page:${n + 1}` };
      }
    }
  }
  return { clicked: false, how: null };
}

/**
 * 리뷰 정렬을 최신순으로 바꿔본다 (자동 스캔용, 최선 노력).
 * 정렬 컨트롤을 못 찾으면 아무것도 하지 않는다.
 */
function trySortReviewsNewest(): boolean {
  const candidates = Array.from(document.querySelectorAll("button, label, a, li, div, span"));
  for (const el of candidates) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text !== "최신순" && text !== "최근순") continue;
    // 리뷰 영역 근처의 것만 (상단 목록 정렬과 구분)
    const inReview = el.closest("[class*='review'], [class*='Review'], #sdpReview") !== null;
    if (!inReview) continue;
    try {
      (el as HTMLElement).click();
      log.info("리뷰 최신순 정렬 클릭");
      return true;
    } catch {
      /* 다음 후보 */
    }
  }
  return false;
}

/**
 * 카테고리 메뉴가 마우스를 올려야 열리는 경우를 위해 "카테고리" 버튼에 hover 이벤트를 보낸다.
 * 페이지를 이동시키지 않는다(click 은 보내지 않는다).
 */
function tryOpenCategoryMenu(): boolean {
  const triggers = new Set<string>(CATEGORY_MENU_TRIGGER_TEXTS);
  let fired = false;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, a, span, div, li"))) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!triggers.has(text) || el.children.length > 2) continue;
    for (const type of ["mouseover", "mouseenter", "pointerover"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }
    fired = true;
  }
  return fired;
}

async function scanCategories(): Promise<CategoryTreeResult> {
  let result = parseCategoryTree(document, location.href);
  if (result.rows.length < MIN_CATEGORY_MENU_LINKS && tryOpenCategoryMenu()) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    result = parseCategoryTree(document, location.href);
  }
  log.info("카테고리 트리", {
    rows: result.rows.length,
    roots: result.roots,
    depth: result.maxDepth,
    container: result.container,
  });
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SCAN_CATEGORIES") {
    scanCategories()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  }
  if (message?.type === "ENSURE_LIST_SORT") {
    sendResponse({ ok: true, result: ensureListSortSalesDesc(document) });
    return true;
  }
  if (message?.type === "READ_LIST_SORT") {
    sendResponse({ ok: true, result: readListSort(document) });
    return true;
  }
  if (message?.type === "NEXT_REVIEW_PAGE") {
    sendResponse({ ok: true, ...tryNextReviewPage() });
    return true;
  }
  if (message?.type === "SORT_REVIEWS_NEWEST") {
    sendResponse({ ok: true, clicked: trySortReviewsNewest() });
    return true;
  }
  if (message?.type === "DIAGNOSE") {
    try {
      const report = buildDiagnosticsReport(document, location.href);
      log.info("진단 리포트\n" + report);
      sendResponse({ ok: true, report });
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }
  if (message?.type === "RESET_REVIEWS") {
    resetReviewStore("사용자 요청");
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "ANALYZE_REVIEWS") {
    try {
      if (detectPageType(location.href) !== "product") {
        sendResponse({
          ok: false,
          error: "상품 상세 페이지에서만 리뷰 날짜를 분석할 수 있습니다.",
        });
        return true;
      }
      sendResponse({ ok: true, result: analyzeReviews() });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      log.error("리뷰 분석 중 오류", e);
      sendResponse({ ok: false, error: reason });
    }
    return true;
  }
  if (message?.type === "SCAN") {
    try {
      sendResponse({ ok: true, result: scan() });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      log.error("파싱 중 오류", e);
      sendResponse({ ok: false, error: reason });
    }
    return true;
  }
  return undefined;
});

/**
 * 상품 상세 페이지 자동 수집.
 *
 * 쿠팡 구매 문구("한 달간 N명 이상 구매했어요")는 상세 페이지에만 있어서,
 * 후보 상품을 하나씩 열어 확인해야 한다. 옵션이 켜져 있으면
 * 사용자가 연 페이지를 자동으로 저장해 클릭 부담을 없앤다.
 *
 * 자동으로 페이지를 열지는 않는다. 사용자가 연 페이지만 읽는다.
 */
let autoCollectedUrl: string | null = null;

async function maybeAutoCollect() {
  if (detectPageType(location.href) !== "product") return;
  if (autoCollectedUrl === location.href) return;

  let enabled = false;
  try {
    const stored = await chrome.storage.local.get("autoCollectProductPages");
    enabled = stored.autoCollectProductPages === true;
  } catch {
    return;
  }
  if (!enabled) return;

  autoCollectedUrl = location.href;
  try {
    const response = await chrome.runtime.sendMessage({ type: "COLLECT" });
    if (response?.ok) {
      log.info("자동 수집 완료", response.result);
    } else {
      log.warn("자동 수집 실패:", response?.error);
      autoCollectedUrl = null; // 다음 기회에 재시도
    }
  } catch (e) {
    log.warn("자동 수집 중 오류", e);
    autoCollectedUrl = null;
  }
}

startReviewObserver();
// 상세 페이지 콘텐츠가 그려질 시간을 준 뒤 자동 수집한다.
setTimeout(() => void maybeAutoCollect(), 1500);
log.info("content script 준비 완료:", location.href);
