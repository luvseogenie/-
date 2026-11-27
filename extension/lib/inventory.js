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
    let pid = '', pname = '', sku = '';
    if (!/^\d{5,}$/.test(oid) && pidx >= 0) { const txt = String(rec[headers[pidx]] ?? ''); const m = txt.match(ID_TRIPLE); if (m) { pid = m[1]; oid = m[2]; sku = m[3]; pname = txt.slice(0, m.index).trim(); } }
    if (!/^\d{5,}$/.test(oid) && byName.length && pidx >= 0) { const t = nk(rec[headers[pidx]]); const hit = byName.find((x) => t.startsWith(x.k)); if (hit) oid = hit.id; }
    if (!/^\d{5,}$/.test(oid) && byName.length && pidx >= 0) { const t = nk(rec[headers[pidx]]); const hit = byName.find((x) => t.includes(x.k)); if (hit) oid = hit.id; }   // 앞에 배지 글자가 붙은 경우
    if (!/^\d{5,}$/.test(oid)) { unmatched.push(String(pidx >= 0 ? rec[headers[pidx]] : Object.values(rec).join(' ')).slice(0, 120)); continue; }
    let stock = null, inbound = null; const raw = String(get('stock') ?? '');
    if (/^[\s\d,.\-]+$/.test(raw) && raw.trim()) stock = parseNumber(raw);
    else { const all = Object.values(rec).map((v) => String(v ?? '')).join(' '); const m = all.match(STOCK_IN_TEXT); if (m) stock = parseNumber(m[1]); const mi = all.match(INBOUND_IN_TEXT); if (mi) inbound = parseNumber(mi[1]); }
    if (stock == null) continue;
    if (inbound == null) { const ri = String(get('inbound') ?? ''); inbound = /^[\s\d,.\-]+$/.test(ri) && ri.trim() ? parseNumber(ri) : 0; }
    const row = (out[oid] ||= { option_id: oid, product_name: '', option_name: '', product_id: '', stock: 0, inbound: 0 });
    row.product_name ||= (pname || String(get('product_name') ?? '').trim()).slice(0, 120); row.product_id ||= pid; if (sku) row.sku ||= sku; row.option_name ||= String(get('option_name') ?? '').trim().slice(0, 120); row.product_id ||= cleanId(get('product_id'));
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
    const x = (g[r.key] ||= { key: r.key, ps: r.ps || {}, product_ids: [], product_id: r.product_id, product_name: r.group_name || r.product_name, lead: r.lead, seasonType: r.seasonType, seasonEnd: r.seasonEnd, seasonOver: r.seasonOver, stock: 0, inbound: 0, inboundUsed: 0, ordered: 0, rate: 0, r7: 0, r30: 0, reorder: 0, daysLeft: Infinity, stockoutDate: null, level: null, missingCount: 0, options: [] });
    if (r.product_id && !x.product_ids.includes(r.product_id)) x.product_ids.push(r.product_id);
    x.options.push(r); x.stock += r.stock || 0; x.inbound += r.inbound || 0; x.inboundUsed += r.inboundUsed || 0; x.ordered += r.ordered || 0; x.rate += r.rate; x.r7 += r.r7; x.r30 += r.r30; x.reorder += r.reorder;
    if (r.missing) { x.missingCount++; continue; }
    if (r.daysLeft < x.daysLeft) { x.daysLeft = r.daysLeft; x.stockoutDate = r.stockoutDate; }
    if (x.level == null || order[r.level] < order[x.level]) x.level = r.level;
  }
  for (const x of Object.values(g)) { x.level ??= 'unknown'; x.options.sort((a, b) => (order[a.level] - order[b.level]) || String(a.option_name || a.product_name).localeCompare(String(b.option_name || b.product_name))); }
  return Object.values(g).sort((a, b) => (order[a.level] - order[b.level]) || (a.daysLeft - b.daysLeft) || (b.rate - a.rate));
}
export const DEFAULT_INV_SETTINGS = { leadDays: 10, coverDays: 30, safetyDays: 7, alertDays: 14, useInbound: true, inboundKeepDays: 30 };
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
  { const have = new Set(base.map((x) => String(x.option_id))); const today0 = today; const keep0 = Number(st.inboundKeepDays) || 30;
    for (const sh of d.invShipments || []) { if (!sh?.items || !sh.date || today0 > addDays(sh.date, keep0)) continue; for (const [oid, q] of Object.entries(sh.items)) { if (have.has(oid) || !(q > 0)) continue; have.add(oid); const f = facts[oid] || {}; base.push({ option_id: oid, product_id: f.product_id || '', product_name: f.product_name || sh.names?.[oid] || '', option_name: f.option_name || '', stock: 0, inbound: 0, shipOnly: true }); } } }
  const keepDays = Number(st.inboundKeepDays) || 30;
  // 출고리스트에서 못 찾았던 줄(그때 쿠팡에 없던 옵션): 지금 목록에서 바코드·이름으로 다시 찾아 그 배송분에 넣는다
  const candRows = base.map((x) => { const f = facts[x.option_id] || {}; const g = baseProductName(x, f.product_name) || f.product_name || x.product_name; return { option_id: x.option_id, missing: !!x.missing, group_name: g, label: optionLabel({ ...x, option_name: x.option_name || (f.option_name && f.option_name !== x.product_name ? f.option_name : '') }, g) }; });
  const matchName = nameMatcher(candRows); const barMap = d.invBarcodes || {}; const shipPending = {};
  const shipments = (d.invShipments || []).filter((s) => s && s.items && s.date && today <= addDays(s.date, keepDays)).map((s) => {
    if (!s.pending?.length) return s; const items = { ...s.items }, bs = { ...(s.base || {}) }; const left = [];
    for (const p of s.pending) { const oid = (p.barcode && barMap[p.barcode]) || (d.invNameLinks || {})[p.label] || matchName(p.pname, p.oname)?.option_id; if (oid) { items[oid] = (items[oid] || 0) + p.qty; if (bs[oid] == null) bs[oid] = Number(d.inventory?.[s.baseDate]?.[oid]?.stock) || 0; } else left.push(p); }
    shipPending[s.id] = left; return { ...s, items, base: bs };
  }).sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const rgSold = (oid, from, to) => { let n = 0; for (const [date, day] of Object.entries(d.sales || {})) { if (date <= from || date > to) continue; const r = Object.values(day).find((y) => y.option_id === oid); if (r && r.quantity > 0 && (!r.sales_type || /그로스/.test(r.sales_type))) n += r.quantity; } return n; };
  // 받은 양: 그 옵션이 실제로 읽힌 날들의 재고만 이어 보며(일부만 읽힌 날은 건너뜀), 날짜 사이 '재고 증가 + 그 사이 판매' 가
  // 박스 단위로 크게 뛴 것만 입고로 센다 (반품 1~2개 같은 작은 증가는 무시). 출항 후 MIN_TRANSIT 일 안의 증가는 이 배송분 것이 아님
  const MIN_TRANSIT = 2; const invDates = Object.keys(d.inventory || {}).sort();
  const shipState = (oid, stockNow) => {
    const list = shipments.filter((s) => s.items[oid] > 0); if (!list.length) return null;
    const shippedAll = list.reduce((a, s) => a + Number(s.items[oid] || 0), 0);
    const startDate = list[0].date; const d0 = invDates.filter((x) => x <= startDate).pop() || invDates[0];
    const pts = invDates.filter((x) => x >= d0 && d.inventory[x]?.[oid] && d.inventory[x][oid].stock != null).map((x) => [x, Number(d.inventory[x][oid].stock) || 0]);
    // 출항일까지 한 번도 안 읽혔고 그 전에 팔린 적도 없는 옵션 = 새 옵션 → 출항일 재고 0 에서 시작 (일부만 읽힌 날 빠진 기존 옵션과 구별)
    const soldBefore = Object.entries(d.sales || {}).some(([dt, day]) => dt < startDate && Object.values(day).some((y) => y.option_id === oid && y.quantity > 0));
    if (!pts.some(([x]) => x <= startDate) && !soldBefore) pts.unshift([startDate, 0]);
    if (pts.length && pts[pts.length - 1][0] !== asOf) pts.push([asOf, stockNow]); else if (pts.length) pts[pts.length - 1][1] = stockNow;
    const thr = Math.max(5, Math.round(shippedAll * 0.03)); let received = 0; const jumps = [];
    for (let k = 1; k < pts.length; k++) {
      const [da, sa] = pts[k - 1], [db, sb] = pts[k];
      const sold = rgSold(oid, addDays(da, -1), addDays(db, -1));   // 앞 기록 날 ~ 뒤 기록 전날 판매 (기록은 낮에 읽으므로 대략 하루치)
      const jump = sb - sa + sold;
      if (jump >= thr && db >= addDays(startDate, MIN_TRANSIT)) { received += jump; jumps.push({ date: db, qty: jump }); }
    }
    let left = received, remaining = 0, shipped = 0; const per = [];
    for (const s of list) { const q = Number(s.items[oid]); const got = Math.min(q, left); left -= got; shipped += q; remaining += q - got; per.push({ id: s.id, date: s.date, qty: q, got }); }
    return { remaining, received: Math.min(received, shipped), shipped, per, jumps };
  };
  const IP = d.invProduct || {}; const keyOf = (x) => groupKeyOf(x, facts[x.option_id]?.product_name);
  const groupPs = {};   // 상품 설정: 이름 열쇠로 저장한 것, 없으면 그 상품 옵션들의 등록상품ID 로 저장한 것
  for (const x of base) { const k = keyOf(x); if (IP[k]) groupPs[k] = IP[k]; }
  for (const x of base) { const k = keyOf(x); if (!groupPs[k]) for (const id of [x.product_id, productKey(x)]) if (id && IP[id]) { groupPs[k] = IP[id]; break; } }
  const rows = base.map((x) => {
    const key = keyOf(x); const ps = groupPs[key] || {}; const f = facts[x.option_id] || {};
    const lead = ps.leadDays != null && ps.leadDays !== '' ? Number(ps.leadDays) : st.leadDays;   // 상품마다 다른 입고 소요일 (없으면 기본값)
    const seasonType = seasonTypeOf(ps); const seasonEnd = seasonType === 'year' ? '' : ps.seasonEnd || '';
    const r7 = (q7[x.option_id] || 0) / n7, r30 = (q30[x.option_id] || 0) / n30; const rApi = Number(inv[x.option_id]?.sales30) > 0 ? Number(inv[x.option_id].sales30) / 30 : 0; const rate = Math.max(r7, r30, rApi);   // Open API 재고의 '최근 30일 판매'(로켓그로스) 도 함께
    const left = rate > 0 ? x.stock / rate : Infinity;
    const out = rate > 0 ? addDays(asOf, Math.floor(left)) : null;
    // 채울 기간 = 입고까지 + 보낼 양 + 안전 재고. 시즌 종료일이 있으면 그 날까지만 (시즌이 끝난 뒤 팔릴 양은 주문하지 않는다)
    let need = lead + st.coverDays + st.safetyDays; const seasonLeft = seasonEnd ? dayDiff(asOf, seasonEnd) : null;
    if (seasonLeft != null) need = Math.min(need, Math.max(0, seasonLeft));
    // 이미 오고 있는 것: 윙 입고 예정(설정으로 켜고 끔) + 직접 넣은 '주문해 둔 수량' (넣은 날 + 입고 소요일 + 3일까지만 — 그 뒤엔 쿠팡 재고·입고 예정에 잡혔다고 봄)
    const ord = (d.invOrders || {})[x.option_id]; const ordEta = ord?.date ? addDays(ord.date, lead) : null;
    const ordActive = !!(ord && ord.qty > 0 && (!ord.date || today <= addDays(ord.date, lead + 3)));
    const ordered = ordActive ? Number(ord.qty) : 0;
    // 입고 예정: 내가 넣은 값(직접 적기·출고리스트)이 있으면 그것 (넣은 날 + 유지 기간까지), 없으면 윙 값('윙 입고 예정 빼기' 를 켰을 때)
    const mi = (d.invInbound || {})[x.option_id]; const miActive = !!(mi && mi.qty > 0 && (!mi.date || today <= addDays(mi.date, Number(st.inboundKeepDays) || 30)));
    // 배송분(출고리스트): 받은 양 ≈ 보낸 날 재고 이후 재고 증가 + 그 사이 로켓그로스 판매 → 오래된 배송분부터 채우고 남은 것만 입고 예정
    const ship = shipState(x.option_id, x.stock || 0);
    const inboundUsed = miActive ? Number(mi.qty) : ship ? ship.remaining : (st.useInbound !== false ? (x.inbound || 0) : 0);
    const incoming = inboundUsed + ordered;
    const reorder = rate > 0 ? Math.max(0, Math.ceil(rate * need - (x.stock || 0) - incoming)) : 0;
    const seasonOver = seasonLeft != null && seasonLeft <= 0;
    const level = x.missing ? 'unknown' : rate <= 0 ? 'idle' : x.stock <= 0 ? 'out' : left <= lead ? 'danger' : left <= st.alertDays ? 'warn' : 'ok';
    const option_name = x.option_name || (x.missing ? '' : f.option_name && f.option_name !== x.product_name ? f.option_name : '');
    const group_name = baseProductName(x, f.product_name) || f.product_name || x.product_name;
    return { ...x, inboundUsed, ship, inboundSrc: miActive ? 'typed' : ship ? 'ship' : (st.useInbound !== false && x.inbound ? 'wing' : ''), inboundMine: miActive ? Number(mi.qty) : 0, inboundMineDate: mi?.date || null, inboundMineSrc: mi?.src || '', inboundMineExpired: !!(mi && mi.qty > 0 && !miActive), inboundMineQty: mi?.qty || 0, ordered, orderDate: ord?.date || null, orderEta: ordEta, orderExpired: !!(ord && ord.qty > 0 && !ordActive), orderQty: ord?.qty || 0, ps, option_name, group_name, label: optionLabel({ ...x, option_name }, group_name), key, lead, seasonType, seasonEnd, seasonOver, r7, r30, rate, daysLeft: x.missing ? Infinity : left, stockoutDate: x.missing ? null : out, reorder: x.missing ? 0 : reorder, reorderIfOut: x.missing ? reorder : 0, level };
  });
  const order = LEVEL_ORDER;
  rows.sort((a, b) => (order[a.level] - order[b.level]) || (a.daysLeft - b.daysLeft) || (b.rate - a.rate));
  return { asOf, rows, settings: st, shipPending };
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
      option_name: strKey(it, /^(vendorItemName|itemName|optionName|optionValue)$/i), sku: strKey(it, /^(skuId|sku_id|sku)$/i).replace(/\.0$/, ''), barcode: strKey(it, /^(barcode|barCode|bar_code)$/i), stock: st, inbound: inbound ? num(it[inbound.key]) || 0 : 0, src: 'api' });
  }
  return { rows, stockKey: stock.key, stockHow: stock.how, inboundKey: inbound?.key || '' };
}

// 출고리스트(중국에서 쿠팡 창고로 보낸 목록, 엑셀·CSV) → 옵션별 보낸 수량.
// 옵션 찾기: 옵션ID 칸 → 기억해 둔 바코드 → SKU ID → 재고 목록의 바코드 → 상품명+옵션명(옵션 글자 순서가 달라도: '공용 XL 진베이지' = '진베이지, 공용 XL')
// barcodeMap: { 바코드: 옵션ID } (전에 맞춘 것). 새로 이름으로 맞춘 바코드는 learned 로 돌려준다
// 옵션 글자 → 낱말 묶음: '2.0cm'='2cm', '2 cm'='2cm', 쉼표·괄호 무시, 순서 무시
const normOpt = (v) => String(v ?? '').toLowerCase().replace(/[()\[\]·]/g, ' ').replace(/(\d+)\.0+(?!\d)/g, '$1').replace(/(\d)\s+(cm|mm|m|야드|yd|개|g|kg|ml|매|장|입|p|ea)(?![a-z가-힣])/g, '$1$2');
const tokSet = (v) => normOpt(v).split(/[\s,/]+/).map((t) => t.trim()).filter(Boolean).sort().join('|');
const nkName = (v) => String(v ?? '').replace(/[\s,·_()\[\]\-/]/g, '').toLowerCase();
// 상품명+옵션명으로 재고 목록의 옵션 찾기 (옵션 글자 순서가 달라도, 한쪽에만 '1개' 같은 글자가 있어도). 같은 이름이 여럿이면 윙 재고에 있는 것
export function nameMatcher(invRows) {
  const opts = invRows.map((r) => ({ r, g: nkName(r.group_name || r.product_name), o: tokSet(r.label || r.option_name || '') }));
  const pick = (h) => { if (h.length === 1) return h[0].r; const inStock = h.filter((x) => !x.r.missing); return inStock.length === 1 ? inStock[0].r : null; };
  return (pname, oname) => {
    const g = nkName(pname), o = tokSet(oname); if (!o) return null;
    const pool = opts.filter((x) => x.g && g && (x.g === g || x.g.includes(g) || g.includes(x.g)));
    let hit = pool.filter((x) => x.o === o); if (hit.length) return pick(hit);
    const os = o.split('|'); const oset = new Set(os);
    // 한쪽 옵션 글자가 다른 쪽을 모두 포함 ('1개' 같은 글자가 한쪽에만 있을 때)
    hit = pool.filter((x) => { const xs = x.o.split('|'); return xs.length && (xs.every((t) => oset.has(t)) || os.every((t) => xs.includes(t))); });
    if (hit.length) { const r = pick(hit); if (r) return r; }
    return null;   // 색처럼 다른 낱말로 바뀐 경우(레드↔버건디)는 붙이지 않는다 → 배송분 목록에서 직접 연결
  };
}
export function parseShipment(records, invRows = [], barcodeMap = {}) {
  if (!records?.length) return { rows: [], unmatched: [], how: {}, learned: {} };
  const headers = Object.keys(records[0]); const nh = headers.map((h) => String(h).replace(/\s+/g, '').toLowerCase());
  const col = (re, ex = null) => { const i = nh.findIndex((h) => re.test(h) && !(ex && ex.test(h))); return i < 0 ? null : headers[i]; };
  const cOid = col(/^(노출)?옵션id$|옵션아이디|vendoritemid|^옵션번호$/, /등록/);
  const cSku = col(/sku/);
  const cBar = col(/바코드|barcode/);
  const cQty = col(/(출고|발송|입고|납품|확정|보낸|반입|요청).*수량|수량.*(출고|발송|입고|확정)/, /재고|판매|가능/) || col(/^(총수량|수량|qty|quantity|개수|입고예정수량)$/) || col(/수량|qty|quantity/, /재고|판매|가능|박스|팔레트|box/);
  const cPname = col(/^(노출|등록)?상품명$/) || col(/^제품명$|^상품$|^품목명?$/) || col(/^품명$/);
  const cOname = col(/^(한국)?옵션명?$|^옵션값$|^옵션정보$|^상세옵션$|옵션/, /id|번호/);
  const clean = (v) => { let t = String(v ?? '').trim().replace(/,/g, ''); if (t.endsWith('.0')) t = t.slice(0, -2); return t; };
  const byOid = new Map(invRows.map((r) => [String(r.option_id), r]));
  const bySku = new Map(invRows.filter((r) => r.sku).map((r) => [String(r.sku), r]));
  const byBar = new Map(invRows.filter((r) => r.barcode).map((r) => [String(r.barcode), r]));
  const findByName = nameMatcher(invRows);
  const out = {}; const names = {}; const bars = {}; const unmatched = []; const learned = {};
  if (!cQty) return { rows: [], unmatched: [], learned, how: { error: `수량 칸을 찾지 못했습니다 (칸 이름: ${headers.slice(0, 15).join(' | ')})` } };
  for (const rec of records) {
    const q = Math.round(Number(clean(rec[cQty])) || 0); if (q <= 0) continue;
    let hit = null; const oid = cOid ? clean(rec[cOid]) : ''; const bar = cBar ? clean(rec[cBar]) : '';
    if (oid && byOid.has(oid)) hit = byOid.get(oid); else if (/^\d{5,}$/.test(oid)) hit = { option_id: oid };
    if (!hit && bar && barcodeMap[bar]) hit = byOid.get(String(barcodeMap[bar])) || { option_id: String(barcodeMap[bar]) };
    if (!hit && cSku) hit = bySku.get(clean(rec[cSku])) || null;
    if (!hit && bar) hit = byBar.get(bar) || null;
    if (!hit && (cPname || cOname)) { hit = findByName(cPname ? rec[cPname] : '', cOname ? rec[cOname] : ''); if (hit && bar) learned[bar] = String(hit.option_id); }
    if (!hit) { const label = String([cPname && rec[cPname], cOname && rec[cOname]].filter(Boolean).join(' / ') || bar || Object.values(rec).slice(0, 3).join(' ')).slice(0, 80); if (!unmatched.some((u) => u.label === label)) unmatched.push({ label, barcode: bar, pname: cPname ? String(rec[cPname] ?? '') : '', oname: cOname ? String(rec[cOname] ?? '') : '', qty: 0 }); unmatched.find((u) => u.label === label).qty += q; continue; }
    const k = String(hit.option_id); out[k] = (out[k] || 0) + q; if (bar) (bars[k] ||= bar); if (!names[k]) names[k] = String([cPname && rec[cPname], cOname && rec[cOname]].filter(Boolean).join(', ')).slice(0, 120);
  }
  return { rows: Object.entries(out).map(([option_id, qty]) => ({ option_id, qty, name: names[option_id] || '', barcode: bars[option_id] || '' })), unmatched, learned, how: { oid: cOid, sku: cSku, barcode: cBar, qty: cQty, name: [cPname, cOname].filter(Boolean).join('+') } };
}
// 파일 이름 속 날짜 ('DU 출고리스트 11_22 …', '2026-11-22', '1122') → 출항일. 없으면 null
export function dateFromShipName(name, today) {
  const n = String(name || ''); let m = n.match(/(20\d{2})[._\-년\s]*(\d{1,2})[._\-월\s]*(\d{1,2})/);
  let y, mo, dd; if (m) { y = +m[1]; mo = +m[2]; dd = +m[3]; } else { m = n.match(/(?:^|[^\d])(\d{1,2})[._\-월\s]+(\d{1,2})(?:[^\d]|$)/); if (!m) return null; mo = +m[1]; dd = +m[2]; y = +today.slice(0, 4); }
  if (!(mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31)) return null;
  let iso = `${y}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; if (!m[0].startsWith('20') && iso > today) iso = `${y - 1}${iso.slice(4)}`;   // 연도 없이 미래 날짜면 작년
  return iso;
}
// 입고 예정 목록 (파일로 받기용 CSV): 옵션마다 남은 입고 예정 · 보낸 수량 · 받은 수량(추정) · 배송분 날짜
export function inboundCsv(rows) {
  const q = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const head = ['옵션ID', '상품명', '옵션명', '입고 예정 수량', '보낸 수량', '받은 수량(추정)', '출항일', '직접 적은 값'];
  const body = rows.filter((r) => r.ship || r.inboundMineQty > 0).map((r) => [r.option_id, r.group_name || r.product_name || '', r.label || '', r.inboundUsed || 0, r.ship?.shipped ?? '', r.ship?.received ?? '', (r.ship?.per || []).map((p) => p.date).join(' '), r.inboundMine || '']);
  return [head, ...body].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
// 배송분 목록 요약: 배송분마다 옵션 수 · 보낸 수량 · 받은 수량(추정) · 남은 수량
export function shipmentSummary(d, rows, shipPending = {}) {
  const by = {}; for (const r of rows) for (const p of r.ship?.per || []) { const x = (by[p.id] ||= { qty: 0, got: 0 }); x.qty += p.qty; x.got += p.got; }
  return (d.invShipments || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map((s) => { const x = by[s.id]; const left0 = shipPending[s.id] ?? (s.pending || []); const pendQty = left0.reduce((a, p) => a + (p.qty || 0), 0); const total = Object.values(s.items || {}).reduce((a, n) => a + Number(n || 0), 0) + (s.pending || []).reduce((a, p) => a + (p.qty || 0), 0); return { id: s.id, date: s.date, name: s.name || '', options: Object.keys(s.items || {}).length + (s.pending || []).length - left0.length, qty: total, got: x ? x.got : null, left: x ? x.qty - x.got + pendQty : null, active: !!x || !!left0.length, pending: left0 }; });
}

// 윙 '가격/재고 일괄변경' 엑셀(옵션 ID · 바코드 · 등록 옵션명 …) → 바코드 목록 { 바코드: 옵션ID } (출고리스트를 바코드로 정확히 찾기)
const hk = (h) => String(h).replace(/\s+/g, '').toLowerCase();
export function isBarcodeList(headers) {
  const n = headers.map(hk);
  return n.some((h) => /^(노출)?옵션id$/.test(h)) && n.some((h) => /^바코드$|barcode/.test(h)) && n.some((h) => /노출상품명|등록옵션명|판매가격|업체상품id|등록상품명/.test(h)) && !n.some((h) => /박스|출고|발송/.test(h));
}
export function parseBarcodeList(records) {
  if (!records?.length) return { map: {}, names: {}, rows: 0 };
  const headers = Object.keys(records[0]); const n = headers.map(hk); const col = (re) => { const i = n.findIndex((h) => re.test(h)); return i < 0 ? null : headers[i]; };
  const cO = col(/^(노출)?옵션id$/), cB = col(/^바코드$|barcode/), cP = col(/^업체등록상품명$|^등록상품명$/) || col(/노출상품명/), cN = col(/^등록옵션명$|^옵션명$/);
  const clean = (v) => { let t = String(v ?? '').trim(); if (t.endsWith('.0')) t = t.slice(0, -2); return t; };
  const map = {}, names = {};
  for (const r of records) { const oid = clean(r[cO]), bar = clean(r[cB]); if (!/^\d{5,}$/.test(oid) || !bar) continue; map[bar] = oid; names[oid] = { product: String(r[cP] ?? '').trim(), option: String(r[cN] ?? '').trim(), barcode: bar }; }
  return { map, names, rows: records.length };
}
