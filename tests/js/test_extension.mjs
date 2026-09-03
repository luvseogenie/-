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
  assert.equal(c.actual_qty, 15); assert.equal(c.returns, 2); assert.equal(c.cancels, 1); assert.equal(c.returns_cancels, 3); assert.equal(c.organic_qty, 11);
  // 열이 없을 때: 광고 전환 판매 5, 실제 판매 4 → 반품·취소 1, 자연 0 (사용자 스크린샷의 9/1 사례)
  S.upsertSales(d, [{ date: '2025-06-09', option_id: '1', option_name: 'a', product_name: '', product_id: '', category: '', sales_type: '', revenue: 1, orders: 4, quantity: 4, visitors: 0, views: 0, carts: 0, conversion: null }]);
  S.upsertAds(d, [{ date: '2025-06-09', campaign: 'C', target_roas: 3.5, budget: 0, spend: 1000, ad_revenue: 5000, conversion: 0, ctr: 0, impressions: 10, clicks: 2, ad_orders: 5, action: '' }]); await S.save(d);
  const c9 = computeLedger(d, '2025-06-09', '2025-06-09').campaigns[0].days['2025-06-09'];
  assert.equal(c9.ad_orders, 5); assert.equal(c9.actual_qty, 4); assert.equal(c9.organic_qty, 0); assert.equal(c9.returns_cancels, 1);
  const m = computeLedger(d, '2025-06-08', '2025-06-09').campaigns[0].months['2025-06']; assert.equal(m.returns_cancels, 4); // 일별 합
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
