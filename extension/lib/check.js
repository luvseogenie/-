// 저장은 됐는데 화면에 안 보이는 이유를 찾아 준다 (대시보드 '데이터 점검').
import { marginLookup, dates as allDates } from './store.js';

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// 저장된 마지막 날짜 (없으면 null)
export function lastDataDate(d) { const ds = allDates(d); return ds.length ? ds[ds.length - 1] : null; }
// 기간의 기준 끝 날짜: 보통 어제. 데이터가 그보다 뒤 날짜에 저장돼 있으면 그 날.
export function endRef(d, yesterday) { const l = lastDataDate(d); return l && l > yesterday ? l : yesterday; }

// 엑셀 4번 시트 확정 구간의 마지막 날 (그 날까지는 ①② 로 새로 받은 값을 무시한다)
export function legacyCutoff(d) {
  const ds = Object.keys(d.legacy || {}).filter((x) => Object.keys(d.legacy[x]).length).sort();
  return ds.length ? ds[ds.length - 1] : null;
}

// 최근 days 일의 저장 상태와 문제 목록
export function dataCheck(d, start, end, endDate, days = 14) {
  const cutoff = legacyCutoff(d);
  const margin = marginLookup(d);
  const campOf = Object.fromEntries(d.options.map((o) => [o.option_id, o.campaign]));
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(endDate, -i);
    const sd = d.sales[date] || {}, ad = d.ads[date] || {};
    const list = Object.values(sd);
    rows.push({
      date,
      salesRows: list.length,
      adsRows: Object.keys(ad).length,
      spend_vat: Object.values(ad).reduce((a, b) => a + (b.spend || 0), 0) * 1.1,
      qty: list.reduce((a, b) => a + (b.quantity || 0), 0),
      revenue: list.reduce((a, b) => a + (b.revenue || 0), 0),
      noMargin: list.reduce((a, b) => a + (margin(b.option_id, date) ? 0 : (b.quantity || 0)), 0),
      noCampaign: list.reduce((a, b) => a + (campOf[b.option_id] ? 0 : (b.quantity || 0)), 0),
      inRange: date >= start && date <= end,
      excelOnly: !!(cutoff && date <= cutoff),
    });
  }
  const issues = [];
  const last = lastDataDate(d);
  if (last && last > end) issues.push({ type: 'outOfRange', date: last });
  const ignored = rows.filter((r) => r.excelOnly && (r.salesRows || r.adsRows));
  if (ignored.length) issues.push({ type: 'excelOnly', cutoff, from: ignored[0].date, to: ignored[ignored.length - 1].date, days: ignored.length });
  const lastAds = rows.filter((r) => r.adsRows).pop();
  if (lastAds && !lastAds.spend_vat && !lastAds.excelOnly) issues.push({ type: 'zeroSpend', date: lastAds.date, rows: lastAds.adsRows });
  const noMargin = rows.filter((r) => r.inRange && !r.excelOnly).reduce((a, r) => a + r.noMargin, 0);
  if (noMargin) issues.push({ type: 'noMargin', qty: noMargin });
  return { rows, issues, cutoff };
}
