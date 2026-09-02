import * as S from './lib/store.js';
import { normalizeSales, normalizeAds, yesterdayIso } from './lib/parse.js';
import { updateStatus, reloadIfFilesChanged } from './lib/update.js';
const SALES_URL = 'https://wing.coupang.com/tenants/business-insight/sales-analysis?start_date={date}&end_date={date}';

const $ = (s) => document.querySelector(s);
const msg = (t, cls = '') => { $('#msg').textContent = t; $('#msg').className = 'msg ' + cls; };

async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }

// 확장 프로그램을 새로고침하면 이미 열려 있던 탭에는 읽기 스크립트가 없다 → 응답이 없으면 직접 주입한다.
async function ensureContentScript(tab) {
  try { const r = await chrome.tabs.sendMessage(tab.id, { type: 'pageInfo' }); if (r) return true; } catch { /* 주입 필요 */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
    await new Promise((r) => setTimeout(r, 300));
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'pageInfo' }); return !!r;
  } catch (e) { console.warn('content script inject failed', e); return false; }
}
function dateFromUrl(url) {
  try { const q = new URL(url).searchParams; const s = q.get('start_date') || q.get('startDate'), e = q.get('end_date') || q.get('endDate');
    if (s && /^20\d{2}-\d{2}-\d{2}$/.test(s) && (!e || s === e)) return s; } catch { /* 무시 */ }
  return null;
}

async function readActive(kind) {
  const tab = await activeTab();
  let ids = [0];
  try { const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }); if (frames) ids = frames.map((f) => f.frameId); } catch { /* 권한 없음 */ }
  let best = null, tables = [];
  for (const frameId of ids) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: kind === 'ads' ? 'readAll' : 'read', kind }, { frameId });
      if (r) { tables = tables.concat(r.tables || []); if (r.ok && (!best || r.records.length > best.records.length)) best = r; }
    } catch { /* 이 프레임엔 content script 가 없음 */ }
  }
  return { best, tables, tab };
}

async function saveKind(kind) {
  const label = kind === 'sales' ? '판매' : '광고';
  msg('표를 읽는 중…');
  const tab0 = await activeTab();
  if (!tab0?.url?.includes('coupang.com')) { msg('쿠팡 판매자센터/광고센터 화면에서 눌러 주세요. (현재: ' + (tab0?.url || '') + ')', 'err'); return; }
  if (!(await ensureContentScript(tab0))) { msg('이 탭을 새로고침(F5)한 뒤 다시 눌러 주세요.', 'err'); return; }
  const { best, tables, tab } = await readActive(kind);
  $('#detail').textContent = tables.length ? tables.map((t) => `[${t.kind}] ${t.rows}행: ${t.headers.join(' | ')}`).join('\n') : '표를 찾지 못했습니다. 쿠팡 페이지에서 눌러 주세요.\n' + (tab?.url || '');
  if (!tab?.url?.includes('coupang.com')) { msg('쿠팡 판매자센터/광고센터 화면에서 눌러 주세요.', 'err'); return; }
  if (!best && kind === 'sales') {
    // 판매분석 옵션목록은 표가 아니라 카드 형태 → '엑셀 다운로드 → 상품별 판매 리포트' 를 대신 눌러 준다.
    let info = null; try { info = await chrome.tabs.sendMessage(tab.id, { type: 'pageInfo' }); } catch { /* 무시 */ }
    if (info?.hasExcelDownload) {
      msg('엑셀 다운로드 → 상품별 판매 리포트 를 누르는 중…');
      await chrome.runtime.sendMessage({ type: 'expectReport', date: $('#date').value || dateFromUrl(tab.url) || null });
      let r = null; try { r = await chrome.tabs.sendMessage(tab.id, { type: 'clickDownloadReport' }); } catch { /* 무시 */ }
      if (r?.ok) { msg('리포트를 다운로드했습니다. 잠시 후 자동으로 저장됩니다. 자동 저장 알림이 안 오면 "📂 리포트 파일 올리기" 로 방금 받은 파일을 올려 주세요.', 'ok'); }
      else {
        msg((r?.reason || '다운로드 버튼을 찾지 못했습니다') + '. 지금 화면에서 직접 엑셀 다운로드 → 상품별 판매 리포트 를 눌러 주세요. 2분 안에 받으면 자동으로 저장됩니다. (안 되면 📂 리포트 파일 올리기)', 'err');
        if (r?.diag?.length) $('#detail').textContent = '화면에서 보인 항목:\n' + r.diag.join('\n') + '\n\n' + $('#detail').textContent;
      }
      return;
    }
  }
  if (!best && kind === 'ads') {
    let info = null; try { info = await chrome.tabs.sendMessage(tab.id, { type: 'pageInfo' }); } catch { /* 무시 */ }
    $('#detail').textContent = `페이지 정보: ${JSON.stringify(info)}\n` + $('#detail').textContent;
    if (info?.hasAnyDownload) {
      msg('캠페인 표를 못 읽어 다운로드 버튼을 눌러 봅니다…');
      await chrome.runtime.sendMessage({ type: 'expectReport', date: $('#date').value || dateFromUrl(tab.url) || null });
      let r = null; try { r = await chrome.tabs.sendMessage(tab.id, { type: 'clickAnyDownload' }); } catch { /* 무시 */ }
      if (r?.ok) { msg(`다운로드를 눌렀습니다 (${r.clicked}). 엑셀이 받아지면 자동 저장됩니다. 안 되면 "장부 보기 → 붙여넣기로 저장" 을 써 주세요.`, 'ok'); return; }
    }
    msg('광고 캠페인 표를 못 읽었습니다. 화면에서 캠페인 표를 드래그해 복사한 뒤 "장부 보기 → 붙여넣기로 저장" 에 붙여넣어 주세요. 아래 "찾은 표 보기" 내용을 보내 주시면 맞춰 드립니다.', 'err');
    return;
  }
  if (!best) { msg(`${label} 표를 찾지 못했습니다. 표가 보이는 화면인지 확인하세요. (아래 '찾은 표 보기')`, 'err'); return; }
  const date = $('#date').value || best.date || dateFromUrl(tab.url) || yesterdayIso();
  const rows = kind === 'sales' ? normalizeSales(best.records, date) : normalizeAds(best.records, date);
  if (!rows.length) { msg(`${label} 표는 찾았지만 인식된 행이 없습니다. 아래 '찾은 표 보기' 의 헤더를 알려주세요.`, 'err'); return; }
  const d = await S.load();
  const n = kind === 'sales' ? S.upsertSales(d, rows) : S.upsertAds(d, rows);
  if (kind === 'sales') for (const r of rows) if (!d.options.find((o) => o.option_id === r.option_id)) S.upsertOption(d, { option_id: r.option_id, product_name: r.option_name || r.product_name });
  await S.save(d);
  const missing = kind === 'sales' ? S.unmappedOptionIds(d).length : 0;
  const pageNote = best.pages > 1 ? ` (${best.pages}페이지 합침)` : ''; const extra = best.notes?.length ? ` · ${best.notes.join(', ')}` : '';
  const zero = kind === 'ads' ? rows.filter((r) => !r.impressions && !r.clicks).length : 0;
  msg(`${date} ${label} 데이터 ${n}건 저장 완료${pageNote}` + (missing ? ` · 캠페인/마진이 비어 있는 옵션 ${missing}개 → '장부 보기' 에서 채워 주세요` : '') + (zero === rows.length && rows.length ? ' · 노출수·클릭수가 비어 있습니다. 광고센터 "지표 설정" 에서 노출수/클릭수/클릭률/전환율/판매수를 켜 주세요' : '') + extra, 'ok');
  $('#detail').textContent = `읽은 머리글: ${(best.headers || []).join(' | ')}\n` + $('#detail').textContent;
  if (kind === 'sales' && rows.some((r) => r.date === date)) chrome.runtime.sendMessage({ type: 'syncServer', kind, date, records: best.records }).catch(() => {});
  if (kind === 'ads') chrome.runtime.sendMessage({ type: 'syncServer', kind, date, records: best.records }).catch(() => {});
}

$('#send-sales').onclick = () => saveKind('sales');
$('#send-ads').onclick = () => saveKind('ads');
$('#open-app').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
$('#open-import').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html#import') });

$('#date-yday').onclick = () => { $('#date').value = yesterdayIso(); };
$('#goto-sales').onclick = async (e) => {
  e.preventDefault(); const date = $('#date').value || yesterdayIso();
  const { salesUrl } = await chrome.storage.sync.get({ salesUrl: SALES_URL });
  const url = (salesUrl.includes('{date}') ? salesUrl : SALES_URL).replace(/\{date\}/g, date);
  const tab = await activeTab();
  if (tab?.url?.includes('coupang.com')) chrome.tabs.update(tab.id, { url }); else chrome.tabs.create({ url });
  msg(`${date} 판매분석 화면을 여는 중… 화면이 뜨면 ① 을 누르세요.`);
};
$('#open-range').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html#range') });

async function showUpdate() {
  if (await reloadIfFilesChanged()) return;
  const u = await updateStatus();
  if (!u.hasUpdate) return;
  $('#upd').style.display = 'block';
  $('#upd').innerHTML = `🆕 새 버전 <b>v${u.latest}</b> 이 있습니다 (지금 v${u.current}).<br>저장소 폴더의 <b>업데이트.bat</b> 을 더블클릭하면 받아지고, 확장 프로그램은 스스로 새로고침됩니다. <a href="#" id="upd-how">자세히</a>`;
  $('#upd-how').onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('app.html#update') }); };
}
(async () => {
  $('#ver').textContent = 'v' + chrome.runtime.getManifest().version;
  showUpdate();
  const tab = await activeTab(); $('#date').value = dateFromUrl(tab?.url || '') || yesterdayIso();
  const d = await S.load(); const ds = S.dates(d);
  if (!ds.length) msg('아직 저장된 데이터가 없습니다. ①, ② 를 눌러 시작하세요.');
  else msg(`저장된 데이터: ${ds[0]} ~ ${ds[ds.length - 1]} (${ds.length}일)`);
})();
