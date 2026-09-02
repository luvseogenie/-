import { describe, expect, it } from "vitest";

import { parseProductList } from "@/parsers/coupang_product_parser";

const URL = "https://www.coupang.com/vp/products/6258651182?itemId=12&vendorItemId=34";

describe("상세 페이지 상품명 fallback (구조를 모르는 새 화면)", () => {
  it("알려진 selector 가 없어도 og:title 에서 상품명을 읽는다", () => {
    document.title = "쿠팡!";
    document.body.innerHTML = `
      <meta property="og:title" content="아토텍 클렌징 주방 핸디형 + 헤드필터 3p - 쿠팡!" />
      <div class="new-layout">
        <div class="x1">한 달간 1,000명 이상 구매했어요</div>
        <span class="x2">32,900원</span>
      </div>`;
    const result = parseProductList(document, URL);
    expect(result.errors).toEqual([]);
    expect(result.products).toHaveLength(1);
    const p = result.products[0]!;
    expect(p.product_id).toBe("6258651182");
    expect(p.product_name).toBe("아토텍 클렌징 주방 핸디형 + 헤드필터 3p");
    // 구매 문구는 컨테이너와 상관없이 문서 전체에서 찾는다
    expect(p.monthly_purchase_count).toBe(1000);
    expect(p.monthly_purchase_is_minimum).toBe(true);
  });

  it("메타도 없으면 <title> → h1 순으로 쓰고, 사이트 이름만 남으면 실패로 알린다", () => {
    document.title = "하나생활용품 자동 배수구 덮개 1세트 | 쿠팡";
    document.body.innerHTML = `<div><p>구조를 알 수 없는 화면</p></div>`;
    expect(parseProductList(document, URL).products[0]?.product_name).toBe("하나생활용품 자동 배수구 덮개 1세트");

    document.title = "쿠팡!";
    document.body.innerHTML = `<h1 class="brand">씨엠렉스 실리콘 싱크대 물막이</h1>`;
    expect(parseProductList(document, URL).products[0]?.product_name).toBe("씨엠렉스 실리콘 싱크대 물막이");

    document.body.innerHTML = `<h1>쿠팡!</h1>`;
    const failed = parseProductList(document, URL);
    expect(failed.products).toHaveLength(0);
    expect(failed.errors[0]).toContain("상품명을 찾지 못함");
  });

  it("기존 구조(prod-buy-header__title)는 그대로 selector 로 읽는다", () => {
    document.title = "다른 제목 - 쿠팡!";
    document.body.innerHTML = `<div class="prod-atf"><h1 class="prod-buy-header__title">정식 상품명</h1></div>`;
    expect(parseProductList(document, URL).products[0]?.product_name).toBe("정식 상품명");
  });
});
