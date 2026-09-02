/**
 * 대시보드(localhost:3000) ↔ 확장 프로그램 다리.
 *
 * 대시보드 페이지는 확장에 직접 메시지를 보낼 수 없으므로, 이 content script 가
 * 페이지의 window.postMessage 를 받아 service worker 로 전달하고 답을 돌려준다.
 * 덕분에 사용자는 popup 을 열지 않고 대시보드 버튼만으로 자동 수집을 시작할 수 있다.
 *
 * 보안: 같은 창(window)에서 온 메시지만, 그리고 허용된 종류만 전달한다.
 */
const SOURCE_PAGE = "coupang-sourcing-dashboard";
const SOURCE_EXT = "coupang-sourcing-extension";
const ALLOWED = new Set([
  "SCAN_START",
  "SCAN_PAUSE",
  "SCAN_RESUME",
  "SCAN_STOP",
  "SCAN_STATE",
  "IMPORT_CATEGORIES",
]);

// 확장이 있음을 페이지에 알린다 (대시보드는 이 속성으로 "확장 연결됨"을 표시한다).
document.documentElement.setAttribute("data-coupang-sourcing-extension", chrome.runtime.id);

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; requestId?: string; type?: string } | null;
  if (!data || data.source !== SOURCE_PAGE || !data.requestId || !data.type) return;
  const reply = (response: unknown) =>
    window.postMessage({ source: SOURCE_EXT, requestId: data.requestId, response }, "*");
  if (!ALLOWED.has(data.type)) {
    reply({ ok: false, error: `허용되지 않은 요청: ${data.type}` });
    return;
  }
  chrome.runtime
    .sendMessage({ type: data.type })
    .then(reply)
    .catch((e) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
});
