/**
 * 월간 구매 문구 파서.
 *
 * 쿠팡은 상품 페이지에 실제 판매 데이터를 문구로 붙여 준다.
 *
 *   "한 달간 3,000명 이상 구매했어요"
 *
 * 이건 우리가 추정한 값이 아니라 **쿠팡이 계산해서 표시한 실제 데이터**다.
 * 그래서 리뷰수 × 배수 추정보다 우선한다.
 *
 * 다만 두 가지를 정확히 표시해야 한다.
 *   1) 단위가 "명"(구매자 수)이면 판매 수량은 그 이상이다.
 *   2) "이상"이 붙은 구간값이다. 3,000명 이상 = 3,000~4,999 어딘가.
 *
 * 클래스명은 개편으로 자주 바뀌므로 문구 자체를 앵커로 삼는다.
 */

import {
  MONTHLY_PURCHASE_KEYWORDS,
  MONTHLY_PURCHASE_PATTERNS,
  MONTHLY_PURCHASE_SELECTORS,
} from "@/parsers/selectors";

export type MonthlyPurchase = {
  /** 문구에서 읽은 숫자 (예: 3000) */
  count: number;
  /** "이상"이 붙어 있으면 true — 실제 값은 이 숫자 이상이다 */
  isMinimum: boolean;
  /** "명"(구매자 수) 또는 "개"(수량) */
  unit: "명" | "개";
  /** 원문 그대로 (화면에 근거로 보여주기 위함) */
  text: string;
};

/** "1만" → 10000, "3,000" → 3000 */
function toNumber(raw: string, unit: string | undefined): number | null {
  const base = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  if (unit === "만") return Math.round(base * 10000);
  if (unit === "천") return Math.round(base * 1000);
  return Math.round(base);
}

/**
 * 텍스트 한 조각에서 월간 구매 문구를 읽는다.
 * 문구가 없으면 null. 값을 만들어내지 않는다.
 */
export function parseMonthlyPurchaseText(raw: string | null | undefined): MonthlyPurchase | null {
  if (!raw) return null;
  const text = String(raw).replace(/\s+/g, " ").trim();
  if (!text) return null;

  for (const pattern of MONTHLY_PURCHASE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = toNumber(match[1] ?? "", match[2]);
    if (count === null || count <= 0) continue;
    const unit = (match[3] ?? "명") as "명" | "개";
    return {
      count,
      isMinimum: Boolean(match[4]),
      unit,
      // 원문은 길 수 있으므로 문구 주변만 잘라 둔다.
      text: match[0].trim(),
    };
  }
  return null;
}

/**
 * 문서(또는 상품 카드)에서 월간 구매 문구를 찾는다.
 *
 * 1) 알려진 selector 안에서 찾기
 * 2) 실패하면 "구매했어요" 같은 키워드를 가진 잎 노드를 훑기
 */
export function findMonthlyPurchase(root: ParentNode): MonthlyPurchase | null {
  for (const selector of MONTHLY_PURCHASE_SELECTORS) {
    try {
      for (const el of Array.from(root.querySelectorAll(selector))) {
        const found = parseMonthlyPurchaseText(el.textContent);
        if (found) return found;
      }
    } catch {
      // 잘못된 selector는 건너뛴다.
    }
  }

  // 문구 자체를 앵커로 삼는 안전망.
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.children.length > 0) continue;
    const text = el.textContent;
    if (!text) continue;
    if (!MONTHLY_PURCHASE_KEYWORDS.some((k) => text.includes(k))) continue;
    const found = parseMonthlyPurchaseText(text);
    if (found) return found;
  }

  // 잎 노드가 여러 개로 쪼개진 경우(예: 숫자만 <b>로 감싼 경우)를 위해
  // 키워드를 가진 요소의 부모 텍스트도 한 번 본다.
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const text = el.textContent;
    if (!text || text.length > 200) continue;
    if (!MONTHLY_PURCHASE_KEYWORDS.some((k) => text.includes(k))) continue;
    const found = parseMonthlyPurchaseText(text);
    if (found) return found;
  }

  return null;
}
