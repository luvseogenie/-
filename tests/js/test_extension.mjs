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
