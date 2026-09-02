/**
 * ★ 쿠팡 DOM selector 모음 ★
 *
 * 쿠팡 화면이 바뀌면 **이 파일만** 수정하면 된다.
 * 다른 파일에는 CSS selector 문자열을 두지 않는다.
 *
 * 각 항목은 배열이며 앞에서부터 순서대로 시도한다(fallback).
 * 첫 번째로 값을 얻은 selector의 결과를 쓴다.
 *
 * 주의: 쿠팡은 클래스명이 자주 바뀌고 해시가 붙는 형태(ProductUnit_productUnit__xxxx)도
 * 쓰기 때문에 부분 일치 selector([class*="..."])를 함께 넣어 두었다.
 * 실제 화면에서 감지가 되지 않으면 개발자도구로 확인 후 여기에 selector를 추가하면 된다.
 */

/** 상품 카드(목록의 상품 한 칸) */
export const PRODUCT_CARD_SELECTORS = [
  "li.search-product",
  "li.baby-product",
  "li[class*='ProductUnit_productUnit']",
  "ul#productList > li",
  "ul.browse-product-list > li",
  "li[data-product-id]",
  "div[data-product-id]",
  "a[href*='/vp/products/']",
] as const;

/** 상품명 */
export const NAME_SELECTORS = [
  "div.name",
  ".search-product-wrap-title",
  "[class*='productName']",
  "[class*='ProductUnit_productName']",
  ".descriptions .name",
] as const;

/** 상품명 fallback: 썸네일 img의 alt (DOM에 실제로 존재하는 값이다) */
export const NAME_FALLBACK_IMG_SELECTORS = ["img.search-product-wrap-img", "img[alt]"] as const;

/** 가격 */
export const PRICE_SELECTORS = [
  "strong.price-value",
  ".price-value",
  "[class*='priceValue']",
  "[class*='Price_priceValue']",
  ".price .price-value",
  "em.sale strong",
] as const;

/** 리뷰 수 — 보통 "(1,234)" 형태 */
export const REVIEW_COUNT_SELECTORS = [
  "span.rating-total-count",
  ".rating-total-count",
  "[class*='ratingCount']",
  "[class*='ProductRating_ratingCount']",
  ".product-rating .rating-total-count",
] as const;

/** 평점 — width 스타일(%)이나 텍스트로 노출된다 */
export const RATING_SELECTORS = [
  "em.rating",
  "span.star em",
  ".rating",
  "[class*='ratingStar']",
  "[class*='ProductRating_star']",
] as const;

/** 배송 배지 (로켓배송 / 로켓그로스 등) */
export const DELIVERY_BADGE_SELECTORS = [
  "span.badge.rocket img",
  ".badge.rocket img",
  "img[class*='badge']",
  "[class*='ImageBadge_default_image']",
  "span.badge.rocket",
  ".delivery-badge",
] as const;

/** 썸네일 */
export const THUMBNAIL_SELECTORS = [
  "img.search-product-wrap-img",
  "dt.image img",
  "[class*='productImage'] img",
  "img[src*='coupangcdn']",
  "img",
] as const;

/** 상품 링크 */
export const LINK_SELECTORS = ["a.search-product-link", "a[href*='/vp/products/']", "a[href]"] as const;

/** 상품 상세 페이지(단일 상품) 전용 */
export const DETAIL_PAGE = {
  root: ["div.prod-atf", "#contents", "body"] as const,
  name: ["h1.prod-buy-header__title", "h2.prod-buy-header__title", "[class*='prod-buy-header__title']"] as const,
  price: [
    "span.total-price > strong",
    ".prod-sale-price .total-price strong",
    "[class*='price-amount']",
  ] as const,
  reviewCount: ["span#prod-review-nav-link-count", ".count", "[class*='reviewCount']"] as const,
  rating: ["span.rating-star-num", "[class*='rating-star-num']"] as const,
  thumbnail: ["img.prod-image__detail", "div.prod-image img"] as const,
  deliveryBadge: ["span.badge-rocket img", "[class*='badge-rocket']", ".prod-txt-normal"] as const,
} as const;

/**
 * 배송 방식 판별 키워드.
 * 배지 이미지의 alt/title/텍스트에서 찾는다. 앞에 있는 것이 우선한다.
 * (로켓그로스가 "로켓배송"보다 먼저 와야 한다 — 부분 문자열이 겹치기 때문)
 */
export const DELIVERY_KEYWORDS: { keywords: string[]; type: string }[] = [
  { keywords: ["로켓그로스", "판매자로켓", "rocket_growth", "growth"], type: "rocket_growth" },
  { keywords: ["로켓배송", "새벽배송", "로켓프레시", "rocket"], type: "rocket" },
  { keywords: ["판매자배송", "일반배송", "seller"], type: "seller" },
];

/** 상품 ID를 URL에서 뽑을 때 쓰는 패턴 */
export const PRODUCT_ID_URL_PATTERNS = [
  /\/vp\/products\/(\d+)/,
  /\/products\/(\d+)/,
  /[?&]itemId=(\d+)/,
] as const;

/** 상품 ID가 담긴 data-* 속성 (앞에서부터 시도) */
export const PRODUCT_ID_ATTRIBUTES = [
  "data-product-id",
  "data-id",
  "data-item-id",
  "data-vendor-item-id",
] as const;

/** 카테고리 코드를 URL에서 뽑을 때 쓰는 패턴 */
export const CATEGORY_CODE_URL_PATTERNS = [
  /\/np\/categories\/([\w-]+)/,
  /[?&]categoryId=([\w-]+)/,
  /[?&]component=(\d+)/,
] as const;

/** 현재 페이지의 카테고리명이 표시되는 위치 */
export const CATEGORY_NAME_SELECTORS = [
  "h2.title",
  ".breadcrumb li:last-child",
  "#breadcrumb li:last-child",
  "[class*='breadcrumb'] li:last-child",
  "h1.page-title",
] as const;

// ---------------------------------------------------------------------------
// 리뷰 영역 (최근 30일 리뷰수 산출용)
//
// 쿠팡은 "최근 1달 리뷰수"를 표시하지 않는다. 상세 페이지의 리뷰 목록을
// 최신순으로 정렬한 뒤, 화면에 렌더된 리뷰들의 작성일을 직접 읽어서 센다.
// 자동으로 다음 페이지를 요청하지 않는다(사용자가 화면에 띄운 것만 읽는다).
// ---------------------------------------------------------------------------

/** 리뷰 목록 영역(루트) */
export const REVIEW_SECTION_SELECTORS = [
  "section#sdpReview",
  "#sdpReview",
  "div.review-list",
  "section[class*='review']",
  "div[class*='reviewList']",
  "#productReview",
] as const;

/** 리뷰 한 건 */
export const REVIEW_ITEM_SELECTORS = [
  "article.sdp-review__article__list",
  "article[class*='review__article__list']",
  "div.sdp-review__article__list",
  "li[class*='reviewItem']",
  "article[class*='ReviewItem']",
] as const;

/** 리뷰 한 건 안의 작성일 */
export const REVIEW_DATE_SELECTORS = [
  "div.sdp-review__article__list__info__product-info__reg-date",
  "[class*='reg-date']",
  "[class*='regDate']",
  "[class*='review-date']",
  "time",
] as const;

/** 리뷰 정렬 컨트롤 (최신순으로 되어 있는지 확인용) */
export const REVIEW_SORT_SELECTORS = [
  "div.sdp-review__article__order__sort",
  "[class*='order__sort']",
  "[class*='reviewSort']",
] as const;

/** 정렬이 "최신순"임을 나타내는 활성 항목 */
export const REVIEW_SORT_ACTIVE_SELECTORS = [
  "div.sdp-review__article__order__sort__newest-btn.active",
  "[class*='newest'][class*='active']",
  "[aria-selected='true']",
  ".active",
] as const;

/** 상세 페이지의 누적 리뷰수 */
export const REVIEW_TOTAL_COUNT_SELECTORS = [
  "span#prod-review-nav-link-count",
  "[class*='sdp-review__average__total-star__info-count']",
  "[class*='reviewCount']",
  ".count",
] as const;

/**
 * 리뷰 작성일 텍스트 패턴.
 * 쿠팡은 "2026.08.15" 형태를 쓰지만, 표기가 바뀌어도 잡히도록 몇 가지를 함께 둔다.
 */
export const REVIEW_DATE_PATTERNS = [
  /(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/, // 2026.08.15 / 2026-08-15
  /(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/, // 2026년 8월 15일
] as const;

/** "최신순" 정렬 여부를 판단할 때 찾는 문구 */
export const REVIEW_NEWEST_KEYWORDS = ["최신순", "최근순", "newest"] as const;
