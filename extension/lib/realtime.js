// 실시간(오늘) ROAS: 매 정시 판매분석 '오늘' 판매 리포트와 광고센터 '오늘' 캠페인 숫자를 받아,
// 캠페인마다 그 캠페인에 들어 있는 등록상품ID(연결된 옵션의 등록상품) 전체 매출을 합해 광고비와 비교한다.
// 오늘 숫자는 하루가 끝나지 않은 값이라 장부(d.sales·d.ads)에는 넣지 않고 따로(ccrealtime) 둔다.
import { optionFacts, marginLookup, brandChecker } from './store.js';

export const KEY_RT = 'ccrealtime';          // { 'YYYY-MM-DD': [snapshot, ...] } 최근 14일
export const KEY_RT_SALES = 'ccrealtimeSales'; // 방금 받은 오늘 판매 리포트 { date, at, rows }
export const VAT = 1.1;

export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// 광고센터 캠페인 표 → 캠페인별 오늘 광고비. 표에 '오늘 누적광고비' 칸이 있으면(기간과 상관없이 오늘 쓴 돈) 그 칸을,
// 없고 화면 기간이 오늘이면 일반 광고비·전환매출을 쓴다. 오늘 칸만 쓸 때는 광고센터 전환매출을 모른다(revenueKnown=false)
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
export function todayAdsRows(records, normalizeAds, date, periodIsToday) {
  const keys = records.length ? Object.keys(records[0]) : [];
  const todayKey = keys.find((k) => /오늘/.test(k) && /광고비|소진|비용/.test(k));
  const campKey = keys.find((k) => /캠페인/.test(k) && !/ID|아이디|유형|타입|상태/.test(k));
  if (todayKey) {
    const rows = records.map((rec) => { const n = normalizeAds([rec], date)[0]; const campaign = n?.campaign || String(rec[campKey] ?? '').trim(); if (!campaign || /합계|총계/.test(campaign)) return null; return { campaign, spend: num(rec[todayKey]), ad_revenue: 0, ad_orders: 0, clicks: 0, impressions: 0, revenueKnown: false }; }).filter(Boolean);
    return { rows, how: todayKey };
  }
  if (periodIsToday) return { rows: normalizeAds(records, date).map((x) => ({ ...x, revenueKnown: true })), how: 'period' };
  return { rows: null, headers: keys };
}

// salesRows: normalizeSales(오늘) 결과, adsRows: 위 todayAdsRows 결과
export function computeSnapshot(d, salesRows, adsRows, at = new Date()) {
  const date = todayIso(at); const facts = optionFacts(d); const margin = marginLookup(d); const mine = brandChecker(d);
  const sales = (salesRows || []).filter((r) => (r.quantity || 0) > 0 || (r.revenue || 0) > 0).filter((r) => mine(r.option_name, r.product_name));
  const todayPid = {}; for (const r of sales) if (r.product_id) todayPid[r.option_id] = String(r.product_id);
  const pidOf = (oid) => String(facts[oid]?.product_id || todayPid[oid] || '');
  // 캠페인 → 연결된 옵션, 그 옵션들의 등록상품ID
  const campOids = {}, campPids = {};
  for (const o of d.options || []) {
    if (!o.campaign) continue;
    (campOids[o.campaign] ||= new Set()).add(o.option_id);
    const p = pidOf(o.option_id); if (p) (campPids[o.campaign] ||= new Set()).add(p);
  }
  const camps = {};
  for (const a of adsRows || []) {
    if (!a.campaign) continue;
    const c = (camps[a.campaign] ||= { spend: 0, ad_revenue: 0, ad_orders: 0, clicks: 0, impressions: 0, revenue: 0, qty: 0, margin: 0, noMarginQty: 0, products: 0 });
    c.spend += a.spend || 0; c.ad_revenue += a.ad_revenue || 0; c.ad_orders += a.ad_orders || 0; c.clicks += a.clicks || 0; c.impressions += a.impressions || 0;
  }
  for (const [name, c] of Object.entries(camps)) {
    const oids = campOids[name] || new Set(); const pids = campPids[name] || new Set(); c.products = pids.size;
    for (const r of sales) {
      if (!(oids.has(r.option_id) || (r.product_id && pids.has(String(r.product_id))))) continue;
      const m = margin(r.option_id, date) || 0;
      c.revenue += r.revenue || 0; c.qty += r.quantity || 0; c.margin += (r.quantity || 0) * m; if (!m) c.noMarginQty += r.quantity || 0;
    }
    c.roas = c.spend ? c.revenue / c.spend : 0; c.ad_roas = c.spend ? c.ad_revenue / c.spend : 0; c.profit = c.margin - c.spend * VAT;
  }
  const total = { spend: 0, ad_revenue: 0, revenue: 0, qty: 0, margin: 0, noMarginQty: 0 };
  for (const c of Object.values(camps)) { total.spend += c.spend; total.ad_revenue += c.ad_revenue; }
  for (const r of sales) { const m = margin(r.option_id, date) || 0; total.revenue += r.revenue || 0; total.qty += r.quantity || 0; total.margin += (r.quantity || 0) * m; if (!m) total.noMarginQty += r.quantity || 0; }
  total.roas = total.spend ? total.revenue / total.spend : 0; total.ad_roas = total.spend ? total.ad_revenue / total.spend : 0; total.profit = total.margin - total.spend * VAT;
  return { at: at.getTime(), hour: at.getHours(), date, total, camps, adRevenueKnown: (adsRows || []).some((a) => a.revenueKnown !== false) };
}

// 직전 기록과의 차이 = 그 사이(대개 1시간) 동안 쓴 광고비·늘어난 매출
export function deltaOf(snap, prev) {
  if (!prev || prev.date !== snap.date) return null;
  const spend = snap.total.spend - prev.total.spend, revenue = snap.total.revenue - prev.total.revenue, profit = snap.total.profit - prev.total.profit;
  return { spend, revenue, profit, roas: spend > 0 ? revenue / spend : 0, minutes: Math.round((snap.at - prev.at) / 60000) };
}

export function addSnapshot(store, snap, keepDays = 14) {
  const out = { ...(store || {}) }; out[snap.date] = [...(out[snap.date] || []).filter((x) => x.hour !== snap.hour), snap].sort((a, b) => a.at - b.at);
  for (const k of Object.keys(out).sort().slice(0, -keepDays)) delete out[k];
  return out;
}

// 알림 한 줄: 전체 + 이 시간 + 효율이 가장 낮은 캠페인
export function summaryText(snap, prev) {
  const won = (v) => `${Math.round(v).toLocaleString('ko-KR')}원`; const pct = (v) => `${Math.round(v * 100)}%`;
  const t = snap.total; const dl = deltaOf(snap, prev);
  let s = `${snap.hour}시 실시간 — 광고비 ${won(t.spend)} · 매출 ${won(t.revenue)} · ROAS ${pct(t.roas)} · 예상 순이익 ${won(t.profit)}`;
  if (dl && dl.spend > 0) s += ` (지난 ${dl.minutes}분: 광고비 ${won(dl.spend)}, 매출 ${won(dl.revenue)}, ROAS ${pct(dl.roas)})`;
  const worst = Object.entries(snap.camps).filter(([, c]) => c.spend >= 5000).sort((a, b) => a[1].roas - b[1].roas)[0];
  if (worst && worst[1].roas < 2) s += ` · 효율 낮음: ${worst[0]} ROAS ${pct(worst[1].roas)}`;
  return s;
}
