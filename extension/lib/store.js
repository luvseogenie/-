// 모든 데이터를 chrome.storage.local 에 보관한다. (서버 없음)
// 구조: { options:[{option_id, product_name, campaign, sort_order}], margins:[{option_id, effective_from('' = 처음부터), margin, note}],
//         sales:{ 'YYYY-MM-DD': { option_id: row } }, ads:{ 'YYYY-MM-DD': { campaign: row } },
//         legacy:{ 'YYYY-MM-DD': { campaign: {확정 장부 값} } }  ← 예전 엑셀 4번 시트에서 가져온 값 (옵션별 데이터가 없을 때 그대로 씀)
//         imports:[{id, at, source, from, to, cells, before:{…}}]  ← 가져오기 기록 (되돌리기용) }
const KEY = 'ccdata';
const EMPTY = () => ({ options: [], margins: [], sales: {}, ads: {}, legacy: {}, imports: [], expenses: [], traffic: [] });

export async function load() {
  const r = await chrome.storage.local.get(KEY);
  return { ...EMPTY(), ...(r[KEY] || {}) };
}
export async function save(d) { await chrome.storage.local.set({ [KEY]: d }); }
export async function replaceAll(d) { await chrome.storage.local.set({ [KEY]: { ...EMPTY(), ...d } }); }

const cleanId = (v) => { let s = String(v ?? '').trim().replace(/,/g, ''); if (s.endsWith('.0')) s = s.slice(0, -2); return s; };

export function upsertOption(d, { option_id, product_name = '', campaign = '', product = null, source = null, sort_order = null }) {
  option_id = cleanId(option_id);
  const cur = d.options.find((o) => o.option_id === option_id);
  if (cur) { cur.product_name = product_name.trim(); cur.campaign = campaign.trim(); if (product) cur.product = product.trim(); if (source) cur.source = source; if (sort_order != null) cur.sort_order = sort_order; }
  else d.options.push({ option_id, product_name: product_name.trim(), campaign: campaign.trim(), product: (product || '').trim(), source: source || 'manual', sort_order: sort_order ?? (Math.max(0, ...d.options.map((o) => o.sort_order)) + 1) });
}
// 목록에 없는데 판매된 옵션 (최근 N일). 목록은 엑셀 1번 시트/직접 추가한 옵션만 유지한다.
export function unlistedSoldOptions(d, sinceIso) {
  const listed = new Set(d.options.map((o) => o.option_id)); const out = {};
  for (const [date, day] of Object.entries(d.sales)) { if (date < sinceIso) continue; for (const r of Object.values(day)) { if (listed.has(r.option_id) || !(r.quantity > 0)) continue; const o = (out[r.option_id] ||= { option_id: r.option_id, option_name: r.option_name, product: r.product_name, qty: 0, revenue: 0, last: '' }); o.qty += r.quantity; o.revenue += r.revenue || 0; if (date > o.last) o.last = date; } }
  return Object.values(out).sort((a, b) => b.qty - a.qty);
}
// 옵션ID → 상품명(판매 리포트의 '상품명' 열). 옵션에 저장된 값이 없으면 판매 데이터에서 찾는다.
export function productNames(d) {
  const out = {};
  for (const o of d.options) if (o.product) out[o.option_id] = o.product;
  for (const date of Object.keys(d.sales).sort()) for (const r of Object.values(d.sales[date])) if (r.product_name) out[r.option_id] = r.product_name;
  for (const o of d.options) if (!out[o.option_id]) out[o.option_id] = (o.product_name || '').split(',')[0].trim();
  return out;
}
export function deleteOption(d, option_id) {
  option_id = cleanId(option_id);
  d.options = d.options.filter((o) => o.option_id !== option_id);
  d.margins = d.margins.filter((m) => m.option_id !== option_id);
}
export function setMargin(d, option_id, margin, effective_from = '', note = '') {
  option_id = cleanId(option_id); effective_from = effective_from || '';
  const cur = d.margins.find((m) => m.option_id === option_id && m.effective_from === effective_from);
  if (cur) { cur.margin = Number(margin); cur.note = note; }
  else d.margins.push({ option_id, effective_from, margin: Number(margin), note });
}
export function deleteMargin(d, option_id, effective_from = '') {
  option_id = cleanId(option_id); effective_from = effective_from || '';
  d.margins = d.margins.filter((m) => !(m.option_id === option_id && m.effective_from === effective_from));
}
export function marginLookup(d) {
  const by = {};
  for (const m of [...d.margins].sort((a, b) => a.effective_from.localeCompare(b.effective_from))) (by[m.option_id] ||= []).push(m);
  return (option_id, date) => {
    let v = 0;
    for (const m of by[cleanId(option_id)] || []) { if (m.effective_from <= date) v = m.margin; else break; }
    return v;
  };
}
export function upsertSales(d, rows) {
  let n = 0;
  for (const r of rows) { (d.sales[r.date] ||= {})[r.option_id] = r; n++; }
  return n;
}
export function upsertAds(d, rows) {
  let n = 0;
  for (const r of rows) {
    const day = (d.ads[r.date] ||= {});
    const prev = day[r.campaign];
    if (prev && !r.action) r.action = prev.action || '';
    day[r.campaign] = r; n++;
  }
  return n;
}
export function deleteAds(d, date, campaign) { if (d.ads[date]) { delete d.ads[date][campaign]; if (!Object.keys(d.ads[date]).length) delete d.ads[date]; } }
export function deleteSalesDate(d, date) { delete d.sales[date]; }
export function sortedOptions(d) { return [...d.options].sort((a, b) => a.sort_order - b.sort_order); }
// 캠페인 이름 앞의 번호(1., 2., … 43.) 순. 번호가 없으면 이름순, '(캠페인 없음)' 은 맨 뒤.
export function campaignKey(name) {
  const m = String(name).match(/^\s*(\d+)/);
  return [m ? Number(m[1]) : Number.MAX_SAFE_INTEGER - 1, String(name)];
}
export function sortCampaigns(list) {
  return [...list].sort((a, b) => {
    if (a === '(캠페인 없음)') return 1; if (b === '(캠페인 없음)') return -1;
    const [na, sa] = campaignKey(a), [nb, sb] = campaignKey(b);
    return na - nb || sa.localeCompare(sb, 'ko');
  });
}
export function campaigns(d) {
  const out = new Set();
  for (const o of d.options) if (o.campaign) out.add(o.campaign);
  for (const day of Object.values(d.ads)) for (const c of Object.keys(day)) out.add(c);
  for (const day of Object.values(d.legacy || {})) for (const c of Object.keys(day)) out.add(c);
  return sortCampaigns([...out]);
}
export function dates(d) { return [...new Set([...Object.keys(d.sales), ...Object.keys(d.ads), ...Object.keys(d.legacy || {})])].sort(); }
export function unmappedOptionIds(d) {
  const mapped = new Set(d.options.filter((o) => o.campaign).map((o) => o.option_id));
  const ids = new Set();
  for (const day of Object.values(d.sales)) for (const id of Object.keys(day)) if (!mapped.has(id)) ids.add(id);
  return [...ids].sort();
}
export function marginHistory(d, option_id) {
  return d.margins.filter((m) => m.option_id === option_id).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
}

// ---- 광고 외 지출 (트래픽·마케팅 등 수기 입력) ----
export const EXPENSE_CATEGORIES = ['트래픽', '마케팅', '체험단', '택배', '포장·부자재', '인증', '기타'];
export function addExpense(d, { date, category, amount, memo = '', mode = 'month', id = null }) {
  d.expenses ||= [];
  const e = { id: id || 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date, category: String(category || '기타').trim(), amount: Number(amount) || 0, memo: String(memo || '').trim(), mode: mode === 'day' ? 'day' : 'month' };
  const i = d.expenses.findIndex((x) => x.id === e.id); if (i >= 0) d.expenses[i] = e; else d.expenses.push(e);
  return e;
}
export function deleteExpense(d, id) { d.expenses = (d.expenses || []).filter((x) => x.id !== id); }
// 날짜별 지출 배분: mode 'month' 는 그 달 일수로 나눠 매일 반영, 'day' 는 그 날에 반영
export function expensesByDay(d, start, end) {
  const out = {};
  for (const e of d.expenses || []) {
    if (!e.date || !e.amount) continue;
    if (e.mode === 'day') { if (e.date >= start && e.date <= end) out[e.date] = (out[e.date] || 0) + e.amount; continue; }
    const [y, m] = e.date.split('-').map(Number); const days = new Date(y, m, 0).getDate(); const per = e.amount / days;
    for (let day = 1; day <= days; day++) { const iso = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`; if (iso >= start && iso <= end) out[iso] = (out[iso] || 0) + per; }
  }
  return out;
}

// ---- 트래픽 슬롯 (캠페인별 사용 기간과 슬롯 수, 수기 입력) ----
export function addTraffic(d, { id = null, campaign, start, end = '', slots, memo = '' }) {
  d.traffic ||= [];
  const t = { id: id || 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), campaign: String(campaign || '').trim(), start, end: end || '', slots: Number(slots) || 0, memo: String(memo || '').trim() };
  const i = d.traffic.findIndex((x) => x.id === t.id); if (i >= 0) d.traffic[i] = t; else d.traffic.push(t);
  return t;
}
export function deleteTraffic(d, id) { d.traffic = (d.traffic || []).filter((x) => x.id !== id); }
// 캠페인·날짜의 슬롯 수 (겹치면 합산)
export function trafficSlots(d, campaign, date) {
  let n = 0; for (const t of d.traffic || []) if (t.campaign === campaign && t.start && date >= t.start && (!t.end || date <= t.end)) n += t.slots;
  return n;
}
// 캠페인별 현재(또는 지정일) 상태 요약: { slots, since }
export function trafficStatus(d, campaign, date) {
  const active = (d.traffic || []).filter((t) => t.campaign === campaign && t.start && date >= t.start && (!t.end || date <= t.end));
  if (!active.length) return null;
  return { slots: active.reduce((a, t) => a + t.slots, 0), since: active.map((t) => t.start).sort()[0], memo: active.map((t) => t.memo).filter(Boolean).join(' / ') };
}
