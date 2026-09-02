/**
 * Content script.
 *
 * 현재 Chrome에 렌더링된 쿠팡 페이지의 DOM만 읽는다.
 * 추가 네트워크 요청을 보내지 않고, 페이지를 조작하지도 않는다.
 */
import { parseProductList } from "@/parsers/coupang_product_parser";
import { log } from "@/lib/logger";
import type { ParseResult } from "@/lib/types";

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
