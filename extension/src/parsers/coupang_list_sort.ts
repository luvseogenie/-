/**
 * 목록 페이지 정렬 상태 확인/변경.
 *
 * 자동 스캔은 주소에 sorter=saleCountDesc 를 붙여 열지만, 쿠팡이 그 파라미터를 무시하면
 * 랭킹순 결과를 판매량순으로 착각하게 된다. 그래서 화면에 뜬 정렬 컨트롤을 읽어
 * "판매량순"이 선택돼 있는지 확인하고, 아니면 사람이 누르듯 그 항목을 눌러 바꾼다.
 *
 * 지원하는 형태
 *   1) <select> 안에 정렬 option 이 있는 경우
 *   2) 버튼/링크/li 로 나열된 정렬 항목 (선택됨은 aria 속성이나 class 로 표시)
 */
import {
  LIST_SORT_ACTIVE_ATTRS,
  LIST_SORT_ACTIVE_CLASS,
  LIST_SORT_LABELS,
  LIST_SORT_WANTED,
  REVIEW_SORT_LABELS,
  REVIEW_SORT_WANTED,
} from "./selectors";

export type ListSortState = {
  /** 화면에서 찾은 정렬 이름들 */
  available: string[];
  /** 현재 선택된 정렬 (모르면 null) */
  active: string | null;
  /** 원하는 정렬(판매량순)이 선택돼 있는지 */
  isSalesDesc: boolean;
  /** 이번 호출에서 정렬을 바꾸려고 눌렀는지 */
  changed: boolean;
  /** 사람이 읽을 요약: "판매량순 확인됨" / "랭킹순 → 판매량순으로 변경" / "정렬 컨트롤 없음" */
  note: string;
};

export type SortSpec = { labels: readonly string[]; wanted: readonly string[]; root?: ParentNode };
const LIST_SPEC: SortSpec = { labels: LIST_SORT_LABELS, wanted: LIST_SORT_WANTED };
const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();

function wantedIn(spec: SortSpec, label: string | null): boolean {
  return !!label && spec.wanted.some((w) => label.includes(w));
}

function isActive(el: Element): boolean {
  for (const attr of LIST_SORT_ACTIVE_ATTRS) {
    const v = el.getAttribute(attr);
    if (v === "true" || v === "page" || v === "1") return true;
  }
  if (LIST_SORT_ACTIVE_CLASS.test(el.getAttribute("class") ?? "")) return true;
  const parent = el.parentElement;
  if (parent && parent.children.length <= 2 && LIST_SORT_ACTIVE_CLASS.test(parent.getAttribute("class") ?? "")) return true;
  return false;
}

/** 정렬 항목으로 보이는 요소들 (텍스트가 정렬 이름과 정확히 같은 작은 요소) */
function findSortItems(spec: SortSpec, doc: Document): HTMLElement[] {
  const labels = new Set<string>(spec.labels);
  const root = spec.root ?? doc;
  const items: HTMLElement[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("button, a, li, label, span, div"))) {
    if (el.children.length > 2) continue;
    const text = clean(el.textContent);
    if (!labels.has(text)) continue;
    // 같은 텍스트를 가진 조상이 이미 들어갔으면 더 안쪽 것만 남긴다
    if (items.some((prev) => prev.contains(el))) {
      items.splice(items.findIndex((prev) => prev.contains(el)), 1);
    }
    items.push(el);
  }
  return items;
}

function findSortSelect(spec: SortSpec, doc: Document): HTMLSelectElement | null {
  const labels = new Set<string>(spec.labels);
  const root = spec.root ?? doc;
  for (const sel of Array.from(root.querySelectorAll("select"))) {
    const options = Array.from(sel.options).map((o) => clean(o.textContent));
    if (options.some((t) => labels.has(t))) return sel;
  }
  return null;
}

/** 정렬 상태 읽기 (spec 의 labels 중 화면에 있는 것, 선택된 것, 원하는 것인지) */
export function readSortState(doc: Document, spec: SortSpec): ListSortState {
  const select = findSortSelect(spec, doc);
  if (select) {
    const active = clean(select.options[select.selectedIndex]?.textContent);
    const available = Array.from(select.options).map((o) => clean(o.textContent));
    return { available, active: active || null, isSalesDesc: wantedIn(spec, active), changed: false, note: active ? `${active} (선택됨)` : "정렬 선택 없음" };
  }
  const items = findSortItems(spec, doc);
  if (items.length === 0) {
    return { available: [], active: null, isSalesDesc: false, changed: false, note: "정렬 컨트롤 없음" };
  }
  const available = items.map((el) => clean(el.textContent));
  const activeEl = items.find(isActive) ?? null;
  const active = activeEl ? clean(activeEl.textContent) : null;
  return { available, active, isSalesDesc: wantedIn(spec, active), changed: false, note: active ? `${active} (선택됨)` : `정렬 항목 ${available.length}개, 선택 표시 없음` };
}

/** 원하는 정렬이 아니면 바꾼다. 이미 맞으면 아무것도 누르지 않는다. changed=true 면 화면이 다시 그려질 시간을 줘야 한다. */
export function ensureSort(doc: Document, spec: SortSpec, wantedName: string): ListSortState {
  const state = readSortState(doc, spec);
  if (state.isSalesDesc) return { ...state, note: `${state.active} 확인됨` };

  const select = findSortSelect(spec, doc);
  if (select) {
    const idx = Array.from(select.options).findIndex((o) => wantedIn(spec, clean(o.textContent)));
    if (idx < 0) return { ...state, note: `${wantedName} 없음 (${state.available.join("/")})` };
    select.selectedIndex = idx;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return { ...state, changed: true, note: `${state.active ?? "알 수 없음"} → ${wantedName}으로 변경` };
  }
  const items = findSortItems(spec, doc);
  const target = items.find((el) => wantedIn(spec, clean(el.textContent)));
  if (!target) {
    return { ...state, note: state.available.length ? `${wantedName} 없음 (${state.available.join("/")})` : "정렬 컨트롤 없음" };
  }
  target.click();
  return { ...state, changed: true, note: `${state.active ?? "알 수 없음"} → ${wantedName}으로 변경` };
}

export const readListSort = (doc: Document) => readSortState(doc, LIST_SPEC);
export const ensureListSortSalesDesc = (doc: Document) => ensureSort(doc, LIST_SPEC, "판매량순");

/** 리뷰 정렬: 리뷰 영역 안에서만 찾는다 (상단 목록 정렬과 구분) */
export function reviewSortSpec(doc: Document): SortSpec {
  const root = doc.querySelector("#sdpReview, [class*='review'], [class*='Review']") ?? doc;
  return { labels: REVIEW_SORT_LABELS, wanted: REVIEW_SORT_WANTED, root };
}
export const readReviewSort = (doc: Document) => readSortState(doc, reviewSortSpec(doc));
export const ensureReviewSortNewest = (doc: Document) => ensureSort(doc, reviewSortSpec(doc), "최신순");
