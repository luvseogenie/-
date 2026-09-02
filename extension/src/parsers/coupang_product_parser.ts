/**
 * 쿠팡 상품 파서.
 *
 * 설계 원칙
 *  1. selector는 selectors.ts 에만 둔다. 이 파일에는 CSS 문자열을 쓰지 않는다.
 *  2. 모든 필드는 fallback selector 배열을 순서대로 시도한다.
 *  3. 필수값(product_id / product_name / product_url)이 없으면 그 카드는 제외하고 사유를 남긴다.
 *  4. 선택값이 없으면 null. 값을 만들어내지 않는다.
 *  5. DOM element를 받아 객체를 돌려주는 순수 함수 → jsdom으로 단위 테스트할 수 있다.
 */

import {
  CATEGORY_CODE_URL_PATTERNS,
  CATEGORY_NAME_SELECTORS,
  DELIVERY_BADGE_SELECTORS,
  DELIVERY_KEYWORDS,
  DETAIL_PAGE,
  LINK_SELECTORS,
  NAME_FALLBACK_IMG_SELECTORS,
  NAME_SELECTORS,
  PRICE_SELECTORS,
  PRODUCT_CARD_SELECTORS,
  PRODUCT_ID_ATTRIBUTES,
  PRODUCT_ID_URL_PATTERNS,
  RATING_SELECTORS,
  REVIEW_COUNT_SELECTORS,
  THUMBNAIL_SELECTORS,
} from "@/parsers/selectors";
import { absoluteUrl, parsePrice, parseRating, parseReviewCount } from "@/parsers/normalize";
import { findMonthlyPurchase } from "@/parsers/coupang_purchase_parser";
import type { CollectedProduct, DeliveryType, PageType, ParseResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// DOM 헬퍼
// ---------------------------------------------------------------------------
function queryFirst(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    try {
      const found = root.querySelector(selector);
      if (found) return found;
    } catch {
      // 잘못된 selector는 무시하고 다음 것을 시도한다.
    }
  }
  return null;
}

function textOf(root: ParentNode, selectors: readonly string[]): string | null {
  const el = queryFirst(root, selectors);
  if (!el) return null;
  const text = (el.textContent ?? "").trim();
  return text === "" ? null : text;
}

/** 배지 등에서 값이 될 만한 속성을 모두 긁는다. */
function attributeSoup(el: Element | null): string {
  if (!el) return "";
  const parts = [
    el.textContent ?? "",
    el.getAttribute("alt") ?? "",
    el.getAttribute("title") ?? "",
    el.getAttribute("src") ?? "",
    el.getAttribute("class") ?? "",
    el.getAttribute("aria-label") ?? "",
  ];
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// 개별 필드 추출
// ---------------------------------------------------------------------------
export function extractProductId(card: Element, url: string | null): string | null {
  for (const attr of PRODUCT_ID_ATTRIBUTES) {
    const value = card.getAttribute(attr);
    if (value && /^\d+$/.test(value.trim())) return value.trim();
  }
  // 자식 요소에 붙어 있는 경우
  for (const attr of PRODUCT_ID_ATTRIBUTES) {
    const child = card.querySelector(`[${attr}]`);
    const value = child?.getAttribute(attr);
    if (value && /^\d+$/.test(value.trim())) return value.trim();
  }
  if (url) {
    for (const pattern of PRODUCT_ID_URL_PATTERNS) {
      const match = url.match(pattern);
      if (match && match[1]) return match[1];
    }
  }
  return null;
}

export function extractProductUrl(card: Element, baseUrl?: string): string | null {
  if (card instanceof HTMLAnchorElement && card.getAttribute("href")) {
    return absoluteUrl(card.getAttribute("href"), baseUrl);
  }
  const link = queryFirst(card, LINK_SELECTORS);
  const href = link?.getAttribute("href");
  return absoluteUrl(href, baseUrl);
}

export function extractName(card: Element): string | null {
  const direct = textOf(card, NAME_SELECTORS);
  if (direct) return direct;
  // 썸네일 img의 alt는 DOM에 실제로 존재하는 값이므로 fallback으로 쓸 수 있다.
  const img = queryFirst(card, NAME_FALLBACK_IMG_SELECTORS);
  const alt = img?.getAttribute("alt")?.trim();
  return alt ? alt : null;
}

export function extractDeliveryType(card: Element): DeliveryType | null {
  const badge = queryFirst(card, DELIVERY_BADGE_SELECTORS);
  const haystack = badge ? attributeSoup(badge) : "";
  // 배지를 못 찾으면 카드 전체 텍스트에서 한 번 더 찾는다.
  const text = (haystack + " " + (card.textContent ?? "")).toLowerCase();

  for (const { keywords, type } of DELIVERY_KEYWORDS) {
    if (keywords.some((k) => text.includes(k.toLowerCase()))) {
      return type as DeliveryType;
    }
  }
  return null;
}

export function extractRating(card: Element): number | null {
  const el = queryFirst(card, RATING_SELECTORS);
  if (!el) return null;
  // 텍스트 우선, 없으면 width 스타일(%)
  const fromText = parseRating(el.textContent);
  if (fromText !== null) return fromText;
  const style = el.getAttribute("style");
  return style ? parseRating(style) : null;
}

export function extractThumbnail(card: Element, baseUrl?: string): string | null {
  const img = queryFirst(card, THUMBNAIL_SELECTORS);
  if (!img) return null;
  const src = img.getAttribute("src") ?? img.getAttribute("data-src") ?? img.getAttribute("data-img-src");
  return absoluteUrl(src, baseUrl);
}

// ---------------------------------------------------------------------------
// 카드 1개 파싱
// ---------------------------------------------------------------------------
export type CardParseOutcome =
  | { ok: true; product: CollectedProduct }
  | { ok: false; reason: string };

export function parseProductCard(
  card: Element,
  options: { rank?: number | null; baseUrl?: string } = {},
): CardParseOutcome {
  const url = extractProductUrl(card, options.baseUrl);
  const productId = extractProductId(card, url);
  const name = extractName(card);

  if (!productId) return { ok: false, reason: "product_id를 찾지 못함" };
  if (!name) return { ok: false, reason: `상품명을 찾지 못함 (product_id=${productId})` };
  if (!url) return { ok: false, reason: `상품 URL을 찾지 못함 (product_id=${productId})` };

  return {
    ok: true,
    product: {
      product_id: productId,
      product_name: name,
      product_url: url,
      price: parsePrice(textOf(card, PRICE_SELECTORS)),
      // 리뷰 표기가 없으면 0 (요구사항 6)
      review_count: parseReviewCount(textOf(card, REVIEW_COUNT_SELECTORS)),
      rating: extractRating(card),
      delivery_type: extractDeliveryType(card),
      thumbnail_url: extractThumbnail(card, options.baseUrl),
      rank: options.rank ?? null,
      // 조회수 원천이 없다. 임의 값을 만들지 않는다.
      view_count: null,
      ...monthlyPurchaseFields(card),
    },
  };
}

/** 쿠팡이 표시하는 월간 구매 문구를 상품 필드로 변환한다. 없으면 전부 null. */
function monthlyPurchaseFields(root: ParentNode): {
  monthly_purchase_count: number | null;
  monthly_purchase_is_minimum: boolean | null;
  monthly_purchase_unit: string | null;
  monthly_purchase_text: string | null;
} {
  const purchase = findMonthlyPurchase(root);
  if (!purchase) {
    return {
      monthly_purchase_count: null,
      monthly_purchase_is_minimum: null,
      monthly_purchase_unit: null,
      monthly_purchase_text: null,
    };
  }
  return {
    monthly_purchase_count: purchase.count,
    monthly_purchase_is_minimum: purchase.isMinimum,
    monthly_purchase_unit: purchase.unit,
    monthly_purchase_text: purchase.text,
  };
}

// ---------------------------------------------------------------------------
// 페이지 전체 파싱
// ---------------------------------------------------------------------------
export function detectPageType(url: string): PageType {
  if (/\/vp\/products\/\d+/.test(url)) return "product";
  if (/\/np\/(categories|search)/.test(url)) {
    return url.includes("/search") ? "search" : "category";
  }
  if (/[?&]q=/.test(url) || url.includes("/search")) return "search";
  if (url.includes("/np/")) return "list";
  return "unknown";
}

export function extractCategoryCode(url: string): string | null {
  for (const pattern of CATEGORY_CODE_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

export function extractCategoryName(root: ParentNode): string | null {
  return textOf(root, CATEGORY_NAME_SELECTORS);
}

/** 카드 selector를 순서대로 시도해 가장 먼저 결과가 나온 것을 쓴다. */
function findCards(root: ParentNode): { cards: Element[]; selector: string | null } {
  for (const selector of PRODUCT_CARD_SELECTORS) {
    try {
      const found = Array.from(root.querySelectorAll(selector));
      if (found.length > 0) return { cards: found, selector };
    } catch {
      // 무시하고 다음 selector
    }
  }
  return { cards: [], selector: null };
}

/** 상품 상세 페이지(단일 상품) 파싱 */
function parseDetailPage(root: ParentNode, url: string): CardParseOutcome {
  const container = queryFirst(root, DETAIL_PAGE.root) ?? (root as unknown as Element);
  const name = textOf(container, DETAIL_PAGE.name);
  let productId: string | null = null;
  for (const pattern of PRODUCT_ID_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match && match[1]) {
      productId = match[1];
      break;
    }
  }

  if (!productId) return { ok: false, reason: "상세 페이지 URL에서 product_id를 찾지 못함" };
  if (!name) return { ok: false, reason: `상세 페이지에서 상품명을 찾지 못함 (product_id=${productId})` };

  const badge = queryFirst(container, DETAIL_PAGE.deliveryBadge);
  const badgeText = (attributeSoup(badge) + " " + (container.textContent ?? "")).toLowerCase();
  let delivery: DeliveryType | null = null;
  for (const { keywords, type } of DELIVERY_KEYWORDS) {
    if (keywords.some((k) => badgeText.includes(k.toLowerCase()))) {
      delivery = type as DeliveryType;
      break;
    }
  }

  const thumb = queryFirst(container, DETAIL_PAGE.thumbnail);

  return {
    ok: true,
    product: {
      product_id: productId,
      product_name: name,
      product_url: url,
      price: parsePrice(textOf(container, DETAIL_PAGE.price)),
      review_count: parseReviewCount(textOf(container, DETAIL_PAGE.reviewCount)),
      rating: parseRating(textOf(container, DETAIL_PAGE.rating)),
      delivery_type: delivery,
      thumbnail_url: absoluteUrl(thumb?.getAttribute("src"), url),
      rank: null,
      view_count: null,
      // 상세 페이지에서는 문서 전체를 대상으로 문구를 찾는다.
      ...monthlyPurchaseFields(container),
    },
  };
}

/**
 * 현재 문서에서 상품 목록을 뽑는다.
 * 화면에 실제로 렌더링된 DOM만 읽는다. 추가 요청을 보내지 않는다.
 */
export function parseProductList(root: ParentNode, sourceUrl: string): ParseResult {
  const pageType = detectPageType(sourceUrl);
  const result: ParseResult = {
    products: [],
    skipped: 0,
    errors: [],
    pageType,
    categoryCode: extractCategoryCode(sourceUrl),
    categoryName: extractCategoryName(root),
    sourceUrl,
    matchedCardSelector: null,
  };

  if (pageType === "product") {
    const outcome = parseDetailPage(root, sourceUrl);
    if (outcome.ok) result.products.push(outcome.product);
    else {
      result.skipped += 1;
      result.errors.push(outcome.reason);
    }
    return result;
  }

  const { cards, selector } = findCards(root);
  result.matchedCardSelector = selector;

  if (cards.length === 0) {
    result.errors.push(
      "상품 카드를 찾지 못했습니다. 쿠팡 화면 구조가 바뀌었을 수 있습니다 — extension/src/parsers/selectors.ts 를 확인하세요.",
    );
    return result;
  }

  cards.forEach((card, index) => {
    const outcome = parseProductCard(card, { rank: index + 1, baseUrl: sourceUrl });
    if (outcome.ok) result.products.push(outcome.product);
    else {
      result.skipped += 1;
      result.errors.push(outcome.reason);
    }
  });

  return result;
}
