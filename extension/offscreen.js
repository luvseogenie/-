// 서비스 워커는 blob: 주소를 만들 수 없어(URL.createObjectURL 없음) 큰 파일을 내려받지 못한다 (data: 주소는 2MB 제한).
// 그래서 이 숨은 문서가 IndexedDB 에 놓인 파일 내용으로 blob: 주소를 만들어 돌려주고, 서비스 워커가 chrome.downloads 로 받는다.
import { getFile, deleteFile } from './lib/excelstore.js';

const urls = new Map();
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;
  (async () => {
    try {
      if (msg.type === 'blobUrl') {
        const item = await getFile(msg.key); if (!item) throw new Error(`저장된 파일이 없습니다: ${msg.key}`);
        const bytes = item.bytes || item; const url = URL.createObjectURL(new Blob([bytes], { type: msg.mime || 'application/octet-stream' }));
        urls.set(url, Date.now()); await deleteFile(msg.key).catch(() => {});
        sendResponse({ ok: true, url, size: bytes.length || bytes.byteLength || 0 });
      } else if (msg.type === 'revoke') { try { URL.revokeObjectURL(msg.url); } catch { /* 무시 */ } urls.delete(msg.url); sendResponse({ ok: true }); }
      else sendResponse({ ok: false, error: '모르는 요청' });
    } catch (e) { sendResponse({ ok: false, error: e.message }); }
  })();
  return true;
});
