import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  analyzeReviewDates,
  collectReviewDates,
  detectSortedByNewest,
  extractReviewEntries,
  extractTotalReviewCount,
  parseReviewDate,
  type ReviewEntry,
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
    expect(result.warnings.some((w) => w.includes("다음 페이지로 넘기면"))).toBe(true);
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

/**
 * 쿠팡 리뷰 목록은 페이지네이션 방식이라 다음 페이지로 넘기면
 * 이전 리뷰가 DOM에서 사라진다. 한 페이지(보통 5건)만으로는 30일을 덮을 수 없으므로
 * 확장이 페이지를 넘나들며 리뷰를 누적한다.
 */
describe("리뷰 페이지 누적", () => {
  /** 한 페이지 분량의 리뷰 목록 HTML */
  function page(reviews: { date: string; text: string }[]): string {
    return `
      <section id="sdpReview">
        <div class="sdp-review__article__order__sort">
          <div class="sdp-review__article__order__sort__newest-btn active">최신순</div>
        </div>
        ${reviews
          .map(
            (r) => `
          <article class="sdp-review__article__list">
            <div class="sdp-review__article__list__info__product-info__reg-date">${r.date}</div>
            <div class="sdp-review__article__list__review__content">${r.text}</div>
          </article>`,
          )
          .join("")}
      </section>`;
  }

  /** 확장이 누적하는 방식과 동일하게 key 기준으로 합친다. */
  function accumulate(store: Map<string, Date>): ReviewEntry[] {
    for (const entry of extractReviewEntries(document).entries) {
      if (!store.has(entry.key)) store.set(entry.key, entry.date);
    }
    return [...store.entries()].map(([key, date]) => ({ key, date }));
  }

  it("한 페이지(5건)만으로는 30일을 덮지 못한다", () => {
    document.body.innerHTML = page([
      { date: "2026.09.01", text: "리뷰1" },
      { date: "2026.08.31", text: "리뷰2" },
      { date: "2026.08.30", text: "리뷰3" },
      { date: "2026.08.29", text: "리뷰4" },
      { date: "2026.08.28", text: "리뷰5" },
    ]);
    const result = analyzeReviewDates(document, NOW);
    expect(result.sampleSize).toBe(5);
    expect(result.coversWindow).toBe(false);
    expect(result.warnings.some((w) => w.includes("다음 페이지"))).toBe(true);
  });

  it("페이지를 넘기며 누적하면 30일 실측에 도달한다", () => {
    const store = new Map<string, Date>();

    // 1페이지
    document.body.innerHTML = page([
      { date: "2026.09.01", text: "리뷰1" },
      { date: "2026.08.28", text: "리뷰2" },
      { date: "2026.08.25", text: "리뷰3" },
    ]);
    let carry = accumulate(store);
    expect(analyzeReviewDates(document, NOW, carry).coversWindow).toBe(false);

    // 2페이지 (이전 리뷰는 DOM에서 사라진다)
    document.body.innerHTML = page([
      { date: "2026.08.20", text: "리뷰4" },
      { date: "2026.08.12", text: "리뷰5" },
      { date: "2026.08.05", text: "리뷰6" },
    ]);
    carry = accumulate(store);
    expect(analyzeReviewDates(document, NOW, carry).sampleSize).toBe(6);

    // 3페이지 — 30일보다 오래된 리뷰가 나온다
    document.body.innerHTML = page([
      { date: "2026.08.01", text: "리뷰7" },
      { date: "2026.07.20", text: "리뷰8" },
      { date: "2026.06.30", text: "리뷰9" },
    ]);
    carry = accumulate(store);
    const result = analyzeReviewDates(document, NOW, carry);

    expect(result.sampleSize).toBe(9);
    expect(result.coversWindow).toBe(true); // 30일 경계를 넘었다 → 실측
    // 2026-08-03 이후(30일 이내) 리뷰: 09.01, 08.28, 08.25, 08.20, 08.12, 08.05 = 6건
    expect(result.reviewsInWindow).toBe(6);
    expect(result.warnings).toEqual([]);
  });

  it("같은 페이지를 다시 봐도 중복으로 세지 않는다", () => {
    const store = new Map<string, Date>();
    const html = page([
      { date: "2026.09.01", text: "리뷰1" },
      { date: "2026.08.28", text: "리뷰2" },
    ]);
    document.body.innerHTML = html;
    accumulate(store);
    document.body.innerHTML = html; // 뒤로 갔다가 다시 앞으로
    const carry = accumulate(store);
    expect(carry).toHaveLength(2);
    expect(analyzeReviewDates(document, NOW, carry).sampleSize).toBe(2);
  });

  it("같은 날짜의 서로 다른 리뷰는 별개로 센다", () => {
    const store = new Map<string, Date>();
    document.body.innerHTML = page([
      { date: "2026.09.01", text: "정말 좋아요" },
      { date: "2026.09.01", text: "배송이 빨라요" },
      { date: "2026.09.01", text: "가성비 최고" },
    ]);
    const carry = accumulate(store);
    expect(carry).toHaveLength(3);
  });

  it("data-review-id가 있으면 그것으로 중복을 판별한다", () => {
    document.body.innerHTML = `
      <section id="sdpReview">
        <article class="sdp-review__article__list" data-review-id="R-1">
          <div class="sdp-review__article__list__info__product-info__reg-date">2026.09.01</div>
        </article>
      </section>`;
    const { entries } = extractReviewEntries(document);
    expect(entries[0]?.key).toBe("id:R-1");
  });
});
