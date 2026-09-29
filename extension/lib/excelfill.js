// 사용자의 엑셀 마진계산기(원본 통합문서)에 프로그램 데이터를 이어 붙인다.
//   1. 상품 & 캠페인 매핑 : 목록에 없는 옵션 줄 추가 (캠페인이 바뀐 옵션은 캠페인 갱신, 마진은 현재 값으로)
//   2. 일별 광고 실적 입력 : 날짜×캠페인 줄 추가
//   3. 일별 매출 실적 입력 : 날짜×옵션 줄 추가
//   4. 광고 장부확인       : 새 캠페인 블록을 마지막 블록과 같은 수식으로 복제
// 통합문서를 다시 만드는 게 아니라 zip 안의 시트 XML 에 줄만 보태므로 서식·수식·다른 시트는 그대로다.
// 수식 결과값(캐시)은 넣지 않고 fullCalcOnLoad 를 켜서 엑셀이 열 때 전부 다시 계산하게 한다.
import { unzip } from './xlsx.js';
import { zip } from './zip.js';

const dec = new TextDecoder(); const enc = new TextEncoder();
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');
const textOf = (xml) => unesc(xml.replace(/<[^>]+>/g, ''));
export const colNum = (letters) => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
export const colLetters = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const splitRef = (ref) => { const m = ref.match(/^([A-Z]+)(\d+)$/); return m ? { col: m[1], row: +m[2] } : null; };
export const serialOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
export const isoOfSerial = (n) => { const t = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; };
const norm = (s) => String(s ?? '').replace(/\s/g, '');

// A1 참조를 상대 이동한다 ($ 가 붙은 부분은 고정). 열 전체 참조($D:$D)와 함수 이름은 건드리지 않는다
export function shiftRefs(formula, dcol, drow) {
  return formula.replace(/(?<![A-Za-z_\d.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (m, cAbs, col, rAbs, row) => {
    const c = cAbs ? col : colLetters(Math.max(1, colNum(col) + dcol));
    const r = rAbs ? +row : Math.max(1, +row + drow);
    return `${cAbs}${c}${rAbs}${r}`;
  });
}

// ---- 시트 XML 다루기 ----
function readShared(files) {
  const out = []; if (!files['xl/sharedStrings.xml']) return out;
  const xml = dec.decode(files['xl/sharedStrings.xml']);
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) out.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join(''));
  return out;
}
function sheetPaths(files) {
  const wb = dec.decode(files['xl/workbook.xml']); const rels = dec.decode(files['xl/_rels/workbook.xml.rels']);
  const relMap = {}; for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = m[0].match(/Id="([^"]+)"/)?.[1], t = m[0].match(/Target="([^"]+)"/)?.[1]; if (id && t) relMap[id] = t.replace(/^\/?(xl\/)?/, 'xl/'); }
  const out = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) out.push({ name: unesc(m[0].match(/name="([^"]*)"/)?.[1] || ''), path: relMap[m[0].match(/r:id="([^"]+)"/)?.[1]] });
  return out;
}
// 한 시트의 줄들을 [{r, attrs, body, start, end}] 로 (원본 XML 위치 포함)
function parseRows(xml) {
  const rows = [];
  for (const m of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const attrs = m[1] ?? m[3] ?? ''; const r = +(attrs.match(/\br="(\d+)"/)?.[1] || 0);
    rows.push({ r, attrs, body: m[2] || '', start: m.index, end: m.index + m[0].length });
  }
  return rows;
}
function cellsOf(body) {
  const out = {};
  for (const m of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1], inner = m[2] || ''; const ref = attrs.match(/\br="([A-Z]+)(\d+)"/); if (!ref) continue;
    out[ref[1]] = { attrs, inner, s: attrs.match(/\bs="(\d+)"/)?.[1] || null, t: attrs.match(/\bt="(\w+)"/)?.[1] || null, xml: m[0] };
  }
  return out;
}
function cellValue(c, shared) {
  if (!c) return null;
  if (c.t === 's') { const n = c.inner.match(/<v>(\d+)<\/v>/)?.[1]; return n != null ? shared[+n] : ''; }
  if (c.t === 'inlineStr') return textOf(c.inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] || '');
  if (c.t === 'str' || c.t === 'e') return textOf(c.inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '');
  if (c.t === 'b') return c.inner.includes('<v>1</v>');
  const raw = c.inner.match(/<v>([\s\S]*?)<\/v>/)?.[1]; return raw == null ? null : Number(raw);
}
const hasValue = (c) => !!c && !/<f\b/.test(c.inner) && (/<v>[^<]/.test(c.inner) || /<is>/.test(c.inner));   // 수식만 있는 칸(미리 채워 둔 빈 줄)은 값이 아니다
// 공유 수식(shared formula)의 원본들: si → { ref: 'FN610', text }
function sharedMasters(xml) {
  const out = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*>\s*<f t="shared" ref="[^"]*" si="(\d+)"[^>]*>([^<]*)<\/f>/g)) out[m[2]] = { ref: m[1], text: m[3] };
  return out;
}
// 셀의 수식을 명시적 문자열로 (공유 수식이면 원본에서 이동해 계산)
function formulaOf(cell, ref, masters) {
  if (!cell) return null;
  const f = cell.inner.match(/<f\b([^>]*)(?:\/>|>([^<]*)<\/f>)/); if (!f) return null;
  const attrs = f[1] || ''; const text = f[2] || '';
  if (text) return text;
  const si = attrs.match(/si="(\d+)"/)?.[1]; const mst = si != null ? masters[si] : null; if (!mst) return null;
  const a = splitRef(mst.ref), b = splitRef(ref);
  return shiftRefs(mst.text, colNum(b.col) - colNum(a.col), b.row - a.row);
}
const rowAttrsWithout = (attrs) => attrs.replace(/\br="\d+"/, '').replace(/\s+/g, ' ').trim();
const cellXml = (col, r, s, kind, v) => {
  const sa = s != null ? ` s="${s}"` : '';
  if (v == null || v === '') return `<c r="${col}${r}"${sa}/>`;
  if (kind === 'str') return `<c r="${col}${r}"${sa} t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  if (kind === 'f') return `<c r="${col}${r}"${sa}><f>${v}</f></c>`;
  if (kind === 'fstr') return `<c r="${col}${r}"${sa} t="str"><f>${v}</f></c>`;
  return `<c r="${col}${r}"${sa}><v>${Number(v)}</v></c>`;
};
// 마지막 데이터 줄을 본떠 새 줄을 만들 '틀': 열마다 스타일과 수식 템플릿
function rowTemplate(xml, rows, lastRow, masters) {
  const row = rows.find((x) => x.r === lastRow); const cells = cellsOf(row.body); const tpl = { attrs: rowAttrsWithout(row.attrs), cols: {} };
  for (const [col, c] of Object.entries(cells)) {
    const f = formulaOf(c, col + lastRow, masters);
    tpl.cols[col] = { s: c.s, t: c.t, f: f ? f.replace(new RegExp(`(?<=[A-Z]\\$?)${lastRow}(?!\\d)`, 'g'), '{r}') : null };
  }
  return tpl;
}
// 시트 끝의 비어 있는(값 없는) 줄들을 지우고, 새 줄을 이어 붙일 시작 번호를 돌려준다
function trimTrailing(xml, rows, lastDataRow) {
  const trailing = rows.filter((x) => x.r > lastDataRow);
  const dirty = trailing.some((x) => Object.values(cellsOf(x.body)).some(hasValue));
  if (dirty || !trailing.length) return { xml, start: (rows.length ? rows[rows.length - 1].r : lastDataRow) + 1 };
  const first = trailing[0]; const last = trailing[trailing.length - 1];
  return { xml: xml.slice(0, first.start) + xml.slice(last.end), start: lastDataRow + 1 };
}
function setDimension(xml, maxRow, maxColLetters) {
  return xml.replace(/<dimension ref="([A-Z]+\d+)(?::([A-Z]+)\d+)?"\/>/, (m, a, b) => `<dimension ref="${a}:${b || maxColLetters}${maxRow}"/>`);
}
function appendRows(xml, rowsXml) { if (!rowsXml.length) return xml; return xml.replace(/<\/sheetData>/, rowsXml.join('') + '</sheetData>'); }
function findHeader(rows, shared, need) {
  for (const row of rows.slice(0, 12)) {
    const cells = cellsOf(row.body); const texts = Object.values(cells).map((c) => norm(cellValue(c, shared))).filter(Boolean);
    if (texts.length < 3) continue;
    const used = new Set(); let ok = true;
    for (const k of need) { const i = texts.findIndex((t, idx) => !used.has(idx) && t.includes(k)); if (i < 0) { ok = false; break; } used.add(i); }   // 제목마다 다른 칸이어야 (설명 문장 한 칸에 다 들어 있는 줄은 제외)
    if (ok) return { row, cells };
  }
  return null;
}
const headerCols = (hdr, shared) => { const map = {}; for (const [col, c] of Object.entries(hdr.cells)) { const t = norm(cellValue(c, shared)); if (t) map[t] = col; } return map; };
const pick = (map, ...keys) => { for (const k of keys) { const hit = Object.keys(map).find((t) => t.includes(norm(k))); if (hit) return map[hit]; } return null; };
const campNo = (name) => { const m = String(name).match(/^\s*(\d+)/); return m ? +m[1] : 9999; };
const cleanId = (v) => { let s = String(v ?? '').trim().replace(/,/g, ''); if (s.endsWith('.0')) s = s.slice(0, -2); return s; };
const dateList = (from, to) => { const out = []; const d = new Date(from + 'T00:00:00'); const e = new Date(to + 'T00:00:00'); for (; d <= e; d.setDate(d.getDate() + 1)) out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); return out; };

// 통합문서를 읽어 마지막 날짜 등 상태만 알려준다 (채우기 전에 화면에 보여 주려고)
export async function inspectWorkbook(buf) {
  const files = await unzip(buf); const shared = readShared(files); const sheets = sheetPaths(files);
  const find = (n) => sheets.find((s) => s.name.trim().startsWith(n));
  const s2 = find('2.'), s3 = find('3.');
  if (!s2 || !s3) throw new Error('마진계산기 엑셀이 아닙니다 (2. 일별 광고 실적 입력 / 3. 일별 매출 실적 입력 시트가 없음)');
  const lastOf = (sheet, needHdr, dateKey) => {
    const xml = dec.decode(files[sheet.path]); const rows = parseRows(xml); const hdr = findHeader(rows, shared, needHdr); if (!hdr) return null;
    const dc = pick(headerCols(hdr, shared), dateKey); let last = null;
    for (const row of rows) { if (row.r <= hdr.row.r) continue; const v = cellValue(cellsOf(row.body)[dc], shared); if (typeof v === 'number' && v > 20000) last = last == null || v > last ? v : last; }
    return last == null ? null : isoOfSerial(last);
  };
  return { adsLast: lastOf(s2, ['캠페인', '날짜'], '날짜'), salesLast: lastOf(s3, ['날짜', '옵션'], '날짜'), sheets: sheets.map((s) => s.name) };
}

// 채우기. d = 프로그램 데이터(load() 결과), from~to = 채울 날짜 (from 이 없으면 엑셀 마지막 날짜 다음 날)
export async function fillWorkbook(buf, d, { from = null, to, marginOf = null, campaignStatus = null } = {}) {
  const files = await unzip(buf); const shared = readShared(files); const sheets = sheetPaths(files);
  const find = (n) => { const s = sheets.find((x) => x.name.trim().startsWith(n)); if (!s || !files[s.path]) throw new Error(`'${n}' 로 시작하는 시트를 찾지 못했습니다`); return s; };
  const s1 = find('1.'), s2 = find('2.'), s3 = find('3.'), s4 = find('4.');
  const report = { ads: 0, sales: 0, options: 0, campaigns: [], relinked: [], marginChanged: [], skipped: [] };
  const mOf = marginOf || (() => 0);

  // ---- 2. 광고 ----
  let x2 = dec.decode(files[s2.path]); let rows2 = parseRows(x2); const h2 = findHeader(rows2, shared, ['캠페인', '날짜']);
  if (!h2) throw new Error("'2. 일별 광고 실적 입력' 시트의 제목 줄(캠페인 이름·날짜)을 찾지 못했습니다");
  const c2 = headerCols(h2, shared);
  const C2 = { camp: pick(c2, '캠페인'), date: pick(c2, '날짜'), target: pick(c2, '목표효율'), budget: pick(c2, '광고예산'), spend: pick(c2, '집행광고비'), rev: pick(c2, '광고전환매출'), conv: pick(c2, '전환율'), ctr: pick(c2, '클릭률'), imp: pick(c2, '노출수'), clk: pick(c2, '클릭수'), qty: pick(c2, '광고전환판매수'), action: pick(c2, 'ACTION') };
  let last2 = h2.row.r; let lastDate2 = null;
  for (const row of rows2) { if (row.r <= h2.row.r) continue; const v = cellValue(cellsOf(row.body)[C2.date], shared); if (typeof v === 'number' && v > 20000) { last2 = Math.max(last2, row.r); lastDate2 = lastDate2 == null || v > lastDate2 ? v : lastDate2; } }
  // ---- 3. 매출 ----
  let x3 = dec.decode(files[s3.path]); let rows3 = parseRows(x3); const h3 = findHeader(rows3, shared, ['날짜', '옵션']);
  if (!h3) throw new Error("'3. 일별 매출 실적 입력' 시트의 제목 줄을 찾지 못했습니다");
  const c3 = headerCols(h3, shared);
  const C3 = { date: pick(c3, '날짜'), oid: pick(c3, '옵션ID'), oname: pick(c3, '옵션명'), pname: pick(c3, '상품명'), pid: pick(c3, '등록상품ID'), cat: pick(c3, '카테고리'), how: pick(c3, '판매방식'), rev: pick(c3, '매출'), orders: pick(c3, '주문'), qty: pick(c3, '판매량'), vis: pick(c3, '방문자'), views: pick(c3, '조회'), cart: pick(c3, '장바구니'), conv: pick(c3, '구매전환율') };
  let last3 = h3.row.r; let lastDate3 = null;
  for (const row of rows3) { if (row.r <= h3.row.r) continue; const v = cellValue(cellsOf(row.body)[C3.date], shared); if (typeof v === 'number' && v > 20000) { last3 = Math.max(last3, row.r); lastDate3 = lastDate3 == null || v > lastDate3 ? v : lastDate3; } }
  const excelLast = lastDate2 == null && lastDate3 == null ? null : isoOfSerial(Math.max(lastDate2 || 0, lastDate3 || 0));
  if (!from) { if (!excelLast) throw new Error('엑셀에서 마지막 날짜를 찾지 못했습니다 (from 을 정해 주세요)'); const n = new Date(excelLast + 'T00:00:00'); n.setDate(n.getDate() + 1); from = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; }
  if (!to) throw new Error('끝 날짜(to)가 없습니다');
  if (to < from) return { bytes: null, report: { ...report, from, to, excelLast, nothing: true } };   // 엑셀이 이미 끝 날짜까지 있음 → 넣을 것 없음
  const dates = dateList(from, to);
  report.from = from; report.to = to; report.excelLast = excelLast;

  // ---- 1. 매핑 ----
  let x1 = dec.decode(files[s1.path]); let rows1 = parseRows(x1); const h1 = findHeader(rows1, shared, ['상품명', '옵션', '캠페인']);
  if (!h1) throw new Error("'1. 상품 & 캠페인 매핑' 시트의 제목 줄을 찾지 못했습니다");
  const c1 = headerCols(h1, shared);
  const C1 = { name: pick(c1, '상품명'), oid: pick(c1, '옵션ID'), camp: pick(c1, '캠페인'), margin: pick(c1, '마진') };
  const existing = {};   // option_id → { row, campaign, margin, idType }
  let last1 = h1.row.r;
  for (const row of rows1) {
    if (row.r <= h1.row.r) continue; const cells = cellsOf(row.body); const c = cells[C1.oid]; const v = cellValue(c, shared);
    if (v == null || v === '') continue; last1 = Math.max(last1, row.r);
    existing[cleanId(v)] = { row, cells, campaign: String(cellValue(cells[C1.camp], shared) ?? '').trim(), margin: cellValue(cells[C1.margin], shared), idType: c.t === 's' || c.t === 'inlineStr' || c.t === 'str' ? 'str' : 'num' };
  }
  const st = campaignStatus || {};
  const running = (name) => !st[name] || st[name] === 'running';
  // 캠페인이 바뀐 옵션(예전 캠페인이 더 이상 안 도는 경우) → 캠페인 칸 갱신, 마진이 바뀐 옵션 → 마진 칸 갱신 (원본 줄을 고쳐 쓴다)
  const patches = {};   // row number → new body
  for (const o of d.options || []) {
    const ex = existing[cleanId(o.option_id)]; if (!ex) continue;
    const cur = mOf(o.option_id, to); let body = ex.row.body; let changed = false;
    if (o.campaign && ex.campaign && o.campaign !== ex.campaign && !running(ex.campaign) && running(o.campaign)) {
      body = body.replace(ex.cells[C1.camp].xml, cellXml(C1.camp, ex.row.r, ex.cells[C1.camp].s, 'str', o.campaign)); changed = true; report.relinked.push({ option_id: o.option_id, from: ex.campaign, to: o.campaign });
    }
    if (cur && typeof ex.margin === 'number' && Math.round(cur) !== Math.round(ex.margin)) {
      body = body.replace(ex.cells[C1.margin].xml, cellXml(C1.margin, ex.row.r, ex.cells[C1.margin].s, 'num', Math.round(cur))); changed = true; report.marginChanged.push({ option_id: o.option_id, from: ex.margin, to: Math.round(cur) });
    }
    if (changed) patches[ex.row.r] = body;
  }
  if (Object.keys(patches).length) {
    let out = ''; let pos = 0;
    for (const row of rows1) { if (patches[row.r] != null) { const open = x1.slice(row.start, x1.indexOf('>', row.start) + 1); out += x1.slice(pos, row.start) + open + patches[row.r] + '</row>'; pos = row.end; } }
    x1 = out + x1.slice(pos); rows1 = parseRows(x1);
  }
  const m1 = sharedMasters(x1); const tpl1 = rowTemplate(x1, rows1, last1, m1);
  const t1 = trimTrailing(x1, rows1, last1); x1 = t1.xml; let r1 = t1.start; const new1 = [];
  const newOpts = (d.options || []).filter((o) => !existing[cleanId(o.option_id)]).sort((a, b) => campNo(a.campaign) - campNo(b.campaign) || (a.sort_order || 0) - (b.sort_order || 0));
  const idTypeOf = (oid) => existing[cleanId(oid)]?.idType || 'num';
  for (const o of newOpts) {
    const cells = [];
    const sOf = (col) => tpl1.cols[col]?.s ?? null;
    cells.push(cellXml(C1.name, r1, sOf(C1.name), 'str', o.product_name || o.product || ''));
    cells.push(/^\d+$/.test(cleanId(o.option_id)) ? cellXml(C1.oid, r1, sOf(C1.oid), 'num', cleanId(o.option_id)) : cellXml(C1.oid, r1, sOf(C1.oid), 'str', cleanId(o.option_id)));
    cells.push(cellXml(C1.camp, r1, sOf(C1.camp), 'str', o.campaign || ''));
    cells.push(cellXml(C1.margin, r1, sOf(C1.margin), 'num', Math.round(mOf(o.option_id, to) || 0)));
    new1.push(`<row r="${r1}" ${tpl1.attrs}>${cells.join('')}</row>`); existing[cleanId(o.option_id)] = { idType: 'num' }; r1++; report.options++;
  }
  x1 = appendRows(x1, new1); x1 = setDimension(x1, Math.max(r1 - 1, last1), null);

  // ---- 2. 광고 줄 ----
  const m2 = sharedMasters(x2); const tpl2 = rowTemplate(x2, rows2, last2, m2);
  const t2 = trimTrailing(x2, rows2, last2); x2 = t2.xml; let r2 = t2.start; const new2 = []; const campsSeen = new Set();
  const ordered2 = Object.keys(tpl2.cols).sort((a, b) => colNum(a) - colNum(b));
  for (const date of dates) {
    const day = d.ads?.[date] || {}; const serial = serialOf(date);
    for (const a of Object.values(day).sort((p, q) => campNo(p.campaign) - campNo(q.campaign) || p.campaign.localeCompare(q.campaign))) {
      campsSeen.add(a.campaign);
      const vals = { [C2.camp]: ['str', a.campaign], [C2.date]: ['num', serial], [C2.target]: ['num', a.target_roas || 0], [C2.budget]: ['num', a.budget || 0], [C2.spend]: ['num', a.spend || 0], [C2.rev]: ['num', a.ad_revenue || 0], [C2.conv]: ['num', a.conversion || 0], [C2.ctr]: ['num', a.ctr || (a.impressions ? (a.clicks || 0) / a.impressions : 0)], [C2.imp]: ['num', a.impressions || 0], [C2.clk]: ['num', a.clicks || 0], [C2.qty]: ['num', a.ad_orders || 0], [C2.action]: ['str', a.action || ''] };
      const cells = ordered2.map((col) => { const t = tpl2.cols[col]; if (t.f) return cellXml(col, r2, t.s, t.t === 'str' ? 'fstr' : 'f', t.f.replace(/\{r\}/g, r2)); const v = vals[col]; return v ? cellXml(col, r2, t.s, v[0], v[1]) : cellXml(col, r2, t.s, 'num', null); });
      new2.push(`<row r="${r2}" ${tpl2.attrs}>${cells.join('')}</row>`); r2++; report.ads++;
    }
  }
  x2 = appendRows(x2, new2); x2 = setDimension(x2, Math.max(r2 - 1, last2), null);

  // ---- 3. 매출 줄 ----
  const m3 = sharedMasters(x3); const tpl3 = rowTemplate(x3, rows3, last3, m3);
  const t3 = trimTrailing(x3, rows3, last3); x3 = t3.xml; let r3 = t3.start; const new3 = [];
  const ordered3 = Object.keys(tpl3.cols).sort((a, b) => colNum(a) - colNum(b));
  for (const date of dates) {
    const day = d.sales?.[date] || {}; const serial = serialOf(date);
    for (const s of Object.values(day).sort((p, q) => String(p.option_id).localeCompare(String(q.option_id)))) {
      const oid = cleanId(s.option_id); const idKind = idTypeOf(oid) === 'str' || !/^\d+$/.test(oid) ? 'str' : 'num';
      const pid = cleanId(s.product_id); const pidKind = /^\d+$/.test(pid) ? 'num' : 'str';
      const vals = { [C3.date]: ['num', serial], [C3.oid]: [idKind, oid], [C3.oname]: ['str', s.option_name || ''], [C3.pname]: ['str', s.product_name || ''], [C3.pid]: [pidKind, pid], [C3.cat]: ['str', s.category || ''], [C3.how]: ['str', s.sales_type || ''], [C3.rev]: ['num', s.revenue || 0], [C3.orders]: ['num', s.orders || 0], [C3.qty]: ['num', s.quantity ?? s.qty ?? 0], [C3.vis]: ['num', s.visitors || 0], [C3.views]: ['num', s.views || 0], [C3.cart]: ['num', s.carts || 0], [C3.conv]: ['num', s.conversion || 0] };
      const cells = ordered3.map((col) => { const t = tpl3.cols[col]; if (t.f) return cellXml(col, r3, t.s, t.t === 'str' ? 'fstr' : 'f', t.f.replace(/\{r\}/g, r3)); const v = vals[col]; return v ? cellXml(col, r3, t.s, v[0], v[1]) : cellXml(col, r3, t.s, 'num', null); });
      new3.push(`<row r="${r3}" ${tpl3.attrs}>${cells.join('')}</row>`); r3++; report.sales++;
    }
  }
  x3 = appendRows(x3, new3); x3 = setDimension(x3, Math.max(r3 - 1, last3), null);

  // ---- 4. 장부: 새 캠페인 블록 복제 ----
  let x4 = dec.decode(files[s4.path]); const rows4 = parseRows(x4); const m4 = sharedMasters(x4);
  const blocks = [];   // { name, start(row r), end }
  for (let i = 0; i < rows4.length; i++) {
    const cells = cellsOf(rows4[i].body); const label = norm(cellValue(cells.B, shared));
    if (label.startsWith('목표효율')) { const name = String(cellValue(cells.A, shared) ?? '').trim(); blocks.push({ name, startIdx: i, endIdx: i }); }
    else if (blocks.length && label.startsWith('순이익') && blocks[blocks.length - 1].endIdx === blocks[blocks.length - 1].startIdx) blocks[blocks.length - 1].endIdx = i;
  }
  const have = new Set(blocks.map((b) => norm(b.name)).filter(Boolean));
  const wanted = [...new Set([...campsSeen, ...(d.options || []).map((o) => o.campaign)])].filter((n) => n && !have.has(norm(n)) && running(n)).sort((a, b) => campNo(a) - campNo(b));
  // 날짜 열(3번째 줄쯤에 날짜 일련번호가 있는 열) — 새 블록의 '자연 판매 수' 줄을 채울 때 쓴다
  const dateCols = new Set();
  for (const row of rows4.slice(0, 6)) { const cells = cellsOf(row.body); const ds = Object.entries(cells).filter(([, c]) => { const v = cellValue(c, shared); return typeof v === 'number' && v > 20000 && v < 80000; }); if (ds.length >= 7) { for (const [col] of ds) dateCols.add(col); break; } }
  let new4 = []; let r4 = rows4.length ? rows4[rows4.length - 1].r : 0; let maxCol4 = null;
  if (wanted.length && blocks.length) {
    const tb = blocks[blocks.length - 1]; if (tb.endIdx === tb.startIdx) throw new Error("'4. 광고 장부확인' 마지막 캠페인 블록의 '순이익' 줄을 찾지 못했습니다");
    const tplRows = rows4.slice(tb.startIdx, tb.endIdx + 1).map((row) => {
      const cells = cellsOf(row.body); const list = Object.entries(cells).sort((a, b) => colNum(a[0]) - colNum(b[0]));
      return { attrs: rowAttrsWithout(row.attrs), r: row.r, cells: list.map(([col, c]) => ({ col, s: c.s, t: c.t, f: formulaOf(c, col + row.r, m4), raw: c })) };
    });
    const base = tplRows[0].r; const nameCol = 'A';
    const labelRow = (key) => tplRows.find((tr) => { const b = tr.cells.find((c) => c.col === 'B'); return b && norm(cellValue(b.raw, shared)).startsWith(key); });
    const rowAdQty = labelRow('광고전환판매수'), rowReal = labelRow('실제판매수'), rowOrganic = labelRow('자연판매수');
    for (const name of wanted) {
      const delta = r4 + 1 - base;
      for (const tr of tplRows) {
        const r = tr.r + delta;
        // '자연 판매 수' 줄은 원본에 칸 자체가 없는 날짜 열도 있어 채워 넣는다
        const list = tr === rowOrganic && rowReal && rowAdQty ? [...tr.cells, ...[...dateCols].filter((col) => !tr.cells.some((c) => c.col === col)).map((col) => ({ col, s: tr.cells.find((c) => dateCols.has(c.col))?.s ?? null, t: null, f: null, raw: { inner: '' } }))].sort((a, b) => colNum(a.col) - colNum(b.col)) : tr.cells;
        const cells = list.map((c) => {
          if (c.col === nameCol && tr.r === base) return cellXml('A', r, c.s, 'str', name);
          if (c.f) return cellXml(c.col, r, c.s, c.t === 'str' ? 'fstr' : 'f', shiftRefs(c.f, 0, delta));
          if (tr === rowOrganic && rowReal && rowAdQty && dateCols.has(c.col)) return cellXml(c.col, r, c.s, 'f', `${c.col}${rowReal.r + delta}-${c.col}${rowAdQty.r + delta}`);   // 자연 판매 수 = 실제 − 광고 전환 (원본은 일부 열만 채워져 있어 새 블록은 전부 채운다)
          if (hasValue(c.raw)) return `<c r="${c.col}${r}"${c.s != null ? ` s="${c.s}"` : ''}${c.t ? ` t="${c.t}"` : ''}>${c.raw.inner}</c>`;   // 항목 이름(문자열)·상수는 그대로
          return cellXml(c.col, r, c.s, 'num', null);
        });
        new4.push(`<row r="${r}" ${tr.attrs}>${cells.join('')}</row>`); maxCol4 = maxCol4 || tr.cells[tr.cells.length - 1]?.col; r4 = r;
      }
      report.campaigns.push(name);
    }
    x4 = appendRows(x4, new4); x4 = setDimension(x4, r4, null);
  }

  // ---- 저장: 다시 계산하도록 하고 calcChain 은 뺀다 (엑셀이 열 때 새로 만든다) ----
  const out = { ...files };
  out[s1.path] = enc.encode(x1); out[s2.path] = enc.encode(x2); out[s3.path] = enc.encode(x3); out[s4.path] = enc.encode(x4);
  let wb = dec.decode(files['xl/workbook.xml']);
  wb = /<calcPr\b/.test(wb) ? wb.replace(/<calcPr\b([^>]*?)\/?>/, (m, a) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`) : wb.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
  out['xl/workbook.xml'] = enc.encode(wb);
  if (out['xl/calcChain.xml']) {
    delete out['xl/calcChain.xml'];
    out['xl/_rels/workbook.xml.rels'] = enc.encode(dec.decode(files['xl/_rels/workbook.xml.rels']).replace(/<Relationship\b[^>]*calcChain[^>]*\/>/, ''));
    out['[Content_Types].xml'] = enc.encode(dec.decode(files['[Content_Types].xml']).replace(/<Override\b[^>]*calcChain[^>]*\/>/, ''));
  }
  const bytes = await zip(out);
  return { bytes, report };
}
