import { describe, expect, it } from "vitest";

import { parseIntLoose, parsePrice, parseRating, parseReviewCount } from "@/parsers/normalize";

describe("리뷰 수 파싱", () => {
  it("(1,234) → 1234", () => {
    expect(parseReviewCount("(1,234)")).toBe(1234);
  });

  it("쉼표를 제거하고 정수로 변환한다", () => {
    expect(parseReviewCount("12,345")).toBe(12345);
    expect(parseReviewCount("리뷰 82개")).toBe(82);
    expect(parseReviewCount(" (7) ")).toBe(7);
  });

  it("리뷰가 없으면 0", () => {
    expect(parseReviewCount(null)).toBe(0);
    expect(parseReviewCount(undefined)).toBe(0);
    expect(parseReviewCount("")).toBe(0);
    expect(parseReviewCount("리뷰 없음")).toBe(0);
  });

  it("만/천 단위 표기를 환산한다", () => {
    expect(parseReviewCount("(1.2만)")).toBe(12000);
    expect(parseReviewCount("3천")).toBe(3000);
  });
});

describe("가격 파싱", () => {
  it("13,900원 → 13900", () => {
    expect(parsePrice("13,900원")).toBe(13900);
  });

  it("값이 없으면 null (0으로 만들지 않는다)", () => {
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice("품절")).toBeNull();
  });
});

describe("평점 파싱", () => {
  it("텍스트 평점", () => {
    expect(parseRating("4.7")).toBe(4.7);
    expect(parseRating("5")).toBe(5);
  });

  it("width 스타일(%)을 0~5로 환산한다", () => {
    expect(parseRating("width:94%")).toBe(4.7);
    expect(parseRating("width: 100%")).toBe(5);
  });

  it("범위를 벗어나면 null", () => {
    expect(parseRating("120")).toBeNull();
    expect(parseRating(null)).toBeNull();
    expect(parseRating("평점 없음")).toBeNull();
  });
});

describe("정수 파싱", () => {
  it("전각 숫자도 처리한다", () => {
    expect(parseIntLoose("１２３")).toBe(123);
  });
  it("숫자가 없으면 null", () => {
    expect(parseIntLoose("없음")).toBeNull();
  });
});
