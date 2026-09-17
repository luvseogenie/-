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

// ---- 앱 화면에서 한 번에 업데이트 (chrome.downloads 로 다운로드 폴더 안의 확장 폴더에 파일을 덮어쓴다) ----
// 크롬 확장은 디스크에 직접 쓸 수 없지만, 다운로드 API 는 '다운로드 폴더 안'에는 파일을 만들 수 있다.
// 그래서 확장 폴더가 다운로드 폴더 안에 있으면(ZIP 을 받아 그 자리에서 푼 경우가 보통) 최신 파일을 그 위에 내려받아 교체할 수 있다.
export const DEFAULT_FOLDER = '--claude-coupang-ad-calculator-automation-28o2wh';   // GitHub ZIP 을 풀면 생기는 폴더 이름
export const TREE_API = `https://api.github.com/repos/${REPO}/git/trees/${encodeURIComponent(BRANCH)}?recursive=1`;
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const SKIP = /\.(bat|ps1|command|exe|cmd)$/i;   // 크롬이 '위험한 파일'로 막는 종류. 거의 안 바뀌므로 건너뛴다 (필요하면 업데이트.bat 으로)
const dl = (opts) => new Promise((res, rej) => chrome.downloads.download(opts, (id) => { const e = chrome.runtime.lastError; if (e || id == null) rej(new Error(e?.message || '다운로드를 시작하지 못했습니다')); else res(id); }));
const search = (id) => new Promise((res) => chrome.downloads.search({ id }, (r) => res(r && r[0])));
const erase = (id) => new Promise((res) => chrome.downloads.erase({ id }, () => { void chrome.runtime.lastError; res(); }));
const removeFile = (id) => new Promise((res) => chrome.downloads.removeFile(id, () => { void chrome.runtime.lastError; res(); }));
async function waitDone(id, timeout = 90000) {
  const t0 = Date.now(); let accepted = false;
  while (Date.now() - t0 < timeout) {
    const it = await search(id); if (!it) throw new Error('다운로드 항목이 사라졌습니다');
    if (it.state === 'complete') return it;
    if (it.state === 'interrupted') throw new Error(it.error || '중단됨');
    if (!accepted && it.danger && !['safe', 'accepted', ''].includes(it.danger)) { accepted = true; chrome.downloads.acceptDanger(id, () => { void chrome.runtime.lastError; }); }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('시간 초과');
}
export async function listRemoteFiles() {
  const r = await fetch(TREE_API + '&t=' + Date.now(), { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error('GitHub 파일 목록을 받지 못했습니다 (HTTP ' + r.status + ')');
  const j = await r.json(); if (j.truncated) throw new Error('파일 목록이 너무 깁니다');
  return j.tree.filter((x) => x.type === 'blob' && x.path.startsWith('extension/')).map((x) => x.path.slice('extension/'.length));
}
// 다운로드 폴더 안의 <folder>/extension 이 정말 실행 중인 확장 폴더인지: 표식 파일을 내려받아 확장 주소로 읽어 본다
export async function probeFolder(folder) {
  const token = 'probe-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const rel = (folder ? folder.replace(/^[\\/]+|[\\/]+$/g, '') + '/' : '') + 'extension/update-probe.txt';
  const id = await dl({ url: 'data:text/plain,' + token, filename: rel, conflictAction: 'overwrite', saveAs: false });
  const item = await waitDone(id);
  let ok = false;
  try { const r = await fetch(chrome.runtime.getURL('update-probe.txt') + '?t=' + Date.now(), { cache: 'no-store' }); ok = r.ok && (await r.text()).trim() === token; } catch {}
  await removeFile(id); await erase(id);
  return { ok, path: item.filename };
}
export async function applyUpdate(folder, onProgress = () => {}) {
  const files = (await listRemoteFiles()).filter((p) => !SKIP.test(p));
  files.sort((a, b) => (a === 'manifest.json') - (b === 'manifest.json'));   // manifest.json 은 맨 마지막 (다 받은 뒤에야 버전이 바뀌어 새로고침되게)
  const base = folder ? folder.replace(/^[\\/]+|[\\/]+$/g, '') + '/' : '';
  const failed = []; let n = 0;
  for (const p of files) {
    n++; onProgress(`${n}/${files.length} ${p}`);
    if (p === 'manifest.json' && failed.length) break;
    let lastErr = null;
    for (let tries = 0; tries < 3; tries++) {
      try {
        // GitHub 은 .js 도 text/plain 으로 주어 크롬이 파일 이름을 .txt 로 바꿔 버린다 → 내용을 먼저 받아 일반 바이너리(blob)로 내려받는다
        const r = await fetch(RAW_BASE + 'extension/' + p + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = new Blob([await r.arrayBuffer()], { type: 'application/octet-stream' }); const url = URL.createObjectURL(blob);
        try { const id = await dl({ url, filename: base + 'extension/' + p, conflictAction: 'overwrite', saveAs: false }); await waitDone(id); await erase(id); } finally { URL.revokeObjectURL(url); }
        lastErr = null; break;
      }
      catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 800)); }
    }
    if (lastErr) failed.push(`${p}: ${lastErr.message}`);
  }
  const disk = await diskVersion();
  return { ok: !failed.length, failed, files: files.length, diskVersion: disk };
}
