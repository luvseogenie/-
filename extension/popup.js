import * as S from './lib/store.js';
import { normalizeSales, normalizeAds, yesterdayIso } from './lib/parse.js';

const $ = (s) => document.querySelector(s);
const msg = (t, cls = '') => { $('#msg').textContent = t; $('#msg').className = 'msg ' + cls; };

async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }

async function readActive(kind) {
  const tab = await activeTab();
  let ids = [0];
  try { const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }); if (frames) ids = frames.map((f) => f.frameId); } catch { /* 권한 없음 */ }
  let best = null, tables = [];
  for (const frameId of ids) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'read', kind }, { frameId });
      if (r) { tables = tables.concat(r.tables || []); if (r.ok && (!best || r.records.length > best.records.length)) best = r; }
    } catch { /* 이 프레임엔 content script 가 없음 */ }
  }
  return { best, tables, tab };
}

async function saveKind(kind) {
  const label = kind === 'sales' ? '판매' : '광고';
  msg('표를 읽는 중…');
  const { best, tables, tab } = await readActive(kind);
  $('#detail').textContent = tables.length ? tables.map((t) => `[${t.kind}] ${t.rows}행: ${t.headers.join(' | ')}`).join('\n') : '표를 찾지 못했습니다. 쿠팡 페이지에서 눌러 주세요.\n' + (tab?.url || '');
  if (!tab?.url?.includes('coupang.com')) { msg('쿠팡 판매자센터/광고센터 화면에서 눌러 주세요.', 'err'); return; }
  if (!best && kind === 'sales') {
    // 판매분석 옵션목록은 표가 아니라 카드 형태 → '엑셀 다운로드 → 상품별 판매 리포트' 를 대신 눌러 준다.
    let info = null; try { info = await chrome.tabs.sendMessage(tab.id, { type: 'pageInfo' }); } catch { /* 무시 */ }
    if (info?.hasExcelDownload) {
      msg('엑셀 다운로드 → 상품별 판매 리포트 를 누르는 중…');
      await chrome.runtime.sendMessage({ type: 'expectReport', date: $('#date').value || null });
      let r = null; try { r = await chrome.tabs.sendMessage(tab.id, { type: 'clickDownloadReport' }); } catch { /* 무시 */ }
      if (r?.ok) { msg('리포트를 다운로드했습니다. 잠시 후 자동으로 저장됩니다. 자동 저장 알림이 안 오면 "장부 보기 → 리포트 파일 올리기" 로 방금 받은 파일을 올려 주세요.', 'ok'); }
      else { msg((r?.reason || '다운로드 버튼을 찾지 못했습니다') + '. 직접 엑셀 다운로드 → 상품별 판매 리포트 를 받은 뒤 "장부 보기 → 리포트 파일 올리기" 로 올려 주세요.', 'err'); }
      return;
    }
  }
  if (!best) { msg(`${label} 표를 찾지 못했습니다. 표가 보이는 화면인지 확인하세요. (아래 '찾은 표 보기')`, 'err'); return; }
  const date = $('#date').value || best.date || yesterdayIso();
  const rows = kind === 'sales' ? normalizeSales(best.records, date) : normalizeAds(best.records, date);
  if (!rows.length) { msg(`${label} 표는 찾았지만 인식된 행이 없습니다. 아래 '찾은 표 보기' 의 헤더를 알려주세요.`, 'err'); return; }
  const d = await S.load();
  const n = kind === 'sales' ? S.upsertSales(d, rows) : S.upsertAds(d, rows);
  if (kind === 'sales') for (const r of rows) if (!d.options.find((o) => o.option_id === r.option_id)) S.upsertOption(d, { option_id: r.option_id, product_name: r.option_name || r.product_name });
  await S.save(d);
  const missing = kind === 'sales' ? S.unmappedOptionIds(d).length : 0;
  msg(`${date} ${label} 데이터 ${n}건 저장 완료` + (missing ? ` · 캠페인/마진이 비어 있는 옵션 ${missing}개 → '장부 보기' 에서 채워 주세요` : ''), 'ok');
  if (kind === 'sales' && rows.some((r) => r.date === date)) chrome.runtime.sendMessage({ type: 'syncServer', kind, date, records: best.records }).catch(() => {});
  if (kind === 'ads') chrome.runtime.sendMessage({ type: 'syncServer', kind, date, records: best.records }).catch(() => {});
}

$('#send-sales').onclick = () => saveKind('sales');
$('#send-ads').onclick = () => saveKind('ads');
$('#open-app').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
$('#open-import').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html#import') });

(async () => {
  const d = await S.load(); const ds = S.dates(d);
  if (!ds.length) msg('아직 저장된 데이터가 없습니다. ①, ② 를 눌러 시작하세요.');
  else msg(`저장된 데이터: ${ds[0]} ~ ${ds[ds.length - 1]} (${ds.length}일)`);
})();
