// 광고 장부 계산 (coupang_calc/ledger.py 와 같은 규칙)
import { campaigns as campaignList, dates as allDates, marginLookup, sortCampaigns } from './store.js';

export const VAT = 1.1;
export const UNMAPPED = '(캠페인 없음)';
export const METRICS = [
  ['target_roas', '목표효율', 'ratio'], ['roas', '광고수익률', 'ratio'], ['budget', '광고예산', 'won'],
  ['spend_vat', '집행 광고비*10%', 'won'], ['cpc', 'CPC 단가', 'won'], ['impressions', '노출수', 'int'],
  ['ctr', '클릭률', 'pct2'], ['conversion', '전환율', 'pct1'], ['ad_orders', '광고 전환 판매 수', 'int'],
  ['actual_qty', '실제 판매 수', 'int'], ['organic_qty', '자연 판매 수', 'int'], ['ad_share', '광고 판매 비중', 'pct0'],
  ['revenue', '총 매출', 'won'], ['ad_revenue', '광고 매출', 'won'], ['organic_revenue', '자연 매출', 'won'],
  ['margin_total', '판매 마진', 'won'], ['profit', '순이익 (광고비제외)', 'won'],
];
// 합계로 더하는 항목. 비율(roas, cpc, ctr, conversion, ad_share)은 합계에서 다시 계산한다.
const SUM = ['spend_vat', 'spend', 'ad_revenue', 'budget', 'impressions', 'clicks', 'ad_orders', 'actual_qty', 'organic_qty', 'revenue', 'organic_revenue', 'margin_total', 'profit', 'visitors', 'views'];
const cell = () => ({ target_roas: 0, roas: 0, budget: 0, spend: 0, spend_vat: 0, ad_revenue: 0, cpc: 0, impressions: 0, clicks: 0, ctr: 0,
  conversion: 0, ad_orders: 0, actual_qty: 0, organic_qty: 0, ad_share: 0, revenue: 0, organic_revenue: 0, visitors: 0, views: 0,
  margin_total: 0, profit: 0, action: '', has_ads: false, has_sales: false, has_revenue: false, unmapped_qty: 0 });
export function finalizeCell(c) {
  c.profit = c.margin_total - c.spend_vat;
  c.organic_qty = Math.max(0, c.actual_qty - c.ad_orders);
  c.organic_revenue = Math.max(0, c.revenue - c.ad_revenue);
  c.ad_share = c.actual_qty ? Math.min(1, c.ad_orders / c.actual_qty) : 0;
  return c;
}
export function finalizeSum(ma) {
  ma.roas = ma.spend ? ma.ad_revenue / ma.spend : 0; ma.cpc = ma.clicks ? ma.spend / ma.clicks : 0;
  ma.ctr = ma.impressions ? ma.clicks / ma.impressions : 0; ma.conversion = ma.clicks ? ma.ad_orders / ma.clicks : 0;
  ma.ad_share = ma.actual_qty ? Math.min(1, ma.ad_orders / ma.actual_qty) : 0;
  return ma;
}

function dateRange(start, end) {
  const out = []; const d = new Date(start + 'T00:00:00'); const e = new Date(end + 'T00:00:00');
  for (; d <= e; d.setDate(d.getDate() + 1)) out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  return out;
}
const monthStart = (iso) => iso.slice(0, 7) + '-01';
const monthEnd = (iso) => { const [y, m] = iso.split('-').map(Number); return `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };

export function computeLedger(d, start, end) {
  const ds = allDates(d);
  const today = new Date(); const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  start = start || (ds.length ? monthStart(ds[0]) : monthStart(todayIso));
  end = end || (ds.length ? monthEnd(ds[ds.length - 1]) : todayIso);
  const campaignOf = Object.fromEntries(d.options.map((o) => [o.option_id, o.campaign]));
  const margin = marginLookup(d);
  const order = campaignList(d);
  const cells = Object.fromEntries(order.map((c) => [c, {}]));
  const get = (camp, date) => { if (!cells[camp]) { cells[camp] = {}; order.push(camp); } return (cells[camp][date] ||= cell()); };

  // 엑셀 4번 시트가 있는 마지막 날짜까지는 엑셀 확정값만 쓴다 (그 구간의 ①② 데이터는 무시)
  const legacyDatesAll = Object.keys(d.legacy || {}).filter((x) => Object.keys(d.legacy[x]).length);
  const legacyCutoff = legacyDatesAll.length ? legacyDatesAll.sort().pop() : null;
  const excelOnly = (date) => legacyCutoff && date <= legacyCutoff;
  for (const [date, day] of Object.entries(d.ads)) {
    if (date < start || date > end || excelOnly(date)) continue;
    for (const a of Object.values(day)) {
      const c = get(a.campaign, date);
      Object.assign(c, { has_ads: true, target_roas: a.target_roas, budget: a.budget, spend: a.spend, ad_revenue: a.ad_revenue, spend_vat: a.spend * VAT,
        roas: a.spend ? a.ad_revenue / a.spend : 0, cpc: a.clicks ? a.spend / a.clicks : 0, impressions: a.impressions, clicks: a.clicks,
        ctr: a.ctr, conversion: a.conversion, ad_orders: a.ad_orders, action: a.action || '' });
    }
  }
  const unmapped = new Set();
  for (const [date, day] of Object.entries(d.sales)) {
    if (date < start || date > end) continue;
    const excel = excelOnly(date);
    for (const s of Object.values(day)) {
      let camp = campaignOf[s.option_id];
      if (!camp) { unmapped.add(s.option_id); camp = UNMAPPED; }
      const c = get(camp, date);
      // 엑셀 확정 구간: 판매 수·마진은 4번 시트 값을 쓰고, 판매 리포트에서는 매출(총 매출 → 자연 매출)과 방문·조회만 가져온다
      c.revenue += s.revenue || 0; c.visitors += s.visitors || 0; c.views += s.views || 0; c.has_revenue = true;
      if (excel) { if (camp === UNMAPPED) { c.has_sales = true; c.actual_qty += s.quantity; } continue; }
      c.has_sales = true;
      const m = margin(s.option_id, date);
      c.actual_qty += s.quantity; c.margin_total += s.quantity * m;
      if (m === 0 && s.quantity) c.unmapped_qty += s.quantity;
    }
  }
  // 예전 엑셀 4번 시트 값: 그 날 옵션별 판매/광고 데이터가 없는 쪽만 채운다 (있으면 새 데이터가 우선)
  const salesTouched = new Set();
  for (const [date, day] of Object.entries(d.sales)) { if (date < start || date > end || excelOnly(date)) continue; for (const s of Object.values(day)) { const camp = campaignOf[s.option_id]; if (camp) salesTouched.add(camp + '|' + date); } }
  for (const [date, day] of Object.entries(d.legacy || {})) {
    if (date < start || date > end) continue;
    for (const [camp, L] of Object.entries(day)) {
      const c = get(camp, date);
      const adsFromLegacy = !c.has_ads, salesFromLegacy = !salesTouched.has(camp + '|' + date);
      if (adsFromLegacy && (L.spend_vat || L.impressions || L.ad_orders)) {
        Object.assign(c, { has_ads: true, target_roas: L.target_roas || 0, budget: L.budget || 0, spend: L.spend || 0, spend_vat: L.spend_vat || 0, ad_revenue: L.ad_revenue || 0,
          roas: L.roas || 0, cpc: L.cpc || 0, impressions: L.impressions || 0, clicks: L.clicks || 0, ctr: L.ctr || 0, conversion: L.conversion || 0, ad_orders: L.ad_orders || 0 });
      }
      if (salesFromLegacy && (L.actual_qty || L.margin_total)) { c.has_sales = true; c.actual_qty = L.actual_qty || 0; c.margin_total = L.margin_total || 0; if (!c.has_revenue) c.revenue = c.ad_revenue; c.legacy = true; }
      if (adsFromLegacy && salesFromLegacy) c.legacy = true;
    }
  }
  const dates = dateRange(start, end);
  const total_profit = {}, month_profit = {};
  const result = [];
  for (const camp of sortCampaigns(order)) {
    const days = {}, months = {};
    for (const date of dates) {
      const c = cells[camp]?.[date]; if (!c) continue;
      finalizeCell(c); days[date] = c;
      total_profit[date] = (total_profit[date] || 0) + c.profit;
      const mk = date.slice(0, 7); month_profit[mk] = (month_profit[mk] || 0) + c.profit;
      const ma = (months[mk] ||= cell());
      for (const k of SUM) ma[k] += c[k];
    }
    for (const ma of Object.values(months)) finalizeSum(ma);
    const total = cell(); for (const c of Object.values(days)) for (const k of SUM) total[k] += c[k];
    finalizeSum(total); total.days = Object.keys(days).length;
    result.push({ campaign: camp, days, months, total });
  }
  // 날짜별 전체 합계 (대시보드용)
  const daily = {};
  for (const c of result) for (const [date, v] of Object.entries(c.days)) { const t = (daily[date] ||= cell()); for (const k of SUM) t[k] += v[k]; }
  for (const t of Object.values(daily)) finalizeSum(t);
  const grand = cell(); for (const t of Object.values(daily)) for (const k of SUM) grand[k] += t[k]; finalizeSum(grand);
  return { start, end, dates, metrics: METRICS.map(([key, label, fmt]) => ({ key, label, fmt })), campaigns: result,
    total_profit, month_profit, daily, grand, unmapped_options: [...unmapped].sort(), legacyCutoff };
}
