/**
 * 2026년 개편 이후 실제 쿠팡 리뷰 DOM에 대한 테스트.
 *
 * 개편 내용
 *   - 리뷰 카드에 의미 있는 클래스명이 없다 (twc-* 유틸리티 클래스뿐)
 *   - 작성일 전용 클래스가 없다 (판매자·옵션명과 같은 클래스를 공유)
 *   - data-review-id 만 안정적으로 남아 있다
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  analyzeReviewDates,
  extractReviewEntries,
  findReviewCards,
  findReviewDate,
  findReviewId,
  isExactDateText,
} from "@/parsers/coupang_review_parser";

function loadFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), "src/tests/fixtures", name), "utf8");
}

const NOW = new Date(2026, 8, 2); // 2026-09-02

describe("개편 이후 리뷰 DOM", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("product-reviews-twc.html");
  });

  it("클래스명이 없어도 data-review-id 앵커로 카드를 찾는다", () => {
    const { cards, via } = findReviewCards(document);
    expect(via).toBe("data-review-id");
    expect(cards).toHaveLength(6);
    expect(cards[0]?.tagName).toBe("ARTICLE");
  });

  it("리뷰 식별자를 읽는다", () => {
    const { cards } = findReviewCards(document);
    expect(findReviewId(cards[0]!)).toBe("956372574");
    expect(findReviewId(cards[5]!)).toBe("956372579");
  });

  it("작성일 전용 클래스가 없어도 날짜를 정확히 찾는다", () => {
    const { cards } = findReviewCards(document);
    expect(findReviewDate(cards[0]!)?.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(findReviewDate(cards[4]!)?.toISOString().slice(0, 10)).toBe("2026-07-24");
  });

  it("리뷰 본문 속 날짜를 작성일로 오인하지 않는다", () => {
    // 픽스처 본문에는 2024.01.01 이 들어 있다.
    const { cards } = findReviewCards(document);
    for (const card of cards) {
      const date = findReviewDate(card);
      expect(date?.getFullYear()).toBe(2026);
    }
  });

  it("리뷰 6건을 모두 추출한다", () => {
    const { entries, usedFallback } = extractReviewEntries(document);
    expect(usedFallback).toBe(false);
    expect(entries).toHaveLength(6);
    // 키는 리뷰 식별자 기반이라 안정적이다
    expect(entries.map((e) => e.key)).toEqual([
      "id:956372574",
      "id:956372575",
      "id:956372576",
      "id:956372577",
      "id:956372578",
      "id:956372579",
    ]);
  });

  it("최근 30일 리뷰수를 실측한다", () => {
    const result = analyzeReviewDates(document, NOW);
    expect(result.sampleSize).toBe(6);
    // 2026-08-03 이후: 09.01, 08.24, 08.12, 08.05 = 4건
    expect(result.reviewsInWindow).toBe(4);
    // 30일보다 오래된 리뷰(07.24, 06.30)를 봤으므로 실측
    expect(result.coversWindow).toBe(true);
    expect(result.newestReviewDate).toBe("2026-09-01");
    expect(result.oldestReviewDate).toBe("2026-06-30");
  });

  it("같은 페이지를 다시 읽어도 식별자로 중복을 거른다", () => {
    const first = extractReviewEntries(document).entries;
    const store = new Map(first.map((e) => [e.key, e.date]));
    for (const entry of extractReviewEntries(document).entries) store.set(entry.key, entry.date);
    expect(store.size).toBe(6);
  });
});

describe("날짜 정확 일치 판별", () => {
  it("날짜만 있는 텍스트만 통과시킨다", () => {
    expect(isExactDateText("2026.07.24")).toBe(true);
    expect(isExactDateText(" 2026.07.24 ")).toBe(true);
    expect(isExactDateText("2026-07-24")).toBe(true);
    expect(isExactDateText("2026년 7월 24일")).toBe(true);
  });

  it("다른 글자가 섞이면 통과시키지 않는다", () => {
    expect(isExactDateText("2024.01.01 에 비슷한 제품을 샀었는데")).toBe(false);
    expect(isExactDateText("작성일 2026.07.24")).toBe(false);
    expect(isExactDateText("판매자: 쿠팡(주)")).toBe(false);
    expect(isExactDateText("지름 6.2cm")).toBe(false);
  });
});

describe("구버전 DOM 호환", () => {
  it("구조가 옛날 형태여도 그대로 동작한다", () => {
    document.body.innerHTML = loadFixture("product-reviews.html");
    const { via } = findReviewCards(document);
    expect(via).toBe("selector");
    expect(analyzeReviewDates(document, NOW).sampleSize).toBe(18);
  });
});
