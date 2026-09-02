const KEYS = { server: 'http://127.0.0.1:8765', salesUrl: 'https://wing.coupang.com/', adsUrl: 'https://advertising.coupang.com/', autoEnabled: false, autoTime: '13:00', waitSeconds: 12 };
(async () => {
  const s = await chrome.storage.sync.get(KEYS);
  for (const k of Object.keys(KEYS)) { const el = document.getElementById(k); if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k]; }
})();
document.getElementById('save').onclick = async () => {
  const out = {};
  for (const k of Object.keys(KEYS)) { const el = document.getElementById(k); out[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim(); }
  await chrome.storage.sync.set(out);
  document.getElementById('msg').textContent = '저장됨';
};
