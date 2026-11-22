// 윙 로켓그로스 재고 화면이 서버에서 받아 오는 재고 데이터(JSON)를 모아 둔다.
// 화면 표는 100줄씩만 보이거나 내려야 더 불러오므로, 화면 대신 화면이 받은 데이터를 읽는다. 페이지 쪽(MAIN)에서 문서 시작 때 실행된다.
// 모은 것은 이 페이지 안(window.__ccInv*)에만 두고, 확장이 같은 탭에서 꺼내 간다. 다른 곳으로 보내지 않는다.
(() => {
  if (window.__ccInvSniff) return; window.__ccInvSniff = true;
  const ID = /^(vendorItemId|vendorItemID|optionId|vendor_item_id|option_id|vendorItemNo)$/i;
  const SIZE = /^(page_?)?(size|limit|rows|per_?page|list_?size|row_?count|max_?results|items_?per_?page|count_?per_?page|page_?rows|fetch_?size)$/i;
  const PAGE = /^(cur(rent)?_?)?page(_?(no|num|number|index|idx))?$/i;
  const OFF = /^(offset|start|from|start_?index|start_?row|skip)$/i;
  // 다음 쪽 표시값 방식 (응답의 nextToken·cursor·searchAfter 를 다음 요청에 넣는다)
  const CUR_RES = /^(next_?(token|cursor|key|page_?token|search_?after|id)?|cursor|next_?cursor|search_?after|last_?key|last_?evaluated_?key|scroll_?id|continuation_?token|end_?cursor)$/i;
  const CUR_REQ = /^(cursor|next_?(token|cursor|key|page_?token)?|page_?token|search_?after|last_?key|last_?evaluated_?key|scroll_?id|continuation_?token|after|start_?key|exclusive_?start_?key)$/i;
  let lastCursor = null, lastHasNext = null;
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
  const totalOf = (j) => { let t = null; const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || Array.isArray(o)) return; for (const [k, v] of Object.entries(o)) { if (/^(total|total_?count|total_?elements|total_?size|total_?cnt|total_?rows|total_?items|total_?records|records_?total|count)$/i.test(k) && (typeof v === 'number' || /^\d+$/.test(String(v))) && t == null) t = Number(v); else if (v && typeof v === 'object') walk(v, d + 1); } }; walk(j, 0); return t; };
  // 응답의 다음 쪽 표시값 / 더 있음 여부
  const cursorOf = (j) => { let c = null, hn = null; const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || Array.isArray(o)) return; for (const [k, v] of Object.entries(o)) { if (c == null && CUR_RES.test(k) && v != null && v !== '' && (typeof v !== 'object' || Array.isArray(v))) c = { key: k, val: v }; else if (hn == null && /^(has_?next(_?page)?|has_?more|more|last)$/i.test(k) && typeof v === 'boolean') hn = /last/i.test(k) ? !v : v; else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, d + 1); } }; walk(j, 0); return { cursor: c, hasNext: hn }; };
  // 응답 하나 → 찾은 줄 수
  const take = (req, text, record = true) => {
    if (typeof text !== 'string' || text.length > 2e7) return 0; const s = text.trim(); if (s[0] !== '{' && s[0] !== '[') return 0;
    let j; try { j = JSON.parse(s); } catch { return 0; }
    const res = []; findRows(j, {}, 0, res); if (!res.length) return 0;
    for (const r of res) { const k = Object.keys(r).find((x) => ID.test(x.replace(/^.*\./, '')) && !x.startsWith('parent.')); if (k) items[String(r[k])] = r; }
    const cu = cursorOf(j); lastCursor = cu.cursor; lastHasNext = cu.hasNext;
    if (record) { calls.push({ ...req, count: res.length, total: totalOf(j), cursor: cu.cursor, hasNext: cu.hasNext, topKeys: Array.isArray(j) ? ['(배열)'] : Object.keys(j).slice(0, 12) }); if (calls.length > 20) calls.shift(); }
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

  // 마지막으로 줄을 받은 요청을 처음부터 끝까지 다시 부른다 (화면이 쓰는 요청 그대로, 쪽 번호·다음 쪽 표시값만 바꿈)
  window.__ccInvReplay = async (maxReq = 60) => {
    const c = [...calls].reverse().find((x) => x.count > 0); if (!c) return { ok: false, reason: '재고 데이터 요청을 못 봤음' };
    const u = new URL(c.url, location.href); let body = null; try { body = c.body ? JSON.parse(c.body) : null; } catch { body = null; }
    const form = !body && c.body && c.body.includes('=') ? new URLSearchParams(c.body) : null;
    const setters = []; const keys = [];
    const kindOf = (k) => (SIZE.test(k) ? 'size' : PAGE.test(k) ? 'page' : OFF.test(k) ? 'off' : CUR_REQ.test(k) ? 'cur' : null);
    const isNum = (v) => typeof v === 'number' || /^\d+$/.test(String(v));
    for (const k of [...u.searchParams.keys()]) { keys.push(k); const kd = kindOf(k); if (kd && (kd === 'cur' || isNum(u.searchParams.get(k)))) setters.push({ kd, k, get: () => u.searchParams.get(k), set: (v) => u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v)) }); }
    if (form) for (const k of [...form.keys()]) { keys.push(k); const kd = kindOf(k); if (kd && (kd === 'cur' || isNum(form.get(k)))) setters.push({ kd, k, get: () => form.get(k), set: (v) => form.set(k, Array.isArray(v) ? v.join(',') : String(v)) }); }
    const scan = (o, d) => { if (!o || d > 3) return; for (const k of Object.keys(o)) { keys.push(k); const kd = kindOf(k); if (kd && (kd === 'cur' || isNum(o[k]))) setters.push({ kd, k, get: () => o[k], set: (v) => { o[k] = kd !== 'cur' && typeof o[k] === 'string' ? String(v) : v; } }); else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) scan(o[k], d + 1); } };
    if (body) scan(body, 0);
    const size = setters.find((x) => x.kd === 'size'), page = setters.find((x) => x.kd === 'page'), off = setters.find((x) => x.kd === 'off');
    let cur = setters.find((x) => x.kd === 'cur' && c.cursor && x.k.toLowerCase() === c.cursor.key.toLowerCase()) || setters.find((x) => x.kd === 'cur');
    // 요청에 다음 쪽 칸이 없지만 응답에 다음 쪽 표시값이 있으면, 같은 이름으로 넣어 본다 (GET 주소 / JSON 본문)
    if (!page && !off && !cur && c.cursor) { const k = c.cursor.key; if (body) cur = { kd: 'cur', k, get: () => body[k], set: (v) => { body[k] = v; } }; else cur = { kd: 'cur', k, get: () => u.searchParams.get(k), set: (v) => u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v)) }; }
    const info = { path: u.pathname, keys: [...new Set(keys)].slice(0, 25), mode: page ? 'page' : off ? 'offset' : cur ? 'cursor' : '', apiTotal: c.total, firstCount: c.count, cursorKey: c.cursor?.key || '', topKeys: c.topKeys };
    if (!page && !off && !cur) return { ok: false, reason: c.hasNext === false ? '서버가 더 없다고 함' : '쪽 번호·다음 쪽 칸 없음', ...info };
    if (size && (page || off)) size.set(Math.max(Number(size.get()) || 0, 200));
    const start = page ? (Number(page.get()) === 0 ? 0 : 1) : 0;
    const before = Object.keys(items).length; let n = 0, lastErr = '', per0 = null, offAcc = 0, cursorVal = c.cursor?.val ?? null, stopWhy = '';
    for (let i = 0; i < maxReq; i++) {
      if (page) page.set(start + i); else if (off) off.set(offAcc); else { if (cursorVal == null) { stopWhy = '다음 쪽 표시값 없음'; break; } cur.set(cursorVal); }
      const init = { method: c.method, headers: c.headers, credentials: 'include' };
      if (c.method !== 'GET' && c.method !== 'HEAD') init.body = body ? JSON.stringify(body) : form ? form.toString() : c.body;
      const n0 = Object.keys(items).length; let got = 0;
      try { const r = await of.call(window, u.href, init); if (!r.ok) { lastErr = 'HTTP ' + r.status; break; } got = take(c, await r.text(), false); } catch (e) { lastErr = String(e && e.message || e); break; }
      n++; const fresh = Object.keys(items).length - n0;
      if (!got) { stopWhy = '빈 응답'; break; }
      if (per0 == null) per0 = got;   // 서버가 실제로 주는 한 쪽 크기 (200 을 달라 해도 100 만 주는 서버)
      offAcc += got;
      if (cur && !page && !off) { cursorVal = lastCursor?.val ?? null; if (lastHasNext === false) { stopWhy = '마지막 쪽'; break; } }
      else if (got < per0) { stopWhy = '마지막 쪽'; break; }
      if (!fresh && i > 0) { stopWhy = '같은 내용 반복'; break; }
      if (c.total && Object.keys(items).length >= c.total) { stopWhy = '전체 개수 다 읽음'; break; }
    }
    return { ok: true, requests: n, per: per0, added: Object.keys(items).length - before, total: Object.keys(items).length, error: lastErr, stopWhy, ...info };
  };
  window.__ccInvItems = () => Object.values(items);
  window.__ccInvCalls = () => calls.map((c) => ({ url: String(c.url).slice(0, 160), method: c.method, count: c.count, total: c.total }));
})();
