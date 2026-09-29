// 큰 파일(엑셀 통합문서, 내려받을 파일 내용)을 IndexedDB 에 둔다. 확장 페이지·서비스 워커·오프스크린 문서에서 함께 쓴다.
const DB = 'cc-files', STORE = 'files';
function open() {
  return new Promise((res, rej) => { const q = indexedDB.open(DB, 1); q.onupgradeneeded = () => q.result.createObjectStore(STORE); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
export async function putFile(key, value) {
  const db = await open();
  await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
}
export async function getFile(key) {
  const db = await open();
  const v = await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const q = tx.objectStore(STORE).get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error); });
  db.close(); return v;
}
export async function deleteFile(key) {
  const db = await open();
  await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
}
// 엑셀 마진계산기 원본(또는 마지막으로 채운 파일): { bytes: Uint8Array, name, savedAt, lastDate }
export const TEMPLATE_KEY = 'excelTemplate';
export const saveTemplate = (bytes, meta = {}) => putFile(TEMPLATE_KEY, { bytes, savedAt: Date.now(), ...meta });
export const loadTemplate = () => getFile(TEMPLATE_KEY);
export const clearTemplate = () => deleteFile(TEMPLATE_KEY);
