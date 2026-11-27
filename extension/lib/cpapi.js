// 쿠팡 윙 Open API (공식 판매자 API): HMAC 서명 · 로켓그로스 재고 · 로켓그로스 주문
// 키는 chrome.storage.local 'cpApi' = { vendorId, accessKey, secretKey } 에만 둔다 (백업 파일·동기화에 넣지 않음)
// 문서: developers.coupang.com — HMAC Signature 생성 / 로켓창고 재고 API / 로켓그로스 주문 API(목록 쿼리)
export const CP_HOST = 'https://api-gateway.coupang.com';
export const CP_ORIGIN = 'https://api-gateway.coupang.com/*';
export const RG_INVENTORY = (v) => `/v2/providers/rg_open_api/apis/api/v1/vendors/${encodeURIComponent(v)}/rg/inventory/summaries`;
export const RG_ORDERS = (v) => `/v2/providers/rg_open_api/apis/api/v1/vendors/${encodeURIComponent(v)}/rg/orders`;
const PAGE_GAP_MS = 1300;   // 분당 50회 제한 → 한 번 부르고 1.3초 쉼

// 서명 시각: GMT 기준 yyMMdd'T'HHmmss'Z' (예: 261127T053105Z)
export const signedDate = (now = new Date()) => now.toISOString().slice(2, 19).replace(/[-:]/g, '') + 'Z';
// 보내는 쿼리 그대로 서명한다 (넣은 순서 유지, 빈 값은 'key=' 로)
export const buildQuery = (params = {}) => Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
export async function hmacHex(secret, message) {
  const enc = new TextEncoder(); const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Authorization: CEA algorithm=HmacSHA256, access-key=…, signed-date=…, signature=hex(HMAC(secret, 시각+메서드+경로+쿼리))
export async function authHeader({ accessKey, secretKey }, method, path, query = '', now = new Date()) {
  const dt = signedDate(now); const sig = await hmacHex(secretKey, dt + method + path + query);
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${dt}, signature=${sig}`;
}
export const credsOk = (c) => !!(c && /^A\d{5,}$/i.test(String(c.vendorId || '').trim()) && c.accessKey && c.secretKey);

// 응답 오류를 알아듣기 쉬운 말로 (키·IP·횟수)
export function explainError(status, body = '') {
  const b = String(body || '').slice(0, 300);
  if (status === 401) return `키가 맞지 않거나 기간(180일)이 끝났습니다. 윙 → OPEN API 키 화면의 Access Key · Secret Key 를 다시 넣어 주세요 (${b})`;
  if (status === 403) return /ip|IP|address|허용|whitelist/i.test(b) || !b ? `이 PC 의 인터넷 주소(IP)가 키에 등록돼 있지 않습니다. 집 인터넷 IP 가 바뀌었을 수 있으니 findip.kr 에서 지금 IP 를 확인해 윙 → OPEN API 키 → 수정에서 추가하세요 (${b})` : `거절됨: ${b}`;
  if (status === 429) return '너무 자주 불렀습니다 (분당 50회 제한). 잠시 뒤 다시 하세요';
  if (status === 400) return `요청 값이 맞지 않습니다 — 업체코드(A로 시작)를 확인하세요 (${b})`;
  return `HTTP ${status} ${b}`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// GET 한 번 (429 면 한 번 쉬었다 다시)
export async function cpGet(creds, path, params = {}, { fetchImpl = fetch, now } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const query = buildQuery(params);
    const auth = await authHeader(creds, 'GET', path, query, now ? now() : new Date());
    const r = await fetchImpl(`${CP_HOST}${path}${query ? '?' + query : ''}`, { method: 'GET', headers: { Authorization: auth, 'Content-Type': 'application/json;charset=UTF-8' } });
    const text = await r.text();
    if (r.status === 429 && !attempt) { await sleep(15000); continue; }
    if (!r.ok) { const e = new Error(explainError(r.status, text)); e.status = r.status; throw e; }
    try { return JSON.parse(text); } catch { throw new Error(`응답을 읽지 못했습니다: ${text.slice(0, 200)}`); }
  }
  throw new Error(explainError(429));
}
// 로켓창고 재고 전체 (nextToken 으로 끝까지)
export async function rgInventoryAll(creds, { fetchImpl, gap = PAGE_GAP_MS, maxPages = 200, onPage } = {}) {
  const out = []; let token = null; let pages = 0;
  do {
    if (pages) await sleep(gap);
    const j = await cpGet(creds, RG_INVENTORY(creds.vendorId.trim()), token ? { nextToken: token } : {}, { fetchImpl });
    out.push(...(j.data || [])); pages++; onPage?.(pages, out.length);
    const nt = j.nextToken ? String(j.nextToken) : null; token = nt && nt !== token ? nt : null;
  } while (token && pages < maxPages);
  return { items: out, pages };
}
// 로켓그로스 주문 (결제일 기준, 한 번에 최대 30일 → 나눠 부름)
const ymd = (iso) => iso.replace(/-/g, '');
const addDaysIso = (iso, n) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export function dateChunks(from, to, span = 30) { const out = []; for (let a = from; a <= to; a = addDaysIso(a, span)) { const b = addDaysIso(a, span - 1); out.push([a, b < to ? b : to]); } return out; }
export async function rgOrders(creds, from, to, { fetchImpl, gap = PAGE_GAP_MS, maxPages = 500 } = {}) {
  const out = []; let pages = 0;
  for (const [a, b] of dateChunks(from, to)) {
    let token = null;
    do {
      if (pages) await sleep(gap);
      const j = await cpGet(creds, RG_ORDERS(creds.vendorId.trim()), { paidDateFrom: ymd(a), paidDateTo: ymd(b), ...(token ? { nextToken: token } : {}) }, { fetchImpl });
      out.push(...(j.data || [])); pages++;
      const nt = j.nextToken ? String(j.nextToken) : null; token = nt && nt !== token ? nt : null;
    } while (token && pages < maxPages);
  }
  return { orders: out, pages };
}

// 재고 API 응답 → 재고 줄 (이름은 판매 기록·예전 재고에서)
// names: { option_id: { product_name, option_name, product_id } }
export function inventoryRowsFromApi(items, names = {}) {
  const rows = [];
  for (const x of items || []) {
    const oid = String(x?.vendorItemId ?? '').trim(); if (!oid || oid === '0') continue;
    const stock = Number(x?.inventoryDetails?.totalOrderableQuantity); const s30 = Number(x?.salesCountMap?.SALES_COUNT_LAST_THIRTY_DAYS);
    const n = names[oid] || {};
    rows.push({ option_id: oid, stock: Number.isFinite(stock) ? stock : 0, sales30: Number.isFinite(s30) ? s30 : null, sku: x?.externalSkuId != null ? String(x.externalSkuId) : '', product_name: n.product_name || '', option_name: n.option_name || '', product_id: n.product_id || '', source: 'api' });
  }
  return rows;
}
// 주문 → 날짜(한국 시각)별 옵션별 수량·금액
export function ordersByDay(orders) {
  const out = {};
  for (const o of orders || []) {
    const t = Number(o?.paidAt); if (!Number.isFinite(t)) continue;
    const day = new Date(t + 9 * 3600000).toISOString().slice(0, 10);
    for (const it of o.orderItems || []) {
      const oid = String(it?.vendorItemId ?? ''); if (!oid || oid === '0') continue;
      const q = Number(it.salesQuantity) || 0; const p = Number(String(it.unitSalesPrice ?? '').replace(/,/g, '')) || 0;
      const c = ((out[day] ||= {})[oid] ||= { option_id: oid, product_name: it.productName || '', quantity: 0, revenue: 0, orders: 0 });
      c.quantity += q; c.revenue += q * p; c.orders += 1;
    }
  }
  return out;
}
