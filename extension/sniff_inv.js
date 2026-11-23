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
  // 응답 속 옵션ID 목록 (목록 요청이 'vendorItemIds: [...]' 처럼 ID 만 주는 화면)
  const IDS_K = /^(vendorItemIds?|vendorItemIdList|vendor_item_ids?|optionIds?|optionIdList)$/i;
  const idsIn = (j) => { const out = new Set(); const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 8) return; if (Array.isArray(o)) { for (const x of o.slice(0, 5000)) walk(x, d + 1); return; } for (const [k, v] of Object.entries(o)) { if (IDS_K.test(k)) { for (const x of Array.isArray(v) ? v : [v]) if ((typeof x === 'number' || typeof x === 'string') && /^\d{8,}$/.test(String(x))) out.add(String(x)); } else if (v && typeof v === 'object') walk(v, d + 1); } }; walk(j, 0); return [...out]; };
  let lastIds = [];
  // 응답 하나 → 찾은 줄 수 (줄이 없어도 옵션ID 목록이 있으면 요청을 기억해 둔다: 두 단계 화면의 목록 요청)
  const take = (req, text, record = true) => {
    if (typeof text !== 'string' || text.length > 2e7) return 0; const s = text.trim(); if (s[0] !== '{' && s[0] !== '[') return 0;
    let j; try { j = JSON.parse(s); } catch { return 0; }
    const res = []; findRows(j, {}, 0, res); const ids = idsIn(j); lastIds = ids;
    for (const r of res) { const k = Object.keys(r).find((x) => ID.test(x.replace(/^.*\./, '')) && !x.startsWith('parent.')); if (k) items[String(r[k])] = r; }
    const cu = cursorOf(j); lastCursor = cu.cursor; lastHasNext = cu.hasNext;
    if (record && (res.length || ids.length)) { calls.push({ ...req, count: res.length, ids: ids.length, total: totalOf(j), cursor: cu.cursor, hasNext: cu.hasNext, topKeys: Array.isArray(j) ? ['(배열)'] : Object.keys(j).slice(0, 12) }); if (calls.length > 30) calls.shift(); }
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

  // 요청 하나를 바꿀 수 있게 풀어 둔다: 쪽 번호·쪽 크기·건너뛰기·다음 쪽 표시값·옵션ID 목록 칸
  const kindOf = (k) => (SIZE.test(k) ? 'size' : PAGE.test(k) ? 'page' : OFF.test(k) ? 'off' : CUR_REQ.test(k) ? 'cur' : IDS_K.test(k) ? 'ids' : null);
  const isNum = (v) => typeof v === 'number' || /^\d+$/.test(String(v));
  function analyze(c) {
    const u = new URL(c.url, location.href); let body = null; try { body = c.body ? JSON.parse(c.body) : null; } catch { body = null; }
    const form = !body && c.body && c.body.includes('=') ? new URLSearchParams(c.body) : null;
    const setters = []; const keys = [];
    const qs = (sp) => { for (const k of [...new Set(sp.keys())]) { keys.push(k); const kd = kindOf(k); const all = sp.getAll(k); const v = all[0];
      if (kd === 'ids') { const rep = all.length > 1; const n = rep ? all.length : String(v).split(',').filter(Boolean).length; setters.push({ kd, k, n, set: (list) => { sp.delete(k); if (rep) for (const x of list) sp.append(k, x); else sp.set(k, list.join(',')); } }); }
      else if (kd && (kd === 'cur' || isNum(v))) setters.push({ kd, k, get: () => sp.get(k), set: (x) => sp.set(k, Array.isArray(x) ? x.join(',') : String(x)) }); } };
    qs(u.searchParams); if (form) qs(form);
    const scan = (o, d) => { if (!o || d > 3) return; for (const k of Object.keys(o)) { keys.push(k); const kd = kindOf(k);
      if (kd === 'ids' && (Array.isArray(o[k]) || typeof o[k] === 'string')) { const asNum = Array.isArray(o[k]) && typeof o[k][0] === 'number'; const asStr = typeof o[k] === 'string'; setters.push({ kd, k, n: asStr ? o[k].split(',').filter(Boolean).length : o[k].length, set: (list) => { o[k] = asStr ? list.join(',') : asNum ? list.map(Number) : list; } }); }
      else if (kd && kd !== 'ids' && (kd === 'cur' || isNum(o[k]))) setters.push({ kd, k, get: () => o[k], set: (v) => { o[k] = kd !== 'cur' && typeof o[k] === 'string' ? String(v) : v; } });
      else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) scan(o[k], d + 1); } };
    if (body) scan(body, 0);
    const pick = (kd) => setters.find((x) => x.kd === kd);
    let cur = setters.find((x) => x.kd === 'cur' && c.cursor && x.k.toLowerCase() === c.cursor.key.toLowerCase()) || pick('cur');
    if (!pick('page') && !pick('off') && !cur && c.cursor) { const k = c.cursor.key; cur = body ? { kd: 'cur', k, set: (v) => { body[k] = v; } } : { kd: 'cur', k, set: (v) => u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v)) }; }
    const send = async () => { const init = { method: c.method, headers: c.headers, credentials: 'include' }; if (c.method !== 'GET' && c.method !== 'HEAD') init.body = body ? JSON.stringify(body) : form ? form.toString() : c.body; const r = await of.call(window, u.href, init); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };
    return { u, size: pick('size'), page: pick('page'), off: pick('off'), cur, ids: pick('ids'), keys: [...new Set(keys)], send };
  }
  // 쪽을 처음부터 끝까지 넘긴다. onPage(text) 는 그 쪽에서 얻은 개수(줄 또는 옵션ID)와 새로 늘어난 개수를 돌려준다
  async function walkPages(c, a, onPage, maxReq) {
    const { page, off, cur, size } = a; if (size && (page || off)) size.set(Math.max(Number(size.get()) || 0, 200));
    const start = page ? (Number(page.get()) === 0 ? 0 : 1) : 0; let n = 0, err = '', per0 = null, offAcc = 0, cursorVal = c.cursor?.val ?? null, stop = '';
    for (let i = 0; i < maxReq; i++) {
      if (page) page.set(start + i); else if (off) off.set(offAcc); else { if (cursorVal == null) { stop = '다음 쪽 표시값 없음'; break; } cur.set(cursorVal); }
      let got = 0, fresh = 0; try { ({ got, fresh } = await onPage(await a.send())); } catch (e) { err = String(e && e.message || e); break; }
      n++; if (!got) { stop = '빈 응답'; break; }
      if (per0 == null) per0 = got; offAcc += got;
      if (cur && !page && !off) { cursorVal = lastCursor?.val ?? null; if (lastHasNext === false) { stop = '마지막 쪽'; break; } }
      else if (got < per0) { stop = '마지막 쪽'; break; }
      if (!fresh && i > 0) { stop = '같은 내용 반복'; break; }
      if (c.total && got && offAcc >= c.total) { stop = '전체 개수 다 읽음'; break; }
    }
    return { requests: n, per: per0, error: err, stopWhy: stop };
  }
  // 화면이 쓰는 요청을 처음부터 끝까지 다시 부른다
  //  ① 줄(재고)을 주는 요청에 쪽 칸이 있으면 그 요청을 넘긴다
  //  ② 두 단계 화면: 쪽 칸이 있는 '목록' 요청으로 옵션ID 들을 끝까지 받고, 그 ID 들을 '재고' 요청(vendorItemIds 칸)에 나눠 넣어 부른다
  window.__ccInvReplay = async (maxReq = 60) => {
    const rev = [...calls].reverse(); const before = Object.keys(items).length;
    const rowCalls = rev.filter((x) => x.count > 0); if (!rowCalls.length) return { ok: false, reason: '재고 데이터 요청을 못 봤음' };
    const D = rowCalls[0], aD = analyze(D);
    const info = (c, a, mode) => ({ path: a.u.pathname, keys: a.keys.slice(0, 25), mode, apiTotal: c.total, firstCount: c.count, cursorKey: c.cursor?.key || '', topKeys: c.topKeys });
    for (const c of rowCalls) {
      const a = c === D ? aD : analyze(c); if (!a.page && !a.off && !a.cur) continue;
      const r = await walkPages(c, a, async (text) => { const n0 = Object.keys(items).length; const got = take(c, text, false); return { got, fresh: Object.keys(items).length - n0 }; }, maxReq);
      return { ok: true, ...r, added: Object.keys(items).length - before, total: Object.keys(items).length, ...info(c, a, a.page ? 'page' : a.off ? 'offset' : 'cursor') };
    }
    if (aD.ids) {
      const L = rev.find((x) => x !== D && x.ids > 0 && (() => { const a = analyze(x); return a.page || a.off || a.cur || x.cursor; })());
      if (L) {
        const aL = analyze(L); const chunk = Math.max(20, Math.min(200, aD.ids.n || 100)); const asked = new Set(Object.keys(items)); let detailReq = 0, detailErr = '';
        const r = await walkPages(L, aL, async (text) => {
          take(L, text, false); const ids = lastIds; const want = ids.filter((x) => !asked.has(x)); want.forEach((x) => asked.add(x));
          for (let k = 0; k < want.length; k += chunk) { aD.ids.set(want.slice(k, k + chunk)); try { take(D, await aD.send(), false); detailReq++; } catch (e) { detailErr = String(e && e.message || e); } }
          return { got: ids.length, fresh: want.length };
        }, maxReq);
        return { ok: true, ...r, error: r.error || detailErr, detailRequests: detailReq, added: Object.keys(items).length - before, total: Object.keys(items).length, ...info(L, aL, 'list+ids'), detailPath: aD.u.pathname };
      }
      return { ok: false, reason: `재고 요청(${aD.ids.k})은 찾았지만 쪽 칸이 있는 목록 요청을 못 찾음`, ...info(D, aD, '') , seen: rev.map((x) => `${new URL(x.url, location.href).pathname}(줄${x.count}/ID${x.ids})`).slice(0, 8) };
    }
    return { ok: false, reason: D.hasNext === false ? '서버가 더 없다고 함' : '쪽 번호·다음 쪽 칸 없음', ...info(D, aD, ''), seen: rev.map((x) => `${new URL(x.url, location.href).pathname}(줄${x.count}/ID${x.ids})`).slice(0, 8) };
  };
  window.__ccInvItems = () => Object.values(items);
  window.__ccInvCalls = () => calls.map((c) => ({ url: String(c.url).slice(0, 160), method: c.method, count: c.count, ids: c.ids, total: c.total }));
})();
