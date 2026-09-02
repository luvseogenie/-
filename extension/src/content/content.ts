/**
 * Content script.
 *
 * 현재 Chrome에 렌더링된 쿠팡 페이지의 DOM만 읽는다.
 * 추가 네트워크 요청을 보내지 않고, 페이지를 조작하지도 않는다.
 */
import { detectPageType, parseProductList } from "@/parsers/coupang_product_parser";
import { analyzeReviewDates } from "@/parsers/coupang_review_parser";
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

/**
 * 최근 30일 리뷰수를 구하기 위해 화면에 렌더된 리뷰의 작성일을 읽는다.
 * 추가 페이지를 자동으로 불러오지 않는다.
 */
function analyzeReviews(): ReviewDateResult {
  const analysis = analyzeReviewDates(document);
  const result: ReviewDateResult = {
    ...analysis,
    productId: currentProductId(),
    productUrl: location.href,
  };
  log.info("리뷰 날짜 분석", {
    표본: result.sampleSize,
    "30일이내": result.reviewsInWindow,
    "표본기간(일)": result.sampleSpanDays,
    "30일커버": result.coversWindow,
  });
  for (const warning of result.warnings) log.warn(warning);
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

log.info("content script 준비 완료:", location.href);
