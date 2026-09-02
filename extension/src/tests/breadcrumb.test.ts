/**
 * 카테고리 경로(breadcrumb) 추출.
 *
 * 여기서 읽은 계층을 백엔드가 그대로 만들어 두므로,
 * 사용자가 카테고리를 따로 import 하지 않아도 수집만으로 트리가 채워진다.
 */
import { describe, expect, it } from "vitest";

import { extractCategoryPath } from "@/parsers/coupang_product_parser";

const URL_ = "https://www.coupang.com/np/categories/1011?listSize=60";

describe("카테고리 경로 추출", () => {
  it("breadcrumb에서 계층을 읽는다", () => {
    document.body.innerHTML = `
      <ul class="breadcrumb">
        <li><a href="/np/categories/1001">홈인테리어</a></li>
        <li><a href="/np/categories/1010">카페트/매트</a></li>
        <li><a href="/np/categories/1011">발매트</a></li>
      </ul>`;
    expect(extractCategoryPath(document, URL_)).toEqual([
      { code: "1001", name: "홈인테리어" },
      { code: "1010", name: "카페트/매트" },
      { code: "1011", name: "발매트" },
    ]);
  });

  it("클래스명이 바뀌어도 부분 일치로 찾는다", () => {
    document.body.innerHTML = `
      <nav class="Breadcrumb_root__x1y2">
        <a href="/np/categories/2001">주방용품</a>
        <a href="/np/categories/2011">채칼/슬라이서</a>
      </nav>`;
    expect(extractCategoryPath(document, "https://www.coupang.com/np/categories/2011")).toEqual([
      { code: "2001", name: "주방용품" },
      { code: "2011", name: "채칼/슬라이서" },
    ]);
  });

  it("현재 카테고리가 breadcrumb에 없으면 끝에 붙인다", () => {
    document.body.innerHTML = `
      <ul class="breadcrumb">
        <li><a href="/np/categories/1001">홈인테리어</a></li>
        <li><a href="/np/categories/1010">카페트/매트</a></li>
      </ul>
      <h2 class="title">발매트</h2>`;
    const path = extractCategoryPath(document, URL_);
    expect(path[path.length - 1]).toEqual({ code: "1011", name: "발매트" });
  });

  it("breadcrumb이 없으면 현재 카테고리 하나만 돌려준다", () => {
    document.body.innerHTML = `<h2 class="title">거실화/슬리퍼</h2>`;
    expect(
      extractCategoryPath(document, "https://www.coupang.com/np/categories/400928"),
    ).toEqual([{ code: "400928", name: "거실화/슬리퍼" }]);
  });

  it("좌측 전체 메뉴를 통째로 읽지 않는다", () => {
    // breadcrumb처럼 보이지만 카테고리 링크가 수십 개인 경우
    const links = Array.from({ length: 30 }, (_, i) =>
      `<a href="/np/categories/${9000 + i}">카테고리 ${i}</a>`,
    ).join("");
    document.body.innerHTML = `<div class="breadcrumb-menu">${links}</div><h2 class="title">발매트</h2>`;
    // 8칸을 넘으면 경로로 인정하지 않고 현재 카테고리만 쓴다
    expect(extractCategoryPath(document, URL_)).toEqual([{ code: "1011", name: "발매트" }]);
  });

  it("카테고리 정보가 전혀 없으면 빈 배열", () => {
    document.body.innerHTML = `<div>상품 목록</div>`;
    expect(extractCategoryPath(document, "https://www.coupang.com/np/search?q=x")).toEqual([]);
  });
});
