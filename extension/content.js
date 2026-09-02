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
    root.querySelectorAll('table').forEach((t) => {
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
    root.querySelectorAll('.ag-root, .ag-root-wrapper').forEach((g) => {
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
    root.querySelectorAll('[role="grid"], [role="table"], [role="treegrid"]').forEach((g) => {
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

  function allTables() {
    return [...readAgGrids(document), ...readHtmlTables(document), ...readAriaGrids(document)];
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
  function detectDate() {
    const re = /(20\d{2})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/g;
    const cands = [];
    document.querySelectorAll('input').forEach((i) => { if (i.value) cands.push(i.value); });
    document.querySelectorAll('[class*="date" i], [class*="picker" i], [class*="calendar" i], [class*="period" i]').forEach((e) => cands.push(clean(e.innerText)));
    for (const c of cands) {
      const found = [...c.matchAll(re)].map((m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
      if (found.length) return found[0];
    }
    return null;
  }

  // ---------- '어제' 버튼 클릭 (자동 수집용) ----------
  function clickYesterday() {
    const els = [...document.querySelectorAll('button, a, label, li, span, div')].filter((e) => clean(e.innerText) === '어제' && e.offsetParent !== null);
    if (els.length) { els[0].click(); return true; }
    return false;
  }

  window.__ccReadTables = allTables;
  window.__ccPick = (kind) => { const t = pickTable(allTables(), kind); return t ? { records: toRecords(t), headers: t.headers, source: t.kind } : null; };

  chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'read') {
      const picked = window.__ccPick(msg.kind);
      sendResponse({ ok: !!picked, ...(picked || {}), date: detectDate(), url: location.href,
        tables: allTables().map((t) => ({ kind: t.kind, headers: t.headers.slice(0, 12), rows: t.rows.length })) });
    } else if (msg?.type === 'clickYesterday') {
      sendResponse({ clicked: clickYesterday() });
    }
    return true;
  });
})();
