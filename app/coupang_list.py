"""쿠팡 공개 페이지 수집: 카테고리 목록, 하위 카테고리, 상품 상세 가격.

화면 구조가 바뀌어도 버티도록 class 이름 대신 링크 주소(/vp/products/, /np/categories/)와
글자 패턴으로 값을 찾는다. 하나도 못 찾으면 data/debug 에 화면과 HTML을 저장한다.
"""
import json
import re
import time
from datetime import datetime
from urllib.parse import quote

from . import config
from . import log


class BlockedError(Exception):
    """쿠팡이 접근을 막았을 때."""


# 페이지 안에서 같은 출처로 fetch 를 실행하는 스크립트 (윙·쿠팡 공용)
FETCH_JS = """
async (args) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), args.timeout_ms || 20000);
  const opt = { method: args.method || 'GET', credentials: 'include', headers: args.headers || {}, signal: ctrl.signal };
  if (args.body !== undefined && args.body !== null) opt.body = args.body;
  try {
    const r = await fetch(args.url, opt);
    const text = await r.text();
    clearTimeout(timer);
    return { status: r.status, url: r.url, ctype: r.headers.get('content-type') || '', text: text.slice(0, 2000000), redirected: r.redirected };
  } catch (e) { clearTimeout(timer); return { status: 0, url: args.url, ctype: '', text: '', error: String(e).includes('abort') ? '응답 시간 초과(20초)' : String(e) }; }
}
"""

QUANTITY_URL = ("https://www.coupang.com/next-api/products/quantity-info?productId={pid}&vendorItemId={vid}"
                "&deliveryToggle=true&landingItemId={iid}&landingProductId={pid}&landingVendorItemId={vid}")
BTF_URL = "https://www.coupang.com/next-api/products/btf?productId={pid}&vendorItemId={vid}&itemId={iid}"
_debug_budget = {"left": 3}


def reset_debug_budget(n: int = 3):
    _debug_budget["left"] = n


def _num(v):
    if v is None:
        return None
    m = re.search(r"[\d,]+", str(v))
    return int(m.group(0).replace(",", "")) if m else None


def _buyers_from_text(text: str):
    m = re.search(r"([\d,]+)\s*명\s*이상\s*(?:이\s*)?구매", text) or re.search(r"([\d,]+)\s*개\s*이상\s*(?:판매|구매)", text)
    return _num(m.group(1)) if m else None


# 상품 목록 한 페이지에서 상품 정보를 뽑아내는 브라우저 스크립트
EXTRACT_JS = r"""
() => {
  const num = (s) => { if (s === null || s === undefined) return null;
    const m = String(s).replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  const txt = (el) => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const cls = (el) => (el && typeof el.className === 'string') ? el.className.toLowerCase() : '';
  const findByClass = (root, frags) => {
    const all = root.querySelectorAll('*');
    for (const el of all) { const c = cls(el); if (frags.some(f => c.includes(f))) return el; }
    return null;
  };
  // 상품 카드(li) 안의 링크를 우선으로 하고, 카드 밖의 상품 링크(상단 광고 등)는 광고로 표시한다
  const units = Array.from(document.querySelectorAll('li[class*="ProductUnit"], li.baby-product, li.search-product'));
  const anchors = Array.from(document.querySelectorAll('a[href*="/vp/products/"]'));
  const seen = new Set();
  const out = [];
  let rank = 0;
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/vp\/products\/(\d+)/);
    if (!m) continue;
    let li = a.closest('li') || a.closest('[class*="product"], [class*="Product"]') || a;
    if (seen.has(li)) continue;
    seen.add(li);
    const inUnit = units.length === 0 || units.some(u => u === li || u.contains(a));
    let url;
    try { url = new URL(href, location.origin); } catch (e) { continue; }
    const itemId = url.searchParams.get('itemId') || a.dataset.itemId || null;
    const vendorItemId = url.searchParams.get('vendorItemId') || a.dataset.vendorItemId || null;

    // 상품명
    let nameEl = li.querySelector('.name') || findByClass(li, ['productname', 'product-name', 'title']);
    let name = txt(nameEl);
    if (!name) { const img = li.querySelector('img[alt]'); name = img ? img.getAttribute('alt').trim() : ''; }
    if (!name) name = txt(a);

    // 가격 (할인 전 가격 del, 단위가격 unit 은 제외)
    let priceEl = li.querySelector('.price-value') || findByClass(li, ['pricevalue', 'price-value', 'saleprice', 'sale-price']);
    let price = priceEl ? num(txt(priceEl)) : null;
    if (price === null) {
      const clone = li.cloneNode(true);
      clone.querySelectorAll('del, [class*="unit"], [class*="base-price"], [class*="basePrice"]').forEach(e => e.remove());
      const mm = txt(clone).match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
      price = mm ? num(mm[1]) : null;
    }
    const baseEl = li.querySelector('del') || findByClass(li, ['base-price', 'baseprice']);
    const basePrice = baseEl ? num(txt(baseEl)) : null;

    // 리뷰 수와 평점
    let rcEl = li.querySelector('.rating-total-count') || findByClass(li, ['ratingcount', 'rating-total', 'reviewcount', 'review-count']);
    let reviews = rcEl ? num(txt(rcEl)) : null;
    if (reviews === null) { const mm = txt(li).match(/\(\s*([\d,]+)\s*\)/); reviews = mm ? num(mm[1]) : 0; }
    let ratingEl = li.querySelector('em.rating') || findByClass(li, ['ratingscore', 'rating-score', 'star-rating']);
    let rating = null;
    if (ratingEl) {
      const v = num(txt(ratingEl));
      if (v !== null && v <= 5) rating = v;
      else { const w = (ratingEl.getAttribute('style') || '').match(/width:\s*([\d.]+)%/); if (w) rating = Math.round(Number(w[1]) / 20 * 10) / 10; }
    }
    if (rating === null) { const rm = txt(li).match(/(\d(?:\.\d)?)\s*\(\s*[\d,]+\s*\)/); if (rm && Number(rm[1]) <= 5) rating = Number(rm[1]); }

    // 배송 형태
    const alts = Array.from(li.querySelectorAll('img[alt]')).map(i => i.getAttribute('alt') || '').join(' ') + ' ' + txt(li);
    const srcs = Array.from(li.querySelectorAll('img')).map(i => (i.getAttribute('src') || i.getAttribute('data-src') || '')).join(' ')
      + ' ' + Array.from(li.querySelectorAll('[style*="background"]')).map(e => e.getAttribute('style') || '').join(' ');
    let delivery = 'WING';
    if (/판매자\s*로켓|로켓그로스/.test(alts) || /rocket[_-]?growth|growth/i.test(srcs)) delivery = 'ROCKET_GROWTH';
    else if (/로켓직구/.test(alts) || /global/i.test(srcs)) delivery = 'ROCKET_GLOBAL';
    else if (/로켓프레시/.test(alts) || /fresh/i.test(srcs)) delivery = 'ROCKET_FRESH';
    else if (/로켓배송|로켓와우/.test(alts) || /rocket/i.test(srcs)) delivery = 'ROCKET';
    else if (/도착\s*보장/.test(alts)) delivery = 'ROCKET';

    // 배송 뱃지 그림의 파일 이름 (나중에 상세 페이지 결과로 뱃지→배송형태 대응을 학습)
    let badgeKey = null;
    for (const im of li.querySelectorAll('img')) {
      const src = im.getAttribute('src') || im.getAttribute('data-src') || '';
      if (/badge|delivery|rocket|logo/i.test(src) && !/thumbnail|vendor_inventory|retail\/images/i.test(src)) {
        badgeKey = src.split('?')[0].split('/').pop(); break;
      }
    }
    const isAd = !inUnit || /ad-badge|adbadge|__ad|\bad\b/.test(cls(li)) || !!li.querySelector('[class*="ad-badge"], [class*="adBadge"], [class*="AdMark"], [class*="ad-mark"], [class*="AdBadge"]') || /\bAD\b|광고/.test(txt(li).slice(0, 40));
    const soldOut = /일시품절|품절/.test(txt(li));
    const img = li.querySelector('img');
    const image = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
    rank += 1;
    out.push({ product_id: Number(m[1]), item_id: itemId ? Number(itemId) : null,
      vendor_item_id: vendorItemId ? Number(vendorItemId) : null, name, price, base_price: basePrice,
      review_count: reviews, rating, delivery, badge_key: badgeKey, is_ad: isAd, sold_out: soldOut, image,
      url: 'https://www.coupang.com' + url.pathname + url.search, rank });
  }
  const body = txt(document.body).slice(0, 4000);
  return { items: out, title: document.title, empty: /검색결과가 없습니다|상품이 없습니다|일치하는 상품이 없습니다/.test(body),
    blocked: /Access Denied|접근이 거부|비정상적인 접근|자동화된 접근|Reference #/.test(body + ' ' + document.title) };
}
"""

# 홈 화면 "카테고리" 메뉴에서 1차→2차→3차 전체 트리를 읽는 스크립트
HOME_TREE_JS = r"""
() => {
  const txt = (el) => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const idOf = (a) => { const m = (a.getAttribute('href') || '').match(/\/np\/categories\/(\d+)/); return m ? Number(m[1]) : null; };
  const skip = (name) => !name || /더보기|전체보기/.test(name);
  const out = [];
  const tops = document.querySelectorAll('ul.menu.shopping-menu-list > li');
  for (const li of tops) {
    const a1 = li.querySelector(':scope > a[href*="/np/categories/"]');
    if (!a1) continue;
    const top = { id: idOf(a1), name: txt(a1), children: [] };
    if (!top.id || skip(top.name)) continue;
    for (const li2 of li.querySelectorAll(':scope > div.depth > ul.sdl > li, :scope > div.depth ul.sdl > li')) {
      const a2 = li2.querySelector(':scope > a');
      if (!a2) continue;
      const id2 = idOf(a2); const n2 = txt(a2);
      if (!id2 || skip(n2) || id2 === top.id) continue;
      const sub = { id: id2, name: n2, children: [] };
      for (const a3 of li2.querySelectorAll(':scope > ul.tdl > li > a, :scope ul.tdl > li > a')) {
        const id3 = idOf(a3); const n3 = txt(a3);
        if (!id3 || skip(n3) || id3 === id2 || id3 === top.id) continue;
        if (!sub.children.some(c => c.id === id3)) sub.children.push({ id: id3, name: n3 });
      }
      if (!top.children.some(c => c.id === id2)) top.children.push(sub);
    }
    out.push(top);
  }
  return { tops: out, menu_links: document.querySelectorAll('ul.menu.shopping-menu-list a[href*="/np/categories/"]').length };
}
"""


def fetch_home_tree(page) -> dict:
    """홈 화면에서 카테고리 메뉴를 열고 전체 트리를 읽는다."""
    page.goto(config.COUPANG_HOME, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2000)
    data = page.evaluate(HOME_TREE_JS)
    if data["menu_links"] < 100:
        for sel in ("#wa-category", "#wa-pc-category", "text=카테고리"):
            try:
                page.locator(sel).first.hover(timeout=4000)
                page.wait_for_timeout(1500)
                data = page.evaluate(HOME_TREE_JS)
                if data["menu_links"] >= 100:
                    break
            except Exception:  # noqa: BLE001
                continue
    if data["menu_links"] < 100 or not data["tops"]:
        _dump_debug(page, "home_menu")
        raise RuntimeError(f"홈 화면 카테고리 메뉴를 읽지 못했습니다 (링크 {data['menu_links']}개)")
    return data


# 카테고리 페이지에서 하위 카테고리 링크를 찾는 스크립트
CHILDREN_JS = r"""
(args) => {
  const curId = String(args.cid);
  const exclude = new Set((args.exclude || []).map(String));
  const clean = (s) => s.replace(/\s+/g, ' ').replace(/\(\s*[\d,]+\s*\)\s*$/, '').replace(/\s*[\d,]+\s*$/, '').trim();
  const inChrome = (el) => !!el.closest('header, #header, footer, #footer, nav[aria-label*="GNB"], [id*="gnb"], [class*="gnb"], [class*="Gnb"], [class*="footer"], [class*="Footer"], [class*="header"], [class*="Header"], [class*="breadcrumb"], [class*="Breadcrumb"]');
  const links = Array.from(document.querySelectorAll('a[href*="/np/categories/"]')).map(a => {
    const m = (a.getAttribute('href') || '').match(/\/np\/categories\/(\d+)/);
    return m ? { a, id: m[1], name: clean(a.textContent) } : null;
  }).filter(x => x && x.name);
  const side = links.filter(x => !inChrome(x.a));
  let kids = [];
  let how = '';
  // 새 쿠팡 화면: 왼쪽 필터의 "카테고리" 목록
  const bar = side.filter(x => x.a.closest('li.filter-function-bar-category, [class*="filter-function-bar-category"]'));
  const hasSelf = bar.some(x => x.id === curId);
  if (bar.length) { kids = hasSelf ? [] : bar; how = hasSelf ? 'filter-bar-siblings' : 'filter-bar'; }
  const cur = side.find(x => x.id === curId);
  if (cur && !kids.length && how !== 'filter-bar-siblings') {
    const li = cur.a.closest('li');
    if (li) { kids = side.filter(x => x.a !== cur.a && li.contains(x.a) && x.id !== curId); if (kids.length) how = 'nested'; }
  }
  if (!kids.length && how !== 'filter-bar-siblings') {
    // 현재 카테고리가 링크가 아닌 글자(선택 상태)로 표시된 경우: 그 요소 뒤에 오는 목록
    const marked = Array.from(document.querySelectorAll('li, div, span, strong, b')).filter(el => !inChrome(el) && /selected|active|current|\bon\b|checked|bold/i.test(el.className || '') && el.querySelector('a[href*="/np/categories/"]') === null && el.textContent.trim().length < 40);
    for (const el of marked) {
      const li = el.closest('li') || el.parentElement;
      if (!li) continue;
      const inner = side.filter(x => li.contains(x.a) && x.id !== curId);
      if (inner.length) { kids = inner; how = 'marked'; break; }
    }
  }
  if (!kids.length && how !== 'filter-bar-siblings') { kids = side.filter(x => x.id !== curId); how = 'all-side'; }
  const uniq = new Map();
  for (const k of kids) { if (!exclude.has(k.id) && !uniq.has(k.id)) uniq.set(k.id, k.name); }
  return { children: Array.from(uniq, ([id, name]) => ({ id: Number(id), name })), how, total_links: links.length, side_links: side.length, title: document.title, is_leaf: how === 'filter-bar-siblings' };
}
"""

# 상품 상세 페이지에서 실제 판매가를 읽는 스크립트
DETAIL_PRICE_JS = r"""
() => {
  const txt = (el) => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/\d+/); return m ? Number(m[0]) : null; };
  const body = txt(document.body);
  const blocked = /Access Denied|접근이 거부|비정상적인 접근|Reference #/.test(body.slice(0, 3000) + document.title);
  const cands = [];
  const sels = ['.prod-coupon-price .total-price strong', '[class*="couponPrice"]', '[class*="coupon-price"]',
    '[class*="finalPrice"]', '[class*="final-price"]', '[class*="wowPrice"]', '[class*="memberPrice"]',
    '.prod-sale-price .total-price strong', '.total-price strong',
    '[class*="salePrice"] strong', '[class*="sale-price"] strong', '[class*="price"] strong'];
  for (const s of sels) { for (const el of document.querySelectorAll(s)) { const v = num(txt(el)); if (v && v > 100) cands.push({ sel: s, value: v, text: txt(el) }); } }
  const coupon = /쿠폰|와우할인|다운로드/.test(body.slice(0, 20000));
  const soldOut = /일시품절|품절된 상품/.test(body.slice(0, 20000));
  // 배송 형태: 가격 근처(구매 영역)의 뱃지 그림과 글자로 판별
  let delivery = null, deliveryHow = '';
  const priceEl = document.querySelector('.prod-sale-price, [class*="finalPrice"], [class*="final-price"], [class*="salePrice"], [class*="sale-price"], .total-price');
  let box = priceEl;
  for (let i = 0; i < 6 && box && box.parentElement; i++) { box = box.parentElement; if (box.querySelectorAll('img').length >= 1 && box.textContent.length > 200) break; }
  const scope = box || document.body;
  const topOnly = (el) => { try { const r = el.getBoundingClientRect(); return (r.top + window.scrollY) < 1000; } catch (e) { return true; } };
  const imgs = Array.from(scope.querySelectorAll('img')).filter(im => box ? true : topOnly(im));
  const alts = imgs.map(im => (im.getAttribute('alt') || '') + ' ' + (im.getAttribute('src') || '')).join(' ');
  const near = box ? txt(scope).slice(0, 3000) : '';   // 구매 영역을 못 찾으면 본문은 보지 않는다 (상단 메뉴에 '로켓직구' 글자가 늘 있음)
  // 글자(alt·본문)로만 판정한다. 그림 파일명은 다른 상품 뱃지가 섞여 있어 쓰지 않는다.
  const classify = (t) => {
    if (/판매자\s*로켓|로켓그로스/.test(t)) return 'ROCKET_GROWTH';
    if (/로켓직구/.test(t)) return 'ROCKET_GLOBAL';
    if (/로켓프레시/.test(t)) return 'ROCKET_FRESH';
    if (/로켓설치/.test(t)) return 'ROCKET_INSTALL';
    if (/로켓배송|로켓와우/.test(t)) return 'ROCKET';
    return null;
  };
  const altOnly = imgs.map(im => im.getAttribute('alt') || '').join(' ');
  delivery = classify(altOnly); if (delivery) deliveryHow = 'badge';
  if (!delivery) { delivery = classify(near); if (delivery) deliveryHow = 'text'; }
  // 페이지에 내장된 데이터(스크립트)에서 가격 읽기
  const scriptPrices = {};
  try {
    const scripts = Array.from(document.querySelectorAll('script')).map(sc => sc.textContent || '').filter(t => /finalPrice|couponPrice|salePrice/.test(t));
    const grab = (key) => { for (const t of scripts) { const m = t.match(new RegExp('\\"' + key + '\\"\\s*:\\s*\\"?([\\d,]+)')); if (m) return num(m[1]); } return null; };
    scriptPrices.final = grab('finalPrice'); scriptPrices.coupon = grab('couponPrice'); scriptPrices.sale = grab('salePrice'); scriptPrices.origin = grab('originPrice');
  } catch (e) {}
  if (!delivery) {
    // 판매자 정보에 "쿠팡" 이면 로켓배송(직매입), 그 외엔 판매자배송
    if (/판매자\s*[:：]?\s*쿠팡\b/.test(body) || /쿠팡\s*주식회사/.test(near)) { delivery = 'ROCKET'; deliveryHow = 'seller'; }
    else { delivery = 'WING'; deliveryHow = 'default'; }
  }
  let sellers = null;
  const sm = body.match(/다른\s*판매자\s*(\d+)/) || body.match(/판매자\s*(\d+)\s*곳/);
  if (sm) sellers = Number(sm[1]);
  // "한 달간 1,000명 이상 구매했어요" 같은 문구
  let buyers = null;
  const bm = body.match(/([\d,]+)\s*명\s*이상\s*(?:이\s*)?구매/) || body.match(/([\d,]+)\s*개\s*이상\s*(?:판매|구매)/)
    || (document.documentElement.outerHTML.match(/([\d,]+)\s*명\s*이상\s*(?:이\s*)?구매/));
  if (bm) buyers = num(bm[1]);
  const buyersText = (body.match(/[^.]{0,20}[\d,]+\s*명\s*이상\s*(?:이\s*)?구매[^.]{0,10}/) || [null])[0];
  return { candidates: cands.slice(0, 12), coupon, sold_out: soldOut, blocked, sellers, buyers_min: buyers, buyers_text: buyersText,
    delivery, delivery_how: deliveryHow, script_prices: scriptPrices, title: document.title };
}
"""


# 문제 해결용: 페이지에 있는 카테고리 링크와 그 위치(태그·class 경로)를 요약
DIAG_JS = r"""
() => {
  const txt = (el) => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const chain = (el) => { const parts = []; let cur = el; let n = 0;
    while (cur && cur !== document.body && n < 6) { let c = cur.tagName.toLowerCase();
      if (cur.id) c += '#' + cur.id; const cls = (typeof cur.className === 'string') ? cur.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      if (cls) c += '.' + cls; parts.unshift(c.slice(0, 60)); cur = cur.parentElement; n++; }
    return parts.join(' > '); };
  const cats = Array.from(document.querySelectorAll('a[href*="/np/categories/"]')).map(a => {
    const m = (a.getAttribute('href') || '').match(/\/np\/categories\/(\d+)/);
    return m ? { id: m[1], name: txt(a).slice(0, 30), chain: chain(a) } : null; }).filter(Boolean);
  const prods = document.querySelectorAll('a[href*="/vp/products/"]').length;
  const lists = Array.from(document.querySelectorAll('ul, ol')).filter(u => u.querySelectorAll('a[href*="/np/categories/"]').length >= 2)
    .map(u => ({ chain: chain(u), links: u.querySelectorAll('a[href*="/np/categories/"]').length, direct_li: u.children.length })).slice(0, 25);
  return { title: document.title, url: location.href, product_links: prods, category_links: cats.length, cats: cats.slice(0, 120), lists,
    body_head: txt(document.body).slice(0, 300) };
}
"""


# 홈 화면의 전체 카테고리 메뉴 안 링크를 모두 읽는 스크립트
MENU_JS = r"""
(names) => {
  const txt = (el) => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const chain = (el) => { const parts = []; let cur = el; let n = 0;
    while (cur && cur !== document.body && n < 7) { let c = cur.tagName.toLowerCase();
      if (cur.id) c += '#' + cur.id; const cls = (typeof cur.className === 'string') ? cur.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      if (cls) c += '.' + cls; parts.unshift(c.slice(0, 50)); cur = cur.parentElement; n++; }
    return parts.join(' > '); };
  const all = Array.from(document.querySelectorAll('a[href]'));
  const byName = all.filter(a => names.includes(txt(a))).map(a => ({ text: txt(a), href: a.getAttribute('href'), chain: chain(a) }));
  const catLike = all.filter(a => /categor|\/np\/|\/c\/|\/vm\/|display/i.test(a.getAttribute('href') || ''))
    .map(a => ({ text: txt(a).slice(0, 25), href: (a.getAttribute('href') || '').slice(0, 120), chain: chain(a) }));
  const roots = Array.from(document.querySelectorAll('[class*="categor" i], [id*="categor" i], [class*="gnb" i], [class*="menu" i], nav'))
    .map(el => ({ chain: chain(el), links: el.querySelectorAll('a[href]').length,
      sample: Array.from(el.querySelectorAll('a[href]')).slice(0, 6).map(a => txt(a).slice(0, 20) + ' -> ' + (a.getAttribute('href') || '').slice(0, 90)) }))
    .filter(x => x.links >= 5).slice(0, 25);
  return { total_links: all.length, byName, catLike, roots };
}
"""


def diagnose_site(page, names: list[str]) -> dict:
    """새 쿠팡 화면의 카테고리 주소 방식을 알아내기 위한 진단."""
    out = {"steps": []}
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    def shot(tag):
        try:
            path = config.DEBUG_DIR / f"{stamp}_{tag}.png"
            page.screenshot(path=str(path), full_page=False)
            (config.DEBUG_DIR / f"{stamp}_{tag}.html").write_text(page.content(), encoding="utf-8")
            return path.name
        except Exception as e:  # noqa: BLE001
            return f"(캡처 실패: {e})"

    # 1) 홈 화면
    page.goto(config.COUPANG_HOME, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    before = page.evaluate(MENU_JS, names)
    out["home_url"] = page.url
    out["before"] = before
    # 2) 전체카테고리 메뉴 열기 시도 (hover → click)
    opened = None
    for label in ("전체카테고리", "카테고리", "전체 카테고리"):
        try:
            loc = page.get_by_text(label, exact=False).first
            if loc.count() == 0:
                continue
            loc.hover(timeout=3000)
            page.wait_for_timeout(1200)
            after_hover = page.evaluate(MENU_JS, names)
            if after_hover["total_links"] > before["total_links"] + 5:
                opened = f"hover:{label}"
                break
            loc.click(timeout=3000)
            page.wait_for_timeout(1500)
            after_click = page.evaluate(MENU_JS, names)
            if after_click["total_links"] > before["total_links"] + 5 or page.url != out["home_url"]:
                opened = f"click:{label}"
                break
        except Exception as e:  # noqa: BLE001
            out["steps"].append(f"{label} 열기 실패: {str(e)[:120]}")
    out["opened"] = opened
    out["after"] = page.evaluate(MENU_JS, names)
    out["after_url"] = page.url
    out["screenshot_menu"] = shot("diag_menu")
    # 3) 메뉴에서 1차 카테고리 이름을 실제로 눌러본다
    try:
        target = None
        for n in names:
            loc = page.get_by_role("link", name=n, exact=True)
            if loc.count():
                target = (n, loc.first)
                break
        if target:
            target[1].click(timeout=5000)
            page.wait_for_timeout(3000)
            out["clicked_name"] = target[0]
            out["clicked_url"] = page.url
            out["clicked_products"] = page.evaluate("() => document.querySelectorAll('a[href*=\"/vp/products/\"]').length")
            out["clicked_page"] = page.evaluate(DIAG_JS)
            out["screenshot_cat"] = shot("diag_cat")
        else:
            out["clicked_name"] = None
    except Exception as e:  # noqa: BLE001
        out["steps"].append(f"1차 클릭 실패: {str(e)[:150]}")
    # 4) 알려진 주소 방식으로 직접 접근했을 때 어디로 가는지
    checks = []
    for url in ("https://www.coupang.com/np/categories/393760",
                "https://www.coupang.com/np/categories/185569",
                "https://www.coupang.com/np/search?q=%EB%AC%B4%ED%83%80%EA%B3%B5+%ED%9B%84%ED%81%AC&sorter=saleCountDesc&listSize=72"):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2500)
            n = page.evaluate("() => document.querySelectorAll('a[href*=\"/vp/products/\"]').length")
            checks.append({"url": url, "final": page.url, "products": n, "title": page.title()})
            if n and "search" in url:
                out["screenshot_search"] = shot("diag_search")
        except Exception as e:  # noqa: BLE001
            checks.append({"url": url, "error": str(e)[:150]})
    out["checks"] = checks
    return out


def diagnose_category(page, cid: int) -> dict:
    url = config.CATEGORY_URL.format(cid=cid, size=config.CATEGORY_LIST_SIZE, page=1)
    status = None
    try:
        status = _goto(page, url, 'a[href*="/np/categories/"]')
    except BlockedError as e:
        return {"blocked": str(e), "url": url}
    data = page.evaluate(DIAG_JS)
    data["http_status"] = status
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = config.DEBUG_DIR / f"{stamp}_diag_{cid}"
    try:
        page.screenshot(path=str(base) + ".png", full_page=False)
        (config.DEBUG_DIR / f"{stamp}_diag_{cid}.html").write_text(page.content(), encoding="utf-8")
        data["screenshot"] = f"{stamp}_diag_{cid}.png"
    except Exception as e:  # noqa: BLE001
        data["screenshot_error"] = str(e)
    return data


PAGE_INFO_JS = r"""
() => {
  const txt = (el) => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const pag = Array.from(document.querySelectorAll('[class*="Pagination"] a, [class*="pagination"] a')).filter(a => /\/np\//.test(a.getAttribute('href') || '')).slice(0, 4).map(a => txt(a) + ' -> ' + (a.getAttribute('href') || ''));
  const sorts = Array.from(document.querySelectorAll('a, button, label, li')).filter(el => /랭킹순|판매량순|낮은가격순|최신순/.test(txt(el)) && txt(el).length < 12).slice(0, 8)
    .map(el => txt(el) + (el.getAttribute('href') ? ' -> ' + el.getAttribute('href') : '') + (el.className ? ' [' + String(el.className).slice(0, 40) + ']' : ''));
  const unitEls = Array.from(document.querySelectorAll('li[class*="ProductUnit"], li.baby-product, li.search-product'));
  const cards = unitEls.slice(3, 6).map(u => u.outerHTML.replace(/\s+/g, ' ').slice(0, 2500));
  return { pagination: pag, sorts, product_units: unitEls.length, url: location.href, cards };
}
"""


def _dump_debug(page, tag: str):
    try:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base = config.DEBUG_DIR / f"{stamp}_{tag}"
        page.screenshot(path=str(base) + ".png", full_page=False)
        (config.DEBUG_DIR / f"{stamp}_{tag}.html").write_text(page.content(), encoding="utf-8")
        log.warn(f"확인용 화면을 저장했습니다: data/debug/{stamp}_{tag}.png")
    except Exception as e:  # noqa: BLE001
        log.warn(f"디버그 저장 실패: {e}")


_page_counter = {"n": 0}


def _goto(page, url: str, wait_selector: str | None = None):
    # 상품 페이지는 검색 목록에서 클릭해 들어온 것처럼 출처를 남긴다
    referer = None
    if "/vp/products/" in url:
        referer = "https://www.coupang.com/np/search?q=%EC%83%81%ED%92%88&channel=user"
    _page_counter["n"] += 1
    if config.REST_EVERY and _page_counter["n"] % config.REST_EVERY == 0:
        import random as _r
        pause = _r.uniform(*config.REST_SECONDS)
        log.info(f"페이지 {_page_counter['n']}개째 · {pause:.0f}초 쉽니다")
        time.sleep(pause)
    _human_before_nav(page)
    resp = page.goto(url, wait_until="domcontentloaded", timeout=60000, referer=referer)
    status = resp.status if resp else None
    if status in (403, 429, 503):
        _dump_debug(page, f"blocked_{status}")
        raise BlockedError(f"쿠팡이 접근을 막았습니다 (HTTP {status})")
    if wait_selector:
        try:
            page.wait_for_selector(wait_selector, timeout=15000)
        except Exception:  # noqa: BLE001
            pass
    _human_on_page(page, deep=("/vp/products/" in url))
    return status


def _human_before_nav(page):
    """페이지를 넘기기 전에 사람처럼 마우스를 조금 움직인다."""
    import random as _r
    try:
        w, h = 1200, 800
        try:
            vp = page.viewport_size
            if vp:
                w, h = vp["width"], vp["height"]
        except Exception:  # noqa: BLE001
            pass
        for _ in range(_r.randint(1, 3)):
            page.mouse.move(_r.randint(80, w - 80), _r.randint(80, h - 80), steps=_r.randint(5, 15))
            page.wait_for_timeout(_r.randint(80, 250))
    except Exception:  # noqa: BLE001
        pass


def _human_on_page(page, deep: bool = False):
    """페이지에 들어와서 사람처럼 머문다: 나눠서 스크롤, 마우스 이동, 짧은 멈춤."""
    import random as _r
    try:
        page.wait_for_timeout(_r.randint(400, 900))
        steps = _r.randint(3, 5) if deep else 2
        for _ in range(steps):
            page.mouse.wheel(0, _r.randint(500, 1400))
            page.wait_for_timeout(_r.randint(250, 700))
            if _r.random() < 0.5:
                page.mouse.move(_r.randint(200, 1000), _r.randint(200, 700), steps=_r.randint(4, 10))
        if deep and _r.random() < 0.6:
            page.mouse.wheel(0, -_r.randint(300, 900))      # 위로 조금 되돌아보기
            page.wait_for_timeout(_r.randint(200, 500))
        page.wait_for_timeout(_r.randint(300, 800))
    except Exception:  # noqa: BLE001
        pass


def fetch_listing(page, kind: str, key, page_no: int) -> dict:
    """kind: 'category' 또는 'keyword'. 목록 한 페이지의 상품을 돌려준다."""
    if kind == "category":
        url = config.CATEGORY_URL.format(cid=key, size=config.CATEGORY_LIST_SIZE, page=page_no)
    else:
        url = config.SEARCH_URL.format(q=quote(str(key)), page=page_no)
    _goto(page, url, 'a[href*="/vp/products/"]')
    if page.url.rstrip("/") == config.COUPANG_HOME.rstrip("/"):
        log.warn(f"{url} 이(가) 홈으로 되돌아갔습니다 (없는 카테고리?)")
        return {"items": [], "title": page.title(), "empty": True, "redirected_home": True, "url": url}
    data = page.evaluate(EXTRACT_JS)
    if data.get("blocked"):
        _dump_debug(page, "blocked")
        raise BlockedError("쿠팡이 자동 접근을 막았습니다")
    if not data["items"] and not data.get("empty"):
        _dump_debug(page, f"empty_{kind}_{key}_p{page_no}")
    data["url"] = url
    return data


def fetch_children(page, cid: int, exclude: list[int]) -> dict:
    url = config.CATEGORY_PAGE.format(cid=cid)
    _goto(page, url, 'a[href*="/np/categories/"]')
    data = page.evaluate(CHILDREN_JS, {"cid": cid, "exclude": exclude})
    if not data["children"] and data.get("side_links", 0) == 0:
        _dump_debug(page, f"children_{cid}")
    # 같은 페이지에서 상품도 뽑아 둔다 (재방문 절약)
    try:
        data["listing"] = page.evaluate(EXTRACT_JS)
    except Exception:  # noqa: BLE001
        data["listing"] = None
    return data


def _ensure_coupang(page):
    try:
        if "www.coupang.com" not in page.url:
            page.goto(config.COUPANG_HOME, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(800)
    except Exception:  # noqa: BLE001
        pass


def _fetch_price_api(page, product_id, item_id, vendor_item_id, out):
    """쿠팡 가격 API: 쿠폰·와우 할인까지 적용된 최종가."""
    if not vendor_item_id:
        return
    url = QUANTITY_URL.format(pid=product_id, vid=vendor_item_id, iid=item_id or "")
    r = page.evaluate(FETCH_JS, {"url": url, "method": "GET", "headers": {"accept": "application/json, text/plain, */*",
                                                                         "x-requested-with": "XMLHttpRequest"}})
    ctype = (r.get("ctype") or "")
    if r.get("status") != 200 or "json" not in ctype:
        log.warn(f"가격 API 응답 이상 {product_id}: HTTP {r.get('status')} {ctype[:30]} {(r.get('text') or '')[:80]!r}")
        return
    data = json.loads(r["text"])
    first = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else {})
    price = (first or {}).get("price") or {}
    final = _num(price.get("finalPrice")) or _num(price.get("couponPrice")) or _num(price.get("salePrice"))
    if not final:
        log.warn(f"가격 API 에 가격이 없음 {product_id}: {str(price)[:120]}")
        return
    out["price"] = final
    out["origin_price"] = _num(price.get("originPrice"))
    out["coupon"] = bool(price.get("hasNormalCouponDiscount") or price.get("hasWowCouponDiscount"))
    out["source"] = "api"
    for pl in (first or {}).get("priceList") or []:
        if (pl or {}).get("type") == "SALES":
            out["price_sale"] = _num(pl.get("priceAmount"))
            break
    if not out.get("price_sale"):
        out["price_sale"] = _num(price.get("salePrice"))


def _fetch_seller(page, product_id, item_id, vendor_item_id, out):
    """판매자 정보 API: 쿠팡 직매입 여부, 판매자로켓(goldFish) 여부."""
    if not vendor_item_id:
        return None
    r = page.evaluate(FETCH_JS, {"url": BTF_URL.format(pid=product_id, vid=vendor_item_id, iid=item_id or ""),
                                 "method": "GET", "headers": {"accept": "application/json, text/plain, */*",
                                                              "x-requested-with": "XMLHttpRequest"}})
    if r.get("status") != 200 or "json" not in (r.get("ctype") or ""):
        log.warn(f"판매자 API 응답 이상 {product_id}: HTTP {r.get('status')}")
        return None
    btf = json.loads(r["text"]) or {}
    rp = btf.get("returnPolicyVo") or {}
    seller = rp.get("sellerDetailInfo")
    notice = rp.get("vendorItemDeliveryNotice") or {}
    out["rocket_fresh"] = bool(notice.get("rocketFresh"))
    out["rocket_install"] = bool(notice.get("rocketInstall"))
    out["delivery_charge_text"] = (notice.get("deliveryCharge") or "")[:120]
    out["btf_ok"] = True
    if not seller:
        return {}            # 판매자 정보가 아예 없음 = 쿠팡 직매입(로켓배송)
    out["seller_name"] = seller.get("vendorName")
    out["seller_country"] = (seller.get("countryCode") or "").upper()
    out["seller_retail"] = bool(seller.get("retail"))
    out["seller_goldfish"] = bool(seller.get("goldFish"))
    out["seller_3pm"] = bool(seller.get("threePM"))
    out["seller_3pc"] = bool(seller.get("threePC"))
    return seller


def ensure_product_context(page, product_id: int, item_id=None, vendor_item_id=None):
    """가격 API 는 상품 페이지 안에서 부를 때만 응답한다. 탭이 상품 페이지가 아니면 이 상품 페이지를 한 번 연다."""
    if "/vp/products/" in (page.url or ""):
        return
    url = config.PRODUCT_URL.format(pid=product_id)
    params = []
    if item_id:
        params.append(f"itemId={item_id}")
    if vendor_item_id:
        params.append(f"vendorItemId={vendor_item_id}")
    if params:
        url += "?" + "&".join(params)
    _goto(page, url, None)
    page.wait_for_timeout(1000)


_DATE_RE = re.compile(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})")


def _parse_date(v):
    from datetime import date
    if v is None:
        return None
    if isinstance(v, (int, float)):
        try:
            from datetime import datetime as _dt
            return _dt.fromtimestamp(v / 1000 if v > 10**11 else v).date()
        except Exception:  # noqa: BLE001
            return None
    m = _DATE_RE.search(str(v))
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except Exception:  # noqa: BLE001
        return None


def fetch_review_velocity(page, product_id: int, days: int = 28, size: int = 50, max_pages: int = 6) -> dict:
    """리뷰 API 를 최신순으로 받아 최근 N일 안에 달린 리뷰 수를 센다 (상품 페이지를 열지 않음).

    반환: {"count": 최근 N일 리뷰 수, "days": 실제로 센 기간(일), "total": 전체 리뷰 수, "note": 설명}
    끝까지 못 센 경우(리뷰가 아주 많은 상품)는 센 기간으로 비례 환산한다.
    """
    from datetime import date, timedelta
    today = date.today()
    cutoff = today - timedelta(days=days)
    count = 0
    oldest = None
    newest = None
    total = None
    pages = 0
    for pg in range(1, max_pages + 1):
        url = config.REVIEW_URL.format(pid=product_id, page=pg, size=size)
        r = page.evaluate(FETCH_JS, {"url": url, "method": "GET", "headers": {"accept": "application/json, text/plain, */*",
                                                                         "x-requested-with": "XMLHttpRequest"}})
        if r.get("status") in (403, 429):
            raise BlockedError(f"리뷰 API 가 막혔습니다 (HTTP {r.get('status')})")
        if r.get("status") != 200 or "json" not in (r.get("ctype") or ""):
            return {"count": None, "days": None, "total": None, "note": f"리뷰 API 응답 이상 HTTP {r.get('status')}"}
        data = json.loads(r["text"])
        rd = (data or {}).get("rData") or data or {}
        paging = rd.get("paging") or {}
        if total is None:
            total = _num(paging.get("totalCount")) or _num(rd.get("reviewTotalCount"))
        contents = paging.get("contents") or rd.get("contents") or []
        pages += 1
        if not contents:
            break
        stop = False
        for rv in contents:
            d = _parse_date(rv.get("reviewAt") or rv.get("createdAt") or rv.get("reviewDate"))
            if d is None:
                continue
            newest = max(newest, d) if newest else d
            if d >= cutoff:
                count += 1
                oldest = min(oldest, d) if oldest else d
            else:
                stop = True
        if stop or not paging.get("isNext", True):
            return {"count": count, "days": float(days), "total": total, "note": f"최근 {days}일 리뷰 {count}개 (전체 {total or '?'}개)"}
    # max_pages 안에 28일 전까지 못 감 → 센 기간으로 비례 환산
    if oldest and newest and count:
        span = max(1, (newest - oldest).days)
        est = int(round(count * days / span))
        return {"count": est, "days": float(span), "total": total,
                "note": f"{span}일치 리뷰 {count}개를 {days}일로 환산 (리뷰가 많아 {pages}쪽만 확인)"}
    return {"count": count, "days": float(days), "total": total, "note": f"최근 {days}일 리뷰 {count}개"}


def fetch_quick_price(page, product_id: int, item_id=None, vendor_item_id=None) -> dict:
    """상품 페이지를 새로 열지 않고 가격 API 만 호출해 쿠폰 적용 최종가를 얻는다.
    (탭이 상품 페이지가 아니면 처음 한 번만 연다)"""
    out = {"price": None, "source": ""}
    ensure_product_context(page, product_id, item_id, vendor_item_id)
    _fetch_price_api(page, product_id, item_id, vendor_item_id, out)
    return out


_mobile_mode = {"on": False, "since": 0}


def _product_url(product_id, item_id=None, vendor_item_id=None, mobile: bool = False) -> str:
    base = config.PRODUCT_URL_MOBILE if mobile else config.PRODUCT_URL
    url = base.format(pid=product_id)
    params = []
    if item_id:
        params.append(f"itemId={item_id}")
    if vendor_item_id:
        params.append(f"vendorItemId={vendor_item_id}")
    return url + ("?" + "&".join(params) if params else "")


def _goto_product(page, product_id, item_id=None, vendor_item_id=None):
    """상품 페이지를 연다. www 가 막혀 있으면 모바일 페이지(m.coupang.com)로 대체한다."""
    if _mobile_mode["on"] and time.time() - _mobile_mode["since"] < 3600:
        _goto(page, _product_url(product_id, item_id, vendor_item_id, mobile=True), None)
        return "mobile"
    try:
        _goto(page, _product_url(product_id, item_id, vendor_item_id), None)
        return "www"
    except BlockedError:
        log.warn("www 상품 페이지가 막혀 모바일 페이지로 대체합니다 (1시간 동안)")
        _mobile_mode.update({"on": True, "since": time.time()})
        _goto(page, _product_url(product_id, item_id, vendor_item_id, mobile=True), None)
        return "mobile"


def fetch_option_buyers(page, product_id: int, item_id=None, vendor_item_id=None) -> dict:
    """옵션 페이지를 열어 '월 N명 이상 구매' 문구만 읽는다 (가격·판매자 API 호출 없음)."""
    _goto_product(page, product_id, item_id, vendor_item_id)
    if False:
        _goto(page, "", None)
    page.wait_for_timeout(300)
    data = page.evaluate(DETAIL_PRICE_JS)
    if data.get("blocked"):
        raise BlockedError("상품 페이지 접근이 막혔습니다")
    if data.get("buyers_min") is None:
        # 문구가 늦게 뜨는 경우가 있어 한 번 더 기다렸다가 다시 읽는다
        page.wait_for_timeout(900)
        data = page.evaluate(DETAIL_PRICE_JS)
    return {"buyers_min": data.get("buyers_min"), "sold_out": bool(data.get("sold_out"))}


def fetch_detail_price(page, product_id: int, item_id=None, vendor_item_id=None) -> dict:
    """실제 판매가(쿠폰·와우 적용 최종가), '월 N명 이상 구매', 배송 형태를 읽는다.

    상품 페이지를 실제로 연 뒤, 그 페이지 안에서 쿠팡의 가격 API 와 판매자 API 를 호출한다.
    """
    out = {"price": None, "buyers_min": None, "coupon": False, "sold_out": False, "sellers": None, "source": ""}
    mode = _goto_product(page, product_id, item_id, vendor_item_id)
    out["page_mode"] = mode
    page.wait_for_timeout(300)
    data = page.evaluate(DETAIL_PRICE_JS)
    if data.get("blocked"):
        _dump_debug(page, f"blocked_detail_{product_id}")
        raise BlockedError("상품 페이지 접근이 막혔습니다")
    if data.get("buyers_min") is None:
        page.wait_for_timeout(900)
        data = page.evaluate(DETAIL_PRICE_JS)
    out["buyers_min"] = data.get("buyers_min")
    out["sellers"] = data.get("sellers")
    out["delivery"] = data.get("delivery")
    out["delivery_how"] = data.get("delivery_how")
    out["sold_out"] = bool(data.get("sold_out"))
    # 1) 가격: API → 페이지 내장 데이터 → 화면 요소 (모바일 페이지에서는 API 를 건너뜀)
    if mode == "www":
        try:
            _fetch_price_api(page, product_id, item_id, vendor_item_id, out)
        except Exception as e:  # noqa: BLE001
            log.warn(f"가격 API 실패 {product_id}: {e}")
    if out["price"] is None:
        sp = data.get("script_prices") or {}
        final = sp.get("final") or sp.get("coupon") or sp.get("sale")
        if final:
            out["price"] = final
            out["price_sale"] = sp.get("sale")
            out["origin_price"] = sp.get("origin")
            out["source"] = "script"
    if out["price"] is None:
        for c in data.get("candidates", []):
            out["price"] = c["value"]
            out["source"] = "page"
            break
    # 2) 배송: 판매자 정보 기준
    seller = None
    if mode == "www":
        try:
            seller = _fetch_seller(page, product_id, item_id, vendor_item_id, out)
        except Exception as e:  # noqa: BLE001
            log.warn(f"판매자 정보 조회 실패 {product_id}: {e}")
    d = out.get("delivery") or "WING"
    if out.get("btf_ok"):
        # 판매자 정보가 있으면 화면 판정은 쓰지 않는다 (판매자 정보가 정답)
        name = (out.get("seller_name") or "")
        country = out.get("seller_country") or ""
        is_global = (country and country != "KR") or re.search(r"global|글로벌", name, re.I) is not None
        coupang_seller = (seller == {}) or out.get("seller_retail") or (re.search(r"쿠팡", name) is not None)
        charge = out.get("delivery_charge_text") or ""
        if out.get("rocket_fresh"):
            out["delivery"] = "ROCKET_FRESH"
        elif is_global:
            out["delivery"] = "ROCKET_GLOBAL"
        elif coupang_seller:
            out["delivery"] = "ROCKET"
        elif out.get("seller_goldfish") or out.get("seller_3pc"):
            out["delivery"] = "ROCKET_GROWTH"
        elif out.get("seller_3pm"):
            out["delivery"] = "WING"
        elif "로켓" in charge:
            out["delivery"] = "ROCKET_GROWTH"
        else:
            out["delivery"] = "WING"
        out["delivery_how"] = "seller"
        if seller == {}:
            out["seller_name"] = "쿠팡"
            out["seller_flags"] = "직매입"
        else:
            out["seller_flags"] = "retail" if out.get("seller_retail") else ("goldFish" if out.get("seller_goldfish") else ("3PC" if out.get("seller_3pc") else ("3PM" if out.get("seller_3pm") else "-")))
    if out["price"] is None and out["buyers_min"] is None and _debug_budget["left"] > 0:
        _debug_budget["left"] -= 1
        _dump_debug(page, f"detail_{product_id}")
    out["buyers_text_found"] = out["buyers_min"] is not None
    return out


def parse_scope_url(url: str) -> dict | None:
    """붙여넣은 쿠팡 링크를 범위로 바꾼다."""
    m = re.search(r"/np/categories/(\d+)", url)
    if m:
        return {"type": "category", "id": int(m.group(1)), "name": f"링크 카테고리 {m.group(1)}"}
    m = re.search(r"[?&]q=([^&]+)", url)
    if m and "/np/search" in url:
        from urllib.parse import unquote
        return {"type": "keyword", "q": unquote(m.group(1))}
    m = re.search(r"/vp/products/(\d+)", url)
    if m:
        return {"type": "product", "id": int(m.group(1))}
    return None
