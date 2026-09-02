import * as S from './lib/store.js';
import { computeLedger, METRICS } from './lib/ledger.js';
import { normalizeAds, normalizeSales, parseNumber, localIso } from './lib/parse.js';
import { importSalesFile, importAdsFile, dateFromReportName, pasteToRecords } from './lib/importer.js';
import { importLegacyWorkbook } from './lib/legacy.js';
import { barChart, stackedChart, lineChart, sparkline } from './lib/charts.js';

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
  if (p === '7') return [addDays(y, -6), y];
  if (p === '30') return [addDays(y, -29), y];
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
const TITLES = { dash: '대시보드', ledger: '광고 장부', options: '캠페인 · 옵션', ads: '광고 입력', data: '데이터 · 설정' };
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
  if (page === 'dash') renderDash(); else if (page === 'ledger') renderLedger(); else if (page === 'options') renderOptions(); else if (page === 'ads') loadAds(); else if (page === 'data') loadSettings();
}
async function refreshAll() { await reload(); renderFoot(); renderCurrent(); }
function renderFoot() {
  const ds = S.dates(DATA);
  $('#foot').textContent = ds.length ? `데이터 ${ds[0]} ~ ${ds[ds.length - 1]} · ${ds.length}일 · 캠페인 ${S.campaigns(DATA).length}개` : '아직 데이터가 없습니다';
}

/* ===== 대시보드 ===== */
function renderDash() {
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
  const kpis = [
    { k: '순이익 (광고비 제외)', v: fmtWon(g.profit) + '원', bad: g.profit < 0, d: delta(g.profit, pg.profit), color: g.profit < 0 ? '#d03b3b' : '#4a3aa7' },
    { k: '총 매출', v: fmtWon(g.revenue) + '원', d: delta(g.revenue, pg.revenue), color: '#17202a' },
    { k: '자연 매출 (광고 외)', v: fmtWon(g.organic_revenue) + '원', d: `매출의 ${Math.round(organicShare * 100)}% · ${delta(organicShare, prevOrganicShare, true)}`, color: '#1baf7a' },
    { k: '광고비 (부가세 포함)', v: fmtWon(g.spend_vat) + '원', d: delta(g.spend_vat, pg.spend_vat), color: '#eb6834' },
    { k: '광고수익률 (ROAS)', v: Math.round(g.roas * 100) + '%', d: delta(g.roas, pg.roas, true), color: '#2a78d6' },
    { k: '판매 마진', v: fmtWon(g.margin_total) + '원', d: `판매 ${fmtInt(g.actual_qty)}개 · 광고 ${fmtInt(g.ad_orders)} / 자연 ${fmtInt(g.organic_qty)}`, color: '#4a3aa7' },
  ];
  $('#kpis').innerHTML = kpis.map((x) => `<div class="kpi"><div class="k"><span class="dot" style="background:${x.color}"></span>${x.k}</div><div class="v num ${x.bad ? 'bad' : ''}">${x.v}</div><div class="d">${x.d}</div></div>`).join('');

  const dates = led.dates.filter((d) => led.daily[d]);
  const D = (k) => dates.map((d) => led.daily[d][k] || 0);
  barChart($('#ch-profit'), dates, D('profit'));
  stackedChart($('#ch-rev'), dates, [{ label: '광고 매출', cls: 'ad', color: '#2a78d6', values: D('ad_revenue') }, { label: '자연 매출', cls: 'org', color: '#1baf7a', values: D('organic_revenue') }]);
  lineChart($('#ch-cost'), dates, [{ label: '광고비', cls: 'cost', color: '#eb6834', values: D('spend_vat') }, { label: '광고 매출', cls: 'rev', color: '#2a78d6', values: D('ad_revenue') }]);
  stackedChart($('#ch-qty'), dates, [{ label: '광고 판매', cls: 'ad', color: '#2a78d6', values: D('ad_orders') }, { label: '자연 판매', cls: 'org', color: '#1baf7a', values: D('organic_qty') }]);
  renderCampTable(led);
  $('#notice').innerHTML = led.unmapped_options.length ? `<div class="notice">캠페인이 없는 옵션 ${led.unmapped_options.length}개의 판매는 '자연 판매'에만 들어가고 캠페인 표에는 없습니다. 광고를 돌리는 옵션이면 <a href="#options">캠페인 · 옵션</a>에서 캠페인 이름을 넣어 주세요.</div>` : '';
}
let campSort = { key: 'profit', dir: 'desc' };
function renderCampTable(led) {
  const hideZero = $('#camp-hide-zero').checked;
  const cols = [['campaign', '캠페인', 'l'], ['spend_vat', '광고비', 'won'], ['ad_revenue', '광고 매출', 'won'], ['roas', 'ROAS', 'ratio'], ['target_roas', '목표', 'ratio'], ['ad_orders', '광고 판매', 'int'], ['organic_qty', '자연 판매', 'int'], ['revenue', '총 매출', 'won'], ['margin_total', '판매 마진', 'won'], ['profit', '순이익', 'won'], ['trend', '추세', '']];
  let rows = led.campaigns.map((c) => { const t = { ...c.total, campaign: c.campaign, days: c.days }; const lastDay = Object.keys(c.days).sort().pop(); t.target_roas = lastDay ? c.days[lastDay].target_roas : 0; return t; }).filter((t) => t.days && Object.keys(t.days).length);
  if (hideZero) rows = rows.filter((t) => t.spend_vat > 0 || t.ad_orders > 0);
  rows.sort((a, b) => { const k = campSort.key; const va = a[k], vb = b[k]; const r = typeof va === 'string' ? va.localeCompare(vb, 'ko') : (va || 0) - (vb || 0); return campSort.dir === 'asc' ? r : -r; });
  $('#camp-sub').textContent = `${range.start} ~ ${range.end} · ${rows.length}개 캠페인`;
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
$('#camp-hide-zero').onchange = () => renderDash();

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
function renderLedger() { renderMetricPicker(); ledgerCache = computeLedger(DATA, range.start, range.end); renderLedgerTable(); }
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
  h += '<tr><td class="camp">전체</td><td class="lbl"><b>전체 순이익</b></td>' + cols.map((c) => { const v = c.date ? led.total_profit[c.date] : led.month_profit[c.sum]; return `<td class="total num ${v < 0 ? 'neg' : ''}">${v == null ? '' : fmtWon(v)}</td>`; }).join('') + (showAction ? '<td></td>' : '') + '</tr>';
  const adsOnly = new Set(['target_roas', 'roas', 'budget', 'spend_vat', 'cpc', 'impressions', 'ctr', 'conversion', 'ad_orders', 'ad_revenue']);
  for (const c of led.campaigns) {
    if (!Object.keys(c.days).some((d) => dates.includes(d))) continue;
    metrics.forEach((mt, i) => {
      const isProfit = mt.key === 'profit';
      h += `<tr class="${isProfit ? 'profit' : ''}">` + (i === 0 ? `<td class="camp" rowspan="${metrics.length}">${esc(c.campaign)}</td>` : '') + `<td class="lbl">${mt.label}</td>`;
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
function renderOptions() {
  const d = DATA;
  // 판매 데이터에만 있는 옵션은 자동으로 목록에 넣는다
  let added = false;
  for (const day of Object.values(d.sales)) for (const r of Object.values(day)) if (!d.options.find((o) => o.option_id === r.option_id)) { S.upsertOption(d, { option_id: r.option_id, product_name: r.option_name || r.product_name }); added = true; }
  if (added) S.save(d);
  const lookup = S.marginLookup(d); const todayIso = localIso(today);
  const since = addDays(localIso(yday), -29); const soldRecently = new Set(); const soldQty = {};
  for (const [date, day] of Object.entries(d.sales)) for (const r of Object.values(day)) { if (date >= since && r.quantity > 0) { soldRecently.add(r.option_id); soldQty[r.option_id] = (soldQty[r.option_id] || 0) + r.quantity; } }
  const q = $('#opt-search').value.trim().toLowerCase(); const f = $('#opt-filter').value;
  const camps = S.campaigns(d);
  let list = S.sortedOptions(d).filter((o) => {
    const hist = S.marginHistory(d, o.option_id);
    if (f === 'mapped' && !o.campaign) return false; if (f === 'unmapped' && o.campaign) return false;
    if (f === 'nomargin' && hist.length) return false; if (f === 'sold30' && !soldRecently.has(o.option_id)) return false;
    return !q || `${o.option_id} ${o.product_name} ${o.campaign}`.toLowerCase().includes(q);
  });
  $('#opt-count').textContent = `${list.length}개 표시 / 전체 ${d.options.length}개 · 캠페인 없음 ${d.options.filter((o) => !o.campaign).length}개`;
  const dl = `<datalist id="camp-list">${camps.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;
  const tb = $('#options-table tbody'); tb.innerHTML = ''; tb.insertAdjacentHTML('beforebegin', document.getElementById('camp-list') ? '' : dl);
  for (const o of list.slice(0, 400)) {
    const hist = S.marginHistory(d, o.option_id);
    const tr = document.createElement('tr'); if (o.campaign && !hist.length) tr.className = 'warnrow';
    tr.innerHTML = `<td class="l num">${esc(o.option_id)}${soldQty[o.option_id] ? `<div class="sub">최근30일 ${fmtInt(soldQty[o.option_id])}개</div>` : ''}</td>
      <td class="l"><input class="wide" data-k="product_name" value="${esc(o.product_name)}"></td>
      <td class="l"><input data-k="campaign" list="camp-list" value="${esc(o.campaign)}" placeholder="(광고 안 함)"></td>
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
    tb.appendChild(tr);
  }
  if (list.length > 400) tb.insertAdjacentHTML('beforeend', `<tr><td colspan="7" class="sub">400개까지만 표시합니다. 검색이나 필터로 줄여 주세요.</td></tr>`);
}

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
$('#import-legacy').onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return; msg('#legacy-msg', '엑셀을 읽는 중… (큰 파일은 10초 정도 걸립니다)');
  try { const r = await importLegacyWorkbook(await f.arrayBuffer()); msg('#legacy-msg', `가져옴: 옵션 ${r.options}개, 마진 ${r.margins}개, 광고 ${fmtInt(r.ads)}행, 판매 ${fmtInt(r.sales)}행 (${r.from} ~ ${r.to}). 대시보드에서 확인하세요.`, 'ok'); }
  catch (e) { msg('#legacy-msg', e.message, 'err'); }
  ev.target.value = ''; await reload(); renderFoot();
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
const SETTINGS = { salesUrl: 'https://wing.coupang.com/tenants/business-insight/sales-analysis?start_date={date}&end_date={date}', adsUrl: 'https://advertising.coupang.com/', autoEnabled: false, autoTime: '13:00', waitSeconds: 12, fillMissingDays: 7, serverSync: false, server: 'http://127.0.0.1:8765' };
async function loadSettings() {
  const s = await chrome.storage.sync.get(SETTINGS);
  for (const k of Object.keys(SETTINGS)) { const el = $('#set-' + k); if (!el) continue; if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k]; }
  const { logs = [] } = await chrome.storage.local.get('logs'); $('#auto-log').textContent = logs.slice(-20).join('\n') || '(자동 수집 기록 없음)';
}
$('#set-save').onclick = async () => { const out = {}; for (const k of Object.keys(SETTINGS)) { const el = $('#set-' + k); if (!el) continue; out[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim(); } await chrome.storage.sync.set(out); msg('#set-msg', '저장됨', 'ok'); };
$('#run-auto').onclick = async () => { msg('#set-msg', '자동 수집 중… (탭이 열렸다 닫힙니다, 1분쯤 걸립니다)'); const rs = await chrome.runtime.sendMessage({ type: 'runAuto' }); msg('#set-msg', rs.every((r) => r.ok) ? '완료' : rs.map((r) => r.ok ? '성공' : r.error).join(' / '), rs.every((r) => r.ok) ? 'ok' : 'err'); loadSettings(); refreshAll(); };

/* ===== 초기화 ===== */
$('#ver').textContent = 'v' + chrome.runtime.getManifest().version;
$('#ads-date').value = localIso(yday);
(async () => {
  await reload(); renderFoot();
  let p = '30'; try { p = localStorage.getItem('cc-range') || '30'; } catch { /* 무시 */ }
  if (p === 'custom') p = '30';
  range.preset = p; [range.start, range.end] = presetRange(p); $('#r-start').value = range.start; $('#r-end').value = range.end;
  $$('#range button').forEach((b) => b.classList.toggle('active', b.dataset.r === p));
  const hash = location.hash.slice(1);
  if (hash === 'import' || hash === 'range' || hash === 'paste') { showPage(hash === 'paste' ? 'ads' : 'data'); if (hash === 'paste') $('#paste-details').open = true; }
  else showPage(hash || 'dash');
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.ccdata) { reload().then(() => { renderFoot(); if (page === 'dash') renderDash(); }); } });
})();
