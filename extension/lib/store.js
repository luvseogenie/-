// 모든 데이터를 chrome.storage.local 에 보관한다. (서버 없음)
// 구조: { options:[{option_id, product_name, campaign, sort_order}], margins:[{option_id, effective_from('' = 처음부터), margin, note}],
//         sales:{ 'YYYY-MM-DD': { option_id: row } }, ads:{ 'YYYY-MM-DD': { campaign: row } },
//         legacy:{ 'YYYY-MM-DD': { campaign: {확정 장부 값} } }  ← 예전 엑셀 4번 시트에서 가져온 값 (옵션별 데이터가 없을 때 그대로 씀)
//         imports:[{id, at, source, from, to, cells, before:{…}}]  ← 가져오기 기록 (되돌리기용) }
const KEY = 'ccdata';
const EMPTY = () => ({ options: [], margins: [], sales: {}, ads: {}, legacy: {}, imports: [] });

export async function load() {
  const r = await chrome.storage.local.get(KEY);
  return { ...EMPTY(), ...(r[KEY] || {}) };
}
export async function save(d) { await chrome.storage.local.set({ [KEY]: d }); }
export async function replaceAll(d) { await chrome.storage.local.set({ [KEY]: { ...EMPTY(), ...d } }); }

const cleanId = (v) => { let s = String(v ?? '').trim().replace(/,/g, ''); if (s.endsWith('.0')) s = s.slice(0, -2); return s; };

export function upsertOption(d, { option_id, product_name = '', campaign = '', product = null, sort_order = null }) {
  option_id = cleanId(option_id);
  const cur = d.options.find((o) => o.option_id === option_id);
  if (cur) { cur.product_name = product_name.trim(); cur.campaign = campaign.trim(); if (product) cur.product = product.trim(); if (sort_order != null) cur.sort_order = sort_order; }
  else d.options.push({ option_id, product_name: product_name.trim(), campaign: campaign.trim(), product: (product || '').trim(), sort_order: sort_order ?? (Math.max(0, ...d.options.map((o) => o.sort_order)) + 1) });
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
export function campaigns(d) {
  const out = [];
  for (const o of sortedOptions(d)) if (o.campaign && !out.includes(o.campaign)) out.push(o.campaign);
  for (const day of Object.values(d.ads)) for (const c of Object.keys(day)) if (!out.includes(c)) out.push(c);
  for (const day of Object.values(d.legacy || {})) for (const c of Object.keys(day)) if (!out.includes(c)) out.push(c);
  return out;
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
