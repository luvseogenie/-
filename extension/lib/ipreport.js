// 지식재산권 신고: 쿠팡 판매자 지원센터 웹폼(지재권 침해 신고)을 사유별 템플릿으로 채우고 제출한다.
// d.ipForm = { url, readAt, fields: [{ key, label, type, name, required, options: [{ value, label }] }] }   (확장이 웹폼을 읽어 만든 칸 목록)
// d.ipTemplates = [{ id, name, values: { 칸key: 글 또는 고를 항목 }, files: [{ id, name, type, size }] }]   (첨부 파일 내용은 chrome.storage.local 'ipfile:<id>')
// d.ipHistory = [{ at, templateId, templateName, target: { url, productId, seller, product, note }, status, ticket, error }]
export const IP_FORM_URL = 'https://sellersupport-help.coupangcorp.com/hc/ko/requests/new?ticket_form_id=900000083223';
export const IP_ORIGIN = 'https://sellersupport-help.coupangcorp.com/*';
export const PLACEHOLDERS = [['상품URL', '침해 상품 주소'], ['상품ID', '주소 속 상품 번호'], ['상품명', '침해 상품 이름'], ['판매자', '침해 판매자 이름'], ['메모', '이번 신고만의 메모'], ['날짜', '오늘 날짜']];

export const productIdOf = (url) => (String(url || '').match(/products\/(\d{5,})/) || String(url || '').match(/^\s*(\d{6,})\s*$/) || [])[1] || '';
// 템플릿 글의 {상품URL} 같은 빈칸을 이번 신고 내용으로 바꾼다 (모르는 빈칸은 그대로)
export function fillText(text, target = {}, today = new Date().toISOString().slice(0, 10)) {
  const v = { 상품URL: target.url || '', 상품ID: target.productId || productIdOf(target.url), 상품명: target.product || '', 판매자: target.seller || '', 메모: target.note || '', 날짜: today };
  return String(text ?? '').replace(/\{([^{}]+)\}/g, (m, k) => (k.trim() in v ? v[k.trim()] : m));
}
// 신고 대상 여러 줄: '주소 [탭/| 판매자 [| 상품명]]' — 한 줄에 하나
export function parseTargets(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [url, seller = '', product = '', note = ''] = l.split(/\t|\s*\|\s*/).map((x) => x.trim());
    return { url, productId: productIdOf(url), seller, product, note };
  }).filter((t) => t.url);
}
// 같은 사유로 같은 상품을 이미 제출했는지 (최근 90일)
export function alreadyReported(history, templateId, target, days = 90) {
  const since = Date.now() - days * 86400000; const pid = target.productId || productIdOf(target.url);
  return (history || []).find((h) => h.templateId === templateId && h.status === 'submitted' && new Date(h.at).getTime() >= since && ((pid && (h.target?.productId || productIdOf(h.target?.url)) === pid) || h.target?.url === target.url)) || null;
}
// 템플릿 → 웹폼에 넣을 값 목록 (칸 순서대로, 빈 값은 뺌). 고르는 칸은 항목 글자 또는 값
export function formValues(form, template, target, today) {
  const out = [];
  for (const f of form?.fields || []) {
    if (f.type === 'file') continue; const raw = template?.values?.[f.key]; if (raw == null || raw === '') continue;
    const val = f.options?.length ? raw : fillText(raw, target, today);
    out.push({ key: f.key, name: f.name, type: f.type, label: f.label, value: val, options: f.options || [] });
  }
  return out;
}
// 템플릿에서 아직 안 채운 필수 칸
export function missingRequired(form, template) {
  return (form?.fields || []).filter((f) => f.required && f.type !== 'file' && f.type !== 'hidden' && !(template?.values?.[f.key] ?? '').toString().trim()).map((f) => f.label || f.name);
}
