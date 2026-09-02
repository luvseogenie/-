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
  BREADCRUMB_SELECTORS,
  CATEGORY_CODE_URL_PATTERNS,
  CATEGORY_LINK_SELECTOR,
  CATEGORY_NAME_SELECTORS,
  MAX_BREADCRUMB_DEPTH,
  DELIVERY_BADGE_SELECTORS,
  DELIVERY_KEYWORDS,
  DETAIL_TITLE_REJECT,
  DETAIL_TITLE_SUFFIX_PATTERNS,
  DETAIL_PAGE,
  LINK_SELECTORS,
  NAME_FALLBACK_IMG_SELECTORS,
  NAME_SELECTORS,
  PRICE_SELECTORS,
  PRODUCT_CARD_CONTAINERS,
  PRODUCT_CARD_SELECTORS,
  PRODUCT_ID_ATTRIBUTES,
  PRODUCT_LINK_SELECTOR,
  PRICE_TEXT_PATTERN,
  PRICE_UNIT_KEYWORDS,
  RATING_STYLE_PATTERN,
  REVIEW_COUNT_TEXT_PATTERN,
  PRODUCT_ID_URL_PATTERNS,
  RATING_SELECTORS,
  REVIEW_COUNT_SELECTORS,
  THUMBNAIL_SELECTORS,
} from "@/parsers/selectors";
import { absoluteUrl, parsePrice, parseRating, parseReviewCount } from "@/parsers/normalize";
import { findMonthlyPurchase } from "@/parsers/coupang_purchase_parser";
import { parseNextData } from "@/parsers/coupang_next_data";
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

const LABEL_ATTRIBUTES = ["alt", "title", "aria-label", "src", "class"] as const;

/**
 * 배지 등에서 값이 될 만한 속성을 모두 긁는다.
 *
 * 배송 배지는 텍스트가 아니라 이미지의 alt에 들어 있는 경우가 많다.
 *   <div class="ImageBadge_default_image__x"><img alt="로켓그로스"></div>
 * 그래서 요소 자신뿐 아니라 자손의 속성까지 함께 본다.
 */
function attributeSoup(el: Element | null): string {
  if (!el) return "";
  const parts: string[] = [el.textContent ?? ""];
  const collect = (target: Element) => {
    for (const attr of LABEL_ATTRIBUTES) parts.push(target.getAttribute(attr) ?? "");
  };
  collect(el);
  for (const child of Array.from(el.querySelectorAll("img, [alt], [title], [aria-label]")).slice(0, 20)) {
    collect(child);
  }
  return parts.join(" ");
}

/**
 * 배지를 못 찾았을 때 카드 전체에서 배송 키워드를 찾는다.
 *
 * 실제 쿠팡 목록에서는 배송 배지가 alt 없는 <img>로만 그려진다.
 *   <img src="https://image7.coupangcdn.com/.../logoRocketMerchant@2x.png" alt="">
 * 그래서 이미지 파일명(src)까지 함께 본다.
 *
 * 상품 썸네일의 alt는 상품명이라 오탐을 낼 수 있으므로 짧은 라벨성 값만 쓴다
 * (배지 라벨은 "로켓배송"처럼 짧다).
 */
function cardLabelSoup(card: Element): string {
  const parts: string[] = [card.textContent ?? ""];
  for (const el of Array.from(card.querySelectorAll("[alt], [title], [aria-label]")).slice(0, 30)) {
    for (const attr of ["alt", "title", "aria-label"] as const) {
      const value = el.getAttribute(attr);
      if (value && value.length <= 20) parts.push(value);
    }
  }
  // 배지 이미지의 파일명만 취한다(상품 썸네일 경로가 오탐을 내지 않도록 마지막 조각만).
  for (const img of Array.from(card.querySelectorAll("img[src]")).slice(0, 20)) {
    const src = img.getAttribute("src") ?? "";
    const fileName = src.split("?")[0]?.split("/").pop() ?? "";
    if (fileName) parts.push(fileName);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// 개별 필드 추출
// ---------------------------------------------------------------------------
/**
 * 상품 ID로 볼 수 있는 값인지 검사한다.
 *
 * 실제 쿠팡 목록 페이지에는 상품과 무관한 data-id="0" 같은 속성이 섞여 있다.
 * 이걸 그대로 쓰면 모든 상품의 ID가 "0"이 되어 중복 제거 시 1건만 남는다.
 * 쿠팡 상품 ID는 8자리 이상의 숫자이므로 그 형태만 인정한다.
 */
const MIN_ATTRIBUTE_ID_DIGITS = 6;

/**
 * URL 경로에서 뽑은 ID.
 * /vp/products/{id} 는 구조적으로 명확하므로 길이를 따지지 않는다.
 * 0뿐인 값만 거른다.
 */
function isValidUrlId(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) && !/^0+$/.test(trimmed);
}

/**
 * data-* 속성에서 뽑은 ID.
 * 광고·추적용 값이 섞여 있으므로(실제로 data-id="0" 이 모든 카드에 있었다)
 * 쿠팡 상품 ID 형태(6자리 이상 숫자)만 인정한다.
 */
function isPlausibleAttributeId(value: string | null | undefined): boolean {
  if (!isValidUrlId(value)) return false;
  return (value as string).trim().length >= MIN_ATTRIBUTE_ID_DIGITS;
}

/**
 * 상품 ID를 뽑는다.
 *
 * 순서가 중요하다. 상품 URL의 /vp/products/{id} 가 가장 확실한 근거이므로
 * data-* 속성보다 먼저 본다. data-* 는 광고·추적용 값이 섞여 있어
 * 그대로 믿으면 안 된다(실제로 data-id="0" 이 모든 카드에 있었다).
 */
export function extractProductId(card: Element, url: string | null): string | null {
  // 1) 상품 URL — 가장 확실하다.
  if (url) {
    for (const pattern of PRODUCT_ID_URL_PATTERNS) {
      const match = url.match(pattern);
      if (match && match[1] && isValidUrlId(match[1])) return match[1];
    }
  }

  // 2) 카드 자신의 data-* 속성 (형태 검사를 통과한 것만)
  for (const attr of PRODUCT_ID_ATTRIBUTES) {
    const value = card.getAttribute(attr);
    if (isPlausibleAttributeId(value)) return (value as string).trim();
  }

  // 3) 자식 요소의 data-* 속성
  for (const attr of PRODUCT_ID_ATTRIBUTES) {
    for (const child of Array.from(card.querySelectorAll(`[${attr}]`)).slice(0, 10)) {
      const value = child.getAttribute(attr);
      if (isPlausibleAttributeId(value)) return (value as string).trim();
    }
  }

  // 4) 마지막 수단: 카드 안의 상품 링크에서 다시 시도
  const link = card.querySelector(PRODUCT_LINK_SELECTOR);
  const href = link?.getAttribute("href");
  if (href) {
    for (const pattern of PRODUCT_ID_URL_PATTERNS) {
      const match = href.match(pattern);
      if (match && match[1] && isValidUrlId(match[1])) return match[1];
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
  const match = (haystack: string): DeliveryType | null => {
    const text = haystack.toLowerCase();
    for (const { keywords, type } of DELIVERY_KEYWORDS) {
      if (keywords.some((k) => text.includes(k.toLowerCase()))) return type as DeliveryType;
    }
    return null;
  };

  // 1) 배지 요소(및 그 안의 img alt 등)에서 찾는다.
  const badge = queryFirst(card, DELIVERY_BADGE_SELECTORS);
  const fromBadge = badge ? match(attributeSoup(badge)) : null;
  if (fromBadge) return fromBadge;

  // 2) 배지를 못 찾으면 카드 전체의 짧은 라벨에서 찾는다.
  return match(cardLabelSoup(card));
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
// 값의 형태로 찾는 대체 경로
//
// 쿠팡이 클래스명을 완전히 새로 지으면 어떤 selector도 맞출 수 없다.
// 이때는 클래스가 아니라 **값의 생김새**로 찾는다.
// ---------------------------------------------------------------------------

/** 카드 안의 잎 노드를 순서대로 훑는다. */
function leafNodes(card: Element): Element[] {
  return Array.from(card.querySelectorAll("*")).filter((el) => el.children.length === 0);
}

/** "(1,234)" 형태의 리뷰수를 찾는다. */
export function findReviewCountByShape(card: Element): number | null {
  for (const el of leafNodes(card)) {
    const text = (el.textContent ?? "").replace(/\s+/g, "").trim();
    const match = text.match(REVIEW_COUNT_TEXT_PATTERN);
    if (match && match[1]) {
      const value = parseReviewCount(match[1]);
      if (value >= 0) return value;
    }
  }
  return null;
}

/**
 * "13,900" 처럼 생긴 가격을 찾는다.
 * 바로 뒤(또는 부모)에 "원"이 있는 것만 가격으로 본다.
 */
export function findPriceByShape(card: Element): number | null {
  for (const el of leafNodes(card)) {
    const text = (el.textContent ?? "").replace(/\s+/g, "").trim();
    if (!PRICE_TEXT_PATTERN.test(text)) continue;

    const nearby = [
      el.nextElementSibling?.textContent ?? "",
      el.parentElement?.textContent ?? "",
    ].join(" ");
    if (!PRICE_UNIT_KEYWORDS.some((unit) => nearby.includes(unit))) continue;

    const value = parsePrice(text);
    if (value !== null && value >= 100) return value;
  }
  return null;
}

/** width:94% 같은 스타일로 그린 별점을 찾는다. */
export function findRatingByShape(card: Element): number | null {
  for (const el of Array.from(card.querySelectorAll("[style]"))) {
    const style = el.getAttribute("style") ?? "";
    const match = style.match(RATING_STYLE_PATTERN);
    if (!match || !match[1]) continue;
    const ratio = Number(match[1]);
    if (!Number.isFinite(ratio) || ratio > 100) continue;
    const rating = Math.round((ratio / 100) * 5 * 10) / 10;
    if (rating >= 0 && rating <= 5) return rating;
  }
  return null;
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
      // selector로 못 찾으면 값의 형태로 다시 찾는다(클래스명 전면 개편 대비).
      price: parsePrice(textOf(card, PRICE_SELECTORS)) ?? findPriceByShape(card),
      // 리뷰 표기가 없으면 0 (요구사항 6)
      review_count: (() => {
        const fromSelector = textOf(card, REVIEW_COUNT_SELECTORS);
        if (fromSelector !== null) return parseReviewCount(fromSelector);
        return findReviewCountByShape(card) ?? 0;
      })(),
      rating: extractRating(card) ?? findRatingByShape(card),
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

/**
 * 카테고리 경로(breadcrumb)를 읽는다.
 *
 * 예: 홈인테리어 > 카페트/매트 > 발매트
 * 이 계층을 그대로 DB에 만들면 사용자가 따로 카테고리를 import 하지 않아도
 * 수집하는 것만으로 트리가 채워진다.
 *
 * breadcrumb을 못 찾으면 현재 페이지의 카테고리 하나만 돌려준다.
 */
export function extractCategoryPath(
  root: ParentNode,
  sourceUrl: string,
): { code: string | null; name: string }[] {
  const container = queryFirst(root, BREADCRUMB_SELECTORS);
  if (container) {
    const path: { code: string | null; name: string }[] = [];
    let links: Element[] = [];
    try {
      links = Array.from(container.querySelectorAll(CATEGORY_LINK_SELECTOR));
    } catch {
      links = [];
    }
    for (const link of links) {
      const name = (link.textContent ?? "").trim();
      if (!name) continue;
      const href = link.getAttribute("href") ?? "";
      let code: string | null = null;
      for (const pattern of CATEGORY_CODE_URL_PATTERNS) {
        const match = href.match(pattern);
        if (match && match[1]) {
          code = match[1];
          break;
        }
      }
      if (code) path.push({ code, name });
    }
    // 좌측 전체 메뉴를 통째로 읽어버린 경우를 걸러낸다.
    if (path.length > 0 && path.length <= MAX_BREADCRUMB_DEPTH) {
      const current = extractCategoryCode(sourceUrl);
      // 현재 카테고리가 경로 끝에 없으면 붙인다.
      if (current && !path.some((item) => item.code === current)) {
        const name = extractCategoryName(root);
        if (name) path.push({ code: current, name });
      }
      return path;
    }
  }

  // breadcrumb이 없으면 현재 카테고리 하나만.
  const code = extractCategoryCode(sourceUrl);
  const name = extractCategoryName(root);
  return code && name ? [{ code, name }] : [];
}

/**
 * 상품 카드를 찾는다.
 *
 * 1) 알려진 카드 selector를 순서대로 시도
 * 2) 전부 실패하면 상품 링크(/vp/products/)에서 위로 올라가 카드를 역추적
 *
 * 쿠팡은 개편 때마다 클래스명을 바꾸지만 상품 링크 형태는 바뀌지 않는다.
 * 그래서 2)가 있으면 화면이 개편되어도 수집이 멈추지 않는다.
 */
export function findCards(root: ParentNode): { cards: Element[]; selector: string | null } {
  for (const selector of PRODUCT_CARD_SELECTORS) {
    try {
      const found = Array.from(root.querySelectorAll(selector));
      // 링크 기반 카드 수보다 턱없이 적으면 잘못 잡은 것으로 본다.
      if (found.length > 0) return { cards: found, selector };
    } catch {
      // 무시하고 다음 selector
    }
  }

  // 안전망: 상품 링크 앵커로 역추적
  const cards: Element[] = [];
  const seen = new Set<Element>();
  let links: Element[] = [];
  try {
    links = Array.from(root.querySelectorAll(PRODUCT_LINK_SELECTOR));
  } catch {
    return { cards: [], selector: null };
  }
  for (const link of links) {
    const card = link.closest(PRODUCT_CARD_CONTAINERS) ?? link.parentElement;
    if (card && !seen.has(card)) {
      seen.add(card);
      cards.push(card);
    }
  }
  return cards.length > 0
    ? { cards, selector: `${PRODUCT_LINK_SELECTOR} (링크 앵커)` }
    : { cards: [], selector: null };
}

/** 상품 상세 페이지(단일 상품) 파싱 */
/** 사이트 이름 꼬리표를 뗀 제목. 상품명으로 못 쓰면 null */
function cleanTitle(raw: string | null | undefined): string | null {
  let text = (raw ?? "").replace(/\s+/g, " ").trim();
  for (const pattern of DETAIL_TITLE_SUFFIX_PATTERNS) text = text.replace(pattern, "").trim();
  if (!text || DETAIL_TITLE_REJECT.test(text)) return null;
  return text;
}

/**
 * 상세 페이지 상품명.
 * 1) 알려진 selector → 2) og:title 등 문서 메타 → 3) <title> → 4) 첫 h1
 * 쿠팡이 화면 구조를 바꿔도 메타 정보와 제목은 거의 항상 남아 있다.
 */
export function detailProductName(root: ParentNode, container: ParentNode): string | null {
  const fromSelector = textOf(container, DETAIL_PAGE.name) ?? textOf(root, DETAIL_PAGE.name);
  if (fromSelector) return fromSelector;
  for (const selector of DETAIL_PAGE.nameMeta) {
    const meta = root.querySelector(selector);
    const name = cleanTitle(meta?.getAttribute("content"));
    if (name) return name;
  }
  const doc = (root as Document).title !== undefined ? (root as Document) : root.querySelector("title")?.ownerDocument ?? null;
  const fromTitle = cleanTitle(doc?.title ?? root.querySelector("title")?.textContent);
  if (fromTitle) return fromTitle;
  return cleanTitle(root.querySelector("h1")?.textContent);
}

function parseDetailPage(root: ParentNode, url: string): CardParseOutcome {
  const container = queryFirst(root, DETAIL_PAGE.root) ?? (root as unknown as Element);
  const name = detailProductName(root, container);
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
      // 상세 페이지에서는 문서 전체를 대상으로 문구를 찾는다 (컨테이너가 좁게 잡혀도 놓치지 않게).
      ...monthlyPurchaseFields(root),
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
    categoryPath: extractCategoryPath(root, sourceUrl),
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

  // 1순위: 쿠팡이 페이지에 실어 보내는 Next.js 데이터.
  // DOM에서 클래스명으로 긁는 것보다 정확하고 화면 개편에도 영향받지 않는다.
  const nextData = parseNextData(root);
  if (nextData) {
    result.products = nextData.products;
    result.skipped += nextData.skipped;
    result.matchedCardSelector = "__next_f (페이지 데이터)";
    if (!result.categoryName && nextData.categoryName) {
      result.categoryName = nextData.categoryName;
      // 카테고리 경로도 페이지 데이터의 이름으로 채운다.
      const code = result.categoryCode;
      if (code && result.categoryPath.length === 0) {
        result.categoryPath = [{ code, name: nextData.categoryName }];
      }
    }
    // DOM 에만 있는 상품(늦게 그려진 카드 등)이 있으면 보탠다. 같은 상품은 페이지 데이터를 우선한다.
    const known = new Set(result.products.map((p) => p.product_id));
    const { cards } = findCards(root);
    let added = 0;
    for (const card of cards) {
      const outcome = parseProductCard(card, { rank: result.products.length + 1, baseUrl: sourceUrl });
      if (outcome.ok && !known.has(outcome.product.product_id)) {
        known.add(outcome.product.product_id);
        result.products.push(outcome.product);
        added += 1;
      }
    }
    if (added > 0) result.matchedCardSelector = `__next_f (페이지 데이터) + DOM ${added}개`;
    return result;
  }

  // 2순위: DOM 파싱
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
