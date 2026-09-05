// 서비스 워커: 매일 정해진 시각의 자동 수집(탭 열기 → '어제' 클릭 → 표 읽기 → 저장), 선택적 서버 전송.
import * as S from './lib/store.js';
import { normalizeSales, normalizeAds, yesterdayIso } from './lib/parse.js';
import { importAnyFile } from './lib/importer.js';
import { checkRemote, reloadIfFilesChanged } from './lib/update.js';

const DEFAULTS = { salesUrl: 'https://wing.coupang.com/tenants/business-insight/sales-analysis?start_date={date}&end_date={date}', adsUrl: 'https://advertising.coupang.com/marketing/dashboard/sales', autoEnabled: false, autoTime: '13:00', waitSeconds: 12, fillMissingDays: 7, ownWindow: true, serverSync: false, server: 'http://127.0.0.1:8765' };
let expectUntil = 0, expectDate = null;
let reportWaiter = null; // 리포트 다운로드 → 저장 결과를 기다리는 resolve
const waitForReport = (ms) => new Promise((resolve) => { reportWaiter = resolve; setTimeout(() => { if (reportWaiter === resolve) { reportWaiter = null; resolve({ ok: false, error: '다운로드 대기 시간 초과' }); } }, ms); });
const settle = (r) => { const w = reportWaiter; reportWaiter = null; if (w) w(r); };
const getSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function log(line) {
  const { logs = [] } = await chrome.storage.local.get('logs');
  logs.push(`${new Date().toLocaleString('ko-KR')} ${line}`);
  await chrome.storage.local.set({ logs: logs.slice(-100) });
}

async function saveLocal(kind, date, records) {
  const rows = kind === 'sales' ? normalizeSales(records, date) : normalizeAds(records, date);
  if (!rows.length) throw new Error(`${kind === 'sales' ? '판매' : '광고'} 표는 찾았지만 인식된 행이 없습니다`);
  const d = await S.load();
  const n = kind === 'sales' ? S.upsertSales(d, rows) : S.upsertAds(d, rows);
  await S.save(d);
  return n;
}

// 고급: 파이썬 서버(coupang_calc)로도 보내기. 실패하면 조용히 큐에 보관.
async function syncServer(kind, date, records) {
  const s = await getSettings();
  if (!s.serverSync) return;
  try {
    const r = await fetch(`${s.server}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, date, records }) });
    if (!r.ok) throw new Error(`서버 오류 ${r.status}`);
  } catch (e) {
    const { queue = [] } = await chrome.storage.local.get('queue');
    queue.push({ kind, date, records }); await chrome.storage.local.set({ queue: queue.slice(-50) });
    await log(`[서버] 전송 실패, 큐 보관: ${e.message}`);
  }
}
async function flushQueue() {
  const s = await getSettings(); if (!s.serverSync) return;
  const { queue = [] } = await chrome.storage.local.get('queue'); const left = [];
  for (const it of queue) { try { const r = await fetch(`${s.server}/api/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(it) }); if (!r.ok) left.push(it); } catch { left.push(it); } }
  await chrome.storage.local.set({ queue: left });
}

async function readFromTab(tabId, kind, type = 'read') {
  let ids = [0];
  try { const frames = await chrome.webNavigation.getAllFrames({ tabId }); if (frames) ids = frames.map((f) => f.frameId); } catch { /* 무시 */ }
  let best = null;
  for (const frameId of ids) {
    try { const r = await chrome.tabs.sendMessage(tabId, { type, kind }, { frameId }); if (r?.ok && (!best || r.records.length > best.records.length)) best = r; } catch { /* 무시 */ }
  }
  return best;
}
const inject = (tabId) => chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }).catch(() => {});
// 백그라운드 탭은 화면이 늦게 그려질 수 있다 → 표가 보일 때까지 정해진 시간까지 다시 읽어 본다
async function readWithRetry(tabId, kind, deadline) {
  for (;;) {
    await inject(tabId);
    const r = await readFromTab(tabId, kind);
    if (r) return r;
    if (Date.now() >= deadline) return null;
    await sleep(2500);
  }
}

// 페이지 안(MAIN world)에서 실행되는 훅. 확장이 연 창에는 '사용자 클릭' 이 없어 window.open / target=_blank 로 여는
// 다운로드가 팝업 차단에 걸린다 → 새 창을 열지 않고 그 주소만 이벤트로 넘겨 확장이 직접 받는다.
function pageDownloadHook() {
  if (window.__ccHooked) return; window.__ccHooked = true;
  const abs = (u) => { try { return new URL(String(u), location.href).href; } catch { return String(u); } };   // '/fcc/download/…' 같은 상대 주소 → 절대 주소
  const send = (url, how) => { try { document.dispatchEvent(new CustomEvent('cc-download-url', { detail: { url: abs(url), how } })); } catch { /* 무시 */ } };
  const fakeWindow = (how) => {
    let href = '';
    const loc = { assign: (u) => send(u, how + '.assign'), replace: (u) => send(u, how + '.replace'), toString: () => href };
    Object.defineProperty(loc, 'href', { get: () => href, set: (u) => { href = String(u); send(u, how + '.href'); } });
    return { closed: false, close() {}, focus() {}, blur() {}, location: loc, document: { write() {}, close() {} }, opener: window };
  };
  window.open = function (url) { if (url && String(url) !== 'about:blank') { send(url, 'window.open'); return fakeWindow('window.open'); } return fakeWindow('window.open()'); };
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[target="_blank"][href]') : null;
    if (a && /^https?:/.test(a.href) && !/^javascript:/.test(a.getAttribute('href') || '')) { e.preventDefault(); e.stopImmediatePropagation(); send(a.href, 'a[target=_blank]'); }
  }, true);
  document.addEventListener('submit', (e) => {
    const f = e.target; if (!f || f.target !== '_blank') return;
    if ((f.method || 'get').toLowerCase() === 'get') { e.preventDefault(); const u = new URL(f.action || location.href); new FormData(f).forEach((v, k) => u.searchParams.set(k, v)); send(u.href, 'form[target=_blank]'); }
  }, true);
}
const installHook = (tabId) => chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: pageDownloadHook }).catch(() => {});
let lastHookedUrl = null;   // 가로챈 다운로드 주소 (진단용)
const recentHooked = new Map();   // 같은 주소가 잇달아 두 번 잡히면(메뉴 클릭 이벤트가 겹침) 한 번만 받는다
let lastReportSavedAt = 0;        // 메뉴 클릭이 두 번 먹으면 새 파일 주소가 또 생기므로, 저장 직후 60초 안의 주소는 무시
async function fetchAndImport(url, how, baseUrl) {
  try { url = new URL(url, baseUrl || undefined).href; } catch { /* 그대로 */ }
  if (Date.now() - lastReportSavedAt < 60000) return;
  const seen = recentHooked.get(url); if (seen && Date.now() - seen < 60000) return; recentHooked.set(url, Date.now());
  lastHookedUrl = { url, how, at: Date.now() };
  try {
    const r = await fetch(url, { credentials: 'include' }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const cd = r.headers.get('content-disposition') || ''; const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
    let name = m ? decodeURIComponent(m[1]) : (new URL(url).pathname.split('/').pop() || 'report.xlsx');
    if (!/\.(xlsx|xls|csv)$/i.test(name)) name += '.xlsx';
    const buf = await r.arrayBuffer();
    const res = await importAnyFile(buf, name, expectDate);
    expectDate = null;
    const label = res.kind === 'ads' ? '광고' : '판매';
    await log(`[다운로드] ${how} 로 받은 ${name} → ${res.date} ${label} ${res.saved}건 저장`);
    lastReportSavedAt = Date.now();
    settle({ ok: true, saved: res.saved, date: res.date });
  } catch (e) {
    await log(`[다운로드] 주소를 직접 받아 읽지 못해(${e.message}) 크롬 다운로드로 넘깁니다: ${url.slice(0, 120)}`);
    try { await chrome.downloads.download({ url }); } catch (e2) { settle({ ok: false, error: `다운로드 시작 실패: ${e2.message}` }); }
  }
}

// 수집용 탭. 크롬은 보이지 않는(배경) 탭에서 화면 그리기를 멈추기 때문에, 기본은 작은 창을 따로 띄워 보이게 한다.
async function openWorkTab(url, s) {
  if (!s.ownWindow) { const tab = await chrome.tabs.create({ url, active: false }); return { tab, close: () => chrome.tabs.remove(tab.id).catch(() => {}) }; }
  let prev = null; try { prev = await chrome.windows.getLastFocused(); } catch { /* 무시 */ }
  const win = await chrome.windows.create({ url, focused: true, type: 'normal', width: 1280, height: 860 });
  const tab = win.tabs?.[0] || (await chrome.tabs.query({ windowId: win.id }))[0];
  return { tab, close: async () => { await chrome.windows.remove(win.id).catch(() => {}); if (prev?.id && prev.id !== win.id) await chrome.windows.update(prev.id, { focused: true }).catch(() => {}); } };
}
// 실패했을 때 화면이 어땠는지 (로그인 화면인지, 아직 비어 있는지) 한 줄로
async function describePage(tabId) {
  try { const p = await chrome.tabs.sendMessage(tabId, { type: 'pageInfo' }); return `화면: "${(p.title || '').slice(0, 30)}" 글자 ${p.textLength}자, 캠페인 글자 ${p.hasCampaignText ? '있음' : '없음'}, 엑셀 다운로드 ${p.hasExcelDownload ? '있음' : '없음'}${p.hasLogin ? ', 로그인 화면으로 보임' : ''}`; }
  catch { return '화면 상태를 읽지 못함(스크립트 미주입)'; }
}

// 광고센터는 캠페인 목록(이름·목표·예산)을 먼저 그리고 성과 숫자(광고비·노출·클릭)는 뒤에 채운다.
// 성과 숫자가 하나라도 들어오고, 3초 간격 두 번 읽은 내용이 같아질 때까지 기다린다.
const NUM_HEADER = /노출|클릭|광고비|매출|전환/;
const hasNumbers = (r) => r?.records?.some((rec) => Object.entries(rec).some(([k, v]) => NUM_HEADER.test(k) && parseFloat(String(v).replace(/[^\d.]/g, '')) > 0));
async function readAdsSettled(tabId, deadline) {
  let prev = null;
  for (;;) {
    await inject(tabId);
    const r = await readFromTab(tabId, 'ads');
    if (r) {
      const same = prev && JSON.stringify(prev.records) === JSON.stringify(r.records);
      if (hasNumbers(r) && same) return r;
      if (Date.now() >= deadline) { r.notes = [...(r.notes || []), hasNumbers(r) ? '숫자 안정 전 마감' : '성과 숫자 없음(0)']; return r; }
      prev = r;
    } else if (Date.now() >= deadline) return null;
    await sleep(3000);
  }
}

// 주소가 도메인만이거나 목록 화면이 아닐 때 무엇을 고쳐야 하는지 알려 준다
function urlHint(kind, baseUrl) {
  const bare = /^https?:\/\/[^/]+\/?$/.test(String(baseUrl || '').trim());
  if (kind === 'ads' && (bare || !/\/marketing\//.test(baseUrl))) {
    return `광고 관리 주소가 캠페인 목록 화면이 아닙니다 (${baseUrl}). 광고센터 → 광고 관리 → 매출 성장 화면을 연 뒤 그 주소를 넣거나, 설정의 '기본 주소로' 를 누르세요 (${DEFAULTS.adsUrl})`;
  }
  if (kind === 'sales' && bare) return `판매분석 주소가 도메인만 있습니다 (${baseUrl}). 설정의 '기본 주소로' 를 누르세요 (${DEFAULTS.salesUrl})`;
  return null;
}

async function collectKind(kind, dateOverride) {
  const s = await getSettings();
  const target = dateOverride || yesterdayIso();
  const baseUrl = kind === 'sales' ? s.salesUrl : s.adsUrl;
  // 날짜를 콕 집어 받는데 주소에 {date} 가 없으면, 화면에 뜬 날(보통 어제) 값을 그 날짜로 잘못 저장하게 된다 → 미리 막는다
  if (dateOverride && !baseUrl.includes('{date}') && dateOverride !== yesterdayIso()) {
    throw new Error(`${kind === 'sales' ? '판매분석' : '광고 관리'} 주소에 {date} 가 없어 ${dateOverride} 를 열 수 없습니다. 광고센터에서 기간을 정해 보고서를 받아 '파일 올리기' 로 올리거나, 주소에 {date} 를 넣어 주세요`);
  }
  const url = baseUrl.replace(/\{date\}/g, target);
  const { tab, close } = await openWorkTab(url, s);
  const deadline = Date.now() + s.waitSeconds * 1000 + (kind === 'ads' ? 70000 : 45000);   // 화면이 늦게 떠도 이 시간까지는 기다린다
  try {
    await sleep(Math.min(s.waitSeconds, 8) * 1000);
    await inject(tab.id);
    const needYesterday = !url.includes('{date}') && !url.includes(target);
    if (needYesterday) { try { await chrome.tabs.sendMessage(tab.id, { type: 'clickYesterday' }); await sleep(4000); } catch { /* 무시 */ } }
    let r = kind === 'ads' ? await readAdsSettled(tab.id, deadline) : await readWithRetry(tab.id, kind, Date.now() + s.waitSeconds * 1000);
    if (r && kind === 'ads') {
      // 화면이 어제 하루가 아니면(다른 날, 또는 여러 날 합계) 한 번 더 '어제' 를 눌러 보고, 그래도 아니면 저장하지 않는다
      const wrong = (x) => (x?.period && x.period.start !== x.period.end) || (x?.date && x.date !== target);
      if (wrong(r)) {
        const c = await chrome.tabs.sendMessage(tab.id, { type: 'clickYesterday' }).catch(() => ({ clicked: false }));
        await sleep(4000); await inject(tab.id);
        r = (await readFromTab(tab.id, kind)) || r;
        if (wrong(r)) {
          const shown = r.period && r.period.start !== r.period.end ? `${r.period.start} ~ ${r.period.end} (여러 날 합계)` : r.date;
          throw new Error(`광고센터 화면 기간이 ${shown} 이라 어제(${target}) 값이 아닙니다. '어제' 버튼을 ${c?.clicked ? '눌렀지만 바뀌지 않았습니다' : '찾지 못했습니다'} — 저장하지 않았습니다. 광고센터에서 기간을 '어제' 로 바꿔 두면 다음부터 그대로 열립니다`);
        }
      }
      // 여러 쪽이면 전체 읽기. 끝 쪽까지 못 갔으면 3초 뒤 한 번 더.
      let full = await readFromTab(tab.id, kind, 'readAll');
      if (full && full.total > 1 && (full.pages || 0) < full.total) { await sleep(3000); const again = await readFromTab(tab.id, kind, 'readAll'); if (again?.records?.length > (full.records?.length || 0)) full = again; }
      if (full?.records?.length > r.records.length) r = { ...full, notes: [...(r.notes || []), ...(full.notes || [])] };
      else if (full) r.notes = [...(r.notes || []), ...(full.notes || []), `전체 읽기 ${full.pages || '?'}쪽/${full.total || '?'}쪽 ${full.records?.length || 0}건`];
      if (!hasNumbers(r)) throw new Error(`광고 목록 ${r.records.length}줄을 읽었지만 광고비·노출·클릭이 모두 0입니다 (성과 숫자가 아직 안 채워진 것으로 보여 저장하지 않았습니다). 설정의 대기(초)를 올려 보세요`);
      // 일부 줄만 성과가 0이면(늦게 채워지는 줄) 3초 뒤 한 번 더 읽어, 캠페인별로 숫자가 있는 쪽을 쓴다
      const rowHasNumbers = (rec) => Object.entries(rec).some(([k, v]) => NUM_HEADER.test(k) && parseFloat(String(v).replace(/[^\d.]/g, '')) > 0);
      let zeros = r.records.filter((rec) => !rowHasNumbers(rec)).length;
      if (zeros) {
        await sleep(3000);
        const again = await readFromTab(tab.id, kind, 'readAll');
        if (again?.records?.length) {
          const key = (rec) => String(Object.values(rec)[0] || '');
          const byName = new Map(again.records.map((rec) => [key(rec), rec]));
          r.records = r.records.map((rec) => (!rowHasNumbers(rec) && rowHasNumbers(byName.get(key(rec)) || {}) ? byName.get(key(rec)) : rec));
          for (const rec of again.records) if (!r.records.some((x) => key(x) === key(rec))) r.records.push(rec);
          const left = r.records.filter((rec) => !rowHasNumbers(rec)).length;
          r.notes = [...(r.notes || []), `성과 0인 줄 ${zeros}개 → 다시 읽어 ${zeros - left}개 채움${left ? `, ${left}개는 여전히 0` : ''}`];
        }
      }
    }
    if (!r && kind === 'sales') {
      // 판매분석은 표가 없다 → 엑셀 다운로드 → 상품별 판매 리포트. 다운로드 감지가 이어서 저장한다.
      let c = null;
      for (let i = 0; i < 3 && Date.now() < deadline; i++) {
        await inject(tab.id);
        c = await chrome.tabs.sendMessage(tab.id, { type: 'clickDownloadReport' }).catch(() => null);
        if (c?.ok) break;
        await sleep(4000);
      }
      if (!c?.ok) throw new Error(`${c?.reason || '엑셀 다운로드 버튼을 찾지 못했습니다'} (${url}) — ${await describePage(tab.id)}. 화면이 다 뜨기 전이면 설정의 '대기(초)' 를 올려 보세요`);
      // 버튼은 찾았다 → 새 창 열기를 가로채는 훅을 심고 실제로 누른 뒤 파일을 기다린다. 30초 안에 안 오면 한 번 더 누른다.
      await installHook(tab.id);
      expectUntil = Date.now() + 150000; expectDate = target; lastHookedUrl = null;
      let res = null;
      for (let i = 0; i < 2 && !res?.ok; i++) {
        const waiting = waitForReport(i === 0 ? 30000 : 60000);
        await chrome.tabs.sendMessage(tab.id, { type: 'clickDownloadReport' }).catch(() => null);
        res = await waiting; // 훅(fetchAndImport) 또는 downloads.onChanged 에서 저장이 끝나면 풀린다
      }
      if (!res?.ok) throw new Error(`${res?.error || '리포트 저장 실패'} — 다운로드 메뉴는 눌렀지만 파일이 내려오지 않았습니다 (${await describePage(tab.id)}${lastHookedUrl ? `, 가로챈 주소 ${lastHookedUrl.how}` : ', 새 창 열기 감지 안 됨'}). 크롬 설정의 '다운로드 전에 저장 위치 묻기' 가 켜져 있으면 꺼 주세요`);
      return { ok: true, saved: res.saved, date: res.date };
    }
    if (!r) throw new Error(urlHint(kind, baseUrl) || `${kind === 'sales' ? '판매' : '광고'} 표를 찾지 못했습니다 (${url}) — ${await describePage(tab.id)}. 로그인이 풀렸거나 화면이 아직 안 그려진 것일 수 있습니다`);
    // 화면에 뜬 날짜가 요청한 날짜와 다르면 저장하지 않는다 (다른 날 숫자가 그 날짜로 들어가는 사고 방지)
    if (dateOverride && r.date && r.date !== dateOverride) throw new Error(`화면에 보이는 날짜(${r.date})가 요청한 날짜(${dateOverride})와 달라 저장하지 않았습니다`);
    const date = dateOverride || r.date || yesterdayIso();
    const n = await saveLocal(kind, date, r.records);
    await syncServer(kind, date, r.records);
    await log(`[자동] ${kind === 'sales' ? '판매' : '광고'} ${date} ${n}건 저장` + (kind === 'ads' ? ` (${r.pages ? `${r.pages}/${r.total || '?'}쪽` : '1쪽'}${r.notes?.length ? ', ' + r.notes.join(', ') : ''})` : ''));
    return { ok: true, saved: n, date };
  } finally { await close(); }
}

// ---- 특정 날짜/기간 수집 (앱 페이지의 '지난 날짜 채우기', 자동 수집의 빠진 날 보충) ----
const job = { running: false, total: 0, done: 0, log: [], cancel: false };
function isoRange(start, end) { const out = []; const d = new Date(start + 'T00:00:00'); const e = new Date(end + 'T00:00:00'); for (; d <= e; d.setDate(d.getDate() + 1)) out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); return out; }
async function missingDates(dates, kinds) {
  const d = await S.load();
  return dates.filter((date) => (kinds.includes('sales') && !d.sales[date]) || (kinds.includes('ads') && !d.ads[date]));
}
async function collectRange(start, end, kinds, onlyMissing) {
  if (job.running) return { ok: false, error: '이미 수집 중입니다' };
  let dates = isoRange(start, end).filter((x) => x < yesterdayIso() || x === yesterdayIso());
  if (onlyMissing) dates = await missingDates(dates, kinds);
  Object.assign(job, { running: true, total: dates.length * kinds.length, done: 0, log: [], cancel: false });
  if (!dates.length) { job.log.push('가져올 날짜가 없습니다 (이미 모두 저장됨)'); job.running = false; return { ok: true }; }
  const s = await getSettings();
  for (const date of dates) {
    for (const kind of kinds) {
      if (job.cancel) break;
      const d = await S.load();
      if (onlyMissing && ((kind === 'sales' && d.sales[date]) || (kind === 'ads' && d.ads[date]))) { job.done++; continue; }
      if (kind === 'ads' && !s.adsUrl.includes('{date}')) { job.log.push(`${date} 광고: 광고 관리 주소에 {date} 가 없어 자동으로 열 수 없습니다 (광고센터에서 날짜를 고른 뒤 팝업의 날짜를 맞추고 ② 를 누르세요)`); job.done++; continue; }
      try { const r = await collectKind(kind, date); job.log.push(`${date} ${kind === 'sales' ? '판매' : '광고'}: ${r.saved}건 저장`); }
      catch (e) { job.log.push(`${date} ${kind === 'sales' ? '판매' : '광고'}: 실패 — ${e.message}`); }
      job.done++;
    }
    if (job.cancel) { job.log.push('중단됨'); break; }
  }
  job.running = false;
  const okN = job.log.filter((l) => l.includes('저장')).length, failN = job.log.filter((l) => l.includes('실패')).length;
  await log(`[기간 수집] ${start}~${end} ${job.total === 0 ? '빠진 날 없음' : `완료: ${okN}건 저장${failN ? `, ${failN}건 실패` : ''}`}`);
  return { ok: true };
}

// 쿠팡 화면은 가끔 덜 그려진 채 열린다 → 실패하면 창을 닫고 새로 열어 한 번 더 (총 2번)
async function collectWithRetry(kind, dateOverride, tries = 2) {
  let lastErr = null;
  for (let i = 1; i <= tries; i++) {
    try { return await collectKind(kind, dateOverride); }
    catch (e) { lastErr = e; if (i < tries) { await log(`[자동] ${kind === 'sales' ? '판매' : '광고'} ${i}번째 실패, 창을 새로 열어 다시 시도: ${e.message.slice(0, 80)}`); await sleep(8000); } }
  }
  throw lastErr;
}
const RETRY_MAX = 3;
async function runAuto(dateOverride, kinds = ['sales', 'ads']) {
  await fixUrls();
  const results = [];
  for (const kind of kinds) {
    try { results.push({ kind, ...(await collectWithRetry(kind, dateOverride)) }); }
    catch (e) { await log(`[자동] ${kind === 'sales' ? '판매' : '광고'} 실패: ${e.message}`); results.push({ kind, ok: false, error: e.message }); }
  }
  const okAll = results.every((r) => r.ok);
  await chrome.storage.local.set({ lastAuto: { at: Date.now(), date: dateOverride || yesterdayIso(), ok: okAll, detail: results.map((r) => (r.ok ? `${r.date} ${r.saved}건` : r.error)).join(' / ') } });
  // 실패한 종류만 10분 뒤 자동으로 다시 (하루 최대 3번). 사람이 다시 누를 필요가 없게.
  if (!dateOverride) {
    const failed = results.filter((r) => !r.ok).map((r) => r.kind);
    const { autoRetry = { count: 0, date: null } } = await chrome.storage.local.get('autoRetry');
    const count = autoRetry.date === yesterdayIso() ? autoRetry.count : 0;
    if (failed.length && count < RETRY_MAX) {
      await chrome.storage.local.set({ autoRetry: { count: count + 1, date: yesterdayIso(), kinds: failed } });
      await chrome.alarms.create('retry-auto', { delayInMinutes: 10 });
      await log(`[자동] ${failed.map((k) => (k === 'sales' ? '판매' : '광고')).join('·')} 를 10분 뒤 다시 시도합니다 (${count + 1}/${RETRY_MAX})`);
    } else if (!failed.length && autoRetry.date === yesterdayIso()) { await chrome.storage.local.remove('autoRetry'); }
  }
  try { chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: '쿠팡 광고계산기', message: okAll ? '어제 판매·광고 데이터를 저장했습니다.' : '일부 수집이 실패했습니다. 10분 뒤 자동으로 다시 시도합니다.' }); } catch { /* 무시 */ }
  // 최근 N일 중 빠진 날도 채운다 (설정)
  const s = await getSettings();
  if (!dateOverride && s.fillMissingDays > 0) {
    const y = yesterdayIso(); const from = new Date(y + 'T00:00:00'); from.setDate(from.getDate() - (s.fillMissingDays - 1));
    const start = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    await collectRange(start, y, ['sales', 'ads'], true);
  }
  return results;
}

// 설정한 주소가 쓸 만한지 확인만 한다 (저장하지 않음)
async function testUrl(kind) {
  const s = await getSettings();
  const baseUrl = kind === 'sales' ? s.salesUrl : s.adsUrl;
  const hint = urlHint(kind, baseUrl);
  const target = yesterdayIso();
  const url = baseUrl.replace(/\{date\}/g, target);
  const { tab, close } = await openWorkTab(url, s);
  try {
    const deadline = Date.now() + s.waitSeconds * 1000 + 30000;
    await sleep(Math.min(s.waitSeconds, 8) * 1000);
    await inject(tab.id);
    if (!url.includes(target)) { try { await chrome.tabs.sendMessage(tab.id, { type: 'clickYesterday' }); await sleep(4000); } catch { /* 무시 */ } }
    const r = await readWithRetry(tab.id, kind, deadline);
    let download = null;
    if (!r && kind === 'sales') { await inject(tab.id); download = await chrome.tabs.sendMessage(tab.id, { type: 'clickDownloadReport', dryRun: true }).catch(() => null); }
    const page = (!r && !download?.ok) ? await describePage(tab.id) : null;
    return { ok: !!r || !!download?.ok, rows: r?.records?.length || 0, headers: r?.headers?.slice(0, 8) || [], date: r?.date || null, url, hint, page, download: download?.ok ? '엑셀 다운로드 버튼을 찾았습니다' : null };
  } finally { await close(); }
}

async function scheduleAlarm() {
  const s = await getSettings();
  await chrome.alarms.clear('daily');
  if (!s.autoEnabled) return;
  const [hh, mm] = s.autoTime.split(':').map(Number);
  const next = new Date(); next.setHours(hh, mm, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  await chrome.alarms.create('daily', { when: next.getTime(), periodInMinutes: 24 * 60 });
}

// 주소가 도메인만 저장돼 있으면(예: https://advertising.coupang.com/) 기본 주소로 되돌린다
async function fixUrls() {
  const s = await getSettings(); const out = {};
  const bare = (u) => /^https?:\/\/[^/]+\/?$/.test(String(u || '').trim());
  if (bare(s.adsUrl) || !s.adsUrl) out.adsUrl = DEFAULTS.adsUrl;
  if (bare(s.salesUrl) || !s.salesUrl) out.salesUrl = DEFAULTS.salesUrl;
  if (Object.keys(out).length) { await chrome.storage.sync.set(out); await log(`[설정] 주소가 도메인만 있어 기본값으로 되돌렸습니다: ${Object.entries(out).map(([k, v]) => `${k}=${v}`).join(', ')}`); }
}

chrome.runtime.onInstalled.addListener((d) => { fixUrls(); scheduleAlarm(); scheduleUpdateAlarms(); if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }); if (d.reason === 'update') chrome.storage.local.set({ justUpdatedTo: chrome.runtime.getManifest().version }); });
async function scheduleUpdateAlarms() {
  await chrome.alarms.create('update-remote', { periodInMinutes: 360 });   // 새 버전 있는지
  await chrome.alarms.create('update-disk', { periodInMinutes: 1 });       // 업데이트.bat 이 파일을 바꿨는지
  checkRemote(true);
}
chrome.runtime.onStartup.addListener(() => { fixUrls(); scheduleAlarm(); scheduleUpdateAlarms(); flushQueue(); chrome.alarms.create('catchup', { delayInMinutes: 2 }); });

// 크롬이 꺼져 있어서 정해진 시각을 놓쳤으면, 켜진 뒤 한 번 따라잡는다.
async function catchUp() {
  const s = await getSettings();
  if (!s.autoEnabled) return;
  const { lastAuto } = await chrome.storage.local.get('lastAuto');
  const y = yesterdayIso();
  if (lastAuto && lastAuto.date >= y) return;          // 이미 어제 것을 받았다
  const [hh, mm] = s.autoTime.split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;   // 아직 그 시각 전이면 알람에 맡긴다
  await log(`[자동] 놓친 ${y} 수집을 지금 따라잡습니다`);
  await runAuto();
}
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && (ch.autoEnabled || ch.autoTime)) scheduleAlarm(); });
async function retryAuto() {
  const { autoRetry } = await chrome.storage.local.get('autoRetry');
  if (!autoRetry || autoRetry.date !== yesterdayIso()) return;
  await log(`[자동] 다시 시도 (${autoRetry.count}/${RETRY_MAX}): ${autoRetry.kinds.map((k) => (k === 'sales' ? '판매' : '광고')).join('·')}`);
  await runAuto(undefined, autoRetry.kinds);
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'daily') runAuto(); else if (a.name === 'retry-auto') retryAuto(); else if (a.name === 'catchup') catchUp(); else if (a.name === 'update-remote') checkRemote(true); else if (a.name === 'update-disk') reloadIfFilesChanged(); });
// ---- 판매 리포트 다운로드 감지: 팝업 ① 이 다운로드를 누른 뒤(또는 사용자가 직접 받은 뒤) 파일을 다시 받아 저장한다.
const handled = new Set();
const looksLikeReport = (item) => /(판매|sales|report|리포트)/i.test(item.filename || '') || /(report|sales|excel|download)/i.test(item.finalUrl || item.url || '');
chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state?.current !== 'complete' || handled.has(delta.id)) return;
  const [item] = await chrome.downloads.search({ id: delta.id }); if (!item) return;
  const ext = (item.filename || '').toLowerCase().match(/\.(xlsx|xls|csv)$/)?.[1];
  const fromCoupang = /coupang\.com/.test(item.finalUrl || item.url || '') || /coupang\.com/.test(item.referrer || '');
  const expected = Date.now() < expectUntil; // ① 을 누른 직후 2분 안의 엑셀은 이름과 상관없이 리포트로 본다
  if (!ext || !(expected || (fromCoupang && looksLikeReport(item)))) return;
  handled.add(delta.id);
  const url = item.finalUrl || item.url;
  if (!/^https?:/.test(url)) { await log(`[다운로드] 파일을 자동으로 읽을 수 없는 방식(blob)입니다. 장부 보기 → 리포트 파일 올리기 로 올려 주세요: ${item.filename}`); notify('리포트를 자동으로 읽지 못했습니다. 장부 보기 → 리포트 파일 올리기 로 방금 받은 파일을 올려 주세요.'); settle({ ok: false, error: 'blob 다운로드는 자동으로 읽을 수 없습니다. 파일을 직접 올려 주세요' }); return; }
  try {
    const r = await fetch(url, { credentials: 'include' }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const name = item.filename.split(/[\\/]/).pop();
    const res = await importAnyFile(await r.arrayBuffer(), name, expectDate);
    expectDate = null;
    const label = res.kind === 'ads' ? '광고' : '판매';
    await log(`[다운로드] ${name} → ${res.date} ${label} ${res.saved}건 저장`);
    if (!reportWaiter) notify(`${res.date} ${label} 데이터 ${res.saved}건 저장 완료` + (res.unmapped ? ` · 캠페인/마진 미입력 옵션 ${res.unmapped}개` : ''));
    settle({ ok: true, saved: res.saved, date: res.date });
  } catch (e) {
    await log(`[다운로드] 자동 저장 실패: ${e.message}`);
    if (!reportWaiter) notify('리포트 자동 저장에 실패했습니다. 장부 보기 → 리포트 파일 올리기 로 방금 받은 파일을 올려 주세요.');
    settle({ ok: false, error: e.message });
  }
});
function notify(message) { try { chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: '쿠팡 광고계산기', message }); } catch { /* 무시 */ } }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'downloadUrl') { sendResponse({ ok: true }); if (msg.url && Date.now() < expectUntil) await fetchAndImport(msg.url, msg.how || '', sender?.tab?.url || sender?.url); else await log(`[다운로드] 기다리는 중이 아닐 때 새 창 주소가 잡혔습니다 (무시): ${String(msg.url || '').slice(0, 100)}`); }
    else if (msg.type === 'expectReport') { expectUntil = Date.now() + 120000; expectDate = msg.date || null; sendResponse({ ok: true }); }
    else if (msg.type === 'collectRange') { collectRange(msg.start, msg.end, msg.kinds, msg.onlyMissing); sendResponse({ ok: true }); }
    else if (msg.type === 'jobStatus') sendResponse(job);
    else if (msg.type === 'checkUpdate') { sendResponse({ latest: await checkRemote(true), reloaded: await reloadIfFilesChanged() }); }
    else if (msg.type === 'cancelJob') { job.cancel = true; sendResponse({ ok: true }); }
    else if (msg.type === 'collectDate') { try { sendResponse(await collectKind(msg.kind, msg.date)); } catch (e) { sendResponse({ ok: false, error: e.message }); } }
    else if (msg.type === 'runAuto') sendResponse(await runAuto(msg.date));
    else if (msg.type === 'testUrl') { try { sendResponse(await testUrl(msg.kind)); } catch (e) { sendResponse({ ok: false, error: e.message }); } }
    else if (msg.type === 'autoStatus') {
      const s = await getSettings(); const al = await chrome.alarms.get('daily').catch(() => null);
      const { lastAuto = null } = await chrome.storage.local.get('lastAuto');
      sendResponse({ enabled: s.autoEnabled, time: s.autoTime, nextAt: al?.scheduledTime || null, lastAuto });
    }
    else if (msg.type === 'syncServer') { await syncServer(msg.kind, msg.date, msg.records); sendResponse({ ok: true }); }
    else { console.log('[cc] unknown message', JSON.stringify(msg)); sendResponse({ ok: false }); }
  })().catch((e) => { console.log('[cc] handler error', String(e && e.stack || e)); try { sendResponse({ ok: false, error: e.message }); } catch { /* 무시 */ } });
  return true;
});
