// 서비스 워커: 서버 전송, 전송 실패 큐, 매일 정해진 시각의 자동 수집.
const DEFAULTS = {
  server: 'http://127.0.0.1:8765',
  salesUrl: 'https://wing.coupang.com/',
  adsUrl: 'https://advertising.coupang.com/',
  autoEnabled: false,
  autoTime: '13:00',
  waitSeconds: 12,
};

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

async function postRecords(kind, date, records) {
  const { server } = await getSettings();
  const r = await fetch(`${server}/api/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, date, records }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `서버 오류 ${r.status}`);
  return j;
}

async function queuePush(item) {
  const { queue = [] } = await chrome.storage.local.get('queue');
  queue.push(item);
  await chrome.storage.local.set({ queue: queue.slice(-50) });
}

async function flushQueue() {
  const { queue = [] } = await chrome.storage.local.get('queue');
  if (!queue.length) return { sent: 0, left: 0 };
  const left = [];
  let sent = 0;
  for (const it of queue) {
    try { await postRecords(it.kind, it.date, it.records); sent++; } catch { left.push(it); }
  }
  await chrome.storage.local.set({ queue: left });
  return { sent, left: left.length };
}

async function send(kind, date, records) {
  try {
    const res = await postRecords(kind, date, records);
    await flushQueue();
    return { ok: true, res };
  } catch (e) {
    await queuePush({ kind, date, records, at: Date.now() });
    return { ok: false, error: `${e.message} — 서버가 꺼져 있으면 큐에 보관했다가 다음에 다시 보냅니다.` };
  }
}

async function log(line) {
  const { logs = [] } = await chrome.storage.local.get('logs');
  logs.push(`${new Date().toLocaleString('ko-KR')} ${line}`);
  await chrome.storage.local.set({ logs: logs.slice(-100) });
}

// ---- 자동 수집: 탭을 열고 → '어제' 클릭 → 표 읽기 → 전송 → 탭 닫기 ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readFromTab(tabId, kind) {
  const frames = await chrome.webNavigation?.getAllFrames?.({ tabId }).catch(() => null);
  const frameIds = frames ? frames.map((f) => f.frameId) : [0];
  let best = null;
  for (const frameId of frameIds) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'read', kind }, { frameId });
      if (r?.ok && (!best || r.records.length > best.records.length)) best = r;
    } catch { /* 프레임에 content script 없음 */ }
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
    if (!r) throw new Error(`${kind === 'sales' ? '판매' : '광고'} 표를 찾지 못했습니다 (${url})`);
    const date = dateOverride || r.date || yesterdayIso();
    const out = await send(kind, date, r.records);
    await log(`[자동] ${kind} ${date} ${r.records.length}행 → ${out.ok ? `저장 ${out.res.saved}` : out.error}`);
    return out;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function yesterdayIso() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

async function runAuto(dateOverride) {
  const results = [];
  for (const kind of ['sales', 'ads']) {
    try { results.push(await collectKind(kind, dateOverride)); }
    catch (e) { await log(`[자동] ${kind} 실패: ${e.message}`); results.push({ ok: false, error: e.message }); }
  }
  const okAll = results.every((r) => r.ok);
  chrome.notifications?.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: '쿠팡 광고계산기 수집',
    message: okAll ? '전일 판매·광고 데이터를 저장했습니다.' : '일부 수집이 실패했습니다. 확장 프로그램 팝업의 기록을 확인하세요.' });
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

chrome.runtime.onInstalled.addListener(scheduleAlarm);
chrome.runtime.onStartup.addListener(async () => { await scheduleAlarm(); await flushQueue(); });
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && (ch.autoEnabled || ch.autoTime)) scheduleAlarm(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'daily') runAuto(); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'send') sendResponse(await send(msg.kind, msg.date, msg.records));
    else if (msg.type === 'runAuto') sendResponse(await runAuto(msg.date));
    else if (msg.type === 'flush') sendResponse(await flushQueue());
    else if (msg.type === 'ping') {
      const { server } = await getSettings();
      try { const r = await fetch(`${server}/api/ping`); sendResponse({ ok: r.ok, server }); }
      catch { sendResponse({ ok: false, server }); }
    }
  })();
  return true;
});
