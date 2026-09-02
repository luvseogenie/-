/**
 * 쿠팡 목록 페이지의 Next.js 데이터 페이로드 파서.
 *
 * 쿠팡 목록/검색 페이지는 상품 데이터를 화면에 그리기 전에
 * 아래 형태로 페이지에 실어 보낸다.
 *
 *   self.__next_f.push([1, "...JSON 문자열..."])
 *
 * 이 JSON 안에는 우리가 필요한 값이 전부 정확한 타입으로 들어 있다.
 *
 *   legacyProductId              8133306304      ← 진짜 상품 ID
 *   imageAndTitleArea.title      상품명
 *   priceArea.i18nSalesPrice     "9800"          ← 숫자 문자열
 *   reviewArea.ratingCount       18              ← 리뷰수
 *   reviewArea.ratingAverage     4               ← 평점
 *   deliveryUnificationBadgeArea ROCKET_MERCHANT ← 배송 방식 코드
 *
 * DOM에서 클래스명으로 긁는 것보다 훨씬 정확하고, 쿠팡이 화면을 개편해도
 * 이 데이터 구조는 잘 바뀌지 않는다. 그래서 이 경로를 1순위로 쓰고,
 * 실패하면 기존 DOM 파서로 넘어간다.
 */

import type { CollectedProduct, DeliveryType } from "@/lib/types";

/** 페이로드를 담고 있는 스크립트를 찾는 표시 */
const PAYLOAD_MARKER = "__next_f.push";

/** self.__next_f.push([1,"...."]) 에서 문자열 인자만 뽑는다 */
const PUSH_PATTERN = /__next_f\.push\(\s*\[\s*\d+\s*,\s*("(?:[^"\\]|\\.)*")/g;

/**
 * 배송 배지 코드 → 우리 배송 방식.
 * 로켓그로스(판매자로켓)를 먼저 본다. ROCKET 이 겹치기 때문이다.
 */
const BADGE_TO_DELIVERY: { ids: string[]; type: DeliveryType }[] = [
  { ids: ["ROCKET_MERCHANT"], type: "rocket_growth" },
  { ids: ["ROCKET", "ROCKET_WOW", "ROCKET_FRESH", "ROCKET_GLOBAL", "ROCKET_DIRECT"], type: "rocket" },
];

/** 페이지에 실린 Next.js 페이로드 조각을 모두 이어붙인다. */
export function collectNextPayload(root: ParentNode): string {
  const parts: string[] = [];
  let scripts: Element[] = [];
  try {
    scripts = Array.from(root.querySelectorAll("script"));
  } catch {
    return "";
  }
  for (const script of scripts) {
    const text = script.textContent ?? "";
    if (!text.includes(PAYLOAD_MARKER)) continue;
    PUSH_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PUSH_PATTERN.exec(text)) !== null) {
      const literal = match[1];
      if (!literal) continue;
      try {
        // JS 문자열 리터럴이므로 JSON.parse로 이스케이프를 푼다.
        parts.push(JSON.parse(literal) as string);
      } catch {
        // 깨진 조각은 건너뛴다.
      }
    }
  }
  return parts.join("");
}

/** 문자열 리터럴 안의 괄호를 무시하면서 대괄호 짝을 찾는다. */
function findArrayEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 페이로드에서 "<key>":[ ... ] 배열을 찾아 파싱한다. */
export function extractArray(payload: string, key: string): unknown[] | null {
  const marker = `"${key}":[`;
  let index = payload.indexOf(marker);
  while (index !== -1) {
    const start = index + marker.length - 1;
    const end = findArrayEnd(payload, start);
    if (end !== -1) {
      try {
        const parsed = JSON.parse(payload.slice(start, end + 1));
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // 다음 후보를 시도한다.
      }
    }
    index = payload.indexOf(marker, index + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 상품 변환
// ---------------------------------------------------------------------------
type Raw = Record<string, unknown>;

function obj(value: unknown): Raw | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function deliveryOf(product: Raw): DeliveryType | null {
  const area = obj(product.deliveryUnificationBadgeArea);
  const badge = area ? obj(area.badge) : null;
  const list = badge && Array.isArray(badge.badgeList) ? badge.badgeList : [];
  const ids = list
    .map((item) => obj(item)?.badgeId)
    .filter((id): id is string => typeof id === "string");

  for (const { ids: candidates, type } of BADGE_TO_DELIVERY) {
    if (ids.some((id) => candidates.includes(id))) return type;
  }

  // 배지가 없고 로켓 영역도 감춰져 있으면 판매자배송으로 본다.
  const rocket = obj(product.rocketArea);
  if (rocket && rocket.show === false) return "seller";
  return null;
}

function absoluteUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://www.coupang.com${url}`;
  return url;
}

/** Next.js 상품 객체 하나를 수집 형식으로 바꾼다. 필수값이 없으면 null. */
export function fromNextProduct(raw: unknown): CollectedProduct | null {
  const product = obj(raw);
  if (!product) return null;

  const id = num(product.legacyProductId);
  const titleArea = obj(product.imageAndTitleArea);
  const title = typeof titleArea?.title === "string" ? titleArea.title.trim() : "";
  const link = typeof product.link === "string" ? product.link : "";

  if (id === null || id <= 0 || !title || !link) return null;

  const priceArea = obj(product.priceArea);
  const salesPrice = priceArea ? obj(priceArea.i18nSalesPrice) : null;
  const price = num(salesPrice?.amount) ?? num(priceArea?.price);

  const reviewArea = obj(product.reviewArea);
  const reviewCount = num(reviewArea?.ratingCount) ?? 0;
  const rating = num(reviewArea?.ratingAverage);

  const thumbnail = typeof titleArea?.defaultUrl === "string" ? titleArea.defaultUrl : null;
  const sequence = num(product.sequence);

  return {
    product_id: String(id),
    product_name: title,
    product_url: absoluteUrl(link),
    price: price !== null && price > 0 ? Math.round(price) : null,
    review_count: Math.max(0, Math.round(reviewCount)),
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    delivery_type: deliveryOf(product),
    thumbnail_url: thumbnail ? absoluteUrl(thumbnail) : null,
    rank: sequence !== null ? Math.round(sequence) + 1 : null,
    view_count: null,
    // 목록 페이지에는 "한 달간 N명 구매" 문구가 없다.
    monthly_purchase_count: null,
    monthly_purchase_is_minimum: null,
    monthly_purchase_unit: null,
    monthly_purchase_text: null,
  };
}

export type NextDataResult = {
  products: CollectedProduct[];
  /** 페이로드에 있었지만 필수값이 없어 제외된 개수 */
  skipped: number;
  categoryName: string | null;
};

/** 페이로드에서 카테고리명을 찾는다. (h1 children) */
function findCategoryName(payload: string): string | null {
  const match = payload.match(/"h1","title",\{[^}]*?"children":"((?:[^"\\]|\\.)*)"/);
  if (match && match[1]) {
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return match[1];
    }
  }
  return null;
}

/**
 * 페이지의 Next.js 페이로드에서 상품 목록을 뽑는다.
 * 페이로드가 없거나 상품 배열을 못 찾으면 null.
 */
export function parseNextData(root: ParentNode): NextDataResult | null {
  const payload = collectNextPayload(root);
  if (!payload) return null;

  const rows = extractArray(payload, "products");
  if (!rows) return null;

  const products: CollectedProduct[] = [];
  let skipped = 0;
  for (const row of rows) {
    const product = fromNextProduct(row);
    if (product) products.push(product);
    else skipped += 1;
  }
  if (products.length === 0) return null;

  return { products, skipped, categoryName: findCategoryName(payload) };
}
