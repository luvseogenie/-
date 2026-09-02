/**
 * DOM 텍스트 → 숫자 정규화.
 *
 * 원칙: 값을 읽을 수 없으면 null을 돌려준다. 임의의 숫자를 만들지 않는다.
 * (리뷰 수만 예외적으로 "없음 = 0"으로 취급한다 — 요구사항 6)
 */

/** 전각 숫자, 공백, 특수문자를 정리한다. */
function clean(text: string): string {
  return text
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/ /g, " ")
    .trim();
}

/**
 * "(1,234)" → 1234, "리뷰 82" → 82, "1.2만" → 12000
 * 값을 찾지 못하면 null.
 */
export function parseIntLoose(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = clean(String(raw));
  if (!text) return null;

  // 만/천 단위 표기 (예: 1.2만, 3천)
  const unit = text.match(/([\d,]+(?:\.\d+)?)\s*(만|천)/);
  if (unit && unit[1] && unit[2]) {
    const base = Number(unit[1].replace(/,/g, ""));
    if (Number.isFinite(base)) {
      return Math.round(base * (unit[2] === "만" ? 10000 : 1000));
    }
  }

  const match = text.match(/-?[\d,]+/);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * 리뷰 수. "(1,234)" → 1234.
 * 리뷰 표기 자체가 없으면 0으로 본다(요구사항 6).
 */
export function parseReviewCount(raw: string | null | undefined): number {
  const value = parseIntLoose(raw);
  if (value === null || value < 0) return 0;
  return value;
}

/** "13,900원" → 13900. 값이 없으면 null. */
export function parsePrice(raw: string | null | undefined): number | null {
  const value = parseIntLoose(raw);
  if (value === null || value < 0) return null;
  return value;
}

/**
 * 평점. "4.7" → 4.7
 * 쿠팡은 별점을 width:94% 같은 스타일로 표현하기도 한다 → 0~5로 환산한다.
 */
export function parseRating(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = clean(String(raw));
  if (!text) return null;

  const percent = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percent && percent[1]) {
    const ratio = Number(percent[1]);
    if (Number.isFinite(ratio)) {
      const rating = Math.round((ratio / 100) * 5 * 10) / 10;
      return rating >= 0 && rating <= 5 ? rating : null;
    }
  }

  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  // 0~5 범위를 벗어나면 평점이 아니라고 본다.
  return value >= 0 && value <= 5 ? value : null;
}

/** 상대 URL을 절대 URL로. 실패하면 원본을 그대로 돌려준다. */
export function absoluteUrl(href: string | null | undefined, base?: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base ?? "https://www.coupang.com").toString();
  } catch {
    return href;
  }
}
