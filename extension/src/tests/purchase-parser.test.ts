/**
 * 쿠팡 월간 구매 문구 파싱.
 * "한 달간 3,000명 이상 구매했어요" — 쿠팡이 직접 표시하는 실제 판매 데이터.
 */
import { describe, expect, it } from "vitest";

import {
  findMonthlyPurchase,
  parseMonthlyPurchaseText,
} from "@/parsers/coupang_purchase_parser";

describe("월간 구매 문구 파싱", () => {
  it("실제 문구를 읽는다", () => {
    expect(parseMonthlyPurchaseText("한 달간 3,000명 이상 구매했어요")).toEqual({
      count: 3000,
      isMinimum: true,
      unit: "명",
      text: "한 달간 3,000명 이상 구매",
    });
  });

  it("띄어쓰기 변형을 처리한다", () => {
    expect(parseMonthlyPurchaseText("한달간 500명 이상 구매했어요")?.count).toBe(500);
    expect(parseMonthlyPurchaseText("최근 한 달간 100명 이상 구매했어요")?.count).toBe(100);
  });

  it("만/천 단위를 환산한다", () => {
    expect(parseMonthlyPurchaseText("한 달간 1만명 이상 구매했어요")?.count).toBe(10000);
    expect(parseMonthlyPurchaseText("한 달간 1.5만명 이상 구매했어요")?.count).toBe(15000);
    expect(parseMonthlyPurchaseText("한 달간 5천명 이상 구매했어요")?.count).toBe(5000);
  });

  it("'이상'이 없으면 구간이 아니라고 표시한다", () => {
    const result = parseMonthlyPurchaseText("한 달간 320명이 구매했어요");
    expect(result?.count).toBe(320);
    expect(result?.isMinimum).toBe(false);
  });

  it("개 단위도 읽는다", () => {
    const result = parseMonthlyPurchaseText("한 달간 1,200개 이상 판매됐어요");
    expect(result?.count).toBe(1200);
    expect(result?.unit).toBe("개");
  });

  it("관련 없는 문구는 무시한다", () => {
    expect(parseMonthlyPurchaseText("13,633 개 상품평")).toBeNull();
    expect(parseMonthlyPurchaseText("28,610원")).toBeNull();
    expect(parseMonthlyPurchaseText("구매하기")).toBeNull();
    expect(parseMonthlyPurchaseText(null)).toBeNull();
    expect(parseMonthlyPurchaseText("")).toBeNull();
  });
});

describe("문서에서 문구 찾기", () => {
  it("실제 상품 페이지 구조에서 찾아낸다", () => {
    // 사용자가 제공한 화면 구조를 본뜬 최소 마크업
    document.body.innerHTML = `
      <div class="prod-atf">
        <div class="twc-text-[12px]">BEST AWARDS</div>
        <a class="prod-brand-name">하디로어</a>
        <h1 class="prod-buy-header__title">하디로어 더블안전 풀업바</h1>
        <div class="twc-flex twc-items-center twc-gap-[4px]">
          <span class="rating-star-num" style="width:90%"></span>
          <span id="prod-review-nav-link-count">13,633</span>
          <span class="twc-text-bluegray-700">개 상품평</span>
          <span class="twc-text-[13px] twc-text-bluegray-800">한 달간 3,000명 이상 구매했어요</span>
        </div>
        <span class="total-price"><strong>28,610원</strong></span>
      </div>`;
    expect(findMonthlyPurchase(document)).toMatchObject({
      count: 3000,
      isMinimum: true,
      unit: "명",
    });
  });

  it("숫자가 별도 태그로 쪼개져 있어도 찾는다", () => {
    document.body.innerHTML = `
      <div class="wrap"><span>한 달간 </span><b>1,500</b><span>명 이상 구매했어요</span></div>`;
    expect(findMonthlyPurchase(document)?.count).toBe(1500);
  });

  it("문구가 없으면 null (값을 만들지 않는다)", () => {
    document.body.innerHTML = `
      <div class="prod-atf">
        <h1 class="prod-buy-header__title">문구 없는 상품</h1>
        <span id="prod-review-nav-link-count">82</span>
      </div>`;
    expect(findMonthlyPurchase(document)).toBeNull();
  });

  it("상품 카드 단위로도 각각 찾는다", () => {
    document.body.innerHTML = `
      <ul>
        <li class="search-product" id="a"><div class="name">상품 A</div>
          <span>한 달간 500명 이상 구매했어요</span></li>
        <li class="search-product" id="b"><div class="name">상품 B</div></li>
      </ul>`;
    const a = document.getElementById("a")!;
    const b = document.getElementById("b")!;
    expect(findMonthlyPurchase(a)?.count).toBe(500);
    expect(findMonthlyPurchase(b)).toBeNull();
  });
});
