/**
 * 쿠팡이 목록 페이지를 전면 개편해 기존 클래스명이 모두 사라진 상황.
 *
 * 리뷰 영역이 2026년 개편으로 twc-* 유틸리티 클래스만 남은 것을 확인했으므로,
 * 목록 페이지도 같은 일이 일어날 수 있다고 보고 대비한다.
 * 파서는 클래스가 아니라 상품 링크(/vp/products/) 앵커로 카드를 찾아야 한다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { findCards, parseProductList } from "@/parsers/coupang_product_parser";

function loadFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), "src/tests/fixtures", name), "utf8");
}

const LIST_URL = "https://www.coupang.com/np/categories/400928?listSize=60&component=400828";

describe("개편된 목록 페이지", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("category-list-redesigned.html");
  });

  it("클래스명이 전부 바뀌어도 링크 앵커로 카드를 찾는다", () => {
    const { cards, selector } = findCards(document);
    expect(cards).toHaveLength(4);
    expect(selector).toContain("링크 앵커");
    // <li>가 아니라 <div>여도 링크의 부모로 역추적한다
    // <li>가 아니라 <div>여도 링크의 부모로 역추적한다
    expect(cards[0]?.tagName).toBe("DIV");
  });

  it("모든 상품을 정상 추출한다", () => {
    const result = parseProductList(document, LIST_URL);
    expect(result.products).toHaveLength(4);
    expect(result.skipped).toBe(0);
    expect(result.products.map((p) => p.product_id)).toEqual([
      "7010001",
      "7010002",
      "7010003",
      "7010004",
    ]);
  });

  it("상품명·가격·리뷰수·평점·배송을 모두 읽는다", () => {
    const [first] = parseProductList(document, LIST_URL).products;
    expect(first).toMatchObject({
      product_id: "7010001",
      product_name: "OO 채칼세트 5종 스테인리스",
      price: 13900,
      review_count: 82,
      rating: 4.7, // style="width:94%" → 4.7
      delivery_type: "rocket_growth",
      rank: 1,
    });
    expect(first?.product_url).toContain("/vp/products/7010001");
    expect(first?.thumbnail_url).toContain("coupangcdn");
  });

  it("리뷰 없는 상품은 0, 만 단위는 환산한다", () => {
    const products = parseProductList(document, LIST_URL).products;
    expect(products[1]?.review_count).toBe(0);
    expect(products[2]?.review_count).toBe(1234);
  });

  it("URL에서 카테고리 코드를 추출한다", () => {
    expect(parseProductList(document, LIST_URL).categoryCode).toBe("400928");
  });

  it("목록 페이지에는 구매 문구가 없으므로 null을 유지한다", () => {
    const [first] = parseProductList(document, LIST_URL).products;
    expect(first?.monthly_purchase_count).toBeNull();
  });
});

describe("기존 구조는 그대로 동작한다", () => {
  it("클래스 selector가 우선 사용된다", () => {
    document.body.innerHTML = loadFixture("category-list.html");
    const { selector } = findCards(document);
    expect(selector).toBe("li.search-product");
  });
});
