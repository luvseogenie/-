// 윙 로켓그로스 재고 화면이 서버에서 받아 오는 재고 데이터(JSON)를 모아 둔다.
// 화면 표는 100줄씩만 보이거나 내려야 더 불러오므로, 화면 대신 화면이 받은 데이터를 읽는다. 페이지 쪽(MAIN)에서 문서 시작 때 실행된다.
// 모은 것은 이 페이지 안(window.__ccInv*)에만 두고, 확장이 같은 탭에서 꺼내 간다. 다른 곳으로 보내지 않는다.
(() => {
  if (window.__ccInvSniff) return; window.__ccInvSniff = true;
  const ID = /^(vendorItemId|vendorItemID|optionId|vendor_item_id|option_id|vendorItemNo)$/i;
  const SIZE = /^(size|pageSize|limit|rows|perPage|countPerPage|listSize|pageRows|rowCount|maxResults)$/i;
  const PAGE = /^(page|pageNo|pageNum|pageNumber|pageIndex|currentPage|curPage)$/i;
  const OFF = /^(offset|start|from|startIndex|startRow)$/i;
  const calls = []; const items = {};
  const isRow = (o) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).some((k) => ID.test(k) && /^\d{6,}$/.test(String(o[k])));
  const flat = (o, pre = '', out = {}, depth = 0) => {
    for (const [k, v] of Object.entries(o || {})) {
      if (v == null) continue;
      if (typeof v === 'object') { if (!Array.isArray(v) && depth < 2) flat(v, pre + k + '.', out, depth + 1); }
      else out[pre + k] = v;
    }
    return out;
  };
  // 줄 배열 찾기 (상품 안에 옵션 배열이 있는 모양도: 상위 상품의 값은 'parent.' 로 붙인다)
  const findRows = (o, parent, depth, res) => {
    if (!o || depth > 7) return;
    if (Array.isArray(o)) {
      const rows = o.filter(isRow);
      if (rows.length && rows.length >= Math.min(2, o.length)) { for (const r of rows) res.push({ ...Object.fromEntries(Object.entries(parent).map(([k, v]) => ['parent.' + k, v])), ...flat(r) }); return; }
      for (const x of o.slice(0, 2000)) if (x && typeof x === 'object') findRows(x, Array.isArray(x) ? parent : flat(x, '', {}, 2), depth + 1, res);
      return;
    }
    if (typeof o === 'object') for (const v of Object.values(o)) if (v && typeof v === 'object') findRows(v, parent, depth + 1, res);
  };
  const totalOf = (j) => { let t = null; const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 3 || Array.isArray(o)) return; for (const [k, v] of Object.entries(o)) { if (/^(total|totalCount|totalElements|totalSize|totalCnt|totalRows|totalItems|count)$/i.test(k) && typeof v === 'number' && t == null) t = v; else if (v && typeof v === 'object') walk(v, d + 1); } }; walk(j, 0); return t; };
  // 응답 하나 → 찾은 줄 수
  const take = (req, text, record = true) => {
    if (typeof text !== 'string' || text.length > 2e7) return 0; const s = text.trim(); if (s[0] !== '{' && s[0] !== '[') return 0;
    let j; try { j = JSON.parse(s); } catch { return 0; }
    const res = []; findRows(j, {}, 0, res); if (!res.length) return 0;
    for (const r of res) { const k = Object.keys(r).find((x) => ID.test(x.replace(/^.*\./, '')) && !x.startsWith('parent.')); if (k) items[String(r[k])] = r; }
    if (record) { calls.push({ ...req, count: res.length, total: totalOf(j) }); if (calls.length > 20) calls.shift(); }
    window.__ccInvCount = Object.keys(items).length;
    return res.length;
  };
  const hdrObj = (h) => { try { if (!h) return {}; if (h instanceof Headers) return Object.fromEntries(h.entries()); if (Array.isArray(h)) return Object.fromEntries(h); return { ...h }; } catch { return {}; } };
  const of = window.fetch;
  if (of) window.fetch = function (input, init = {}) {
    const p = of.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url || String(input); const method = (init.method || input?.method || 'GET').toUpperCase();
      const body = typeof init.body === 'string' ? init.body : null; const headers = { ...hdrObj(input?.headers), ...hdrObj(init.headers) };
      p.then((r) => { try { r.clone().text().then((t) => take({ url, method, body, headers }, t)).catch(() => {}); } catch { /* 무시 */ } }).catch(() => {});
    } catch { /* 무시 */ }
    return p;
  };
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send, oh = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { this.__cc = { method: String(m || 'GET').toUpperCase(), url: String(u), headers: {} }; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (this.__cc) this.__cc.headers[k] = v; } catch { /* 무시 */ } return oh.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    try {
      const req = { ...(this.__cc || {}), body: typeof b === 'string' ? b : null };
      this.addEventListener('load', () => { try { if (!this.responseType || this.responseType === 'text') take(req, this.responseText); else if (this.responseType === 'json') take(req, JSON.stringify(this.response)); } catch { /* 무시 */ } });
    } catch { /* 무시 */ }
    return os.apply(this, arguments);
  };

  // 마지막으로 줄을 받은 요청을 쪽 크기를 키워 처음부터 끝까지 다시 부른다 (화면이 쓰는 요청 그대로, 쪽 번호만 바꿈)
  window.__ccInvReplay = async (maxReq = 40) => {
    const c = [...calls].reverse().find((x) => x.count > 0); if (!c) return { ok: false, reason: '재고 데이터 요청을 못 봤음' };
    const u = new URL(c.url, location.href); let body = null; try { body = c.body ? JSON.parse(c.body) : null; } catch { body = null; }
    const form = !body && c.body && c.body.includes('=') ? new URLSearchParams(c.body) : null;
    const setters = [];
    const kindOf = (k) => (SIZE.test(k) ? 'size' : PAGE.test(k) ? 'page' : OFF.test(k) ? 'off' : null);
    for (const k of [...u.searchParams.keys()]) { const kd = kindOf(k); if (kd) setters.push({ kd, get: () => u.searchParams.get(k), set: (v) => u.searchParams.set(k, String(v)) }); }
    if (form) for (const k of [...form.keys()]) { const kd = kindOf(k); if (kd) setters.push({ kd, get: () => form.get(k), set: (v) => form.set(k, String(v)) }); }
    const scan = (o, d) => { if (!o || d > 3) return; for (const k of Object.keys(o)) { const kd = kindOf(k); if (kd && (typeof o[k] === 'number' || /^\d+$/.test(String(o[k])))) setters.push({ kd, get: () => o[k], set: (v) => { o[k] = typeof o[k] === 'string' ? String(v) : v; } }); else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) scan(o[k], d + 1); } };
    if (body) scan(body, 0);
    const size = setters.find((s) => s.kd === 'size'), page = setters.find((s) => s.kd === 'page'), off = setters.find((s) => s.kd === 'off');
    if (!page && !off) return { ok: false, reason: '쪽 번호 칸 없음', path: u.pathname, body: String(c.body || '').slice(0, 200) };
    if (size) size.set(Math.max(Number(size.get()) || 0, 200));
    const per = size ? Number(size.get()) : c.count; const start = page ? (Number(page.get()) === 0 ? 0 : 1) : 0;
    const before = Object.keys(items).length; let n = 0, lastErr = '';
    for (let i = 0; i < maxReq; i++) {
      if (page) page.set(start + i); if (off) off.set(i * per);
      const init = { method: c.method, headers: c.headers, credentials: 'include' };
      if (c.method !== 'GET' && c.method !== 'HEAD') init.body = body ? JSON.stringify(body) : form ? form.toString() : c.body;
      let got = 0;
      try { const r = await of.call(window, u.href, init); if (!r.ok) { lastErr = 'HTTP ' + r.status; break; } got = take(c, await r.text(), false); } catch (e) { lastErr = String(e && e.message || e); break; }
      n++; if (!got || got < per) break;
      if (c.total && Object.keys(items).length >= c.total) break;
    }
    return { ok: true, requests: n, per, added: Object.keys(items).length - before, total: Object.keys(items).length, apiTotal: c.total, error: lastErr, path: u.pathname };
  };
  window.__ccInvItems = () => Object.values(items);
  window.__ccInvCalls = () => calls.map((c) => ({ url: String(c.url).slice(0, 160), method: c.method, count: c.count, total: c.total }));
})();
