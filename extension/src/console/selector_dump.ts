/**
 * DevTools 콘솔 붙여넣기용 진단 스크립트.
 *
 * 사용법
 *   1) 쿠팡 상품 페이지에서 F12 → Console 탭
 *   2) extension/dist/selector-dump.js 파일 내용을 전부 복사해 붙여넣고 Enter
 *   3) 결과가 클립보드에 복사됩니다. 채팅창에 붙여넣으면 됩니다.
 *
 * 리뷰 본문·작성자명 등은 자동으로 마스킹됩니다.
 */
import { buildDiagnosticsReport } from "@/parsers/diagnostics";

declare const copy: ((value: string) => void) | undefined;

const report = buildDiagnosticsReport(document, location.href);

console.log(report);

try {
  if (typeof copy === "function") {
    copy(report);
    console.log(
      "%c✅ 클립보드에 복사되었습니다. 채팅창에 붙여넣으세요.",
      "color:#38d8c8;font-weight:bold",
    );
  } else {
    console.log("%c위 내용을 전체 선택해 복사하세요.", "color:#fbbf24");
  }
} catch {
  console.log("클립보드 복사에 실패했습니다. 위 내용을 직접 복사하세요.");
}
