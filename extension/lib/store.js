import { cleanCampaignName } from './parse.js';
// 모든 데이터를 chrome.storage.local 에 보관한다. (서버 없음)
// 구조: { options:[{option_id, product_name, campaign, sort_order}], margins:[{option_id, effective_from('' = 처음부터), margin, note}],
//         sales:{ 'YYYY-MM-DD': { option_id: row } }, ads:{ 'YYYY-MM-DD': { campaign: row } },
//         legacy:{ 'YYYY-MM-DD': { campaign: {확정 장부 값} } }  ← 예전 엑셀 4번 시트에서 가져온 값 (옵션별 데이터가 없을 때 그대로 씀)
//         imports:[{id, at, source, from, to, cells, before:{…}}]  ← 가져오기 기록 (되돌리기용) }
const KEY = 'ccdata';
const EMPTY = () => ({ options: [], margins: [], sales: {}, ads: {}, legacy: {}, imports: [], expenses: [], traffic: [], adrows: {}, excludes: {}, campaignOptions: {}, ignore: { ids: [], words: [] }, zeroRoas: {} });

export async function load() {
  const r = await chrome.storage.local.get(KEY);
  const d = { ...EMPTY(), ...(r[KEY] || {}) };
  const changed = cleanCampaignNames(d);
  const moved = relinkOptions(d);
  const added = autoAddOptions(d);
  if (changed || moved.length || added.length) await save(d);
  return d;
}
// ---- 광고 보고서·광고센터에 나온 옵션을 목록에 자동 등록 ----
// 운영 중인 캠페인이 광고한 옵션(보고서 adrows, 광고센터에서 읽은 campaignOptions)이 목록에 없으면 그 캠페인에 연결해 넣는다 (마진은 비어 있음 → '마진 없음'으로 표시).
export function autoAddOptions(d) {
  const st = campaignStatus(d); if (!Object.keys(st).length) return [];
  const listed = new Set(d.options.map((o) => o.option_id)); const cand = {};
  for (const rows of Object.values(d.adrows || {})) for (const r of rows) if (r.option_id && r.campaign && st[r.campaign] === 'running' && !listed.has(String(r.option_id))) { const x = (cand[r.option_id] ||= { option_id: String(r.option_id), campaign: r.campaign, name: '' }); if (r.product_name) x.name = r.product_name; x.campaign = r.campaign; }
  for (const [c, v] of Object.entries(d.campaignOptions || {})) if (st[c] === 'running') for (const o of v.options || []) if (!listed.has(String(o.option_id))) { const x = (cand[o.option_id] ||= { option_id: String(o.option_id), campaign: c, name: '' }); if (o.name && !x.name) x.name = o.name; }
  const names = productNames(d); const added = [];
  for (const x of Object.values(cand)) { upsertOption(d, { option_id: x.option_id, product_name: x.name || names[x.option_id] || '', campaign: x.campaign, source: 'adreport' }); added.push(x); }
  if (added.length) { const when = new Date().toISOString().slice(0, 10); d.autoAdded = [...(d.autoAdded || []), ...added.map((x) => ({ ...x, when }))].slice(-500); }
  return added;
}
// ---- 캠페인 상태: 광고센터 목록(ads)을 마지막으로 읽은 날 기준 ----
// running: 목록에 있고 최근 7일 안에 광고비가 있거나 새로 생긴 캠페인 / paused: 목록엔 있지만 광고비 없음 / deleted: 목록에서 사라짐
// 옵션·엑셀에만 있고 광고센터 목록에서 본 적 없는 캠페인은 결과에 없다(끝난 캠페인). 광고 목록을 한 번도 안 읽었으면 {} (모두 운영 중으로 취급)
export function campaignStatus(d) {
  const dates = Object.keys(d.ads || {}).filter((x) => Object.keys(d.ads[x]).length).sort(); if (!dates.length) return {};
  const latest = dates[dates.length - 1];
  const wa = new Date(latest + 'T00:00:00'); wa.setDate(wa.getDate() - 6); const weekAgo = `${wa.getFullYear()}-${String(wa.getMonth() + 1).padStart(2, '0')}-${String(wa.getDate()).padStart(2, '0')}`;
  const recent = dates.filter((x) => x >= weekAgo);   // 마지막 수집일 기준 최근 7일
  const first = {}; for (const date of dates) for (const c of Object.keys(d.ads[date])) if (!first[c]) first[c] = date;
  const out = {};
  for (const c of Object.keys(first)) {
    if (!d.ads[latest][c]) { out[c] = 'deleted'; continue; }
    const spent = recent.some((date) => (d.ads[date][c]?.spend || 0) > 0);
    out[c] = spent || first[c] >= weekAgo ? 'running' : 'paused';   // 광고비가 있거나 생긴 지 7일 안(아직 광고비가 없어도 새 캠페인)
  }
  return out;
}
export const isRunning = (status, c) => !Object.keys(status).length || status[c] === 'running';
// ---- 옵션을 가장 최근 캠페인으로 옮기기 ----
// 광고 보고서(adrows)·광고센터에서 읽은 캠페인 옵션(campaignOptions)에 '이 옵션을 이 캠페인이 광고했다'는 근거가 있으면,
// 지금 연결된 캠페인이 중단·삭제됐거나 근거가 없을 때 운영 중인 최신 캠페인으로 옮긴다. 옮긴 내역은 d.relinks 에 남는다.
export function relinkOptions(d) {
  const st = campaignStatus(d); if (!Object.keys(st).length) return [];
  const ev = {};
  for (const [date, rows] of Object.entries(d.adrows || {})) for (const r of rows) if (r.option_id && r.campaign) { const m = (ev[r.option_id] ||= {}); if (!m[r.campaign] || m[r.campaign] < date) m[r.campaign] = date; }
  for (const [c, v] of Object.entries(d.campaignOptions || {})) for (const o of v.options || []) { const m = (ev[o.option_id] ||= {}); if (!m[c] || m[c] < v.at) m[c] = v.at; }
  const moved = [];
  for (const o of d.options) {
    const m = ev[o.option_id]; if (!m) continue;
    const running = Object.entries(m).filter(([c]) => st[c] === 'running').sort((a, b) => b[1].localeCompare(a[1]));
    if (!running.length) continue;
    const [best, at] = running[0];
    if (best === o.campaign) continue;
    if (st[o.campaign] === 'running' && m[o.campaign]) continue;   // 지금 캠페인도 운영 중이고 근거가 있으면 그대로 (한 옵션을 두 캠페인이 광고하는 경우)
    moved.push({ option_id: o.option_id, from: o.campaign, to: best, at });
    o.campaign = best;
  }
  if (moved.length) { const when = new Date().toISOString().slice(0, 10); d.relinks = [...(d.relinks || []), ...moved.map((x) => ({ ...x, when }))].slice(-300); }
  return moved;
}
// 배지·버튼 글자가 붙은 채 저장된 캠페인 이름('AI 스마트광고 0. …', '31. 피크닉매트 수정 삭제')을 정리해 같은 캠페인으로 합친다. 바뀐 게 있으면 true
export function cleanCampaignNames(d) {
  // 1) 규칙으로 배지·버튼 글자 떼기  2) 그래도 남은 것: 번호로 시작하는 다른 캠페인 이름을 통째로 품고 있으면 그 이름으로 ('오늘의 Pick31. 피크닉매트' ⊃ '31. 피크닉매트')
  const names = new Set();
  for (const day of Object.values(d.ads || {})) for (const c of Object.keys(day)) names.add(c);
  for (const day of Object.values(d.legacy || {})) for (const c of Object.keys(day)) names.add(c);
  for (const c of Object.keys(d.campaignOptions || {})) names.add(c);
  for (const c of Object.keys(d.excludes || {})) names.add(c);
  for (const o of d.options || []) if (o.campaign) names.add(o.campaign);
  for (const rows of Object.values(d.adrows || {})) for (const r of rows) if (r.campaign) names.add(r.campaign);
  const step1 = {}; for (const n of names) step1[n] = cleanCampaignName(n);
  const known = [...new Set(Object.values(step1))].filter((n) => /^\d{1,4}\.\s*\S/.test(n)).sort((a, b) => a.length - b.length);
  const map = {};
  for (const n of names) {
    let c = step1[n];
    const inner = known.find((k) => k !== c && c.includes(k) && c.length - k.length <= 30);
    if (inner) c = inner;
    if (c !== n) map[n] = c;
  }
  const fix = (name) => map[name] || name;
  const merge = (obj, mergeRow) => { for (const k of Object.keys(obj)) { const c = fix(k); if (c === k) continue; const v = obj[k]; delete obj[k]; if (mergeRow && obj[c]) obj[c] = mergeRow(obj[c], v); else if (!obj[c]) obj[c] = v; if (v && typeof v === 'object' && !Array.isArray(v) && 'campaign' in v) v.campaign = c; } };
  for (const date of Object.keys(d.ads || {})) merge(d.ads[date], (a, b) => (zeroAds(a) && !zeroAds(b) ? b : a));
  for (const date of Object.keys(d.legacy || {})) merge(d.legacy[date]);
  merge(d.campaignOptions || {}, (a, b) => (a.at >= b.at ? a : b));
  merge(d.excludes || {}, (a, b) => [...a, ...b.filter((x) => !a.some((y) => y.keyword === x.keyword))]);
  for (const o of d.options || []) if (o.campaign) o.campaign = fix(o.campaign);
  for (const date of Object.keys(d.adrows || {})) for (const r of d.adrows[date]) if (r.campaign) r.campaign = fix(r.campaign);
  cleanCampaignNames.last = map;   // { 원래 이름: 정리된 이름 } (화면 안내용)
  return Object.keys(map).length > 0;
}
const zeroAds = (r) => !r || ['spend', 'ad_revenue', 'impressions', 'clicks', 'ad_orders'].every((k) => !r[k]);
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
// ---- 기록하지 않을 판매 (재판매·리퍼 등): 옵션ID 목록 + 옵션명/상품명에 든 단어 ----
export function ignoreRules(d) { const g = d.ignore || {}; return { ids: new Set(g.ids || []), words: (g.words || []).map((w) => String(w).trim().toLowerCase()).filter(Boolean) }; }
export function isIgnoredRow(rules, r) {
  if (rules.ids.has(String(r.option_id))) return true;
  if (!rules.words.length) return false;
  const t = `${r.option_name || ''} ${r.product_name || ''} ${r.sales_type || ''}`.toLowerCase();
  return rules.words.some((w) => t.includes(w));
}
export function ignoreOption(d, option_id, on = true) { d.ignore ||= { ids: [], words: [] }; const id = String(option_id); d.ignore.ids = (d.ignore.ids || []).filter((x) => x !== id); if (on) d.ignore.ids.push(id); }
export function setIgnoreWords(d, words) { d.ignore ||= { ids: [], words: [] }; d.ignore.words = [...new Set(words.map((w) => String(w).trim()).filter(Boolean))]; }
// 무시 규칙에 걸리는 판매 옵션 목록 (되돌리기 화면용)
export function ignoredSoldOptions(d, sinceIso) {
  const rules = ignoreRules(d); const out = {};
  for (const [date, day] of Object.entries(d.sales)) { if (date < sinceIso) continue; for (const r of Object.values(day)) { if (!isIgnoredRow(rules, r)) continue; const o = (out[r.option_id] ||= { option_id: r.option_id, option_name: r.option_name, product: r.product_name, qty: 0, revenue: 0, last: '', byId: rules.ids.has(String(r.option_id)) }); o.qty += r.quantity || 0; o.revenue += r.revenue || 0; if (date > o.last) o.last = date; } }
  return Object.values(out).sort((a, b) => b.qty - a.qty);
}
export function unlistedSoldOptions(d, sinceIso) {
  const listed = new Set(d.options.map((o) => o.option_id)); const out = {}; const rules = ignoreRules(d);
  for (const [date, day] of Object.entries(d.sales)) { if (date < sinceIso) continue; for (const r of Object.values(day)) { if (listed.has(r.option_id) || !(r.quantity > 0) || isIgnoredRow(rules, r)) continue; const o = (out[r.option_id] ||= { option_id: r.option_id, option_name: r.option_name, product: r.product_name, qty: 0, revenue: 0, last: '' }); o.qty += r.quantity; o.revenue += r.revenue || 0; if (date > o.last) o.last = date; } }
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
    // 성과 숫자가 모두 0인 새 값이 이미 있는 숫자를 덮어쓰지 않게 (덜 채워진 화면을 읽은 경우)
    const zero = (x) => !(x.spend || x.impressions || x.clicks || x.ad_revenue || x.ad_orders);
    if (prev && zero(r) && !zero(prev)) { day[r.campaign] = { ...prev, target_roas: r.target_roas || prev.target_roas, budget: r.budget || prev.budget, action: r.action }; n++; continue; }
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
const TAIL = ['(광고 없는 판매)', '(캠페인 없음)'];   // 맨 뒤에 이 순서로
export function sortCampaigns(list) {
  return [...list].sort((a, b) => {
    const la = TAIL.indexOf(a), lb = TAIL.indexOf(b); if (la >= 0 || lb >= 0) return la - lb;
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
// ---- 광고 보고서 행 (키워드·옵션별 일별). 같은 날짜·캠페인은 새 파일 내용으로 통째로 바뀐다 ----
export function upsertAdRows(d, rows) {
  d.adrows ||= {};
  const touched = new Set(rows.map((r) => r.date + '|' + r.campaign));
  const byDate = {};
  for (const r of rows) (byDate[r.date] ||= []).push(r);
  let n = 0;
  for (const [date, list] of Object.entries(byDate)) {
    const keep = (d.adrows[date] || []).filter((r) => !touched.has(date + '|' + r.campaign));
    d.adrows[date] = keep.concat(list); n += list.length;
  }
  return n;
}
// ---- 광고센터에서 읽어 온 캠페인별 광고 옵션 (캠페인 상세 화면의 상품 목록) ----
export function setCampaignOptions(d, campaign, list) { d.campaignOptions ||= {}; d.campaignOptions[campaign] = { at: new Date().toISOString().slice(0, 10), options: list.map((o) => ({ option_id: String(o.option_id), name: String(o.name || '') })) }; }
// ---- 제외 키워드 담기 (캠페인별) ----
export function addExclude(d, campaign, keyword, memo = '') {
  d.excludes ||= {}; const list = (d.excludes[campaign] ||= []);
  const k = String(keyword || '').trim(); if (!k) return false;
  if (list.some((x) => x.keyword === k)) return false;
  list.push({ keyword: k, added_at: new Date().toISOString().slice(0, 10), memo: String(memo || ''), synced: false });
  return true;
}
export function removeExclude(d, campaign, keyword) { if (!d.excludes?.[campaign]) return; d.excludes[campaign] = d.excludes[campaign].filter((x) => x.keyword !== keyword); }
export function markExcludesSynced(d, campaign, keywords) { for (const x of d.excludes?.[campaign] || []) if (keywords.includes(x.keyword)) x.synced = true; }

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
export const EXPENSE_CATEGORIES = ['트래픽', '3PL', '마케팅', '체험단', '택배', '포장·부자재', '인증', '기타'];
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

// ---- 제로 ROAS(손익분기 광고수익률) ----
// 광고센터 ROAS = 광고매출 ÷ 광고비(부가세 전). 광고비엔 부가세 10% 가 붙으므로 손익분기는 ROAS = 판매가 × 1.1 ÷ 개당 마진.
// 캠페인 옵션들의 최근 판매(매출·판매량·마진)로 계산하고, 사용자가 직접 넣은 값(d.zeroRoas)이 있으면 그 값을 쓴다.
export const DEFAULT_ZERO_ROAS = 2.5;   // 사용자가 따로 안 정하면 250%
export function zeroRoasDefault(d) { return d.zeroRoasDefault > 0 ? d.zeroRoasDefault : DEFAULT_ZERO_ROAS; }
export function setZeroRoasDefault(d, ratio) { if (ratio > 0) d.zeroRoasDefault = ratio; else delete d.zeroRoasDefault; }
export function setZeroRoas(d, campaign, ratio) { d.zeroRoas ||= {}; if (ratio == null || !(ratio > 0)) delete d.zeroRoas[campaign]; else d.zeroRoas[campaign] = ratio; }
export function computeZeroRoas(d, campaign, sinceIso) {
  const ids = new Set(d.options.filter((o) => o.campaign === campaign).map((o) => o.option_id)); if (!ids.size) return null;
  const margin = marginLookup(d); const rules = ignoreRules(d); let rev = 0, qty = 0, mg = 0;
  for (const [date, day] of Object.entries(d.sales)) { if (date < sinceIso) continue; for (const r of Object.values(day)) { if (!ids.has(r.option_id) || !(r.quantity > 0) || isIgnoredRow(rules, r)) continue; rev += r.revenue || 0; qty += r.quantity; mg += r.quantity * margin(r.option_id, date); } }
  if (!qty || !rev) return null;
  const price = rev / qty, m = mg / qty;
  return { price, margin: m, qty, zero: m > 0 ? (price * 1.1) / m : null };
}
// ---- 캠페인 모드: 시즌 / 비시즌 / 보통 (추천 기준이 달라진다) ----
export function setCampMode(d, campaign, mode, end = '') { d.campMode ||= {}; if (!mode || mode === 'normal') delete d.campMode[campaign]; else d.campMode[campaign] = { mode, end: end || '' }; }
// 모드·시즌 남은 날짜에 따른 허용 범위 (제로 ROAS 의 배수). min 미만이면 조정 필요, good 이상이면 여유
export function roasBand(modeInfo, todayIso) {
  const mode = modeInfo?.mode || 'normal';
  if (mode === 'off') return { min: 1.2, good: 1.8, label: '비시즌', hint: '비시즌: 이익 나는 광고만 남기고 예산은 보수적으로' };
  if (mode === 'season') {
    const end = modeInfo.end; const left = end ? Math.round((new Date(end + 'T00:00:00') - new Date(todayIso + 'T00:00:00')) / 86400000) : null;
    if (left == null || left > 30) return { min: 0.85, good: 1.2, label: '시즌 초·중반', hint: '시즌 초·중반: 노출·순위를 위해 제로보다 약간 낮은 ROAS 까지 허용', left };
    if (left > 14) return { min: 1.0, good: 1.4, label: `시즌 후반 (D-${left})`, hint: '시즌 후반: 제로 이상은 지키면서 노출 유지', left };
    return { min: 1.2, good: 1.8, label: `시즌 막바지 (D-${Math.max(left, 0)})`, hint: '시즌 막바지: 손해 광고는 바로 정리, 이익 나는 것만', left };
  }
  return { min: 1.0, good: 1.5, label: '보통', hint: '' };
}
// 최근 N일(광고 데이터가 있는 날 기준) 캠페인별 효율 점검 + 직전 N일과 비교(노출·광고비·광고 이익 증감, 목표 ROAS 변경 효과). 운영 중인 캠페인만.
// 상태: red = 허용 하한 미만(조정 필요) / blue = 여유 / green = 적정 / unknown = 제로 ROAS 모름 / idle = 광고비 없음
export function roasCheck(d, days = 3) {
  const st = campaignStatus(d); const allDates = Object.keys(d.ads).filter((x) => Object.keys(d.ads[x]).length).sort();
  const adDates = allDates.slice(-days); const prevDates = allDates.slice(-days * 2, -days);
  if (!adDates.length) return { dates: [], prevDates: [], rows: [] };
  const last = adDates[adDates.length - 1];
  const wa = new Date(last + 'T00:00:00'); wa.setDate(wa.getDate() - 29); const since = `${wa.getFullYear()}-${String(wa.getMonth() + 1).padStart(2, '0')}-${String(wa.getDate()).padStart(2, '0')}`;
  const sum = (dates) => { const agg = {}; for (const date of dates) for (const [c, a] of Object.entries(d.ads[date])) { if (!isRunning(st, c)) continue; const x = (agg[c] ||= { spend: 0, revenue: 0, orders: 0, clicks: 0, impressions: 0, target: null, targetFirst: null, budget: 0, days: 0 }); x.spend += a.spend || 0; x.revenue += a.ad_revenue || 0; x.orders += a.ad_orders || 0; x.clicks += a.clicks || 0; x.impressions += a.impressions || 0; if (a.target_roas) { x.target = a.target_roas; if (x.targetFirst == null) x.targetFirst = a.target_roas; } if (a.budget) x.budget = a.budget; x.days++; } return agg; };
  const cur = sum(adDates), prev = sum(prevDates);
  const pct = (a, b) => (b ? (a - b) / b : null);
  const rows = Object.keys(cur).map((c) => {
    const x = { campaign: c, ...cur[c] }; const p = prev[c] || null;
    // 제로 ROAS 우선순위: 캠페인에 직접 넣은 값 > 기본값(설정, 처음엔 250%) . 옵션 마진으로 계산한 값은 참고로만 보여 준다
    const calc = computeZeroRoas(d, c, since); const manual = d.zeroRoas?.[c] || null; const dflt = zeroRoasDefault(d);
    const zero = manual || dflt; const roas = x.spend ? x.revenue / x.spend : 0;
    const profitOf = (a) => (zero && a ? a.revenue / zero - a.spend * 1.1 : null);   // 광고 이익(추정) = 광고매출 × (마진/판매가) − 광고비(부가세 포함)
    const profit = profitOf(x), prevProfit = profitOf(p);
    const modeInfo = d.campMode?.[c] || null; const band = roasBand(modeInfo, last);
    const trend = p ? { impressions: pct(x.impressions, p.impressions), spend: pct(x.spend, p.spend), revenue: pct(x.revenue, p.revenue), profit: profit != null && prevProfit != null ? profit - prevProfit : null, roasPrev: p.spend ? p.revenue / p.spend : 0, targetPrev: p.target } : null;
    const targetChanged = !!(trend && trend.targetPrev && x.target && Math.abs(trend.targetPrev - x.target) > 0.005) || (x.targetFirst && x.target && Math.abs(x.targetFirst - x.target) > 0.005);
    let status = 'idle'; const tips = [];
    if (x.spend > 0) {
      if (!zero) { status = 'unknown'; tips.push('제로 ROAS 를 모릅니다 — 옵션 마진을 넣거나 직접 입력하세요'); }
      else {
        const lo = zero * band.min, hi = zero * band.good;
        if (roas < lo) { status = 'red'; tips.push(`ROAS ${Math.round(roas * 100)}% < 허용 하한 ${Math.round(lo * 100)}% (제로 ${Math.round(zero * 100)}%${band.min !== 1 ? ` × ${band.min}` : ''}) — 목표 ROAS 를 ${Math.round(lo * 100)}% 이상으로 올리거나 입찰·키워드를 줄이세요`); }
        else if (roas >= hi) { status = 'blue'; tips.push(`ROAS ${Math.round(roas * 100)}% ≥ ${Math.round(hi * 100)}% — 여유. 목표 ROAS 를 낮춰 노출을 늘릴 여지${x.budget && x.spend / x.days >= x.budget * 0.9 ? ', 예산이 거의 소진되니 예산 증액 검토' : ''}`); }
        else { status = 'green'; tips.push(`적정 (허용 ${Math.round(lo * 100)}~${Math.round(hi * 100)}%)`); }
        if (x.target && x.target < zero && band.min >= 1) tips.push(`광고센터 목표(${Math.round(x.target * 100)}%)가 제로(${Math.round(zero * 100)}%)보다 낮게 설정돼 있습니다`);
      }
      if (trend) {
        const parts = [];
        if (trend.impressions != null) parts.push(`노출 ${trend.impressions >= 0 ? '+' : ''}${Math.round(trend.impressions * 100)}%`);
        if (trend.profit != null) parts.push(`광고 이익 ${trend.profit >= 0 ? '+' : ''}${Math.round(trend.profit).toLocaleString('ko-KR')}원`);
        if (parts.length) {
          const head = targetChanged ? `목표 ROAS ${Math.round((trend.targetPrev || x.targetFirst) * 100)}% → ${Math.round(x.target * 100)}% 로 바꾼 뒤 ` : '직전 기간 대비 ';
          let verdict = '';
          if (targetChanged) {
            if (trend.profit != null && trend.profit < 0 && trend.impressions != null && trend.impressions < -0.2) verdict = ' → 노출과 이익이 함께 줄어 조정이 지나쳤습니다. 목표를 조금 되돌리세요';
            else if (trend.profit != null && trend.profit >= 0) verdict = ' → 이익이 늘어 조정이 잘 됐습니다. 유지';
            else if (trend.impressions != null && trend.impressions > 0.2 && trend.profit != null && trend.profit < 0) verdict = ' → 노출은 늘었지만 이익이 줄었습니다. 목표를 조금 올리세요';
          } else if (trend.impressions != null && trend.impressions < -0.3 && status !== 'red') verdict = ' → 노출이 크게 줄었습니다. 목표 ROAS 를 낮추거나 예산·입찰을 확인하세요';
          tips.push(head + parts.join(', ') + verdict);
        }
      }
      if (calc?.zero && Math.abs(calc.zero - zero) / zero > 0.25) tips.push(`옵션 마진으로 계산한 제로는 ${Math.round(calc.zero * 100)}% (쓰는 값 ${Math.round(zero * 100)}%) — 차이가 크면 마진·판매가를 확인하세요`);
      if (band.hint) tips.push(band.hint);
    }
    return { ...x, roas, zero, zeroSource: manual ? 'manual' : 'default', calc, profit, prevProfit, trend, targetChanged, mode: modeInfo?.mode || 'normal', modeEnd: modeInfo?.end || '', band, status, note: tips.join(' · ') };
  });
  const order = { red: 0, unknown: 1, green: 2, blue: 3, idle: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || b.spend - a.spend);
  return { dates: adDates, prevDates, rows };
}
