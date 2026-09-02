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
  // 같은 모양의 자식이 3개 이상 반복되는 요소를 '줄 목록'으로 보고, 근처의 머리글 줄과 짝지어 표로 만든다.
  function readDivGrids() {
    const out = [];
    const seen = new Set();
    for (const parent of deepAll('*')) {
      if (parent.children.length < 3 || seen.has(parent)) continue;
      if (['TABLE', 'TBODY', 'THEAD', 'TR', 'UL', 'OL', 'SELECT', 'SCRIPT', 'STYLE'].includes(parent.tagName) && parent.tagName !== 'UL' && parent.tagName !== 'OL') continue;
      if (parent.closest('table, .ag-root, [role="grid"]')) continue;
      const groups = {};
      for (const c of parent.children) { const k = c.tagName + '|' + c.className; (groups[k] ||= []).push(c); }
      for (const members of Object.values(groups)) {
        if (members.length < 3) continue;
        const rows = members.map(leafTexts).filter((r) => r.length >= 4 && r.some((t) => /\d/.test(t)));
        if (rows.length < 3) continue;
        const counts = rows.map((r) => r.length).sort((x, y) => x - y); const med = counts[Math.floor(counts.length / 2)];
        const good = rows.filter((r) => Math.abs(r.length - med) <= Math.max(2, med * 0.5));
        if (good.length < 3) continue;
        // 머리글 후보: 같은 부모의 다른 자식, 부모의 이전 형제(와 그 자손), 조부모의 이전 형제
        const cands = [];
        for (const c of parent.children) if (!members.includes(c)) cands.push(c);
        let sib = parent.previousElementSibling; for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) cands.push(sib);
        if (parent.parentElement) { let ps = parent.parentElement.previousElementSibling; for (let i = 0; i < 3 && ps; i++, ps = ps.previousElementSibling) cands.push(ps); for (const c of parent.parentElement.children) if (c !== parent) cands.push(c); }
        cands.push(members[0]);
        let header = null, best = 1;
        for (const c of cands) { const t = leafTexts(c); const sc = headerScore(t); if (sc > best && t.length >= 3) { best = sc; header = { el: c, texts: t }; } }
        if (!header) continue;
        const body = header.el === members[0] ? good.slice(1) : good;
        if (!body.length) continue;
        seen.add(parent);
        out.push({ headers: header.texts, rows: body, kind: 'div-grid' });
      }
    }
    return out;
  }

  function allTables() {
    return [...readAgGrids(document), ...readHtmlTables(document), ...readAriaGrids(document), ...readDivGrids()];
  }

  const KIND_RULES = {
    sales: { must: ['옵션'], any: ['매출', '판매'] },
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
  async function clickDownloadReport() {
    const btn = findByText('엑셀 다운로드')[0] || findByText('엑셀 다운로드', false)[0];
    if (!btn) return { ok: false, reason: '엑셀 다운로드 버튼을 찾지 못했습니다', diag: visibleTexts('다운로드') };
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
      hasCampaignText: text.includes('캠페인'), textLength: text.length, frames: window.top === window ? 'top' : 'iframe', title: document.title, url: location.href };
  }

  // ---------- '어제' 버튼 클릭 (자동 수집용) ----------
  function clickYesterday() {
    const els = [...document.querySelectorAll('button, a, label, li, span, div')].filter((e) => clean(e.innerText) === '어제' && e.offsetParent !== null);
    if (els.length) { els[0].click(); return true; }
    return false;
  }

  window.__ccReadTables = allTables;
  window.__ccDetectDate = detectDate; window.__ccDivGrids = readDivGrids; window.__ccDateFromUrl = dateFromUrl; window.__ccClickDownloadReport = clickDownloadReport; window.__ccPageInfo = pageInfo;
  window.__ccPick = (kind) => { const t = pickTable(allTables(), kind); return t ? { records: toRecords(t), headers: t.headers, source: t.kind } : null; };

  chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'read') {
      const picked = window.__ccPick(msg.kind);
      sendResponse({ ok: !!picked, ...(picked || {}), date: detectDate(), url: location.href,
        tables: allTables().map((t) => ({ kind: t.kind, headers: t.headers.slice(0, 12), rows: t.rows.length })) });
    } else if (msg?.type === 'clickYesterday') {
      sendResponse({ clicked: clickYesterday() });
    } else if (msg?.type === 'clickDownloadReport') {
      clickDownloadReport().then(sendResponse);
    } else if (msg?.type === 'clickAnyDownload') {
      clickAnyDownload().then(sendResponse);
    } else if (msg?.type === 'pageInfo') {
      sendResponse(pageInfo());
    }
    return true;
  });
})();
