// 서비스 워커: 매일 정해진 시각의 자동 수집(탭 열기 → '어제' 클릭 → 표 읽기 → 저장), 선택적 서버 전송.
import * as S from './lib/store.js';
import { normalizeSales, normalizeAds, yesterdayIso } from './lib/parse.js';
import { importAnyFile } from './lib/importer.js';
import { checkRemote, reloadIfFilesChanged } from './lib/update.js';

const DEFAULTS = { salesUrl: 'https://wing.coupang.com/tenants/business-insight/sales-analysis?start_date={date}&end_date={date}', adsUrl: 'https://advertising.coupang.com/', autoEnabled: false, autoTime: '13:00', waitSeconds: 12, fillMissingDays: 7, serverSync: false, server: 'http://127.0.0.1:8765' };
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

async function readFromTab(tabId, kind) {
  let ids = [0];
  try { const frames = await chrome.webNavigation.getAllFrames({ tabId }); if (frames) ids = frames.map((f) => f.frameId); } catch { /* 무시 */ }
  let best = null;
  for (const frameId of ids) {
    try { const r = await chrome.tabs.sendMessage(tabId, { type: 'read', kind }, { frameId }); if (r?.ok && (!best || r.records.length > best.records.length)) best = r; } catch { /* 무시 */ }
  }
  return best;
}

async function collectKind(kind, dateOverride) {
  const s = await getSettings();
  const target = dateOverride || yesterdayIso();
  const url = (kind === 'sales' ? s.salesUrl : s.adsUrl).replace(/\{date\}/g, target);
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await sleep(s.waitSeconds * 1000);
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] }); } catch { /* 이미 있음 */ }
    if (!url.includes('{date}') && !url.includes(target)) { try { await chrome.tabs.sendMessage(tab.id, { type: 'clickYesterday' }); await sleep(4000); } catch { /* 무시 */ } }
    let r = await readFromTab(tab.id, kind);
    if (!r && kind === 'sales') {
      // 판매분석은 표가 없다 → 엑셀 다운로드 → 상품별 판매 리포트. 다운로드 감지가 이어서 저장한다.
      expectUntil = Date.now() + 120000; expectDate = target;
      const waiting = waitForReport(90000);
      const c = await chrome.tabs.sendMessage(tab.id, { type: 'clickDownloadReport' }).catch(() => null);
      if (!c?.ok) { settle(null); throw new Error(c?.reason || '엑셀 다운로드 버튼을 찾지 못했습니다'); }
      const res = await waiting; // onChanged 에서 저장이 끝나면 풀린다
      if (!res?.ok) throw new Error(res?.error || '리포트 저장 실패');
      return { ok: true, saved: res.saved, date: res.date };
    }
    if (!r) throw new Error(`${kind === 'sales' ? '판매' : '광고'} 표를 찾지 못했습니다. 로그인이 풀렸거나 주소가 다를 수 있습니다 (${url})`);
    const date = dateOverride || r.date || yesterdayIso();
    const n = await saveLocal(kind, date, r.records);
    await syncServer(kind, date, r.records);
    await log(`[자동] ${kind === 'sales' ? '판매' : '광고'} ${date} ${n}건 저장`);
    return { ok: true, saved: n, date };
  } finally { await chrome.tabs.remove(tab.id).catch(() => {}); }
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
  await log(`[기간 수집] ${start}~${end} 완료: ${job.log.filter((l) => l.includes('저장')).length}건 성공`);
  return { ok: true };
}

async function runAuto(dateOverride) {
  const results = [];
  for (const kind of ['sales', 'ads']) {
    try { results.push(await collectKind(kind, dateOverride)); }
    catch (e) { await log(`[자동] ${kind === 'sales' ? '판매' : '광고'} 실패: ${e.message}`); results.push({ ok: false, error: e.message }); }
  }
  const okAll = results.every((r) => r.ok);
  try { chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: '쿠팡 광고계산기', message: okAll ? '어제 판매·광고 데이터를 저장했습니다.' : '일부 수집이 실패했습니다. 장부 보기 → 백업 · 설정의 기록을 확인하세요.' }); } catch { /* 무시 */ }
  // 최근 N일 중 빠진 날도 채운다 (설정)
  const s = await getSettings();
  if (!dateOverride && s.fillMissingDays > 0) {
    const y = yesterdayIso(); const from = new Date(y + 'T00:00:00'); from.setDate(from.getDate() - (s.fillMissingDays - 1));
    const start = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    await collectRange(start, y, ['sales', 'ads'], true);
  }
  return results;
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

chrome.runtime.onInstalled.addListener((d) => { scheduleAlarm(); scheduleUpdateAlarms(); if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }); if (d.reason === 'update') chrome.storage.local.set({ justUpdatedTo: chrome.runtime.getManifest().version }); });
async function scheduleUpdateAlarms() {
  await chrome.alarms.create('update-remote', { periodInMinutes: 360 });   // 새 버전 있는지
  await chrome.alarms.create('update-disk', { periodInMinutes: 1 });       // 업데이트.bat 이 파일을 바꿨는지
  checkRemote(true);
}
chrome.runtime.onStartup.addListener(() => { scheduleAlarm(); scheduleUpdateAlarms(); flushQueue(); });
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && (ch.autoEnabled || ch.autoTime)) scheduleAlarm(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'daily') runAuto(); else if (a.name === 'update-remote') checkRemote(true); else if (a.name === 'update-disk') reloadIfFilesChanged(); });
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'expectReport') { expectUntil = Date.now() + 120000; expectDate = msg.date || null; sendResponse({ ok: true }); }
    else if (msg.type === 'collectRange') { collectRange(msg.start, msg.end, msg.kinds, msg.onlyMissing); sendResponse({ ok: true }); }
    else if (msg.type === 'jobStatus') sendResponse(job);
    else if (msg.type === 'checkUpdate') { sendResponse({ latest: await checkRemote(true), reloaded: await reloadIfFilesChanged() }); }
    else if (msg.type === 'cancelJob') { job.cancel = true; sendResponse({ ok: true }); }
    else if (msg.type === 'collectDate') { try { sendResponse(await collectKind(msg.kind, msg.date)); } catch (e) { sendResponse({ ok: false, error: e.message }); } }
    else if (msg.type === 'runAuto') sendResponse(await runAuto(msg.date));
    else if (msg.type === 'syncServer') { await syncServer(msg.kind, msg.date, msg.records); sendResponse({ ok: true }); }
    else sendResponse({ ok: false });
  })();
  return true;
});
