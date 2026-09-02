// 판매 리포트 파일(xlsx/csv) → 저장. 팝업, 앱 페이지, 백그라운드에서 공통으로 쓴다.
import * as S from './store.js';
import { fileToRecords } from './xlsx.js';
import { normalizeSales, normalizeAds, parseDate, yesterdayIso } from './parse.js';

// 파일명에 '20250901~20250901' 처럼 기간이 있고 시작=끝이면 그 날짜가 데이터 날짜다.
// (파일명의 단독 날짜는 다운로드한 날일 수 있어 사용자가 고른 날짜보다 뒤로 둔다)
export function dateFromReportName(filename) {
  const m = String(filename || '').match(/(20\d{2})[.\-]?(\d{2})[.\-]?(\d{2})\s*[~\-_]\s*(20\d{2})[.\-]?(\d{2})[.\-]?(\d{2})/);
  if (m && m[1] + m[2] + m[3] === m[4] + m[5] + m[6]) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export async function importSalesFile(buf, filename, date) {
  const records = await fileToRecords(buf, filename, ['옵션', '매출']);
  if (!records.length) throw new Error('파일에서 옵션ID·매출 열이 있는 표를 찾지 못했습니다. "상품별 판매 리포트" 파일이 맞는지 확인하세요.');
  date = dateFromReportName(filename) || date || parseDate(filename) || yesterdayIso();
  const rows = normalizeSales(records, date);
  if (!rows.length) throw new Error(`표는 찾았지만 인식된 행이 없습니다 (헤더: ${Object.keys(records[0]).join(', ')})`);
  const d = await S.load();
  const n = S.upsertSales(d, rows);
  for (const r of rows) if (!d.options.find((o) => o.option_id === r.option_id)) S.upsertOption(d, { option_id: r.option_id, product_name: r.option_name || r.product_name });
  await S.save(d);
  return { date, saved: n, records, unmapped: S.unmappedOptionIds(d).length };
}

export async function importAdsFile(buf, filename, date) {
  const records = await fileToRecords(buf, filename, ['캠페인']);
  if (!records.length) throw new Error('파일에서 캠페인 열이 있는 표를 찾지 못했습니다.');
  date = dateFromReportName(filename) || date || parseDate(filename) || yesterdayIso();
  const rows = normalizeAds(records, date);
  if (!rows.length) throw new Error('표는 찾았지만 인식된 캠페인 행이 없습니다.');
  const d = await S.load(); const n = S.upsertAds(d, rows); await S.save(d);
  return { date, saved: n, records };
}
