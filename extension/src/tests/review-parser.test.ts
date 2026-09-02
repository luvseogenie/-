import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  analyzeReviewDates,
  collectReviewDates,
  detectSortedByNewest,
  extractTotalReviewCount,
  parseReviewDate,
} from "@/parsers/coupang_review_parser";

function loadFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), "src/tests/fixtures", name), "utf8");
}

/** 픽스처의 기준일 */
const NOW = new Date(2026, 8, 2); // 2026-09-02

describe("리뷰 작성일 파싱", () => {
  it("쿠팡 표기(2026.08.15)를 읽는다", () => {
    expect(parseReviewDate("2026.08.15")?.toISOString().slice(0, 10)).toBe("2026-08-15");
  });

  it("여러 표기를 지원한다", () => {
    expect(parseReviewDate("2026-08-15")).not.toBeNull();
    expect(parseReviewDate("2026년 8월 15일")).not.toBeNull();
    expect(parseReviewDate("작성일 2026.08.15 도움돼요")).not.toBeNull();
  });

  it("날짜가 아니면 null (값을 만들지 않는다)", () => {
    expect(parseReviewDate("좋아요")).toBeNull();
    expect(parseReviewDate(null)).toBeNull();
    expect(parseReviewDate("")).toBeNull();
  });

  it("미래 날짜는 무시한다", () => {
    expect(parseReviewDate("2099.01.01")).toBeNull();
  });

  it("월/일 범위를 벗어나면 무시한다", () => {
    expect(parseReviewDate("2026.13.45")).toBeNull();
  });
});

describe("리뷰 영역 분석 — 30일 경계를 넘는 표본", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("product-reviews.html");
  });

  it("렌더된 리뷰 날짜를 모두 읽는다", () => {
    const { dates, usedFallback } = collectReviewDates(document);
    expect(dates).toHaveLength(18);
    expect(usedFallback).toBe(false);
  });

  it("최신순 정렬 여부를 감지한다", () => {
    expect(detectSortedByNewest(document)).toBe(true);
  });

  it("누적 리뷰수를 읽는다", () => {
    expect(extractTotalReviewCount(document)).toBe(1284);
  });

  it("30일 이내 리뷰수를 정확히 센다", () => {
    const result = analyzeReviewDates(document, NOW);
    expect(result.sampleSize).toBe(18);
    expect(result.reviewsInWindow).toBe(12);
    // 30일보다 오래된 리뷰를 봤으므로 30일 구간을 완전히 덮었다 → 실측
    expect(result.coversWindow).toBe(true);
    expect(result.newestReviewDate).toBe("2026-09-01");
    expect(result.oldestReviewDate).toBe("2026-04-15");
    expect(result.totalReviewCount).toBe(1284);
    expect(result.warnings).toEqual([]);
  });
});

describe("리뷰 영역 분석 — 30일을 못 덮은 표본", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("product-reviews-recent-only.html");
  });

  it("표본이 모두 30일 안이면 covers_window=false 로 알린다", () => {
    const result = analyzeReviewDates(document, NOW);
    expect(result.sampleSize).toBe(10);
    expect(result.reviewsInWindow).toBe(10);
    expect(result.coversWindow).toBe(false);
    expect(result.sampleSpanDays).toBeCloseTo(4, 1);
    expect(result.warnings.some((w) => w.includes("리뷰를 더 불러오면"))).toBe(true);
  });
});

describe("리뷰 영역 분석 — 예외 상황", () => {
  it("리뷰가 없으면 값을 만들지 않고 사유를 알린다", () => {
    document.body.innerHTML = `<section id="sdpReview"><p>등록된 상품평이 없습니다.</p></section>`;
    const result = analyzeReviewDates(document, NOW);
    expect(result.sampleSize).toBe(0);
    expect(result.reviewsInWindow).toBe(0);
    expect(result.newestReviewDate).toBeNull();
    expect(result.warnings.some((w) => w.includes("읽지 못했습니다"))).toBe(true);
  });

  it("최신순이 아니면 경고한다", () => {
    document.body.innerHTML = `
      <section id="sdpReview">
        <div class="sdp-review__article__order__sort">
          <div class="sdp-review__article__order__sort__best-btn active">베스트순</div>
        </div>
        <article class="sdp-review__article__list">
          <div class="sdp-review__article__list__info__product-info__reg-date">2026.08.30</div>
        </article>
      </section>`;
    const result = analyzeReviewDates(document, NOW);
    expect(result.sortedByNewest).toBe(false);
    expect(result.warnings.some((w) => w.includes("최신순"))).toBe(true);
  });

  it("리뷰 카드 클래스가 바뀌어도 날짜 패턴으로 찾아낸다(안전망)", () => {
    document.body.innerHTML = `
      <section id="sdpReview">
        <div class="ReviewCard_root__xyz"><span class="ReviewCard_date__ab">2026.08.28</span></div>
        <div class="ReviewCard_root__xyz"><span class="ReviewCard_date__ab">2026.08.20</span></div>
        <div class="ReviewCard_root__xyz"><span class="ReviewCard_date__ab">2026.06.01</span></div>
      </section>`;
    const result = analyzeReviewDates(document, NOW);
    expect(result.sampleSize).toBe(3);
    expect(result.reviewsInWindow).toBe(2);
    expect(result.coversWindow).toBe(true);
    expect(result.warnings.some((w) => w.includes("날짜 패턴만으로"))).toBe(true);
  });
});
