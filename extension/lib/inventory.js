// 로켓그로스(쿠팡 창고) 재고: 윙 재고 화면(또는 재고 엑셀)을 읽어 옵션별 재고를 날짜마다 남기고,
// 최근 판매 속도로 품절 예상일·발주 추천 수량·재고 부족을 계산한다.
import { normHeader, firstMatch, parseNumber } from './parse.js';

// [필드, 열 이름 후보, 제외어]
export const INV_FIELDS = [
  ['option_id', ['옵션ID', '옵션 ID', '옵션아이디', 'vendorItemId', '벤더아이템ID', 'Option ID'], ['등록', '상품ID', '노출']],
  ['product_name', ['상품명', '등록상품명', '노출상품명', '옵션명', '상품'], ['ID', '코드']],
  ['option_name', ['옵션명', '옵션'], ['ID', '코드', '수']],
  ['product_id', ['등록상품ID', '등록상품 ID', '상품ID', '상품 ID'], ['옵션', '노출']],
  ['stock', ['판매가능재고', '판매 가능 재고', '판매가능 재고', '가용재고', '가용 재고', '주문가능재고', '현재고', '재고수량', '재고 수량', '재고'], ['입고', '예정', '불가', '보류', '반품', '불량', '일수', '회전', '부족', '금액']],
  ['inbound', ['입고예정', '입고 예정', '입고예정수량', '입고 예정 수량', '입고중', '입고 중', '이동중', '입고진행'], ['일', '완료']],
];
const cleanId = (v) => { let s = String(v ?? '').trim().replace(/,/g, ''); if (s.endsWith('.0')) s = s.slice(0, -2); return s; };

// 재고 표인지: 옵션ID 와 재고 열이 있으면
export function isInventoryTable(headers) {
  const n = headers.map(normHeader);
  return firstMatch(n, INV_FIELDS[0][1], INV_FIELDS[0][2]) != null && firstMatch(n, INV_FIELDS[4][1], INV_FIELDS[4][2]) != null && !n.some((h) => /매출|판매량|광고비|캠페인/.test(h));
}
// 화면 표·엑셀 줄 → [{ option_id, product_name, option_name, product_id, stock, inbound }]
// 새 재고현황 화면: '재고상태' 한 칸에 "판매가능 70일+ 1,061 입고중 0 입고권장 …" 처럼 여러 값이 같이 들어 있다
const STOCK_IN_TEXT = /판매\s*가능(?:\s*재고)?\s*[:：]?\s*(?:[\d,]+\s*일\s*\+?\s*)?([\d,]+)(?!\s*일)/;
const INBOUND_IN_TEXT = /입고\s*(?:중|예정|진행)(?:\s*수량)?\s*[:：]?\s*([\d,]+)/;
const nk = (v) => String(v ?? '').replace(/[\s,·_()\[\]\-]/g, '').toLowerCase();
// names: [{ option_id, name }] — 옵션ID 가 화면에 없을 때 '상품명, 옵션명' 글자로 옵션을 찾는다 (판매 기록의 옵션명)
export function normalizeInventory(records, { names = [] } = {}) {
  if (!records.length) return [];
  const headers = Object.keys(records[0]); const normed = headers.map(normHeader);
  const idx = {}; for (const [f, al, ex] of INV_FIELDS) idx[f] = firstMatch(normed, al, ex);
  const compound = records.some((rec) => Object.values(rec).some((v) => STOCK_IN_TEXT.test(String(v ?? ''))));
  if (idx.stock == null && !compound) return [];
  // 옵션ID 칸이 따로 없으면 다른 칸 글자 속 '옵션ID: 123…' 에서 찾는다 (상품 정보 칸에 함께 적힌 화면)
  const OID_IN_TEXT = /(?:옵션\s*ID|옵션\s*아이디|옵션\s*번호|vendor\s*Item\s*Id|Option\s*ID)\s*[:：]?\s*(\d{8,})/i;
  const byName = names.flatMap((x) => [].concat(x.name).map((n) => ({ id: String(x.option_id), k: nk(n) }))).filter((x) => x.k.length >= 6).sort((a, b) => b.k.length - a.k.length);
  const pidx = idx.product_name ?? normed.findIndex((h) => h.includes('상품'));
  // 새 재고현황 화면의 상품정보 칸: '상품명, 옵션 16394947286 96101960077 81036452 아이템위너 배지' — 이름표 없이 등록상품ID · 옵션ID · SKU ID 순서
  const ID_TRIPLE = /(?:^|\s)(\d{9,12})\s+(\d{9,12})\s+(\d{5,10})(?=\s|$)/;
  const out = {}; const unmatched = [];
  for (const rec of records) {
    const get = (f) => (idx[f] == null ? null : rec[headers[idx[f]]]);
    let oid = idx.option_id != null ? cleanId(get('option_id')) : '';
    if (!/^\d{5,}$/.test(oid)) { for (const v of Object.values(rec)) { const m = String(v ?? '').match(OID_IN_TEXT); if (m) { oid = m[1]; break; } } }
    let pid = '', pname = '';
    if (!/^\d{5,}$/.test(oid) && pidx >= 0) { const txt = String(rec[headers[pidx]] ?? ''); const m = txt.match(ID_TRIPLE); if (m) { pid = m[1]; oid = m[2]; pname = txt.slice(0, m.index).trim(); } }
    if (!/^\d{5,}$/.test(oid) && byName.length && pidx >= 0) { const t = nk(rec[headers[pidx]]); const hit = byName.find((x) => t.startsWith(x.k)); if (hit) oid = hit.id; }
    if (!/^\d{5,}$/.test(oid) && byName.length && pidx >= 0) { const t = nk(rec[headers[pidx]]); const hit = byName.find((x) => t.includes(x.k)); if (hit) oid = hit.id; }   // 앞에 배지 글자가 붙은 경우
    if (!/^\d{5,}$/.test(oid)) { unmatched.push(String(pidx >= 0 ? rec[headers[pidx]] : Object.values(rec).join(' ')).slice(0, 120)); continue; }
    let stock = null, inbound = null; const raw = String(get('stock') ?? '');
    if (/^[\s\d,.\-]+$/.test(raw) && raw.trim()) stock = parseNumber(raw);
    else { const all = Object.values(rec).map((v) => String(v ?? '')).join(' '); const m = all.match(STOCK_IN_TEXT); if (m) stock = parseNumber(m[1]); const mi = all.match(INBOUND_IN_TEXT); if (mi) inbound = parseNumber(mi[1]); }
    if (stock == null) continue;
    if (inbound == null) { const ri = String(get('inbound') ?? ''); inbound = /^[\s\d,.\-]+$/.test(ri) && ri.trim() ? parseNumber(ri) : 0; }
    const row = (out[oid] ||= { option_id: oid, product_name: '', option_name: '', product_id: '', stock: 0, inbound: 0 });
    row.product_name ||= (pname || String(get('product_name') ?? '').trim()).slice(0, 120); row.product_id ||= pid; row.option_name ||= String(get('option_name') ?? '').trim().slice(0, 120); row.product_id ||= cleanId(get('product_id'));
    row.stock += stock ?? 0; row.inbound += inbound ?? 0;   // 같은 옵션이 창고별로 여러 줄이면 더한다
  }
  const res = Object.values(out); res.unmatched = unmatched; return res;
}

// 옵션 이름표: 옵션명이 있으면 그것, 없으면 상품명에서 상품 이름 부분을 뗀 나머지 ('DUGN 담요, 1개 블루' → '1개 블루')
// 앞부분이 상품명과 같으면 (띄어쓰기·쉼표 차이는 무시하고) 떼어 낸다
function cutPrefix(n, g) {
  const gk = nk(g); if (!gk) return null; let i = 0, j = 0;
  while (i < n.length && j < gk.length) { const c = nk(n[i]); if (!c) { i++; continue; } if (c !== gk[j]) return null; i++; j++; }
  return j === gk.length ? n.slice(i).replace(/^[\s,·/\-]+/, '').trim() : null;
}
export function optionLabel(x, groupName = '') {
  const g = String(groupName || '').trim();
  for (const src of [x.option_name, x.product_name]) {
    const n = String(src || '').trim(); if (!n) continue;
    const cut = g ? cutPrefix(n, g) : null; if (cut) return cut;
    if (src === x.option_name && !(g && nk(n) === nk(g))) return n;
    if (n.includes(',')) return n.slice(n.indexOf(',') + 1).trim();   // '상품명, 블랙, 공용 S' → '블랙, 공용 S'
  }
  return String(x.option_id);
}
// 상품 이름 (묶음용): 판매 기록 상품명, 없으면 화면 글자의 첫 쉼표 앞. 앞에 붙은 배지 글자는 뗀다
const BADGE = /^(?:\s*(?:로켓그로스|아이템위너|판매중지|판매중|품절임박|품절|배지)\s*)+/;
export function baseProductName(x, salesProductName = '') {
  let n = String(salesProductName || '').trim();
  if (!n) { n = String(x.product_name || '').trim(); if (n.includes(',')) n = n.slice(0, n.indexOf(',')).trim(); }
  return n.replace(BADGE, '').trim();
}
// 묶음 열쇠: 상품 이름이 같으면 등록상품ID 가 옵션마다 달라도 한 상품 (예: 옵션마다 따로 등록된 조끼)
export const groupKeyOf = (x, salesProductName = '') => { const b = baseProductName(x, salesProductName); return nk(b).length >= 4 ? 'n:' + nk(b) : productKey(x); };
// 이름 정렬: 숫자는 크기대로 ('2개' < '10개'), 한글 가나다순
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
export const nameCompare = (a, b) => collator.compare(String(a || ''), String(b || ''));
// sort: 'asc' | 'desc' | 'urgent' — 상품 순서와 그 안 옵션 순서
export function sortInventory(groupsOrRows, sort = 'asc', nameOf = (x) => x.label || x.product_name) {
  const o = LEVEL_ORDER; const arr = [...groupsOrRows];
  if (sort === 'urgent') return arr.sort((a, b) => (o[a.level] - o[b.level]) || (a.daysLeft - b.daysLeft) || (b.rate - a.rate));
  const dir = sort === 'desc' ? -1 : 1; return arr.sort((a, b) => dir * nameCompare(nameOf(a), nameOf(b)));
}
// 상품 묶음 열쇠: 등록상품ID (없으면 상품명)
export const productKey = (x) => String(x.product_id || x.product_name || x.option_id);
// 상품별로 묶기: 재고·입고 예정·하루 판매·발주 추천은 합계, 남은 일수·품절 예상일은 가장 급한 옵션, 상태는 가장 나쁜 것
// (재고를 못 읽은 옵션 'unknown' 은 다른 옵션이 있으면 상품 상태에 넣지 않는다)
export const LEVEL_ORDER = { out: 0, danger: 1, warn: 2, unknown: 3, ok: 4, idle: 5 };
export function groupByProduct(rows) {
  const order = LEVEL_ORDER; const g = {};
  for (const r of rows) {
    const x = (g[r.key] ||= { key: r.key, ps: r.ps || {}, product_ids: [], product_id: r.product_id, product_name: r.group_name || r.product_name, lead: r.lead, seasonType: r.seasonType, seasonEnd: r.seasonEnd, seasonOver: r.seasonOver, stock: 0, inbound: 0, ordered: 0, rate: 0, r7: 0, r30: 0, reorder: 0, daysLeft: Infinity, stockoutDate: null, level: null, missingCount: 0, options: [] });
    if (r.product_id && !x.product_ids.includes(r.product_id)) x.product_ids.push(r.product_id);
    x.options.push(r); x.stock += r.stock || 0; x.inbound += r.inbound || 0; x.ordered += r.ordered || 0; x.rate += r.rate; x.r7 += r.r7; x.r30 += r.r30; x.reorder += r.reorder;
    if (r.missing) { x.missingCount++; continue; }
    if (r.daysLeft < x.daysLeft) { x.daysLeft = r.daysLeft; x.stockoutDate = r.stockoutDate; }
    if (x.level == null || order[r.level] < order[x.level]) x.level = r.level;
  }
  for (const x of Object.values(g)) { x.level ??= 'unknown'; x.options.sort((a, b) => (order[a.level] - order[b.level]) || String(a.option_name || a.product_name).localeCompare(String(b.option_name || b.product_name))); }
  return Object.values(g).sort((a, b) => (order[a.level] - order[b.level]) || (a.daysLeft - b.daysLeft) || (b.rate - a.rate));
}
export const DEFAULT_INV_SETTINGS = { leadDays: 10, coverDays: 30, safetyDays: 7, alertDays: 14, useInbound: true };
// 시즌 구분: 'season'(시즌 상품) | 'year'(비시즌·연중) | ''(미정). 시즌 종료일만 넣었으면 시즌 상품
export const seasonTypeOf = (ps = {}) => ps.season || (ps.seasonEnd ? 'season' : '');

// 옵션별 예측. d.inventory = { 'YYYY-MM-DD': { option_id: row } } 중 가장 최근 날짜를 쓴다.
// 판매 속도: 로켓그로스 판매만(판매방식에 '그로스'가 있으면), 최근 7일 평균과 30일 평균 중 큰 값(갑자기 늘어난 판매를 놓치지 않게)
// 입고 예정은 부정확해서 참고로만 보여 주고 발주 추천에서 빼지 않는다
// 윙 재고 화면에서 못 읽은 옵션(품절이라 목록에 없거나 다음 쪽): 같은 등록상품의 로켓그로스 판매 옵션이나 최근 30일 로켓그로스로 팔린 옵션은 '재고 미확인' 줄로 넣는다
export function inventoryForecast(d, today, settings = {}) {
  const st = { ...DEFAULT_INV_SETTINGS, ...(d.invSettings || {}), ...settings };
  const dates = Object.keys(d.inventory || {}).sort(); const asOf = dates[dates.length - 1]; if (!asOf) return { asOf: null, rows: [], settings: st };
  const inv = d.inventory[asOf];
  const addDays = (iso, n) => { const x = new Date(iso + 'T00:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const end = addDays(today, -1); const s7 = addDays(end, -6), s30 = addDays(end, -29);
  const q7 = {}, q30 = {}; let days30 = new Set(); const facts = {};
  for (const [date, day] of Object.entries(d.sales || {})) {
    const in30 = date >= s30 && date <= end; if (in30) days30.add(date);
    for (const r of Object.values(day)) {
      const rg = !r.sales_type || /그로스/.test(r.sales_type);
      const f = (facts[r.option_id] ||= { product_id: '', product_name: '', option_name: '', rg: false, last: '' });
      if (date >= f.last) { if (r.product_id) f.product_id = String(r.product_id); if (r.product_name) f.product_name = String(r.product_name); if (r.option_name) f.option_name = String(r.option_name); f.last = date; }
      if (rg && r.sales_type && r.quantity > 0) f.rg = true;
      if (!in30 || !(r.quantity > 0) || !rg) continue;   // 판매자배송(윙) 판매는 쿠팡 창고 재고를 쓰지 않는다
      q30[r.option_id] = (q30[r.option_id] || 0) + r.quantity; if (date >= s7) q7[r.option_id] = (q7[r.option_id] || 0) + r.quantity;
    }
  }
  const n30 = Math.max(1, Math.min(30, days30.size)), n7 = Math.max(1, Math.min(7, [...days30].filter((x) => x >= s7).length));
  const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  // 재고 화면 줄에 등록상품ID 가 없으면 판매 기록에서 채운다 (상품별 묶기·일괄 설정이 등록상품ID 로 되도록)
  const base = Object.values(inv).map((x) => (x.product_id || !facts[x.option_id]?.product_id ? x : { ...x, product_id: facts[x.option_id].product_id }));
  const pids = new Set(base.map((x) => x.product_id).filter(Boolean));
  // 재고 화면의 옵션ID 가 판매 기록과 다르게 읽힌 줄: 같은 등록상품에서 이름 끝이 판매 기록 옵션명과 같으면 같은 옵션으로 본다
  const strays = base.filter((x) => !facts[x.option_id]);
  const used = new Set();
  const takeStray = (f) => {
    const on = nk(f.option_name); if (on.length < 2) return null;
    const cands = strays.filter((x) => !used.has(x) && (!x.product_id || !f.product_id || x.product_id === f.product_id));
    const full = (x) => nk(`${x.product_name || ''} ${x.option_name || ''}`);
    const ends = (x) => { const t = full(x); return t.endsWith(on) && !/\d$/.test(t.slice(0, t.length - on.length)); };   // '12개 블루' 가 '2개 블루' 로 잡히지 않게
    return cands.find((x) => nk(x.option_name) === on) || cands.find(ends) || null;
  };
  for (const [oid, f] of Object.entries(facts)) {
    if (inv[oid] || !f.rg) continue;
    if (!(f.product_id && pids.has(f.product_id)) && !(q30[oid] > 0)) continue;
    const st0 = takeStray(f);
    if (st0) { used.add(st0); base.push({ ...st0, option_id: oid, inv_option_id: st0.option_id, product_id: st0.product_id || f.product_id, option_name: f.option_name || st0.option_name }); continue; }
    // 윙 로켓그로스 재고 목록은 품절된 옵션을 빼고 보여 준다 → 최근 로켓그로스로 하루 1개 이상 팔리던 옵션이 목록에 없으면 '품절' 로 본다.
    // 그보다 적게 팔리는 옵션(묶음 2개·3개 세트 등)은 넣지 않는다 (showMissing 이면 '재고 미확인' 으로 넣음)
    const hotRate = Math.max((q7[oid] || 0) / n7, (q30[oid] || 0) / n30);
    if (hotRate >= 1) base.push({ option_id: oid, product_id: f.product_id, product_name: f.product_name, option_name: f.option_name, stock: 0, inbound: 0, outGuess: true });
    else if (st.showMissing) base.push({ option_id: oid, product_id: f.product_id, product_name: f.product_name, option_name: f.option_name, stock: 0, inbound: 0, missing: true });
  }
  for (let i = base.length - 1; i >= 0; i--) if (used.has(base[i])) base.splice(i, 1);
  const IP = d.invProduct || {}; const keyOf = (x) => groupKeyOf(x, facts[x.option_id]?.product_name);
  const groupPs = {};   // 상품 설정: 이름 열쇠로 저장한 것, 없으면 그 상품 옵션들의 등록상품ID 로 저장한 것
  for (const x of base) { const k = keyOf(x); if (IP[k]) groupPs[k] = IP[k]; }
  for (const x of base) { const k = keyOf(x); if (!groupPs[k]) for (const id of [x.product_id, productKey(x)]) if (id && IP[id]) { groupPs[k] = IP[id]; break; } }
  const rows = base.map((x) => {
    const key = keyOf(x); const ps = groupPs[key] || {}; const f = facts[x.option_id] || {};
    const lead = ps.leadDays != null && ps.leadDays !== '' ? Number(ps.leadDays) : st.leadDays;   // 상품마다 다른 입고 소요일 (없으면 기본값)
    const seasonType = seasonTypeOf(ps); const seasonEnd = seasonType === 'year' ? '' : ps.seasonEnd || '';
    const r7 = (q7[x.option_id] || 0) / n7, r30 = (q30[x.option_id] || 0) / n30; const rate = Math.max(r7, r30);
    const left = rate > 0 ? x.stock / rate : Infinity;
    const out = rate > 0 ? addDays(asOf, Math.floor(left)) : null;
    // 채울 기간 = 입고까지 + 보낼 양 + 안전 재고. 시즌 종료일이 있으면 그 날까지만 (시즌이 끝난 뒤 팔릴 양은 주문하지 않는다)
    let need = lead + st.coverDays + st.safetyDays; const seasonLeft = seasonEnd ? dayDiff(asOf, seasonEnd) : null;
    if (seasonLeft != null) need = Math.min(need, Math.max(0, seasonLeft));
    // 이미 오고 있는 것: 윙 입고 예정(설정으로 켜고 끔) + 직접 넣은 '주문해 둔 수량' (넣은 날 + 입고 소요일 + 3일까지만 — 그 뒤엔 쿠팡 재고·입고 예정에 잡혔다고 봄)
    const ord = (d.invOrders || {})[x.option_id]; const ordEta = ord?.date ? addDays(ord.date, lead) : null;
    const ordActive = !!(ord && ord.qty > 0 && (!ord.date || today <= addDays(ord.date, lead + 3)));
    const ordered = ordActive ? Number(ord.qty) : 0; const incoming = (st.useInbound !== false ? (x.inbound || 0) : 0) + ordered;
    const reorder = rate > 0 ? Math.max(0, Math.ceil(rate * need - (x.stock || 0) - incoming)) : 0;
    const seasonOver = seasonLeft != null && seasonLeft <= 0;
    const level = x.missing ? 'unknown' : rate <= 0 ? 'idle' : x.stock <= 0 ? 'out' : left <= lead ? 'danger' : left <= st.alertDays ? 'warn' : 'ok';
    const option_name = x.option_name || (x.missing ? '' : f.option_name && f.option_name !== x.product_name ? f.option_name : '');
    const group_name = baseProductName(x, f.product_name) || f.product_name || x.product_name;
    return { ...x, ordered, orderDate: ord?.date || null, orderEta: ordEta, orderExpired: !!(ord && ord.qty > 0 && !ordActive), orderQty: ord?.qty || 0, ps, option_name, group_name, label: optionLabel({ ...x, option_name }, group_name), key, lead, seasonType, seasonEnd, seasonOver, r7, r30, rate, daysLeft: x.missing ? Infinity : left, stockoutDate: x.missing ? null : out, reorder: x.missing ? 0 : reorder, reorderIfOut: x.missing ? reorder : 0, level };
  });
  const order = LEVEL_ORDER;
  rows.sort((a, b) => (order[a.level] - order[b.level]) || (a.daysLeft - b.daysLeft) || (b.rate - a.rate));
  return { asOf, rows, settings: st };
}

// 윙 화면이 서버에서 받은 재고 데이터(줄마다 평평하게 편 객체) → 재고 줄.
// 어느 칸이 '판매가능 재고' 인지는 화면에서 읽은 줄의 재고 숫자와 가장 많이 맞는 칸으로 정한다 (맞춰 볼 줄이 없으면 칸 이름으로)
const lastSeg = (k) => k.replace(/^.*\./, '');
const ID_K = /^(vendorItemId|vendorItemID|optionId|vendor_item_id|option_id|vendorItemNo)$/i;
export function apiInventoryRows(items, screenRows = []) {
  if (!items?.length) return null;
  const idKey = (it) => Object.keys(it).find((k) => !k.startsWith('parent.') && ID_K.test(lastSeg(k)));
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?[\d,]+(\.\d+)?$/.test(v.trim()) ? Number(v.replace(/,/g, '')) : null);
  const cands = new Set(); for (const it of items.slice(0, 300)) for (const [k, v] of Object.entries(it)) if (num(v) != null && !/(id|no|code|date|time|price|amount|rate|ratio|percent|day)s?$/i.test(lastSeg(k))) cands.add(k);
  const scr = Object.fromEntries((screenRows || []).map((r) => [String(r.option_id), r]));
  const pick = (field, regexes) => {
    let best = null, bestHits = 0, overlap = 0;
    for (const k of cands) {
      let hits = 0, ov = 0;
      for (const it of items) { const s = scr[String(it[idKey(it)])]; if (!s || s[field] == null) continue; ov++; if (num(it[k]) === Number(s[field])) hits++; }
      overlap = Math.max(overlap, ov); if (hits > bestHits) { bestHits = hits; best = k; }
    }
    if (best && bestHits >= Math.max(2, overlap * 0.5) && !(field === 'inbound' && screenRows.every((r) => !r.inbound))) return { key: best, how: `화면 숫자와 ${bestHits}/${overlap}줄 일치` };
    for (const re of regexes) { const k = [...cands].find((x) => re.test(lastSeg(x))); if (k) return { key: k, how: '칸 이름' }; }
    return null;
  };
  const stock = pick('stock', [/^(sal(e)?able|sellable|available|orderable|avail)\w*(stock|qty|quantity|inventory|count)$/i, /^(stock|stockQuantity|stockQty|inventory|inventoryQuantity|availableQuantity|quantity|qty)$/i, /stock/i]);
  if (!stock) return null;
  const inbound = pick('inbound', [/(inbound|incoming|transit|receiving|arrival|expected)\w*(qty|quantity|stock|count)?$/i]);
  const strKey = (it, re) => { const k = Object.keys(it).find((x) => re.test(lastSeg(x)) && typeof it[x] !== 'object'); return k ? String(it[k]).trim() : ''; };
  const rows = [];
  for (const it of items) {
    const ik = idKey(it); if (!ik) continue; const oid = String(it[ik]); if (!/^\d{5,}$/.test(oid)) continue;
    const st = num(it[stock.key]); if (st == null) continue;
    rows.push({ option_id: oid, product_id: strKey(it, /^(sellerProductId|registeredProductId|productId)$/i).replace(/\.0$/, ''),
      product_name: strKey(it, /^(sellerProductName|registeredProductName|productName|displayProductName)$/i),
      option_name: strKey(it, /^(vendorItemName|itemName|optionName|optionValue)$/i), stock: st, inbound: inbound ? num(it[inbound.key]) || 0 : 0, src: 'api' });
  }
  return { rows, stockKey: stock.key, stockHow: stock.how, inboundKey: inbound?.key || '' };
}
