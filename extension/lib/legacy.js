// 예전 '광고계산기' 엑셀(시트 1~3)을 확장 프로그램 저장소로 가져온다.
import * as S from './store.js';
import { parseXlsx } from './xlsx.js';
import { parseNumber, parsePercent, parseRatio, parseDate, normHeader } from './parse.js';

const cleanId = (v) => { if (typeof v === 'number') return String(Math.round(v)); let s = String(v ?? '').trim().replace(/,/g, ''); return s.endsWith('.0') ? s.slice(0, -2) : s; };
const str = (v) => String(v ?? '').trim();

function findSheet(sheets, ...keys) { return sheets.find((s) => keys.every((k) => s.name.includes(k))); }
function headerRow(rows, ...keys) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const vals = rows[r].map((v) => str(v).replace(/\n/g, ''));
    // 머리글은 짧은 칸들이다. 긴 설명문(2행 메모)이 걸리지 않도록 20자 이하 칸만 본다.
    if (keys.every((k) => vals.some((v) => v.includes(k) && v.length <= 20)) && vals.filter(Boolean).length >= 3) return { r, vals };
  }
  return null;
}
const col = (vals, ...names) => { const i = vals.findIndex((v) => names.some((n) => normHeader(v).startsWith(normHeader(n)))); return i < 0 ? null : i; };
// 엑셀 날짜 일련번호(45816) → ISO
function excelDate(v) {
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
  return parseDate(v);
}

export async function importLegacyWorkbook(buf) {
  const sheets = await parseXlsx(buf);
  const d = await S.load();
  const stats = { options: 0, margins: 0, ads: 0, sales: 0, dates: new Set() };
  const seen = new Set(d.options.map((o) => o.option_id));

  const map = findSheet(sheets, '매핑') || sheets[1];
  const mh = map && headerRow(map.rows, '옵션', '캠페인');
  if (mh) {
    const cName = col(mh.vals, '상품명'), cId = col(mh.vals, '옵션ID', '옵션 ID'), cCamp = col(mh.vals, '광고캠페인', '캠페인'), cMargin = col(mh.vals, '옵션마진', '마진');
    for (const row of map.rows.slice(mh.r + 1)) {
      const oid = cleanId(row[cId]); if (!/^\d+$/.test(oid)) continue;
      const cur = d.options.find((o) => o.option_id === oid);
      S.upsertOption(d, { option_id: oid, product_name: str(row[cName]) || cur?.product_name || '', campaign: str(row[cCamp]) || cur?.campaign || '' });
      seen.add(oid); stats.options++;
      const m = parseNumber(row[cMargin]); if (m && !d.margins.some((x) => x.option_id === oid)) { S.setMargin(d, oid, m, '', '엑셀에서 가져옴'); stats.margins++; }
    }
  }

  const ads = findSheet(sheets, '광고 실적') || findSheet(sheets, '광고') || sheets[2];
  const ah = ads && headerRow(ads.rows, '캠페인', '날짜');
  if (ah) {
    const c = { campaign: col(ah.vals, '캠페인'), date: col(ah.vals, '날짜'), target: col(ah.vals, '목표효율'), budget: col(ah.vals, '광고예산'), spend: col(ah.vals, '집행광고비', '집행 광고비'),
      rev: col(ah.vals, '광고전환매출', '광고전환 매출'), conv: col(ah.vals, '전환율'), ctr: col(ah.vals, '클릭률'), imp: col(ah.vals, '노출수'), clk: col(ah.vals, '클릭수'), orders: col(ah.vals, '광고전환판매수', '광고전환 판매수'), action: col(ah.vals, 'ACTION') };
    const g = (row, k) => (c[k] == null ? null : row[c[k]]);
    const rows = [];
    for (const row of ads.rows.slice(ah.r + 1)) {
      const camp = str(g(row, 'campaign')); const date = excelDate(g(row, 'date'));
      if (!camp || !date) continue;
      rows.push({ date, campaign: camp, target_roas: parseRatio(g(row, 'target')) ?? 0, budget: parseNumber(g(row, 'budget')) ?? 0, spend: parseNumber(g(row, 'spend')) ?? 0,
        ad_revenue: parseNumber(g(row, 'rev')) ?? 0, conversion: parsePercent(g(row, 'conv')) ?? 0, ctr: parsePercent(g(row, 'ctr')) ?? 0, impressions: parseNumber(g(row, 'imp')) ?? 0,
        clicks: parseNumber(g(row, 'clk')) ?? 0, ad_orders: parseNumber(g(row, 'orders')) ?? 0, action: str(g(row, 'action')) });
      stats.dates.add(date);
    }
    stats.ads = S.upsertAds(d, rows);
  }

  const sales = findSheet(sheets, '매출 실적') || findSheet(sheets, '매출') || sheets[3];
  const sh = sales && headerRow(sales.rows, '옵션', '매출');
  if (sh) {
    const c = { date: col(sh.vals, '날짜'), oid: col(sh.vals, '옵션ID', '옵션 ID'), oname: col(sh.vals, '옵션명'), pname: col(sh.vals, '상품명'), pid: col(sh.vals, '등록상품ID'), cat: col(sh.vals, '카테고리'), type: col(sh.vals, '판매방식'),
      rev: col(sh.vals, '매출'), orders: col(sh.vals, '주문'), qty: col(sh.vals, '판매량'), vis: col(sh.vals, '방문자'), views: col(sh.vals, '조회'), carts: col(sh.vals, '장바구니'), conv: col(sh.vals, '구매전환율') };
    const g = (row, k) => (c[k] == null ? null : row[c[k]]);
    const rows = [];
    for (const row of sales.rows.slice(sh.r + 1)) {
      const oid = cleanId(g(row, 'oid')); const date = excelDate(g(row, 'date'));
      if (!/^\d+$/.test(oid) || !date) continue;
      rows.push({ date, option_id: oid, option_name: str(g(row, 'oname')), product_name: str(g(row, 'pname')), product_id: cleanId(g(row, 'pid')), category: str(g(row, 'cat')), sales_type: str(g(row, 'type')),
        revenue: parseNumber(g(row, 'rev')) ?? 0, orders: parseNumber(g(row, 'orders')) ?? 0, quantity: parseNumber(g(row, 'qty')) ?? 0, visitors: parseNumber(g(row, 'vis')) ?? 0,
        views: parseNumber(g(row, 'views')) ?? 0, carts: parseNumber(g(row, 'carts')) ?? 0, conversion: g(row, 'conv') == null || g(row, 'conv') === '' ? null : parsePercent(g(row, 'conv')) });
      if (!seen.has(oid)) { seen.add(oid); S.upsertOption(d, { option_id: oid, product_name: str(g(row, 'oname')) || str(g(row, 'pname')) }); }
      stats.dates.add(date);
    }
    stats.sales = S.upsertSales(d, rows);
  }
  if (!mh && !ah && !sh) throw new Error('광고계산기 엑셀 형식(1. 매핑 / 2. 광고 실적 / 3. 매출 실적 시트)을 찾지 못했습니다.');
  await S.save(d);
  const dates = [...stats.dates].sort();
  return { options: stats.options, margins: stats.margins, ads: stats.ads, sales: stats.sales, from: dates[0], to: dates[dates.length - 1] };
}
