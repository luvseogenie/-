import * as S from './lib/store.js';
import { computeLedger, METRICS } from './lib/ledger.js';
import { normalizeAds, normalizeSales, parseNumber, localIso } from './lib/parse.js';
import { importSalesFile, importAdsFile, dateFromReportName, pasteToRecords } from './lib/importer.js';
import { parseLegacyWorkbook, previewAgainst, applyLegacy, undoImport, removeImportData, listImports } from './lib/legacy.js';
import { barChart, stackedChart, lineChart, sparkline } from './lib/charts.js';
import { updateStatus, reloadIfFilesChanged, checkRemote, ZIP_URL } from './lib/update.js';
import { computeYearTax, monthlyBreakdown, bracketsFor, DEFAULT_TAX_SETTINGS, basicDeduction } from './lib/tax.js';

/* ===== 공통 ===== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmtInt = (v) => Math.round(v || 0).toLocaleString('ko-KR');
const fmtWon = (v) => (v < 0 ? '-' : '') + fmtInt(Math.abs(v || 0));
const fmt = { won: fmtWon, int: fmtInt, ratio: (v) => Math.round((v || 0) * 100) + '%', pct0: (v) => Math.round((v || 0) * 100) + '%', pct1: (v) => ((v || 0) * 100).toFixed(1) + '%', pct2: (v) => ((v || 0) * 100).toFixed(2) + '%' };
const msg = (id, text, cls = '') => { const e = $(id); if (e) { e.textContent = text; e.className = 'msg ' + cls; } };
const today = new Date(); const yday = new Date(today); yday.setDate(today.getDate() - 1);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return localIso(d); };
const download = (name, text, type = 'text/csv') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type })); a.download = name; a.click(); };
const csvEsc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
let DATA = null;
async function reload() { DATA = await S.load(); return DATA; }

/* ===== 기간 ===== */
const range = { start: null, end: null, preset: '30' };
function presetRange(p) {
  const y = localIso(yday);
  if (p === 'yday') return [y, y];
  if (/^\d+$/.test(p)) return [addDays(y, -(Number(p) - 1)), y];   // 최근 N일 (어제까지)
  if (p === 'month') return [y.slice(0, 8) + '01', y];
  if (p === 'prev') { const d = new Date(today.getFullYear(), today.getMonth() - 1, 1); const e = new Date(today.getFullYear(), today.getMonth(), 0); return [localIso(d), localIso(e)]; }
  if (p === 'all') { const ds = S.dates(DATA); return ds.length ? [ds[0], ds[ds.length - 1]] : [y, y]; }
  return [$('#r-start').value || y, $('#r-end').value || y];
}
function setRange(p) {
  range.preset = p; [range.start, range.end] = presetRange(p);
  $('#r-start').value = range.start; $('#r-end').value = range.end;
  $$('#range button').forEach((b) => b.classList.toggle('active', b.dataset.r === p));
  try { localStorage.setItem('cc-range', p); } catch { /* 무시 */ }
  renderCurrent();
}
$$('#range button').forEach((b) => b.onclick = () => setRange(b.dataset.r));
const prevRange = () => { const len = Math.round((new Date(range.end) - new Date(range.start)) / 86400000) + 1; return [addDays(range.start, -len), addDays(range.start, -1)]; };

/* ===== 페이지 전환 ===== */
const TITLES = { tax: '세후 순마진', dash: '대시보드', ledger: '광고 장부', options: '캠페인 · 옵션', ads: '광고 입력', expense: '광고 외 지출', data: '데이터 · 설정' };
let page = 'dash';
function showPage(p) {
  page = TITLES[p] ? p : 'dash';
  $$('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('main section').forEach((s) => s.style.display = s.id === 'page-' + page ? '' : 'none');
  $('#page-title').textContent = TITLES[page];
  $('#range').style.display = (page === 'dash' || page === 'ledger') ? '' : 'none';
  $('#notice').style.display = page === 'dash' ? '' : 'none';
  renderCurrent();
}
$$('.nav button').forEach((b) => b.onclick = () => { location.hash = b.dataset.page; });
window.addEventListener('hashchange', () => showPage(location.hash.slice(1).split('?')[0]));
function renderCurrent() {
  if (page === 'tax') renderTax(); else if (page === 'dash') renderDash(); else if (page === 'expense') renderExpense(); else if (page === 'ledger') renderLedger(); else if (page === 'options') renderOptions(); else if (page === 'ads') loadAds(); else if (page === 'data') { loadSettings(); renderImports(); }
}
async function refreshAll() { await reload(); renderFoot(); renderCurrent(); }
function renderFoot() {
  const ds = S.dates(DATA);
  $('#foot').textContent = ds.length ? `데이터 ${ds[0]} ~ ${ds[ds.length - 1]} · ${ds.length}일 · 캠페인 ${S.campaigns(DATA).length}개` : '아직 데이터가 없습니다';
}

/* ===== 대시보드 ===== */
async function renderDash() {
  await loadCampVis();
  const has = S.dates(DATA).length > 0;
  $('#dash-empty').style.display = has ? 'none' : ''; $('#dash-body').style.display = has ? '' : 'none';
  if (!has) return;
  const led = computeLedger(DATA, range.start, range.end);
  const [ps, pe] = prevRange(); const prev = computeLedger(DATA, ps, pe);
  const g = led.grand, pg = prev.grand;
  const delta = (cur, before, isPct = false) => {
    if (!before) return '<span class="sub">이전 기간 데이터 없음</span>';
    const diff = cur - before; const rel = before ? diff / Math.abs(before) : 0;
    const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
    const txt = isPct ? `${diff > 0 ? '+' : ''}${(diff * 100).toFixed(1)}%p` : `${diff > 0 ? '+' : ''}${fmtWon(diff)} (${(rel * 100).toFixed(0)}%)`;
    return `<span class="${cls}">${txt}</span> vs 이전 ${Math.round((new Date(range.end) - new Date(range.start)) / 86400000) + 1}일`;
  };
  const organicShare = g.revenue ? g.organic_revenue / g.revenue : 0, prevOrganicShare = pg.revenue ? pg.organic_revenue / pg.revenue : 0;
  await loadTaxSettings();
  const at = periodAfterTax(range.start, range.end), pat = periodAfterTax(ps, pe);
  const kpis = [
    { k: '세후 순이익 (종합소득세 반영)', v: fmtWon(at.net) + '원', bad: at.net < 0, d: `세금 ${fmtWon(at.tax)}원 · 실효 ${(at.rate * 100).toFixed(1)}% · ${delta(at.net, pat.net)}`, color: at.net < 0 ? '#d03b3b' : '#1baf7a' },
    { k: '순이익 (광고비 · 광고 외 지출 제외)', v: fmtWon(g.profit_net) + '원', bad: g.profit_net < 0, d: (g.expense ? `광고 외 지출 −${fmtWon(g.expense)}원 · ` : '') + delta(g.profit_net, pg.profit_net), color: g.profit_net < 0 ? '#d03b3b' : '#4a3aa7' },
    { k: '총 매출', v: fmtWon(g.revenue) + '원', d: delta(g.revenue, pg.revenue), color: '#17202a' },
    { k: '자연 매출 (광고 외)', v: fmtWon(g.organic_revenue) + '원', d: `매출의 ${Math.round(organicShare * 100)}% · ${delta(organicShare, prevOrganicShare, true)}`, color: '#1baf7a' },
    { k: '광고비 (부가세 포함)', v: fmtWon(g.spend_vat) + '원', d: delta(g.spend_vat, pg.spend_vat), color: '#eb6834' },
    { k: '광고수익률 (ROAS)', v: Math.round(g.roas * 100) + '%', d: delta(g.roas, pg.roas, true), color: '#2a78d6' },
    { k: '판매 마진', v: fmtWon(g.margin_total) + '원', d: `판매 ${fmtInt(g.actual_qty)}개 · 광고 ${fmtInt(g.ad_orders)} / 자연 ${fmtInt(g.organic_qty)}`, color: '#4a3aa7' },
  ];
  $('#kpis').innerHTML = kpis.map((x) => `<div class="kpi"><div class="k"><span class="dot" style="background:${x.color}"></span>${x.k}</div><div class="v num ${x.bad ? 'bad' : ''}">${x.v}</div><div class="d">${x.d}</div></div>`).join('');

  const dates = led.dates.filter((d) => led.daily[d]);
  const D = (k) => dates.map((d) => led.daily[d][k] || 0);
  barChart($('#ch-profit'), dates, D('profit_net'), { label: '순이익 (지출 차감)' });
  stackedChart($('#ch-rev'), dates, [{ label: '광고 매출', cls: 'ad', color: '#2a78d6', values: D('ad_revenue') }, { label: '자연 매출', cls: 'org', color: '#1baf7a', values: D('organic_revenue') }]);
  lineChart($('#ch-cost'), dates, [{ label: '광고비', cls: 'cost', color: '#eb6834', values: D('spend_vat') }, { label: '광고 매출', cls: 'rev', color: '#2a78d6', values: D('ad_revenue') }]);
  stackedChart($('#ch-qty'), dates, [{ label: '광고 판매', cls: 'ad', color: '#2a78d6', values: D('ad_orders') }, { label: '자연 판매', cls: 'org', color: '#1baf7a', values: D('organic_qty') }]);
  renderCampTable(led);
  const legacyDays = dates.filter((x) => Object.values(led.campaigns).some((c) => c.days[x]?.legacy)).length;
  $('#notice').innerHTML = ''
    + (legacyDays ? `<div class="notice" style="background:var(--accent-soft);border-color:#c7dbf7;color:#1c4f8f">이 기간 중 ${legacyDays}일(${led.legacyCutoff} 까지)은 광고비·판매 수·마진·순이익을 엑셀 4번 시트 확정값으로 씁니다. 총 매출·자연 매출은 판매 리포트 데이터가 있으면 거기서 가져오고, 없는 날은 총 매출 = 광고 매출로 표시됩니다.</div>` : '');
}
let campSort = { key: 'profit', dir: 'desc' };
function renderCampTable(led) {
  const hideZero = $('#camp-hide-zero').checked;
  const cols = [['campaign', '캠페인', 'l'], ['spend_vat', '광고비', 'won'], ['ad_revenue', '광고 매출', 'won'], ['roas', 'ROAS', 'ratio'], ['target_roas', '목표', 'ratio'], ['ad_orders', '광고 판매', 'int'], ['organic_qty', '자연 판매', 'int'], ['revenue', '총 매출', 'won'], ['margin_total', '판매 마진', 'won'], ['profit', '순이익', 'won'], ['trend', '추세', '']];
  let rows = led.campaigns.map((c) => { const t = { ...c.total, campaign: c.campaign, days: c.days }; const lastDay = Object.keys(c.days).sort().pop(); t.target_roas = lastDay ? c.days[lastDay].target_roas : 0; return t; }).filter((t) => t.days && Object.keys(t.days).length);
  if (hideZero) rows = rows.filter((t) => t.spend_vat > 0 || t.ad_orders > 0);
  const hiddenN = rows.filter((t) => visOf(t.campaign) === 'hidden').length;
  if (!$('#camp-show-hidden').checked) rows = rows.filter((t) => visOf(t.campaign) !== 'hidden');
  rows.sort((a, b) => { const k = campSort.key; const va = a[k], vb = b[k]; const r = typeof va === 'string' ? va.localeCompare(vb, 'ko') : (va || 0) - (vb || 0); return campSort.dir === 'asc' ? r : -r; });
  $('#camp-sub').textContent = `${range.start} ~ ${range.end} · ${rows.length}개 캠페인` + (hiddenN && !$('#camp-show-hidden').checked ? ` (숨김 ${hiddenN}개 제외, 합계에는 포함)` : '');
  let h = '<thead><tr>' + cols.map(([k, l, f]) => `<th class="${f === 'l' ? 'l ' : ''}${k !== 'trend' ? 'sort' : ''} ${campSort.key === k ? campSort.dir : ''}" data-k="${k}">${l}</th>`).join('') + '</tr></thead><tbody>';
  for (const t of rows) {
    const roasCls = t.target_roas && t.roas ? (t.roas >= t.target_roas ? 'pos' : 'neg') : '';
    h += `<tr>` + cols.map(([k, , f]) => {
      if (k === 'campaign') return `<td class="l link" data-camp="${esc(t.campaign)}">${esc(t.campaign)}</td>`;
      if (k === 'trend') { const ds = Object.keys(t.days).sort(); return `<td>${sparkline(ds.slice(-30).map((d) => t.days[d].profit), 90, 22, '#4a3aa7')}</td>`; }
      if (k === 'roas') return `<td class="num ${roasCls}">${fmt.ratio(t.roas)}</td>`;
      if (k === 'profit') return `<td class="num ${t.profit < 0 ? 'neg' : 'pos'}">${fmtWon(t.profit)}</td>`;
      return `<td class="num">${fmt[f](t[k])}</td>`;
    }).join('') + '</tr>';
  }
  const g = led.grand;
  h += `</tbody><tfoot><tr><td class="l">합계</td><td class="num">${fmtWon(g.spend_vat)}</td><td class="num">${fmtWon(g.ad_revenue)}</td><td class="num">${fmt.ratio(g.roas)}</td><td></td><td class="num">${fmtInt(g.ad_orders)}</td><td class="num">${fmtInt(g.organic_qty)}</td><td class="num">${fmtWon(g.revenue)}</td><td class="num">${fmtWon(g.margin_total)}</td><td class="num ${g.profit < 0 ? 'neg' : 'pos'}">${fmtWon(g.profit)}</td><td></td></tr></tfoot>`;
  $('#camp-table').innerHTML = h;
  $$('#camp-table th.sort').forEach((th) => th.onclick = () => { const k = th.dataset.k; campSort = { key: k, dir: campSort.key === k && campSort.dir === 'desc' ? 'asc' : 'desc' }; renderCampTable(led); });
  $$('#camp-table td.link').forEach((td) => td.onclick = () => openCampaign(td.dataset.camp, led));
}
$('#camp-hide-zero').onchange = () => renderDash(); $('#camp-show-hidden').onchange = () => renderDash();

/* ===== 캠페인 상세 (드로어) ===== */
function openCampaign(name, led) {
  const c = led.campaigns.find((x) => x.campaign === name); if (!c) return;
  const ds = Object.keys(c.days).sort();
  const cols = [['spend_vat', '광고비'], ['ad_revenue', '광고 매출'], ['roas', 'ROAS'], ['target_roas', '목표'], ['cpc', 'CPC'], ['impressions', '노출'], ['clicks', '클릭'], ['ctr', '클릭률'], ['conversion', '전환율'], ['ad_orders', '광고 판매'], ['organic_qty', '자연 판매'], ['revenue', '총 매출'], ['margin_total', '마진'], ['profit', '순이익']];
  const F = Object.fromEntries(METRICS.map(([k, , f]) => [k, f]));
  let h = `<div class="row"><h2 style="font-size:17px">${esc(name)}</h2><span class="sub">${range.start} ~ ${range.end}</span><span class="grow"></span><button class="btn sm" id="drawer-close">닫기 ✕</button></div>
    <div class="charts" style="margin-top:12px"><div class="card chart-card"><h2>일별 순이익</h2><div class="chart" id="dc-profit" style="height:180px"></div></div><div class="card chart-card"><h2>광고비 · 광고 매출</h2><div class="chart" id="dc-cost" style="height:180px"></div></div></div>
    <div class="tablewrap" style="max-height:52vh"><table><thead><tr><th class="l">날짜</th>${cols.map(([, l]) => `<th>${l}</th>`).join('')}<th class="l">ACTION</th></tr></thead><tbody>`;
  for (const d of ds.slice().reverse()) { const v = c.days[d]; h += `<tr><td class="l">${d}</td>` + cols.map(([k]) => `<td class="num ${k === 'profit' ? (v.profit < 0 ? 'neg' : 'pos') : ''}">${v.has_ads || !['spend_vat', 'ad_revenue', 'roas', 'target_roas', 'cpc', 'impressions', 'clicks', 'ctr', 'conversion', 'ad_orders'].includes(k) ? fmt[F[k] || 'won'](v[k]) : ''}</td>`).join('') + `<td class="l">${esc(v.action)}</td></tr>`; }
  const t = c.total; h += `</tbody><tfoot><tr><td class="l">합계</td>` + cols.map(([k]) => `<td class="num">${k === 'target_roas' ? '' : fmt[F[k] || 'won'](t[k])}</td>`).join('') + '<td></td></tr></tfoot></table></div>';
  $('#drawer').innerHTML = h; $('#drawer').classList.add('open'); $('#backdrop').classList.add('open');
  barChart($('#dc-profit'), ds, ds.map((d) => c.days[d].profit));
  lineChart($('#dc-cost'), ds, [{ label: '광고비', cls: 'cost', color: '#eb6834', values: ds.map((d) => c.days[d].spend_vat) }, { label: '광고 매출', cls: 'rev', color: '#2a78d6', values: ds.map((d) => c.days[d].ad_revenue) }]);
  $('#drawer-close').onclick = closeDrawer;
}
function closeDrawer() { $('#drawer').classList.remove('open'); $('#backdrop').classList.remove('open'); }
$('#backdrop').onclick = closeDrawer;

/* ===== 캠페인 표시 설정 (자동 / 항상 / 숨김) ===== */
let campVis = {}; // { 캠페인: 'always' | 'hidden' } (없으면 자동)
async function loadCampVis() { const r = await chrome.storage.local.get('campaignVisibility'); campVis = r.campaignVisibility || {}; }
async function saveCampVis() { await chrome.storage.local.set({ campaignVisibility: campVis }); }
const visOf = (c) => campVis[c] || 'auto';
function campaignStats() {
  const since = addDays(localIso(yday), -29); const last = {}, spend30 = {};
  for (const [date, day] of Object.entries(DATA.ads)) for (const [c, a] of Object.entries(day)) { if (a.spend > 0 && (!last[c] || date > last[c])) last[c] = date; if (date >= since) spend30[c] = (spend30[c] || 0) + (a.spend || 0); }
  for (const [date, day] of Object.entries(DATA.legacy || {})) for (const [c, L] of Object.entries(day)) { if (L.spend_vat > 0 && (!last[c] || date > last[c])) last[c] = date; if (date >= since) spend30[c] = (spend30[c] || 0) + (L.spend || 0); }
  return { last, spend30 };
}
function renderVisPanel() {
  const camps = S.campaigns(DATA); const { last, spend30 } = campaignStats(); const q = ($('#vis-search').value || '').toLowerCase();
  const n = { always: 0, hidden: 0 }; camps.forEach((c) => { if (campVis[c]) n[campVis[c]]++; });
  $('#vis-summary').textContent = `전체 ${camps.length}개 · 항상 ${n.always}개 · 숨김 ${n.hidden}개`;
  const tb = $('#vis-table tbody'); tb.innerHTML = '';
  for (const c of camps) {
    if (q && !c.toLowerCase().includes(q)) continue;
    const tr = document.createElement('tr'); const v = visOf(c);
    tr.innerHTML = `<td class="l">${esc(c)}</td><td class="num sub">${last[c] || '-'}</td><td class="num">${fmtWon(spend30[c] || 0)}</td><td class="l">` +
      ['auto', 'always', 'hidden'].map((m) => `<label class="chk" style="margin-right:8px"><input type="radio" name="vis-${esc(c)}" value="${m}" ${v === m ? 'checked' : ''}> ${m === 'auto' ? '자동' : m === 'always' ? '항상' : '숨김'}</label>`).join('') + '</td>';
    if (v === 'hidden') tr.style.opacity = '.55';
    tr.querySelectorAll('input[type=radio]').forEach((r) => r.onchange = async () => { if (r.value === 'auto') delete campVis[c]; else campVis[c] = r.value; await saveCampVis(); renderVisPanel(); renderLedgerTable(); });
    tb.appendChild(tr);
  }
}
$('#vis-toggle').onclick = () => { const e = $('#vis-panel'); e.style.display = e.style.display === 'none' ? '' : 'none'; if (e.style.display !== 'none') renderVisPanel(); };
$('#vis-search').oninput = () => renderVisPanel();
$('#vis-reset').onclick = async () => { if (confirm('모든 캠페인을 자동 표시로 되돌릴까요?')) { campVis = {}; await saveCampVis(); renderVisPanel(); renderLedgerTable(); } };
$('#vis-hide-old').onclick = async () => { const { spend30 } = campaignStats(); let k = 0; for (const c of S.campaigns(DATA)) if (!(spend30[c] > 0) && campVis[c] !== 'always') { campVis[c] = 'hidden'; k++; } await saveCampVis(); renderVisPanel(); renderLedgerTable(); msg('#lg-warn', ''); alert(`${k}개 캠페인을 숨겼습니다.`); };
$('#lg-show-hidden').onchange = () => renderLedgerTable();
$('#lg-camp').onchange = () => renderLedgerTable();
function stepCamp(n) { const sel = $('#lg-camp'); const i = sel.selectedIndex + n; if (i >= 0 && i < sel.options.length) { sel.selectedIndex = i; renderLedgerTable(); } }
$('#lg-camp-prev').onclick = () => stepCamp(-1); $('#lg-camp-next').onclick = () => stepCamp(1);

/* ===== 광고 장부 (피벗) ===== */
const DEFAULT_METRICS = ['target_roas', 'roas', 'spend_vat', 'cpc', 'ad_orders', 'actual_qty', 'organic_qty', 'margin_total', 'profit'];
let shownMetrics = new Set(DEFAULT_METRICS);
try { const saved = JSON.parse(localStorage.getItem('cc-metrics') || 'null'); if (Array.isArray(saved) && saved.length) shownMetrics = new Set(saved); } catch { /* 무시 */ }
function renderMetricPicker() {
  $('#metric-picker').innerHTML = METRICS.map(([k, l]) => `<label class="chk"><input type="checkbox" data-m="${k}" ${shownMetrics.has(k) ? 'checked' : ''}> ${l}</label>`).join('') + `<button class="btn sm" id="metric-all">전체</button><button class="btn sm" id="metric-basic">기본</button>`;
  $$('#metric-picker input').forEach((i) => i.onchange = () => { if (i.checked) shownMetrics.add(i.dataset.m); else shownMetrics.delete(i.dataset.m); try { localStorage.setItem('cc-metrics', JSON.stringify([...shownMetrics])); } catch { /* 무시 */ } renderLedgerTable(); });
  $('#metric-all').onclick = () => { shownMetrics = new Set(METRICS.map(([k]) => k)); renderMetricPicker(); renderLedgerTable(); };
  $('#metric-basic').onclick = () => { shownMetrics = new Set(DEFAULT_METRICS); renderMetricPicker(); renderLedgerTable(); };
}
let ledgerCache = null;
async function renderLedger() { renderMetricPicker(); await loadCampVis(); ledgerCache = computeLedger(DATA, range.start, range.end); renderVisPanel(); renderLedgerTable(); }
function renderLedgerTable() {
  const led = ledgerCache; if (!led) return;
  const hideEmpty = $('#lg-hide-empty').checked, showAction = $('#lg-action').checked;
  const has = new Set(); led.campaigns.forEach((c) => Object.keys(c.days).forEach((d) => has.add(d)));
  let dates = led.dates.filter((d) => !hideEmpty || has.has(d));
  let warn = '';
  if (dates.length > 124) { warn = `<div class="notice">기간이 ${dates.length}일이라 최근 124일만 표시합니다. 더 긴 기간은 위의 기간을 나누어 보거나 CSV 로 내보내세요.</div>`; dates = dates.slice(-124); }
  $('#lg-warn').innerHTML = warn;
  const cols = []; let m = null;
  dates.forEach((d) => { const mk = d.slice(0, 7); if (m && mk !== m) cols.push({ sum: m }); cols.push({ date: d }); m = mk; });
  if (m) cols.push({ sum: m });
  const metrics = led.metrics.filter((x) => shownMetrics.has(x.key));
  let h = '<thead><tr><th class="camp">캠페인</th><th class="lbl">항목</th>' + cols.map((c) => c.date ? `<th>${c.date.slice(5).replace('-', '/')}</th>` : `<th class="sum">${parseInt(c.sum.slice(5))}월 합계</th>`).join('') + (showAction ? '<th class="l">ACTION</th>' : '') + '</tr></thead><tbody>';
  h += '<tr><td class="camp" rowspan="3">전체</td><td class="lbl"><b>전체 순이익 (광고비 제외)</b></td>' + cols.map((c) => { const v = c.date ? led.total_profit[c.date] : led.month_profit[c.sum]; return `<td class="total num ${v < 0 ? 'neg' : ''}">${v == null ? '' : fmtWon(v)}</td>`; }).join('') + (showAction ? '<td></td>' : '') + '</tr>';
  h += '<tr><td class="lbl">광고 외 지출</td>' + cols.map((c) => { const v = c.date ? led.expense_by_day[c.date] : led.month_expense[c.sum]; return `<td class="total num">${v ? '−' + fmtWon(v) : ''}</td>`; }).join('') + (showAction ? '<td></td>' : '') + '</tr>';
  h += '<tr><td class="lbl"><b>지출 차감 순이익</b></td>' + cols.map((c) => { const v = c.date ? (led.daily[c.date]?.profit_net) : led.month_profit_net[c.sum]; return `<td class="total num ${v < 0 ? 'neg' : ''}">${v == null ? '' : fmtWon(v)}</td>`; }).join('') + (showAction ? '<td></td>' : '') + '</tr>';
  const adsOnly = new Set(['target_roas', 'roas', 'budget', 'spend_vat', 'cpc', 'impressions', 'ctr', 'conversion', 'ad_orders', 'ad_revenue']);
  const showHidden = $('#lg-show-hidden').checked;
  const allCamps = S.campaigns(DATA); const byName = Object.fromEntries(led.campaigns.map((c) => [c.campaign, c]));
  // 캠페인 선택 목록 (표시되는 캠페인만)
  const visibleCamps = allCamps.filter((name) => { const v = visOf(name); if (v === 'hidden' && !showHidden) return false; const c = byName[name]; return v === 'always' || (c && Object.keys(c.days).some((d) => dates.includes(d))); });
  const sel = $('#lg-camp'); const cur = sel.value;
  sel.innerHTML = '<option value="">전체 (모든 캠페인)</option>' + visibleCamps.map((n) => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('');
  if (cur && !visibleCamps.includes(cur)) sel.value = '';
  const only = sel.value;
  if (led.legacyCutoff && led.start <= led.legacyCutoff) $('#lg-warn').innerHTML += `<div class="notice" style="background:var(--accent-soft);border-color:#c7dbf7;color:#1c4f8f">${led.legacyCutoff} 까지는 광고비·판매 수·마진·순이익을 엑셀 4번 시트 확정값으로 씁니다 (매출은 판매 리포트에서).</div>`;
  for (const name of allCamps) {
    const v = visOf(name); const c = byName[name] || { campaign: name, days: {}, months: {} };
    if (only && name !== only) continue;
    if (v === 'hidden' && !showHidden) continue;
    const hasData = Object.keys(c.days).some((d) => dates.includes(d));
    if (v !== 'always' && !hasData) continue;
    metrics.forEach((mt, i) => {
      const isProfit = mt.key === 'profit';
      h += `<tr class="${isProfit ? 'profit' : ''}">` + (i === 0 ? `<td class="camp" rowspan="${metrics.length}">${esc(c.campaign)}${v === 'always' ? ' <span class="pill gray">항상</span>' : v === 'hidden' ? ' <span class="pill warn">숨김</span>' : ''}<div><a href="#" class="sub" data-vis="${esc(name)}">${v === 'hidden' ? '다시 보기' : '숨기기'}</a></div></td>` : '') + `<td class="lbl">${mt.label}</td>`;
      for (const col of cols) {
        const cell = col.date ? c.days[col.date] : c.months[col.sum];
        let cls = col.sum ? 'sum ' : '';
        if (!cell || (col.sum && mt.key === 'target_roas')) { h += `<td class="${cls}"></td>`; continue; }
        const v = cell[mt.key];
        if (isProfit) cls += v < 0 ? 'neg' : 'pos';
        if (col.date && cell.unmapped_qty > 0 && (mt.key === 'margin_total' || isProfit)) cls += ' flag';
        const blank = adsOnly.has(mt.key) && (col.date ? !cell.has_ads : !cell.spend && !cell.impressions);
        h += `<td class="${cls} num">${blank ? '' : fmt[mt.fmt](v)}</td>`;
      }
      if (showAction) h += i === 0 ? `<td class="l" rowspan="${metrics.length}" style="white-space:normal;max-width:260px;color:var(--text-2)">${Object.entries(c.days).filter(([, v]) => v.action).map(([d, v]) => `${d.slice(5)}: ${esc(v.action)}`).join('<br>')}</td>` : '';
      h += '</tr>';
    });
  }
  $('#lg-table').innerHTML = h + '</tbody>';
  $$('#lg-table a[data-vis]').forEach((a) => a.onclick = async (ev) => { ev.preventDefault(); const c = a.dataset.vis; if (visOf(c) === 'hidden') delete campVis[c]; else campVis[c] = 'hidden'; await saveCampVis(); renderVisPanel(); renderLedgerTable(); });
}
$('#lg-hide-empty').onchange = renderLedgerTable; $('#lg-action').onchange = renderLedgerTable;
$('#lg-csv').onclick = () => {
  const led = ledgerCache; if (!led) return;
  const lines = [['캠페인', '항목', ...led.dates].map(csvEsc).join(',')];
  for (const c of led.campaigns) for (const mt of led.metrics) lines.push([c.campaign, mt.label, ...led.dates.map((d) => c.days[d] ? Math.round(c.days[d][mt.key] * 10000) / 10000 : '')].map(csvEsc).join(','));
  lines.push(['전체', '순이익', ...led.dates.map((d) => Math.round((led.total_profit[d] || 0) * 100) / 100)].join(','));
  download(`광고장부_${led.start}_${led.end}.csv`, lines.join('\n'));
};

/* ===== 캠페인 · 옵션 ===== */
$('#opt-search').oninput = () => renderOptions(); $('#opt-filter').onchange = () => renderOptions();
$('#opt-new-toggle').onclick = () => { $('#new-option').style.display = 'flex'; $('#no-id').focus(); };
$('#opt-new-save').onclick = async () => {
  const id = $('#no-id').value.trim(); if (!id) { msg('#opt-msg', '옵션ID 를 넣어 주세요', 'err'); return; }
  const d = await reload(); S.upsertOption(d, { option_id: id, product_name: $('#no-name').value, campaign: $('#no-camp').value });
  if ($('#no-margin').value !== '') S.setMargin(d, id, parseNumber($('#no-margin').value) || 0, '');
  await S.save(d); ['#no-id', '#no-name', '#no-camp', '#no-margin'].forEach((s) => $(s).value = ''); msg('#opt-msg', '추가됨', 'ok'); refreshAll();
};
function suggestions() {
  // 같은 상품(판매 리포트의 상품명)의 다른 옵션이 캠페인에 연결돼 있으면 그 캠페인을 제안
  const d = DATA; const prod = S.productNames(d); const byProd = {};
  for (const o of d.options) (byProd[prod[o.option_id] || ''] ||= []).push(o);
  const sug = {}; const groups = {};
  for (const [pn, list] of Object.entries(byProd)) {
    const camps = {}; for (const o of list) if (o.campaign) camps[o.campaign] = (camps[o.campaign] || 0) + 1;
    const best = Object.entries(camps).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const margins = new Set(list.filter((o) => o.campaign).map((o) => S.marginLookup(d)(o.option_id, localIso(today))).filter((m) => m > 0));
    groups[pn] = { options: list, campaign: best, margin: margins.size === 1 ? [...margins][0] : null, mapped: list.filter((o) => o.campaign).length };
    if (best) for (const o of list) if (!o.campaign) sug[o.option_id] = best;
  }
  return { sug, groups, prod };
}
function renderOptions() {
  const d = DATA;
  renderUnlisted();
  const lookup = S.marginLookup(d); const todayIso = localIso(today);
  const since = addDays(localIso(yday), -29); const soldRecently = new Set(); const soldQty = {};
  for (const [date, day] of Object.entries(d.sales)) for (const r of Object.values(day)) { if (date >= since && r.quantity > 0) { soldRecently.add(r.option_id); soldQty[r.option_id] = (soldQty[r.option_id] || 0) + r.quantity; } }
  const q = $('#opt-search').value.trim().toLowerCase(); const f = $('#opt-filter').value; const grouped = $('#opt-group').checked;
  const camps = S.campaigns(d); const { sug, groups, prod } = suggestions();
  const pass = (o) => {
    const hist = S.marginHistory(d, o.option_id);
    if (f === 'mapped' && !o.campaign) return false; if (f === 'unmapped' && o.campaign) return false;
    if (f === 'nomargin' && hist.length) return false; if (f === 'sold30' && !soldRecently.has(o.option_id)) return false;
    if (f === 'suggest' && !sug[o.option_id]) return false;
    return !q || `${o.option_id} ${o.product_name} ${o.campaign} ${prod[o.option_id] || ''}`.toLowerCase().includes(q);
  };
  const list = S.sortedOptions(d).filter(pass);
  const nSug = Object.keys(sug).length;
  $('#opt-count').textContent = `${list.length}개 표시 / 전체 ${d.options.length}개 · 캠페인 없음 ${d.options.filter((o) => !o.campaign).length}개 · 제안 ${nSug}개`;
  $('#opt-apply-suggest').style.display = nSug ? '' : 'none';
  if (!document.getElementById('camp-list')) $('#options-table').insertAdjacentHTML('beforebegin', `<datalist id="camp-list"></datalist>`);
  document.getElementById('camp-list').innerHTML = camps.map((c) => `<option value="${esc(c)}">`).join('');
  const tb = $('#options-table tbody'); tb.innerHTML = '';
  const rowFor = (o) => {
    const hist = S.marginHistory(d, o.option_id); const sg = sug[o.option_id];
    const tr = document.createElement('tr'); if (o.campaign && !hist.length) tr.className = 'warnrow';
    tr.innerHTML = `<td class="l num">${esc(o.option_id)}${soldQty[o.option_id] ? `<div class="sub">최근30일 ${fmtInt(soldQty[o.option_id])}개</div>` : ''}</td>
      <td class="l"><input class="wide" data-k="product_name" value="${esc(o.product_name)}"></td>
      <td class="l"><input data-k="campaign" list="camp-list" value="${esc(o.campaign)}" placeholder="${sg ? '제안: ' + esc(sg) : '(광고 안 함)'}" ${!o.campaign ? 'style="border-color:' + (sg ? 'var(--accent)' : '#dc2626') + '"' : ''}>${sg ? `<div><a href="#" class="sub" data-sug="${esc(o.option_id)}">같은 상품처럼 ${esc(sg)} 적용</a></div>` : ''}</td>
      <td class="num">${fmtInt(lookup(o.option_id, todayIso))}</td>
      <td class="l"><ul class="hist">${hist.map((m) => `<li><code>${m.effective_from || '처음부터'}</code>${fmtInt(m.margin)}원 ${m.note ? '<span class="sub">' + esc(m.note) + '</span>' : ''}<a href="#" class="sub" data-del="${m.effective_from}">삭제</a></li>`).join('') || '<li class="sub">없음 (0원으로 계산)</li>'}</ul></td>
      <td class="l change"><div class="row"><input type="number" class="tiny" data-k="margin" placeholder="새 마진"><input type="date" data-k="effective_from" value="${hist.length ? todayIso : ''}"><input class="short" data-k="note" placeholder="사유"></div><div class="sub">${hist.length ? '시작일부터 새 마진 적용 (이전 날짜는 그대로)' : '첫 마진은 시작일을 비우면 처음부터 적용'}</div></td>
      <td class="actions"><button class="btn primary sm">저장</button> <button class="btn danger sm">삭제</button></td>`;
    const [save, del] = tr.querySelectorAll('button');
    save.onclick = async () => {
      const g = (k) => tr.querySelector(`[data-k=${k}]`).value;
      const dd = await reload(); S.upsertOption(dd, { option_id: o.option_id, product_name: g('product_name'), campaign: g('campaign') });
      if (g('margin') !== '') S.setMargin(dd, o.option_id, parseNumber(g('margin')) || 0, g('effective_from') || '', g('note'));
      await S.save(dd); msg('#opt-msg', `${o.option_id} 저장됨`, 'ok'); await reload(); renderOptions(); renderFoot();
    };
    del.onclick = async () => { if (confirm(`옵션 ${o.option_id} 를 목록에서 삭제할까요? (마진 이력도 삭제)`)) { const dd = await reload(); S.deleteOption(dd, o.option_id); await S.save(dd); refreshAll(); } };
    tr.querySelectorAll('a[data-del]').forEach((a) => a.onclick = async (ev) => { ev.preventDefault(); if (confirm('이 마진 이력을 삭제할까요?')) { const dd = await reload(); S.deleteMargin(dd, o.option_id, a.dataset.del); await S.save(dd); await reload(); renderOptions(); } });
    tr.querySelectorAll('a[data-sug]').forEach((a) => a.onclick = async (ev) => { ev.preventDefault(); const dd = await reload(); const oo = dd.options.find((x) => x.option_id === a.dataset.sug); S.upsertOption(dd, { ...oo, campaign: sug[oo.option_id] }); await S.save(dd); await reload(); renderOptions(); });
    return tr;
  };
  let shown = 0;
  if (grouped) {
    const order = []; const seen = new Set();
    for (const o of list) { const pn = prod[o.option_id] || ''; if (!seen.has(pn)) { seen.add(pn); order.push(pn); } }
    for (const pn of order) {
      const g = groups[pn]; const members = list.filter((o) => (prod[o.option_id] || '') === pn);
      const hdr = document.createElement('tr'); hdr.className = 'grp';
      hdr.innerHTML = `<td colspan="7" class="l"><div class="row"><b>${esc(pn || '(상품명 없음)')}</b><span class="sub">옵션 ${g.options.length}개 · 캠페인 연결 ${g.mapped}개${g.campaign ? ' · ' + esc(g.campaign) : ''}</span><span class="grow"></span>
        <input class="short" data-gk="campaign" list="camp-list" value="${esc(g.campaign)}" placeholder="캠페인" style="width:200px"><input type="number" class="tiny" data-gk="margin" value="${g.margin ?? ''}" placeholder="마진(선택)"><button class="btn sm" data-gapply="1">이 상품의 캠페인 없는 옵션 모두에 적용</button></div></td>`;
      hdr.querySelector('[data-gapply]').onclick = async () => {
        const camp = hdr.querySelector('[data-gk=campaign]').value.trim(); const mg = parseNumber(hdr.querySelector('[data-gk=margin]').value);
        if (!camp) { msg('#opt-msg', '캠페인 이름을 넣어 주세요', 'err'); return; }
        const dd = await reload(); let k = 0;
        for (const o of g.options) { const oo = dd.options.find((x) => x.option_id === o.option_id); if (oo && !oo.campaign) { S.upsertOption(dd, { ...oo, campaign: camp }); if (mg && !S.marginHistory(dd, o.option_id).length) S.setMargin(dd, o.option_id, mg, ''); k++; } }
        await S.save(dd); msg('#opt-msg', `${k}개 옵션에 ${camp} 적용`, 'ok'); await reload(); renderOptions(); renderFoot();
      };
      tb.appendChild(hdr);
      for (const o of members) { if (shown++ >= 400) break; tb.appendChild(rowFor(o)); }
      if (shown >= 400) break;
    }
  } else {
    for (const o of list.slice(0, 400)) { tb.appendChild(rowFor(o)); shown++; }
  }
  if (list.length > 400) tb.insertAdjacentHTML('beforeend', `<tr><td colspan="7" class="sub">400개까지만 표시합니다. 검색이나 필터로 줄여 주세요.</td></tr>`);
}
$('#opt-group').onchange = () => renderOptions();
function renderUnlisted() {
  const days = Number($('#unlisted-days').value || 30); const since = addDays(localIso(yday), -(days - 1));
  const list = S.unlistedSoldOptions(DATA, since); const q = ($('#unlisted-search').value || '').toLowerCase();
  $('#unlisted-count').textContent = `— 최근 ${days}일에 팔렸지만 목록에 없는 옵션 ${list.length}개`;
  const tb = $('#unlisted-table tbody'); tb.innerHTML = '';
  for (const u of list.filter((x) => !q || `${x.option_id} ${x.option_name} ${x.product}`.toLowerCase().includes(q)).slice(0, 300)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="l num">${esc(u.option_id)}</td><td class="l">${esc(u.option_name)}</td><td class="l sub">${esc(u.product)}</td><td class="num">${fmtInt(u.qty)}</td><td class="num">${fmtWon(u.revenue)}</td><td class="num sub">${u.last}</td><td><button class="btn sm">추가</button> <button class="btn sm" title="같은 상품명의 옵션 전부">상품 전체 추가</button></td>`;
    const [one, all] = tr.querySelectorAll('button');
    one.onclick = async () => { const dd = await reload(); S.upsertOption(dd, { option_id: u.option_id, product_name: u.option_name, product: u.product, source: 'manual' }); await S.save(dd); await reload(); renderOptions(); };
    all.onclick = async () => { const dd = await reload(); let k = 0; for (const x of list) if (x.product === u.product) { S.upsertOption(dd, { option_id: x.option_id, product_name: x.option_name, product: x.product, source: 'manual' }); k++; } await S.save(dd); await reload(); renderOptions(); msg('#opt-msg', `${k}개 옵션 추가`, 'ok'); };
    tb.appendChild(tr);
  }
}
$('#unlisted-days').onchange = renderUnlisted; $('#unlisted-search').oninput = renderUnlisted;
// 정리: 마진 이력이 없고 직접 추가한 것도 아닌 옵션(= 예전 버전이 판매 리포트에서 자동 등록한 것)을 목록에서 뺀다. 되돌릴 수 있게 보관.
function autoAddedOptions(d) { return d.options.filter((o) => !S.marginHistory(d, o.option_id).length && o.source !== 'manual' && o.source !== 'excel'); }
$('#opt-cleanup').onclick = async () => {
  const dd = await reload(); const victims = autoAddedOptions(dd);
  if (!victims.length) { msg('#opt-msg', '정리할 옵션이 없습니다.', 'ok'); return; }
  if (!confirm(`마진이 없고 엑셀·직접 추가가 아닌 옵션 ${victims.length}개를 목록에서 뺄까요? (판매 데이터는 그대로이고, 캠페인 연결만 사라져 '(캠페인 없음)'으로 집계됩니다. 데이터 · 설정의 백업에서 되돌릴 수 있습니다)`)) return;
  const ids = new Set(victims.map((o) => o.option_id)); dd.removedOptions = [...(dd.removedOptions || []), ...victims]; dd.options = dd.options.filter((o) => !ids.has(o.option_id)); await S.save(dd);
  msg('#opt-msg', `${victims.length}개 옵션을 목록에서 뺐습니다.`, 'ok'); await reload(); renderOptions(); renderFoot();
};
// 업데이트 후 한 번: 예전 버전이 자동 등록한 옵션을 정리한다
async function migrateAutoOptions() {
  const { migratedAutoOptions } = await chrome.storage.local.get('migratedAutoOptions'); if (migratedAutoOptions) return;
  const dd = await reload(); const victims = autoAddedOptions(dd);
  if (victims.length) { const ids = new Set(victims.map((o) => o.option_id)); dd.removedOptions = [...(dd.removedOptions || []), ...victims]; dd.options = dd.options.filter((o) => !ids.has(o.option_id)); await S.save(dd); await reload(); }
  await chrome.storage.local.set({ migratedAutoOptions: true });
}
$('#opt-apply-suggest').onclick = async () => {
  const { sug } = suggestions(); const n = Object.keys(sug).length; if (!n) return;
  if (!confirm(`캠페인이 없는 옵션 ${n}개를 같은 상품의 다른 옵션과 같은 캠페인으로 연결할까요? (마진은 옵션마다 다를 수 있어 넣지 않습니다)`)) return;
  const dd = await reload(); for (const [id, camp] of Object.entries(sug)) { const oo = dd.options.find((x) => x.option_id === id); if (oo) S.upsertOption(dd, { ...oo, campaign: camp }); }
  await S.save(dd); msg('#opt-msg', `${n}개 옵션 연결됨. 마진이 없는 옵션은 노란 줄로 표시됩니다.`, 'ok'); await reload(); renderOptions(); renderFoot();
};

/* ===== 광고 입력 ===== */
const ADS_FIELDS = ['target_roas', 'budget', 'spend', 'ad_revenue', 'conversion', 'ctr', 'impressions', 'clicks', 'ad_orders'];
const ADS_HEAD = { campaign: '캠페인 이름', target_roas: '목표효율', budget: '광고예산', spend: '집행 광고비', ad_revenue: '광고전환 매출', conversion: '전환율', ctr: '클릭률', impressions: '노출수', clicks: '클릭수', ad_orders: '광고전환 판매수', action: 'ACTION' };
$('#ads-date').onchange = loadAds; $('#ads-prev').onclick = () => shiftAdsDate(-1); $('#ads-next').onclick = () => shiftAdsDate(1);
$('#ads-add').onclick = () => addAdsRow(); $('#ads-save').onclick = saveAds;
function shiftAdsDate(n) { $('#ads-date').value = addDays($('#ads-date').value, n); loadAds(); }
function loadAds() {
  if (!$('#ads-date').value) $('#ads-date').value = localIso(yday);
  const d = DATA; const date = $('#ads-date').value; const rows = d.ads[date] || {};
  const names = Object.keys(rows); for (const c of S.campaigns(d)) if (!names.includes(c) && Object.values(d.ads).slice(-14).some((day) => day[c])) names.push(c);
  $('#ads-table tbody').innerHTML = ''; names.forEach((c) => addAdsRow(c, rows[c])); msg('#ads-msg', names.length ? '' : '이 날짜에 저장된 광고 데이터가 없습니다. 행을 추가해 입력할 수 있습니다.');
}
function addAdsRow(campaign = '', row = null) {
  const tr = document.createElement('tr');
  const disp = { target_roas: (v) => v ? Math.round(v * 100) + '%' : '', conversion: (v) => v ? (v * 100).toFixed(2) + '%' : '', ctr: (v) => v ? (v * 100).toFixed(2) + '%' : '' };
  const num = (v) => v == null || v === '' ? '' : Math.round(v * 100) / 100;
  tr.innerHTML = `<td class="l"><input class="wide" data-k="campaign" value="${esc(campaign)}" placeholder="캠페인 이름"></td>` + ADS_FIELDS.map((k) => `<td><input data-k="${k}" value="${row ? (disp[k] ? disp[k](row[k]) : num(row[k])) : ''}"></td>`).join('') + `<td class="l"><input class="wide" data-k="action" value="${row ? esc(row.action) : ''}"></td><td><button class="btn danger sm">삭제</button></td>`;
  tr.querySelector('button').onclick = async () => { const name = tr.querySelector('[data-k=campaign]').value; if (row && name && confirm(`${$('#ads-date').value} ${name} 광고 데이터를 삭제할까요?`)) { const d = await reload(); S.deleteAds(d, $('#ads-date').value, name); await S.save(d); } tr.remove(); };
  $('#ads-table tbody').appendChild(tr);
}
async function saveAds() {
  const recs = [...$('#ads-table tbody').rows].map((tr) => { const o = {}; tr.querySelectorAll('input').forEach((i) => o[ADS_HEAD[i.dataset.k]] = i.value); return o; });
  const rows = normalizeAds(recs, $('#ads-date').value, true);
  const d = await reload(); const n = S.upsertAds(d, rows); await S.save(d); msg('#ads-msg', `${n}개 캠페인 저장됨`, 'ok'); renderFoot();
}
$('#paste-date').value = localIso(yday);
$('#paste-go').onclick = async () => {
  const kind = document.querySelector('input[name=paste-kind]:checked').value; const date = $('#paste-date').value || localIso(yday);
  const recs = pasteToRecords($('#paste-text').value, kind === 'ads' ? ['캠페인'] : ['옵션', '매출']);
  if (!recs.length) { msg('#paste-msg', '머리글 줄을 찾지 못했습니다. 캠페인 이름/광고비 같은 머리글부터 복사해 주세요.', 'err'); return; }
  const rows = kind === 'ads' ? normalizeAds(recs, date) : normalizeSales(recs, date);
  if (!rows.length) { msg('#paste-msg', `표는 읽었지만 인식된 행이 없습니다 (머리글: ${Object.keys(recs[0]).join(', ')})`, 'err'); return; }
  const d = await reload(); const n = kind === 'ads' ? S.upsertAds(d, rows) : S.upsertSales(d, rows); await S.save(d);
  msg('#paste-msg', `${date} ${kind === 'ads' ? '광고' : '판매'} ${n}건 저장`, 'ok'); refreshAll();
};

/* ===== 데이터 · 설정 ===== */
let pendingFiles = [];
$('#import-date').value = localIso(yday);
$('#import-sales').onchange = (ev) => {
  pendingFiles = [...ev.target.files]; ev.target.value = ''; if (!pendingFiles.length) return;
  const base = $('#import-date').value || localIso(yday);
  $('#import-rows').innerHTML = pendingFiles.map((f, i) => `<tr><td class="l">${esc(f.name)}</td><td class="l"><input type="date" data-i="${i}" value="${dateFromReportName(f.name) || base}"></td><td class="l sub" data-res="${i}"></td></tr>`).join('');
  $('#import-list').style.display = 'block'; msg('#import-msg', '');
};
$('#import-clear').onclick = () => { pendingFiles = []; $('#import-list').style.display = 'none'; };
$('#import-go').onclick = async () => {
  let bad = 0;
  for (let i = 0; i < pendingFiles.length; i++) {
    const f = pendingFiles[i]; const date = $(`#import-rows input[data-i="${i}"]`).value; const cell = $(`#import-rows [data-res="${i}"]`);
    try { const r = await importSalesFile(await f.arrayBuffer(), f.name, date); cell.textContent = `${r.date} 판매 ${r.saved}건 저장` + (r.unmapped ? ` (캠페인 없는 옵션 ${r.unmapped}개)` : ''); cell.style.color = 'var(--good)'; }
    catch (e) { cell.textContent = e.message; cell.style.color = 'var(--bad)'; bad++; }
  }
  msg('#import-msg', bad ? `${pendingFiles.length - bad}개 저장, ${bad}개 실패` : `${pendingFiles.length}개 파일 저장 완료`, bad ? 'err' : 'ok'); await reload(); renderFoot();
};
$('#import-ads').onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try { const r = await importAdsFile(await f.arrayBuffer(), f.name, $('#import-date').value || null); msg('#import-msg', `${f.name} → ${r.date} 광고 ${r.saved}건 저장`, 'ok'); } catch (e) { msg('#import-msg', e.message, 'err'); }
  ev.target.value = ''; await reload(); renderFoot();
};
let legacyParsed = null;
$('#import-legacy').onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return; msg('#legacy-msg', '엑셀을 읽는 중… (큰 파일은 10초 정도 걸립니다)'); $('#legacy-preview').style.display = 'none';
  try {
    legacyParsed = await parseLegacyWorkbook(await f.arrayBuffer(), f.name);
    const pv = previewAgainst(DATA, legacyParsed);
    $('#legacy-summary').innerHTML = `파일: <b>${esc(f.name)}</b><br>기간 <b>${legacyParsed.from} ~ ${legacyParsed.to}</b> (${legacyParsed.dates.length}일) · 캠페인 ${legacyParsed.campaigns.length}개 · 캠페인×날짜 ${fmtInt(legacyParsed.cells)}칸<br>`
      + (pv.overlapDays ? `이미 엑셀에서 가져온 날짜 ${pv.overlapDays}일은 덮어씁니다.<br>` : '')
      + (pv.dailyDays ? `확장 프로그램으로 저장한 날짜 ${pv.dailyDays}일은 그 데이터가 우선이고, 엑셀 값은 비어 있는 쪽만 채웁니다.<br>` : '')
      + `3번 시트(실제 판매): <b>${fmtInt(pv.salesRows)}행</b> 전부 저장${legacyParsed.salesFrom ? ` (${legacyParsed.salesFrom} ~ ${legacyParsed.salesTo})` : ''}${pv.salesOverwrite ? ` · 이미 있는 ${fmtInt(pv.salesOverwrite)}행은 덮어씀` : ''}<br>`
      + `1번 시트: 옵션 ${legacyParsed.mapping.length}개 (새 옵션 ${pv.newOptions}개) · 마진은 <b>${legacyParsed.marginFrom}</b>부터 적용`;
    $('#legacy-preview').style.display = 'block'; msg('#legacy-msg', '내용을 확인하고 적용을 누르세요.');
  } catch (e) { msg('#legacy-msg', e.message, 'err'); legacyParsed = null; }
  ev.target.value = '';
};
$('#legacy-cancel').onclick = () => { legacyParsed = null; $('#legacy-preview').style.display = 'none'; msg('#legacy-msg', ''); };
$('#legacy-apply').onclick = async () => {
  if (!legacyParsed) return; msg('#legacy-msg', '적용 중…');
  try { const r = await applyLegacy(legacyParsed, { withMapping: $('#legacy-with-mapping').checked }); msg('#legacy-msg', `적용됨: 장부 ${r.from} ~ ${r.to} ${fmtInt(r.cells)}칸 · 판매 ${fmtInt(r.salesSaved)}행` + (r.mappedOptions ? ` · 옵션 ${r.mappedOptions}개, 마진 ${r.mappedMargins}개` : '') + '. 대시보드에서 확인하세요. 잘못됐으면 아래 기록에서 되돌리기.', 'ok'); }
  catch (e) { msg('#legacy-msg', e.message, 'err'); }
  legacyParsed = null; $('#legacy-preview').style.display = 'none'; await reload(); renderFoot(); renderImports();
};
async function renderImports() {
  const list = await listImports(); const box = $('#legacy-history');
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<b class="sub">가져오기 기록</b>' + list.map((i) => `<div class="row" style="margin-top:6px;padding:8px 10px;border:1px solid var(--line);border-radius:8px"><span><b>${esc(i.source || '엑셀')}</b> <span class="sub">${new Date(i.at).toLocaleString('ko-KR')} · ${i.from} ~ ${i.to} · 캠페인 ${i.campaigns}개 · ${fmtInt(i.cells)}칸${i.salesSaved ? ` · 판매 ${fmtInt(i.salesSaved)}행` : ''}${i.mappedOptions ? ` · 옵션 ${i.mappedOptions}개` : ''}</span></span><span class="grow"></span><button class="btn sm" data-undo="${i.id}">되돌리기</button><button class="btn danger sm" data-remove="${i.id}">장부 값 삭제</button></div>`).join('')
    + '<div class="sub" style="margin-top:4px">되돌리기 = 가져오기 전 상태로 복구(옵션·마진 포함). 장부 값 삭제 = 이 가져오기로 들어온 캠페인×날짜 값만 지우고 옵션·마진은 둠.</div>';
  box.querySelectorAll('[data-undo]').forEach((b) => b.onclick = async () => { if (confirm('이 가져오기를 되돌릴까요? 가져오기 전 상태로 복구됩니다.')) { await undoImport(b.dataset.undo); msg('#legacy-msg', '되돌렸습니다.', 'ok'); refreshAll(); renderImports(); } });
  box.querySelectorAll('[data-remove]').forEach((b) => b.onclick = async () => { if (confirm('이 가져오기로 들어온 장부 값을 삭제할까요? (옵션·마진은 남습니다)')) { const n = await removeImportData(b.dataset.remove); msg('#legacy-msg', `${fmtInt(n)}칸 삭제`, 'ok'); refreshAll(); renderImports(); } });
}
$('#wipe').onclick = async () => {
  if (!confirm('정말 모든 데이터(판매·광고·엑셀 장부·옵션·마진)를 지울까요? 백업 파일을 먼저 받아 두세요.')) return;
  if (!confirm('마지막 확인: 지운 데이터는 백업 파일로만 복구할 수 있습니다. 진행할까요?')) return;
  await S.replaceAll({}); msg('#data-msg', '모두 지웠습니다.', 'ok'); refreshAll(); renderImports();
};
{ const a = new Date(yday); a.setDate(a.getDate() - 6); $('#range-start').value = localIso(a); $('#range-end').value = localIso(yday); }
const rangeDates = () => { const out = []; for (let d = $('#range-start').value; d <= $('#range-end').value; d = addDays(d, 1)) out.push(d); return out; };
$('#range-check').onclick = () => { const d = DATA; const ds = rangeDates(); const ms = ds.filter((x) => !d.sales[x]), ma = ds.filter((x) => !d.ads[x]); $('#range-missing-list').innerHTML = `판매 없는 날 ${ms.length}일: ${ms.map((x) => x.slice(5)).join(', ') || '없음'}<br>광고 없는 날 ${ma.length}일: ${ma.map((x) => x.slice(5)).join(', ') || '없음'}`; };
$('#range-go').onclick = async () => {
  const kinds = [$('#range-sales').checked && 'sales', $('#range-ads').checked && 'ads'].filter(Boolean); if (!kinds.length) return;
  await chrome.runtime.sendMessage({ type: 'collectRange', start: $('#range-start').value, end: $('#range-end').value, kinds, onlyMissing: $('#range-missing').checked });
  $('#range-log').style.display = 'block'; $('#range-stop').style.display = ''; $('#range-go').disabled = true; pollJob();
};
$('#range-stop').onclick = () => chrome.runtime.sendMessage({ type: 'cancelJob' });
async function pollJob() { const j = await chrome.runtime.sendMessage({ type: 'jobStatus' }); $('#range-log').textContent = `${j.done}/${j.total} 진행\n` + j.log.join('\n'); if (j.running) setTimeout(pollJob, 1500); else { $('#range-stop').style.display = 'none'; $('#range-go').disabled = false; refreshAll(); } }
$('#backup').onclick = async () => { const d = await reload(); download(`쿠팡광고계산기_백업_${localIso(today)}.json`, JSON.stringify(d), 'application/json'); };
$('#restore').onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!d.sales || !d.ads) throw new Error('백업 파일 형식이 아닙니다'); if (confirm('현재 데이터를 백업 파일 내용으로 바꿉니다. 계속할까요?')) { await S.replaceAll(d); msg('#data-msg', '복원됨', 'ok'); refreshAll(); } }
  catch (e) { msg('#data-msg', e.message, 'err'); }
  ev.target.value = '';
};
$('#sales-csv').onclick = () => { const d = DATA; const keys = ['date', 'option_id', 'option_name', 'product_name', 'product_id', 'category', 'sales_type', 'revenue', 'orders', 'quantity', 'visitors', 'views', 'carts', 'conversion']; const lines = [['날짜', '옵션ID', '옵션명', '상품명', '등록상품ID', '카테고리', '판매방식', '매출', '주문', '판매량', '방문자', '조회', '장바구니', '구매전환율'].join(',')]; for (const date of Object.keys(d.sales).sort()) for (const r of Object.values(d.sales[date])) lines.push(keys.map((k) => csvEsc(r[k])).join(',')); download('판매데이터.csv', lines.join('\n')); };
$('#ads-csv').onclick = () => { const d = DATA; const keys = ['date', 'campaign', 'target_roas', 'budget', 'spend', 'ad_revenue', 'conversion', 'ctr', 'impressions', 'clicks', 'ad_orders', 'action']; const lines = [['날짜', '캠페인', '목표효율', '광고예산', '집행광고비', '광고전환매출', '전환율', '클릭률', '노출수', '클릭수', '광고전환판매수', 'ACTION'].join(',')]; for (const date of Object.keys(d.ads).sort()) for (const r of Object.values(d.ads[date])) lines.push(keys.map((k) => csvEsc(r[k])).join(',')); download('광고데이터.csv', lines.join('\n')); };
const SETTINGS = { salesUrl: 'https://wing.coupang.com/tenants/business-insight/sales-analysis?start_date={date}&end_date={date}', adsUrl: 'https://advertising.coupang.com/marketing/dashboard/sales', autoEnabled: false, autoTime: '13:00', waitSeconds: 12, fillMissingDays: 7, serverSync: false, server: 'http://127.0.0.1:8765' };
async function loadSettings() {
  const s = await chrome.storage.sync.get(SETTINGS);
  for (const k of Object.keys(SETTINGS)) { const el = $('#set-' + k); if (!el) continue; if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k]; }
  const { logs = [] } = await chrome.storage.local.get('logs'); $('#auto-log').textContent = logs.slice(-20).join('\n') || '(자동 수집 기록 없음)';
}
$('#set-save').onclick = async () => { const out = {}; for (const k of Object.keys(SETTINGS)) { const el = $('#set-' + k); if (!el) continue; out[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim(); } await chrome.storage.sync.set(out); msg('#set-msg', '저장됨', 'ok'); };
$('#run-auto').onclick = async () => { msg('#set-msg', '자동 수집 중… (탭이 열렸다 닫힙니다, 1분쯤 걸립니다)'); const rs = await chrome.runtime.sendMessage({ type: 'runAuto' }); msg('#set-msg', rs.every((r) => r.ok) ? '완료' : rs.map((r) => r.ok ? '성공' : r.error).join(' / '), rs.every((r) => r.ok) ? 'ok' : 'err'); loadSettings(); refreshAll(); };

/* ===== 광고 외 지출 ===== */
$('#ex-date').value = localIso(yday);
$('#ex-cat').innerHTML = S.EXPENSE_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('') + '<option value="__custom">직접 입력…</option>';
$('#ex-cat').onchange = () => { $('#ex-cat-custom').style.display = $('#ex-cat').value === '__custom' ? '' : 'none'; };
$('#ex-add').onclick = async () => {
  const cat = $('#ex-cat').value === '__custom' ? $('#ex-cat-custom').value.trim() : $('#ex-cat').value;
  const amount = parseNumber($('#ex-amount').value);
  if (!$('#ex-date').value || !cat || !amount) { msg('#ex-msg', '날짜 · 사유 · 금액을 넣어 주세요', 'err'); return; }
  const d = await reload(); S.addExpense(d, { date: $('#ex-date').value, category: cat, amount, memo: $('#ex-memo').value, mode: $('#ex-mode').value }); await S.save(d);
  $('#ex-amount').value = ''; $('#ex-memo').value = ''; msg('#ex-msg', '추가됨', 'ok'); await reload(); $('#ex-month').value = $('#ex-date').value.slice(0, 7); renderExpense(); renderFoot();
};
$('#ex-month').onchange = () => renderExpense();
function renderExpense() {
  const d = DATA; const list = [...(d.expenses || [])].sort((a, b) => b.date.localeCompare(a.date));
  const months = [...new Set([...list.map((e) => e.date.slice(0, 7)), localIso(yday).slice(0, 7)])].sort().reverse();
  const sel = $('#ex-month'); const cur = sel.value || (list[0] ? list[0].date.slice(0, 7) : months[0]);
  sel.innerHTML = '<option value="">전체</option>' + months.map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${m.replace('-', '년 ')}월</option>`).join('');
  const shown = list.filter((e) => !sel.value || e.date.startsWith(sel.value));
  $('#ex-sub').textContent = `${shown.length}건 · ${fmtWon(shown.reduce((a, e) => a + e.amount, 0))}원`;
  const tb = $('#ex-table tbody'); tb.innerHTML = '';
  for (const e of shown) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="l"><input type="date" data-k="date" value="${e.date}"></td><td class="l"><input type="text" data-k="category" value="${esc(e.category)}" list="ex-cat-list" style="width:110px"></td><td><input type="number" data-k="amount" value="${e.amount}" style="width:120px"></td><td class="l"><input type="text" data-k="memo" value="${esc(e.memo)}" style="width:200px"></td><td class="l"><select data-k="mode"><option value="month" ${e.mode === 'month' ? 'selected' : ''}>월에 나눠</option><option value="day" ${e.mode === 'day' ? 'selected' : ''}>그 날에</option></select></td><td class="actions"><button class="btn primary sm">저장</button> <button class="btn danger sm">삭제</button></td>`;
    const [save, del] = tr.querySelectorAll('button');
    save.onclick = async () => { const g = (k) => tr.querySelector(`[data-k=${k}]`).value; const dd = await reload(); S.addExpense(dd, { id: e.id, date: g('date'), category: g('category'), amount: parseNumber(g('amount')), memo: g('memo'), mode: g('mode') }); await S.save(dd); await reload(); renderExpense(); msg('#ex-msg', '저장됨', 'ok'); };
    del.onclick = async () => { if (confirm('이 지출을 삭제할까요?')) { const dd = await reload(); S.deleteExpense(dd, e.id); await S.save(dd); await reload(); renderExpense(); } };
    tb.appendChild(tr);
  }
  if (!document.getElementById('ex-cat-list')) document.body.insertAdjacentHTML('beforeend', `<datalist id="ex-cat-list">${S.EXPENSE_CATEGORIES.map((c) => `<option value="${c}">`).join('')}</datalist>`);
  // 월별 합계
  const allMonths = [...new Set([...S.dates(d).map((x) => x.slice(0, 7)), ...list.map((e) => e.date.slice(0, 7))])].sort().reverse().slice(0, 24);
  const mt = $('#ex-month-table tbody'); mt.innerHTML = '';
  for (const mk of allMonths) {
    const [y, m] = mk.split('-').map(Number); const endDay = new Date(y, m, 0).getDate();
    const led = computeLedger(d, `${mk}-01`, `${mk}-${String(endDay).padStart(2, '0')}`);
    const byCat = {}; for (const e of list.filter((x) => x.date.startsWith(mk))) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
    mt.insertAdjacentHTML('beforeend', `<tr><td class="l">${mk.replace('-', '년 ')}월</td><td class="num">${fmtWon(led.grand.profit)}</td><td class="num">${led.grand.expense ? '−' + fmtWon(led.grand.expense) : ''}</td><td class="num ${led.grand.profit_net < 0 ? 'neg' : 'pos'}">${fmtWon(led.grand.profit_net)}</td><td class="l sub">${Object.entries(byCat).map(([c, v]) => `${esc(c)} ${fmtWon(v)}`).join(' · ')}</td></tr>`);
  }
}

/* ===== 세후 순마진 (종합소득세 추정) ===== */
// 기간의 세후 순이익: 연도별로 (기간 끝까지 누적 순이익의 세금) − (기간 시작 전날까지 누적 순이익의 세금)
function yearProfitUntil(y, until) { if (until < `${y}-01-01`) return 0; const led = computeLedger(DATA, `${y}-01-01`, until); return Object.values(led.daily).reduce((a, v) => a + v.profit_net, 0); }
function periodAfterTax(start, end) {
  let profit = 0, tax = 0;
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    const st = taxSettingsFor(y);
    const s = start > `${y}-01-01` ? start : `${y}-01-01`, e = end < `${y}-12-31` ? end : `${y}-12-31`;
    const before = yearProfitUntil(y, addDays(s, -1)), through = yearProfitUntil(y, e);
    const t = computeYearTax(y, through, st).bizTax - computeYearTax(y, before, st).bizTax;
    profit += through - before; tax += Math.max(0, t);
  }
  return { profit, tax, net: profit - tax, rate: profit > 0 ? tax / profit : 0 };
}
let taxSettingsAll = {};
async function loadTaxSettings() { const r = await chrome.storage.sync.get('taxSettings'); taxSettingsAll = r.taxSettings || {}; }
const taxSettingsFor = (y) => ({ ...DEFAULT_TAX_SETTINGS, ...(taxSettingsAll.default || {}), ...(taxSettingsAll[y] || {}) });
async function renderTax() {
  await loadTaxSettings();
  const years = [...new Set([...S.dates(DATA).map((d) => d.slice(0, 4)), String(today.getFullYear())])].sort().reverse();
  const sel = $('#tax-year'); const cur = sel.value || String(today.getFullYear());
  sel.innerHTML = years.map((y) => `<option value="${y}" ${y === cur ? 'selected' : ''}>${y}년</option>`).join('');
  const y = Number(sel.value); const st = taxSettingsFor(y);
  for (const k of ['salary', 'reliefRate', 'extraDeductions', 'otherCredits', 'extraExpenses']) $('#tx-' + k).value = st[k] ?? 0;
  $('#tx-localTax').checked = !!st.localTax; $('#tx-spouse').checked = !!st.spouse; $('#tx-children').value = (st.childrenBirthYears || []).join(', ');
  $('#tx-basic').textContent = `본인${st.spouse ? '·배우자' : ''}${(st.childrenBirthYears || []).length ? '·자녀 ' + st.childrenBirthYears.length + '명' : ''} = ${fmtWon(basicDeduction(st))}원`;
  const led = computeLedger(DATA, `${y}-01-01`, `${y}-12-31`);
  const monthly = {}; for (const [d, v] of Object.entries(led.daily)) { const m = Number(d.slice(5, 7)); monthly[m] = (monthly[m] || 0) + v.profit_net; }
  const total = Object.values(monthly).reduce((a, b) => a + b, 0);
  const r = computeYearTax(y, total, st);
  const lastDate = S.dates(DATA).filter((d) => d.startsWith(String(y))).pop();
  $('#tax-sub').textContent = lastDate ? `${y}-01-01 ~ ${lastDate} 장부 기준` : '이 연도의 데이터가 없습니다';
  const kpis = [
    { k: '연 누적 순이익 (세전, 광고 외 지출 차감)', v: fmtWon(total) + '원', d: led.grand.expense ? `광고 외 지출 −${fmtWon(led.grand.expense)}원 반영` : '', color: '#4a3aa7' },
    { k: '쿠팡 몫 세금 (지방세 포함)', v: fmtWon(r.bizTax) + '원', d: `실효세율 ${(r.effectiveRate * 100).toFixed(1)}%`, color: '#eb6834' },
    { k: '세후 순마진', v: fmtWon(r.netAfterTax) + '원', bad: r.netAfterTax < 0, d: `순이익의 ${total ? Math.round(r.netAfterTax / total * 100) : 0}%`, color: '#1baf7a' },
    { k: '한계세율 (다음 1원에 붙는 세율)', v: (r.marginalEffective * 100).toFixed(2) + '%', d: `${Math.round(r.withBiz.marginal * 100)}% 구간 × (1 − 감면 ${Math.round(r.reliefApplied * 100)}%)${st.localTax ? ' × 지방세 1.1' : ''}${r.reliefApplied < st.reliefRate / 100 - 1e-9 ? ' · 최저한세로 감면 제한' : ''}`, color: '#2a78d6' },
    { k: '근로소득', v: fmtWon(st.salary) + '원', d: `근로소득금액 ${fmtWon(r.earned)}원`, color: '#17202a' },
  ];
  $('#tax-kpis').innerHTML = kpis.map((x) => `<div class="kpi"><div class="k"><span class="dot" style="background:${x.color}"></span>${x.k}</div><div class="v num ${x.bad ? 'bad' : ''}">${x.v}</div><div class="d">${x.d || ''}</div></div>`).join('');
  // 월별
  const mb = monthlyBreakdown(y, monthly, st);
  let h = '<thead><tr><th class="l">월</th><th>순이익</th><th>누적</th><th>세금</th><th>세후 순이익</th><th>세율</th></tr></thead><tbody>';
  for (const m of mb) { if (m.empty) { h += `<tr><td class="l">${m.month}월</td><td class="sub" colspan="5" style="text-align:left">데이터 없음</td></tr>`; continue; } h += `<tr><td class="l">${m.month}월</td><td class="num ${m.profit < 0 ? 'neg' : ''}">${fmtWon(m.profit)}</td><td class="num">${fmtWon(m.cum)}</td><td class="num">${fmtWon(m.tax)}</td><td class="num ${m.net < 0 ? 'neg' : 'pos'}">${fmtWon(m.net)}</td><td class="num">${m.profit > 0 ? (m.rate * 100).toFixed(1) + '%' : ''}</td></tr>`; }
  h += `</tbody><tfoot><tr><td class="l">합계</td><td class="num">${fmtWon(total)}</td><td></td><td class="num">${fmtWon(r.bizTax)}</td><td class="num ${r.netAfterTax < 0 ? 'neg' : 'pos'}">${fmtWon(r.netAfterTax)}</td><td class="num">${(r.effectiveRate * 100).toFixed(1)}%</td></tr></tfoot>`;
  $('#tax-month-table').innerHTML = h;
  // 계산 내역
  const W = r.withBiz, O = r.salaryOnly;
  const fam = `본인${st.spouse ? '·배우자' : ''}${(st.childrenBirthYears || []).length ? '·자녀' + st.childrenBirthYears.length : ''}`;
  const rows = [['근로소득금액', r.earned, r.earned], ['사업소득금액 (쿠팡)', W.total - r.earned, 0], ['종합소득금액', W.total, O.total], [`− 소득공제 (기본공제 ${fam} ${fmtWon(r.basicDeduction)} + 추가 ${fmtWon(st.extraDeductions || 0)})`, r.deductions, r.deductions], ['과세표준', W.base, O.base],
    ['산출세액', W.gross, O.gross], ['− 근로소득세액공제', W.earnedCredit, O.earnedCredit], ['− 청년창업 세액감면', W.relief, O.relief], [`− 자녀세액공제 (8세 이상 자녀)`, W.childCredit, O.childCredit], ['− 기타 세액공제', st.otherCredits, st.otherCredits], ['결정세액', W.determined, O.determined], ['+ 지방소득세', W.local, O.local], ['총 세금', W.all, O.all]];
  $('#tax-detail-sub').textContent = `${y}년 귀속`;
  $('#tax-detail-table').innerHTML = '<thead><tr><th class="l">항목</th><th>근로 + 쿠팡</th><th>근로만</th><th>차이 (쿠팡 몫)</th></tr></thead><tbody>' + rows.map(([l, a, b]) => `<tr class="${/총 세금|과세표준|결정세액/.test(l) ? 'profit' : ''}"><td class="l">${l}</td><td class="num">${fmtWon(a)}</td><td class="num">${fmtWon(b)}</td><td class="num">${fmtWon(a - b)}</td></tr>`).join('') + '</tbody>';
  const br = bracketsFor(y); let lo = 0;
  $('#tax-bracket-table').innerHTML = '<thead><tr><th class="l">과세표준 구간</th><th>세율</th><th>누진공제</th></tr></thead><tbody>' + br.map(([cap, rate, ded]) => { const hit = W.base > lo && W.base <= cap; const row = `<tr style="${hit ? 'background:var(--accent-soft);font-weight:700' : ''}"><td class="l">${lo ? fmtWon(lo) + ' 초과 ' : ''}${cap === Infinity ? '' : fmtWon(cap) + ' 이하'}${hit ? ' ← 현재 구간' : ''}</td><td class="num">${Math.round(rate * 100)}%</td><td class="num">${fmtWon(ded)}</td></tr>`; lo = cap; return row; }).join('') + '</tbody>';
}
$('#tax-year').onchange = () => renderTax();
$('#tax-settings-toggle').onclick = () => { const e = $('#tax-settings'); e.style.display = e.style.display === 'none' ? '' : 'none'; };
$('#tx-save').onclick = async () => {
  const y = $('#tax-year').value; await loadTaxSettings();
  const children = $('#tx-children').value.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((x) => x >= 1950 && x <= 2100);
  taxSettingsAll[y] = { salary: Number($('#tx-salary').value), reliefRate: Number($('#tx-reliefRate').value), spouse: $('#tx-spouse').checked, childrenBirthYears: children, extraDeductions: Number($('#tx-extraDeductions').value), otherCredits: Number($('#tx-otherCredits').value), extraExpenses: Number($('#tx-extraExpenses').value), localTax: $('#tx-localTax').checked };
  taxSettingsAll.default = taxSettingsAll[y]; // 새 연도 기본값으로도 사용
  await chrome.storage.sync.set({ taxSettings: taxSettingsAll }); msg('#tx-msg', '저장됨', 'ok'); renderTax();
};

/* ===== 업데이트 ===== */
async function renderUpdate(force = false) {
  const u = force ? { latest: await checkRemote(true), current: chrome.runtime.getManifest().version } : await updateStatus();
  u.hasUpdate = !!u.latest && u.latest !== u.current && (await import('./lib/update.js')).cmpVersion(u.latest, u.current) > 0;
  $('#upd-sub').textContent = `지금 v${u.current}` + (u.latest ? ` · 최신 v${u.latest}` : ' · 최신 버전을 확인하지 못함');
  $('#update-banner').innerHTML = u.hasUpdate ? `<div class="notice">🆕 새 버전 <b>v${u.latest}</b> 이 있습니다 (지금 v${u.current}). 저장소 폴더의 <b>업데이트.bat</b> 을 더블클릭하세요. 끝나면 확장 프로그램이 스스로 새로고침됩니다. <a href="#data">자세히</a></div>` : '';
  return u;
}
$('#upd-check').onclick = async () => { msg('#upd-msg', '확인 중…'); const u = await renderUpdate(true); msg('#upd-msg', u.hasUpdate ? `새 버전 v${u.latest} 이 있습니다. 업데이트.bat 을 실행하세요.` : '최신 버전입니다.', u.hasUpdate ? 'err' : 'ok'); };
$('#upd-reload').onclick = async () => { if (!(await reloadIfFilesChanged())) { if (confirm('파일이 아직 바뀌지 않았습니다. 그래도 새로고침할까요?')) chrome.runtime.reload(); } };
$('#upd-zip').href = ZIP_URL;

/* ===== 초기화 ===== */
$('#ver').textContent = 'v' + chrome.runtime.getManifest().version;
renderUpdate();
reloadIfFilesChanged();
$('#ads-date').value = localIso(yday);
async function migrateEndDateBug() {
  const { migratedEndDate } = await chrome.storage.local.get('migratedEndDate'); if (migratedEndDate) return;
  const dd = await reload(); const legacyDates = Object.keys(dd.legacy || {}).filter((x) => Object.keys(dd.legacy[x]).length).sort(); const cutoff = legacyDates[legacyDates.length - 1];
  let n = 0;
  if (cutoff) for (const date of Object.keys(dd.ads)) if (date <= cutoff) { n += Object.keys(dd.ads[date]).length; delete dd.ads[date]; }
  if (n) { await S.save(dd); await reload(); const { logs = [] } = await chrome.storage.local.get('logs'); logs.push(`${new Date().toLocaleString('ko-KR')} [정리] 종료일 열 오인으로 잘못된 날짜(${cutoff} 이전)에 저장된 광고 ${n}건 삭제`); await chrome.storage.local.set({ logs: logs.slice(-100) }); }
  await chrome.storage.local.set({ migratedEndDate: true });
}
(async () => {
  await reload(); await migrateAutoOptions(); await migrateEndDateBug(); renderFoot();
  let p = '30'; try { p = localStorage.getItem('cc-range') || '30'; } catch { /* 무시 */ }
  if (p === 'custom') p = '30';
  range.preset = p; [range.start, range.end] = presetRange(p); $('#r-start').value = range.start; $('#r-end').value = range.end;
  $$('#range button').forEach((b) => b.classList.toggle('active', b.dataset.r === p));
  const hash = location.hash.slice(1);
  if (hash === 'import' || hash === 'range' || hash === 'paste' || hash === 'update') { showPage(hash === 'paste' ? 'ads' : 'data'); if (hash === 'paste') $('#paste-details').open = true; if (hash === 'update') setTimeout(() => $('#update-card').scrollIntoView(), 100); }
  else showPage(hash || 'dash');
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.ccdata) { reload().then(() => { renderFoot(); if (page === 'dash') renderDash(); }); } });
})();
