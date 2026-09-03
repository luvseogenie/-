// 표에서 읽은 문자열을 숫자로 바꾸고, 헤더 이름으로 열을 찾는다. (coupang_calc/common.py, sales_report.py, ads_report.py 와 같은 규칙)
export const normHeader = (t) => String(t ?? '').replace(/\n/g, '').replace(/[\s_\-()/\[\]:·※*?？!！ⓘ]+/g, '').toLowerCase();

export function parseNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (['', '-', '—', '–', 'N/A', 'nan'].includes(s)) return null;
  const pct = s.endsWith('%');
  s = s.replace(/%|,|₩|원/g, '').trim();
  let n = parseFloat(s);
  if (Number.isNaN(n)) {
    // '⚠ 10,000원' 처럼 아이콘 글자가 섞인 경우: 첫 숫자 덩어리만 사용
    const m = String(v).match(/-?\d[\d,]*(?:\.\d+)?\s*%?/);
    if (!m) return null;
    n = parseFloat(m[0].replace(/,|%/g, ''));
    return m[0].trim().endsWith('%') ? n / 100 : n;
  }
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

// 정확히 같은 헤더 → 없으면 별칭을 포함하는 헤더 중 가장 짧은(가장 구체적인) 것. exclude 에 든 말이 있는 헤더는 제외.
export function firstMatch(normedHeaders, aliases, exclude = []) {
  const al = aliases.map(normHeader); const ex = exclude.map(normHeader);
  const ok = (h) => !ex.some((e) => e && h.includes(e));
  let i = normedHeaders.findIndex((h) => al.includes(h) && ok(h));
  if (i >= 0) return i;
  let best = null;
  normedHeaders.forEach((h, idx) => { if (ok(h) && al.some((a) => a && h.includes(a)) && (best == null || h.length < normedHeaders[best].length)) best = idx; });
  return best;
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
  ['returns', ['반품수', '반품 수량', '반품량', '반품 상품 수', '반품']],
  ['cancels', ['취소수', '취소 수량', '취소량', '취소 상품 수', '취소']],
  ['net_qty', ['순 판매 상품 수', '순판매량', '순 판매량', '순판매']],
];
const SALES_TEXT = new Set(['option_id', 'option_name', 'product_name', 'product_id', 'category', 'sales_type']);
const SALES_OPTIONAL = new Set(['returns', 'cancels', 'net_qty']); // 파일에 있을 때만 (없으면 0)
export const lastHeaders = { sales: [], ads: [] };

// [필드, 별칭, 파서, 제외어]
export const ADS_FIELDS = [
  ['campaign', ['캠페인 이름', '캠페인명', '캠페인', '광고캠페인'], null, ['수', '개']],
  ['target_roas', ['목표효율', '목표 광고수익률', '목표 ROAS', '목표수익률'], parseRatio, []],
  ['budget', ['광고예산', '일 예산', '일예산', '예산'], parseNumber, ['점수', '주간', '공유']],
  ['spend', ['집행 광고비', '집행광고비', '광고비', '광고 비용', '비용'], parseNumber, ['오늘', '누적', '효율', '수익률']],
  ['ad_revenue', ['광고전환 매출', '광고전환매출', '광고 전환 매출', '전환 매출', '전환매출', '광고 매출', '총 전환 매출'], parseNumber, []],
  ['conversion', ['전환율', '구매전환율', '구매 전환율'], parsePercent, []],
  ['ctr', ['클릭률', 'CTR'], parsePercent, []],
  ['impressions', ['노출수', '노출 수', '노출'], parseNumber, []],
  ['clicks', ['클릭수', '클릭 수', '클릭'], parseNumber, ['률']],
  ['ad_orders', ['광고전환 판매수', '광고전환판매수', '광고 전환 판매', '총 판매수량', '판매수량', '전환수', '판매 수', '주문수'], parseNumber, ['매출']],
  ['action', ['ACTION', '액션', '메모', '비고'], null, []],
];
const DATE_ALIASES = ['날짜', '일자', '기준일', 'date'];
const DATE_EXCLUDE = ['종료', '시작', '요일', '등록', '생성', '수정', '마감', '결제'];

const cleanId = (v) => { let s = String(v ?? '').trim().replace(/,/g, ''); if (s.endsWith('.0')) s = s.slice(0, -2); return s; };

// {헤더: 값} 목록 → 판매 행 목록. 헤더에서 옵션ID 열을 못 찾으면 빈 배열.
export function normalizeSales(records, date) {
  if (!records.length) return [];
  const headers = Object.keys(records[0]);
  lastHeaders.sales = headers;
  const normed = headers.map(normHeader);
  const idx = {};
  for (const [f, aliases] of SALES_FIELDS) idx[f] = firstMatch(normed, aliases, f === 'returns' ? ['율', '금액'] : f === 'cancels' ? ['율', '금액'] : f === 'quantity' ? ['순', '취소', '반품'] : []);
  if (idx.option_id == null) return [];
  const out = [];
  for (const rec of records) {
    const get = (f) => (idx[f] == null ? null : rec[headers[idx[f]]]);
    const optionId = cleanId(get('option_id'));
    if (!/^\d+$/.test(optionId)) continue;
    if (['합계', '총계', 'total'].includes(normHeader(get('option_name')))) continue;
    const row = { date, option_id: optionId };
    const di = firstMatch(normed, DATE_ALIASES, DATE_EXCLUDE); const rowDate = di == null ? null : parseDate(rec[headers[di]]);
    if (rowDate) row.date = rowDate;
    for (const [f] of SALES_FIELDS) {
      if (f === 'option_id') continue;
      if (SALES_TEXT.has(f)) row[f] = f === 'product_id' ? cleanId(get(f)) : String(get(f) ?? '').trim();
      else if (f === 'conversion') row[f] = parsePercent(get(f));
      else if (SALES_OPTIONAL.has(f)) row[f] = idx[f] == null ? null : (parseNumber(get(f)) ?? 0);
      else row[f] = parseNumber(get(f)) ?? 0;
    }
    out.push(row);
  }
  return out;
}

// {헤더: 값} 목록 → 광고 행 목록. percentUnits: 화면 입력처럼 숫자를 % 단위로 볼지.
export function normalizeAds(records, date, percentUnits = false) {
  const out = [];
  if (records.length) lastHeaders.ads = Object.keys(records[0]);
  for (const rec of records) {
    const headers = Object.keys(rec);
    const normed = headers.map(normHeader);
    const row = { date };
    for (const [f, aliases, parser, exclude] of ADS_FIELDS) {
      const i = firstMatch(normed, aliases, exclude);
      const raw = i == null ? null : rec[headers[i]];
      if (!parser) row[f] = String(raw ?? '').trim();
      else row[f] = parser(raw, percentUnits) ?? 0;
    }
    // 광고센터 목록: 광고수익률 칸에 '305.19% 목표 350%' 처럼 목표가 함께 있음
    if (!row.target_roas) {
      for (const v of Object.values(rec)) { const m = String(v ?? '').match(/목표\s*([\d.,]+)\s*%/); if (m) { row.target_roas = parseFloat(m[1].replace(/,/g, '')) / 100; break; } }
    }
    // 보고서 파일처럼 행마다 날짜가 있으면 그 날짜를 쓴다
    const di = firstMatch(normed, DATE_ALIASES, DATE_EXCLUDE); const rowDate = di == null ? null : parseDate(rec[headers[di]]);
    if (rowDate) row.date = rowDate;
    // 캠페인 이름 칸에 'AI 스마트광고' 같은 배지가 붙어 있으면 앞의 배지 제거
    row.campaign = row.campaign.replace(/^(AI\s*스마트광고|NEW|추천)\s*/i, '').trim();
    if (!row.campaign || ['합계', '총계', '전체'].includes(normHeader(row.campaign))) continue;
    out.push(row);
  }
  return out;
}
