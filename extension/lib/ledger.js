// 광고 장부 계산 (coupang_calc/ledger.py 와 같은 규칙)
import { campaigns as campaignList, dates as allDates, marginLookup } from './store.js';

export const VAT = 1.1;
export const METRICS = [
  ['target_roas', '목표효율', 'ratio'], ['roas', '광고수익률', 'ratio'], ['budget', '광고예산', 'won'],
  ['spend_vat', '집행 광고비*10%', 'won'], ['cpc', 'CPC 단가', 'won'], ['impressions', '노출수', 'int'],
  ['ctr', '클릭률', 'pct2'], ['conversion', '전환율', 'pct1'], ['ad_orders', '광고 전환 판매 수', 'int'],
  ['actual_qty', '실제 판매 수', 'int'], ['margin_total', '광고 마진', 'won'], ['profit', '순이익 (광고비제외)', 'won'],
];
const SUM = ['spend_vat', 'spend', 'ad_revenue', 'budget', 'impressions', 'clicks', 'ad_orders', 'actual_qty', 'margin_total', 'profit'];
const cell = () => ({ target_roas: 0, roas: 0, budget: 0, spend: 0, spend_vat: 0, ad_revenue: 0, cpc: 0, impressions: 0, clicks: 0, ctr: 0,
  conversion: 0, ad_orders: 0, actual_qty: 0, margin_total: 0, profit: 0, action: '', has_ads: false, has_sales: false, unmapped_qty: 0 });

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

  for (const [date, day] of Object.entries(d.ads)) {
    if (date < start || date > end) continue;
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
    for (const s of Object.values(day)) {
      const camp = campaignOf[s.option_id];
      if (!camp) { unmapped.add(s.option_id); continue; }
      const c = get(camp, date); c.has_sales = true;
      const m = margin(s.option_id, date);
      c.actual_qty += s.quantity; c.margin_total += s.quantity * m;
      if (m === 0 && s.quantity) c.unmapped_qty += s.quantity;
    }
  }
  const dates = dateRange(start, end);
  const total_profit = {}, month_profit = {};
  const result = [];
  for (const camp of order) {
    const days = {}, months = {};
    for (const date of dates) {
      const c = cells[camp]?.[date]; if (!c) continue;
      c.profit = c.margin_total - c.spend_vat; days[date] = c;
      total_profit[date] = (total_profit[date] || 0) + c.profit;
      const mk = date.slice(0, 7); month_profit[mk] = (month_profit[mk] || 0) + c.profit;
      const ma = (months[mk] ||= cell());
      for (const k of SUM) ma[k] += c[k];
    }
    for (const ma of Object.values(months)) {
      ma.roas = ma.spend ? ma.ad_revenue / ma.spend : 0; ma.cpc = ma.clicks ? ma.spend / ma.clicks : 0;
      ma.ctr = ma.impressions ? ma.clicks / ma.impressions : 0; ma.conversion = ma.clicks ? ma.ad_orders / ma.clicks : 0;
    }
    result.push({ campaign: camp, days, months });
  }
  return { start, end, dates, metrics: METRICS.map(([key, label, fmt]) => ({ key, label, fmt })), campaigns: result,
    total_profit, month_profit, unmapped_options: [...unmapped].sort() };
}
