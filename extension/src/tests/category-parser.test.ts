import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseCategoryTree } from "@/parsers/coupang_category_parser";

const html = readFileSync(join(__dirname, "fixtures", "coupang-home.html"), "utf8");
const HOME = "https://www.coupang.com/";

describe("쿠팡 첫 화면 전체 카테고리 메뉴", () => {
  it("메뉴 컨테이너를 고르고 DOM 중첩으로 계층을 만든다", () => {
    document.body.innerHTML = html;
    const tree = parseCategoryTree(document, HOME);
    const byCode = Object.fromEntries(tree.rows.map((r) => [r.category_code, r]));
    const row = (code: string) => {
      const r = byCode[code];
      if (!r) throw new Error(`${code} 없음`);
      return r;
    };

    expect(tree.container).toBe("#gnbAnalytics");
    expect(row("100").category_name).toBe("여성패션"); // img alt
    expect(row("100").parent_category_code).toBeNull();
    expect(row("110").parent_category_code).toBe("100");
    expect(row("111").parent_category_code).toBe("110");
    expect(row("112").parent_category_code).toBe("110");
    expect(row("120").parent_category_code).toBe("100");
    // 제목이 div 로 감싸져 있어도 부모로 인식
    expect(row("210").parent_category_code).toBe("200");
    expect(row("498724").parent_category_code).toBe("210");
    expect(row("498725").parent_category_code).toBe("210");
    expect(row("300").parent_category_code).toBeNull();
    expect(row("410").parent_category_code).toBe("400");
    expect(tree.roots).toBe(5);
    expect(tree.maxDepth).toBe(3);
  });

  it("전체보기·breadcrumb·메뉴 밖 링크·긴 문구는 제외하고 코드 중복은 하나로 합친다", () => {
    document.body.innerHTML = html;
    const tree = parseCategoryTree(document, HOME);
    const codes = tree.rows.map((r) => r.category_code);
    expect(codes).not.toContain("9999"); // breadcrumb
    expect(codes).not.toContain("1"); // 긴 문구 (메뉴 밖이기도 함)
    expect(codes.filter((c) => c === "110")).toHaveLength(1); // 전체보기 중복
    expect(tree.rows.find((r) => r.category_code === "110")?.category_name).toBe("의류");
    expect(tree.rows).toHaveLength(14);
    expect(tree.rows[0]?.category_url).toBe("https://www.coupang.com/np/categories/100");
  });

  it("ul/li 없이 div 로만 짜인 메뉴도 중첩으로 계층을 읽는다", () => {
    document.body.innerHTML = `
      <div class="category-menu">
        ${Array.from({ length: 4 }, (_, i) => `
          <div class="depth1">
            <a href="/np/categories/${i + 1}000">대분류${i + 1}</a>
            <div class="depth2">
              <a href="/np/categories/${i + 1}100">중분류A</a>
              <div class="depth3"><a href="/np/categories/${i + 1}110">소분류A1</a></div>
              <a href="/np/categories/${i + 1}200">중분류B</a>
            </div>
          </div>`).join("")}
      </div>`;
    const tree = parseCategoryTree(document, HOME);
    const byCode = Object.fromEntries(tree.rows.map((r) => [r.category_code, r]));
    expect(tree.rows).toHaveLength(16);
    expect(byCode["1100"]?.parent_category_code).toBe("1000");
    expect(byCode["1110"]?.parent_category_code).toBe("1100");
    expect(byCode["1200"]?.parent_category_code).toBe("1000");
    expect(tree.roots).toBe(4);
  });

  it("메뉴 컨테이너를 못 찾으면 문서 전체에서 찾되 지어내지 않는다", () => {
    document.body.innerHTML = `<div><a href="/np/categories/77">단독 카테고리</a><a href="/vp/products/1">상품</a></div>`;
    const tree = parseCategoryTree(document, HOME);
    expect(tree.container).toBeNull();
    expect(tree.rows).toEqual([
      { category_code: "77", category_name: "단독 카테고리", parent_category_code: null, category_url: "https://www.coupang.com/np/categories/77" },
    ]);
  });

  it("카테고리 링크가 없으면 빈 결과", () => {
    document.body.innerHTML = `<p>아무것도 없음</p>`;
    expect(parseCategoryTree(document, HOME).rows).toEqual([]);
  });
});
