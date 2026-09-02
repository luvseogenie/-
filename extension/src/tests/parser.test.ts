import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { parseProductCard, parseProductList, detectPageType } from "@/parsers/coupang_product_parser";

function loadFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), "src/tests/fixtures", name), "utf8");
}

const LIST_URL = "https://www.coupang.com/np/categories/SAMPLE-2011";
const DETAIL_URL = "https://www.coupang.com/vp/products/7010001";

describe("페이지 타입 판별", () => {
  it("카테고리 / 검색 / 상세를 구분한다", () => {
    expect(detectPageType(LIST_URL)).toBe("category");
    expect(detectPageType("https://www.coupang.com/np/search?q=채칼")).toBe("search");
    expect(detectPageType(DETAIL_URL)).toBe("product");
  });
});

describe("상품 목록 파싱", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("category-list.html");
  });

  it("정상 카드만 추출하고 나머지는 사유와 함께 제외한다", () => {
    const result = parseProductList(document, LIST_URL);

    expect(result.products.map((p) => p.product_id)).toEqual([
      "7010001",
      "7010002",
      "7010003",
      "7010004",
    ]);
    expect(result.skipped).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.some((e) => e.includes("product_id"))).toBe(true);
    expect(result.errors.some((e) => e.includes("상품명"))).toBe(true);
    expect(result.matchedCardSelector).toBe("li.search-product");
  });

  it("첫 번째 카드의 모든 필드를 정확히 읽는다", () => {
    const [first] = parseProductList(document, LIST_URL).products;

    expect(first).toMatchObject({
      product_id: "7010001",
      product_name: "OO 채칼세트 5종 스테인리스",
      price: 13900,
      review_count: 82,
      rating: 4.7,
      delivery_type: "rocket_growth",
      rank: 1,
      view_count: null,
    });
    expect(first?.product_url).toContain("/vp/products/7010001");
    expect(first?.thumbnail_url).toContain("coupangcdn.com");
  });

  it("리뷰가 없으면 0으로 처리한다", () => {
    const second = parseProductList(document, LIST_URL).products[1];
    expect(second?.review_count).toBe(0);
    expect(second?.delivery_type).toBe("rocket");
    // 평점 표기가 없으므로 null — 임의로 만들지 않는다.
    expect(second?.rating).toBeNull();
  });

  it("만 단위 리뷰와 width 스타일 평점을 처리한다", () => {
    const third = parseProductList(document, LIST_URL).products[2];
    expect(third?.review_count).toBe(12000);
    expect(third?.rating).toBe(4.7);
    expect(third?.delivery_type).toBe("seller");
  });

  it("data 속성이 없으면 URL에서 product_id를 뽑는다", () => {
    const fourth = parseProductList(document, LIST_URL).products[3];
    expect(fourth?.product_id).toBe("7010004");
    // 썸네일이 없으면 null
    expect(fourth?.thumbnail_url).toBeNull();
  });

  it("노출 순서를 rank로 기록한다", () => {
    const ranks = parseProductList(document, LIST_URL).products.map((p) => p.rank);
    expect(ranks).toEqual([1, 2, 3, 4]);
  });

  it("URL에서 카테고리 코드를 추출한다", () => {
    expect(parseProductList(document, LIST_URL).categoryCode).toBe("SAMPLE-2011");
  });

  it("상대 URL을 절대 URL로 바꾼다", () => {
    const [first] = parseProductList(document, LIST_URL).products;
    expect(first?.product_url.startsWith("https://www.coupang.com/")).toBe(true);
  });
});

describe("fallback selector", () => {
  it("클래스명이 바뀌어도 대체 selector로 카드를 찾는다", () => {
    // .search-product 가 사라지고 해시가 붙은 클래스명만 남은 상황을 가정
    document.body.innerHTML = `
      <ul>
        <li class="ProductUnit_productUnit__a1b2">
          <a href="/vp/products/9001">
            <div class="ProductUnit_productName__x9">해시 클래스 상품</div>
            <strong class="Price_priceValue__z1">19,900</strong>
            <span class="ProductRating_ratingCount__q2">(45)</span>
          </a>
        </li>
      </ul>`;
    const result = parseProductList(document, LIST_URL);
    expect(result.matchedCardSelector).toBe("li[class*='ProductUnit_productUnit']");
    expect(result.products[0]).toMatchObject({
      product_id: "9001",
      product_name: "해시 클래스 상품",
      price: 19900,
      review_count: 45,
    });
  });

  it("상품 카드를 하나도 못 찾으면 원인을 알려준다", () => {
    document.body.innerHTML = "<div>상품 없음</div>";
    const result = parseProductList(document, LIST_URL);
    expect(result.products).toHaveLength(0);
    expect(result.matchedCardSelector).toBeNull();
    expect(result.errors[0]).toContain("selectors.ts");
  });
});

describe("상품 상세 페이지 파싱", () => {
  it("단일 상품을 읽는다", () => {
    document.body.innerHTML = loadFixture("product-detail.html");
    const result = parseProductList(document, DETAIL_URL);

    expect(result.pageType).toBe("product");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({
      product_id: "7010001",
      product_name: "OO 채칼세트 5종 스테인리스 대용량",
      price: 13900,
      review_count: 82,
      rating: 4.7,
      delivery_type: "rocket_growth",
      view_count: null,
    });
  });
});

describe("단일 카드 파싱", () => {
  it("필수값이 없으면 사유를 돌려준다", () => {
    document.body.innerHTML = `<li class="search-product"><div>아무것도 없음</div></li>`;
    const card = document.querySelector("li")!;
    const outcome = parseProductCard(card);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain("product_id");
  });

  it("값이 없는 필드는 null로 둔다 (임의 생성 금지)", () => {
    document.body.innerHTML = `
      <li class="search-product" data-product-id="123">
        <a href="/vp/products/123"><div class="name">값 없는 상품</div></a>
      </li>`;
    const outcome = parseProductCard(document.querySelector("li")!);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.product.price).toBeNull();
      expect(outcome.product.rating).toBeNull();
      expect(outcome.product.thumbnail_url).toBeNull();
      expect(outcome.product.delivery_type).toBeNull();
      expect(outcome.product.review_count).toBe(0);
      expect(outcome.product.view_count).toBeNull();
    }
  });
});
