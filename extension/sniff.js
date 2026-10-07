// 광고센터 화면이 서버에서 받아 오는 데이터(JSON)에서 옵션ID(vendorItemId 등)와 이름을 모아 둔다.
// 화면 글자 모양(표·'ID:' 표기)이 바뀌어도 캠페인 상품 목록을 읽을 수 있게 하려는 것. 페이지 쪽(MAIN)에서 문서 시작 때 실행된다.
// 모은 것은 <html data-cc-items> 에 JSON 으로 둔다 (확장의 content.js 가 읽음). 다른 곳으로 보내지 않는다.
(() => {
  if (window.__ccSniff) return; window.__ccSniff = true;
  const found = {}; const keys = new Set(); let responses = 0;
  const ID_KEY = /^(vendorItemId|vendorItemIds|optionId|vendorItemIdList|itemId|vid)$/i;
  const NAME_KEY = /^(vendorItemName|itemName|optionName|productName|sellerProductName|name|title)$/i;
  const walk = (o, depth) => {
    if (!o || depth > 9) return;
    if (Array.isArray(o)) { for (const x of o.slice(0, 3000)) walk(x, depth + 1); return; }
    if (typeof o !== 'object') return;
    let ids = [], name = '';
    for (const [k, v] of Object.entries(o)) {
      if (keys.size < 400) keys.add(k);
      if (ID_KEY.test(k)) { for (const x of Array.isArray(v) ? v : [v]) if ((typeof x === 'number' || typeof x === 'string') && /^\d{8,}$/.test(String(x))) ids.push(String(x)); }
      else if (NAME_KEY.test(k) && typeof v === 'string' && v.length > name.length) name = v;
    }
    for (const id of ids) if (!found[id] || name.length > found[id].length) found[id] = name;
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  const publish = () => { try { const el = document.documentElement; if (!el) return; el.dataset.ccItems = JSON.stringify(Object.entries(found).slice(0, 800)); el.dataset.ccKeys = [...keys].slice(0, 150).join(','); el.dataset.ccResponses = String(responses); } catch { /* 무시 */ } };
  const take = (text) => { if (typeof text !== 'string' || text.length > 8e6) return; const t = text.trim(); if (t[0] !== '{' && t[0] !== '[') return; try { responses++; walk(JSON.parse(t), 0); publish(); } catch { /* 무시 */ } };
  const of = window.fetch;
  if (of) window.fetch = function (...a) { const p = of.apply(this, a); p.then((r) => { try { r.clone().text().then(take).catch(() => {}); } catch { /* 무시 */ } }).catch(() => {}); return p; };
  const os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) { try { this.addEventListener('load', () => { try { if (!this.responseType || this.responseType === 'text') take(this.responseText); else if (this.responseType === 'json') { responses++; walk(this.response, 0); publish(); } } catch { /* 무시 */ } }); } catch { /* 무시 */ } return os.apply(this, a); };
})();
