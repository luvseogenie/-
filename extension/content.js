// 쿠팡 판매자센터/광고센터 페이지에서 표(table 또는 ag-grid 같은 role=grid)를 읽는다.
// popup/background 가 {type:'read', kind:'sales'|'ads'} 메시지를 보내면 {records, date, tables} 를 돌려준다.
(() => {
  if (window.__ccInstalled) return;
  window.__ccInstalled = true;

  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const norm = (t) => clean(t).replace(/[\s_\-()/\[\]:·※*]/g, '').toLowerCase();

  // ---------- 표 읽기 ----------
  function readHtmlTables(root) {
    const out = [];
    deepAll('table', root).forEach((t) => {
      let headerRow = t.querySelector('thead tr:last-child') || t.querySelector('tr');
      if (!headerRow) return;
      const headers = [...headerRow.querySelectorAll('th, td')].map((c) => clean(c.innerText));
      const bodyRows = t.querySelectorAll('tbody tr').length ? [...t.querySelectorAll('tbody tr')] : [...t.querySelectorAll('tr')].slice(1);
      const rows = bodyRows.map((tr) => [...tr.querySelectorAll('td, th')].map((c) => clean(c.innerText))).filter((r) => r.length > 1);
      if (headers.length && rows.length) out.push({ headers, rows, kind: 'table' });
    });
    return out;
  }

  function readAgGrids(root) {
    const out = [];
    deepAll('.ag-root, .ag-root-wrapper', root).forEach((g) => {
      const headers = {};
      g.querySelectorAll('.ag-header-cell[col-id]').forEach((h) => {
        const txt = clean(h.querySelector('.ag-header-cell-text')?.innerText || h.innerText);
        if (txt) headers[h.getAttribute('col-id')] = txt;
      });
      const colIds = Object.keys(headers);
      if (!colIds.length) return;
      const byIndex = new Map();
      g.querySelectorAll('.ag-row[row-index]').forEach((r) => {
        const idx = Number(r.getAttribute('row-index'));
        const rec = byIndex.get(idx) || {};
        r.querySelectorAll('.ag-cell[col-id]').forEach((c) => { rec[c.getAttribute('col-id')] = clean(c.innerText); });
        byIndex.set(idx, rec);
      });
      const rows = [...byIndex.keys()].sort((a, b) => a - b).map((i) => colIds.map((id) => byIndex.get(i)[id] ?? ''));
      if (rows.length) out.push({ headers: colIds.map((id) => headers[id]), rows, kind: 'ag-grid' });
    });
    return out;
  }

  function readAriaGrids(root) {
    const out = [];
    deepAll('[role="grid"], [role="table"], [role="treegrid"]', root).forEach((g) => {
      if (g.closest('.ag-root, .ag-root-wrapper')) return; // ag-grid 는 위에서 처리
      const rows = [...g.querySelectorAll('[role="row"]')];
      if (rows.length < 2) return;
      const headerRow = rows.find((r) => r.querySelector('[role="columnheader"]')) || rows[0];
      const headers = [...headerRow.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"]')].map((c) => clean(c.innerText));
      const body = rows.filter((r) => r !== headerRow).map((r) => [...r.querySelectorAll('[role="gridcell"], [role="cell"], [role="rowheader"]')].map((c) => clean(c.innerText))).filter((r) => r.length > 1);
      if (headers.length && body.length) out.push({ headers, rows: body, kind: 'aria-grid' });
    });
    return out;
  }

  // shadow DOM 안까지 훑는 querySelectorAll
  function deepAll(selector, root = document) {
    const out = [...root.querySelectorAll(selector)];
    const walk = (n) => { for (const el of n.querySelectorAll('*')) if (el.shadowRoot) { out.push(...el.shadowRoot.querySelectorAll(selector)); walk(el.shadowRoot); } };
    walk(root); return out;
  }
  function leafTexts(el) {
    const out = [];
    const walk = (n) => {
      if (n.nodeType === 3) { const t = clean(n.textContent); if (t) out.push(t); return; }
      if (n.nodeType !== 1) return;
      if (['SCRIPT', 'STYLE', 'SVG', 'IMG', 'INPUT', 'BUTTON'].includes(n.tagName)) return;
      const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return;
      for (const c of n.childNodes) walk(c);
      if (n.shadowRoot) for (const c of n.shadowRoot.childNodes) walk(c);
    };
    walk(el); return out;
  }
  const HEADER_WORDS = ['캠페인', '광고비', '노출', '클릭', '전환', '예산', '매출', '수익률', 'ROAS', '옵션', '판매', '주문', '방문자', '조회', '장바구니'];
  const headerScore = (texts) => texts.reduce((n, t) => n + (HEADER_WORDS.some((w) => t.toLowerCase().includes(w.toLowerCase())) ? 1 : 0), 0);
  // 줄 요소 → 칸 글자 목록. 자식 요소가 여럿이면 자식 하나가 한 칸, 아니면 말단 글자 하나가 한 칸.
  function cellTexts(rowEl) {
    const kids = [...rowEl.children].filter((c) => !['SCRIPT', 'STYLE'].includes(c.tagName));
    if (kids.length >= 4) return kids.map((c) => leafTexts(c).join(' '));
    // 자식이 하나뿐인 래퍼(예: <a><div>…</div></a>)면 한 단계 내려간다
    if (kids.length === 1 && kids[0].children.length >= 4) return cellTexts(kids[0]);
    return leafTexts(rowEl);
  }
  // 같은 모양의 자식이 3개 이상 반복되는 요소를 '줄 목록'으로 보고, 근처의 머리글 줄과 짝지어 표로 만든다.
  function readDivGrids() {
    const out = [];
    const seen = new Set();
    for (const parent of deepAll('*')) {
      if (parent.children.length < 3 || seen.has(parent)) continue;
      if (['TABLE', 'TBODY', 'THEAD', 'TR', 'SELECT', 'SCRIPT', 'STYLE'].includes(parent.tagName)) continue;
      if (parent.closest('table, .ag-root, [role="grid"]')) continue;
      const groups = {};
      for (const c of parent.children) { const k = c.tagName + '|' + c.className; (groups[k] ||= []).push(c); }
      for (const members of Object.values(groups)) {
        if (members.length < 3) continue;
        const rows = members.map(cellTexts).filter((r) => r.length >= 4 && r.some((t) => /\d/.test(t)));
        if (rows.length < 3) continue;
        const counts = rows.map((r) => r.length).sort((x, y) => x - y); const med = counts[Math.floor(counts.length / 2)];
        const good = rows.filter((r) => Math.abs(r.length - med) <= Math.max(2, med * 0.5));
        if (good.length < 3) continue;
        // 머리글 후보: 같은 부모의 다른 자식, 부모의 이전 형제(와 그 안), 조부모의 이전 형제, 첫 줄
        const cands = [];
        for (const c of parent.children) if (!members.includes(c)) cands.push(c);
        let sib = parent.previousElementSibling; for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) { cands.push(sib); cands.push(...sib.querySelectorAll('*')); }
        if (parent.parentElement) { let ps = parent.parentElement.previousElementSibling; for (let i = 0; i < 3 && ps; i++, ps = ps.previousElementSibling) { cands.push(ps); cands.push(...ps.querySelectorAll('*')); } for (const c of parent.parentElement.children) if (c !== parent) cands.push(c); }
        cands.push(members[0]);
        let header = null, best = 1;
        for (const c of cands) {
          const t = cellTexts(c); if (t.length < 3) continue;
          const sc = headerScore(t) * 2 - Math.abs(t.length - med) * 0.5; // 키워드가 많고 칸 수가 비슷할수록
          if (sc > best) { best = sc; header = { el: c, texts: t }; }
        }
        if (!header) continue;
        const body = header.el === members[0] ? good.slice(1) : good;
        if (!body.length) continue;
        seen.add(parent);
        out.push({ headers: header.texts, rows: body, kind: 'div-grid' });
      }
    }
    return out;
  }

  // ---------- 페이지 넘기며 읽기 (광고센터 캠페인 목록: '페이지 1 / 2', '10 개' 선택) ----------
  function setNativeValue(el, value) {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set; if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function pageTotal() {
    const m = clean(document.body.innerText).match(/페이지\s*(\d+)?\s*\/\s*(\d+)/) || clean(document.body.innerText).match(/(\d+)\s*\/\s*(\d+)\s*(페이지|page)/i);
    return m ? parseInt(m[2], 10) : 1;
  }
  function pagerInput() {
    return [...deepAll('input')].find((i) => (i.type === 'text' || i.type === 'number') && /^\d+$/.test(i.value) && /\/\s*\d+/.test(clean(i.parentElement?.innerText || '') + clean(i.parentElement?.parentElement?.innerText || '')));
  }
  // 지금 표의 '지문' (첫 칸들) — 페이지가 실제로 바뀌었는지 확인용
  const rowsFingerprint = (kind) => { const p = window.__ccPick(kind); return p ? p.records.map((r) => Object.values(r)[0]).join('|') : ''; };
  // 조건이 될 때까지 기다린다 (최대 ms)
  async function waitUntil(cond, ms, step = 300) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await wait(step); } return cond(); }
  async function maximizePageSize(kind) {
    const sel = [...deepAll('select')].find((s) => [...s.options].filter((o) => /^\s*\d+\s*(개|건|rows|items)?\s*$/i.test(o.textContent)).length >= 2);
    if (!sel) return null;
    const best = [...sel.options].reduce((a, o) => (parseInt(o.textContent, 10) || 0) > (parseInt(a.textContent, 10) || 0) ? o : a);
    if (best.value === sel.value) return null;
    const before = rowsFingerprint(kind); const beforeTotal = pageTotal();
    // 표가 아직 준비 중이면 React 가 값을 되돌리기도 한다 → 안 먹으면 2초 뒤 다시, 최대 3번
    let changed = false;
    for (let i = 0; i < 3 && !changed; i++) {
      if (i) await wait(2000);
      sel.focus(); setNativeValue(sel, best.value); sel.dispatchEvent(new Event('blur', { bubbles: true }));
      changed = await waitUntil(() => rowsFingerprint(kind) !== before || pageTotal() !== beforeTotal, 6000);
    }
    await wait(500);
    return clean(best.textContent) + (changed ? '' : ' (적용 안 됨)');
  }
  async function gotoPage(n, kind) {
    const before = rowsFingerprint(kind);
    const input = pagerInput();
    if (input) {
      setNativeValue(input, String(n));
      for (const t of ['keydown', 'keypress', 'keyup']) input.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));   // react-table 은 blur 에서도 이동
      if (await waitUntil(() => rowsFingerprint(kind) !== before, 6000)) return true;
    }
    // 다음 버튼: '/ N' 글자 오른쪽에 있는 첫 버튼 (입력칸이 없거나 안 먹을 때)
    const anchor = [...deepAll('*')].find((e) => e.children.length === 0 && /^\/\s*\d+$/.test(clean(e.innerText)));
    if (anchor) {
      const ax = anchor.getBoundingClientRect(); const ay = (ax.top + ax.bottom) / 2;
      const btn = [...deepAll('button, a, [role="button"]')].filter((b) => { const r = b.getBoundingClientRect(); return visible(b) && r.left > ax.right && Math.abs((r.top + r.bottom) / 2 - ay) < 30 && r.left - ax.right < 400; }).sort((p, q) => p.getBoundingClientRect().left - q.getBoundingClientRect().left)[0];
      if (btn && !btn.disabled) { fire(btn, [...HOVER, ...CLICK]); if (await waitUntil(() => rowsFingerprint(kind) !== before, 6000)) return true; }
    }
    // '다음' / '>' 글자 버튼
    const next = [...deepAll('button, a, [role="button"], li')].find((b) => visible(b) && !b.disabled && /^(다음|next|›|>|»)$/i.test(clean(b.innerText)));
    if (next) { fire(next, [...HOVER, ...CLICK]); if (await waitUntil(() => rowsFingerprint(kind) !== before, 6000)) return true; }
    return false;
  }
  // 새로 나타난 줄의 성과 숫자가 뒤늦게 채워지므로, 표의 모든 칸이 1.5초 간격 두 번 연속 같을 때까지 기다린다 (최대 ms)
  const fullSnapshot = (kind) => { const p = window.__ccPick(kind); return p ? JSON.stringify(p.records) : ''; };
  const PERF = /노출|클릭|광고비|매출|전환/;
  const rowLacksNumbers = (rec) => !Object.entries(rec).some(([k, v]) => PERF.test(k) && parseFloat(String(v).replace(/[^\d.]/g, '')) > 0);
  const zeroRows = (kind) => { const p = window.__ccPick(kind); return p ? p.records.filter(rowLacksNumbers).length : 0; };
  // 안정(1.5초 간격 두 번 같음) + 성과가 0인 줄이 없거나 6초 넘게 기다렸을 때
  async function settleRows(kind, ms = 10000) {
    const t0 = Date.now(); let prev = fullSnapshot(kind);
    while (Date.now() - t0 < ms) {
      await wait(1500); const cur = fullSnapshot(kind);
      if (cur && cur === prev && (zeroRows(kind) === 0 || Date.now() - t0 >= 6000)) return true;
      prev = cur;
    }
    return false;
  }
  // 화면에 적힌 전체 건수 ('총 17개', '17건', '캠페인 17')
  function shownTotal() {
    const t = clean(document.body.innerText);
    const m = t.match(/(?:총|전체|캠페인)\s*(\d{1,4})\s*(?:개|건)/) || t.match(/(\d{1,4})\s*(?:개|건)\s*(?:의\s*)?캠페인/);
    return m ? parseInt(m[1], 10) : null;
  }
  async function readAllPages(kind) {
    const all = []; const seen = new Set(); const notes = [];
    const size = await maximizePageSize(kind); if (size) { notes.push(`페이지당 ${size}로 변경`); if (!(await settleRows(kind))) notes.push('줄 내용이 계속 바뀜'); }
    const total0 = pageTotal(); let pages = 0;
    for (let i = 1; i <= Math.min(total0, 30); i++) {
      if (i > 1) {
        let ok = await gotoPage(i, kind);
        if (!ok) { await wait(2500); ok = await gotoPage(i, kind); }   // 한 번 더
        if (!ok) { notes.push(`${i}쪽으로 넘어가도 내용이 바뀌지 않음`); break; }
        await settleRows(kind);
      }
      const picked = window.__ccPick(kind); if (!picked) { if (i === 1) break; notes.push(`${i}쪽에서 표를 못 읽음`); break; }
      pages++;
      let added = 0;
      for (const r of picked.records) { const key = Object.values(r).slice(0, 1).join('|'); if (!seen.has(key)) { seen.add(key); all.push(r); added++; } }
      if (i > 1 && !added) notes.push(`${i}쪽이 앞쪽과 같은 내용`);
      if (pageTotal() <= i) break;
    }
    const total = shownTotal(); if (total && total !== all.length) notes.push(`화면 표기 전체 ${total}개 중 ${all.length}개 읽음`);
    if (pages > 1) { try { await gotoPage(1, kind); } catch { /* 무시 */ } }
    const tables = allTables().map((t) => ({ kind: t.kind, headers: t.headers.slice(0, 14), rows: t.rows.length }));
    return { ok: all.length > 0, records: all, pages, total: total0, shownTotal: total, notes, date: detectDate(), period: detectPeriod(), url: location.href, tables, errors: [...readErrors] };
  }

  // 광고센터 캠페인 목록(react-table v6): .rt-table > .rt-thead.-header .rt-th / .rt-tbody .rt-tr-group .rt-tr .rt-td
  function readReactTables() {
    const out = [];
    for (const t of deepAll('.rt-table, .ReactTable')) {
      const head = t.querySelector('.rt-thead.-header') || t.querySelector('.rt-thead');
      if (!head) continue;
      const headers = [...head.querySelectorAll('.rt-th')].map((h) => clean(h.innerText));
      const rows = [...t.querySelectorAll('.rt-tbody .rt-tr')].map((r) => [...r.querySelectorAll('.rt-td')].map((c) => clean(c.innerText))).filter((r) => r.length >= 3 && r.some((x) => x));
      if (headers.length && rows.length) out.push({ headers, rows, kind: 'react-table' });
    }
    return out;
  }
  const readErrors = [];
  function safe(name, fn) { try { return fn(); } catch (e) { readErrors.push(name + ': ' + (e && e.message ? e.message : e)); return []; } }
  function allTables() {
    readErrors.length = 0;
    const rt = safe('react-table', readReactTables);
    return [...rt, ...safe('ag-grid', () => readAgGrids(document)), ...safe('table', () => readHtmlTables(document)), ...safe('aria-grid', () => readAriaGrids(document).filter((g) => !rt.length)), ...safe('div-grid', () => (rt.length ? [] : readDivGrids()))];
  }

  const KIND_RULES = {
    sales: { must: ['옵션id'], any: ['매출', '판매량'] },   // 판매분석의 필터 줄('판매된 옵션 (63)')이 표로 오인되지 않도록 옵션ID 헤더를 요구
    ads: { must: ['캠페인'], any: ['광고비', '노출', '예산', '클릭', '비용'] },
  };

  function pickTable(tables, kind) {
    const rule = KIND_RULES[kind];
    const score = (t) => {
      const hs = t.headers.map(norm).join('|');
      if (!rule.must.every((k) => hs.includes(k))) return -1;
      if (!rule.any.some((k) => hs.includes(k))) return -1;
      return t.rows.length * 10 + t.headers.length;
    };
    return tables.map((t) => ({ t, s: score(t) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0]?.t || null;
  }

  function toRecords(table) {
    const { headers, rows } = table;
    return rows.map((r) => { const o = {}; headers.forEach((h, i) => { if (h) o[h] = r[i] ?? ''; }); return o; })
      .filter((o) => Object.values(o).some((v) => v !== ''));
  }

  // ---------- 날짜 찾기 ----------
  function dateFromUrl(url) {
    // 판매분석: ...sales-analysis?start_date=2026-09-01&end_date=2026-09-01 → 시작=끝이면 그 날짜
    try {
      const u = new URL(url); const q = u.searchParams;
      const pick = (keys) => { for (const k of keys) { const v = q.get(k); if (v && /^20\d{2}-?\d{2}-?\d{2}$/.test(v)) return v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v; } return null; };
      const s = pick(['start_date', 'startDate', 'from', 'startDt', 'beginDate']), e = pick(['end_date', 'endDate', 'to', 'endDt']);
      if (s && (!e || s === e)) return s;
      const single = pick(['date', 'targetDate', 'reportDate']); if (single) return single;
    } catch { /* 무시 */ }
    return null;
  }
  function detectPeriod() {
    const re = /(20\d{2})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/g;
    const cands = [];
    try { const q = new URL(location.href).searchParams; const s0 = q.get('start_date') || q.get('startDate'), e0 = q.get('end_date') || q.get('endDate'); if (s0 && e0) cands.push(`${s0} ~ ${e0}`); } catch { /* 무시 */ }
    document.querySelectorAll('input').forEach((i) => { if (i.value) cands.push(i.value); });
    document.querySelectorAll('[class*="date" i], [class*="picker" i], [class*="calendar" i], [class*="period" i], [class*="range" i]').forEach((e) => cands.push(clean(e.innerText)));
    for (const c of cands) {
      const found = [...c.matchAll(re)].map((m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
      if (found.length >= 2) return { start: found[0], end: found[1] };
      if (found.length === 1) return { start: found[0], end: found[0] };
    }
    return null;
  }
  function detectDate() {
    const fromUrl = dateFromUrl(location.href); if (fromUrl) return fromUrl;
    const re = /(20\d{2})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/g;
    const cands = [];
    document.querySelectorAll('input').forEach((i) => { if (i.value) cands.push(i.value); });
    document.querySelectorAll('[class*="date" i], [class*="picker" i], [class*="calendar" i], [class*="period" i]').forEach((e) => cands.push(clean(e.innerText)));
    for (const c of cands) {
      const found = [...c.matchAll(re)].map((m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
      if (found.length) return found[0];
    }
    // '09.01 (화)' 처럼 연도 없는 표기 (판매분석 옵션목록 제목) → 올해, 미래면 작년
    const m = clean(document.body.innerText).match(/(\d{1,2})\.(\d{1,2})\s*\((월|화|수|목|금|토|일)\)/);
    if (m) {
      const now = new Date(); let y = now.getFullYear();
      let d = new Date(y, +m[1] - 1, +m[2]); if (d > now) { y -= 1; d = new Date(y, +m[1] - 1, +m[2]); }
      return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
    return null;
  }

  // ---------- '엑셀 다운로드' → '상품별 판매 리포트' 클릭 (판매분석) ----------
  const visible = (e) => e.offsetParent !== null || e.getClientRects().length > 0;
  function findByText(text, exact = true) {
    // 같은 글자를 가진 요소 중 가장 안쪽(자손이 적은) 것을 앞에 둔다. 버튼/링크 우선.
    return [...document.querySelectorAll('button, a, li, span, div, label')].filter((e) => {
      const t = clean(e.innerText); return visible(e) && (exact ? t === text : t.includes(text));
    }).sort((x, y) => {
      const px = x.tagName === 'BUTTON' || x.tagName === 'A' ? 0 : 1, py = y.tagName === 'BUTTON' || y.tagName === 'A' ? 0 : 1;
      return px - py || x.querySelectorAll('*').length - y.querySelectorAll('*').length;
    });
  }
  const fire = (el, types) => types.forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  const HOVER = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove'];
  const CLICK = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function findItem(texts, tries = 10) {
    for (let i = 0; i < tries; i++) {
      await wait(200);
      for (const t of texts) { const el = findByText(t)[0] || findByText(t, false)[0]; if (el) return el; }
    }
    return null;
  }
  function visibleTexts(keyword) {
    return [...document.querySelectorAll('button, a, li, span, div, label, p')]
      .filter((e) => visible(e) && e.children.length <= 2 && clean(e.innerText).includes(keyword))
      .map((e) => `${e.tagName.toLowerCase()}:${clean(e.innerText).slice(0, 40)}`).slice(0, 12);
  }
  async function clickDownloadReport(dryRun = false) {
    const btn = findByText('엑셀 다운로드')[0] || findByText('엑셀 다운로드', false)[0];
    if (!btn) return { ok: false, reason: '엑셀 다운로드 버튼을 찾지 못했습니다', diag: visibleTexts('다운로드') };
    if (dryRun) return { ok: true, found: true };   // 시험: 버튼만 확인하고 누르지 않는다
    const ITEM = ['상품별 판매 리포트', '상품별 판매', '상품별'];
    // 1) 마우스 올림으로 열리는 메뉴 (Ant Design Dropdown 기본)
    fire(btn, HOVER); let item = await findItem(ITEM, 8);
    // 2) 클릭으로 열리는 메뉴
    if (!item) { fire(btn, CLICK); item = await findItem(ITEM, 8); }
    // 3) 버튼을 감싼 요소 클릭
    if (!item && btn.parentElement) { fire(btn.parentElement, [...HOVER, ...CLICK]); item = await findItem(ITEM, 6); }
    if (!item) return { ok: false, reason: "'상품별 판매 리포트' 메뉴를 찾지 못했습니다", diag: visibleTexts('리포트').concat(visibleTexts('다운로드')) };
    fire(item, HOVER); fire(item, CLICK);
    return { ok: true };
  }
  async function clickAnyDownload() {
    const labels = ['엑셀 다운로드', '엑셀다운로드', '다운로드', '보고서 다운로드', '리포트 다운로드', '내보내기', 'Excel'];
    let btn = null;
    for (const l of labels) { btn = findByText(l)[0] || findByText(l, false)[0]; if (btn) break; }
    if (!btn) return { ok: false, reason: '다운로드 버튼을 찾지 못했습니다', diag: visibleTexts('다운로드') };
    fire(btn, HOVER); fire(btn, CLICK);
    // 하위 메뉴가 열리면 '캠페인' 또는 '엑셀' 이 들어간 항목을 누른다
    const item = await findItem(['캠페인 보고서', '캠페인', '엑셀', 'Excel', 'xlsx'], 5);
    if (item && item !== btn) { fire(item, HOVER); fire(item, CLICK); }
    return { ok: true, clicked: clean(btn.innerText).slice(0, 30) + (item ? ' → ' + clean(item.innerText).slice(0, 30) : '') };
  }
  function pageInfo() {
    const text = clean(document.body.innerText);
    return { hasExcelDownload: text.includes('엑셀 다운로드'), hasAnyDownload: /다운로드|내보내기|Excel/i.test(text), hasOptionList: text.includes('옵션목록'),
      hasLogin: !!deepAll('input[type="password"]').find(visible),
      hasLoginChooser: /\/user\/login/.test(location.pathname) || (/광고센터 로그인/.test(text) && loginChooserButtons().length > 0),
      header: headerTexts(),
      hasCampaignText: text.includes('캠페인'), textLength: text.length, frames: window.top === window ? 'top' : 'iframe', title: document.title, url: location.href };
  }
  // 구조 진단: 프레임, 커스텀 엘리먼트(shadow DOM), 반복 줄 그룹, 캠페인처럼 보이는 글자
  function structureInfo() {
    const all = [...document.querySelectorAll('*')];
    const custom = all.filter((e) => e.tagName.includes('-'));
    const openShadow = custom.filter((e) => e.shadowRoot).length;
    const closedLike = custom.filter((e) => !e.shadowRoot && e.getBoundingClientRect().height > 100 && clean(e.innerText).length < 20).map((e) => e.tagName.toLowerCase()).slice(0, 10);
    const groups = [];
    for (const parent of all) {
      if (parent.children.length < 5) continue;
      const g = {}; for (const c of parent.children) { const k = c.tagName + '|' + c.className; g[k] = (g[k] || 0) + 1; }
      const [k, n] = Object.entries(g).sort((x, y) => y[1] - x[1])[0];
      if (n >= 5) groups.push({ parent: parent.tagName.toLowerCase() + (parent.className ? '.' + String(parent.className).split(' ')[0] : ''), child: k.slice(0, 60), n, text: clean(parent.innerText).slice(0, 80) });
    }
    groups.sort((a, b) => b.n - a.n);
    const lines = clean(document.body.innerText).split(/(?=\s\d{1,3}\.\s)/).filter((l) => /^\s?\d{1,3}\.\s\S/.test(l)).slice(0, 5).map((l) => l.trim().slice(0, 120));
    return { iframes: [...document.querySelectorAll('iframe')].map((f) => (f.src || '(no src)').slice(0, 120)), customElements: custom.length, openShadow, closedLike, groups: groups.slice(0, 8), campaignLikeLines: lines, url: location.href };
  }

  // ---------- '어제' 버튼 클릭 (자동 수집용) ----------
  function findYesterday() {
    return deepAll('button, a, label, li, span, div, td').filter((e) => clean(e.innerText) === '어제' && e.offsetParent !== null);
  }
  function clickYesterday() {
    let els = findYesterday();
    if (!els.length) {
      // 기간 선택기가 닫혀 있으면 먼저 열어 본다 (오늘/기간/날짜 버튼)
      const opener = deepAll('button, a, div[class*="date" i], div[class*="period" i], div[class*="picker" i]')
        .filter((e) => e.offsetParent !== null && /^(오늘|기간|날짜|최근|이번 달|\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/.test(clean(e.innerText)))[0];
      if (opener) { fire(opener, HOVER); fire(opener, CLICK); els = findYesterday(); }
    }
    if (els.length) { fire(els[0], HOVER); fire(els[0], CLICK); return true; }
    return false;
  }

  // 로그인 화면이면 아이디·비밀번호를 채우고 로그인 버튼을 누른다 (자동 로그인, 선택 기능)
  async function doLogin(id, pw) {
    const pwEl = deepAll('input[type="password"]').find(visible);
    if (!pwEl) return { ok: false, reason: '비밀번호 칸이 없습니다' };
    const texts = deepAll('input').filter((i) => visible(i) && i !== pwEl && ['text', 'email', 'tel', ''].includes(i.type || ''));
    // 비밀번호 칸보다 앞에 있는 마지막 글자 칸 = 아이디 칸
    const before = texts.filter((i) => i.compareDocumentPosition(pwEl) & Node.DOCUMENT_POSITION_FOLLOWING);
    const idEl = before[before.length - 1] || texts[0];
    if (!idEl) return { ok: false, reason: '아이디 칸이 없습니다' };
    idEl.focus(); setNativeValue(idEl, id); await wait(150);
    pwEl.focus(); setNativeValue(pwEl, pw); await wait(300);
    const form = pwEl.closest('form');
    const pool = form ? [...form.querySelectorAll('button, input[type="submit"], [role="button"]')] : deepAll('button, input[type="submit"], [role="button"]');
    const btn = pool.find((b) => visible(b) && /로그인|sign\s*in|log\s*in|submit|확인/i.test(clean(b.innerText || b.value || b.getAttribute('aria-label') || ''))) || (form && form.querySelector('button[type="submit"], input[type="submit"]'));
    let how = 'enter';
    if (btn) { fire(btn, [...HOVER, ...CLICK]); how = 'button:' + clean(btn.innerText || btn.value || '').slice(0, 20); }
    else if (form && form.requestSubmit) { form.requestSubmit(); how = 'form'; }
    else for (const t of ['keydown', 'keypress', 'keyup']) pwEl.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    return { ok: true, how };
  }

  // 글자로 누를 것 찾기: 정확히 같은 글자 → 그 글자로 시작 → 포함, 순서대로. 보이는 것만.
  const CLICKABLE = 'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], li, label, span, div, td';
  function findClickable(texts, { exactOnly = false } = {}) {
    // 같은 글자를 가진 요소가 겹겹이면(li > button > span) 가장 안쪽 것을 고른다 — 클릭 처리기가 보통 거기 붙어 있다
    const els = deepAll(CLICKABLE).filter((e) => visible(e) && e.children.length <= 3).sort((x, y) => x.querySelectorAll('*').length - y.querySelectorAll('*').length);
    const norm = (t) => clean(t).replace(/\s+/g, '');
    for (const mode of exactOnly ? ['exact'] : ['exact', 'start', 'contain']) {
      for (const t of texts) {
        const nt = norm(t);
        const hit = els.find((e) => { const et = norm(e.innerText || e.value || e.getAttribute('aria-label') || ''); if (!et || et.length > 40) return false; return mode === 'exact' ? et === nt : mode === 'start' ? et.startsWith(nt) : et.includes(nt); });
        if (hit) return hit;
      }
    }
    return null;
  }
  function clickText(texts, opts = {}) {
    const el = findClickable(texts, opts);
    if (!el) return { ok: false, reason: `'${texts[0]}' 를 찾지 못했습니다` };
    const target = el.closest('button, a, [role="button"], [role="tab"], [role="menuitem"], label') || el;
    fire(target, [...HOVER, ...CLICK]); try { if (target !== el) fire(el, CLICK); } catch { /* 무시 */ }
    try { target.click(); } catch { /* 무시 */ } try { if (target !== el) el.click(); } catch { /* 무시 */ }
    return { ok: true, text: clean(el.innerText || el.value || '').slice(0, 30), tag: target.tagName.toLowerCase() };
  }
  // 글자 위에 마우스 올리기 (드롭다운 메뉴 열기용)
  function hoverText(texts) {
    const el = findClickable(texts); if (!el) return { ok: false };
    const target = el.closest('li, a, button, div') || el; fire(target, HOVER); fire(el, HOVER);
    return { ok: true, text: clean(el.innerText).slice(0, 30) };
  }
  // 이 화면이 불러온 같은 도메인 스크립트 주소 (라우트 경로를 찾기 위해)
  function scriptUrls() {
    const out = new Set();
    for (const s2 of deepAll('script[src]')) { try { const u = new URL(s2.src, location.href); if (u.origin === location.origin) out.add(u.href); } catch { /* 무시 */ } }
    try { for (const e of performance.getEntriesByType('resource')) if (/\.js(\?|$)/.test(e.name) && e.name.startsWith(location.origin)) out.add(e.name); } catch { /* 무시 */ }
    return [...out].slice(0, 20);
  }
  // 캠페인 상세 화면의 상품(옵션) 목록: '상품명 … ID: 95988650186' → [{option_id, name}]
  function readCampaignOptions() {
    const out = {};
    const ID = /ID\s*[:：]?\s*(\d{6,})/;
    for (const t of allTables()) {
      const hi = t.headers.findIndex((h) => /상품명|옵션명|상품|옵션/.test(h));
      for (const r of t.rows) {
        const cells = hi >= 0 ? [r[hi], ...r] : r;
        for (const c of cells) { const m = String(c || '').match(ID); if (m) { const name = clean(String(c).replace(m[0], '')); if (!out[m[1]] || name.length > out[m[1]].length) out[m[1]] = name; break; } }
      }
    }
    if (!Object.keys(out).length) {
      // 표를 못 읽으면: 'ID: 숫자' 글자 조각에서 위로 올라가며 상품명이 같이 들어간 짧은 덩어리를 찾는다
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n; while ((n = walker.nextNode())) {
        const m = (n.textContent || '').match(ID); if (!m) continue;
        let el = n.parentElement; for (let i = 0; i < 5 && el && el.parentElement && clean(el.parentElement.innerText).length < 200; i++) el = el.parentElement;
        const name = clean((el?.innerText || '').replace(ID, '')); if (!out[m[1]] || name.length > out[m[1]].length) out[m[1]] = name;
      }
    }
    return Object.entries(out).map(([option_id, name]) => ({ option_id, name: name.replace(/^(ON|OFF)\s*/i, '').slice(0, 80) }));
  }

  // 캠페인 목록에서 이름이 든 줄을 찾아, 그 줄 안의 링크 주소와 구조를 돌려준다 (이름 클릭이 안 먹을 때 주소로 이동하기 위해)
  function findRowLink(text) {
    const norm = (t) => clean(t).replace(/\s+/g, '');
    const nt = norm(text);
    // 같은 글자를 가진 요소가 겹겹이면(칸 > 링크 > 글자) 가장 안쪽 것을 고른다 — 클릭 처리기가 보통 거기 붙어 있다
    const el = deepAll('a, span, div, td, button').filter((e) => visible(e) && e.children.length <= 2 && norm(e.innerText) === nt).sort((x, y) => x.querySelectorAll('*').length - y.querySelectorAll('*').length)[0];
    if (!el) return { ok: false, reason: '이름 없음' };
    let row = el.closest('.rt-tr, tr, [role="row"]'); if (!row) { row = el; for (let i = 0; i < 6 && row.parentElement && row.parentElement.children.length < 3; i++) row = row.parentElement; }
    const anchors = [...row.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => !/^javascript:|#$/.test(h));
    const selfA = el.closest('a[href]'); if (selfA && !/^javascript:|#$/.test(selfA.href)) anchors.unshift(selfA.href);
    const html = el.outerHTML.slice(0, 200).replace(/\s+/g, ' ');
    return { ok: anchors.length > 0, href: anchors[0] || null, anchors: anchors.slice(0, 5), html, rowTag: row.tagName.toLowerCase() + (row.className ? '.' + String(row.className).split(' ')[0] : ''), el };
  }
  function clickRowName(text) {
    const r = findRowLink(text); if (!r.el) return { ok: false, reason: r.reason };
    const el = r.el; const a = el.closest('a') || el.querySelector('a') || el;
    fire(a, [...HOVER, ...CLICK]); try { a.click(); } catch { /* 무시 */ } if (a !== el) { try { el.click(); } catch { /* 무시 */ } }
    return { ok: true, html: r.html, anchors: r.anchors, rowTag: r.rowTag };
  }

  // 글자로 링크 주소 찾기 (메뉴가 흉내 클릭에 반응하지 않을 때 주소로 직접 이동하기 위해)
  function findLink(texts) {
    const norm = (t) => clean(t).replace(/\s+/g, '');
    // 1) 보이는 요소 → 2) 숨은 메뉴 안의 링크까지
    const el = findClickable(texts);
    let a = el ? (el.closest('a[href]') || el.querySelector?.('a[href]')) : null;
    if (!a || /^javascript:|#$/.test(a.href)) {
      for (const t of texts) { a = deepAll('a[href]').find((x) => norm(x.innerText) === norm(t) && !/^javascript:|#$/.test(x.href)) || deepAll('a[href]').find((x) => norm(x.innerText).includes(norm(t)) && !/^javascript:|#$/.test(x.href)); if (a) break; }
    }
    if (!a) return { ok: false };
    return { ok: true, href: a.href, text: clean(a.innerText).slice(0, 30) };
  }
  // <select> 에서 글자가 들어간 항목 고르기
  function selectOption(texts) {
    for (const sel of deepAll('select').filter(visible)) {
      for (const t of texts) { const o = [...sel.options].find((x) => clean(x.textContent).includes(t)); if (o) { setNativeValue(sel, o.value); return { ok: true, text: clean(o.textContent), options: [...sel.options].map((x) => clean(x.textContent)).slice(0, 8) }; } }
    }
    return { ok: false, selects: deepAll('select').filter(visible).map((s2) => [...s2.options].map((x) => clean(x.textContent)).slice(0, 6).join('/')).slice(0, 6) };
  }
  // 화면 맨 위 90px 안의 짧은 글자들 (계정 이름·상호가 보통 여기 있다)
  function headerTexts() {
    const out = []; const seen = new Set();
    for (const e of deepAll('header *, nav *, [class*="header" i] *, [class*="gnb" i] *, [class*="top" i] *, [class*="account" i] *, [class*="user" i] *, [class*="profile" i] *')) {
      if (!visible(e) || e.children.length > 1) continue;
      const r = e.getBoundingClientRect(); if (r.top > 90 || r.height > 60) continue;
      const t = clean(e.innerText); if (!t || t.length > 24 || seen.has(t)) continue; seen.add(t); out.push(t);
      if (out.length >= 25) break;
    }
    return out;
  }
  // 화면에 보이는 누를 수 있는 것들의 글자 (진단용)
  function buttonsDiag() {
    const seen = new Set(); const out = [];
    for (const e of deepAll('button, a, [role="button"], [role="tab"], [role="menuitem"], label, select')) {
      if (!visible(e)) continue;
      const t = e.tagName === 'SELECT' ? 'select:' + [...e.options].slice(0, 6).map((o) => clean(o.textContent)).join('/') : clean(e.innerText || e.value || e.getAttribute('aria-label') || '');
      if (!t || t.length > 40 || seen.has(t)) continue; seen.add(t); out.push(t);
      if (out.length >= 60) break;
    }
    // 보고서·report 가 들어간 링크 주소 (보이지 않는 메뉴 안의 것도 포함)
    const links = []; const seenL = new Set();
    for (const a of deepAll('a[href]')) { const t = clean(a.innerText); const h = a.href; if (!(/보고서|리포트/.test(t) || /report/i.test(h)) || seenL.has(h) || /^javascript:/.test(h)) continue; seenL.add(h); links.push(`${t.slice(0, 16) || '(글자 없음)'} → ${h}`); if (links.length >= 12) break; }
    return { buttons: out, links, url: location.href, title: document.title, inputs: deepAll('input').filter(visible).map((i) => `${i.type}:${clean(i.placeholder || i.value || '').slice(0, 20)}`).slice(0, 15) };
  }

  // 광고센터 로그인 선택 화면 (advertising.coupang.com/user/login): '쿠팡 윙 판매자' 카드의 첫(왼쪽) '로그인하기' 를 누른다
  function loginChooserButtons() {
    return deepAll('button, a, [role="button"]').filter((b) => visible(b) && /^로그인하기$/.test(clean(b.innerText))).sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left);
  }
  function clickLoginChooser() {
    const btns = loginChooserButtons();
    if (!btns.length) return { ok: false, reason: "'로그인하기' 버튼이 없습니다" };
    fire(btns[0], [...HOVER, ...CLICK]); try { btns[0].click(); } catch { /* 무시 */ }
    return { ok: true, count: btns.length };
  }

  // 페이지(MAIN world)에 심은 훅이 window.open / target=_blank 링크의 주소를 이벤트로 보내면 백그라운드로 전달
  document.addEventListener('cc-download-url', (e) => { try { chrome.runtime.sendMessage({ type: 'downloadUrl', url: e.detail?.url, how: e.detail?.how }); } catch { /* 무시 */ } });
  document.addEventListener('cc-download-blob', (e) => { try { chrome.runtime.sendMessage({ type: 'downloadBlob', name: e.detail?.name, data: e.detail?.data, how: e.detail?.how }); } catch { /* 무시 */ } });

  // 글자가 든 줄(표의 행) 찾기. mustHave 가 있으면 그 중 하나도 같이 들어 있어야 한다
  function findRowByText(texts, mustHave = []) {
    const rows = deepAll('tr, .rt-tr, [role="row"], li').filter(visible);
    const norm = (t) => clean(t).toLowerCase();
    for (const r of rows) {
      const t = norm(r.innerText); if (t.length > 600) continue;
      if (!texts.some((x) => t.includes(norm(x)))) continue;
      if (mustHave.length && !mustHave.some((m) => t.includes(norm(m)))) continue;
      return { ok: true, row: r, rowText: clean(r.innerText).slice(0, 120) };
    }
    return { ok: false };
  }
  function clickInRow(texts, buttonTexts, mustHave = []) {
    const r = findRowByText(texts, mustHave); if (!r.ok) return { ok: false, reason: '줄 없음' };
    const norm = (t) => clean(t).replace(/\s+/g, '');
    const btn = [...r.row.querySelectorAll('button, a, [role="button"], span, div')].filter(visible).find((b) => buttonTexts.some((x) => norm(b.innerText) === norm(x) || (b.getAttribute('aria-label') || '').includes(x)));
    if (!btn) return { ok: false, reason: '줄 안에 버튼 없음', rowText: r.rowText };
    const target = btn.closest('button, a, [role="button"]') || btn; fire(target, [...HOVER, ...CLICK]); try { target.click(); } catch { /* 무시 */ }
    return { ok: true, rowText: r.rowText };
  }
  // 라벨/자리표시 글자로 입력칸을 찾아 날짜를 넣는다 (여러 표기 시도)
  function fillDates(labels, iso) {
    const inputs = deepAll('input').filter((i) => visible(i) && ['text', 'date', ''].includes(i.type || ''));
    const byLabel = (l) => inputs.find((i) => (i.placeholder || '').includes(l) || (i.getAttribute('aria-label') || '').includes(l) || (i.name || '').toLowerCase().includes(l.toLowerCase()) || (i.id && document.querySelector(`label[for="${i.id}"]`)?.innerText.includes(l)));
    const targets = labels.map(byLabel).filter(Boolean);
    if (!targets.length) return { ok: false, inputs: inputs.map((i) => `${i.type}:${i.placeholder || i.name || i.id || ''}`).slice(0, 10) };
    const formats = [iso, iso.replace(/-/g, '.'), iso.replace(/-/g, '/'), iso.replace(/-/g, '')];
    let how = '';
    for (const inp of targets) {
      for (const v of formats) {
        inp.focus(); setNativeValue(inp, v);
        for (const t of ['keydown', 'keypress', 'keyup']) inp.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
        if (inp.value && inp.value.replace(/[^\d]/g, '') === iso.replace(/-/g, '')) { how = v; break; }
      }
    }
    return { ok: !!how, how: how || '값이 유지되지 않음', values: targets.map((i) => i.value) };
  }
  // 글자 옆 체크박스를 원하는 상태로
  function setCheckbox(texts, checked) {
    const norm = (t) => clean(t).replace(/\s+/g, '');
    for (const t of texts) {
      const lab = deepAll('label').find((l) => visible(l) && norm(l.innerText).includes(norm(t)));
      let box = lab ? (lab.querySelector('input[type="checkbox"]') || (lab.htmlFor && document.getElementById(lab.htmlFor))) : null;
      if (!box) { const el = deepAll('span, div, p').find((e) => visible(e) && e.children.length <= 2 && norm(e.innerText) === norm(t)); const wrap = el && (el.closest('label') || el.parentElement); box = wrap && wrap.querySelector('input[type="checkbox"]'); }
      if (!box) continue;
      if (box.checked === checked) return { ok: true, changed: false };
      (lab || box).click(); if (box.checked !== checked) { box.checked = checked; box.dispatchEvent(new Event('change', { bubbles: true })); }
      return { ok: true, changed: true };
    }
    return { ok: false };
  }
  // '캠페인을 선택하세요' 같은 다중 선택: 열어서 전체 선택 항목을 누른다
  async function selectAllCampaigns() {
    const opener = findClickable(['캠페인을 선택하세요', '캠페인 선택', '전체 캠페인']);
    if (!opener) return { ok: false };
    fire(opener, [...HOVER, ...CLICK]); try { opener.click(); } catch { /* 무시 */ } await wait(600);
    const all = findClickable(['전체 선택', '모두 선택', '전체선택', '모두', '전체']);
    if (all) { fire(all, [...HOVER, ...CLICK]); try { all.click(); } catch { /* 무시 */ } await wait(300); document.body.click(); return { ok: true, how: `전체 선택(${clean(all.innerText).slice(0, 12)})` }; }
    const boxes = deepAll('input[type="checkbox"]').filter(visible); let n = 0; for (const b of boxes) if (!b.checked) { b.click(); n++; }
    document.body.click();
    return { ok: n > 0, how: `체크박스 ${n}개 체크` };
  }

  window.__ccReadTables = allTables;
  window.__ccDetectDate = detectDate; window.__ccDivGrids = readDivGrids; window.__ccReadAllPages = readAllPages; window.__ccDateFromUrl = dateFromUrl; window.__ccClickDownloadReport = clickDownloadReport; window.__ccPageInfo = pageInfo;
  window.__ccPick = (kind) => { const t = pickTable(allTables(), kind); return t ? { records: toRecords(t), headers: t.headers, source: t.kind } : null; };

  chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'read') {
      try {
        const picked = window.__ccPick(msg.kind);
        sendResponse({ ok: !!picked, ...(picked || {}), date: detectDate(), period: detectPeriod(), url: location.href,
          tables: allTables().map((t) => ({ kind: t.kind, headers: t.headers.slice(0, 12), rows: t.rows.length })), errors: [...readErrors] });
      } catch (e) { sendResponse({ ok: false, error: String(e && e.stack || e), tables: [], errors: [...readErrors] }); }
    } else if (msg?.type === 'clickYesterday') {
      sendResponse({ clicked: clickYesterday() });
    } else if (msg?.type === 'clickDownloadReport') {
      clickDownloadReport(!!msg.dryRun).then(sendResponse);
    } else if (msg?.type === 'readAll') {
      readAllPages(msg.kind).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e && e.stack || e), tables: [], errors: [...readErrors] }));
    } else if (msg?.type === 'clickAnyDownload') {
      clickAnyDownload().then(sendResponse);
    } else if (msg?.type === 'clickText') {
      sendResponse(clickText(msg.texts || [], { exactOnly: !!msg.exactOnly }));
    } else if (msg?.type === 'findRowByText') {
      const r = findRowByText(msg.texts || [], msg.mustHave || []); delete r.row; sendResponse(r);
    } else if (msg?.type === 'clickInRow') {
      sendResponse(clickInRow(msg.texts || [], msg.button || ['다운로드'], msg.mustHave || []));
    } else if (msg?.type === 'fillDates') {
      sendResponse(fillDates(msg.labels || [], msg.value || ''));
    } else if (msg?.type === 'setCheckbox') {
      sendResponse(setCheckbox(msg.texts || [], !!msg.checked));
    } else if (msg?.type === 'selectAllCampaigns') {
      selectAllCampaigns().then(sendResponse);
    } else if (msg?.type === 'findRowLink') {
      const r = findRowLink(msg.text || ''); delete r.el; sendResponse(r);
    } else if (msg?.type === 'clickRowName') {
      sendResponse(clickRowName(msg.text || ''));
    } else if (msg?.type === 'readCampaignOptions') {
      try { sendResponse({ ok: true, options: readCampaignOptions(), url: location.href }); } catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
    } else if (msg?.type === 'findLink') {
      sendResponse(findLink(msg.texts || []));
    } else if (msg?.type === 'selectOption') {
      sendResponse(selectOption(msg.texts || []));
    } else if (msg?.type === 'hoverText') {
      sendResponse(hoverText(msg.texts || []));
    } else if (msg?.type === 'scriptUrls') {
      sendResponse({ urls: scriptUrls() });
    } else if (msg?.type === 'buttonsDiag') {
      sendResponse(buttonsDiag());
    } else if (msg?.type === 'clickLoginChooser') {
      sendResponse(clickLoginChooser());
    } else if (msg?.type === 'login') {
      doLogin(msg.id, msg.pw).then(sendResponse).catch((e) => sendResponse({ ok: false, reason: String(e && e.message || e) }));
    } else if (msg?.type === 'pageInfo') {
      sendResponse({ ...pageInfo(), date: detectDate(), period: detectPeriod() });
    } else if (msg?.type === 'structure') {
      sendResponse(structureInfo());
    }
    return true;
  });
})();
