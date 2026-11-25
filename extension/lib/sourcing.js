// 소싱 계산기 (엑셀 '소싱계산기(사뚜)' 탭을 그대로): 판매가·쿠팡 판매수수료·물류수수료로 적정원가, 국내사입/해외사입 마진·마진율·제로 ROAS
// d.sourcing = { rows: [행], fx: 350 (CN→KR 환율, 보수적으로), target: 0.4 (적정원가 계산의 목표 마진율) }
// d.feeTable = [{ big, mid, small, rate }] (카테고리별 판매수수료, 엑셀 '평균가격 산출 & 수수료' 탭에서)
export const DEFAULT_SOURCING = { fx: 350, target: 0.4 };
export const STEPS = [['sourced', '상품소싱'], ['listed', '상품등록'], ['shipped', '출고'], ['received', '입고'], ['conv', '전환세팅'], ['ads', '광고세팅']];
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[,\s원%]/g, '')); return Number.isFinite(n) ? n : null; };
// 판매수수료: 0.108 또는 10.8(%) 둘 다 받는다
export const feeRate = (v) => { const n = num(v); return n == null ? null : n > 1 ? n / 100 : n; };
const rd100 = (x) => Math.trunc(x / 100) * 100;   // 엑셀 ROUNDDOWN(x,-2) (0 쪽으로)

// 한 줄 계산 (엑셀 수식 그대로, VAT 1.1)
export function computeRow(r, st = {}) {
  const fx = Number(st.fx ?? DEFAULT_SOURCING.fx) || DEFAULT_SOURCING.fx; const target = Number(st.target ?? DEFAULT_SOURCING.target);
  const E = num(r.price) || 0, F = feeRate(r.fee) || 0, G = num(r.logi) || 0, J = num(r.costKr), P = num(r.costCn);
  const fees = (E * F + G) * 1.1;
  const out = { fair: E ? rd100(E - (E * F + G + E * target) * 1.1) : null, fees };
  if (J != null) { out.krFinal = J + G * 1.1; out.krMargin = E - fees - J; out.krRate = E ? out.krMargin / E : null; out.krZero = out.krMargin ? (E / out.krMargin) * 1.1 : null; }
  if (P != null) { out.cnKr = P * fx; out.cnFinal = out.cnKr + G * 1.1; out.cnMargin = E - fees - out.cnKr; out.cnRate = E ? out.cnMargin / E : null; out.cnZero = out.cnMargin ? (E / out.cnMargin) * 1.1 : null; }
  return out;
}

// 엑셀 → 행. '판매가격' 과 '원가(CN)' 칸이 있는 줄을 제목 줄로 보고, 같은 이름(상품링크·마진…)은 앞에서부터 국내 → 해외 순서
export function importSourcingSheet(rows) {
  const norm = (v) => String(v ?? '').replace(/\s+/g, '');
  const hi = rows.findIndex((r) => r && r.some((c) => /^판매가격/.test(norm(c))) && r.some((c) => /원가\(CN\)/i.test(norm(c))));
  if (hi < 0) return null;
  const h = rows[hi].map(norm); const at = (re, nth = 0) => { let c = 0; for (let i = 0; i < h.length; i++) if (re.test(h[i])) { if (c === nth) return i; c++; } return -1; };   // nth 번째로 맞는 칸
  const cPrice = at(/^판매가격/), cFee = at(/판매수수료/), cLogi = at(/물류수수료/), cLinkKr = at(/^상품링크$/, 0), cCostKr = at(/^원가$/), cLinkCn = at(/^상품링크$/, 1), cCostCn = at(/^원가\(CN\)$/i);
  // 키워드·시즌·No. 는 판매가격 앞쪽 칸 (윗줄 제목: 'No.', '소싱 상품 메인 키워드', '시즌')
  const top = rows[hi - 1] ? rows[hi - 1].map(norm) : []; const tAt = (re) => top.findIndex((c) => re.test(c));
  const cNo = tAt(/^no\.?$/i), cKey = tAt(/키워드|상품/), cSeason = tAt(/^시즌$/), cPid = tAt(/노출상품id/i);
  const cProg = at(/^진행$/), cTodo = at(/^todo$/i); const step = Object.fromEntries(STEPS.map(([k, label]) => [k, at(new RegExp('^' + label + '$'))]));
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    if (!r) continue; const kw = cKey >= 0 ? String(r[cKey] ?? '').trim() : ''; const price = num(r[cPrice]);
    if (!kw && !price) continue;
    const s = (i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const st = {}; for (const [k] of STEPS) st[k] = s(step[k]) === '완료';
    out.push({ id: Math.random().toString(36).slice(2, 10), no: s(cNo), keyword: kw, season: s(cSeason).replace(/\s+/g, ''), price: price ?? '', fee: feeRate(r[cFee]) ?? '', logi: num(r[cLogi]) ?? '', linkKr: s(cLinkKr), costKr: num(r[cCostKr]) ?? '', linkCn: s(cLinkCn), costCn: num(r[cCostCn]) ?? '', productId: s(cPid).replace(/\.0$/, ''), progress: s(cProg), todo: s(cTodo), steps: st, category: '' });
  }
  return out;
}
// 카테고리 판매수수료 표: '대분류 | 중분류 | 소분류 | 기준 수수료' (빈 칸은 위 줄 값을 이어 씀)
export function importFeeTable(rows) {
  const norm = (v) => String(v ?? '').replace(/\s+/g, '');
  const hi = rows.findIndex((r) => r && r.some((c) => norm(c) === '대분류') && r.some((c) => /수수료/.test(norm(c))));
  if (hi < 0) return [];
  const h = rows[hi].map(norm); const cB = h.indexOf('대분류'), cM = h.indexOf('중분류'), cS = h.indexOf('소분류'), cR = h.findIndex((c) => /수수료/.test(c));
  const out = []; let big = '', mid = '';
  for (const r of rows.slice(hi + 1)) {
    if (!r) continue; const rate = feeRate(r[cR]); if (rate == null) continue;
    if (r[cB]) big = String(r[cB]).trim(); if (r[cM]) mid = String(r[cM]).trim(); const small = String(r[cS] ?? '').trim();
    out.push({ big, mid, small: small === '-' ? '' : small, rate });
  }
  return out;
}
export const feeLabel = (f) => [f.big, f.mid, f.small].filter(Boolean).join(' > ') + ` (${Math.round(f.rate * 1000) / 10}%)`;
export const newRow = () => ({ id: Math.random().toString(36).slice(2, 10), no: '', keyword: '', season: '비시즌', price: '', fee: '', logi: '', linkKr: '', costKr: '', linkCn: '', costCn: '', productId: '', progress: '', todo: '', steps: Object.fromEntries(STEPS.map(([k]) => [k, false])), category: '' });
// CSV (엑셀로 열기)
export function sourcingCsv(rows, st) {
  const q = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const head = ['No.', '키워드', '시즌', '판매가격', '판매수수료', '물류수수료', '적정원가', '국내 링크', '국내 원가', '국내 최종원가', '국내 마진', '국내 마진율', '국내 제로ROAS', '해외 링크', '원가(CN)', '원가(KR)', '해외 최종원가', '해외 마진', '해외 마진율', '해외 제로ROAS', '노출상품ID', '카테고리', '진행', 'TO DO', ...STEPS.map(([, l]) => l)];
  const r2 = (v) => (v == null ? '' : Math.round(v * 100) / 100);
  const body = rows.map((r) => { const c = computeRow(r, st); return [r.no, r.keyword, r.season, r.price, r.fee, r.logi, c.fair, r.linkKr, r.costKr, r2(c.krFinal), r2(c.krMargin), r2(c.krRate), r2(c.krZero), r.linkCn, r.costCn, r2(c.cnKr), r2(c.cnFinal), r2(c.cnMargin), r2(c.cnRate), r2(c.cnZero), r.productId, r.category, r.progress, r.todo, ...STEPS.map(([k]) => (r.steps?.[k] ? '완료' : '미완료'))]; });
  return [head, ...body].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
