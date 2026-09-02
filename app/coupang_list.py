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

    // 배송 형태
    const alts = Array.from(li.querySelectorAll('img[alt]')).map(i => i.getAttribute('alt') || '').join(' ') + ' ' + txt(li);
    let delivery = 'WING';
    if (/판매자\s*로켓|로켓그로스/.test(alts)) delivery = 'ROCKET_GROWTH';
    else if (/로켓직구/.test(alts)) delivery = 'ROCKET_GLOBAL';
    else if (/로켓프레시/.test(alts)) delivery = 'ROCKET_FRESH';
    else if (/로켓배송|로켓와우/.test(alts)) delivery = 'ROCKET';

    const isAd = /ad-badge|adbadge|__ad|\bad\b/.test(cls(li)) || !!li.querySelector('[class*="ad-badge"], [class*="adBadge"], [class*="AdMark"], [class*="ad-mark"]') || /\bAD\b/.test(txt(li).slice(0, 40));
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
  const cur = side.find(x => x.id === curId);
  if (cur) {
    const li = cur.a.closest('li');
    if (li) { kids = side.filter(x => x.a !== cur.a && li.contains(x.a) && x.id !== curId); if (kids.length) how = 'nested'; }
  }
  if (!kids.length) {
    // 현재 카테고리가 링크가 아닌 글자(선택 상태)로 표시된 경우: 그 요소 뒤에 오는 목록
    const marked = Array.from(document.querySelectorAll('li, div, span, strong, b')).filter(el => !inChrome(el) && /selected|active|current|\bon\b|checked|bold/i.test(el.className || '') && el.querySelector('a[href*="/np/categories/"]') === null && el.textContent.trim().length < 40);
    for (const el of marked) {
      const li = el.closest('li') || el.parentElement;
      if (!li) continue;
      const inner = side.filter(x => li.contains(x.a) && x.id !== curId);
      if (inner.length) { kids = inner; how = 'marked'; break; }
    }
  }
  if (!kids.length) { kids = side.filter(x => x.id !== curId); how = 'all-side'; }
  const uniq = new Map();
  for (const k of kids) { if (!exclude.has(k.id) && !uniq.has(k.id)) uniq.set(k.id, k.name); }
  return { children: Array.from(uniq, ([id, name]) => ({ id: Number(id), name })), how, total_links: links.length, side_links: side.length, title: document.title };
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
    data = page.evaluate(EXTRACT_JS)
    if data.get("blocked"):
        _dump_debug(page, "blocked")
        raise BlockedError("쿠팡이 자동 접근을 막았습니다")
    if not data["items"] and not data.get("empty"):
        _dump_debug(page, f"empty_{kind}_{key}_p{page_no}")
    data["url"] = url
    return data


def fetch_children(page, cid: int, exclude: list[int]) -> dict:
    url = config.CATEGORY_URL.format(cid=cid, size=config.CATEGORY_LIST_SIZE, page=1)
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
