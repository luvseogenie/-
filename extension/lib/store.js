// 모든 데이터를 chrome.storage.local 에 보관한다. (서버 없음)
// 구조: { options:[{option_id, product_name, campaign, sort_order}], margins:[{option_id, effective_from('' = 처음부터), margin, note}],
//         sales:{ 'YYYY-MM-DD': { option_id: row } }, ads:{ 'YYYY-MM-DD': { campaign: row } } }
const KEY = 'ccdata';
const EMPTY = () => ({ options: [], margins: [], sales: {}, ads: {} });

export async function load() {
  const r = await chrome.storage.local.get(KEY);
  return { ...EMPTY(), ...(r[KEY] || {}) };
}
export async function save(d) { await chrome.storage.local.set({ [KEY]: d }); }
export async function replaceAll(d) { await chrome.storage.local.set({ [KEY]: { ...EMPTY(), ...d } }); }

const cleanId = (v) => { let s = String(v ?? '').trim().replace(/,/g, ''); if (s.endsWith('.0')) s = s.slice(0, -2); return s; };

export function upsertOption(d, { option_id, product_name = '', campaign = '', sort_order = null }) {
  option_id = cleanId(option_id);
  const cur = d.options.find((o) => o.option_id === option_id);
  if (cur) { cur.product_name = product_name.trim(); cur.campaign = campaign.trim(); if (sort_order != null) cur.sort_order = sort_order; }
  else d.options.push({ option_id, product_name: product_name.trim(), campaign: campaign.trim(), sort_order: sort_order ?? (Math.max(0, ...d.options.map((o) => o.sort_order)) + 1) });
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
  return out;
}
export function dates(d) { return [...new Set([...Object.keys(d.sales), ...Object.keys(d.ads)])].sort(); }
export function unmappedOptionIds(d) {
  const mapped = new Set(d.options.filter((o) => o.campaign).map((o) => o.option_id));
  const ids = new Set();
  for (const day of Object.values(d.sales)) for (const id of Object.keys(day)) if (!mapped.has(id)) ids.add(id);
  return [...ids].sort();
}
export function marginHistory(d, option_id) {
  return d.margins.filter((m) => m.option_id === option_id).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
}
