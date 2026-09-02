/**
 * 탭 제어 공용 함수 (자동 스캔 · 카테고리 가져오기가 함께 쓴다).
 */
import { log } from "@/lib/logger";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 두 주소가 같은 페이지를 가리키는지 (쿼리 차이는 무시) */
export function samePage(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.host === ub.host && ua.pathname === ub.pathname;
  } catch {
    return a === b;
  }
}

/**
 * 탭이 목표 주소를 다 불러올 때까지 기다린다.
 *
 * onUpdated 이벤트만 믿으면 새 탭의 about:blank 단계에서 'complete'가 먼저 와서
 * 페이지가 뜨기 전에 진행해 버린다. 그래서 탭 상태와 주소를 직접 확인한다.
 */
export async function waitForLoad(tabId: number, expectedUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete" && tab.url && samePage(tab.url, expectedUrl)) return;
    } catch {
      // 탭이 아직 준비되지 않았다.
    }
    await sleep(300);
  }
}

/**
 * content script가 없으면 직접 주입한다.
 * 백그라운드로 만든 새 탭에서는 선언된 content script가 아직 없을 수 있다.
 */
export async function injectContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    log.info("content script 직접 주입", tabId);
  } catch (e) {
    log.warn("content script 주입 실패", e);
  }
}

/** 빈 탭을 먼저 만들고 나서 이동한다 (탭이 완전히 준비된 뒤 페이지를 열어 content script가 빠짐없이 붙는다). */
export async function openBackgroundTab(url: string): Promise<number> {
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  if (!tab.id) throw new Error("탭을 열지 못했습니다.");
  await sleep(300);
  await chrome.tabs.update(tab.id, { url });
  return tab.id;
}

/**
 * content script가 응답할 때까지 메시지를 재시도한다.
 * 응답이 {ok:false,error} 이면 그 오류를, 끝내 응답이 없으면 마지막 오류를 던진다.
 */
export async function sendWhenReady<T extends { ok: boolean; error?: string }>(
  tabId: number,
  message: unknown,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  let injected = false;
  while (Date.now() < deadline) {
    try {
      const response = (await chrome.tabs.sendMessage(tabId, message)) as T | undefined;
      if (response?.ok) return response;
      lastError = response?.error ?? "응답 없음";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      // 수신자가 없다 = content script가 이 탭에 없다 → 한 번 직접 넣어본다.
      if (!injected && /Receiving end does not exist/i.test(lastError)) {
        injected = true;
        await injectContentScript(tabId);
      }
    }
    await sleep(700);
  }
  throw new Error(`페이지 준비 안 됨: ${lastError}`);
}
