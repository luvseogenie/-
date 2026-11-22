// 경쟁사 매출 추정: 원할 때(자동 수집 없음) 경쟁사 스토어(또는 검색·상품 목록) 화면의 전체 상품의 리뷰 수·가격을 기록하고,
// 리뷰가 늘어난 속도 ÷ 리뷰 작성률 = 판매량, × 가격 = 매출 로 한 달 매출을 가늠한다. 실제 매출이 아니라 추정치.
// d.competitors = [{ id, url, name, mine, added }]
// d.compSnaps = { id: { 'YYYY-MM-DD': { pid: { name, price, reviews, rating, sold } } } }
// d.compSettings = { reviewRate: 0.02, days: 14 }

export const DEFAULT_COMP = { reviewRate: 0.02, days: 14 };

export function competitorId(url) {
  let u; try { u = new URL(String(url).trim()); } catch { throw new Error('주소가 올바르지 않습니다 (https://… 로 시작하는 쿠팡 주소를 넣으세요)'); }
  if (!/(^|\.)coupang\.com$/.test(u.hostname)) throw new Error('쿠팡 주소(coupang.com)를 넣으세요');
  const vendor = u.pathname.match(/\/(A\d{5,}|vendors?\/[^/]+)/i)?.[1] || u.searchParams.get('vendorId') || u.searchParams.get('sellerId');
  if (vendor) return 'v:' + vendor.replace(/^vendors?\//i, '');
  const q = u.searchParams.get('q') || u.searchParams.get('keyword'); if (q) return 'q:' + q;
  return 'u:' + u.hostname + u.pathname;
}
export function addCompetitor(d, url, name = '', mine = false) {
  const id = competitorId(url); d.competitors ||= [];
  const cur = d.competitors.find((c) => c.id === id);
  if (cur) { cur.url = url.trim(); if (name) cur.name = name; cur.mine = !!mine; return cur; }
  const c = { id, url: url.trim(), name: name || id.replace(/^\w:/, ''), mine: !!mine, added: new Date().toISOString().slice(0, 10) };
  d.competitors.push(c); return c;
}
export function removeCompetitor(d, id) {
  d.competitors = (d.competitors || []).filter((c) => c.id !== id); if (d.compSnaps) delete d.compSnaps[id];
}
// 하루 기록 (같은 날 여러 번 읽으면 합친다). 120일 넘은 기록은 지운다
export function setCompetitorSnapshot(d, id, date, products) {
  d.compSnaps ||= {}; const m = (d.compSnaps[id] ||= {}); const day = (m[date] ||= {});
  for (const p of products) if (p.pid) day[p.pid] = { name: p.name || day[p.pid]?.name || '', price: p.price ?? day[p.pid]?.price ?? null, reviews: p.reviews ?? day[p.pid]?.reviews ?? null, rating: p.rating ?? null, sold: p.sold || '' };
  for (const k of Object.keys(m).sort().slice(0, -120)) delete m[k];
  return Object.keys(day).length;
}
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const addDays = (iso, n) => { const x = new Date(iso + 'T00:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

// 상품마다: 기간 안 첫 기록과 마지막 기록 사이에 늘어난 리뷰 ÷ 날짜 수 = 하루 리뷰
function reviewGrowth(snaps, from, to) {
  const dates = Object.keys(snaps || {}).filter((x) => x >= from && x <= to).sort(); const out = {};
  for (const date of dates) for (const [pid, p] of Object.entries(snaps[date])) {
    if (p.reviews == null) continue; const o = (out[pid] ||= { first: date, firstReviews: p.reviews, last: date, lastReviews: p.reviews, name: p.name, price: p.price, sold: p.sold });
    if (date >= o.last) { o.last = date; o.lastReviews = p.reviews; if (p.name) o.name = p.name; if (p.price) o.price = p.price; if (p.sold) o.sold = p.sold; }
  }
  for (const o of Object.values(out)) { o.span = dayDiff(o.first, o.last); o.added = Math.max(0, o.lastReviews - o.firstReviews); o.perDay = o.span > 0 ? o.added / o.span : null; }
  return { dates, byPid: out };
}

// 리뷰 작성률: '내 스토어' 로 넣은 것이 있으면 내 실제 판매량(판매 분석)과 내 리뷰 증가로 계산, 없으면 설정값(기본 2% = 50개 팔리면 리뷰 1개)
export function reviewRate(d, today) {
  const st = { ...DEFAULT_COMP, ...(d.compSettings || {}) };
  const mine = (d.competitors || []).find((c) => c.mine);
  if (mine) {
    const { dates, byPid } = reviewGrowth(d.compSnaps?.[mine.id], addDays(today, -60), today);
    if (dates.length >= 2) {
      const from = dates[0], to = dates[dates.length - 1]; const added = Object.values(byPid).reduce((a, o) => a + o.added, 0);
      let qty = 0; for (const [date, day] of Object.entries(d.sales || {})) if (date > from && date <= to) for (const r of Object.values(day)) qty += Math.max(0, r.quantity || 0);
      if (qty >= 30 && added > 0) return { rate: Math.min(0.2, Math.max(0.003, added / qty)), how: `내 스토어: ${from.slice(5)}~${to.slice(5)} 판매 ${qty}개에 리뷰 ${added}개`, calibrated: true };
    }
  }
  return { rate: Number(st.reviewRate) || DEFAULT_COMP.reviewRate, how: '설정값', calibrated: false };
}

// 엑셀(CSV)용 표: 마지막으로 읽은 전체 상품 + 추정
export function competitorCsv(d, id, today) {
  const e = estimateCompetitor(d, id, today); const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['상품ID', '상품명', '가격', '리뷰 수', '별점', '구매 표시', '하루 리뷰 증가', '하루 판매(추정)', '월 판매(추정)', '월 매출(추정)', '링크', '읽은 날'];
  const rows = e.products.map((p) => [p.pid, p.name, p.price ?? '', p.reviews ?? '', p.rating ?? '', p.sold || '', p.reviewsPerDay != null ? Math.round(p.reviewsPerDay * 100) / 100 : '', p.estQtyDay != null ? Math.round(p.estQtyDay) : '', p.estMonthQty != null ? Math.round(p.estMonthQty) : '', p.estMonthRev != null ? Math.round(p.estMonthRev) : '', `https://www.coupang.com/vp/products/${p.pid}`, e.lastDate || '']);
  return '\ufeff' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
export function estimateCompetitor(d, id, today, opt = {}) {
  const st = { ...DEFAULT_COMP, ...(d.compSettings || {}), ...opt };
  const rr = opt.rate ? { rate: opt.rate, how: '지정', calibrated: false } : reviewRate(d, today);
  const snaps = d.compSnaps?.[id] || {}; const all = Object.keys(snaps).sort(); const lastDate = all[all.length - 1] || null;
  const from = addDays(today, -(st.days || 14));
  const { dates, byPid } = reviewGrowth(snaps, from, today);
  const latest = lastDate ? snaps[lastDate] : {};
  const products = Object.entries(latest).map(([pid, p]) => {
    const g = byPid[pid]; const perDay = g?.perDay;
    const qtyDay = perDay != null ? perDay / rr.rate : null; const price = p.price || g?.price || 0;
    return { pid, name: p.name, price, reviews: p.reviews, rating: p.rating, sold: p.sold, reviewsPerDay: perDay, span: g?.span || 0,
      estQtyDay: qtyDay, estMonthQty: qtyDay != null ? qtyDay * 30 : null, estMonthRev: qtyDay != null ? qtyDay * 30 * price : null };
  }).sort((a, b) => (b.estMonthRev ?? -1) - (a.estMonthRev ?? -1) || (b.reviews || 0) - (a.reviews || 0));
  const known = products.filter((p) => p.estMonthRev != null);
  const span = dates.length >= 2 ? dayDiff(dates[0], dates[dates.length - 1]) : 0;
  return { id, lastDate, firstDate: all[0] || null, days: all.length, span, rate: rr, products, totalMonthRev: known.reduce((a, p) => a + p.estMonthRev, 0), totalMonthQty: known.reduce((a, p) => a + p.estMonthQty, 0), measured: known.length,
    ready: span >= 1, reliable: span >= 7 };
}
