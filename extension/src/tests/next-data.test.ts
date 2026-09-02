/**
 * 쿠팡 목록 페이지의 Next.js 데이터 페이로드 파싱.
 *
 * 쿠팡은 상품 데이터를 self.__next_f.push([1,"...JSON..."]) 형태로 페이지에 싣는다.
 * DOM에서 클래스명으로 긁는 것보다 정확하고 화면 개편에도 영향받지 않으므로
 * 이 경로를 1순위로 쓴다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  collectNextPayload,
  extractArray,
  fromNextProduct,
  parseNextData,
} from "@/parsers/coupang_next_data";
import { parseProductList } from "@/parsers/coupang_product_parser";

function loadFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), "src/tests/fixtures", name), "utf8");
}

const LIST_URL = "https://www.coupang.com/np/categories/498724?listSize=60";

describe("페이로드 수집", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("category-list-next.html");
  });

  it("여러 청크로 쪼개진 페이로드를 이어붙인다", () => {
    const payload = collectNextPayload(document);
    expect(payload.length).toBeGreaterThan(500);
    expect(payload).toContain('"products":[');
    expect(payload).toContain("후드집업/집업류");
  });

  it("products 배열을 찾아 파싱한다", () => {
    const rows = extractArray(collectNextPayload(document), "products");
    expect(rows).toHaveLength(4);
  });

  it("페이로드가 없으면 null", () => {
    document.body.innerHTML = `<div>상품 없음</div>`;
    expect(parseNextData(document)).toBeNull();
  });
});

describe("상품 변환", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("category-list-next.html");
  });

  it("legacyProductId 를 상품 ID로 쓴다 (DOM의 data-id=\"0\" 이 아니라)", () => {
    const result = parseNextData(document)!;
    expect(result.products.map((p) => p.product_id)).toEqual([
      "8133306304",
      "8919055588",
      "9673081216",
      "9543050283",
    ]);
  });

  it("가격·리뷰수·평점을 정확한 숫자로 읽는다", () => {
    const [first] = parseNextData(document)!.products;
    expect(first).toMatchObject({
      product_name: "여성용 자외선 차단 쿨냉감 후드집업 자켓 뉴타임즈 Q395X486",
      price: 9800,
      review_count: 18,
      rating: 4,
      rank: 1,
    });
    expect(first?.product_url).toBe(
      "https://www.coupang.com/vp/products/8133306304?itemId=23100258889&vendorItemId=90133694818&sourceType=CATEGORY&categoryId=564575",
    );
    expect(first?.thumbnail_url?.startsWith("https://thumbnail.coupangcdn.com")).toBe(true);
  });

  it("배지 코드로 배송 방식을 판별한다", () => {
    const products = parseNextData(document)!.products;
    expect(products.map((p) => p.delivery_type)).toEqual([
      "rocket_growth", // ROCKET_MERCHANT
      "seller", // 배지 없음 + rocketArea.show=false
      "rocket", // ROCKET
      "rocket_growth", // ROCKET_MERCHANT
    ]);
  });

  it("리뷰 590건짜리도 정확히 읽는다", () => {
    const last = parseNextData(document)!.products[3];
    expect(last).toMatchObject({ review_count: 590, rating: 4.5, price: 9990, rank: 29 });
  });

  it("카테고리명을 페이로드에서 찾는다", () => {
    expect(parseNextData(document)!.categoryName).toBe("후드집업/집업류");
  });

  it("필수값이 없는 항목은 제외한다", () => {
    expect(fromNextProduct({ legacyProductId: 0, link: "/x" })).toBeNull();
    expect(fromNextProduct({ legacyProductId: 123, link: "" })).toBeNull();
    expect(fromNextProduct(null)).toBeNull();
    expect(fromNextProduct("문자열")).toBeNull();
  });

  it("목록 페이지에는 구매 문구가 없으므로 null", () => {
    const [first] = parseNextData(document)!.products;
    expect(first?.monthly_purchase_count).toBeNull();
  });
});

describe("전체 파서 연동", () => {
  it("페이지 데이터를 1순위로 쓴다", () => {
    document.body.innerHTML = loadFixture("category-list-next.html");
    const result = parseProductList(document, LIST_URL);

    expect(result.matchedCardSelector).toBe("__next_f (페이지 데이터)");
    expect(result.products).toHaveLength(4);
    expect(result.categoryCode).toBe("498724");
    expect(result.categoryName).toBe("후드집업/집업류");
    expect(result.categoryPath).toEqual([{ code: "498724", name: "후드집업/집업류" }]);
  });

  it("페이지 데이터가 없으면 DOM 파싱으로 넘어간다", () => {
    document.body.innerHTML = loadFixture("category-list-real.html");
    const result = parseProductList(document, "https://www.coupang.com/np/categories/400928");
    expect(result.matchedCardSelector).toBe("li.search-product");
    expect(result.products).toHaveLength(5);
  });
});
