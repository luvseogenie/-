// 확장 프로그램의 계산 로직이 파이썬(원본 엑셀 2025-06-08)과 같은 값을 내는지 node 로 검사한다.
//   node tests/js/test_extension.mjs
import assert from 'node:assert/strict';
import { normalizeSales, normalizeAds, parsePercent, parseRatio, parseDate } from '../../extension/lib/parse.js';
import * as S from '../../extension/lib/store.js';
import { computeLedger } from '../../extension/lib/ledger.js';

// chrome.storage 흉내
const mem = {};
globalThis.chrome = { storage: { local: { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o) } } };

const D = '2025-06-08';
const approx = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// 파서
approx(parsePercent('7.8%'), 0.078); approx(parsePercent(7.8), 0.078); approx(parsePercent(0.15, true), 0.0015);
assert.equal(parseRatio('400%'), 4); assert.equal(parseRatio(400, true), 4); assert.equal(parseDate('조회기간 2025.06.08 ~'), D);

const salesRecords = [
  { '옵션 ID': '12,340,330,543', '옵션명': '버킷햇 블랙', '상품명': '버킷햇', '등록상품ID': '7088112678', '카테고리': '패션', '판매방식': '로켓그로스', '매출': '90,000원', '주문': '9', '판매량': '9', '방문자': '14', '조회': '14', '장바구니': '1', '구매 전환율': '64.29%' },
  { '옵션 ID': '12340330547', '옵션명': '버킷햇 아이보리', '상품명': '버킷햇', '등록상품ID': '7088112678', '카테고리': '패션', '판매방식': '로켓그로스', '매출': '45,000', '주문': '3', '판매량': '3', '방문자': '8', '조회': '8', '장바구니': '2', '구매 전환율': '37.5%' },
  { '옵션 ID': '12340251321', '옵션명': '조거 1개', '상품명': '조거', '등록상품ID': '1', '카테고리': '패션', '판매방식': '로켓그로스', '매출': '148,500', '주문': '15', '판매량': '15', '방문자': '20', '조회': '20', '장바구니': '1', '구매 전환율': '75%' },
  { '옵션 ID': '12340251323', '옵션명': '조거 2개', '상품명': '조거', '등록상품ID': '1', '카테고리': '패션', '판매방식': '로켓그로스', '매출': '111,300', '주문': '7', '판매량': '7', '방문자': '12', '조회': '12', '장바구니': '2', '구매 전환율': '58%' },
  { '옵션 ID': '12340664987', '옵션명': '파우치 핑크', '상품명': '파우치', '등록상품ID': '1', '카테고리': '여행', '판매방식': '로켓그로스', '매출': '13,000', '주문': '1', '판매량': '1', '방문자': '6', '조회': '6', '장바구니': '1.5', '구매 전환율': '16%' },
  { '옵션 ID': '12340664978', '옵션명': '파우치 그린', '상품명': '파우치', '등록상품ID': '1', '카테고리': '여행', '판매방식': '로켓그로스', '매출': '13,000', '주문': '1', '판매량': '1', '방문자': '6', '조회': '6', '장바구니': '1.5', '구매 전환율': '16%' },
  { '옵션 ID': '합계', '옵션명': '', '매출': '420,800' },
  { '옵션 ID': '99999999999', '옵션명': '매핑 안 됨', '매출': '1,000', '판매량': '1' },
];
const sales = normalizeSales(salesRecords, D);
assert.equal(sales.length, 7); assert.equal(sales[0].option_id, '12340330543'); assert.equal(sales[0].revenue, 90000); approx(sales[0].conversion, 0.6429, 1e-4);
assert.deepEqual(normalizeSales([{ a: 1 }], D), []);

const adsRecords = [
  { '캠페인 이름': '1_버킷햇_240%', '목표 광고수익률': '400%', '일 예산': '70,000', '광고비': '67,241', '광고전환 매출': '180,000', '구매전환율': '7.8%', '클릭률': '0.15%', '노출수': '51,328', '클릭수': '153', '총 판매수량': '12' },
  { '캠페인 이름': '2_조거팬츠_238%', '목표 광고수익률': '350%', '일 예산': '80,000', '광고비': '70,328', '광고전환 매출': '259,800', '구매전환율': '15.3%', '클릭률': '0.20%', '노출수': '24,384', '클릭수': '150', '총 판매수량': '23' },
  { '캠페인 이름': '3_여행용파우치_247%', '목표 광고수익률': '400%', '일 예산': '40,000', '광고비': '13,274', '광고전환 매출': '26,000', '구매전환율': '6.7%', '클릭률': '0.10%', '노출수': '13,454', '클릭수': '30', '총 판매수량': '2' },
  { '캠페인 이름': '합계', '광고비': '150,843' },
];
const ads = normalizeAds(adsRecords, D);
assert.equal(ads.length, 3); assert.equal(ads[0].spend, 67241); assert.equal(ads[0].target_roas, 4); approx(ads[0].ctr, 0.0015, 1e-6);

// 저장소 + 매핑 + 장부
const d = await S.load();
const map = [['12340330543', '1_버킷햇_240%', 6000], ['12340330547', '1_버킷햇_240%', 6000], ['12340251321', '2_조거팬츠_238%', 5500], ['12340251323', '2_조거팬츠_238%', 8500], ['12340664987', '3_여행용파우치_247%', 7400], ['12340664978', '3_여행용파우치_247%', 7400]];
for (const [id, camp, m] of map) { S.upsertOption(d, { option_id: id, product_name: id, campaign: camp }); S.setMargin(d, id, m); }
S.upsertSales(d, sales); S.upsertAds(d, ads); S.upsertSales(d, sales); // 중복 저장 → 덮어쓰기
await S.save(d);
assert.equal(Object.keys(d.sales[D]).length, 7);
assert.deepEqual(S.campaigns(d), ['1_버킷햇_240%', '2_조거팬츠_238%', '3_여행용파우치_247%']);
assert.deepEqual(S.unmappedOptionIds(d), ['99999999999']);

let led = computeLedger(d, D, D);
const by = Object.fromEntries(led.campaigns.map((c) => [c.campaign, c.days[D]]));
approx(by['1_버킷햇_240%'].spend_vat, 73965.1); approx(by['1_버킷햇_240%'].roas, 2.6769, 1e-3); approx(by['1_버킷햇_240%'].cpc, 439.48);
assert.equal(by['1_버킷햇_240%'].actual_qty, 12); assert.equal(by['1_버킷햇_240%'].margin_total, 72000);
approx(by['1_버킷햇_240%'].profit, -1965.1); approx(by['2_조거팬츠_238%'].profit, 64639.2); approx(by['3_여행용파우치_247%'].profit, 198.6);
approx(led.total_profit[D], 62872.7); assert.deepEqual(led.unmapped_options, ['99999999999']);
approx(led.campaigns[0].months['2025-06'].profit, -1965.1); approx(led.campaigns[0].months['2025-06'].roas, 2.6769, 1e-3);
led = computeLedger(d); assert.equal(led.dates[0], '2025-06-01'); assert.equal(led.dates[led.dates.length - 1], '2025-06-30');

// 마진 이력: 6/10 부터 4000 → 6/8, 6/9 는 6000 유지
for (const date of ['2025-06-09', '2025-06-10']) S.upsertSales(d, [{ ...sales[0], date, quantity: 10 }]);
S.setMargin(d, '12340330543', 4000, '2025-06-10', '쿠폰'); S.setMargin(d, '12340330547', 4000, '2025-06-10');
led = computeLedger(d, D, '2025-06-10');
const c1 = led.campaigns.find((c) => c.campaign === '1_버킷햇_240%');
assert.equal(c1.days[D].margin_total, 72000); assert.equal(c1.days['2025-06-09'].margin_total, 60000); assert.equal(c1.days['2025-06-10'].margin_total, 40000);
const lk = S.marginLookup(d); assert.equal(lk('12340330543', '2025-01-01'), 6000); assert.equal(lk('12340330543', '2025-06-10'), 4000);
S.deleteMargin(d, '12340330543', '2025-06-10'); assert.equal(S.marginLookup(d)('12340330543', '2025-06-10'), 6000);

// 광고 ACTION 메모는 새 값이 비면 유지
S.upsertAds(d, [{ ...ads[0], action: '메모' }]); S.upsertAds(d, [{ ...ads[0], action: '' }]); assert.equal(d.ads[D]['1_버킷햇_240%'].action, '메모');
console.log('extension logic: all checks passed');

// xlsx 리더 + 리포트 가져오기
{
  const { readFileSync } = await import('node:fs');
  const { importSalesFile } = await import('../../extension/lib/importer.js');
  const { fileToRecords, parseCsv } = await import('../../extension/lib/xlsx.js');
  const buf = readFileSync(new URL('./fixtures/sales_2025-06-08.xlsx', import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const recs = await fileToRecords(ab, 'sales_2025-06-08.xlsx');
  assert.equal(recs.length, 7); assert.equal(recs[0]['옵션ID'], 12340330543); assert.equal(recs[0]['매출'], 90000);
  const before = await S.load(); delete before.sales['2025-06-08']; await S.save(before);
  const r = await importSalesFile(ab, '상품별 판매 리포트_20250608.xlsx', null);
  assert.equal(r.date, '2025-06-08'); assert.equal(r.saved, 7);
  const r2 = await importSalesFile(ab, 'report.xlsx', '2025-07-01'); assert.equal(r2.date, '2025-07-01');
  const r3 = await importSalesFile(ab, '판매분석_20250902_130501.xlsx', '2025-09-01'); assert.equal(r3.date, '2025-09-01'); // 다운로드 시각보다 고른 날짜 우선
  const r4 = await importSalesFile(ab, '상품별 판매 리포트_20250901~20250901.xlsx', '2025-09-05'); assert.equal(r4.date, '2025-09-01'); // 기간 표기는 최우선
  const csv = '﻿옵션ID,옵션명,매출,판매량\n"1,234",테스트,"10,000",3\n';
  const crecs = await fileToRecords(new TextEncoder().encode(csv).buffer, 'a.csv'); assert.equal(crecs.length, 1); assert.equal(crecs[0]['옵션명'], '테스트');
  assert.deepEqual(parseCsv('a,"b,c"\n1,2'), [['a', 'b,c'], ['1', '2']]);
  await assert.rejects(importSalesFile(new TextEncoder().encode('아무거나').buffer, 'x.csv'), /찾지 못했습니다/);
  console.log('xlsx import: all checks passed');
}

// 붙여넣기 / 파일 종류 자동 판단
{
  const { pasteToRecords, importAnyFile } = await import('../../extension/lib/importer.js');
  const { readFileSync } = await import('node:fs');
  const txt = '캠페인 이름\t상태\t광고비\t광고전환 매출\t노출수\t클릭수\n1_버킷햇_240%\t운영중\t67,241\t180,000\t51,328\t153\n합계\t\t67,241\t180,000\t51,328\t153\n';
  const recs = pasteToRecords(txt, ['캠페인']); assert.equal(recs.length, 2); assert.equal(recs[0]['광고비'], '67,241');
  const rows = normalizeAds(recs, '2025-06-08'); assert.equal(rows.length, 1); assert.equal(rows[0].spend, 67241);
  const spaced = '캠페인 이름   광고비   노출수\n1_버킷햇_240%   67,241   51,328\n'; assert.equal(pasteToRecords(spaced, ['캠페인'])[0]['노출수'], '51,328');
  assert.deepEqual(pasteToRecords('아무 글자', ['캠페인']), []);
  const buf = readFileSync(new URL('./fixtures/sales_2025-06-08.xlsx', import.meta.url));
  const r = await importAnyFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'x.xlsx', '2025-06-20'); assert.equal(r.kind, 'sales'); assert.equal(r.saved, 7);
  const adsCsv = new TextEncoder().encode('캠페인 이름,광고비,광고전환 매출\n1_버킷햇_240%,"67,241","180,000"\n').buffer;
  const r2 = await importAnyFile(adsCsv, 'ads.csv', '2025-06-21'); assert.equal(r2.kind, 'ads'); assert.equal(r2.saved, 1);
  console.log('paste/any-file import: all checks passed');
}

// 광고센터 목록 형태: '?' 아이콘 섞인 머리글, '305.19% 목표 350%' 칸, '⚠ 10,000원', 행별 날짜
{
  const { parseNumber, firstMatch, normHeader } = await import('../../extension/lib/parse.js');
  assert.equal(parseNumber('⚠ 10,000원'), 10000); assert.equal(parseNumber('2,859원'), 2859); assert.equal(parseNumber('305.19% 목표 350%'), 3.0519);
  const hs = ['캠페인 이름 ↕', 'ON/OFF', '주간 예산 점수 ? (오늘 제외)', '예산 ?', '광고비 효율성 ? 광고수익률', '오늘 누적광고비', '집행 광고비', '주요 결과 ? 광고 전환 매출 ?', '클릭률', '클릭수'].map(normHeader);
  assert.equal(firstMatch(hs, ['광고예산', '일 예산', '예산'], ['점수', '주간']), 3);
  assert.equal(firstMatch(hs, ['집행 광고비', '광고비'], ['오늘', '누적', '효율', '수익률']), 6);
  assert.equal(firstMatch(hs, ['광고전환 매출', '광고 전환 매출'], []), 7);
  assert.equal(firstMatch(hs, ['클릭수', '클릭'], ['률']), 9);
  const rec = { '캠페인 이름 ↕': 'AI 스마트광고 0. 소량 재고', 'ON/OFF': 'ON', '주간 예산 점수 ? (오늘 제외)': '100점', '예산 ?': '⚠ 10,000원', '광고비 효율성 ? 광고수익률': '305.19% 목표 350%', '오늘 누적광고비': '202원', '집행 광고비': '30,964원', '주요 결과 ? 광고 전환 매출 ?': '94,500원', '전환율': '7.8%', '노출수': '51,328', '클릭수': '153', '클릭률': '0.30%', '광고 전환 판매 수': '12' };
  const [r] = normalizeAds([rec], '2026-09-01');
  assert.equal(r.campaign, '0. 소량 재고'); assert.equal(r.target_roas, 3.5); assert.equal(r.budget, 10000); assert.equal(r.spend, 30964); assert.equal(r.ad_revenue, 94500);
  assert.equal(r.conversion, 0.078); assert.equal(r.impressions, 51328); assert.equal(r.clicks, 153); assert.equal(r.ctr, 0.003); assert.equal(r.ad_orders, 12);
  const [r2] = normalizeAds([{ '날짜': '2026-08-30', '캠페인': 'X', '광고비': '1,000' }], '2026-09-01'); assert.equal(r2.date, '2026-08-30');
  const [r3] = normalizeAds([{ '캠페인 이름': '37. 끈나시', '집행 광고비': '28,824원', '종료일': '2026.05.14 종료' }], '2026-09-02'); assert.equal(r3.date, '2026-09-02'); assert.equal(r3.spend, 28824); // 종료일은 날짜 열이 아님
  const [s2] = normalizeSales([{ '일자': '2026.08.30', '옵션ID': '123', '매출': '10', '판매량': '1' }], '2026-09-01'); assert.equal(s2.date, '2026-08-30');
  console.log('ad-center parsing: all checks passed');
}

// 예전 엑셀 장부 가져오기(4번 시트) + 미리보기/적용/되돌리기/삭제 + 자연매출 지표
{
  const { readFileSync } = await import('node:fs');
  const L = await import('../../extension/lib/legacy.js');
  await S.replaceAll({});
  const buf = readFileSync(new URL('./fixtures/legacy_small.xlsx', import.meta.url));
  const parsed = await L.parseLegacyWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'small.xlsx');
  assert.deepEqual([parsed.from, parsed.to, parsed.campaigns.length, parsed.cells, parsed.mapping.length, parsed.marginFrom], ['2025-06-08', '2025-06-08', 2, 2, 3, '2025-06-09']);
  assert.equal(parsed.sales.length, 3); assert.equal(parsed.sales[0].revenue, 90000); assert.equal(parsed.salesFrom, '2025-06-08');
  const b = parsed.legacy['2025-06-08']['1_버킷햇_240%'];
  approx(b.spend_vat, 73965.1); approx(b.spend, 67241, 0.01); approx(b.ad_revenue, 180000, 5); assert.equal(b.actual_qty, 12); assert.equal(b.margin_total, 72000); approx(b.profit, -1965.1);
  let d = await S.load(); assert.deepEqual(L.previewAgainst(d, parsed), { overlapDays: 0, dailyDays: 0, newOptions: 3, changedOptions: 0, salesRows: 3, salesOverwrite: 0 });
  const r = await L.applyLegacy(parsed, { withMapping: true }); d = await S.load();
  assert.equal(r.salesSaved, 3); assert.equal(Object.keys(d.sales['2025-06-08']).length, 3);
  assert.equal(d.options.length, 3); assert.equal(d.margins.length, 3); assert.equal(d.margins[0].effective_from, ''); // 이력 없으면 처음부터
  let led = computeLedger(d, '2025-06-08', '2025-06-08');
  const c1 = led.campaigns.find((c) => c.campaign === '1_버킷햇_240%').days['2025-06-08'];
  assert.equal(c1.legacy, true); approx(c1.profit, -1965.1); assert.equal(c1.actual_qty, 12); assert.equal(c1.organic_qty, 0); approx(c1.roas, 2.6769, 1e-3);
  assert.equal(c1.revenue, 135000); // 3번 시트 매출 (버킷햇 블랙 90,000 + 아이보리 45,000)
  const un = led.campaigns.find((c) => c.campaign === '(캠페인 없음)').days['2025-06-08']; assert.equal(un.revenue, 5000); assert.equal(un.actual_qty, 1); // 매핑 없는 옵션은 자연 판매
  approx(led.total_profit['2025-06-08'], -1965.1 + 64639.2);
  // 엑셀 마지막 날짜(6/8)까지는 엑셀 확정값만 쓴다: 같은 날 ①로 저장한 옵션별 판매는 무시
  S.upsertSales(d, [{ date: '2025-06-08', option_id: '12340330543', option_name: 'x', product_name: '', product_id: '', category: '', sales_type: '', revenue: 100000, orders: 10, quantity: 10, visitors: 0, views: 0, carts: 0, conversion: null }]);
  S.upsertSales(d, [{ date: '2025-06-09', option_id: '12340330543', option_name: 'x', product_name: '', product_id: '', category: '', sales_type: '', revenue: 50000, orders: 5, quantity: 5, visitors: 0, views: 0, carts: 0, conversion: null }]);
  await S.save(d); led = computeLedger(d, '2025-06-08', '2025-06-09');
  const c2 = led.campaigns.find((c) => c.campaign === '1_버킷햇_240%');
  assert.equal(c2.days['2025-06-08'].actual_qty, 12); assert.equal(c2.days['2025-06-08'].margin_total, 72000); assert.equal(c2.days['2025-06-08'].legacy, true); // 엑셀 값 유지
  assert.equal(c2.days['2025-06-08'].revenue, 145000); // 매출은 판매 리포트에서: 블랙 100,000(덮어씀) + 아이보리 45,000 (광고 매출이 더 크면 자연 매출 0)
  assert.equal(c2.days['2025-06-08'].organic_revenue, 0);
  assert.equal(c2.days['2025-06-09'].actual_qty, 5); assert.equal(c2.days['2025-06-09'].margin_total, 30000); assert.equal(c2.days['2025-06-09'].revenue, 50000); // 다음 날부터 확장 데이터
  assert.equal(led.legacyCutoff, '2025-06-08');
  // 되돌리기 → 가져오기 전 상태
  await L.undoImport(r.id); d = await S.load();
  assert.equal(Object.keys(d.legacy).length, 0); assert.equal(d.options.length, 0); assert.equal(d.sales['2025-06-08'], undefined); assert.equal(Object.keys(d.sales).length, 1); assert.equal(d.margins.length, 0); assert.equal(d.imports.length, 0); // 가져온 판매 행은 제거, 테스트가 넣은 6/9 행만 남음
  // 다시 적용 → 장부 값만 삭제
  const r2 = await L.applyLegacy(parsed); const n = await L.removeImportData(r2.id); d = await S.load();
  assert.equal(n, 2); assert.equal(Object.keys(d.legacy).length, 0); assert.equal(d.options.length, 3); assert.equal((await L.listImports()).length, 0);
  // 마진 이력이 이미 있으면 엑셀 다음 날부터 적용
  S.setMargin(d, '12340330543', 5000, ''); await S.save(d); await L.applyLegacy(parsed); d = await S.load();
  assert.deepEqual(S.marginHistory(d, '12340330543').map((m) => [m.effective_from, m.margin]), [['', 5000], ['2025-06-09', 6000]]);
  console.log('legacy sheet4 import: all checks passed');
}

// 종합소득세 추정 (기본: 연봉 1.2억, 배우자 + 2022년생 자녀 1명 → 기본공제 450만, 자녀세액공제는 2030년부터)
{
  const T = await import('../../extension/lib/tax.js');
  assert.equal(T.earnedIncomeDeduction(120000000), 15150000);
  assert.equal(T.basicDeduction(T.DEFAULT_TAX_SETTINGS), 4500000);
  assert.equal(T.childTaxCredit(2026, T.DEFAULT_TAX_SETTINGS), 0); assert.equal(T.childTaxCredit(2030, T.DEFAULT_TAX_SETTINGS), 250000);
  assert.equal(T.childTaxCredit(2030, { childrenBirthYears: [2022, 2020] }), 550000); assert.equal(T.childTaxCredit(2024, { childrenBirthYears: [2010] }), 150000);
  const only = T.computeYearTax(2026, 0);
  assert.equal(only.salaryOnly.base, 104850000 - 4500000); approx(only.salaryOnly.gross, 100350000 * 0.35 - 15440000); approx(only.salaryOnly.earnedCredit, 500000);
  assert.equal(only.bizTax, 0);
  const r = T.computeYearTax(2026, 50000000);
  assert.equal(r.withBiz.base, 154850000 - 4500000); assert.equal(r.deductions, 4500000); assert.equal(r.withBiz.childCredit, 0);
  approx(r.bizTax, r.withBiz.all - only.salaryOnly.all); assert.ok(r.effectiveRate > 0.2 && r.effectiveRate < 0.3);
  approx(r.marginalEffective, 0.38 * 0.5 * 1.1, 1e-9); assert.ok(T.computeYearTax(2026, 50000000, { reliefRate: 100 }).reliefApplied <= 0.65 + 1e-9);
  const r0 = T.computeYearTax(2026, 50000000, { reliefRate: 0 }); assert.ok(r0.bizTax > r.bizTax);
  const single = T.computeYearTax(2026, 50000000, { spouse: false, childrenBirthYears: [] }); assert.ok(single.withBiz.all > r.withBiz.all); assert.equal(single.deductions, 1500000);
  const legacyCfg = T.computeYearTax(2026, 50000000, { deductions: 6000000 }); assert.equal(legacyCfg.deductions, 6000000); // 예전 설정(합계) 호환
  const loss = T.computeYearTax(2026, -3000000); assert.equal(loss.bizTax, 0); assert.equal(loss.netAfterTax, -3000000);
  const mb = T.monthlyBreakdown(2026, { 1: 10000000, 2: 10000000, 3: 30000000 });
  approx(mb[0].tax + mb[1].tax + mb[2].tax, r.bizTax, 1); assert.equal(mb[3].empty, true);
  assert.equal(T.bracketsFor(2022), T.BRACKETS_OLD);
  console.log('tax estimate: all checks passed');
}

// 광고 외 지출: 월에 나눠 반영 / 그 날에 반영, 순이익 차감
{
  await S.replaceAll({});
  const d = await S.load();
  S.upsertOption(d, { option_id: '1', product_name: 'a', campaign: 'C' }); S.setMargin(d, '1', 1000);
  for (let day = 1; day <= 30; day++) S.upsertSales(d, [{ date: `2025-06-${String(day).padStart(2, '0')}`, option_id: '1', option_name: 'a', product_name: '', product_id: '', category: '', sales_type: '', revenue: 10000, orders: 1, quantity: 10, visitors: 0, views: 0, carts: 0, conversion: null }]);
  S.addExpense(d, { date: '2025-06-05', category: '트래픽', amount: 300000, mode: 'month' });   // 30일로 나눠 하루 10,000
  S.addExpense(d, { date: '2025-06-10', category: '마케팅', amount: 50000, mode: 'day' });
  await S.save(d);
  const led = computeLedger(d, '2025-06-01', '2025-06-30');
  assert.equal(led.grand.profit, 300000); assert.equal(led.grand.expense, 350000); assert.equal(led.grand.profit_net, -50000);
  approx(led.daily['2025-06-01'].expense, 10000); approx(led.daily['2025-06-10'].expense, 60000); approx(led.daily['2025-06-10'].profit_net, 10000 - 60000);
  approx(led.month_expense['2025-06'], 350000); approx(led.month_profit_net['2025-06'], -50000);
  const week = computeLedger(d, '2025-06-01', '2025-06-07'); approx(week.grand.expense, 70000); // 월 분배분 7일치
  assert.deepEqual(Object.keys(S.expensesByDay(d, '2025-07-01', '2025-07-31')), []);
  console.log('expenses: all checks passed');
}

// 반품·취소·순 판매
{
  const rows = normalizeSales([{ '옵션ID': '1', '옵션명': 'a', '매출': '10,000', '판매량': '10', '반품 수량': '2', '취소 수량': '1' }, { '옵션ID': '2', '옵션명': 'b', '매출': '5,000', '판매량': '5' }], '2025-06-08');
  assert.equal(rows[0].returns, 2); assert.equal(rows[0].cancels, 1); assert.equal(rows[1].returns, 0); assert.equal(rows[0].quantity, 10);
  const none = normalizeSales([{ '옵션ID': '3', '판매량': '4', '매출': '1' }], '2025-06-08'); assert.equal(none[0].returns, null);
  await S.replaceAll({}); const d = await S.load();
  S.upsertOption(d, { option_id: '1', product_name: 'a', campaign: 'C' }); S.upsertOption(d, { option_id: '2', product_name: 'b', campaign: 'C' }); S.setMargin(d, '1', 1000); S.setMargin(d, '2', 1000);
  S.upsertSales(d, rows); S.upsertAds(d, [{ date: '2025-06-08', campaign: 'C', target_roas: 3, budget: 0, spend: 1000, ad_revenue: 5000, conversion: 0, ctr: 0, impressions: 10, clicks: 2, ad_orders: 4, action: '' }]); await S.save(d);
  const c = computeLedger(d, '2025-06-08', '2025-06-08').campaigns[0].days['2025-06-08'];
  // 실제 판매 수 15(취소 반영 후) + 반품·취소 3 = 총 판매 수 18, 자연 = 18 − 광고 4 = 14
  assert.equal(c.actual_qty, 15); assert.equal(c.returns, 2); assert.equal(c.cancels, 1); assert.equal(c.returns_cancels, 3);
  assert.equal(c.gross_qty, 18); assert.equal(c.organic_qty, 14);
  assert.equal(c.ad_orders + c.organic_qty - c.returns_cancels, c.actual_qty);   // 광고 전환 + 자연 − 반품·취소 = 실제
  // 열이 없을 때: 광고 전환 판매 5, 실제 판매 4 → 반품·취소 1, 자연 0 (사용자 스크린샷의 9/1 사례)
  S.upsertSales(d, [{ date: '2025-06-09', option_id: '1', option_name: 'a', product_name: '', product_id: '', category: '', sales_type: '', revenue: 1, orders: 4, quantity: 4, visitors: 0, views: 0, carts: 0, conversion: null }]);
  S.upsertAds(d, [{ date: '2025-06-09', campaign: 'C', target_roas: 3.5, budget: 0, spend: 1000, ad_revenue: 5000, conversion: 0, ctr: 0, impressions: 10, clicks: 2, ad_orders: 5, action: '' }]); await S.save(d);
  const c9 = computeLedger(d, '2025-06-09', '2025-06-09').campaigns[0].days['2025-06-09'];
  assert.equal(c9.ad_orders, 5); assert.equal(c9.actual_qty, 4); assert.equal(c9.organic_qty, 0); assert.equal(c9.returns_cancels, 1); assert.equal(c9.gross_qty, 5);
  const m = computeLedger(d, '2025-06-08', '2025-06-09').campaigns[0].months['2025-06']; assert.equal(m.returns_cancels, 4); assert.equal(m.gross_qty, 23); // 일별 합

  // 실제 리포트 열 이름: 취소가 음수(-1)로 오고 '총 판매수' 열이 따로 있다
  const real = normalizeSales([{ '옵션 ID': '1', '옵션명': 'a', '매출(원)': '71600', '주문': '4', '판매량': '4', '방문자': '10', '조회': '12', '장바구니': '1', '구매전환율': '0.98%', '아이템위너 비율(%)': '100', '총 매출(원)': '89500', '총 판매수': '5', '총 취소 금액(원)': '-17900', '총 취소된 상품수': '-1', '즉시 취소된 상품수': '0' }], '2025-06-10');
  assert.equal(real[0].quantity, 4); assert.equal(real[0].gross_qty, 5); assert.equal(real[0].cancels, 1); assert.equal(real[0].revenue, 71600); assert.equal(real[0].visitors, 10);
  S.upsertSales(d, real); S.upsertAds(d, [{ date: '2025-06-10', campaign: 'C', target_roas: 3, budget: 0, spend: 1000, ad_revenue: 5000, conversion: 0, ctr: 0, impressions: 10, clicks: 2, ad_orders: 3, action: '' }]); await S.save(d);
  const c10 = computeLedger(d, '2025-06-10', '2025-06-10').campaigns[0].days['2025-06-10'];
  assert.equal(c10.gross_qty, 5); assert.equal(c10.returns_cancels, 1); assert.equal(c10.organic_qty, 2); assert.equal(c10.actual_qty, 4);
  assert.equal(c10.ad_orders + c10.organic_qty - c10.returns_cancels, c10.actual_qty);
  console.log('returns/cancels: all checks passed');
}

// 트래픽 슬롯
{
  await S.replaceAll({}); const d = await S.load();
  S.upsertOption(d, { option_id: '1', product_name: 'a', campaign: 'C' }); S.setMargin(d, '1', 1000);
  for (let day = 1; day <= 10; day++) S.upsertSales(d, [{ date: `2025-06-${String(day).padStart(2, '0')}`, option_id: '1', option_name: 'a', product_name: '', product_id: '', category: '', sales_type: '', revenue: 1000, orders: 1, quantity: 1, visitors: 0, views: 0, carts: 0, conversion: null }]);
  S.addTraffic(d, { campaign: 'C', start: '2025-06-03', end: '2025-06-05', slots: 2, memo: '테스트' });
  S.addTraffic(d, { campaign: 'C', start: '2025-06-05', end: '', slots: 1 });   // 진행 중 (겹치는 5일은 3슬롯)
  await S.save(d);
  assert.equal(S.trafficSlots(d, 'C', '2025-06-02'), 0); assert.equal(S.trafficSlots(d, 'C', '2025-06-03'), 2); assert.equal(S.trafficSlots(d, 'C', '2025-06-05'), 3); assert.equal(S.trafficSlots(d, 'C', '2025-07-01'), 1);
  assert.deepEqual(S.trafficStatus(d, 'C', '2025-06-10'), { slots: 1, since: '2025-06-05', memo: '' }); assert.equal(S.trafficStatus(d, 'X', '2025-06-10'), null);
  const led = computeLedger(d, '2025-06-01', '2025-06-30'); const c = led.campaigns[0];
  assert.equal(c.days['2025-06-02'].traffic_slots, 0); assert.equal(c.days['2025-06-04'].traffic_slots, 2); assert.equal(c.days['2025-06-05'].traffic_slots, 3);
  assert.equal(c.days['2025-06-20'].traffic_slots, 1); // 판매 데이터 없는 날도 트래픽은 표시
  assert.equal(c.months['2025-06'].traffic_slots, 3);
  S.deleteTraffic(d, d.traffic[0].id); assert.equal(S.trafficSlots(d, 'C', '2025-06-04'), 0);
  console.log('traffic slots: all checks passed');
}

// 트래픽 효과 계산
{
  const T = await import('../../extension/lib/traffic.js');
  await S.replaceAll({}); const d = await S.load();
  S.upsertOption(d, { option_id: '1', product_name: 'a', campaign: 'C' }); S.setMargin(d, '1', 1000);
  for (let day = 1; day <= 20; day++) { const date = `2025-06-${String(day).padStart(2, '0')}`; const q = day > 10 ? 8 : 4;   // 6/11 부터 트래픽, 판매 2배
    S.upsertSales(d, [{ date, option_id: '1', option_name: 'a', product_name: '', product_id: '', category: '', sales_type: '', revenue: q * 1000, orders: q, quantity: q, visitors: 0, views: 0, carts: 0, conversion: null }]);
    S.upsertAds(d, [{ date, campaign: 'C', target_roas: 3, budget: 0, spend: 100, ad_revenue: 1000, conversion: 0, ctr: 0, impressions: 10, clicks: 2, ad_orders: 1, action: '' }]); }
  S.addTraffic(d, { campaign: 'C', start: '2025-06-11', end: '', slots: 2 }); await S.save(d);
  const led = computeLedger(d, '2025-06-01', '2025-06-20');
  const [e] = T.campaignEffects(led, d.traffic);
  assert.equal(e.on.days, 10); assert.equal(e.off.days, 10); assert.equal(e.on.organic_qty, 7); assert.equal(e.off.organic_qty, 3); approx(e.delta.organic_qty, 4 / 3, 1e-9);
  assert.equal(e.bySlot['2'].days, 10);
  const ba = T.beforeAfter(computeLedger(d), 'C', d.traffic[0]);
  assert.equal(ba.n, 10); assert.equal(ba.beforeFrom, '2025-06-01'); assert.equal(ba.afterTo, '2025-06-20'); assert.equal(ba.before.days, 10); assert.equal(ba.after.days, 10); // 데이터가 있는 마지막 날(6/20)까지만
  const ba2 = T.beforeAfter(computeLedger(d), 'C', d.traffic[0], 14, '2025-06-20'); assert.equal(ba2.n, 10); assert.equal(ba2.beforeFrom, '2025-06-01'); assert.equal(ba2.afterTo, '2025-06-20'); assert.equal(ba.before.organic_qty, 3); assert.equal(ba.after.organic_qty, 7); assert.equal(ba.before.revenue, 4000); assert.equal(ba.after.revenue, 8000);
  assert.equal(T.campaignEffects(led, []).length, 0);
  console.log('traffic effect: all checks passed');
}

// 데이터 점검 (저장은 됐는데 화면에 안 보이는 이유)
{
  const C = await import('../../extension/lib/check.js');
  await S.replaceAll({}); const d = await S.load();
  S.upsertOption(d, { option_id: '1', product_name: 'a', campaign: 'C' }); S.setMargin(d, '1', 1000);
  const sale = (date, id, q) => S.upsertSales(d, [{ date, option_id: id, option_name: 'a', product_name: '', product_id: '', category: '', sales_type: '', revenue: q * 3000, orders: q, quantity: q, visitors: 0, views: 0, carts: 0, conversion: null }]);
  const ad = (date, spend) => S.upsertAds(d, [{ date, campaign: 'C', target_roas: 3, budget: 1000, spend, ad_revenue: spend * 3, conversion: 0, ctr: 0, impressions: 10, clicks: 2, ad_orders: 1, action: '' }]);
  sale('2025-06-10', '1', 3); ad('2025-06-10', 1000);
  const r1 = C.dataCheck(d, '2025-06-01', '2025-06-30', '2025-06-10', 14);
  const day = r1.rows.find((x) => x.date === '2025-06-10');
  assert.equal(day.salesRows, 1); assert.equal(day.adsRows, 1); assert.equal(day.qty, 3); assert.equal(day.inRange, true); assert.equal(day.excelOnly, false);
  approx(day.spend_vat, 1100, 1e-6); assert.equal(day.noMargin, 0); assert.equal(day.noCampaign, 0);
  assert.equal(r1.issues.length, 0);
  assert.equal(r1.rows.length, 14); assert.equal(r1.rows[0].date, '2025-05-28');

  // 기간 밖에 저장된 데이터
  const r2 = C.dataCheck(d, '2025-06-01', '2025-06-09', '2025-06-10', 14);
  assert.equal(r2.issues.filter((i) => i.type === 'outOfRange')[0].date, '2025-06-10');
  assert.equal(C.lastDataDate(d), '2025-06-10');
  assert.equal(C.endRef(d, '2025-06-05'), '2025-06-10');   // 데이터가 어제보다 뒤면 그 날까지
  assert.equal(C.endRef(d, '2025-06-20'), '2025-06-20');

  // 마진·캠페인 없는 옵션
  sale('2025-06-10', '9', 2);
  const r3 = C.dataCheck(d, '2025-06-01', '2025-06-30', '2025-06-10', 14);
  assert.equal(r3.rows.find((x) => x.date === '2025-06-10').noMargin, 2);
  assert.equal(r3.rows.find((x) => x.date === '2025-06-10').noCampaign, 2);
  assert.equal(r3.issues.filter((i) => i.type === 'noMargin')[0].qty, 2);

  // 광고비 0 으로 저장된 날
  ad('2025-06-10', 0);
  assert.equal(C.dataCheck(d, '2025-06-01', '2025-06-30', '2025-06-10', 14).issues.filter((i) => i.type === 'zeroSpend')[0].date, '2025-06-10');
  ad('2025-06-10', 1000);

  // 엑셀 확정 구간이면 새 데이터가 무시된다
  d.legacy = { '2025-06-12': { C: { spend_vat: 100, actual_qty: 1, margin_total: 100 } } }; await S.save(d);
  const r4 = C.dataCheck(d, '2025-06-01', '2025-06-30', '2025-06-12', 14);
  assert.equal(r4.cutoff, '2025-06-12');
  const ex = r4.issues.filter((i) => i.type === 'excelOnly')[0];
  assert.equal(ex.cutoff, '2025-06-12'); assert.equal(ex.days, 1); assert.equal(ex.from, '2025-06-10');
  assert.equal(r4.rows.find((x) => x.date === '2025-06-10').excelOnly, true);
  console.log('data check: all checks passed');
}

// 광고 저장: 성과 숫자가 모두 0 인 새 값이 이미 있는 숫자를 덮어쓰지 않는다 (덜 채워진 화면을 읽은 경우)
{
  await S.replaceAll({}); const d = await S.load();
  const row = (spend, imp, target = 3, budget = 50000) => ({ date: '2025-06-08', campaign: 'C', target_roas: target, budget, spend, ad_revenue: spend * 3, conversion: 0, ctr: 0, impressions: imp, clicks: imp / 10, ad_orders: spend ? 2 : 0, action: '' });
  S.upsertAds(d, [row(16490, 32058)]);
  S.upsertAds(d, [row(0, 0, 4.95, 60000)]);                 // 성과 0, 설정값만 바뀐 읽기
  const c = d.ads['2025-06-08'].C;
  assert.equal(c.spend, 16490); assert.equal(c.impressions, 32058);   // 숫자는 유지
  assert.equal(c.target_roas, 4.95); assert.equal(c.budget, 60000);   // 설정값은 새 값
  S.upsertAds(d, [row(17778, 27973)]);                      // 진짜 새 숫자는 덮어쓴다
  assert.equal(d.ads['2025-06-08'].C.spend, 17778);
  S.upsertAds(d, [{ ...row(0, 0), campaign: 'N' }]);        // 처음부터 0 인 캠페인은 그대로 저장
  assert.equal(d.ads['2025-06-08'].N.spend, 0);
  console.log('ads no-downgrade: all checks passed');
}

// 광고 보고서 (키워드·옵션별) 해석과 집계
{
  const AR = await import('../../extension/lib/adreport.js');
  const { importAnyFile } = await import('../../extension/lib/importer.js');
  const H = ['날짜', '캠페인명', '광고그룹', '광고집행 옵션ID', '광고집행 상품명', '광고 노출 지면', '키워드', '노출수', '클릭수', '광고비', '클릭률', '총 주문수(1일)', '총 판매수량(1일)', '총 전환매출액(1일)', '총 광고수익률(1일)', '총 주문수(14일)', '총 판매수량(14일)', '총 전환매출액(14일)', '총 광고수익률(14일)'];
  assert.equal(AR.isAdReport(H), true);
  assert.equal(AR.isAdReport(['옵션 ID', '옵션명', '매출(원)', '판매량']), false);   // 판매 리포트
  assert.equal(AR.isAdReport(['캠페인 이름', '집행 광고비', '노출수', '클릭수']), false); // 캠페인 목록 (키워드/옵션 열 없음)
  const rec = (date, kw, opt, imp, clk, spend, o1, r1, o14, r14) => Object.fromEntries(H.map((h, i) => [h, [date, '22. 마우스패드', '그룹', opt, 'DUGN 마우스패드 ' + opt, '검색', kw, imp, clk, spend, '', o1, o1, r1, '', o14, o14, r14, ''][i]]));
  const records = [
    rec('2026-09-01', '마우스패드', '94602333981', '1,000', '20', '10,000', 1, 20000, 2, 40000),
    rec('2026-09-01', '손목마우스패드', '94602333981', '500', '10', '8,000', 0, 0, 1, 15000),
    rec('2026-09-01', '구름마우스패드', '95600446021', '300', '6', '6,000', 0, 0, 0, 0),
    rec('2026-09-02', '마우스패드', '94602333981', '900', '18', '9,000', 1, 20000, 1, 20000),
    { ...rec('2026-09-02', '', '', 0, 0, 0, 0, 0, 0, 0), '캠페인명': '합계' },
  ];
  const rows = AR.normalizeAdReport(records);
  assert.equal(rows.length, 4); assert.equal(rows[0].date, '2026-09-01'); assert.equal(rows[0].keyword, '마우스패드'); assert.equal(rows[0].option_id, '94602333981');
  assert.equal(rows[0].impressions, 1000); assert.equal(rows[0].spend, 10000); assert.equal(rows[0].orders14, 2); assert.equal(rows[0].revenue14, 40000); approx(rows[0].roas14, 4, 1e-9); approx(rows[0].ctr, 0.02, 1e-9);
  await S.replaceAll({}); const d = await S.load();
  assert.equal(S.upsertAdRows(d, rows), 4); await S.save(d);
  const sel = AR.selectRows(d, { from: '2026-09-01', to: '2026-09-02', campaign: '22. 마우스패드' }); assert.equal(sel.length, 4);
  const kws = AR.byKeyword(sel).sort((a, b) => b.spend - a.spend);
  assert.equal(kws[0].key, '마우스패드'); assert.equal(kws[0].spend, 19000); assert.equal(kws[0].orders, 3); assert.equal(kws[0].impressions, 1900); approx(kws[0].roas, 60000 / 19000, 1e-9); approx(kws[0].cpc, 19000 / 38, 1e-9);
  const opts = AR.byOption(sel); assert.equal(opts.length, 2); assert.equal(opts.find((o) => o.key === '94602333981').orders, 4);
  const days = AR.byDate(sel); assert.deepEqual(days.map((x) => x.key), ['2026-09-01', '2026-09-02']); assert.equal(days[0].spend, 24000);
  const t = AR.total(sel); assert.equal(t.spend, 33000); assert.equal(t.revenue, 75000);
  const cand = AR.excludeCandidates(sel, { minSpend: 5000, maxRoas: 1 }); assert.deepEqual(cand.map((k) => k.key), ['구름마우스패드']);
  // 키워드 '-' = 검색어 없이 노출된 광고 → NO_KEYWORD 로 묶이고 제외 후보에서 빠진다
  const dash = AR.normalizeAdReport([rec('2026-09-01', '-', '94602333981', '5000', '50', '30000', 0, 0, 0, 0)]);
  assert.equal(dash[0].keyword, ''); assert.equal(AR.byKeyword(dash)[0].key, AR.NO_KEYWORD);
  assert.equal(AR.excludeCandidates(dash, { minSpend: 1000, maxRoas: 1 }).length, 0);
  // 같은 날짜·캠페인은 새 파일로 통째로 교체, 다른 캠페인 행은 유지
  S.upsertAdRows(d, [{ ...rows[0], campaign: '30. 보냉가방', keyword: '보냉가방' }]);
  S.upsertAdRows(d, [{ ...rows[0], spend: 1 }]);   // 22. 마우스패드 9/1 을 1행으로 교체
  assert.equal(d.adrows['2026-09-01'].filter((r) => r.campaign === '22. 마우스패드').length, 1);
  assert.equal(d.adrows['2026-09-01'].filter((r) => r.campaign === '30. 보냉가방').length, 1);
  // 제외 키워드 담기
  assert.equal(S.addExclude(d, '22. 마우스패드', '구름마우스패드'), true); assert.equal(S.addExclude(d, '22. 마우스패드', '구름마우스패드'), false);
  S.markExcludesSynced(d, '22. 마우스패드', ['구름마우스패드']); assert.equal(d.excludes['22. 마우스패드'][0].synced, true);
  S.removeExclude(d, '22. 마우스패드', '구름마우스패드'); assert.equal(d.excludes['22. 마우스패드'].length, 0);
  // importAnyFile 이 광고 보고서를 알아본다 (CSV)
  const csv = H.join(',') + '\n' + ['2026-09-03', '22. 마우스패드', '그룹', '94602333981', '마우스패드 올리브', '검색', '마우스패드', 100, 5, 3000, '5%', 0, 0, 0, '0%', 1, 1, 20000, '667%'].join(',');
  await S.replaceAll({});
  const r = await importAnyFile(new TextEncoder().encode(csv).buffer, 'report.csv', null);
  assert.equal(r.kind, 'adreport'); assert.equal(r.saved, 1); assert.equal(r.date, '2026-09-03');
  const d2 = await S.load(); assert.equal(d2.adrows['2026-09-03'][0].keyword, '마우스패드'); approx(d2.adrows['2026-09-03'][0].roas14, 6.67, 0.01);
  console.log('ad report: all checks passed');
}

// 노출 영역(검색/비검색) 집계, CPM·전환당비용·객단가, 마진
{
  const AR = await import('../../extension/lib/adreport.js');
  const mk = (date, area, kw, opt, imp, clk, spend, o, rev) => ({ date, campaign: 'C', group: '', option_id: opt, product_name: '', placement: area, keyword: kw, impressions: imp, clicks: clk, spend, ctr: 0, orders1: o, qty1: o, revenue1: rev, roas1: 0, orders14: o, qty14: o, revenue14: rev, roas14: 0 });
  const rows = [mk('2026-09-12', '검색 영역', '크로스백', '1', 4, 1, 206, 0, 0), mk('2026-09-12', '비검색 영역', '', '1', 30000, 100, 11000, 0, 0), mk('2026-09-13', '비검색 영역', '', '1', 46227, 188, 40002, 2, 53800), mk('2026-09-13', '', '', '2', 10, 1, 100, 0, 0)];
  assert.equal(AR.areaOf(rows[0]), '검색'); assert.equal(AR.areaOf(rows[1]), '비검색'); assert.equal(AR.areaOf(rows[3]), '비검색');   // 지면 없고 키워드 없음 → 비검색
  assert.equal(AR.areaOf({ placement: '', keyword: '가방' }), '검색');
  const areas = AR.byArea(rows); assert.deepEqual(areas.map((a) => a.key), ['검색', '비검색']);
  const ns = areas[1]; assert.equal(ns.impressions, 76237); assert.equal(ns.spend, 51102); assert.equal(ns.orders, 2); assert.equal(ns.revenue, 53800);
  approx(ns.cpm, 51102 / 76237 * 1000, 1e-6); approx(ns.cpa, 25551, 1e-6); approx(ns.aov, 26900, 1e-6); approx(ns.roas, 53800 / 51102, 1e-9);
  const t = AR.total(rows); assert.equal(t.spend, 51308); approx(t.cpa, 25654, 1e-6);
  const days = AR.byDateArea(rows, AR.dateList('2026-09-11', '2026-09-13'));
  assert.equal(days.length, 3); assert.equal(days[0].합계.spend, 0); assert.equal(days[1].검색.spend, 206); assert.equal(days[2].비검색.revenue, 53800); approx(days[2].합계.roas, 53800 / 40102, 1e-9);
  const marginFn = (id) => (id === '1' ? 10000 : 0);
  assert.equal(AR.marginOf(rows, marginFn), 2 * 10000 - 51308);            // 판매 2개 × 1만 − 광고비
  assert.equal(AR.marginOf(rows.filter((r) => AR.areaOf(r) === '검색'), marginFn), -206);
  assert.deepEqual(AR.dateList('2026-08-30', '2026-09-01'), ['2026-08-30', '2026-08-31', '2026-09-01']);
  console.log('area stats: all checks passed');
}

// ---- 캠페인 이름 정리: 배지('AI 스마트광고', '오늘의 Pick')와 마우스 올리면 나오는 '수정 삭제' 버튼 글자 제거 ----
{
  const { cleanCampaignName } = await import('../../extension/lib/parse.js');
  assert.equal(cleanCampaignName('AI 스마트광고 0. 소량 재고 및 광고 안 도는 것들'), '0. 소량 재고 및 광고 안 도는 것들');
  assert.equal(cleanCampaignName('AI스마트광고0. 소량 재고'), '0. 소량 재고');
  assert.equal(cleanCampaignName('오늘의 Pick31. 피크닉매트_260402 수정 삭제'), '31. 피크닉매트_260402');
  assert.equal(cleanCampaignName('31. 피크닉매트_260402 수정 삭제'), '31. 피크닉매트_260402');
  assert.equal(cleanCampaignName('52. 똑딱이 담요_300%_260915'), '52. 똑딱이 담요_300%_260915');
  assert.equal(cleanCampaignName('37. 끈나시 캡브라'), '37. 끈나시 캡브라');   // 이름 끝 글자가 버튼 단어로 끝나지 않으면 그대로
  const d = { ...S.EMPTY ? S.EMPTY() : {}, options: [{ option_id: '1', campaign: '31. 피크닉매트_260402 수정 삭제' }], margins: [], sales: {}, legacy: {}, imports: [], expenses: [], traffic: [], excludes: { '오늘의 Pick31. 피크닉매트_260402': [{ keyword: 'a' }] }, adrows: {},
    ads: { '2026-09-16': { '31. 피크닉매트_260402 수정 삭제': { campaign: '31. 피크닉매트_260402 수정 삭제', spend: 100, ad_revenue: 500 }, '31. 피크닉매트_260402': { campaign: '31. 피크닉매트_260402', spend: 0, ad_revenue: 0 }, '37. 끈나시 캡브라': { campaign: '37. 끈나시 캡브라', spend: 5 } } },
    campaignOptions: { 'AI 스마트광고 0. 소량': { at: '2026-09-01', options: [] }, '0. 소량': { at: '2026-09-10', options: [{ option_id: '9', name: 'x' }] } } };
  assert.equal(S.cleanCampaignNames(d), true);
  assert.deepEqual(Object.keys(d.ads['2026-09-16']).sort(), ['31. 피크닉매트_260402', '37. 끈나시 캡브라']);
  assert.equal(d.ads['2026-09-16']['31. 피크닉매트_260402'].spend, 100);      // 숫자 있는 쪽이 남는다
  assert.equal(d.ads['2026-09-16']['31. 피크닉매트_260402'].campaign, '31. 피크닉매트_260402');
  assert.equal(d.options[0].campaign, '31. 피크닉매트_260402');
  assert.deepEqual(Object.keys(d.campaignOptions), ['0. 소량']); assert.equal(d.campaignOptions['0. 소량'].at, '2026-09-10');
  assert.deepEqual(Object.keys(d.excludes), ['31. 피크닉매트_260402']);
  assert.equal(S.cleanCampaignNames(d), false);
  console.log('campaign name clean: all checks passed');
}

// ---- 캠페인 상태(운영·중단·삭제), 옵션을 최근 캠페인으로 옮기기, 장부의 '(광고 없는 판매)' 줄 ----
{
  const { ORGANIC, UNMAPPED } = await import('../../extension/lib/ledger.js');
  const ad = (campaign, spend) => ({ campaign, spend, ad_revenue: spend * 3, impressions: 100, clicks: 10, ad_orders: 1, target_roas: 3, budget: 10000, conversion: 0.1, ctr: 0.1 });
  const d = { ...S.EMPTY ? S.EMPTY() : {}, margins: [{ option_id: 'A', effective_from: '', margin: 1000 }, { option_id: 'B', effective_from: '', margin: 500 }], legacy: {}, imports: [], expenses: [], traffic: [], excludes: {}, relinks: [],
    options: [{ option_id: 'A', product_name: 'a', campaign: '3. 담요', sort_order: 1 }, { option_id: 'B', product_name: 'b', campaign: '5. 커튼', sort_order: 2 }, { option_id: 'C', product_name: 'c', campaign: '', sort_order: 3 }],
    ads: {
      '2026-09-01': { '3. 담요': ad('3. 담요', 1000), '5. 커튼': ad('5. 커튼', 800) },
      '2026-09-10': { '3. 담요': ad('3. 담요', 1000), '5. 커튼': ad('5. 커튼', 0), '52. 담요': ad('52. 담요', 0) },
      '2026-09-11': { '5. 커튼': ad('5. 커튼', 0), '52. 담요': ad('52. 담요', 2000) },
    },
    sales: {
      '2026-09-09': { A: { option_id: 'A', quantity: 2, revenue: 20000 } },                       // 광고 목록 없는 날 → 연결대로
      '2026-09-10': { A: { option_id: 'A', quantity: 3, revenue: 30000 }, B: { option_id: 'B', quantity: 1, revenue: 5000 } },
      '2026-09-11': { A: { option_id: 'A', quantity: 4, revenue: 40000 }, B: { option_id: 'B', quantity: 2, revenue: 9000 }, C: { option_id: 'C', quantity: 1, revenue: 1000 } },
    },
    adrows: { '2026-09-11': [{ date: '2026-09-11', campaign: '52. 담요', option_id: 'A', spend: 2000, impressions: 50, clicks: 5, orders14: 1, revenue14: 6000, keyword: 'x' }] },
    campaignOptions: {} };
  const st = S.campaignStatus(d);
  assert.deepEqual(st, { '3. 담요': 'deleted', '5. 커튼': 'paused', '52. 담요': 'running' });
  assert.equal(S.isRunning({}, '무엇이든'), true);
  // 장부: 9/10 A 는 3번(그날 광고비 있음), 9/11 A 는 보고서대로 52번, B 는 5번이 광고비 0 → '(광고 없는 판매)', C 는 '(캠페인 없음)'
  const led0 = computeLedger(d, '2026-09-09', '2026-09-11'); const row = (n) => led0.campaigns.find((c) => c.campaign === n);
  assert.equal(row('3. 담요').days['2026-09-09'].actual_qty, 2);
  assert.equal(row('3. 담요').days['2026-09-10'].actual_qty, 3);
  assert.equal(row('52. 담요').days['2026-09-11'].actual_qty, 4);
  assert.equal(row(ORGANIC).days['2026-09-10'].actual_qty, 1); assert.equal(row(ORGANIC).days['2026-09-11'].actual_qty, 2);
  assert.equal(row(ORGANIC).days['2026-09-11'].margin_total, 1000);   // 광고 없이 팔린 마진 = 2 × 500
  assert.equal(row(UNMAPPED).days['2026-09-11'].actual_qty, 1);
  assert.deepEqual(led0.campaigns.map((c) => c.campaign).slice(-2), [ORGANIC, UNMAPPED]);
  // 옮기기: A 는 삭제된 3번 → 운영 중인 52번(보고서 근거). B 는 근거 없음 → 그대로
  const moved = S.relinkOptions(d);
  assert.deepEqual(moved.map((m) => [m.option_id, m.from, m.to]), [['A', '3. 담요', '52. 담요']]);
  assert.equal(d.options[0].campaign, '52. 담요'); assert.equal(d.options[1].campaign, '5. 커튼'); assert.equal(d.relinks.length, 1);
  assert.deepEqual(S.relinkOptions(d), []);
  // 옮긴 뒤에도 예전 캠페인(3번)이 광고비를 쓴 날의 판매는 3번 줄에 남는다
  const led1 = computeLedger(d, '2026-09-09', '2026-09-11'); const row1 = (n) => led1.campaigns.find((c) => c.campaign === n);
  assert.equal(row1('3. 담요').days['2026-09-10'].actual_qty, 3); assert.equal(row1('52. 담요').days['2026-09-11'].actual_qty, 4);
  assert.deepEqual(led1.noad_options.map((n) => [n.option_id, n.qty, n.margin]), [['B', 3, 500], ['C', 1, 0]]);
  // 두 운영 캠페인이 같은 옵션을 광고하면 지금 연결 유지
  d.ads['2026-09-11']['3. 담요'] = ad('3. 담요', 500); d.options[0].campaign = '3. 담요';
  d.adrows['2026-09-11'].push({ date: '2026-09-11', campaign: '3. 담요', option_id: 'A', spend: 500, keyword: 'y' });
  assert.deepEqual(S.relinkOptions(d), []); assert.equal(d.options[0].campaign, '3. 담요');
  // 광고 목록을 한 번도 안 읽었으면 아무것도 안 옮김
  assert.deepEqual(S.relinkOptions({ ...d, ads: {} }), []);
  console.log('campaign status/relink/organic: all checks passed');
}

// ---- 규칙으로 못 떼는 이름도, 번호로 시작하는 다른 캠페인 이름을 품고 있으면 그 이름으로 합친다 ----
{
  const d = { options: [], margins: [], sales: {}, legacy: {}, imports: [], expenses: [], traffic: [], excludes: {}, adrows: {}, campaignOptions: {},
    ads: { '2026-09-16': { '오늘의 Pick31. 피크닉매트_260402': { campaign: '오늘의 Pick31. 피크닉매트_260402', spend: 92460, impressions: 74242 }, '31. 피크닉매트_260402': { campaign: '31. 피크닉매트_260402', spend: 0 }, '31. 피크닉매트_260402 수정 삭제': { campaign: '31. 피크닉매트_260402 수정 삭제', spend: 0 }, '베스트31. 피크닉매트_260402': { campaign: '베스트31. 피크닉매트_260402', spend: 0 }, '5. 자석 커튼끈_239%': { campaign: '5. 자석 커튼끈_239%', spend: 10 } } } };
  assert.equal(S.cleanCampaignNames(d), true);
  assert.deepEqual(Object.keys(d.ads['2026-09-16']).sort(), ['31. 피크닉매트_260402', '5. 자석 커튼끈_239%']);
  assert.equal(d.ads['2026-09-16']['31. 피크닉매트_260402'].spend, 92460);
  assert.equal(S.cleanCampaignNames(d), false);
  console.log('campaign name merge by containment: all checks passed');
}

// ---- 기록하지 않을 판매(재판매·리퍼): 옵션ID 무시 + 단어 무시 → 장부·목록에서 빠짐 ----
{
  const d = { options: [{ option_id: 'A', product_name: 'a', campaign: '', sort_order: 1 }], margins: [], legacy: {}, imports: [], expenses: [], traffic: [], excludes: {}, adrows: {}, campaignOptions: {}, ads: {}, ignore: { ids: ['X1'], words: ['재판매'] },
    sales: { '2026-09-16': { A: { option_id: 'A', option_name: 'a', quantity: 2, revenue: 2000 }, X1: { option_id: 'X1', option_name: 'x', quantity: 5, revenue: 500 }, X2: { option_id: 'X2', option_name: '담요 (재판매)', product_name: '담요', quantity: 3, revenue: 300 }, Y: { option_id: 'Y', option_name: 'y', product_name: 'yy', quantity: 1, revenue: 100 } } } };
  const led = computeLedger(d, '2026-09-16', '2026-09-16');
  assert.equal(led.ignored_qty, 8); assert.equal(led.grand.actual_qty, 3);                       // A 2개 + Y 1개만
  assert.deepEqual(S.unlistedSoldOptions(d, '2026-09-01').map((x) => x.option_id), ['Y']);
  assert.deepEqual(S.ignoredSoldOptions(d, '2026-09-01').map((x) => [x.option_id, x.byId]), [['X1', true], ['X2', false]]);
  S.ignoreOption(d, 'X1', false); assert.deepEqual(d.ignore.ids, []); S.ignoreOption(d, 'Y'); assert.deepEqual(d.ignore.ids, ['Y']);
  S.setIgnoreWords(d, [' 리퍼 ', '', '재판매', '리퍼']); assert.deepEqual(d.ignore.words, ['리퍼', '재판매']);
  console.log('ignore rules: all checks passed');
}

// ---- 광고 보고서·광고센터에 나온 옵션 자동 등록 (운영 중 캠페인만) ----
{
  const ad = (campaign, spend) => ({ campaign, spend, ad_revenue: 0, impressions: 1, clicks: 0, ad_orders: 0 });
  const d = { options: [{ option_id: 'A', product_name: 'a', campaign: '52. 담요', sort_order: 1 }], margins: [], sales: {}, legacy: {}, imports: [], expenses: [], traffic: [], excludes: {},
    ads: { '2026-09-19': { '52. 담요': ad('52. 담요', 100), '3. 옛것': ad('3. 옛것', 0) }, '2026-09-10': { '3. 옛것': ad('3. 옛것', 50) } },
    adrows: { '2026-09-19': [{ date: '2026-09-19', campaign: '52. 담요', option_id: 'B', product_name: '담요 B', spend: 10 }, { date: '2026-09-19', campaign: '52. 담요', option_id: 'A', spend: 5 }, { date: '2026-09-19', campaign: '3. 옛것', option_id: 'Z', product_name: 'z', spend: 0 }] },
    campaignOptions: { '52. 담요': { at: '2026-09-19', options: [{ option_id: 'C', name: '담요 C' }, { option_id: 'B', name: '담요 B2' }] } } };
  const added = S.autoAddOptions(d);
  assert.deepEqual(added.map((x) => [x.option_id, x.campaign, x.name]).sort(), [['B', '52. 담요', '담요 B'], ['C', '52. 담요', '담요 C']]);   // Z 는 중단된 3번 → 안 넣음
  assert.equal(d.options.length, 3); assert.equal(d.options.find((o) => o.option_id === 'C').source, 'adreport');
  assert.deepEqual(S.autoAddOptions(d), []);
  console.log('auto add options: all checks passed');
}

// ---- 제로 ROAS 계산 + 최근 N일 효율 점검 ----
{
  const ad = (campaign, spend, rev, target) => ({ campaign, spend, ad_revenue: rev, impressions: 100, clicks: 10, ad_orders: 1, target_roas: target });
  const d = { options: [{ option_id: 'A', product_name: 'a', campaign: '1. 좋음', sort_order: 1 }, { option_id: 'B', product_name: 'b', campaign: '2. 나쁨', sort_order: 2 }, { option_id: 'C', product_name: 'c', campaign: '3. 모름', sort_order: 3 }],
    margins: [{ option_id: 'A', effective_from: '', margin: 5000 }, { option_id: 'B', effective_from: '', margin: 5000 }], legacy: {}, imports: [], expenses: [], traffic: [], excludes: {}, adrows: {}, campaignOptions: {}, zeroRoas: {},
    sales: { '2026-09-18': { A: { option_id: 'A', quantity: 2, revenue: 40000 }, B: { option_id: 'B', quantity: 2, revenue: 40000 }, C: { option_id: 'C', quantity: 1, revenue: 10000 } } },
    ads: { '2026-09-17': { '1. 좋음': ad('1. 좋음', 1000, 10000, 3), '2. 나쁨': ad('2. 나쁨', 1000, 3000, 3), '3. 모름': ad('3. 모름', 1000, 5000, 3), '4. 쉼': ad('4. 쉼', 0, 0, 3) },
           '2026-09-18': { '1. 좋음': ad('1. 좋음', 1000, 10000, 3), '2. 나쁨': ad('2. 나쁨', 1000, 3000, 3), '3. 모름': ad('3. 모름', 1000, 5000, 3), '4. 쉼': ad('4. 쉼', 0, 0, 3) },
           '2026-09-19': { '1. 좋음': ad('1. 좋음', 1000, 10000, 3), '2. 나쁨': ad('2. 나쁨', 1000, 3000, 3), '3. 모름': ad('3. 모름', 1000, 5000, 3), '4. 쉼': ad('4. 쉼', 0, 0, 3) } } };
  const z = S.computeZeroRoas(d, '1. 좋음', '2026-09-01');            // 판매가 20,000 · 마진 5,000 → 제로 = 20,000×1.1/5,000 = 4.4
  assert.equal(Math.round(z.zero * 100), 440); assert.equal(z.price, 20000);
  assert.equal(S.computeZeroRoas(d, '3. 모름', '2026-09-01').zero, null);   // 마진 없음
  const r = S.roasCheck(d, 3); assert.deepEqual(r.dates, ['2026-09-17', '2026-09-18', '2026-09-19']);
  const by = Object.fromEntries(r.rows.map((x) => [x.campaign, x]));
  assert.equal(by['1. 좋음'].status, 'blue'); assert.equal(Math.round(by['1. 좋음'].roas * 100), 1000);   // 10 ≥ 4.4×1.5
  assert.equal(by['2. 나쁨'].status, 'red'); assert.ok(by['2. 나쁨'].note.includes('440%'));
  assert.equal(by['3. 모름'].status, 'unknown'); assert.equal(by['4. 쉼'].status, 'idle');
  assert.deepEqual(r.rows.map((x) => x.campaign), ['2. 나쁨', '3. 모름', '1. 좋음', '4. 쉼']);     // 조정 필요 → 모름 → 적정 → 여유 → 쉼
  assert.equal(Math.round(by['1. 좋음'].profit), Math.round(30000 / 4.4 - 3000 * 1.1));
  S.setZeroRoas(d, '3. 모름', 2.0); const r2 = S.roasCheck(d, 3); const m = r2.rows.find((x) => x.campaign === '3. 모름');
  assert.equal(m.status, 'blue'); assert.equal(m.zeroSource, 'manual');          // 5.0 ≥ 2.0×1.5
  S.setZeroRoas(d, '3. 모름', null); assert.deepEqual(d.zeroRoas, {});
  console.log('zero roas / roas check: all checks passed');
}

// ---- 시즌/비시즌 모드 + 직전 기간 비교(목표 ROAS 변경 효과) ----
{
  assert.deepEqual([S.roasBand(null, '2026-09-20').min, S.roasBand({ mode: 'off' }, '2026-09-20').min, S.roasBand({ mode: 'season', end: '2026-12-01' }, '2026-09-20').min, S.roasBand({ mode: 'season', end: '2026-10-10' }, '2026-09-20').min, S.roasBand({ mode: 'season', end: '2026-09-25' }, '2026-09-20').min], [1, 1.2, 0.85, 1, 1.2]);
  const ad = (campaign, spend, rev, imp, target) => ({ campaign, spend, ad_revenue: rev, impressions: imp, clicks: 10, ad_orders: 1, target_roas: target, budget: 1000 });
  const ads = {};
  for (const [i, dt] of ['2026-09-14', '2026-09-15', '2026-09-16'].entries()) ads[dt] = { X: ad('X', 1000, 4000, 1000, 3.0) };      // 직전: ROAS 400%, 노출 1000/일
  for (const [i, dt] of ['2026-09-17', '2026-09-18', '2026-09-19'].entries()) ads[dt] = { X: ad('X', 700, 3500, 600, 4.0) };       // 최근: 목표 3→4 로 올림, ROAS 500%, 노출 −40%
  const d = { options: [{ option_id: 'A', product_name: 'a', campaign: 'X', sort_order: 1 }], margins: [{ option_id: 'A', effective_from: '', margin: 5000 }], legacy: {}, imports: [], expenses: [], traffic: [], excludes: {}, adrows: {}, campaignOptions: {}, zeroRoas: {}, campMode: {}, ads,
    sales: { '2026-09-18': { A: { option_id: 'A', quantity: 2, revenue: 40000 } } } };
  const r = S.roasCheck(d, 3); const x = r.rows[0];
  assert.deepEqual(r.prevDates, ['2026-09-14', '2026-09-15', '2026-09-16']);
  assert.equal(Math.round(x.trend.impressions * 100), -40); assert.equal(x.targetChanged, true); assert.equal(Math.round(x.trend.roasPrev * 100), 400);
  // 제로 4.4: 최근 이익 = 10500/4.4 − 2100×1.1 = 2386−2310 = 76 / 직전 = 12000/4.4 − 3300 = −573 → 이익 +649 → '잘 됐습니다'
  assert.ok(x.trend.profit > 0); assert.ok(x.note.includes('300% → 400%')); assert.ok(x.note.includes('잘 됐습니다'), x.note);
  assert.equal(x.status, 'green');                                              // 500% : 제로 440% 의 1.0~1.5 사이
  S.setCampMode(d, 'X', 'season', '2026-12-31'); assert.equal(S.roasCheck(d, 3).rows[0].status, 'green');   // 시즌 초반: 허용 374~528 → 500 적정
  S.setCampMode(d, 'X', 'season', '2026-10-01'); assert.equal(S.roasCheck(d, 3).rows[0].status, 'red');     // 시즌 막바지(D-12): 하한 528 → 500 조정 필요
  S.setCampMode(d, 'X', 'off'); assert.equal(S.roasCheck(d, 3).rows[0].status, 'red');                       // 비시즌: 하한 528
  S.setCampMode(d, 'X', 'normal'); assert.deepEqual(d.campMode, {});
  console.log('season/trend: all checks passed');
}
