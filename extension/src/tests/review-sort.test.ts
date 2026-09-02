import { describe, expect, it } from "vitest";

import { ensureReviewSortNewest, readReviewSort } from "@/parsers/coupang_list_sort";

describe("리뷰 정렬 확인/변경 (리뷰 영역 안에서만)", () => {
  it("베스트순이 선택돼 있으면 최신순을 누른다, 상단 목록 정렬은 건드리지 않는다", () => {
    let clicked = "";
    document.body.innerHTML = `
      <div class="list-sort"><button class="active">쿠팡 랭킹순</button><button>최신순</button></div>
      <section id="sdpReview"><div class="sort"><button class="selected">베스트순</button><button>최신순</button></div></section>`;
    document.querySelectorAll("#sdpReview button").forEach((b) => b.addEventListener("click", () => (clicked = "review:" + b.textContent)));
    document.querySelectorAll(".list-sort button").forEach((b) => b.addEventListener("click", () => (clicked = "list:" + b.textContent)));
    const before = readReviewSort(document);
    expect(before.active).toBe("베스트순");
    const state = ensureReviewSortNewest(document);
    expect(state.changed).toBe(true);
    expect(clicked).toBe("review:최신순");
    expect(state.note).toBe("베스트순 → 최신순으로 변경");
  });

  it("이미 최신순이면 누르지 않는다", () => {
    document.body.innerHTML = `<section id="sdpReview"><ul><li aria-selected="true">최신순</li><li>베스트순</li></ul></section>`;
    const state = ensureReviewSortNewest(document);
    expect(state.changed).toBe(false);
    expect(state.isSalesDesc).toBe(true);
    expect(state.note).toBe("최신순 확인됨");
  });
});
