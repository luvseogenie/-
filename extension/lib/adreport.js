// 광고센터 '보고서' 파일(키워드·옵션별 일별 성과) → 저장/집계. 시크릿팡의 캠페인 분석 화면에 해당하는 데이터.
// 행 하나 = 날짜 × 캠페인 × (광고그룹) × 옵션 × 노출 지면 × 키워드. 집계는 볼 때 한다.
import { normHeader, firstMatch, parseNumber, parsePercent, parseRatio, parseDate } from './parse.js';

// [필드, 별칭, 파서, 제외어]  (쿠팡 광고 보고서의 열 이름. 실제 파일이 다르면 별칭만 보태면 된다)
export const AD_REPORT_FIELDS = [
  ['date', ['날짜', '일자', '기준일', 'date'], 'date', ['종료', '시작', '등록', '생성']],
  ['campaign', ['캠페인명', '캠페인 이름', '캠페인'], 'text', ['ID', '아이디', '유형', '타입']],
  ['group', ['광고그룹명', '광고그룹', '광고 그룹'], 'text', ['ID']],
  ['option_id', ['광고집행 옵션ID', '광고집행옵션ID', '옵션ID', '옵션 ID', '광고 옵션 ID'], 'id', []],
  ['product_name', ['광고집행 상품명', '광고집행상품명', '상품명', '옵션명'], 'text', ['ID']],
  ['placement', ['광고 노출 지면', '노출 지면', '지면', '광고유형'], 'text', []],
  ['keyword', ['키워드', '검색어', 'keyword'], 'text', ['유형', '타입', '수', '개수']],
  ['impressions', ['노출수', '노출 수', '노출'], 'num', []],
  ['clicks', ['클릭수', '클릭 수', '클릭'], 'num', ['률']],
  ['spend', ['광고비', '집행 광고비', '비용'], 'num', ['효율', '수익률', '누적']],
  ['ctr', ['클릭률', 'CTR'], 'pct', []],
  ['orders1', ['총 주문수(1일)', '총 주문수 (1일)', '주문수(1일)', '1일 주문수'], 'num', []],
  ['qty1', ['총 판매수량(1일)', '판매수량(1일)', '1일 판매수량'], 'num', []],
  ['revenue1', ['총 전환매출액(1일)', '전환매출액(1일)', '전환 매출(1일)', '1일 전환매출'], 'num', []],
  ['roas1', ['총 광고수익률(1일)', '광고수익률(1일)', '1일 광고수익률'], 'ratio', []],
  ['orders14', ['총 주문수(14일)', '총 주문수 (14일)', '주문수(14일)', '14일 주문수', '총 주문수', '주문수', '주문'], 'num', ['1일']],
  ['qty14', ['총 판매수량(14일)', '판매수량(14일)', '14일 판매수량', '총 판매수량', '판매수량'], 'num', ['1일']],
  ['revenue14', ['총 전환매출액(14일)', '전환매출액(14일)', '전환 매출(14일)', '14일 전환매출', '총 전환매출액', '전환매출액', '광고매출', '광고 매출'], 'num', ['1일']],
  ['roas14', ['총 광고수익률(14일)', '광고수익률(14일)', '14일 광고수익률', '총 광고수익률', '광고수익률', 'ROAS'], 'ratio', ['1일']],
];
const cleanId = (v) => { let s = String(v ?? '').trim().replace(/,/g, ''); if (s.endsWith('.0')) s = s.slice(0, -2); return s; };

// 광고 보고서 파일인가: 캠페인 + 노출/클릭 + (키워드 또는 광고집행 옵션ID) 열이 있으면
export function isAdReport(headers) {
  const n = headers.map(normHeader).join('|');
  return /캠페인/.test(n) && /노출|클릭/.test(n) && /키워드|검색어|광고집행옵션|옵션id/i.test(n) && !/^.*옵션id.*매출원/.test(n);
}

export function normalizeAdReport(records, fallbackDate = null) {
  if (!records.length) return [];
  const headers = Object.keys(records[0]); const normed = headers.map(normHeader);
  const idx = {}; for (const [f, aliases, , excl] of AD_REPORT_FIELDS) idx[f] = firstMatch(normed, aliases, excl);
  if (idx.campaign == null) return [];
  const out = [];
  for (const rec of records) {
    const get = (f) => (idx[f] == null ? null : rec[headers[idx[f]]]);
    const row = {};
    for (const [f, , kind] of AD_REPORT_FIELDS) {
      const v = get(f);
      if (kind === 'date') row[f] = parseDate(v) || fallbackDate;
      else if (kind === 'text') row[f] = String(v ?? '').trim();
      else if (kind === 'id') row[f] = cleanId(v);
      else if (kind === 'pct') row[f] = parsePercent(v) ?? 0;
      else if (kind === 'ratio') row[f] = parseRatio(v) ?? 0;
      else row[f] = parseNumber(v) ?? 0;
    }
    if (!row.campaign || ['합계', '총계', '전체'].includes(normHeader(row.campaign))) continue;
    if (/^[-–—ㆍ·]?$/.test(row.keyword)) row.keyword = '';   // '-' = 검색어 없이 노출된 광고 (비검색 지면)
    if (!row.date) continue;
    // 14일 값이 없고 1일 값만 있으면 14일 칸에 1일 값을 (화면에서는 14일 기준을 쓴다)
    if (idx.orders14 == null && idx.orders1 != null) { row.orders14 = row.orders1; row.qty14 = row.qty1; row.revenue14 = row.revenue1; row.roas14 = row.roas1; }
    if (!row.ctr && row.impressions) row.ctr = row.clicks / row.impressions;
    if (!row.roas14 && row.spend) row.roas14 = row.revenue14 / row.spend;
    out.push(row);
  }
  return out;
}

// ---- 집계 ----
const SUMK = ['impressions', 'clicks', 'spend', 'orders1', 'qty1', 'revenue1', 'orders14', 'qty14', 'revenue14'];
const blank = () => ({ impressions: 0, clicks: 0, spend: 0, orders1: 0, qty1: 0, revenue1: 0, orders14: 0, qty14: 0, revenue14: 0, rows: 0 });
export function finish(a) {
  a.ctr = a.impressions ? a.clicks / a.impressions : 0;
  a.cpc = a.clicks ? a.spend / a.clicks : 0;
  a.cpm = a.impressions ? a.spend / a.impressions * 1000 : 0;
  a.conversion = a.clicks ? a.orders14 / a.clicks : 0;
  a.roas = a.spend ? a.revenue14 / a.spend : 0;
  a.orders = a.orders14; a.qty = a.qty14; a.revenue = a.revenue14;
  a.cpa = a.orders ? a.spend / a.orders : 0;          // 전환당 비용
  a.aov = a.orders ? a.revenue / a.orders : 0;         // 객단가
  return a;
}
// 노출 영역: 보고서의 '광고 노출 지면' 열이 있으면 그것으로, 없으면 키워드가 있으면 검색·없으면 비검색
export const AREAS = ['검색', '비검색'];
export function areaOf(r) {
  const p = String(r.placement || '');
  if (/비검색|non/i.test(p)) return '비검색';
  if (/검색|search/i.test(p)) return '검색';
  return r.keyword ? '검색' : '비검색';
}
export const byArea = (rows) => { const g = groupBy(rows, areaOf); for (const a of AREAS) if (!g.some((x) => x.key === a)) g.push(finish({ key: a, label: a, ...blank() })); return g.sort((x, y) => AREAS.indexOf(x.key) - AREAS.indexOf(y.key)); };
// 날짜별 × 영역별 (차트용). dates 순서대로 [{date, 검색, 비검색, 합계}]
export function byDateArea(rows, dates) {
  const map = {}; for (const r of rows) { const d = (map[r.date] ||= { 검색: [], 비검색: [] }); d[areaOf(r)].push(r); }
  return dates.map((date) => { const d = map[date] || { 검색: [], 비검색: [] }; return { date, 검색: total(d.검색), 비검색: total(d.비검색), 합계: total([...d.검색, ...d.비검색]) }; });
}
// 마진 = Σ 판매수량(14일) × 옵션 개당 마진 − 광고비. marginFn(option_id, date) 는 store.marginLookup
export function marginOf(rows, marginFn) { let m = 0, spend = 0; for (const r of rows) { m += (r.qty14 || 0) * (marginFn(r.option_id, r.date) || 0); spend += r.spend || 0; } return m - spend; }
export function dateList(from, to) { const out = []; const d = new Date(from + 'T00:00:00'); const e = new Date(to + 'T00:00:00'); for (; d <= e; d.setDate(d.getDate() + 1)) out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); return out; }
// d.adrows 에서 기간·캠페인으로 골라낸 행 목록
export function selectRows(d, { from, to, campaign = null } = {}) {
  const out = [];
  for (const [date, rows] of Object.entries(d.adrows || {})) {
    if ((from && date < from) || (to && date > to)) continue;
    for (const r of rows) if (!campaign || r.campaign === campaign) out.push(r);
  }
  return out;
}
export function groupBy(rows, keyFn, labelFn = null) {
  const by = {};
  for (const r of rows) {
    const k = keyFn(r); if (k == null || k === '') continue;
    const a = (by[k] ||= { key: k, label: labelFn ? labelFn(r) : k, ...blank() });
    for (const s of SUMK) a[s] += r[s] || 0; a.rows++;
  }
  return Object.values(by).map(finish);
}
export const NO_KEYWORD = '비검색 노출 (키워드 없음)';
export const byKeyword = (rows) => groupBy(rows, (r) => r.keyword || NO_KEYWORD);
export const byOption = (rows) => groupBy(rows, (r) => r.option_id || r.product_name || '(옵션 없음)', (r) => r.product_name || r.option_id);
export const byDate = (rows) => groupBy(rows, (r) => r.date).sort((a, b) => a.key.localeCompare(b.key));
export const byCampaign = (rows) => groupBy(rows, (r) => r.campaign);
export function total(rows) { const a = blank(); for (const r of rows) { for (const s of SUMK) a[s] += r[s] || 0; a.rows++; } return finish(a); }
// 캠페인 목록 (보고서에 있는 것)
export function campaignsOf(d) { const s = new Set(); for (const rows of Object.values(d.adrows || {})) for (const r of rows) s.add(r.campaign); return [...s]; }
export function reportDates(d) { return Object.keys(d.adrows || {}).sort(); }

// 제외 키워드 후보: 광고비는 썼는데 주문이 없거나, ROAS 가 기준보다 낮은 키워드
export function excludeCandidates(rows, { minSpend = 5000, maxRoas = 1 } = {}) {
  return byKeyword(rows).filter((k) => k.key !== NO_KEYWORD && k.spend >= minSpend && (k.orders14 === 0 || k.roas < maxRoas)).sort((a, b) => b.spend - a.spend);
}
