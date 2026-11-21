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
  const byName = names.map((x) => ({ id: String(x.option_id), k: nk(x.name) })).filter((x) => x.k.length >= 6).sort((a, b) => b.k.length - a.k.length);
  const pidx = idx.product_name ?? normed.findIndex((h) => h.includes('상품'));
  const out = {};
  for (const rec of records) {
    const get = (f) => (idx[f] == null ? null : rec[headers[idx[f]]]);
    let oid = idx.option_id != null ? cleanId(get('option_id')) : '';
    if (!/^\d{5,}$/.test(oid)) { for (const v of Object.values(rec)) { const m = String(v ?? '').match(OID_IN_TEXT); if (m) { oid = m[1]; break; } } }
    if (!/^\d{5,}$/.test(oid) && byName.length && pidx >= 0) { const t = nk(rec[headers[pidx]]); const hit = byName.find((x) => t.startsWith(x.k)); if (hit) oid = hit.id; }
    if (!/^\d{5,}$/.test(oid)) continue;
    let stock = null, inbound = null; const raw = String(get('stock') ?? '');
    if (/^[\s\d,.\-]+$/.test(raw) && raw.trim()) stock = parseNumber(raw);
    else { const all = Object.values(rec).map((v) => String(v ?? '')).join(' '); const m = all.match(STOCK_IN_TEXT); if (m) stock = parseNumber(m[1]); const mi = all.match(INBOUND_IN_TEXT); if (mi) inbound = parseNumber(mi[1]); }
    if (stock == null) continue;
    if (inbound == null) { const ri = String(get('inbound') ?? ''); inbound = /^[\s\d,.\-]+$/.test(ri) && ri.trim() ? parseNumber(ri) : 0; }
    const row = (out[oid] ||= { option_id: oid, product_name: '', option_name: '', product_id: '', stock: 0, inbound: 0 });
    row.product_name ||= String(get('product_name') ?? '').trim().slice(0, 120); row.option_name ||= String(get('option_name') ?? '').trim().slice(0, 120); row.product_id ||= cleanId(get('product_id'));
    row.stock += stock ?? 0; row.inbound += inbound ?? 0;   // 같은 옵션이 창고별로 여러 줄이면 더한다
  }
  return Object.values(out);
}

// 상품 묶음 열쇠: 등록상품ID (없으면 상품명)
export const productKey = (x) => String(x.product_id || x.product_name || x.option_id);
// 상품별로 묶기: 재고·입고 예정·하루 판매·발주 추천은 합계, 남은 일수·품절 예상일은 가장 급한 옵션, 상태는 가장 나쁜 것
export function groupByProduct(rows) {
  const order = { out: 0, danger: 1, warn: 2, ok: 3, idle: 4 }; const g = {};
  for (const r of rows) {
    const x = (g[r.key] ||= { key: r.key, product_id: r.product_id, product_name: r.product_name, lead: r.lead, seasonEnd: r.seasonEnd, seasonOver: r.seasonOver, stock: 0, inbound: 0, rate: 0, r7: 0, r30: 0, reorder: 0, daysLeft: Infinity, stockoutDate: null, level: 'idle', options: [] });
    x.options.push(r); x.stock += r.stock; x.inbound += r.inbound || 0; x.rate += r.rate; x.r7 += r.r7; x.r30 += r.r30; x.reorder += r.reorder;
    if (r.daysLeft < x.daysLeft) { x.daysLeft = r.daysLeft; x.stockoutDate = r.stockoutDate; }
    if (order[r.level] < order[x.level]) x.level = r.level;
  }
  return Object.values(g).sort((a, b) => (order[a.level] - order[b.level]) || (a.daysLeft - b.daysLeft) || (b.rate - a.rate));
}
export const DEFAULT_INV_SETTINGS = { leadDays: 10, coverDays: 30, safetyDays: 7, alertDays: 14 };

// 옵션별 예측. d.inventory = { 'YYYY-MM-DD': { option_id: row } } 중 가장 최근 날짜를 쓴다.
// 판매 속도: 로켓그로스 판매만(판매방식에 '그로스'가 있으면), 최근 7일 평균과 30일 평균 중 큰 값(갑자기 늘어난 판매를 놓치지 않게)
export function inventoryForecast(d, today, settings = {}) {
  const st = { ...DEFAULT_INV_SETTINGS, ...(d.invSettings || {}), ...settings };
  const dates = Object.keys(d.inventory || {}).sort(); const asOf = dates[dates.length - 1]; if (!asOf) return { asOf: null, rows: [], settings: st };
  const inv = d.inventory[asOf];
  const addDays = (iso, n) => { const x = new Date(iso + 'T00:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const end = addDays(today, -1); const s7 = addDays(end, -6), s30 = addDays(end, -29);
  const q7 = {}, q30 = {}; let days30 = new Set();
  for (const [date, day] of Object.entries(d.sales || {})) {
    if (date < s30 || date > end) continue; days30.add(date);
    for (const r of Object.values(day)) {
      if (!(r.quantity > 0)) continue; if (r.sales_type && !/그로스/.test(r.sales_type)) continue;   // 판매자배송(윙) 판매는 쿠팡 창고 재고를 쓰지 않는다
      q30[r.option_id] = (q30[r.option_id] || 0) + r.quantity; if (date >= s7) q7[r.option_id] = (q7[r.option_id] || 0) + r.quantity;
    }
  }
  const n30 = Math.max(1, Math.min(30, days30.size)), n7 = Math.max(1, Math.min(7, [...days30].filter((x) => x >= s7).length));
  const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  const rows = Object.values(inv).map((x) => {
    const key = productKey(x); const ps = (d.invProduct || {})[key] || {};
    const lead = ps.leadDays != null && ps.leadDays !== '' ? Number(ps.leadDays) : st.leadDays;   // 상품마다 다른 입고 소요일 (없으면 기본값)
    const seasonEnd = ps.seasonEnd || '';
    const r7 = (q7[x.option_id] || 0) / n7, r30 = (q30[x.option_id] || 0) / n30; const rate = Math.max(r7, r30);
    const left = rate > 0 ? x.stock / rate : Infinity;
    const out = rate > 0 ? addDays(asOf, Math.floor(left)) : null;
    // 채울 기간 = 입고까지 + 보낼 양 + 안전 재고. 시즌 종료일이 있으면 그 날까지만 (시즌이 끝난 뒤 팔릴 양은 주문하지 않는다)
    let need = lead + st.coverDays + st.safetyDays; const seasonLeft = seasonEnd ? dayDiff(asOf, seasonEnd) : null;
    if (seasonLeft != null) need = Math.min(need, Math.max(0, seasonLeft));
    const reorder = rate > 0 ? Math.max(0, Math.ceil(rate * need - x.stock - (x.inbound || 0))) : 0;
    const seasonOver = seasonLeft != null && seasonLeft <= 0;
    const level = rate <= 0 ? 'idle' : x.stock <= 0 ? 'out' : left <= lead ? 'danger' : left <= st.alertDays ? 'warn' : 'ok';
    return { ...x, key, lead, seasonEnd, seasonOver, r7, r30, rate, daysLeft: left, stockoutDate: out, reorder, level };
  });
  const order = { out: 0, danger: 1, warn: 2, ok: 3, idle: 4 };
  rows.sort((a, b) => (order[a.level] - order[b.level]) || (a.daysLeft - b.daysLeft) || (b.rate - a.rate));
  return { asOf, rows, settings: st };
}
