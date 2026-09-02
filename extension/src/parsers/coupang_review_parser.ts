/**
 * 리뷰 작성일 파서 — 최근 30일 리뷰수를 구하기 위한 모듈.
 *
 * 왜 필요한가
 *   쿠팡은 "최근 1달 리뷰수"를 화면 어디에도 표시하지 않는다.
 *   상품 카드/상세의 리뷰수는 전부 **누적** 리뷰수다.
 *   따라서 최근 30일 리뷰수는 리뷰 하나하나의 작성일을 직접 세어야 알 수 있다.
 *
 * 무엇을 하는가
 *   상품 상세 페이지에 **이미 렌더링된** 리뷰들의 작성일을 읽어
 *   30일 이내 개수와 표본 정보를 계산한다.
 *
 * 하지 않는 것
 *   - 다음 페이지를 자동으로 요청하지 않는다(대규모 자동 크롤링 금지).
 *   - 날짜를 읽지 못하면 값을 만들어내지 않는다.
 */

import {
  REVIEW_DATE_PATTERNS,
  REVIEW_DATE_SELECTORS,
  REVIEW_ITEM_SELECTORS,
  REVIEW_NEWEST_KEYWORDS,
  REVIEW_SECTION_SELECTORS,
  REVIEW_SORT_SELECTORS,
  REVIEW_TOTAL_COUNT_SELECTORS,
} from "@/parsers/selectors";
import { parseReviewCount } from "@/parsers/normalize";

export const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 리뷰 한 건. key는 페이지를 넘나들며 중복을 걸러내기 위한 식별자다. */
export type ReviewEntry = {
  key: string;
  date: Date;
};

export type ReviewDateAnalysis = {
  /** 30일 이내로 확인된 리뷰 개수 */
  reviewsInWindow: number;
  /** 날짜를 읽어낸 전체 리뷰 개수 */
  sampleSize: number;
  /** 표본의 최신 ~ 최고령 리뷰 사이 일수 */
  sampleSpanDays: number | null;
  /** 표본이 30일 경계를 넘었는지(= 30일보다 오래된 리뷰를 봤는지) */
  coversWindow: boolean;
  newestReviewDate: string | null;
  oldestReviewDate: string | null;
  /** 상세 페이지에 표시된 누적 리뷰수 */
  totalReviewCount: number | null;
  /** 리뷰 정렬이 최신순인지 (아니면 표본이 왜곡된다) */
  sortedByNewest: boolean | null;
  /** 안내/경고 문구 */
  warnings: string[];
};

function queryFirst(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    try {
      const found = root.querySelector(selector);
      if (found) return found;
    } catch {
      // 잘못된 selector는 건너뛴다.
    }
  }
  return null;
}

function queryAll(root: ParentNode, selectors: readonly string[]): Element[] {
  for (const selector of selectors) {
    try {
      const found = Array.from(root.querySelectorAll(selector));
      if (found.length > 0) return found;
    } catch {
      // 무시
    }
  }
  return [];
}

/** "2026.08.15" 같은 텍스트를 Date로. 실패하면 null. */
export function parseReviewDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const text = String(raw).trim();
  for (const pattern of REVIEW_DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) continue;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const date = new Date(year, month - 1, day);
    // 미래 날짜는 잘못 읽은 것으로 본다.
    if (date.getTime() > Date.now() + DAY_MS) continue;
    return date;
  }
  return null;
}

function oldestReviewLabel(oldest: Date): string {
  return formatDate(oldest);
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 리뷰 영역에서 정렬이 최신순인지 확인한다. 판단 불가면 null. */
export function detectSortedByNewest(root: ParentNode): boolean | null {
  const sortArea = queryFirst(root, REVIEW_SORT_SELECTORS);
  if (!sortArea) return null;
  const active = sortArea.querySelector(
    "[class*='active'], [aria-selected='true'], [aria-checked='true']",
  );
  const text = (active?.textContent ?? "").trim().toLowerCase();
  if (!text) return null;
  return REVIEW_NEWEST_KEYWORDS.some((k) => text.includes(k.toLowerCase()));
}

const ID_ATTRIBUTES = ["data-review-id", "data-id", "id"] as const;

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 리뷰 한 건의 식별자.
 *
 * 쿠팡 리뷰 목록은 페이지를 넘기면 이전 리뷰가 DOM에서 사라진다.
 * 여러 페이지를 오가며 읽은 리뷰를 중복 없이 누적하려면 안정적인 키가 필요하다.
 * data-* 아이디가 있으면 그것을, 없으면 (작성일 + 본문 앞부분)으로 만든다.
 */
function entryKey(item: Element | null, date: Date, fallbackText: string): string {
  if (item) {
    for (const attr of ID_ATTRIBUTES) {
      const value = item.getAttribute(attr);
      if (value && value.trim() !== "") return `id:${value.trim()}`;
    }
  }
  const iso = date.toISOString().slice(0, 10);
  return `txt:${iso}|${normalizeText(fallbackText).slice(0, 80)}`;
}

/**
 * 렌더된 리뷰들의 작성일을 모은다.
 *
 * 1차: 리뷰 카드 → 그 안의 날짜 요소
 * 2차(fallback): 리뷰 영역 전체 텍스트에서 날짜 패턴을 훑는다.
 *                (클래스명이 바뀌어도 최소한의 동작을 보장하기 위한 안전망)
 */
export function extractReviewEntries(root: ParentNode): {
  entries: ReviewEntry[];
  usedFallback: boolean;
} {
  const section = queryFirst(root, REVIEW_SECTION_SELECTORS) ?? root;

  const items = queryAll(section, REVIEW_ITEM_SELECTORS);
  if (items.length > 0) {
    const entries: ReviewEntry[] = [];
    for (const item of items) {
      const dateEl = queryFirst(item, REVIEW_DATE_SELECTORS);
      const date =
        parseReviewDate(dateEl?.getAttribute("datetime")) ??
        parseReviewDate(dateEl?.textContent) ??
        // 날짜 전용 요소를 못 찾으면 카드 텍스트에서 첫 날짜를 찾는다.
        parseReviewDate(item.textContent);
      if (date) entries.push({ key: entryKey(item, date, item.textContent ?? ""), date });
    }
    if (entries.length > 0) return { entries, usedFallback: false };
  }

  // fallback: 리뷰 영역 안의 잎 노드에서 날짜만 훑는다.
  const entries: ReviewEntry[] = [];
  const seen = new Map<string, number>();
  for (const el of Array.from(section.querySelectorAll("*"))) {
    if (el.children.length > 0) continue;
    const date = parseReviewDate(el.textContent);
    if (!date) continue;
    // 같은 날짜가 여러 건일 수 있으므로 순번을 붙여 구분한다.
    const iso = date.toISOString().slice(0, 10);
    const index = (seen.get(iso) ?? 0) + 1;
    seen.set(iso, index);
    entries.push({ key: `fb:${iso}#${index}`, date });
  }
  return { entries, usedFallback: entries.length > 0 };
}

/** 하위 호환: 날짜만 필요할 때 */
export function collectReviewDates(root: ParentNode): { dates: Date[]; usedFallback: boolean } {
  const { entries, usedFallback } = extractReviewEntries(root);
  return { dates: entries.map((e) => e.date), usedFallback };
}

/** 상세 페이지에 표시된 누적 리뷰수 */
export function extractTotalReviewCount(root: ParentNode): number | null {
  const el = queryFirst(root, REVIEW_TOTAL_COUNT_SELECTORS);
  if (!el) return null;
  const text = (el.textContent ?? "").trim();
  if (!text) return null;
  const value = parseReviewCount(text);
  return value > 0 ? value : null;
}

/**
 * 현재 화면의 리뷰 작성일을 분석해 최근 30일 리뷰수 산출에 필요한 값을 만든다.
 *
 * @param root      분석 대상 문서
 * @param now       테스트에서 기준 시각을 고정하기 위한 인자
 * @param carryOver 사용자가 앞서 넘겨 본 페이지에서 누적해 둔 리뷰들.
 *                  쿠팡 리뷰는 페이지를 넘기면 이전 리뷰가 DOM에서 사라지므로,
 *                  이걸 합쳐야 30일 구간을 덮을 수 있다.
 */
export function analyzeReviewDates(
  root: ParentNode,
  now: Date = new Date(),
  carryOver: ReviewEntry[] = [],
): ReviewDateAnalysis {
  const warnings: string[] = [];
  const { entries: current, usedFallback } = extractReviewEntries(root);

  // 누적분과 현재 페이지를 key로 합친다(중복 제거).
  const merged = new Map<string, Date>();
  for (const entry of carryOver) merged.set(entry.key, entry.date);
  for (const entry of current) merged.set(entry.key, entry.date);
  const dates = [...merged.values()];

  const sortedByNewest = detectSortedByNewest(root);
  const totalReviewCount = extractTotalReviewCount(root);

  if (usedFallback) {
    warnings.push(
      "리뷰 카드 구조를 인식하지 못해 날짜 패턴만으로 읽었습니다. 값이 부정확할 수 있습니다.",
    );
  }
  if (sortedByNewest === false) {
    warnings.push("리뷰가 최신순으로 정렬되어 있지 않습니다. '최신순'으로 바꾼 뒤 다시 분석하세요.");
  }

  if (dates.length === 0) {
    return {
      reviewsInWindow: 0,
      sampleSize: 0,
      sampleSpanDays: null,
      coversWindow: false,
      newestReviewDate: null,
      oldestReviewDate: null,
      totalReviewCount,
      sortedByNewest,
      warnings: [
        ...warnings,
        "리뷰 작성일을 하나도 읽지 못했습니다. 리뷰 영역을 화면에 표시한 뒤 다시 시도하세요.",
      ],
    };
  }

  const sorted = [...dates].sort((a, b) => b.getTime() - a.getTime());
  const newest = sorted[0] as Date;
  const oldest = sorted[sorted.length - 1] as Date;

  const cutoff = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const reviewsInWindow = sorted.filter((d) => d.getTime() >= cutoff.getTime()).length;

  // 표본에 30일보다 오래된 리뷰가 있으면 30일 구간을 완전히 덮은 것이다.
  const coversWindow = oldest.getTime() < cutoff.getTime();

  const spanMs = newest.getTime() - oldest.getTime();
  const sampleSpanDays = spanMs > 0 ? spanMs / DAY_MS : 0;

  if (!coversWindow) {
    warnings.push(
      `읽은 리뷰 ${dates.length}건이 모두 최근 ${Math.max(1, Math.round(sampleSpanDays))}일 안에 있습니다. ` +
        `리뷰 목록에서 ${oldestReviewLabel(oldest)} 이전 리뷰가 나올 때까지 다음 페이지로 넘기면 ` +
        "확장이 자동으로 누적해 30일 실측값을 만듭니다.",
    );
  }

  return {
    reviewsInWindow,
    sampleSize: dates.length,
    sampleSpanDays,
    coversWindow,
    newestReviewDate: formatDate(newest),
    oldestReviewDate: formatDate(oldest),
    totalReviewCount,
    sortedByNewest,
    warnings,
  };
}
