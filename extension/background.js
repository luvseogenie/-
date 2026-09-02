// 서비스 워커: 매일 정해진 시각의 자동 수집(탭 열기 → '어제' 클릭 → 표 읽기 → 저장), 선택적 서버 전송.
import * as S from './lib/store.js';
import { normalizeSales, normalizeAds, yesterdayIso } from './lib/parse.js';

const DEFAULTS = { salesUrl: 'https://wing.coupang.com/', adsUrl: 'https://advertising.coupang.com/', autoEnabled: false, autoTime: '13:00', waitSeconds: 12, serverSync: false, server: 'http://127.0.0.1:8765' };
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
  if (kind === 'sales') for (const r of rows) if (!d.options.find((o) => o.option_id === r.option_id)) S.upsertOption(d, { option_id: r.option_id, product_name: r.option_name || r.product_name });
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
  const url = kind === 'sales' ? s.salesUrl : s.adsUrl;
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await sleep(s.waitSeconds * 1000);
    try { await chrome.tabs.sendMessage(tab.id, { type: 'clickYesterday' }); await sleep(4000); } catch { /* 무시 */ }
    const r = await readFromTab(tab.id, kind);
    if (!r) throw new Error(`${kind === 'sales' ? '판매' : '광고'} 표를 찾지 못했습니다. 로그인이 풀렸거나 주소가 다를 수 있습니다 (${url})`);
    const date = dateOverride || r.date || yesterdayIso();
    const n = await saveLocal(kind, date, r.records);
    await syncServer(kind, date, r.records);
    await log(`[자동] ${kind === 'sales' ? '판매' : '광고'} ${date} ${n}건 저장`);
    return { ok: true, saved: n, date };
  } finally { await chrome.tabs.remove(tab.id).catch(() => {}); }
}

async function runAuto(dateOverride) {
  const results = [];
  for (const kind of ['sales', 'ads']) {
    try { results.push(await collectKind(kind, dateOverride)); }
    catch (e) { await log(`[자동] ${kind === 'sales' ? '판매' : '광고'} 실패: ${e.message}`); results.push({ ok: false, error: e.message }); }
  }
  const okAll = results.every((r) => r.ok);
  try { chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: '쿠팡 광고계산기', message: okAll ? '어제 판매·광고 데이터를 저장했습니다.' : '일부 수집이 실패했습니다. 장부 보기 → 백업 · 설정의 기록을 확인하세요.' }); } catch { /* 무시 */ }
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

chrome.runtime.onInstalled.addListener((d) => { scheduleAlarm(); if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }); });
chrome.runtime.onStartup.addListener(() => { scheduleAlarm(); flushQueue(); });
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && (ch.autoEnabled || ch.autoTime)) scheduleAlarm(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'daily') runAuto(); });
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'runAuto') sendResponse(await runAuto(msg.date));
    else if (msg.type === 'syncServer') { await syncServer(msg.kind, msg.date, msg.records); sendResponse({ ok: true }); }
    else sendResponse({ ok: false });
  })();
  return true;
});
