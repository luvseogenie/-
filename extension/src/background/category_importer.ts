/**
 * 쿠팡 카테고리 트리 가져오기.
 *
 * 쿠팡 첫 화면(www.coupang.com)의 전체 카테고리 메뉴를 읽어 백엔드에 등록한다.
 * 사용자는 popup 버튼 하나만 누른다. 현재 탭이 쿠팡 첫 화면이 아니면
 * 백그라운드 탭을 잠깐 열어 읽고 닫는다. 화면에 있는 카테고리만 등록한다.
 */
import { api } from "@/lib/api";
import { log } from "@/lib/logger";
import type { CategoryTreeResult } from "@/parsers/coupang_category_parser";
import { MIN_CATEGORY_MENU_LINKS } from "@/parsers/selectors";

import { openBackgroundTab, sendWhenReady, sleep, waitForLoad } from "./tab_utils";

const HOME_URL = "https://www.coupang.com/";
const HOME_PATTERN = /^https:\/\/www\.coupang\.com\/?(\?.*)?$/;

export type ImportCategoriesResult = {
  ok: boolean;
  error?: string;
  received?: number;
  created?: number;
  updated?: number;
  errors?: number;
  roots?: number;
  maxDepth?: number;
  source?: string;
  container?: string | null;
};

export async function importCategoriesFromCoupang(): Promise<ImportCategoriesResult> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  let tabId: number;
  let opened = false;
  if (active?.id && active.url && HOME_PATTERN.test(active.url)) {
    tabId = active.id;
  } else {
    try {
      tabId = await openBackgroundTab(HOME_URL);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    opened = true;
    await waitForLoad(tabId, HOME_URL, 25000);
    await sleep(1500);
  }

  try {
    const res = await sendWhenReady<{ ok: boolean; result?: CategoryTreeResult; error?: string }>(
      tabId,
      { type: "SCAN_CATEGORIES" },
      20000,
    );
    const tree = res.result;
    if (!tree || tree.rows.length < MIN_CATEGORY_MENU_LINKS) {
      return {
        ok: false,
        error:
          `카테고리 링크를 ${tree?.rows.length ?? 0}개밖에 찾지 못했습니다. ` +
          "쿠팡 첫 화면(www.coupang.com)을 직접 열어 '카테고리' 메뉴를 한 번 펼친 상태에서 다시 누르거나, " +
          "[진단 정보 복사] 결과를 보내주세요.",
      };
    }
    const out = await api.importCategories(tree.rows);
    log.info("카테고리 가져오기", out);
    return {
      ok: true,
      received: out.received,
      created: out.created,
      updated: out.updated,
      errors: out.errors.length,
      roots: tree.roots,
      maxDepth: tree.maxDepth,
      source: HOME_URL,
      container: tree.container,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error("카테고리 가져오기 실패", message);
    return { ok: false, error: message };
  } finally {
    if (opened) chrome.tabs.remove(tabId).catch(() => undefined);
  }
}
