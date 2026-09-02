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

/**
 * 상품 카드(목록의 상품 한 칸).
 *
 * 쿠팡은 개편 때마다 클래스명을 바꾸므로(예: search-product → ProductUnit_productUnit__해시)
 * 이 목록만 믿으면 안 된다. 여기서 못 찾으면 파서가
 * PRODUCT_LINK_SELECTOR 앵커로 카드를 역추적한다(coupang_product_parser.ts).
 */
export const PRODUCT_CARD_SELECTORS = [
  "li.search-product",
  "li.baby-product",
  "li[class*='ProductUnit_productUnit']",
  "ul#productList > li",
  "ul.browse-product-list > li",
  "li[data-product-id]",
  "div[data-product-id]",
] as const;

/**
 * ★ 상품 카드를 찾는 가장 안정적인 앵커.
 *
 * 클래스명은 바뀌어도 상품 링크의 형태(/vp/products/{id})는 바뀌지 않는다.
 * 이 링크에서 위로 올라가 카드 컨테이너를 찾는다.
 */
export const PRODUCT_LINK_SELECTOR = "a[href*='/vp/products/']" as const;

/** 앵커에서 위로 올라가며 찾을 카드 컨테이너 */
export const PRODUCT_CARD_CONTAINERS = "li, article" as const;

/** 상품명 */
export const NAME_SELECTORS = [
  "div.name",
  ".search-product-wrap-title",
  "[class*='productName']",
  "[class*='ProductName']",
  "[class*='product-name']",
  ".descriptions .name",
] as const;

/** 상품명 fallback: 썸네일 img의 alt (DOM에 실제로 존재하는 값이다) */
export const NAME_FALLBACK_IMG_SELECTORS = ["img.search-product-wrap-img", "img[alt]"] as const;

/** 가격 */
export const PRICE_SELECTORS = [
  "strong.price-value",
  ".price-value",
  "[class*='priceValue']",
  "[class*='PriceValue']",
  "[class*='price-value']",
  ".price .price-value",
  "em.sale strong",
] as const;

/** 리뷰 수 — 보통 "(1,234)" 형태 */
export const REVIEW_COUNT_SELECTORS = [
  "span.rating-total-count",
  ".rating-total-count",
  "[class*='ratingCount']",
  "[class*='RatingCount']",
  "[class*='rating-count']",
  ".product-rating .rating-total-count",
] as const;

/** 평점 — width 스타일(%)이나 텍스트로 노출된다 */
export const RATING_SELECTORS = [
  "em.rating",
  "span.star em",
  ".rating",
  "[class*='ratingStar']",
  "[class*='RatingStar']",
  "[class*='_star']",
  "[class*='rating-star']",
] as const;

/** 배송 배지 (로켓배송 / 로켓그로스 등) */
export const DELIVERY_BADGE_SELECTORS = [
  "span.badge.rocket",
  ".badge.rocket",
  "[class*='ImageBadge']",
  "[class*='DeliveryBadge']",
  "[class*='deliveryBadge']",
  "[class*='badge']",
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
  // 로켓그로스(판매자로켓)를 먼저 본다. "rocket"이 겹치기 때문이다.
  // 쿠팡 목록의 배지는 alt가 비어 있고 이미지 파일명에만 단서가 있는 경우가 많다.
  //   예: .../logoRocketMerchant@2x.png, .../rocket_merchant.png
  {
    keywords: [
      "로켓그로스", "판매자로켓",
      "rocketmerchant", "rocket_merchant", "rocket-merchant", "merchant",
      "rocket_growth", "growth",
    ],
    type: "rocket_growth",
  },
  {
    keywords: [
      "로켓배송", "새벽배송", "로켓프레시", "로켓직구", "로켓와우",
      "rocketfresh", "rocket_fresh", "rocketglobal", "rocket_global",
      "logo_rocket", "logorocket", "rocket",
    ],
    type: "rocket",
  },
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

/**
 * 카테고리 경로(breadcrumb).
 * 여기서 읽은 계층을 그대로 DB에 만들어 두면 별도 import 없이 트리가 채워진다.
 */
export const BREADCRUMB_SELECTORS = [
  "ul.breadcrumb",
  "#breadcrumb",
  "[class*='breadcrumb']",
  "[class*='Breadcrumb']",
  "nav[aria-label*='경로']",
] as const;

/** breadcrumb 안의 카테고리 링크 */
export const CATEGORY_LINK_SELECTOR = "a[href*='/np/categories/']" as const;

/** breadcrumb 경로 최대 길이 (좌측 전체 메뉴를 잘못 읽는 것을 막는다) */
export const MAX_BREADCRUMB_DEPTH = 8;

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
  "div[class*='js_reviewArticleList']",
  "div[class*='js_reviewArticleContainer']",
  "#productReview",
] as const;

/**
 * 리뷰 한 건.
 *
 * 2026년 개편 이후 쿠팡 리뷰 카드는 Tailwind 유틸리티 클래스만 쓴다.
 *   <article class="twc-pt-[16px] xl:twc-pt-[24px] twc-border-b-[1px] ...">
 * 의미 있는 클래스명이 없어 클래스 기반 selector는 신뢰할 수 없다.
 *
 * 대신 각 리뷰 카드 안에는 도움돼요 영역에 data-review-id 가 남아 있다.
 *   <div class="sdp-review__article__list__help js_reviewArticleHelpfulContainer"
 *        data-review-id="956372574" data-count="4">
 * 그래서 파서는 REVIEW_ID_ANCHOR_SELECTORS 로 앵커를 찾아
 * closest(REVIEW_CARD_CONTAINERS) 로 카드를 역추적한다(coupang_review_parser.ts).
 * 아래 목록은 구버전/변형 레이아웃 대비용이다.
 */
export const REVIEW_ITEM_SELECTORS = [
  "article.sdp-review__article__list",
  "article[class*='review__article__list']",
  "div.sdp-review__article__list",
  "li[class*='reviewItem']",
  "article[class*='ReviewItem']",
] as const;

/**
 * ★ 리뷰 카드를 찾는 가장 안정적인 앵커.
 * 클래스명이 바뀌어도 리뷰 식별자는 남는다.
 */
export const REVIEW_ID_ANCHOR_SELECTORS = [
  "[data-review-id]",
  "[data-reviewid]",
  "[data-review_id]",
] as const;

/** 앵커에서 위로 올라가며 찾을 카드 컨테이너 */
export const REVIEW_CARD_CONTAINERS = "article, li, section" as const;

/**
 * 리뷰 한 건 안의 작성일.
 *
 * 개편 이후에는 날짜 전용 클래스가 없다. 작성일·판매자·옵션명이
 * 모두 `twc-text-bluegray-700` 을 공유하기 때문에 클래스로는 구분할 수 없다.
 *   <div class="twc-text-[14px]/[15px] twc-text-bluegray-700">2026.07.24</div>
 * 그래서 파서는 아래 selector가 실패하면
 * "요소의 전체 텍스트가 날짜 형식과 정확히 일치"하는 잎 노드를 찾는다.
 */
export const REVIEW_DATE_SELECTORS = [
  "div.sdp-review__article__list__info__product-info__reg-date",
  "[class*='reg-date']",
  "[class*='regDate']",
  "[class*='review-date']",
  "time[datetime]",
] as const;

/** 리뷰 정렬 컨트롤 (최신순으로 되어 있는지 확인용) */
export const REVIEW_SORT_SELECTORS = [
  "div.sdp-review__article__order__sort",
  "[class*='order__sort']",
  "[class*='reviewSort']",
  "[class*='js_reviewArticleOrder']",
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
 * 요소 전체가 날짜인지 판별할 때 쓰는 패턴(앞뒤에 다른 글자가 없어야 한다).
 * 리뷰 본문 안의 날짜를 작성일로 오인하지 않기 위해 필요하다.
 */
export const REVIEW_DATE_EXACT_PATTERNS = [
  /^(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\.?$/,
  /^(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일$/,
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

// ---------------------------------------------------------------------------
// 월간 구매 문구 — 쿠팡이 직접 표시하는 실제 판매 데이터
//
//   "한 달간 3,000명 이상 구매했어요"
//
// 리뷰수 × 배수 추정과 달리 쿠팡이 계산해 붙여 주는 값이라 신뢰도가 훨씬 높다.
// 단, (1) 구매자 "명" 단위이고 (2) "이상" 구간값이다.
//
// 클래스명은 개편으로 자주 바뀌므로, 문구 자체를 앵커로 삼는다.
// ---------------------------------------------------------------------------

/** 문구가 들어 있을 만한 영역 (있으면 탐색 범위를 좁힌다) */
export const MONTHLY_PURCHASE_SELECTORS = [
  "span.prod-buy-header__brand-info",
  "[class*='monthly-purchase']",
  "[class*='monthlyPurchase']",
  "[class*='purchase-count']",
  "[class*='sales-count']",
] as const;

/**
 * 월간 구매 문구 패턴.
 *   "한 달간 3,000명 이상 구매했어요"
 *   "한달간 1만명 이상 구매했어요"
 *   "최근 한 달간 500개 구매"
 *
 * 캡처: 1=숫자, 2=만/천 단위(선택), 3=명/개, 4="이상"(선택)
 */
export const MONTHLY_PURCHASE_PATTERNS = [
  /한\s*달\s*간?\s*([\d,]+(?:\.\d+)?)\s*(만|천)?\s*(명|개)\s*(이상)?\s*(?:이)?\s*(?:구매|판매)/,
  /최근\s*30\s*일\s*간?\s*([\d,]+(?:\.\d+)?)\s*(만|천)?\s*(명|개)\s*(이상)?\s*(?:이)?\s*(?:구매|판매)/,
] as const;

/** 문구를 찾을 때 먼저 걸러내는 키워드 (전체 텍스트 스캔 비용 절감) */
export const MONTHLY_PURCHASE_KEYWORDS = ["구매했어요", "구매 했어요", "판매됐어요", "구매"] as const;

// ---------------------------------------------------------------------------
// 값의 "형태"로 찾는 패턴
//
// 쿠팡이 클래스명을 완전히 새로 지으면(PlpCard_amount__x 처럼) 어떤 selector도
// 맞출 수 없다. 이때는 클래스 대신 **값의 생김새**로 찾는다.
// 리뷰 작성일을 "전체 텍스트가 날짜인 요소"로 찾은 것과 같은 방식이다.
// ---------------------------------------------------------------------------

/** 리뷰수 표기: "(1,234)" — 괄호로 감싼 숫자. 쿠팡 목록에서 매우 특징적이다. */
export const REVIEW_COUNT_TEXT_PATTERN = /^\(\s*([\d,]+)\s*\)$/;

/** 가격 표기: "13,900" — 천 단위 구분자가 있는 정수 (100 이상) */
export const PRICE_TEXT_PATTERN = /^\d{1,3}(?:,\d{3})+$|^\d{3,}$/;

/** 가격 옆에 붙는 단위 */
export const PRICE_UNIT_KEYWORDS = ["원"] as const;

/** 평점 별을 width 스타일로 그리는 경우 */
export const RATING_STYLE_PATTERN = /width\s*:\s*(\d+(?:\.\d+)?)\s*%/;
