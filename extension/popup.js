const $ = (s) => document.querySelector(s);
const msg = (t, cls = '') => { $('#msg').textContent = t; $('#msg').className = 'status ' + cls; };

async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }

async function readActive(kind) {
  const tab = await activeTab();
  const frames = await chrome.webNavigation?.getAllFrames?.({ tabId: tab.id }).catch(() => null);
  const ids = frames ? frames.map((f) => f.frameId) : [0];
  let best = null, tables = [];
  for (const frameId of ids) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'read', kind }, { frameId });
      if (r) { tables = tables.concat(r.tables || []); if (r.ok && (!best || r.records.length > best.records.length)) best = r; }
    } catch { /* 이 프레임엔 content script 가 없음 */ }
  }
  return { best, tables, tab };
}

async function sendKind(kind) {
  msg('표를 읽는 중…');
  const { best, tables, tab } = await readActive(kind);
  $('#detail').textContent = tables.length ? tables.map((t) => `[${t.kind}] ${t.rows}행: ${t.headers.join(' | ')}`).join('\n') : '표를 찾지 못했습니다. 쿠팡 페이지에서 눌러 주세요: ' + (tab?.url || '');
  if (!best) { msg(`${kind === 'sales' ? '판매' : '광고'} 표를 찾지 못했습니다. 아래 '찾은 표' 목록을 확인하세요.`, 'err'); return; }
  const date = $('#date').value || best.date || null;
  const r = await chrome.runtime.sendMessage({ type: 'send', kind, date, records: best.records });
  if (r.ok) msg(`${r.res.date} ${kind === 'sales' ? '판매' : '광고'} ${r.res.received}행 → ${r.res.saved}건 저장` + (r.res.unmapped_options?.length ? ` · 캠페인 미연결 옵션: ${r.res.unmapped_options.join(', ')}` : ''), 'ok');
  else msg(r.error, 'err');
}

$('#send-sales').onclick = () => sendKind('sales');
$('#send-ads').onclick = () => sendKind('ads');
$('#run-auto').onclick = async () => { msg('자동 수집 중… (탭이 열렸다 닫힙니다)'); const rs = await chrome.runtime.sendMessage({ type: 'runAuto', date: $('#date').value || null }); msg(rs.every((r) => r.ok) ? '자동 수집 완료' : rs.map((r) => r.ok ? '성공' : r.error).join(' / '), rs.every((r) => r.ok) ? 'ok' : 'err'); showLogs(); };
$('#flush').onclick = async () => { const r = await chrome.runtime.sendMessage({ type: 'flush' }); msg(`큐 전송 ${r.sent}건, 남음 ${r.left}건`); };
$('#open-options').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
$('#open-server').onclick = async (e) => { e.preventDefault(); const { server } = await chrome.storage.sync.get({ server: 'http://127.0.0.1:8765' }); chrome.tabs.create({ url: server }); };

async function showLogs() {
  const { logs = [], queue = [] } = await chrome.storage.local.get(['logs', 'queue']);
  if (logs.length) $('#detail').textContent = logs.slice(-15).join('\n') + (queue.length ? `\n(대기 큐 ${queue.length}건)` : '');
}
(async () => {
  const p = await chrome.runtime.sendMessage({ type: 'ping' });
  $('#server').textContent = p.ok ? `서버 연결됨 (${p.server})` : `서버 꺼짐 — 터미널에서 python -m coupang_calc serve`;
  $('#server').className = 'status ' + (p.ok ? 'ok' : 'err');
  showLogs();
})();
