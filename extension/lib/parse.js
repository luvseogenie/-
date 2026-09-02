// 표에서 읽은 문자열을 숫자로 바꾸고, 헤더 이름으로 열을 찾는다. (coupang_calc/common.py, sales_report.py, ads_report.py 와 같은 규칙)
export const normHeader = (t) => String(t ?? '').replace(/\n/g, '').replace(/[\s_\-()/\[\]:·※*]+/g, '').toLowerCase();

export function parseNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (['', '-', '—', '–', 'N/A', 'nan'].includes(s)) return null;
  const pct = s.endsWith('%');
  s = s.replace(/%|,|₩|원/g, '').trim();
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return pct ? n / 100 : n;
}
export function parsePercent(v, percentUnits = false) {
  if (typeof v === 'string' && v.trim().endsWith('%')) return parseNumber(v);
  const n = parseNumber(v);
  if (n == null) return null;
  if (percentUnits) return n / 100;
  return n > 1 ? n / 100 : n;
}
export function parseRatio(v, percentUnits = false) {
  if (typeof v === 'string' && v.trim().endsWith('%')) return parseNumber(v);
  const n = parseNumber(v);
  if (n == null) return null;
  return percentUnits ? n / 100 : n;
}
export function parseDate(v) {
  if (!v) return null;
  const m = String(v).match(/(20\d{2})[.\-/]?\s?(\d{1,2})[.\-/]?\s?(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}
export function yesterdayIso() { const d = new Date(); d.setDate(d.getDate() - 1); return localIso(d); }
export function localIso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

export function firstMatch(normedHeaders, aliases) {
  const al = aliases.map(normHeader);
  let i = normedHeaders.findIndex((h) => al.includes(h));
  if (i >= 0) return i;
  i = normedHeaders.findIndex((h) => al.some((a) => a && h.includes(a)));
  return i >= 0 ? i : null;
}

export const SALES_FIELDS = [
  ['option_id', ['옵션ID', '옵션 ID', '옵션아이디', 'vendorItemId']],
  ['option_name', ['옵션명', '옵션 이름']],
  ['product_name', ['상품명', '상품 이름']],
  ['product_id', ['등록상품ID', '등록상품 ID', '상품ID', 'productId']],
  ['category', ['카테고리']],
  ['sales_type', ['판매방식', '판매 방식', '판매유형']],
  ['revenue', ['매출', '매출액', '결제금액']],
  ['orders', ['주문', '주문수', '주문 수']],
  ['quantity', ['판매량', '판매수량', '판매 수량']],
  ['visitors', ['방문자', '방문자수', '방문자 수']],
  ['views', ['조회', '조회수', '상품조회']],
  ['carts', ['장바구니', '장바구니수']],
  ['conversion', ['구매전환율', '구매 전환율', '전환율']],
];
const SALES_TEXT = new Set(['option_id', 'option_name', 'product_name', 'product_id', 'category', 'sales_type']);

export const ADS_FIELDS = [
  ['campaign', ['캠페인 이름', '캠페인명', '캠페인', '광고캠페인'], null],
  ['target_roas', ['목표효율', '목표 광고수익률', '목표 ROAS', '목표수익률'], parseRatio],
  ['budget', ['광고예산', '일 예산', '일예산', '예산'], parseNumber],
  ['spend', ['집행 광고비', '집행광고비', '광고비', '광고 비용', '비용'], parseNumber],
  ['ad_revenue', ['광고전환 매출', '광고전환매출', '전환 매출', '전환매출', '광고 매출', '총 전환 매출'], parseNumber],
  ['conversion', ['전환율', '구매전환율', '구매 전환율'], parsePercent],
  ['ctr', ['클릭률', 'CTR'], parsePercent],
  ['impressions', ['노출수', '노출 수', '노출'], parseNumber],
  ['clicks', ['클릭수', '클릭 수', '클릭'], parseNumber],
  ['ad_orders', ['광고전환 판매수', '광고전환판매수', '총 판매수량', '판매수량', '전환수', '판매 수'], parseNumber],
  ['action', ['ACTION', '액션', '메모', '비고'], null],
];

const cleanId = (v) => { let s = String(v ?? '').trim().replace(/,/g, ''); if (s.endsWith('.0')) s = s.slice(0, -2); return s; };

// {헤더: 값} 목록 → 판매 행 목록. 헤더에서 옵션ID 열을 못 찾으면 빈 배열.
export function normalizeSales(records, date) {
  if (!records.length) return [];
  const headers = Object.keys(records[0]);
  const normed = headers.map(normHeader);
  const idx = {};
  for (const [f, aliases] of SALES_FIELDS) idx[f] = firstMatch(normed, aliases);
  if (idx.option_id == null) return [];
  const out = [];
  for (const rec of records) {
    const get = (f) => (idx[f] == null ? null : rec[headers[idx[f]]]);
    const optionId = cleanId(get('option_id'));
    if (!/^\d+$/.test(optionId)) continue;
    if (['합계', '총계', 'total'].includes(normHeader(get('option_name')))) continue;
    const row = { date, option_id: optionId };
    for (const [f] of SALES_FIELDS) {
      if (f === 'option_id') continue;
      if (SALES_TEXT.has(f)) row[f] = f === 'product_id' ? cleanId(get(f)) : String(get(f) ?? '').trim();
      else if (f === 'conversion') row[f] = parsePercent(get(f));
      else row[f] = parseNumber(get(f)) ?? 0;
    }
    out.push(row);
  }
  return out;
}

// {헤더: 값} 목록 → 광고 행 목록. percentUnits: 화면 입력처럼 숫자를 % 단위로 볼지.
export function normalizeAds(records, date, percentUnits = false) {
  const out = [];
  for (const rec of records) {
    const headers = Object.keys(rec);
    const normed = headers.map(normHeader);
    const row = { date };
    for (const [f, aliases, parser] of ADS_FIELDS) {
      const i = firstMatch(normed, aliases);
      const raw = i == null ? null : rec[headers[i]];
      if (!parser) row[f] = String(raw ?? '').trim();
      else row[f] = parser(raw, percentUnits) ?? 0;
    }
    if (!row.campaign || ['합계', '총계', '전체'].includes(normHeader(row.campaign))) continue;
    out.push(row);
  }
  return out;
}
