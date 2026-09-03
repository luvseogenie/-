// 트래픽 효과 분석: 캠페인마다 트래픽을 쓴 날 / 안 쓴 날의 하루 평균을 비교하고, 트래픽 시작 전후 같은 길이 기간을 비교한다.
const KEYS = ['organic_qty', 'organic_revenue', 'revenue', 'ad_orders', 'actual_qty', 'spend_vat', 'ad_revenue', 'profit'];
const avg = (rows, k) => (rows.length ? rows.reduce((a, r) => a + (r[k] || 0), 0) / rows.length : 0);
const pct = (on, off) => (off !== 0 ? (on - off) / Math.abs(off) : on > 0 ? 1 : on < 0 ? -1 : 0);

export function summarize(rows) { const o = { days: rows.length }; for (const k of KEYS) o[k] = avg(rows, k); return o; }

// 캠페인별 사용/미사용 비교 (기간 안의 날짜만)
export function campaignEffects(led, traffic) {
  const withTraffic = new Set((traffic || []).map((t) => t.campaign));
  const out = [];
  for (const c of led.campaigns) {
    if (!withTraffic.has(c.campaign)) continue;
    const days = Object.entries(c.days).map(([date, v]) => ({ date, ...v })).filter((v) => v.has_sales || v.has_ads);
    const on = days.filter((v) => v.traffic_slots > 0), off = days.filter((v) => !(v.traffic_slots > 0));
    const bySlot = {}; for (const v of on) (bySlot[v.traffic_slots] ||= []).push(v);
    out.push({ campaign: c.campaign, on: summarize(on), off: summarize(off), bySlot: Object.fromEntries(Object.entries(bySlot).map(([k, v]) => [k, summarize(v)])),
      delta: Object.fromEntries(KEYS.map((k) => [k, pct(avg(on, k), avg(off, k))])), days });
  }
  return out;
}

// 트래픽 시작 전후 비교: 시작일부터 N일(종료일 또는 오늘까지, 최대 maxDays) vs 시작 직전 N일
export function beforeAfter(ledAll, campaignName, entry, maxDays = 14, endLimit = null) {
  const c = ledAll.campaigns.find((x) => x.campaign === campaignName); if (!c) return null;
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  let end = entry.end && entry.end < ledAll.end ? entry.end : ledAll.end; if (endLimit && endLimit < end) end = endLimit;
  const afterDates = []; for (let d = entry.start; d <= end && afterDates.length < maxDays; d = addDays(d, 1)) afterDates.push(d);
  const n = afterDates.length; if (!n) return null;
  const beforeDates = []; for (let i = n; i >= 1; i--) beforeDates.push(addDays(entry.start, -i));
  const pick = (ds) => ds.map((d) => c.days[d]).filter((v) => v && (v.has_sales || v.has_ads));
  const before = summarize(pick(beforeDates)), after = summarize(pick(afterDates));
  return { entry, n, beforeFrom: beforeDates[0], beforeTo: beforeDates[n - 1], afterFrom: afterDates[0], afterTo: afterDates[n - 1], before, after, delta: Object.fromEntries(KEYS.map((k) => [k, pct(after[k], before[k])])) };
}
export { KEYS };
