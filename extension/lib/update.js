// 새 버전 확인 + 파일이 바뀌면 스스로 새로고침.
//  - 원격: GitHub 의 manifest.json 버전을 6시간마다 확인해 storage.local.latestVersion 에 둔다.
//  - 로컬: 폴더의 manifest.json(디스크) 버전이 실행 중인 버전과 다르면 = 업데이트.bat 이 파일을 바꾼 것 → chrome.runtime.reload()
export const REPO = 'luvseogenie/-';
export const BRANCH = 'claude/coupang-ad-calculator-automation-28o2wh';
export const RAW_MANIFEST = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/extension/manifest.json`;
export const ZIP_URL = `https://github.com/${REPO}/archive/refs/heads/${BRANCH}.zip`;

export function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
export const currentVersion = () => chrome.runtime.getManifest().version;

export async function checkRemote(force = false) {
  const { updateCheckedAt = 0, latestVersion = null } = await chrome.storage.local.get(['updateCheckedAt', 'latestVersion']);
  if (!force && Date.now() - updateCheckedAt < 6 * 3600 * 1000) return latestVersion;
  try {
    const r = await fetch(RAW_MANIFEST + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const m = await r.json();
    await chrome.storage.local.set({ latestVersion: m.version, updateCheckedAt: Date.now() });
    return m.version;
  } catch { await chrome.storage.local.set({ updateCheckedAt: Date.now() }); return latestVersion; }
}
// 디스크의 manifest 버전 (업데이트.bat 이 파일을 바꾸면 실행 중 버전과 달라진다)
export async function diskVersion() {
  try { const r = await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' }); return (await r.json()).version; } catch { return null; }
}
export async function reloadIfFilesChanged() {
  const v = await diskVersion();
  if (v && cmpVersion(v, currentVersion()) !== 0) { chrome.runtime.reload(); return true; }
  return false;
}
export async function updateStatus() {
  const latest = await checkRemote(false);
  const cur = currentVersion();
  return { current: cur, latest, hasUpdate: !!latest && cmpVersion(latest, cur) > 0 };
}
