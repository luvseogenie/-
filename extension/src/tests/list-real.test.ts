/**
 * 실제 쿠팡 카테고리 페이지에서 확인된 문제들에 대한 회귀 테스트.
 *
 * 사용자 브라우저에서 진단한 결과 두 가지 문제가 드러났다.
 *   1. 상품 ID가 60개 전부 "0" → 중복 제거 시 1건만 남는 치명적 버그
 *   2. 배송 방식 0/60 → 배지가 alt 없는 이미지라 판별 실패
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { extractProductId, parseProductList } from "@/parsers/coupang_product_parser";

function loadFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), "src/tests/fixtures", name), "utf8");
}

const LIST_URL = "https://www.coupang.com/np/categories/400928";

describe("실제 쿠팡 목록 페이지", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("category-list-real.html");
  });

  it("카드를 전부 인식한다", () => {
    const result = parseProductList(document, LIST_URL);
    expect(result.products).toHaveLength(5);
    expect(result.skipped).toBe(0);
  });

  it("data-id=\"0\" 에 속지 않고 URL에서 상품 ID를 뽑는다", () => {
    const result = parseProductList(document, LIST_URL);
    const ids = result.products.map((p) => p.product_id);

    // 예전에는 전부 "0" 이 되어 중복 제거 시 1건만 남았다.
    expect(ids).toEqual([
      "8375912047",
      "7726331885",
      "7726331886",
      "6612094471",
      "8102947261",
    ]);
    // 모두 서로 다른 ID여야 중복 제거가 정상 동작한다.
    expect(new Set(ids).size).toBe(5);
  });

  it("data-* 의 짧거나 0뿐인 값은 상품 ID로 받아들이지 않는다", () => {
    document.body.innerHTML = `<li data-id="0"><a href="/x">이름</a></li>`;
    expect(extractProductId(document.querySelector("li")!, null)).toBeNull();

    // 6자리 미만은 광고·추적용 값일 가능성이 높다
    document.body.innerHTML = `<li data-product-id="12"><a href="/x">이름</a></li>`;
    expect(extractProductId(document.querySelector("li")!, null)).toBeNull();
  });

  it("URL의 ID는 길이를 따지지 않는다 (/vp/products/{id} 는 구조적으로 명확)", () => {
    document.body.innerHTML = `<li data-id="0"><a href="/vp/products/9001">이름</a></li>`;
    expect(extractProductId(document.querySelector("li")!, null)).toBe("9001");
  });

  it("alt 없는 배지 이미지의 파일명으로 배송 방식을 판별한다", () => {
    const products = parseProductList(document, LIST_URL).products;
    expect(products.map((p) => p.delivery_type)).toEqual([
      "rocket", // logo_rocket_large
      "rocket_growth", // logoRocketMerchant
      "rocket_growth",
      null, // 배지 없음 → 값을 만들지 않는다
      "rocket",
    ]);
  });

  it("상품명·가격·리뷰수·평점을 정확히 읽는다", () => {
    const [first, , , fourth] = parseProductList(document, LIST_URL).products;
    expect(first).toMatchObject({
      product_name: "라이프란스 린넨 거실화 2종 세트, 네이비 + 그레이, 1개",
      price: 8930,
      review_count: 15013,
      rating: 4.5,
      rank: 1,
    });
    expect(fourth).toMatchObject({ price: 5000, review_count: 14, rating: 5 });
  });

  it("목록 페이지에는 구매 문구가 없으므로 null을 유지한다", () => {
    const [first] = parseProductList(document, LIST_URL).products;
    expect(first?.monthly_purchase_count).toBeNull();
  });
});
