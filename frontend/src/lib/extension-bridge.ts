/**
 * 크롬 확장 프로그램과의 다리.
 *
 * 확장의 bridge content script 가 이 페이지(localhost:3000)에 붙어 있으면
 * <html data-coupang-sourcing-extension="확장ID"> 속성이 생기고, window.postMessage 로
 * 확장에 요청을 보낼 수 있다. 덕분에 popup 을 열지 않고 대시보드 버튼만으로
 * 자동 수집을 시작하거나 카테고리를 가져올 수 있다.
 */

export type ExtensionCommand =
  | "SCAN_START"
  | "SCAN_PAUSE"
  | "SCAN_RESUME"
  | "SCAN_STOP"
  | "SCAN_STATE"
  | "IMPORT_CATEGORIES";

export type ExtensionResponse = { ok: boolean; error?: string } & Record<string, unknown>;

const SOURCE_PAGE = "coupang-sourcing-dashboard";
const SOURCE_EXT = "coupang-sourcing-extension";

/** 확장이 이 페이지에 붙어 있는지 */
export function extensionId(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.getAttribute("data-coupang-sourcing-extension");
}

/** 확장에 요청을 보내고 답을 기다린다. 확장이 없으면 즉시 실패한다. */
export function sendToExtension(type: ExtensionCommand, timeoutMs = 60000): Promise<ExtensionResponse> {
  if (!extensionId()) {
    return Promise.resolve({
      ok: false,
      error: "크롬 확장 프로그램이 감지되지 않았습니다. chrome://extensions 에서 '쿠팡 소싱 수집기'가 켜져 있는지 확인하고 이 페이지를 새로고침하세요.",
    });
  }
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, error: "확장 프로그램이 응답하지 않습니다." });
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; requestId?: string; response?: ExtensionResponse } | null;
      if (event.source !== window || !data || data.source !== SOURCE_EXT || data.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data.response ?? { ok: false, error: "빈 응답" });
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: SOURCE_PAGE, requestId, type }, "*");
  });
}
