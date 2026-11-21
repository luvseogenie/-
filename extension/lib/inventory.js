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
  return firstMatch(n, INV_FIELDS[0][1], INV_FIELDS[0][2]) != null && firstMatch(n, INV_FIELDS[4][1], INV_FIELDS[4][2]) != null;
}
// 화면 표·엑셀 줄 → [{ option_id, product_name, option_name, product_id, stock, inbound }]
export function normalizeInventory(records) {
  if (!records.length) return [];
  const headers = Object.keys(records[0]); const normed = headers.map(normHeader);
  const idx = {}; for (const [f, al, ex] of INV_FIELDS) idx[f] = firstMatch(normed, al, ex);
  if (idx.option_id == null || idx.stock == null) return [];
  const out = {};
  for (const rec of records) {
    const get = (f) => (idx[f] == null ? null : rec[headers[idx[f]]]);
    const oid = cleanId(get('option_id')); if (!/^\d{5,}$/.test(oid)) continue;
    const row = (out[oid] ||= { option_id: oid, product_name: '', option_name: '', product_id: '', stock: 0, inbound: 0 });
    row.product_name ||= String(get('product_name') ?? '').trim(); row.option_name ||= String(get('option_name') ?? '').trim(); row.product_id ||= cleanId(get('product_id'));
    row.stock += parseNumber(get('stock')) ?? 0; row.inbound += parseNumber(get('inbound')) ?? 0;   // 같은 옵션이 창고별로 여러 줄이면 더한다
  }
  return Object.values(out);
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
  const rows = Object.values(inv).map((x) => {
    const r7 = (q7[x.option_id] || 0) / n7, r30 = (q30[x.option_id] || 0) / n30; const rate = Math.max(r7, r30);
    const left = rate > 0 ? x.stock / rate : Infinity;
    const out = rate > 0 ? addDays(asOf, Math.floor(left)) : null;
    const target = rate * (st.leadDays + st.coverDays + st.safetyDays);   // 입고까지 + 보낼 기간 + 안전 재고
    const reorder = rate > 0 ? Math.max(0, Math.ceil(target - x.stock - (x.inbound || 0))) : 0;
    const level = rate <= 0 ? 'idle' : x.stock <= 0 ? 'out' : left <= st.leadDays ? 'danger' : left <= st.alertDays ? 'warn' : 'ok';
    return { ...x, r7, r30, rate, daysLeft: left, stockoutDate: out, reorder, level };
  });
  const order = { out: 0, danger: 1, warn: 2, ok: 3, idle: 4 };
  rows.sort((a, b) => (order[a.level] - order[b.level]) || (a.daysLeft - b.daysLeft) || (b.rate - a.rate));
  return { asOf, rows, settings: st };
}
