/**
 * 카테고리 트리 파서.
 *
 * 쿠팡 첫 화면의 전체 카테고리 메뉴(또는 목록 페이지의 좌측 메뉴)에 렌더링된
 * 카테고리 링크를 읽어 계층 구조를 만든다. 계층은 클래스명이 아니라
 * **DOM 중첩**으로 판단하므로 화면이 개편돼도 동작한다.
 *
 * 규칙
 *  - 링크 주소의 /np/categories/{code} 가 있는 것만 카테고리로 본다
 *  - 어떤 링크의 부모 = 그 링크를 감싸는 조상 항목(li 등)의 대표 링크
 *  - 같은 코드가 여러 번 나오면 첫 번째(대개 제목 링크)를 쓴다
 *  - breadcrumb 안의 링크는 계층 정보가 없으므로 제외한다
 *  - 화면에 없는 카테고리를 지어내지 않는다
 */
import {
  BREADCRUMB_SELECTORS,
  CATEGORY_LINK_SELECTOR,
  CATEGORY_MENU_CODE_PATTERN,
  CATEGORY_MENU_SELECTORS,
  CATEGORY_NAME_EXCLUDE,
  CATEGORY_NAME_MAX_LENGTH,
  MIN_CATEGORY_MENU_LINKS,
} from "./selectors";

export type CategoryRow = {
  category_code: string;
  category_name: string;
  parent_category_code: string | null;
  category_url: string | null;
};

export type CategoryTreeResult = {
  rows: CategoryRow[];
  /** 사용한 메뉴 컨테이너 selector. 문서 전체를 훑었으면 null */
  container: string | null;
  /** 컨테이너 안의 카테고리 링크 수 (중복 포함) */
  linkCount: number;
  roots: number;
  maxDepth: number;
};

const BREADCRUMB_JOINED = BREADCRUMB_SELECTORS.join(",");
const EXCLUDE = new Set<string>(CATEGORY_NAME_EXCLUDE);

function codeOf(link: HTMLAnchorElement): string | null {
  const href = link.getAttribute("href") ?? "";
  const m = CATEGORY_MENU_CODE_PATTERN.exec(href);
  return m?.[1] ?? null;
}

function nameOf(link: HTMLAnchorElement): string {
  const text = (link.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text) return text;
  const img = link.querySelector("img[alt]");
  return (img?.getAttribute("alt") ?? "").trim();
}

function absoluteUrl(link: HTMLAnchorElement, pageUrl: string): string | null {
  const href = link.getAttribute("href");
  if (!href) return null;
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

/** 링크가 속한 "항목" 요소. li 가 있으면 li, 없으면 바로 위 요소 */
function itemOf(link: Element): Element {
  return link.closest("li") ?? link.parentElement ?? link;
}

function categoryLinks(root: ParentNode): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>(CATEGORY_LINK_SELECTOR)).filter(
    (a) => codeOf(a) !== null,
  );
}

/**
 * 부모 링크 찾기.
 * 조상 요소를 올라가며 "그 요소의 첫 카테고리 링크"를 본다. 그 링크의 항목이
 * 현재 링크를 감싸고 있으면 그것이 부모다. (형제 항목의 링크는 감싸지 않으므로 제외된다)
 */
function findParentLink(link: HTMLAnchorElement, root: Element): HTMLAnchorElement | null {
  const own = itemOf(link);
  let el: Element | null = own.parentElement;
  while (el && root.contains(el)) {
    const first = el.querySelector<HTMLAnchorElement>(CATEGORY_LINK_SELECTOR);
    if (first && first !== link && !own.contains(first) && codeOf(first) !== null) {
      if (itemOf(first).contains(link)) return first;
    }
    el = el.parentElement;
  }
  return null;
}

/** 카테고리 링크가 가장 많은 메뉴 컨테이너를 고른다. */
function pickContainer(doc: Document): { element: Element; selector: string | null; linkCount: number } {
  let best: { element: Element; selector: string | null; linkCount: number } | null = null;
  for (const selector of CATEGORY_MENU_SELECTORS) {
    let matches: Element[] = [];
    try {
      matches = Array.from(doc.querySelectorAll(selector));
    } catch {
      continue;
    }
    for (const element of matches) {
      const count = categoryLinks(element).length;
      if (count >= MIN_CATEGORY_MENU_LINKS && (!best || count > best.linkCount)) {
        best = { element, selector, linkCount: count };
      }
    }
  }
  if (best) return best;
  const body = doc.body ?? doc.documentElement;
  return { element: body, selector: null, linkCount: categoryLinks(body).length };
}

export function parseCategoryTree(doc: Document, pageUrl: string): CategoryTreeResult {
  const { element: root, selector, linkCount } = pickContainer(doc);
  const byCode = new Map<string, CategoryRow>();

  for (const link of categoryLinks(root)) {
    if (link.closest(BREADCRUMB_JOINED)) continue;
    const code = codeOf(link);
    if (!code) continue;
    const name = nameOf(link);
    if (!name || name.length > CATEGORY_NAME_MAX_LENGTH || EXCLUDE.has(name)) continue;

    const parentLink = findParentLink(link, root);
    const parentCode = parentLink ? codeOf(parentLink) : null;
    const parent = parentCode && parentCode !== code ? parentCode : null;

    const existing = byCode.get(code);
    if (existing) {
      // 첫 등장을 우선하되, 첫 등장에 부모가 없고 이번에 있으면 보완한다.
      if (!existing.parent_category_code && parent) existing.parent_category_code = parent;
      continue;
    }
    byCode.set(code, {
      category_code: code,
      category_name: name,
      parent_category_code: parent,
      category_url: absoluteUrl(link, pageUrl),
    });
  }

  // 부모가 목록에 없는 행은 루트로 둔다 (지어내지 않는다)
  for (const row of byCode.values()) {
    if (row.parent_category_code && !byCode.has(row.parent_category_code)) row.parent_category_code = null;
  }

  const rows = Array.from(byCode.values());
  const depthOf = (row: CategoryRow): number => {
    let depth = 1;
    let cur = row;
    const seen = new Set<string>([row.category_code]);
    while (cur.parent_category_code && depth < 10) {
      const parent = byCode.get(cur.parent_category_code);
      if (!parent || seen.has(parent.category_code)) break;
      seen.add(parent.category_code);
      cur = parent;
      depth += 1;
    }
    return depth;
  };
  return {
    rows,
    container: selector,
    linkCount,
    roots: rows.filter((r) => !r.parent_category_code).length,
    maxDepth: rows.reduce((max, r) => Math.max(max, depthOf(r)), 0),
  };
}

/**
 * 진단용: 카테고리 링크가 어떤 구조로 놓여 있는지 요약한다.
 * 화면이 개편되어 계층을 못 읽을 때, 이 출력만 보면 selector 를 고칠 수 있다.
 * (카테고리명은 개인정보가 아니므로 그대로 적는다)
 */
export function describeCategoryLinks(doc: Document, pageUrl: string, limit = 40): string[] {
  const { element: root, selector, linkCount } = pickContainer(doc);
  const tree = parseCategoryTree(doc, pageUrl);
  const out = [
    `[카테고리 링크 구조] 컨테이너=${selector ?? "(문서 전체)"} 링크 ${linkCount}개 → 카테고리 ${tree.rows.length}개 · 부모 있음 ${tree.rows.length - tree.roots}개 · 깊이 ${tree.maxDepth}`,
  ];
  const chain = (el: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== root && parts.length < 6) {
      const cls = (cur.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      parts.unshift(cur.tagName.toLowerCase() + (cls ? `.${cls}` : ""));
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };
  for (const link of categoryLinks(root).slice(0, limit)) {
    const parent = findParentLink(link, root);
    out.push(
      `  ${codeOf(link)} "${nameOf(link).slice(0, 20)}" 부모=${parent ? codeOf(parent) : "-"}  ${chain(link)}`,
    );
  }
  return out;
}
