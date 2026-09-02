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
import { PRODUCT_ID_URL_PATTERNS } from "@/parsers/selectors";
import { log } from "@/lib/logger";
import type { ParseResult, ReviewDateResult } from "@/lib/types";

function scan(): ParseResult {
  const result = parseProductList(document, location.href);
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
// 그래서 사용자가 페이지를 넘기는 동안 화면에 나타난 리뷰의 작성일을
// 여기에 누적해 둔다. (자동으로 페이지를 요청하지는 않는다 — 사용자가 넘긴 것만 읽는다)
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

startReviewObserver();
log.info("content script 준비 완료:", location.href);
