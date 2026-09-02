import * as S from './lib/store.js';
import { computeLedger } from './lib/ledger.js';
import { normalizeAds, parseNumber, localIso } from './lib/parse.js';
import { importSalesFile, importAdsFile } from './lib/importer.js';

const $ = (s) => document.querySelector(s);
const fmtInt = (v) => Math.round(v).toLocaleString('ko-KR');
const fmtWon = (v) => (v < 0 ? '-' : '') + fmtInt(Math.abs(v));
const fmt = { won: fmtWon, int: fmtInt, ratio: (v) => Math.round(v * 100) + '%', pct1: (v) => (v * 100).toFixed(1) + '%', pct2: (v) => (v * 100).toFixed(2) + '%' };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const today = new Date(); const yday = new Date(today); yday.setDate(today.getDate() - 1);
const msg = (id, text, cls = '') => { const e = $(id); e.textContent = text; e.className = 'msg ' + cls; };
const download = (name, text, type = 'text/csv') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type })); a.download = name; a.click(); };
const csvEsc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

/* ---- 탭 ---- */
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'ads') loadAds(); if (b.dataset.tab === 'options') loadOptions(); if (b.dataset.tab === 'data') loadSettings();
});
if (location.hash === '#import') document.getElementById('import-card').scrollIntoView();
else if (location.hash) document.querySelector(`nav button[data-tab="${location.hash.slice(1)}"]`)?.click();

/* ---- 요약 ---- */
async function loadSummary() {
  const d = await S.load(); const ds = S.dates(d);
  $('#summary').textContent = ds.length ? `데이터 ${ds[0]} ~ ${ds[ds.length - 1]} (${ds.length}일) · 캠페인 ${S.campaigns(d).length}개` : '아직 데이터가 없습니다';
}

/* ---- 장부 ---- */
let ledger = null;
document.querySelectorAll('[data-range]').forEach((b) => b.onclick = () => setRange(b.dataset.range));
function setRange(kind) {
  let a, b;
  if (kind === 'month') { a = new Date(today.getFullYear(), today.getMonth(), 1); b = today; }
  else if (kind === 'prev') { a = new Date(today.getFullYear(), today.getMonth() - 1, 1); b = new Date(today.getFullYear(), today.getMonth(), 0); }
  else if (kind === '30') { a = new Date(today); a.setDate(today.getDate() - 30); b = today; }
  else { $('#ledger-start').value = ''; $('#ledger-end').value = ''; loadLedger(); return; }
  $('#ledger-start').value = localIso(a); $('#ledger-end').value = localIso(b); loadLedger();
}
$('#ledger-load').onclick = loadLedger;
$('#ledger-hide-empty').onchange = renderLedger; $('#ledger-show-action').onchange = renderLedger;
async function loadLedger() {
  const d = await S.load();
  ledger = computeLedger(d, $('#ledger-start').value || null, $('#ledger-end').value || null);
  $('#ledger-empty').style.display = S.dates(d).length ? 'none' : 'block';
  renderLedger();
}
function renderLedger() {
  if (!ledger) return;
  const hideEmpty = $('#ledger-hide-empty').checked, showAction = $('#ledger-show-action').checked;
  const has = new Set(); ledger.campaigns.forEach((c) => Object.keys(c.days).forEach((d) => has.add(d)));
  const dates = ledger.dates.filter((d) => !hideEmpty || has.has(d));
  const cols = []; let m = null;
  dates.forEach((d) => { const mk = d.slice(0, 7); if (m && mk !== m) cols.push({ sum: m }); cols.push({ date: d }); m = mk; });
  if (m) cols.push({ sum: m });
  $('#ledger-warn').innerHTML = ledger.unmapped_options.length ? `<div class="warn">광고 캠페인이 연결되지 않은 옵션이 있어 장부에서 빠졌습니다: ${esc(ledger.unmapped_options.join(', '))} → '옵션 · 마진 관리' 에서 캠페인 이름과 마진을 넣어 주세요.</div>` : '';
  let h = '<thead><tr><th class="camp">캠페인</th><th class="label">항목</th>';
  cols.forEach((c) => h += c.date ? `<th>${c.date.slice(5).replace('-', '/')}</th>` : `<th class="sum">${parseInt(c.sum.slice(5))}월 합계</th>`);
  if (showAction) h += '<th>ACTION</th>';
  h += '</tr></thead><tbody><tr><td class="camp">전체</td><td class="label"><b>전체 순이익 (광고비제외)</b></td>';
  cols.forEach((c) => { const v = c.date ? ledger.total_profit[c.date] : ledger.month_profit[c.sum]; h += `<td class="total ${v < 0 ? 'neg' : ''}">${v == null ? '' : fmtWon(v)}</td>`; });
  if (showAction) h += '<td></td>';
  h += '</tr>';
  const adsOnly = ['target_roas', 'roas', 'budget', 'spend_vat', 'cpc', 'impressions', 'ctr', 'conversion', 'ad_orders'];
  ledger.campaigns.forEach((c) => {
    ledger.metrics.forEach((mt, i) => {
      const isProfit = mt.key === 'profit';
      h += `<tr class="${isProfit ? 'profit-row' : ''}">` + (i === 0 ? `<td class="camp" rowspan="${ledger.metrics.length}">${esc(c.campaign)}</td>` : '') + `<td class="label">${mt.label}</td>`;
      cols.forEach((col) => {
        const cell = col.date ? c.days[col.date] : c.months[col.sum];
        let cls = col.sum ? 'sum ' : '';
        if (!cell || (col.sum && mt.key === 'target_roas')) { h += `<td class="${cls}"></td>`; return; }
        const v = cell[mt.key];
        if (isProfit) cls += 'profit ' + (v < 0 ? 'neg' : 'pos');
        if (col.date && cell.unmapped_qty > 0 && (mt.key === 'margin_total' || isProfit)) cls += ' flag';
        const blank = col.date && !cell.has_ads && adsOnly.includes(mt.key);
        h += `<td class="${cls}" title="${col.date && cell.unmapped_qty > 0 ? '마진 미등록 옵션 판매 ' + cell.unmapped_qty + '개 포함' : ''}">${blank ? '' : fmt[mt.fmt](v)}</td>`;
      });
      if (showAction) h += i === 0 ? `<td class="action" rowspan="${ledger.metrics.length}">${Object.entries(c.days).filter(([, v]) => v.action).map(([d, v]) => `${d.slice(5)}: ${esc(v.action)}`).join('<br>')}</td>` : '';
      h += '</tr>';
    });
  });
  $('#ledger-table').innerHTML = h + '</tbody>';
}
$('#ledger-csv').onclick = () => {
  if (!ledger) return;
  const lines = [['캠페인', '항목', ...ledger.dates].map(csvEsc).join(',')];
  for (const c of ledger.campaigns) for (const mt of ledger.metrics) lines.push([c.campaign, mt.label, ...ledger.dates.map((d) => c.days[d] ? Math.round(c.days[d][mt.key] * 10000) / 10000 : '')].map(csvEsc).join(','));
  lines.push(['전체', '순이익 (광고비제외)', ...ledger.dates.map((d) => Math.round((ledger.total_profit[d] || 0) * 100) / 100)].join(','));
  download(`광고장부_${ledger.start}_${ledger.end}.csv`, lines.join('\n'));
};

/* ---- 광고 입력 ---- */
const ADS_FIELDS = ['target_roas', 'budget', 'spend', 'ad_revenue', 'conversion', 'ctr', 'impressions', 'clicks', 'ad_orders'];
const ADS_HEAD = { campaign: '캠페인 이름', target_roas: '목표효율', budget: '광고예산', spend: '집행 광고비', ad_revenue: '광고전환 매출', conversion: '전환율', ctr: '클릭률', impressions: '노출수', clicks: '클릭수', ad_orders: '광고전환 판매수', action: 'ACTION' };
$('#ads-date').onchange = loadAds;
$('#ads-prev').onclick = () => shiftAdsDate(-1); $('#ads-next').onclick = () => shiftAdsDate(1);
$('#ads-add').onclick = () => addAdsRow(); $('#ads-save').onclick = saveAds;
function shiftAdsDate(n) { const d = new Date($('#ads-date').value + 'T00:00:00'); d.setDate(d.getDate() + n); $('#ads-date').value = localIso(d); loadAds(); }
async function loadAds() {
  if (!$('#ads-date').value) $('#ads-date').value = localIso(yday);
  const d = await S.load(); const date = $('#ads-date').value;
  const rows = d.ads[date] || {};
  const names = S.campaigns(d); Object.keys(rows).forEach((c) => { if (!names.includes(c)) names.push(c); });
  $('#ads-table tbody').innerHTML = '';
  names.forEach((c) => addAdsRow(c, rows[c]));
  msg('#ads-msg', '');
}
function addAdsRow(campaign = '', row = null) {
  const tr = document.createElement('tr');
  const disp = { target_roas: (v) => v ? Math.round(v * 100) + '%' : '', conversion: (v) => v ? (v * 100).toFixed(2) + '%' : '', ctr: (v) => v ? (v * 100).toFixed(2) + '%' : '' };
  const num = (v) => v == null || v === '' ? '' : Math.round(v * 100) / 100;
  tr.innerHTML = `<td><input class="wide" data-k="campaign" value="${esc(campaign)}" placeholder="캠페인 이름"></td>` +
    ADS_FIELDS.map((k) => `<td><input data-k="${k}" value="${row ? (disp[k] ? disp[k](row[k]) : num(row[k])) : ''}"></td>`).join('') +
    `<td><input class="wide" data-k="action" value="${row ? esc(row.action) : ''}"></td><td><button class="btn danger">삭제</button></td>`;
  tr.querySelector('button').onclick = async () => {
    const name = tr.querySelector('[data-k=campaign]').value;
    if (row && name && confirm(`${$('#ads-date').value} ${name} 광고 데이터를 삭제할까요?`)) { const d = await S.load(); S.deleteAds(d, $('#ads-date').value, name); await S.save(d); }
    tr.remove();
  };
  $('#ads-table tbody').appendChild(tr);
}
async function saveAds() {
  const recs = [...$('#ads-table tbody').rows].map((tr) => { const o = {}; tr.querySelectorAll('input').forEach((i) => o[ADS_HEAD[i.dataset.k]] = i.value); return o; });
  const rows = normalizeAds(recs, $('#ads-date').value, true);
  const d = await S.load(); const n = S.upsertAds(d, rows); await S.save(d);
  msg('#ads-msg', `${n}개 캠페인 저장됨`, 'ok'); loadSummary();
}

/* ---- 옵션/마진 ---- */
$('#opt-new-toggle').onclick = () => { $('#new-option').style.display = 'flex'; $('#no-id').focus(); };
$('#opt-new-save').onclick = async () => {
  const id = $('#no-id').value.trim(); if (!id) { msg('#opt-msg', '옵션ID 를 넣어 주세요', 'err'); return; }
  const d = await S.load(); S.upsertOption(d, { option_id: id, product_name: $('#no-name').value, campaign: $('#no-camp').value });
  if ($('#no-margin').value !== '') S.setMargin(d, id, parseNumber($('#no-margin').value) || 0, '');
  await S.save(d); ['#no-id', '#no-name', '#no-camp', '#no-margin'].forEach((s) => $(s).value = ''); msg('#opt-msg', '추가됨', 'ok'); loadOptions(); loadSummary();
};
async function loadOptions() {
  const d = await S.load();
  // 판매 데이터에 있지만 목록에 없는 옵션은 자동으로 목록에 넣는다 (캠페인·마진은 비어 있음)
  let added = false;
  for (const day of Object.values(d.sales)) for (const r of Object.values(day)) if (!d.options.find((o) => o.option_id === r.option_id)) { S.upsertOption(d, { option_id: r.option_id, product_name: r.option_name || r.product_name }); added = true; }
  if (added) await S.save(d);
  const lookup = S.marginLookup(d); const todayIso = localIso(today);
  const tb = $('#options-table tbody'); tb.innerHTML = '';
  for (const o of S.sortedOptions(d)) {
    const hist = S.marginHistory(d, o.option_id);
    const tr = document.createElement('tr');
    const missing = !o.campaign || !hist.length;
    tr.innerHTML = `<td>${esc(o.option_id)}</td>
      <td><input class="wide" data-k="product_name" value="${esc(o.product_name)}"></td>
      <td><input data-k="campaign" value="${esc(o.campaign)}" placeholder="캠페인 이름" ${!o.campaign ? 'style="border-color:#dc2626"' : ''}></td>
      <td style="text-align:right">${fmtInt(lookup(o.option_id, todayIso))}</td>
      <td><ul class="hist">${hist.map((m) => `<li><code>${m.effective_from || '처음부터'}</code> ${fmtInt(m.margin)}원 ${m.note ? '<span class="mini">' + esc(m.note) + '</span>' : ''} <a href="#" class="mini" data-del="${m.effective_from}">삭제</a></li>`).join('') || '<li class="mini" style="color:#dc2626">마진 없음 → 오른쪽에 마진을 넣고 저장</li>'}</ul></td>
      <td><div class="row"><input type="number" class="num" data-k="margin" placeholder="새 마진"><input type="date" class="date" data-k="effective_from" value="${hist.length ? todayIso : ''}"><input class="short" data-k="note" placeholder="사유(선택)"></div>
      <div class="mini">${hist.length ? '시작일부터 새 마진 적용' : '첫 마진은 시작일을 비워 두면 처음부터 적용'}</div></td>
      <td><button class="btn primary">저장</button> <button class="btn danger">삭제</button></td>`;
    if (missing) tr.style.background = '#fff7e0';
    const [save, del] = tr.querySelectorAll('button');
    save.onclick = async () => {
      const g = (k) => tr.querySelector(`[data-k=${k}]`).value;
      const dd = await S.load(); S.upsertOption(dd, { option_id: o.option_id, product_name: g('product_name'), campaign: g('campaign') });
      if (g('margin') !== '') S.setMargin(dd, o.option_id, parseNumber(g('margin')) || 0, g('effective_from') || '', g('note'));
      await S.save(dd); msg('#opt-msg', `${o.option_id} 저장됨`, 'ok'); loadOptions(); loadSummary();
    };
    del.onclick = async () => { if (confirm(`옵션 ${o.option_id} 를 목록에서 삭제할까요? (마진 이력도 삭제)`)) { const dd = await S.load(); S.deleteOption(dd, o.option_id); await S.save(dd); loadOptions(); } };
    tr.querySelectorAll('a[data-del]').forEach((a) => a.onclick = async (ev) => { ev.preventDefault(); if (confirm('이 마진 이력을 삭제할까요?')) { const dd = await S.load(); S.deleteMargin(dd, o.option_id, a.dataset.del); await S.save(dd); loadOptions(); } });
    tb.appendChild(tr);
  }
}

/* ---- 백업/복원/설정 ---- */
$('#backup').onclick = async () => { const d = await S.load(); download(`쿠팡광고계산기_백업_${localIso(today)}.json`, JSON.stringify(d, null, 1), 'application/json'); };
$('#restore').onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!d.sales || !d.ads) throw new Error('백업 파일 형식이 아닙니다');
    if (confirm('현재 데이터를 백업 파일 내용으로 바꿉니다. 계속할까요?')) { await S.replaceAll(d); msg('#data-msg', '복원됨', 'ok'); loadSummary(); loadLedger(); } }
  catch (e) { msg('#data-msg', e.message, 'err'); }
  ev.target.value = '';
};
$('#sales-csv').onclick = async () => {
  const d = await S.load(); const keys = ['date', 'option_id', 'option_name', 'product_name', 'product_id', 'category', 'sales_type', 'revenue', 'orders', 'quantity', 'visitors', 'views', 'carts', 'conversion'];
  const lines = [['날짜', '옵션ID', '옵션명', '상품명', '등록상품ID', '카테고리', '판매방식', '매출', '주문', '판매량', '방문자', '조회', '장바구니', '구매전환율'].join(',')];
  for (const date of Object.keys(d.sales).sort()) for (const r of Object.values(d.sales[date])) lines.push(keys.map((k) => csvEsc(r[k])).join(','));
  download('판매데이터.csv', lines.join('\n'));
};
$('#ads-csv').onclick = async () => {
  const d = await S.load(); const keys = ['date', 'campaign', 'target_roas', 'budget', 'spend', 'ad_revenue', 'conversion', 'ctr', 'impressions', 'clicks', 'ad_orders', 'action'];
  const lines = [['날짜', '캠페인', '목표효율', '광고예산', '집행광고비', '광고전환매출', '전환율', '클릭률', '노출수', '클릭수', '광고전환판매수', 'ACTION'].join(',')];
  for (const date of Object.keys(d.ads).sort()) for (const r of Object.values(d.ads[date])) lines.push(keys.map((k) => csvEsc(r[k])).join(','));
  download('광고데이터.csv', lines.join('\n'));
};
const SETTINGS = { salesUrl: 'https://wing.coupang.com/', adsUrl: 'https://advertising.coupang.com/', autoEnabled: false, autoTime: '13:00', waitSeconds: 12, serverSync: false, server: 'http://127.0.0.1:8765' };
async function loadSettings() {
  const s = await chrome.storage.sync.get(SETTINGS);
  for (const k of Object.keys(SETTINGS)) { const el = $('#set-' + k); if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k]; }
  const { logs = [] } = await chrome.storage.local.get('logs'); $('#auto-log').textContent = logs.slice(-20).join('\n') || '(자동 수집 기록 없음)';
}
$('#set-save').onclick = async () => {
  const out = {};
  for (const k of Object.keys(SETTINGS)) { const el = $('#set-' + k); out[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim(); }
  await chrome.storage.sync.set(out); msg('#set-msg', '저장됨', 'ok');
};
$('#run-auto').onclick = async () => { msg('#set-msg', '자동 수집 중… (탭이 열렸다 닫힙니다, 30초쯤 걸립니다)'); const rs = await chrome.runtime.sendMessage({ type: 'runAuto' }); msg('#set-msg', rs.every((r) => r.ok) ? '완료' : rs.map((r) => r.ok ? '성공' : r.error).join(' / '), rs.every((r) => r.ok) ? 'ok' : 'err'); loadSettings(); loadSummary(); loadLedger(); };

/* ---- 리포트 파일 올리기 ---- */
$('#import-sales').onchange = async (ev) => {
  const files = [...ev.target.files]; if (!files.length) return;
  const results = [];
  for (const f of files) {
    try { const r = await importSalesFile(await f.arrayBuffer(), f.name, $('#import-date').value || null); results.push(`${f.name} → ${r.date} 판매 ${r.saved}건 저장` + (r.unmapped ? ` (캠페인/마진 미입력 옵션 ${r.unmapped}개 → 옵션 · 마진 관리)` : '')); }
    catch (e) { results.push(`${f.name}: ${e.message}`); }
  }
  msg('#import-msg', results.join(' / '), results.some((r) => /실패|못|않/.test(r)) ? 'err' : 'ok');
  ev.target.value = ''; loadSummary(); loadLedger();
};
$('#import-ads').onchange = async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try { const r = await importAdsFile(await f.arrayBuffer(), f.name, $('#import-date').value || null); msg('#import-msg', `${f.name} → ${r.date} 광고 ${r.saved}건 저장`, 'ok'); }
  catch (e) { msg('#import-msg', e.message, 'err'); }
  ev.target.value = ''; loadSummary(); loadLedger();
};
$('#import-date').value = localIso(yday);

/* ---- 초기화 ---- */
$('#ads-date').value = localIso(yday);
loadSummary().then(loadLedger);
