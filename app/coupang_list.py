"""쿠팡 공개 페이지 수집: 카테고리 목록, 하위 카테고리, 상품 상세 가격.

화면 구조가 바뀌어도 버티도록 class 이름 대신 링크 주소(/vp/products/, /np/categories/)와
글자 패턴으로 값을 찾는다. 하나도 못 찾으면 data/debug 에 화면과 HTML을 저장한다.
"""
import re
import time
from datetime import datetime
from urllib.parse import quote

from . import config
from . import log


class BlockedError(Exception):
    """쿠팡이 접근을 막았을 때."""


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
    let delivery = 'WING';
    if (/판매자\s*로켓|로켓그로스/.test(alts)) delivery = 'ROCKET_GROWTH';
    else if (/로켓직구/.test(alts)) delivery = 'ROCKET_GLOBAL';
    else if (/로켓프레시/.test(alts)) delivery = 'ROCKET_FRESH';
    else if (/로켓배송|로켓와우/.test(alts)) delivery = 'ROCKET';

    const isAd = !inUnit || /ad-badge|adbadge|__ad|\bad\b/.test(cls(li)) || !!li.querySelector('[class*="ad-badge"], [class*="adBadge"], [class*="AdMark"], [class*="ad-mark"], [class*="AdBadge"]') || /\bAD\b|광고/.test(txt(li).slice(0, 40));
    const soldOut = /일시품절|품절/.test(txt(li));
    const img = li.querySelector('img');
    const image = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
    rank += 1;
    out.push({ product_id: Number(m[1]), item_id: itemId ? Number(itemId) : null,
      vendor_item_id: vendorItemId ? Number(vendorItemId) : null, name, price, base_price: basePrice,
      review_count: reviews, rating, delivery, is_ad: isAd, sold_out: soldOut, image,
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
  const sels = ['.prod-sale-price .total-price strong', '.prod-coupon-price .total-price strong', '.total-price strong',
    '[class*="finalPrice"]', '[class*="final-price"]', '[class*="salePrice"] strong', '[class*="sale-price"] strong',
    '[class*="couponPrice"]', '[class*="coupon-price"]', '[class*="price"] strong'];
  for (const s of sels) { for (const el of document.querySelectorAll(s)) { const v = num(txt(el)); if (v && v > 100) cands.push({ sel: s, value: v, text: txt(el) }); } }
  const coupon = /쿠폰|와우할인|다운로드/.test(body.slice(0, 20000));
  const soldOut = /일시품절|품절된 상품/.test(body.slice(0, 20000));
  let sellers = null;
  const sm = body.match(/다른\s*판매자\s*(\d+)/) || body.match(/판매자\s*(\d+)\s*곳/);
  if (sm) sellers = Number(sm[1]);
  return { candidates: cands.slice(0, 12), coupon, sold_out: soldOut, blocked, sellers, title: document.title };
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
  const units = document.querySelectorAll('li[class*="ProductUnit"], li.baby-product, li.search-product').length;
  return { pagination: pag, sorts, product_units: units, url: location.href };
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


def _goto(page, url: str, wait_selector: str | None = None):
    resp = page.goto(url, wait_until="domcontentloaded", timeout=60000)
    status = resp.status if resp else None
    if status in (403, 429, 503):
        _dump_debug(page, f"blocked_{status}")
        raise BlockedError(f"쿠팡이 접근을 막았습니다 (HTTP {status})")
    if wait_selector:
        try:
            page.wait_for_selector(wait_selector, timeout=15000)
        except Exception:  # noqa: BLE001
            pass
    # 지연 렌더링(스크롤해야 나오는 카드) 대비
    try:
        page.mouse.wheel(0, 2500)
        page.wait_for_timeout(600)
        page.mouse.wheel(0, 4000)
        page.wait_for_timeout(500)
    except Exception:  # noqa: BLE001
        pass
    return status


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


def fetch_detail_price(page, product_id: int, item_id=None, vendor_item_id=None) -> dict:
    url = config.PRODUCT_URL.format(pid=product_id)
    params = []
    if item_id:
        params.append(f"itemId={item_id}")
    if vendor_item_id:
        params.append(f"vendorItemId={vendor_item_id}")
    if params:
        url += "?" + "&".join(params)
    _goto(page, url, None)
    page.wait_for_timeout(1200)
    data = page.evaluate(DETAIL_PRICE_JS)
    if data.get("blocked"):
        _dump_debug(page, f"blocked_detail_{product_id}")
        raise BlockedError("상품 페이지 접근이 막혔습니다")
    price = None
    for c in data.get("candidates", []):
        price = c["value"]
        break
    if price is None:
        _dump_debug(page, f"detail_{product_id}")
    data["price"] = price
    return data


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
