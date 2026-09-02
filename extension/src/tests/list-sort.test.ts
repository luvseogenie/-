import { describe, expect, it } from "vitest";

import { ensureListSortSalesDesc, readListSort } from "@/parsers/coupang_list_sort";

describe("목록 정렬 확인/변경", () => {
  it("select 형: 랭킹순이 선택돼 있으면 판매량순으로 바꾼다", () => {
    document.body.innerHTML = `<select id="s"><option selected>쿠팡 랭킹순</option><option>판매량순</option><option>낮은가격순</option></select>`;
    const before = readListSort(document);
    expect(before.active).toBe("쿠팡 랭킹순");
    expect(before.isSalesDesc).toBe(false);
    const after = ensureListSortSalesDesc(document);
    expect(after.changed).toBe(true);
    expect(after.note).toBe("쿠팡 랭킹순 → 판매량순으로 변경");
    expect(readListSort(document).isSalesDesc).toBe(true);
  });

  it("버튼 형: 선택 표시(aria-selected/class)를 읽고, 이미 판매량순이면 누르지 않는다", () => {
    let clicks = 0;
    document.body.innerHTML = `<ul class="sort"><li><a href="#" class="on">판매량순</a></li><li><a href="#">쿠팡 랭킹순</a></li><li><a href="#">최신순</a></li></ul>`;
    document.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => (clicks += 1)));
    const state = ensureListSortSalesDesc(document);
    expect(state.active).toBe("판매량순");
    expect(state.isSalesDesc).toBe(true);
    expect(state.changed).toBe(false);
    expect(state.note).toBe("판매량순 확인됨");
    expect(clicks).toBe(0);
  });

  it("버튼 형: 랭킹순이 선택돼 있으면 판매량순 버튼을 누른다", () => {
    let clicked = "";
    document.body.innerHTML = `<div class="sorter"><button aria-selected="true">쿠팡 랭킹순</button><button>판매량순</button><button>높은가격순</button></div>`;
    document.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => (clicked = b.textContent ?? "")));
    const state = ensureListSortSalesDesc(document);
    expect(state.changed).toBe(true);
    expect(clicked).toBe("판매량순");
    expect(state.note).toBe("쿠팡 랭킹순 → 판매량순으로 변경");
  });

  it("정렬 컨트롤이 없으면 그렇다고만 알린다", () => {
    document.body.innerHTML = `<div>상품 목록</div>`;
    const state = ensureListSortSalesDesc(document);
    expect(state.changed).toBe(false);
    expect(state.note).toBe("정렬 컨트롤 없음");
  });
});
