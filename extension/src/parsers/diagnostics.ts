/**
 * selector 진단 리포트.
 *
 * 쿠팡 화면 구조가 바뀌어 상품/리뷰가 감지되지 않을 때,
 * "어떤 selector가 몇 개를 찾았는지 + 실제 DOM이 어떻게 생겼는지"를
 * 사람이 읽을 수 있는 텍스트로 만든다.
 * 이 결과를 그대로 붙여넣으면 selectors.ts 를 정확히 고칠 수 있다.
 *
 * 개인정보 보호
 *   리뷰 본문과 작성자명 같은 텍스트는 ⟨text:N⟩ 으로 마스킹한다.
 *   날짜·숫자·짧은 UI 라벨만 그대로 남긴다.
 *   URL은 도메인과 마지막 경로만 남기고 쿼리스트링은 지운다.
 */

import {
  CATEGORY_NAME_SELECTORS,
  DELIVERY_BADGE_SELECTORS,
  NAME_SELECTORS,
  PRICE_SELECTORS,
  PRODUCT_CARD_SELECTORS,
  RATING_SELECTORS,
  REVIEW_DATE_PATTERNS,
  REVIEW_DATE_SELECTORS,
  REVIEW_ID_ANCHOR_SELECTORS,
  REVIEW_ITEM_SELECTORS,
  REVIEW_SECTION_SELECTORS,
  REVIEW_SORT_SELECTORS,
  REVIEW_TOTAL_COUNT_SELECTORS,
  REVIEW_COUNT_SELECTORS,
} from "@/parsers/selectors";
import { findReviewCards, findReviewId } from "@/parsers/coupang_review_parser";

const MAX_SAMPLE_NODES = 60;
const MAX_DATE_SAMPLES = 12;

/** 날짜처럼 보이는 텍스트인지 (마스킹하지 않는다) */
function looksLikeDate(text: string): boolean {
  return REVIEW_DATE_PATTERNS.some((p) => p.test(text));
}

/** 숫자/기호 위주의 짧은 텍스트인지 (가격·평점·리뷰수 — 마스킹하지 않는다) */
function looksLikeMetric(text: string): boolean {
  return text.length <= 20 && /^[\d,.\s()%원점개별★☆]+$/.test(text);
}

/**
 * UI 라벨 화이트리스트 (정렬 버튼 등 — 구조 파악에 필요).
 *
 * 반드시 **정확히 일치**할 때만 통과시킨다.
 * startsWith로 느슨하게 비교하면 "리뷰 본문입니다…" 같은 실제 리뷰 텍스트가
 * "리뷰" 접두사에 걸려 그대로 노출된다.
 */
const SAFE_LABELS = new Set([
  "최신순", "베스트순", "최근순", "평점 높은순", "평점 낮은순", "등록순",
  "로켓배송", "로켓그로스", "판매자배송", "무료배송", "내일 도착", "새벽배송",
  "더보기", "다음", "이전", "상품평", "리뷰", "리뷰 쓰기", "신고하기",
  "도움이 됐어요", "옵션", "판매자",
]);

function maskText(raw: string | null | undefined): string {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (looksLikeDate(text) || looksLikeMetric(text)) return text;
  if (SAFE_LABELS.has(text)) return text;

  // 짧고 숫자가 섞인 텍스트(리뷰수·가격 등)는 숫자만 따로 알려준다.
  // 본문 자체는 노출하지 않는다.
  if (text.length <= 30) {
    const numbers = text.match(/[\d,.]+/g);
    if (numbers && numbers.length > 0) {
      return `⟨text:${text.length} nums:${numbers.slice(0, 3).join("/")}⟩`;
    }
  }
  return `⟨text:${text.length}⟩`;
}

function maskUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://www.coupang.com");
    const last = url.pathname.split("/").filter(Boolean).slice(-1)[0] ?? "";
    return `${url.origin}/…/${last}`;
  } catch {
    return raw.slice(0, 40);
  }
}

/** 요소를 `tag#id.class1.class2[data-x=v]` 형태로 요약 */
export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const classes = (el.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((c) => `.${c}`)
    .join("");
  const dataAttrs = Array.from(el.attributes)
    .filter((a) => a.name.startsWith("data-") || a.name === "datetime")
    .slice(0, 4)
    .map((a) => `[${a.name}=${a.value.slice(0, 24)}]`)
    .join("");
  return `${tag}${id}${classes}${dataAttrs}`;
}

/** selector 목록별 매칭 개수 */
function selectorReport(root: ParentNode, title: string, selectors: readonly string[]): string[] {
  const lines = [`[${title}]`];
  let matched = false;
  for (const selector of selectors) {
    let count = 0;
    try {
      count = root.querySelectorAll(selector).length;
    } catch {
      lines.push(`  ${selector} → (잘못된 selector)`);
      continue;
    }
    const mark = count > 0 && !matched ? "  ← 사용됨" : "";
    if (count > 0) matched = true;
    lines.push(`  ${selector} → ${count}개${mark}`);
  }
  if (!matched) lines.push("  ⚠ 매칭된 selector가 없습니다 — 이 항목을 고쳐야 합니다.");
  return lines;
}

/** 요소의 구조를 들여쓰기된 트리로 (텍스트는 마스킹) */
function outline(el: Element, depth = 0, maxDepth = 4, acc: string[] = []): string[] {
  if (depth > maxDepth || acc.length > MAX_SAMPLE_NODES) return acc;
  const indent = "  ".repeat(depth + 1);
  const own = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => maskText(n.textContent))
    .filter(Boolean)
    .join(" ");
  const extra = [
    el.getAttribute("alt") ? `alt="${maskText(el.getAttribute("alt"))}"` : "",
    el.getAttribute("src") ? `src="${maskUrl(el.getAttribute("src"))}"` : "",
    el.getAttribute("href") ? `href="${maskUrl(el.getAttribute("href"))}"` : "",
    el.getAttribute("style") ? `style="${(el.getAttribute("style") ?? "").slice(0, 40)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  acc.push(`${indent}${describeElement(el)}${extra ? " " + extra : ""}${own ? `  "${own}"` : ""}`);
  for (const child of Array.from(el.children)) outline(child, depth + 1, maxDepth, acc);
  return acc;
}

/** 날짜처럼 보이는 텍스트를 가진 요소들 */
function dateCandidates(root: ParentNode): string[] {
  const found: string[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.children.length > 0) continue;
    const text = (el.textContent ?? "").trim();
    if (!text || !looksLikeDate(text)) continue;
    found.push(`  ${describeElement(el)}  "${text}"`);
    if (found.length >= MAX_DATE_SAMPLES) break;
  }
  return found.length > 0 ? found : ["  ⚠ 날짜로 보이는 텍스트를 찾지 못했습니다."];
}

/** 숫자가 섞인 짧은 텍스트 — 리뷰수/가격 selector를 찾는 단서 */
function numberCandidates(root: ParentNode): string[] {
  const found: string[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.children.length > 0) continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 30 || !/\d/.test(text)) continue;
    if (looksLikeDate(text)) continue; // 날짜는 위에서 이미 다뤘다
    found.push(`  ${describeElement(el)}  "${maskText(text)}"`);
    if (found.length >= MAX_DATE_SAMPLES) break;
  }
  return found.length > 0 ? found : ["  (없음)"];
}

/**
 * 진단 리포트를 만든다.
 * @param root 분석할 문서
 * @param url  현재 페이지 주소
 */
export function buildDiagnosticsReport(root: ParentNode, url: string): string {
  const out: string[] = [];
  out.push("=== 쿠팡 소싱 수집기 · selector 진단 ===");
  out.push(`URL      : ${maskUrl(url)}`);
  out.push(`수집 시각: ${new Date().toISOString()}`);
  out.push("※ 리뷰 본문·작성자명 등 텍스트는 ⟨text:길이⟩ 로 마스킹되어 있습니다.");
  out.push("");

  // --- 상품 목록 관련
  out.push(...selectorReport(root, "상품 카드", PRODUCT_CARD_SELECTORS));
  out.push("");
  out.push(...selectorReport(root, "상품명", NAME_SELECTORS));
  out.push("");
  out.push(...selectorReport(root, "가격", PRICE_SELECTORS));
  out.push("");
  out.push(...selectorReport(root, "리뷰수(카드)", REVIEW_COUNT_SELECTORS));
  out.push("");
  out.push(...selectorReport(root, "평점", RATING_SELECTORS));
  out.push("");
  out.push(...selectorReport(root, "배송 배지", DELIVERY_BADGE_SELECTORS));
  out.push("");
  out.push(...selectorReport(root, "카테고리명", CATEGORY_NAME_SELECTORS));
  out.push("");

  // --- 리뷰 관련
  out.push(...selectorReport(root, "리뷰 영역", REVIEW_SECTION_SELECTORS));
  out.push("");
  out.push(...selectorReport(root, "리뷰 카드", REVIEW_ITEM_SELECTORS));
  out.push("");

  // 개편 이후에는 클래스가 아니라 data-review-id 앵커로 카드를 찾는다.
  out.push(...selectorReport(root, "리뷰 식별자 앵커", REVIEW_ID_ANCHOR_SELECTORS));
  const found = findReviewCards(root);
  out.push(
    `  → 최종 인식된 리뷰 카드: ${found.cards.length}개 (경로: ${
      found.via === "selector"
        ? "클래스 selector"
        : found.via === "data-review-id"
          ? "data-review-id 앵커"
          : "실패"
    })`,
  );
  if (found.cards.length > 0) {
    const ids = found.cards.slice(0, 3).map((c) => findReviewId(c) ?? "(없음)");
    out.push(`  → 리뷰 식별자 예시: ${ids.join(", ")}`);
  }
  out.push("");
  out.push(...selectorReport(root, "리뷰 작성일", REVIEW_DATE_SELECTORS));
  out.push("");
  out.push(...selectorReport(root, "리뷰 정렬 컨트롤", REVIEW_SORT_SELECTORS));
  out.push("");
  out.push(...selectorReport(root, "누적 리뷰수", REVIEW_TOTAL_COUNT_SELECTORS));
  out.push("");

  out.push("[날짜로 보이는 텍스트]");
  out.push(...dateCandidates(root));
  out.push("");

  // 누적 리뷰수 selector가 실패했을 때 후보를 찾기 위한 목록
  out.push("[숫자가 들어간 짧은 텍스트 (리뷰수·가격 후보)]");
  out.push(...numberCandidates(root));
  out.push("");

  // --- 실제 구조 샘플
  let section: Element | null = null;
  for (const selector of REVIEW_SECTION_SELECTORS) {
    try {
      section = root.querySelector(selector);
      if (section) break;
    } catch {
      /* 다음 selector */
    }
  }

  out.push("[리뷰 카드 구조 샘플]");
  let sample: Element | null = found.cards[0] ?? null;
  if (sample && found.via === "data-review-id") {
    out.push("  (클래스 selector 실패 → data-review-id 앵커로 찾은 카드)");
  }
  if (!sample) {
    // 앵커까지 실패하면 날짜를 가진 요소의 조상을 후보로 본다.
    for (const el of Array.from((section ?? root).querySelectorAll("*"))) {
      if (el.children.length === 0 && looksLikeDate((el.textContent ?? "").trim())) {
        sample = el.closest("article, li, div[class]") ?? el.parentElement;
        break;
      }
    }
    if (sample) out.push("  (모든 방법 실패 → 날짜 요소의 조상으로 추정)");
  }
  out.push(sample ? outline(sample, 0, 5).join("\n") : "  ⚠ 리뷰 카드를 찾지 못했습니다.");
  out.push("");

  // 정렬 컨트롤은 "최신순" 정렬 여부 판별에 쓰이므로 구조를 따로 보여준다.
  out.push("[리뷰 정렬 컨트롤 구조 샘플]");
  let sortSample: Element | null = null;
  for (const selector of REVIEW_SORT_SELECTORS) {
    try {
      sortSample = root.querySelector(selector);
      if (sortSample) break;
    } catch {
      /* 다음 selector */
    }
  }
  if (!sortSample) {
    // selector가 실패하면 "최신순"/"베스트순" 텍스트를 가진 요소의 부모를 찾는다.
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.children.length > 0) continue;
      const text = (el.textContent ?? "").trim();
      if (text === "최신순" || text === "베스트순" || text === "최근순") {
        sortSample = el.parentElement ?? el;
        break;
      }
    }
    if (sortSample) out.push("  (정렬 selector가 실패해 '최신순' 텍스트의 부모로 추정)");
  }
  out.push(
    sortSample ? outline(sortSample, 0, 2).join("\n") : "  (정렬 컨트롤을 찾지 못했습니다)",
  );
  out.push("");

  out.push("[상품 카드 구조 샘플]");
  let card: Element | null = null;
  for (const selector of PRODUCT_CARD_SELECTORS) {
    try {
      card = root.querySelector(selector);
      if (card) break;
    } catch {
      /* 다음 selector */
    }
  }
  out.push(card ? outline(card).join("\n") : "  (상품 목록 페이지가 아니거나 카드를 찾지 못했습니다)");

  return out.join("\n");
}
