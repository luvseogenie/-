import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildDiagnosticsReport, describeElement } from "@/parsers/diagnostics";

function loadFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), "src/tests/fixtures", name), "utf8");
}

const URL_ = "https://www.coupang.com/vp/products/7010001?itemId=1&vendorItemId=2";

describe("요소 요약", () => {
  it("tag#id.class[data-*] 형태로 만든다", () => {
    document.body.innerHTML = `<article id="r1" class="a b" data-review-id="R-9">x</article>`;
    expect(describeElement(document.querySelector("article")!)).toBe(
      "article#r1.a.b[data-review-id=R-9]",
    );
  });
});

describe("진단 리포트 — selector가 잘 맞을 때", () => {
  it("어떤 selector가 몇 개를 찾았는지 알려준다", () => {
    document.body.innerHTML = loadFixture("product-reviews.html");
    const report = buildDiagnosticsReport(document, URL_);

    expect(report).toContain("[리뷰 카드]");
    expect(report).toContain("article.sdp-review__article__list → 18개  ← 사용됨");
    expect(report).toContain("[리뷰 작성일]");
    expect(report).toContain("[날짜로 보이는 텍스트]");
    expect(report).toContain("2026.09.01");
  });

  it("URL의 쿼리스트링을 제거한다", () => {
    document.body.innerHTML = loadFixture("product-reviews.html");
    const report = buildDiagnosticsReport(document, URL_);
    expect(report).not.toContain("vendorItemId");
    expect(report).toContain("https://www.coupang.com/…/7010001");
  });
});

describe("진단 리포트 — 쿠팡이 화면을 개편했을 때", () => {
  const redesigned = `
    <div class="ReviewSection_root__9f2">
      <div class="ReviewSort_root__aa">
        <button class="ReviewSort_item__bb ReviewSort_active__cc">최신순</button>
      </div>
      <div class="ReviewCard_root__x1" data-review-id="RV-100">
        <span class="ReviewCard_author__y2">홍길동</span>
        <span class="ReviewCard_date__z3">2026.08.28</span>
        <p class="ReviewCard_body__w4">배송도 빠르고 아주 만족스럽습니다. 재구매 의사 있어요.</p>
      </div>
      <div class="ReviewCard_root__x1" data-review-id="RV-101">
        <span class="ReviewCard_author__y2">김철수</span>
        <span class="ReviewCard_date__z3">2026.07.02</span>
        <p class="ReviewCard_body__w4">생각보다 별로였어요.</p>
      </div>
    </div>`;

  it("매칭 실패를 명확히 알리고 실제 구조를 보여준다", () => {
    document.body.innerHTML = redesigned;
    const report = buildDiagnosticsReport(document, URL_);

    // 기존 selector가 전부 실패했음을 알려야 한다
    expect(report).toContain("⚠ 매칭된 selector가 없습니다");
    // 새 클래스명을 찾을 수 있어야 한다
    expect(report).toContain("ReviewCard_date__z3");
    expect(report).toContain("2026.08.28");
    // 카드 구조를 추정해 보여준다
    expect(report).toContain("ReviewCard_root__x1");
  });

  it("리뷰 본문과 작성자명을 마스킹한다", () => {
    document.body.innerHTML = redesigned;
    const report = buildDiagnosticsReport(document, URL_);

    expect(report).not.toContain("홍길동");
    expect(report).not.toContain("김철수");
    expect(report).not.toContain("배송도 빠르고");
    expect(report).not.toContain("재구매");
    expect(report).toContain("⟨text:");
  });

  it("정렬 라벨처럼 구조 파악에 필요한 짧은 라벨은 남긴다", () => {
    document.body.innerHTML = redesigned;
    const report = buildDiagnosticsReport(document, URL_);
    expect(report).toContain("최신순");
  });
});

describe("진단 리포트 — 상품 목록 페이지", () => {
  it("상품 카드 selector 매칭 결과를 보여준다", () => {
    document.body.innerHTML = loadFixture("category-list.html");
    const report = buildDiagnosticsReport(document, "https://www.coupang.com/np/categories/1234");
    expect(report).toContain("li.search-product → 6개  ← 사용됨");
    expect(report).toContain("[상품 카드 구조 샘플]");
    expect(report).toContain("[가격]");
  });
});

describe("진단 리포트 — 개편된 리뷰 DOM (twc 유틸 클래스)", () => {
  it("클래스 selector 실패를 알리면서도 앵커로 찾았음을 보여준다", () => {
    document.body.innerHTML = loadFixture("product-reviews-twc.html");
    const report = buildDiagnosticsReport(document, URL_);

    expect(report).toContain("[리뷰 식별자 앵커]");
    expect(report).toContain("[data-review-id] → 6개");
    expect(report).toContain("최종 인식된 리뷰 카드: 6개 (경로: data-review-id 앵커)");
    expect(report).toContain("리뷰 식별자 예시: 956372574");
    expect(report).toContain("(클래스 selector 실패 → data-review-id 앵커로 찾은 카드)");
  });

  it("작성자명과 리뷰 본문은 여전히 마스킹한다", () => {
    document.body.innerHTML = loadFixture("product-reviews-twc.html");
    const report = buildDiagnosticsReport(document, URL_);
    expect(report).not.toContain("리뷰 본문 자리");
    expect(report).not.toContain("구매자");
    expect(report).not.toContain("리뷰 제목 자리");
    expect(report).toContain("⟨text:");
  });

  it("'리뷰'로 시작하는 본문이 안전 라벨로 오인되지 않는다", () => {
    document.body.innerHTML = `<div><span>리뷰 본문입니다. 아주 만족합니다.</span></div>`;
    const report = buildDiagnosticsReport(document, URL_);
    expect(report).not.toContain("아주 만족합니다");
  });

  it("리뷰수 후보를 찾아주되 본문은 숫자만 남긴다", () => {
    document.body.innerHTML = `
      <section id="sdpReview">
        <span class="ReviewCount_root__a1">상품평 1,284개</span>
        <article class="x"><div>2026.08.28</div></article>
      </section>`;
    const report = buildDiagnosticsReport(document, URL_);
    expect(report).toContain("[숫자가 들어간 짧은 텍스트 (리뷰수·가격 후보)]");
    expect(report).toContain("span.ReviewCount_root__a1");
    expect(report).toContain("nums:1,284");
    expect(report).not.toContain("상품평 1,284개");
  });
});
