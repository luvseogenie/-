// 예전 '광고계산기' 엑셀 가져오기.
//  - 4번 시트(광고 장부확인)의 값을 캠페인×날짜 '확정 장부'로 가져온다 (마진 수정 이력이 반영된 값 그대로).
//  - 1번 시트(매핑)는 선택: 옵션↔캠페인 연결과 현재 마진. 마진은 엑셀 마지막 날짜 다음 날부터 적용해 과거 값을 건드리지 않는다.
//  - 미리보기(parse) → 적용(apply, 되돌리기용 스냅샷 저장) → 되돌리기(undo) / 삭제(remove)
import * as S from './store.js';
import { parseXlsx } from './xlsx.js';
import { parseNumber, parsePercent, parseDate, normHeader } from './parse.js';

const str = (v) => String(v ?? '').trim();
const cleanId = (v) => { if (typeof v === 'number') return String(Math.round(v)); let s = str(v).replace(/,/g, ''); return s.endsWith('.0') ? s.slice(0, -2) : s; };
const findSheet = (sheets, ...keys) => sheets.find((s) => keys.every((k) => s.name.includes(k)));
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function excelDate(v) {
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }
  return parseDate(v);
}
// 4번 시트 항목 라벨 → 필드
const LABELS = [
  ['target_roas', ['목표효율']], ['roas', ['광고수익률']], ['budget', ['광고예산']], ['spend_vat', ['집행광고비*10%', '집행광고비']],
  ['cpc', ['cpc']], ['impressions', ['노출수']], ['ctr', ['클릭률']], ['conversion', ['전환율']],
  ['ad_orders', ['광고전환판매수', '광고전환판매']], ['organic_qty', ['자연판매수']], ['actual_qty', ['실제판매수']],
  ['margin_total', ['광고마진', '판매마진']], ['profit', ['순이익']],
];
const labelField = (label) => { const n = normHeader(label); for (const [f, keys] of LABELS) if (keys.some((k) => n.startsWith(normHeader(k)) || n === normHeader(k))) return f; return null; };

export async function parseLegacyWorkbook(buf, filename = '') {
  const sheets = await parseXlsx(buf);
  const ledgerSheet = findSheet(sheets, '장부') || sheets[4];
  if (!ledgerSheet) throw new Error("4번 시트('4. 광고 장부확인')를 찾지 못했습니다.");
  const rows = ledgerSheet.rows;
  // 날짜 헤더 행: 날짜가 5개 이상 있는 첫 행
  let hr = -1, dateCols = [];
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cols = []; rows[r].forEach((v, i) => { const d = typeof v === 'number' && v > 30000 ? excelDate(v) : (typeof v === 'string' ? parseDate(v) : null); if (d) cols.push([i, d]); });
    if (cols.length >= 5) { hr = r; dateCols = cols; break; }
  }
  if (hr < 0) throw new Error('4번 시트에서 날짜 행을 찾지 못했습니다.');
  // 캠페인 블록: A열에 이름, B열에 항목
  const legacy = {}; let camp = null; const campaigns = new Set(); let cells = 0;
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r]; const a = str(row[0]), b = str(row[1]);
    if (a && !/이곳에|입력해 주세요|캠페인명을/.test(a)) camp = a; else if (a) camp = null;
    if (!camp || !b) continue;
    const field = labelField(b); if (!field) continue;
    for (const [ci, date] of dateCols) {
      const v = row[ci]; if (v == null || v === '') continue;
      const n = typeof v === 'number' ? v : parseNumber(v); if (n == null) continue;
      ((legacy[date] ||= {})[camp] ||= {})[field] = n;
    }
  }
  // 파생값 + 빈 칸 정리
  for (const [date, day] of Object.entries(legacy)) {
    for (const [c, L] of Object.entries(day)) {
      const active = (L.spend_vat || 0) > 0 || (L.impressions || 0) > 0 || (L.ad_orders || 0) > 0 || (L.actual_qty || 0) > 0 || (L.margin_total || 0) !== 0;
      if (!active) { delete day[c]; continue; }
      L.spend = (L.spend_vat || 0) / 1.1; L.ad_revenue = (L.roas || 0) * L.spend; L.clicks = L.cpc ? L.spend / L.cpc : 0;
      if (L.actual_qty == null && L.organic_qty != null) L.actual_qty = (L.ad_orders || 0) + L.organic_qty;
      if (L.profit == null) L.profit = (L.margin_total || 0) - (L.spend_vat || 0);
      campaigns.add(c); cells++;
    }
    if (!Object.keys(day).length) delete legacy[date];
  }
  const dates = Object.keys(legacy).sort();
  if (!dates.length) throw new Error('4번 시트에서 값이 있는 날짜를 찾지 못했습니다.');
  // 1번 시트 매핑 (선택)
  const mapping = [];
  const map = findSheet(sheets, '매핑') || sheets[1];
  if (map) {
    let mh = null; for (let r = 0; r < Math.min(map.rows.length, 10); r++) { const vals = map.rows[r].map((v) => str(v).replace(/\n/g, '')); if (vals.some((v) => v.includes('옵션') && v.length <= 20) && vals.some((v) => v.includes('캠페인') && v.length <= 20)) { mh = { r, vals }; break; } }
    if (mh) {
      const col = (...names) => { const i = mh.vals.findIndex((v) => names.some((n) => normHeader(v).startsWith(normHeader(n)))); return i < 0 ? null : i; };
      const cName = col('상품명'), cId = col('옵션ID', '옵션 ID'), cCamp = col('광고캠페인', '캠페인'), cMargin = col('옵션마진', '마진');
      const seen = new Set();
      for (const row of map.rows.slice(mh.r + 1)) { const oid = cleanId(row[cId]); if (!/^\d+$/.test(oid) || seen.has(oid)) continue; seen.add(oid); mapping.push({ option_id: oid, product_name: str(row[cName]), campaign: str(row[cCamp]), margin: parseNumber(row[cMargin]) }); }
    }
  }
  // 3번 시트: 옵션별 실제 판매 데이터 (한 줄도 빠짐없이)
  const sales = [];
  const salesSheet = findSheet(sheets, '매출 실적') || findSheet(sheets, '매출') || sheets[3];
  if (salesSheet) {
    let sh = null; for (let r = 0; r < Math.min(salesSheet.rows.length, 10); r++) { const vals = salesSheet.rows[r].map((v) => str(v).replace(/\n/g, '')); if (vals.some((v) => v.includes('옵션') && v.length <= 20) && vals.some((v) => v.includes('매출') && v.length <= 20) && vals.filter(Boolean).length >= 3) { sh = { r, vals }; break; } }
    if (sh) {
      const col = (...names) => { const i = sh.vals.findIndex((v) => names.some((n) => normHeader(v).startsWith(normHeader(n)))); return i < 0 ? null : i; };
      const c = { date: col('날짜'), oid: col('옵션ID', '옵션 ID'), oname: col('옵션명'), pname: col('상품명'), pid: col('등록상품ID'), cat: col('카테고리'), type: col('판매방식'), rev: col('매출'), orders: col('주문'), qty: col('판매량'), vis: col('방문자'), views: col('조회'), carts: col('장바구니'), conv: col('구매전환율') };
      const g = (row, k) => (c[k] == null ? null : row[c[k]]);
      for (const row of salesSheet.rows.slice(sh.r + 1)) {
        const oid = cleanId(g(row, 'oid')); const date = excelDate(g(row, 'date'));
        if (!/^\d+$/.test(oid) || !date) continue;
        sales.push({ date, option_id: oid, option_name: str(g(row, 'oname')), product_name: str(g(row, 'pname')), product_id: cleanId(g(row, 'pid')), category: str(g(row, 'cat')), sales_type: str(g(row, 'type')),
          revenue: parseNumber(g(row, 'rev')) ?? 0, orders: parseNumber(g(row, 'orders')) ?? 0, quantity: parseNumber(g(row, 'qty')) ?? 0, visitors: parseNumber(g(row, 'vis')) ?? 0,
          views: parseNumber(g(row, 'views')) ?? 0, carts: parseNumber(g(row, 'carts')) ?? 0, conversion: g(row, 'conv') == null || g(row, 'conv') === '' ? null : parsePercent(g(row, 'conv')) });
      }
    }
  }
  const salesDates = [...new Set(sales.map((r) => r.date))].sort();
  return { source: filename, legacy, dates, from: dates[0], to: dates[dates.length - 1], campaigns: [...campaigns], cells, mapping, marginFrom: addDays(dates[dates.length - 1], 1),
    sales, salesFrom: salesDates[0] || null, salesTo: salesDates[salesDates.length - 1] || null };
}

// 미리보기: 현재 데이터와 겹치는 정도
export function previewAgainst(d, parsed) {
  const overlapDays = parsed.dates.filter((x) => d.legacy?.[x]).length;
  const dailyDays = parsed.dates.filter((x) => d.sales[x] || d.ads[x]).length;
  const newOptions = parsed.mapping.filter((m) => !d.options.find((o) => o.option_id === m.option_id)).length;
  const salesOverwrite = (parsed.sales || []).filter((r) => d.sales[r.date]?.[r.option_id]).length;
  return { overlapDays, dailyDays, newOptions, changedOptions: parsed.mapping.length - newOptions, salesRows: (parsed.sales || []).length, salesOverwrite };
}

export async function applyLegacy(parsed, { withMapping = true } = {}) {
  const d = await S.load(); d.legacy ||= {}; d.imports ||= [];
  const id = 'imp_' + Date.now().toString(36);
  const before = { legacy: {}, options: [], margins: [], salesAdded: [], salesPrev: {} };
  // 3번 시트 판매 데이터: 전부 저장 (같은 날짜·옵션은 덮어쓰기, 되돌리기용으로 이전 값 보관)
  let salesSaved = 0;
  for (const r of parsed.sales || []) {
    const prev = d.sales[r.date]?.[r.option_id];
    const key = r.date + '|' + r.option_id;
    if (prev) before.salesPrev[key] = prev; else before.salesAdded.push(key);
    (d.sales[r.date] ||= {})[r.option_id] = r; salesSaved++;
  }
  for (const [date, day] of Object.entries(parsed.legacy)) {
    for (const [c, L] of Object.entries(day)) {
      (before.legacy[date] ||= {})[c] = d.legacy[date]?.[c] ? { ...d.legacy[date][c] } : null;
      (d.legacy[date] ||= {})[c] = { ...L, src: id };
    }
  }
  let mappedOptions = 0, mappedMargins = 0;
  if (withMapping) {
    for (const m of parsed.mapping) {
      const prev = d.options.find((o) => o.option_id === m.option_id);
      before.options.push(prev ? { ...prev } : { option_id: m.option_id, _absent: true });
      S.upsertOption(d, { option_id: m.option_id, product_name: m.product_name || prev?.product_name || '', campaign: m.campaign || prev?.campaign || '', source: 'excel' }); mappedOptions++;
      if (m.margin != null) {
        const hist = S.marginHistory(d, m.option_id);
        const eff = hist.length ? parsed.marginFrom : ''; // 이력이 없으면 처음부터, 있으면 엑셀 다음 날부터
        const existing = d.margins.find((x) => x.option_id === m.option_id && x.effective_from === eff);
        before.margins.push(existing ? { ...existing } : { option_id: m.option_id, effective_from: eff, _absent: true });
        if (!existing || existing.margin !== m.margin) { S.setMargin(d, m.option_id, m.margin, eff, '엑셀에서 가져옴'); mappedMargins++; }
      }
    }
  }
  d.imports.push({ id, at: new Date().toISOString(), source: parsed.source, from: parsed.from, to: parsed.to, campaigns: parsed.campaigns.length, cells: parsed.cells, salesSaved, mappedOptions, mappedMargins, before });
  while (d.imports.length > 3) d.imports.shift();
  await S.save(d);
  return { id, cells: parsed.cells, salesSaved, mappedOptions, mappedMargins, from: parsed.from, to: parsed.to };
}

export async function undoImport(id) {
  const d = await S.load(); const i = (d.imports || []).findIndex((x) => x.id === id); if (i < 0) throw new Error('가져오기 기록이 없습니다');
  const imp = d.imports[i]; const before = imp.before || { legacy: {}, options: [], margins: [] };
  for (const key of before.salesAdded || []) { const [date, oid] = key.split('|'); if (d.sales[date]) { delete d.sales[date][oid]; if (!Object.keys(d.sales[date]).length) delete d.sales[date]; } }
  for (const [key, prev] of Object.entries(before.salesPrev || {})) { const [date, oid] = key.split('|'); (d.sales[date] ||= {})[oid] = prev; }
  for (const [date, day] of Object.entries(before.legacy)) {
    for (const [c, prev] of Object.entries(day)) { if (!d.legacy[date]) continue; if (prev) d.legacy[date][c] = prev; else delete d.legacy[date][c]; }
    if (d.legacy[date] && !Object.keys(d.legacy[date]).length) delete d.legacy[date];
  }
  for (const o of before.options) { const idx = d.options.findIndex((x) => x.option_id === o.option_id); if (o._absent) { if (idx >= 0) d.options.splice(idx, 1); } else if (idx >= 0) d.options[idx] = { ...o }; else d.options.push({ ...o }); }
  for (const m of before.margins) { const idx = d.margins.findIndex((x) => x.option_id === m.option_id && x.effective_from === m.effective_from); if (m._absent) { if (idx >= 0) d.margins.splice(idx, 1); } else if (idx >= 0) d.margins[idx] = { ...m }; else d.margins.push({ ...m }); }
  d.imports.splice(i, 1); await S.save(d); return true;
}

// 이 가져오기로 들어온 장부 값만 지운다 (옵션·마진은 그대로)
export async function removeImportData(id) {
  const d = await S.load(); let n = 0;
  for (const [date, day] of Object.entries(d.legacy || {})) { for (const [c, L] of Object.entries(day)) if (L.src === id) { delete day[c]; n++; } if (!Object.keys(day).length) delete d.legacy[date]; }
  const i = (d.imports || []).findIndex((x) => x.id === id); if (i >= 0) d.imports.splice(i, 1);
  await S.save(d); return n;
}
export async function listImports() { const d = await S.load(); return (d.imports || []).map(({ before, ...rest }) => rest).reverse(); }
