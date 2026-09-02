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
  const [s2] = normalizeSales([{ '일자': '2026.08.30', '옵션ID': '123', '매출': '10', '판매량': '1' }], '2026-09-01'); assert.equal(s2.date, '2026-08-30');
  console.log('ad-center parsing: all checks passed');
}

// 예전 엑셀 장부 가져오기 + 자연매출 지표
{
  const { readFileSync } = await import('node:fs');
  const { importLegacyWorkbook } = await import('../../extension/lib/legacy.js');
  await S.replaceAll({});
  const buf = readFileSync(new URL('./fixtures/legacy_small.xlsx', import.meta.url));
  const r = await importLegacyWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.deepEqual([r.options, r.margins, r.ads, r.sales, r.from, r.to], [3, 3, 2, 3, '2025-06-08', '2025-06-08']);
  const d = await S.load();
  assert.equal(d.ads['2025-06-08']['2_조거팬츠_238%'].action, '메모'); assert.equal(d.sales['2025-06-08']['12340330543'].revenue, 90000);
  assert.equal(d.options.length, 4); // 매핑에 없는 판매 옵션도 이름만 등록
  const led = computeLedger(d, '2025-06-08', '2025-06-08');
  const b = led.campaigns.find((c) => c.campaign === '1_버킷햇_240%').days['2025-06-08'];
  assert.equal(b.revenue, 135000); assert.equal(b.organic_qty, 0); assert.equal(b.organic_revenue, 0); // 광고판매 12 = 실제판매 12
  const g = led.grand; assert.equal(g.revenue, 135000); assert.equal(g.ad_orders, 35); approx(g.profit, -1965.1 + (0 - 77360.8), 0.01); // 조거는 판매 데이터 없음 → 마진 0
  assert.ok(led.daily['2025-06-08'].spend_vat > 0);
  console.log('legacy import + organic metrics: all checks passed');
}
