/**
 * 쿠팡이 접근을 제한한 화면인지 판단한다.
 * 우회하려는 게 아니라, 계속 두드리지 않고 멈추기 위한 감지다.
 */
import { BLOCKED_PAGE_PATTERNS } from "./selectors";

export function detectBlockedPage(doc: Document): string | null {
  const title = (doc.title ?? "").trim();
  const head = (doc.body?.innerText ?? doc.body?.textContent ?? "").replace(/\s+/g, " ").slice(0, 600);
  // 차단 화면은 아주 짧다. 정상 상품 페이지의 리뷰 본문에 비슷한 말이 섞이는 것을 피하려고
  // 제목과 화면 맨 앞 600자만 본다. "captcha" 는 제목에서만 인정한다.
  for (const pattern of BLOCKED_PAGE_PATTERNS) {
    if (pattern.test(title)) return title.slice(0, 160);
  }
  for (const pattern of BLOCKED_PAGE_PATTERNS) {
    if (pattern.source === "captcha") continue;
    if (pattern.test(head)) return head.slice(0, 160) || "차단 화면";
  }
  return null;
}
