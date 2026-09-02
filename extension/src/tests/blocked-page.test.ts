import { describe, expect, it } from "vitest";

import { detectBlockedPage } from "@/parsers/blocked_page";

describe("쿠팡 접근 제한 화면 감지", () => {
  it("Akamai Access Denied 화면을 알아본다", () => {
    document.title = "Access Denied";
    document.body.innerHTML = `<h1>Access Denied</h1><p>You don't have permission to access "http://www.coupang.com/vp/products/9098343165?" on this server.</p><p>Reference #18.fe9fbcb.1788373796.10049d12</p>`;
    expect(detectBlockedPage(document)).toMatch(/Access Denied/);
  });

  it("정상 상품 페이지는 리뷰 본문에 비슷한 말이 있어도 차단으로 보지 않는다", () => {
    document.title = "아토텍 클렌징 주방 핸디형 - 쿠팡!";
    document.body.innerHTML = `<div class="prod-atf"><h1>아토텍</h1></div>` + "<p>상품 설명 </p>".repeat(120) + `<article>리뷰: captcha 같은 건 없었어요. Reference #18.aa.1.bb 라고 적힌 박스</article>`;
    expect(detectBlockedPage(document)).toBeNull();
  });
});
