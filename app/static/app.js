/* 쿠팡 소싱 프로그램 화면 동작 */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fmt = (n) => (n === null || n === undefined) ? '-' : Number(n).toLocaleString('ko-KR');
  const won = (n) => (n === null || n === undefined) ? '-' : fmt(n) + '원';
  const wonShort = (n) => {
    if (n === null || n === undefined) return '-';
    n = Number(n);
    if (n >= 1e8) return (Math.round(n / 1e7) / 10).toLocaleString('ko-KR') + '억원';
    if (n >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만원';
    return fmt(n) + '원';
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const state = {
    top: [], trees: {}, checked: new Set(), expanded: new Set(), kwScope: [],
    conditions: {}, mode: 'category', filter: 'pass', q: '', leaf: '', sort: 'sales', page: 1,
    rows: [], total: 0, all: 0, status: null, stats: null, run: null, selected: new Set(), lastState: null,
  };

  // ---------- 통신 ----------
  async function api(path, body, method) {
    const opt = { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opt.body = JSON.stringify(body);
    const r = await fetch(path, opt);
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (data && data.ok === false) throw new Error(data.error || '오류');
    if (!r.ok) throw new Error((data && data.detail) || r.statusText);
    return data;
  }
  let toastTimer;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false; t.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 6000 : 3500);
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

  // ---------- 범위 (카테고리) ----------
  function scopeItems() {
    if (state.mode === 'keyword') return state.kwScope;
    // 체크된 항목 중, 하위에 체크된 항목이 없는 것만 범위로 본다
    const nodes = {};
    const walk = (n, parent) => { nodes[n.id] = { ...n, parentId: parent }; (n.children || []).forEach((c) => walk(c, n.id)); };
    state.top.forEach((t) => walk(state.trees[t.id] || { id: t.id, name: t.name, children: [] }, null));
    const out = [];
    for (const id of state.checked) {
      const n = nodes[id]; if (!n) continue;
      const hasCheckedDesc = (m) => (m.children || []).some((c) => state.checked.has(c.id) || hasCheckedDesc(c));
      if (hasCheckedDesc(n)) continue;
      const path = []; let cur = n; while (cur) { path.unshift(cur.name); cur = cur.parentId ? nodes[cur.parentId] : null; }
      out.push({ type: 'category', id: n.id, name: path.join(' › '), top: path[0], rest: path.slice(1).join(' › ') });
    }
    return out;
  }

  function renderTop() {
    const q = ($('#cat-search').value || '').trim();
    $('#top-list').innerHTML = state.top.map((t) => {
      const on = state.checked.has(t.id);
      const hide = q && !t.name.includes(q) && !JSON.stringify(state.trees[t.id] || {}).includes(q);
      return `<label class="cat-item ${on ? 'on' : ''} ${hide ? 'hidden' : ''}"><input type="checkbox" data-id="${t.id}" ${on ? 'checked' : ''}> ${esc(t.name)}</label>`;
    }).join('');
    $('#scope-count').textContent = `${state.top.filter((t) => state.checked.has(t.id)).length}/${state.top.length}개 선택`;
    $$('#top-list input').forEach((el) => el.addEventListener('change', guard(async () => {
      const id = Number(el.dataset.id);
      if (el.checked) { state.checked.add(id); await loadTree(id); }
      else { uncheckSubtree(id); }
      renderAll();
    })));
  }

  function findNode(id) {
    let found = null;
    const walk = (n) => { if (found) return; if (n.id === id) { found = n; return; } (n.children || []).forEach(walk); };
    Object.values(state.trees).forEach(walk);
    return found;
  }

  function uncheckSubtree(id) {
    const walk = (n) => { state.checked.delete(n.id); (n.children || []).forEach(walk); };
    walk(state.trees[id] || { id, children: [] });
    state.checked.delete(id);
  }

  async function loadTree(id, force) {
    if (state.trees[id] && state.trees[id].fetched && !force) return state.trees[id];
    const t = await api(`/api/categories/${id}/tree`);
    state.trees[id] = t;
    if (!t.fetched || force) {
      renderSubTree();
      $('#sub-tree').insertAdjacentHTML('afterbegin', `<div class="loading" id="loading-${id}">쿠팡에서 "${esc(t.name)}" 하위 카테고리를 불러오는 중… (브라우저 창이 열립니다)</div>`);
      try {
        const r = await api(`/api/categories/${id}/discover${force ? '?force=true' : ''}`, {});
        state.trees[id] = r.tree;
      } finally { const l = $(`#loading-${id}`); if (l) l.remove(); }
    }
    return state.trees[id];
  }

  function renderSubTree() {
    const tops = state.top.filter((t) => state.checked.has(t.id));
    const q = ($('#cat-search').value || '').trim();
    const box = $('#sub-tree');
    if (!tops.length) { box.innerHTML = '<div class="loading">1차 카테고리를 먼저 선택하세요.</div>'; $('#sub-hint').textContent = '2차 0개 지정'; return; }
    let subCount = 0;
    box.innerHTML = tops.map((t) => {
      const tree = state.trees[t.id] || { children: [] };
      const kids = tree.children || [];
      const allOn = state.checked.has(t.id) && !kids.some((k) => state.checked.has(k.id) || (k.children || []).some((g) => state.checked.has(g.id)));
      const cnt = kids.filter((k) => state.checked.has(k.id) || (k.children || []).some((g) => state.checked.has(g.id))).length;
      subCount += cnt;
      const items = kids.filter((k) => !q || k.name.includes(q) || (k.children || []).some((g) => g.name.includes(q))).map((k) => {
        const on = state.checked.has(k.id);
        const exp = state.expanded.has(k.id);
        let third = '';
        if (exp) {
          const g = k.children || [];
          third = `<div class="third-box">${g.length ? g.map((c) => `<label class="sub-item third"><input type="checkbox" data-id="${c.id}" ${state.checked.has(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('') : '<span class="loading">하위 없음(최하위) 또는 불러오는 중…</span>'}</div>`;
        }
        return `<label class="sub-item"><input type="checkbox" data-id="${k.id}" ${on ? 'checked' : ''}> ${esc(k.name)} <span class="expand" data-exp="${k.id}" title="3차 보기">${exp ? '▾' : '▸'}</span></label>${third}`;
      }).join('');
      return `<div class="sub-group"><div class="sg-head"><span>▾</span> ${esc(t.name)} <span class="cnt">${cnt}개 선택</span></div>
        <div class="sg-body">
          <label class="sub-item all"><input type="checkbox" data-all="${t.id}" ${allOn ? 'checked' : ''}> ${esc(t.name)} 전체 조사</label>
          ${kids.length ? items : '<span class="loading">하위 카테고리가 없습니다. 도구 › 카테고리 전체 다시 불러오기를 눌러 보세요.</span>'}
        </div></div>`;
    }).join('');
    $('#sub-hint').textContent = `2차 ${subCount}개 지정`;
    $$('#sub-tree input[data-id]').forEach((el) => el.addEventListener('change', () => {
      const id = Number(el.dataset.id);
      if (el.checked) state.checked.add(id); else uncheckSubtree(id);
      renderAll();
    }));
    $$('#sub-tree input[data-all]').forEach((el) => el.addEventListener('change', () => {
      const id = Number(el.dataset.all);
      const tree = state.trees[id] || { children: [] };
      if (el.checked) { (tree.children || []).forEach((k) => uncheckSubtree(k.id)); state.checked.add(id); }
      else { state.checked.delete(id); }
      renderAll();
    }));
    $$('#sub-tree .expand').forEach((el) => el.addEventListener('click', guard(async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const id = Number(el.dataset.exp);
      if (state.expanded.has(id)) { state.expanded.delete(id); renderSubTree(); return; }
      const node = findNode(id);
      state.expanded.add(id); renderSubTree();
      // 3차가 아직 없으면 쿠팡 페이지에서 불러온다
      if (node && !node.fetched) {
        const r = await api(`/api/categories/${id}/discover`, {});
        Object.assign(node, r.tree);
        renderSubTree();
      }
    })));
  }

  function renderScope() {
    const items = scopeItems();
    const html = items.length ? items.map((it, i) => it.type === 'category'
      ? `<span class="scope-chip"><span class="p">${esc(it.top)}</span> › ${esc(it.rest || '전체')} <span class="x" data-i="${i}">✕</span></span>`
      : `<span class="scope-chip"><span class="p">${it.type === 'keyword' ? '검색' : '링크'}</span> › ${esc(it.q || it.name || it.id)} <span class="x" data-i="${i}">✕</span></span>`).join('')
      : '<span class="muted">아직 없음</span>';
    $('#scope-chips').innerHTML = html; $('#scope-chips-kw').innerHTML = html;
    $$('.scope-chip .x').forEach((el) => el.addEventListener('click', () => {
      const it = items[Number(el.dataset.i)];
      if (it.type === 'category') uncheckSubtree(it.id); else state.kwScope.splice(Number(el.dataset.i), 1);
      renderAll();
    }));
    const c = state.conditions;
    $('#run-summary').textContent = items.length
      ? `${items.length}개 범위 · 최하위마다 ${state.mode === 'keyword' ? 72 : 120}개씩 ${c.pages || 1}페이지까지 · 판매량순`
      : '범위를 선택하면 요약이 표시됩니다.';
    api('/api/scope', { scope: items, checked: Array.from(state.checked) }).catch(() => {});
  }

  function renderAll() { renderTop(); renderSubTree(); renderScope(); }

  // ---------- 조건 ----------
  const COND_KEYS = ['price_min', 'price_max', 'review_min', 'review_max', 'views_min', 'conv_min', 'buyers_min', 'review_multiplier', 'pages', 'exclude_restricted', 'hide_ads', 'auto_continue', 'sum_options', 'quick_price', 'review_estimate', 'auto_verify'];
  function fillConditions() {
    for (const k of COND_KEYS) {
      const el = $(`#c-${k}`); if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!state.conditions[k]; else el.value = state.conditions[k] ?? '';
    }
    $('#pages-val').textContent = `${state.conditions.pages || 1}페이지`;
  }
  function readConditions() {
    const out = {};
    for (const k of COND_KEYS) { const el = $(`#c-${k}`); if (!el) continue; out[k] = el.type === 'checkbox' ? el.checked : (el.value === '' ? 0 : Number(el.value)); }
    return out;
  }
  const saveConditions = guard(async () => {
    state.conditions = await api('/api/conditions', readConditions());
    fillConditions(); renderScope(); await refreshAll(); toast('조건을 적용했습니다.');
  });

  // ---------- 상태 / 통계 ----------
  function stateLabel(st) {
    if (!st) return '대기';
    if (st.state === 'idle') return '대기';
    if (st.paused) return '일시정지';
    return { collecting: '수집 중', analyzing: '분석 중', verifying: '가격 확인 중', capturing: '윙 캡처 중' }[st.state] || st.state;
  }
  function renderStatus(d) {
    const st = d.status; state.status = st; state.stats = d.stats; state.run = d.run;
    const running = st.state !== 'idle';
    const pill = $('#run-pill');
    pill.className = 'status-pill' + (running ? (st.paused ? ' pause' : ' run') : '');
    pill.querySelector('b').textContent = stateLabel(st);
    $('#run-ctrls').hidden = !running;
    $('#btn-start').disabled = running;
    $('#btn-pause').classList.toggle('active-state', running && !st.paused);
    $('#btn-resume').classList.toggle('active-state', running && st.paused);
    $('#btn-stop').classList.toggle('active-state', false);
    const p = st.progress || {};
    let line = '대기 중';
    if (running) line = `<b>${esc(p.label || stateLabel(st))}</b>${p.total ? ` ${fmt(p.done)}/${fmt(p.total)}` : ''}${st.paused ? ' · 일시정지' : ''}`;
    else if (d.run) line = `마지막 실행 #${d.run.id} · ${esc(d.run.created_at)} · 상태: ${esc(runStatusLabel(d.run.status))}${p.total ? ` · 진행 ${fmt(p.done)}/${fmt(p.total)}` : ''}`;
    if (st.capture && st.capture.active) line += ` · 캡처 기록 ${st.capture.count}건`;
    $('#progress-line').innerHTML = line;
    const notice = $('#notice');
    const msgs = [];
    if (st.message) msgs.push(st.message);
    if (!st.wing_configured) msgs.push('윙 조회 방식이 아직 설정되지 않았습니다. [도구 › 윙 캡처 모드 시작] 후 윙에서 28일 판매량이 보이는 화면을 열어 주세요. 캡처 요약 파일을 보내주시면 조회 기능을 완성합니다.');
    notice.hidden = !msgs.length; notice.textContent = msgs.join('  |  ');
    notice.className = 'notice' + (st.message && st.message.startsWith('오류') ? ' err' : '');
    const s = d.stats || { passed: 0, unique: 0, analyzed: 0, categories: 0, seen: 0, passed_revenue: 0, counts: {} };
    $('#s-passed').textContent = fmt(s.passed); $('#s-unique').textContent = fmt(s.unique); $('#s-analyzed').textContent = fmt(s.analyzed);
    $('#s-cats').textContent = fmt(s.categories); $('#s-seen').textContent = fmt(s.seen); $('#s-revenue').textContent = wonShort(s.passed_revenue_min || 0);
    const c = s.counts || {};
    $$('#filter-chips .chip').forEach((el) => { const k = el.dataset.f; el.querySelector('b').textContent = fmt(c[k] ?? 0); });
    const r = d.restricted || {};
    const rTotal = Object.values(r).reduce((a, b) => a + b, 0);
    const parts = [`${fmt(state.total)}개 표시 중 (전체 ${fmt(s.unique)}개)`, '같은 상품의 옵션은 한 줄로 묶음'];
    if (rTotal && state.conditions.exclude_restricted) parts.push(`못 파는 물건 ${rTotal}개 뺌 (${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ')})`);
    if (d.excluded) parts.push(`가격·리뷰 조건에 안 맞는 ${fmt(d.excluded)}개는 숨김`);
    $('#results-sub').textContent = parts.join(' · ');
    // 작업 상태가 바뀌면 표를 다시 그린다
    const sig = `${st.state}:${st.paused}:${p.done}`;
    if (sig !== state.lastState) { state.lastState = sig; if (running || (d.run && d.run.status !== 'cleared')) loadProducts(true); }
  }
  function runStatusLabel(s) {
    return { created: '생성됨', collecting: '수집 중', collected: '수집 완료', analyzing: '분석 중', analyzed: '분석 완료', stopped: '완전중단', error: '오류', cleared: '비움' }[s] || s;
  }

  // ---------- 상품 표 ----------
  async function loadProducts(reset) {
    if (reset) state.page = 1;
    const qs = new URLSearchParams({ filter: state.filter, q: state.q, leaf: state.leaf, sort: state.sort, page: state.page, size: 100 });
    const d = await api('/api/products?' + qs.toString());
    state.rows = reset ? d.rows : state.rows.concat(d.rows);
    state.total = d.total; state.all = d.all;
    renderRows();
    $('#btn-more').hidden = state.rows.length >= state.total;
    loadLeaves();
  }
  let leavesSig = '';
  async function loadLeaves() {
    const list = await api('/api/leaves');
    const sig = JSON.stringify(list.map((l) => l.path));
    if (sig === leavesSig) return; leavesSig = sig;
    const sel = $('#leaf');
    sel.innerHTML = `<option value="">전체 (${list.length})</option>` + list.map((l) => `<option value="${esc(l.id || l.path)}" ${String(state.leaf) === String(l.id || l.path) ? 'selected' : ''}>${esc((l.path || '').split(' > ').slice(-1)[0] || l.path)} (${l.count})</option>`).join('');
  }
  function deliveryLabel(d) { return { ROCKET_GROWTH: '판매자로켓(로켓그로스)', ROCKET: '로켓배송', ROCKET_GLOBAL: '로켓직구', ROCKET_FRESH: '로켓프레시', ROCKET_INSTALL: '로켓설치', WING: '판매자배송' }[d] || d || ''; }
  function renderRows() {
    const body = $('#grid-body');
    if (!state.rows.length) {
      body.innerHTML = `<tr><td colspan="9" class="empty">${state.all ? (state.filter === 'pass' ? '조건 통과 상품이 아직 없습니다. 위 칩에서 [전체]를 누르면 수집된 상품을 모두 볼 수 있고, 조건을 바꾼 뒤엔 [시작 / 이어하기]로 새로 들어온 상품을 분석하세요.' : '이 조건에 맞는 상품이 없습니다.') : '왼쪽에서 범위와 조건을 정하고 [소싱 시작]을 누르세요. 화면을 먼저 보려면 도구 › 데모 데이터 넣기.'}</td></tr>`;
      return;
    }
    const maxConv = Math.max(5, ...state.rows.map((r) => (r.sales_est && r.views_28) ? r.sales_est / r.views_28 * 100 : (r.conversion_min || 0)));
    body.innerHTML = state.rows.map((r) => {
      const cat = (r.category_path || '').split(' > ').join(' › ');
      const pills = [`<span class="pill ${r.verdict}">${esc(r.verdict_label)}</span>`];
      if (r.restricted) pills.push(`<span class="pill restricted">${esc(r.restricted)}</span>`);
      if (r.is_ad) pills.push('<span class="pill ad">광고</span>');
      if (r.sold_out) pills.push('<span class="pill">품절</span>');
      const sim = (r.seller_count !== null && r.seller_count !== undefined) ? `<span class="pill">경쟁 판매자 ${r.seller_count}곳</span>` : '';
      const priceCls = r.coupon_flag ? 'amber' : '';
      const priceSub = r.coupon_flag ? `쿠폰 미반영 가능 · ${esc(r.price_source)}` : esc(r.price_source);
      let salesCell;
      if (r.sales_est !== null && r.sales_est !== undefined) {
        salesCell = `<b class="green">≈ ${fmt(r.sales_est)}</b><div class="sub">리뷰 ${fmt(r.reviews_28)}×${r.review_multiplier} · 일 ${fmt(Math.round(r.sales_est / 28))}${r.buyers_min ? ` · 확인 ${fmt(r.buyers_min)}+` : ''}</div>`;
      } else if (r.buyers_min) {
        salesCell = `<b class="green">${fmt(r.buyers_min)}+</b><div class="sub">월 구매자 최소${r.buyers_options ? ` · 옵션 ${r.buyers_options}개 합` : ''}</div>`;
      } else {
        salesCell = `<span class="muted">-</span><div class="sub">${r.reviews_28_note ? esc(r.reviews_28_note) : '미추정'}</div>`;
      }
      const convVal = (r.sales_est && r.views_28) ? (r.sales_est / r.views_28 * 100) : (r.conversion_min !== null && r.conversion_min !== undefined ? r.conversion_min : null);
      const convCell = convVal !== null
        ? `<b class="green">${r.sales_est ? '' : '≥ '}${convVal.toFixed(2)}%</b><div class="bar"><i style="width:${Math.min(100, convVal / Math.max(1, maxConv) * 100)}%"></i></div>`
        : '<span class="muted">-</span>';
      return `<tr data-id="${r.product_id}">
        <td class="chk"><input type="checkbox" class="rowchk" data-id="${r.product_id}" ${state.selected.has(r.product_id) ? 'checked' : ''}></td>
        <td class="prod"><div class="pname"><a href="${esc(r.url || '#')}" target="_blank" rel="noopener">${esc(r.name || ('상품 ' + r.product_id))}</a></div>
          <div class="pmeta">${pills.join('')}<span>${esc(cat)}</span><span>· ID ${r.product_id}</span>${sim}${r.option_total > 1 ? `<span>· 옵션 ${r.option_total}개</span>` : (r.option_count > 1 ? `<span>· 옵션 ${r.option_count}개</span>` : '')}</div></td>
        <td class="num">${salesCell}</td>
        <td class="num">${convCell}</td>
        <td class="num"><b>${fmt(r.review_count)}</b><div class="sub">${r.buyers_per_review ? '리뷰당 판매 ' + r.buyers_per_review : (r.rating ? '평점 ' + r.rating : '')}</div></td>
        <td class="num"><b class="${priceCls}">${won(r.effective_price)}${r.coupon_flag ? ' <span class="muted" title="쿠폰 적용 전 가격일 수 있습니다">?</span>' : ''}</b><div class="sub">${priceSub}</div></td>
        <td class="num"><b>${r.views_range ? esc(r.views_range) : (r.analysis_error ? '-' : '미분석')}</b><div class="sub">${r.analysis_error ? esc(r.analysis_error) : (r.pv_exact ? '' : (r.views_28 ? '범위' : ''))}</div></td>
        <td class="num"><b>${r.revenue_est ? '≈ ' + wonShort(r.revenue_est) : (r.revenue_min ? wonShort(r.revenue_min) : '-')}</b><div class="sub">${r.revenue_est ? (r.revenue_est < 1e8 ? won(r.revenue_est) : '추정') : (r.revenue_min ? '최소' : '')}</div></td>
        <td class="num"><b class="${r.delivery && r.delivery !== 'WING' ? 'blue' : ''}">${esc(r.delivery || 'WING')}${r.delivery_sure ? '' : ' <span class="muted" title="상세 확인 전 추정값">?</span>'}</b><div class="sub">${esc(deliveryLabel(r.delivery))}${r.delivery_sure ? '' : ' (추정)'}</div></td>
      </tr>`;
    }).join('');
    $$('.rowchk').forEach((el) => el.addEventListener('change', () => { const id = Number(el.dataset.id); if (el.checked) state.selected.add(id); else state.selected.delete(id); renderSel(); }));
    $$('.optlink').forEach((el) => el.addEventListener('click', (ev) => {
      ev.preventDefault();
      const r = state.rows.find((x) => x.product_id === Number(el.dataset.id));
      if (!r) return;
      const list = (r.buyers_detail_list || []).slice().sort((a, b) => (b.buyers_min || 0) - (a.buyers_min || 0));
      openModal(`옵션별 월 구매자 · ${r.name}`, `<p class="muted small">각 값은 상품 페이지의 "월 N명 이상 구매" 최소값입니다. 합계 ${fmt(r.buyers_min)}명+ · 확인한 옵션 ${r.buyers_options}개${r.option_total > r.buyers_options ? ` (전체 ${r.option_total}개 중)` : ''}</p>
        <table class="grid"><thead><tr><th class="left">옵션</th><th>월 구매자</th><th>아이템위너가</th><th>vendorItemId</th></tr></thead><tbody>
        ${list.map((d) => `<tr><td class="left">${esc(d.option || '-')}</td><td>${d.buyers_min ? '<b class="green">' + fmt(d.buyers_min) + '+</b>' : '<span class="muted">표시 없음</span>'}</td><td>${d.price ? won(d.price) : '-'}</td><td class="muted">${d.vendor_item_id || ''}</td></tr>`).join('')}
        </tbody></table>`);
    }));
    renderSel();
  }
  function renderSel() { $('#sel-info').textContent = state.selected.size ? `${state.selected.size}개 선택됨` : ''; }

  async function refreshAll() { renderStatus(await api('/api/status')); await loadProducts(true); }

  // ---------- 모달 ----------
  function openModal(title, html) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; $('#modal').hidden = false; }
  $('#modal-close').addEventListener('click', () => ($('#modal').hidden = true));
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });

  async function showLogs() {
    const logs = await api('/api/logs');
    openModal('로그', `<div>${logs.slice().reverse().map((l) => `<div class="log-line ${l.level}">${l.ts} ${esc(l.msg)}</div>`).join('') || '<span class="muted">로그가 없습니다.</span>'}</div>`);
  }
  const arcView = { day: '', cat: '' };
  async function showArchive() {
    const all = await api('/api/archive');
    const dayOf = (r) => (r.saved_at || '').slice(0, 10);
    const days = Array.from(new Set(all.map(dayOf))).sort().reverse();
    if (arcView.day && !days.includes(arcView.day)) arcView.day = '';
    const byDay = arcView.day ? all.filter((r) => dayOf(r) === arcView.day) : all;
    const cats = Array.from(new Set(byDay.map((r) => r.category_path || '').filter(Boolean))).sort();
    if (arcView.cat && !cats.includes(arcView.cat)) arcView.cat = '';
    const list = arcView.cat ? byDay.filter((r) => (r.category_path || '') === arcView.cat) : byDay;
    const cnt = (d) => all.filter((r) => dayOf(r) === d).length;
    const catShort = (c) => (c || '').split(' > ').slice(-2).join(' › ');
    const qs = `${arcView.day ? '&day=' + encodeURIComponent(arcView.day) : ''}${arcView.cat ? '&cat=' + encodeURIComponent(arcView.cat) : ''}`;
    // 저장일별로 묶는다 (최근 날짜가 위)
    const groups = [];
    for (const r of list) {
      const d = dayOf(r);
      let g = groups.find((x) => x.day === d);
      if (!g) { g = { day: d, rows: [] }; groups.push(g); }
      g.rows.push(r);
    }
    groups.sort((a, b) => (a.day < b.day ? 1 : -1));
    const row = (r) => `<tr><td class="chk"><input type="checkbox" class="arc" data-id="${r.archive_id}"></td>
        <td class="prod"><div class="pname"><a href="${esc(r.url)}" target="_blank">${esc(r.name)}</a></div><div class="pmeta">ID ${r.product_id}</div></td>
        <td class="left small">${esc(catShort(r.category_path))}</td>
        <td>${r.sales_est ? '≈ ' + fmt(r.sales_est) : (r.buyers_min ? fmt(r.buyers_min) + '+' : '-')}</td><td>${(r.sales_est && r.views_28) ? (r.sales_est / r.views_28 * 100).toFixed(2) + '%' : (r.conversion_min != null ? '≥ ' + r.conversion_min + '%' : '-')}</td><td>${fmt(r.review_count)}</td><td>${won(r.effective_price)}</td><td>${r.revenue_est ? '≈ ' + wonShort(r.revenue_est) : (r.revenue_min ? wonShort(r.revenue_min) : '-')}</td>
        <td class="small">${esc(deliveryLabel(r.delivery))}</td><td class="muted small">${esc((r.saved_at || '').slice(11, 16))}</td></tr>`;
    openModal('보관함', `<div class="row gap" style="margin-bottom:8px;flex-wrap:wrap">
        <select id="arc-day" class="input" style="max-width:220px"><option value="">모든 날짜 (${all.length}개)</option>${days.map((d) => `<option value="${d}" ${arcView.day === d ? 'selected' : ''}>${d} (${cnt(d)}개)</option>`).join('')}</select>
        <select id="arc-cat" class="input" style="max-width:320px"><option value="">모든 카테고리 (${byDay.length}개)</option>${cats.map((c) => `<option value="${esc(c)}" ${arcView.cat === c ? 'selected' : ''}>${esc(c.split(' > ').join(' › '))} (${byDay.filter((r) => r.category_path === c).length})</option>`).join('')}</select>
        <a href="/api/export?source=archive${qs}" class="btn">이 목록 엑셀 내려받기</a><button class="btn" id="arc-del">선택 삭제</button><span class="muted small">${list.length}개 표시</span></div>
      <table class="grid"><thead><tr><th class="chk"></th><th class="left">상품</th><th class="left">카테고리</th><th>28일 판매</th><th>전환율</th><th>리뷰</th><th>가격</th><th>28일 매출</th><th>배송</th><th>시각</th></tr></thead><tbody>
      ${groups.map((g) => `<tr class="group-row"><td colspan="10"><b>${g.day}</b> <span class="muted small">저장 ${g.rows.length}개</span></td></tr>${g.rows.map(row).join('')}`).join('') || '<tr><td colspan="10" class="empty">보관한 상품이 없습니다.</td></tr>'}
      </tbody></table>`);
    $('#arc-day').addEventListener('change', (e) => { arcView.day = e.target.value; arcView.cat = ''; showArchive(); });
    $('#arc-cat').addEventListener('change', (e) => { arcView.cat = e.target.value; showArchive(); });
    $('#arc-del').addEventListener('click', guard(async () => {
      const ids = $$('.arc:checked').map((e) => Number(e.dataset.id));
      if (!ids.length) return toast('삭제할 항목을 선택하세요.', true);
      await api('/api/archive/delete', { ids }); showArchive();
    }));
  }
  async function runUpdate() {
    toast('최신 버전 확인 중…');
    const c = await api('/api/update/check');
    if (c.remote && c.remote === c.current) { toast(`이미 최신 버전입니다 (${c.current}).`); return; }
    const msg = c.remote
      ? `업데이트를 받을까요?\n현재 ${c.current} → 최신 ${c.remote}\n\n받은 뒤 프로그램이 자동으로 다시 시작됩니다.`
      : `최신 버전 번호는 확인하지 못했지만 업데이트는 받을 수 있습니다.\n현재 ${c.current}\n\n지금 받을까요? (받은 뒤 프로그램이 자동으로 다시 시작됩니다)`;
    if (!confirm(msg)) return;
    toast('업데이트 내려받는 중… (30초~2분)');
    const r = await api('/api/update/apply', {});
    openModal('업데이트', `<p>${esc(r.message)}</p><p class="muted small">새 창이 뜨지 않으면 2_run.bat 을 직접 다시 실행해 주세요.</p>`);
    setTimeout(() => location.reload(), 12000);
  }
  async function runDiagSite() {
    toast('사이트 진단 중… 브라우저 창에서 쿠팡 메뉴를 자동으로 엽니다 (2~3분)');
    const r = await api('/api/diag/site', {});
    const imgs = (r.screenshots || []).map((f) => `<img src="/debug-files/${f}" style="max-width:100%;border:1px solid #333;border-radius:8px;margin-bottom:8px">`).join('');
    openModal('사이트 진단 결과 (전체 복사해서 보내주세요)', `<button class="btn" id="copy-diag">전체 복사</button> <span class="muted small">아래 그림들도 캡처해 주세요</span>${imgs}<pre>${esc(r.text)}</pre>`);
    $('#copy-diag').addEventListener('click', () => { navigator.clipboard.writeText(r.text).then(() => toast('복사했습니다.')); });
  }
  async function runDiag() {
    const first = state.top.find((t) => state.checked.has(t.id));
    const cid = first ? first.id : 184555;
    toast('진단 중… 브라우저 창이 열립니다 (최대 1분)');
    const r = await api('/api/diag/category', { cid });
    const img = r.screenshot ? `<img src="/debug-files/${r.screenshot}" style="max-width:100%;border:1px solid #333;border-radius:8px;margin-bottom:8px">` : '';
    openModal('카테고리 진단 결과 (전체 복사해서 보내주세요)', `<button class="btn" id="copy-diag">전체 복사</button> <span class="muted small">아래 그림도 캡처해 주세요</span>${img}<pre>${esc(r.text)}</pre>`);
    $('#copy-diag').addEventListener('click', () => { navigator.clipboard.writeText(r.text).then(() => toast('복사했습니다.')); });
  }
  async function showCaptureSummary() {
    const txt = await api('/api/capture/summary');
    openModal('윙 캡처 요약 (이 내용을 복사해서 보내주세요)', `<button class="btn" id="copy-cap">전체 복사</button><pre id="cap-text">${esc(txt)}</pre>`);
    $('#copy-cap').addEventListener('click', () => { navigator.clipboard.writeText(txt).then(() => toast('복사했습니다.')); });
  }

  // ---------- 이벤트 ----------
  $$('.seg').forEach((el) => el.addEventListener('click', () => {
    $$('.seg').forEach((s) => s.classList.remove('active')); el.classList.add('active');
    state.mode = el.dataset.mode; $('#mode-category').hidden = state.mode !== 'category'; $('#mode-keyword').hidden = state.mode !== 'keyword'; renderScope();
  }));
  $('#cat-search').addEventListener('input', () => { renderTop(); renderSubTree(); });
  $('#top-all').addEventListener('click', guard(async () => { for (const t of state.top) { state.checked.add(t.id); } renderAll(); for (const t of state.top) { try { await loadTree(t.id); } catch (e) { toast(e.message, true); break; } renderAll(); } }));
  $('#top-none').addEventListener('click', () => { state.checked.clear(); renderAll(); });
  $('#kw-add').addEventListener('click', guard(async () => {
    const r = await api('/api/scope/parse', { text: $('#kw-input').value });
    if (!r.items.length) return toast('추가할 키워드나 링크가 없습니다.', true);
    state.kwScope.push(...r.items); $('#kw-input').value = ''; renderScope();
  }));
  $('#cond-apply').addEventListener('click', saveConditions);
  $('#c-pages').addEventListener('input', () => ($('#pages-val').textContent = `${$('#c-pages').value}페이지`));
  $('#c-pages').addEventListener('change', saveConditions);
  $('#c-auto_continue').addEventListener('change', saveConditions);
  $('#c-exclude_restricted').addEventListener('change', saveConditions);
  $('#c-sum_options') && $('#c-sum_options').addEventListener('change', saveConditions);
  $('#c-quick_price') && $('#c-quick_price').addEventListener('change', saveConditions);
  $('#c-review_estimate') && $('#c-review_estimate').addEventListener('change', saveConditions);
  $('#c-auto_verify') && $('#c-auto_verify').addEventListener('change', saveConditions);
  $('#btn-review').addEventListener('click', guard(async () => { await api('/api/run/review_estimate', {}); toast('리뷰로 판매량을 추정합니다 (페이지는 열지 않습니다).'); await refreshAll(); }));
      $('#c-hide_ads').addEventListener('change', saveConditions);

  $('#btn-start').addEventListener('click', guard(async () => {
    const items = scopeItems();
    if (!items.length) return toast('조사할 범위를 먼저 선택해 주세요.', true);
    await api('/api/conditions', readConditions());
    await api('/api/run/start', { scope: items });
    toast('소싱을 시작했습니다. 브라우저 창이 열립니다.'); state.selected.clear(); await refreshAll();
  }));
  const ctl = (path, msg) => guard(async () => { await api(path, {}); if (msg) toast(msg); await refreshAll(); });
  $('#btn-pause').addEventListener('click', ctl('/api/run/pause', '일시정지'));
  $('#btn-pause2').addEventListener('click', ctl('/api/run/pause', '일시정지'));
  $('#btn-resume').addEventListener('click', ctl('/api/run/resume', '재개'));
  $('#btn-resume2').addEventListener('click', ctl('/api/run/resume', '재개'));
  $('#btn-stop').addEventListener('click', ctl('/api/run/stop', '완전중단을 요청했습니다.'));
  $('#btn-stop2').addEventListener('click', ctl('/api/run/stop', '완전중단을 요청했습니다.'));
  $('#btn-analyze').addEventListener('click', ctl('/api/run/analyze', '28일 판매량 분석을 시작합니다.'));
  $('#btn-continue').addEventListener('click', guard(async () => {
    const st = state.status || {};
    if (st.state !== 'idle' && st.paused) { await api('/api/run/resume', {}); }
    else { await api('/api/run/analyze', {}); toast('남은 상품부터 이어서 분석합니다.'); }
    await refreshAll();
  }));
  $('#btn-retry').addEventListener('click', guard(async () => { const r = await api('/api/run/retry_unmatched', {}); toast(`미매칭 ${r.count}개를 다시 분석합니다.`); await refreshAll(); }));
  $('#btn-verify').addEventListener('click', guard(async () => {
    const r = await api('/api/run/verify', { product_ids: Array.from(state.selected) });
    toast(`${r.count}개 상품의 실제 가격과 월 구매자 수를 확인합니다.`); await refreshAll();
  }));
  $('#btn-refresh').addEventListener('click', guard(refreshAll));
  $('#btn-archive').addEventListener('click', guard(async () => {
    const r = await api('/api/archive', { product_ids: Array.from(state.selected) });
    toast(`${r.added}개를 보관함에 저장했습니다 (총 ${r.total}개).`);
  }));
  $('#btn-export').addEventListener('click', () => {
    const qs = new URLSearchParams({ filter: state.filter, q: state.q, leaf: state.leaf, sort: state.sort });
    window.location.href = '/api/export?' + qs.toString();
  });
  $('#btn-hide-sel').addEventListener('click', guard(async () => {
    if (!state.selected.size) return toast('숨길 상품을 체크하세요.', true);
    await api('/api/products/hide', { product_ids: Array.from(state.selected), hidden: state.filter !== 'hidden' });
    state.selected.clear(); await refreshAll();
  }));
  $('#btn-more').addEventListener('click', guard(async () => { state.page += 1; await loadProducts(false); }));
  $('#chk-all').addEventListener('change', (e) => { state.rows.forEach((r) => (e.target.checked ? state.selected.add(r.product_id) : state.selected.delete(r.product_id))); renderRows(); });
  let qTimer;
  $('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = $('#q').value.trim(); loadProducts(true); }, 300); });
  $('#leaf').addEventListener('change', () => { state.leaf = $('#leaf').value; loadProducts(true); });
  $('#sort').addEventListener('change', () => { state.sort = $('#sort').value; loadProducts(true); });
  $$('#filter-chips .chip').forEach((el) => el.addEventListener('click', () => {
    $$('#filter-chips .chip').forEach((c) => c.classList.remove('active')); el.classList.add('active');
    state.filter = el.dataset.f; try { localStorage.setItem('cs_filter', state.filter); } catch (e) { /* 무시 */ }
    loadProducts(true);
  }));
  try { const f = localStorage.getItem('cs_filter'); if (f && $(`#filter-chips .chip[data-f="${f}"]`)) state.filter = f; } catch (e) { /* 무시 */ }
  $$('#filter-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.f === state.filter));

  // 도구 메뉴
  const dd = $('#tools-dd');
  $('#btn-tools').addEventListener('click', (e) => { e.stopPropagation(); dd.querySelector('.menu').hidden = !dd.querySelector('.menu').hidden; });
  document.addEventListener('click', () => (dd.querySelector('.menu').hidden = true));
  $$('#tools-dd .menu a').forEach((el) => el.addEventListener('click', guard(async () => {
    dd.querySelector('.menu').hidden = true;
    if (el.dataset.action === 'logs') return showLogs();
    if (el.dataset.action === 'archive') return showArchive();
    if (el.dataset.action === 'capture_summary') return showCaptureSummary();
    if (el.dataset.action === 'capture_headers') {
      const txt = await api('/api/capture/headers');
      openModal('윙 캡처 요청 헤더 (복사해서 보내주세요)', `<button class="btn" id="copy-hd">전체 복사</button><pre>${esc(txt)}</pre>`);
      $('#copy-hd').addEventListener('click', () => { navigator.clipboard.writeText(txt).then(() => toast('복사했습니다.')); });
      return;
    }
    if (el.dataset.action === 'diag') return runDiag();
    if (el.dataset.action === 'diag_site') return runDiagSite();
    if (el.dataset.action === 'diag_product') {
      const sel = Array.from(state.selected)[0];
      if (!sel) return toast('표에서 상품 하나를 체크한 뒤 눌러주세요.', true);
      toast('상품 페이지를 열어 원본 값을 읽습니다 (20초 정도)');
      const r = await api('/api/diag/product', { product_id: sel });
      openModal('상품 진단', `<button class="btn" id="copy-diagp">전체 복사</button><pre>${esc(r.text)}</pre>`);
      $('#copy-diagp').addEventListener('click', () => { navigator.clipboard.writeText(r.text).then(() => toast('복사했습니다.')); });
      return;
    }
    if (el.dataset.action === 'diag_options') {
      const sel = Array.from(state.selected)[0];
      toast('옵션별 구매자 문구를 비교합니다 (옵션 최대 4개, 1~2분)');
      const r = await api('/api/diag/options', sel ? { product_id: sel } : {});
      openModal('옵션별 구매자 비교', `<button class="btn" id="copy-opt">전체 복사</button><pre>${esc(r.text)}</pre>`);
      $('#copy-opt').addEventListener('click', () => { navigator.clipboard.writeText(r.text).then(() => toast('복사했습니다.')); });
      return;
    }
    if (el.dataset.action === 'update') return runUpdate();
    if (el.dataset.action === 'quick_prices') { await api('/api/run/quick_prices', {}); toast('쿠폰 적용가를 확인합니다 (페이지는 열지 않습니다).'); await refreshAll(); return; }
    const tool = el.dataset.tool;
    if (tool === 'clear_run' && !confirm('현재 결과를 모두 비울까요? (보관함은 유지됩니다)')) return;
    toast('실행 중…');
    const r = await api(`/api/tools/${tool}`, {});
    toast(r.message || '완료');
    if (r.text) {
      openModal((tool === 'test_wing' ? '윙' : '쿠팡') + ' 연결 테스트 결과 (전체 복사해서 보내주세요)', `<button class="btn" id="copy-test">전체 복사</button><pre>${esc(r.text)}</pre>`);
      $('#copy-test').addEventListener('click', () => { navigator.clipboard.writeText(r.text).then(() => toast('복사했습니다.')); });
    }
    if (tool === 'reset_categories') { state.trees = {}; state.checked.clear(); renderAll(); }
    await refreshAll();
  })));

  // ---------- 시작 ----------
  async function boot() {
    const b = await api('/api/bootstrap');
    state.top = b.top_categories; state.conditions = b.conditions;
    $('#menu-update').textContent = `프로그램 업데이트 (현재 ${b.version})`; document.title = `쿠팡 소싱 프로그램 v${b.version}`;
    (b.checked || []).forEach((id) => state.checked.add(Number(id)));
    state.kwScope = (b.scope || []).filter((s) => s.type !== 'category');
    fillConditions();
    for (const t of state.top) if (state.checked.has(t.id)) { try { state.trees[t.id] = await api(`/api/categories/${t.id}/tree`); } catch (e) { /* 무시 */ } }
    renderAll();
    await refreshAll();
    setInterval(async () => {
      try {
        const d = await api('/api/status'); renderStatus(d);
        if (d.status.state !== 'idle' && !d.status.paused && Date.now() % 4 < 2) loadProducts(true);
      } catch (e) { /* 서버 재시작 중 */ }
    }, 1500);
  }
  boot().catch((e) => toast('초기화 실패: ' + e.message, true));
})();
