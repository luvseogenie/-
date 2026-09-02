/* 쿠팡 목록 페이지 수집 검사 — DevTools 콘솔에 붙여넣고 Enter
   실제 확장 프로그램과 같은 방식(selector → 링크 앵커 → 값의 형태)으로 상품을 읽어
   무엇이 읽히고 무엇이 안 읽히는지 보여줍니다. 결과는 페이지 위 박스로 표시됩니다. */
(() => {
  const CARD_SEL = ["li.search-product", "li.baby-product", "li[class*='ProductUnit_productUnit']",
    "ul#productList > li", "ul.browse-product-list > li", "li[data-product-id]", "div[data-product-id]"];
  const NAME_SEL = ["div.name", ".search-product-wrap-title", "[class*='productName']", "[class*='ProductName']", "[class*='product-name']"];
  const PRICE_SEL = ["strong.price-value", ".price-value", "[class*='priceValue']", "[class*='PriceValue']", "[class*='price-value']"];
  const REVIEW_SEL = ["span.rating-total-count", ".rating-total-count", "[class*='ratingCount']", "[class*='RatingCount']", "[class*='rating-count']"];
  const RATING_SEL = ["em.rating", "span.star em", ".rating", "[class*='ratingStar']", "[class*='RatingStar']", "[class*='_star']"];
  const BADGE_SEL = ["span.badge.rocket", ".badge.rocket", "[class*='ImageBadge']", "[class*='DeliveryBadge']", "[class*='badge']"];
  const DELIV = [["로켓그로스", "판매자로켓", "growth"], ["로켓배송", "로켓프레시", "새벽배송", "rocket"], ["판매자배송", "일반배송"]];
  const DELIV_NAME = ["로켓그로스", "로켓배송", "판매자배송"];

  const q1 = (r, sels) => { for (const s of sels) { try { const e = r.querySelector(s); if (e) return e; } catch {} } return null; };
  const t1 = (r, sels) => { const e = q1(r, sels); const t = e && (e.textContent || "").trim(); return t || null; };
  const leaves = (c) => [...c.querySelectorAll("*")].filter((e) => !e.children.length);
  const num = (s) => {
    if (!s) return null;
    const t = String(s).trim();
    const u = t.match(/([\d,]+(?:\.\d+)?)\s*(만|천)/);           // "1.2만" → 12000
    if (u) { const b = +u[1].replace(/,/g, ""); if (isFinite(b)) return Math.round(b * (u[2] === "만" ? 1e4 : 1e3)); }
    const m = t.match(/-?[\d,]+/);
    if (!m) return null;
    const v = +m[0].replace(/,/g, "");
    return isFinite(v) ? v : null;
  };

  // --- 카드 찾기: selector → 링크 앵커
  let cards = [], via = "";
  for (const s of CARD_SEL) { try { const f = [...document.querySelectorAll(s)]; if (f.length) { cards = f; via = s; break; } } catch {} }
  if (!cards.length) {
    const seen = new Set();
    [...document.querySelectorAll("a[href*='/vp/products/']")].forEach((a) => {
      const c = a.closest("li, article") || a.parentElement;
      if (c && !seen.has(c)) { seen.add(c); cards.push(c); }
    });
    via = cards.length ? "a[href*='/vp/products/'] (링크 앵커)" : "실패";
  }

  // --- 값 추출 (실제 파서와 동일한 fallback)
  const parse = (c) => {
    const link = c.matches("a[href]") ? c : c.querySelector("a[href*='/vp/products/'], a[href]");
    const href = link && link.getAttribute("href");
    let id = null;
    for (const a of ["data-product-id", "data-id", "data-item-id", "data-pid"]) {
      const v = c.getAttribute(a) || (c.querySelector(`[${a}]`) || {}).getAttribute?.(a);
      if (v && /^\d+$/.test(v.trim())) { id = v.trim(); break; }
    }
    if (!id && href) { const m = href.match(/\/vp\/products\/(\d+)/); if (m) id = m[1]; }

    const name = t1(c, NAME_SEL) || (q1(c, ["img[alt]"]) || {}).getAttribute?.("alt") || null;

    let price = num(t1(c, PRICE_SEL)), priceVia = price !== null ? "selector" : "";
    if (price === null) for (const e of leaves(c)) {
      const tx = (e.textContent || "").replace(/\s/g, "");
      if (!/^\d{1,3}(,\d{3})+$|^\d{3,}$/.test(tx)) continue;
      const near = ((e.nextElementSibling || {}).textContent || "") + ((e.parentElement || {}).textContent || "");
      if (!near.includes("원")) continue;
      price = num(tx); priceVia = "형태(13,900+원)"; break;
    }

    let rv = t1(c, REVIEW_SEL), rvVia = rv !== null ? "selector" : "";
    let review = rv !== null ? (num(rv) ?? 0) : null;
    if (review === null) for (const e of leaves(c)) {
      const m = (e.textContent || "").replace(/\s/g, "").match(/^\(([\d,]+(?:\.\d+)?(?:만|천)?)\)$/);
      if (m) { review = num(m[1]); rvVia = "형태((1,234))"; break; }
    }
    if (review === null) { review = 0; rvVia = rvVia || "없음→0"; }

    let rating = null, rtVia = "";
    const re = q1(c, RATING_SEL);
    if (re) { const v = parseFloat((re.textContent || "").trim()); if (v >= 0 && v <= 5) { rating = v; rtVia = "selector"; } }
    if (rating === null) for (const e of c.querySelectorAll("[style]")) {
      const m = (e.getAttribute("style") || "").match(/width\s*:\s*([\d.]+)\s*%/);
      if (m && +m[1] <= 100) { rating = Math.round(+m[1] / 100 * 5 * 10) / 10; rtVia = "width%"; break; }
    }

    const badge = q1(c, BADGE_SEL);
    let soup = badge ? (badge.textContent || "") + [...badge.querySelectorAll("*")].concat([badge])
      .map((e) => (e.getAttribute("alt") || "") + (e.getAttribute("title") || "")).join(" ") : "";
    if (!DELIV.some((ks) => ks.some((k) => soup.includes(k)))) {
      soup = (c.textContent || "") + [...c.querySelectorAll("[alt],[title]")]
        .map((e) => [e.getAttribute("alt"), e.getAttribute("title")].filter((v) => v && v.length <= 20).join(" ")).join(" ");
    }
    let deliv = null;
    DELIV.forEach((ks, i) => { if (deliv === null && ks.some((k) => soup.includes(k))) deliv = DELIV_NAME[i]; });

    return { id, name, price, priceVia, review, rvVia, rating, rtVia, deliv, href };
  };

  const rows = cards.map(parse);
  const ok = rows.filter((r) => r.id && r.name && r.href);
  const L = [];
  L.push("=== 쿠팡 목록 페이지 수집 검사 ===");
  L.push("URL: " + location.href.split("?")[0]);
  L.push("");
  L.push(`감지된 상품 카드: ${cards.length}개   (경로: ${via})`);
  L.push(`정상 추출 가능:   ${ok.length}개   / 제외 ${cards.length - ok.length}개`);
  L.push("");
  const cnt = (f) => ok.filter((r) => r[f] !== null && r[f] !== undefined).length;
  L.push("[필드별 추출 성공]");
  L.push(`  상품명   ${cnt("name")}/${ok.length}`);
  L.push(`  가격     ${cnt("price")}/${ok.length}   (경로: ${[...new Set(ok.map((r) => r.priceVia))].join(", ") || "-"})`);
  L.push(`  리뷰수   읽음 ${ok.filter((r) => r.rvVia !== "없음→0").length}/${ok.length} (나머지는 리뷰 0건)   (경로: ${[...new Set(ok.map((r) => r.rvVia))].join(", ") || "-"})`);
  L.push(`  평점     ${cnt("rating")}/${ok.length}   (경로: ${[...new Set(ok.map((r) => r.rtVia))].filter(Boolean).join(", ") || "-"})`);
  L.push(`  배송     ${cnt("deliv")}/${ok.length}`);
  L.push("");
  const buy = document.body.innerText.match(/한\s*달\s*간?[^\n]{0,30}(구매|판매)[^\n]{0,10}/g);
  L.push("[한 달 구매 문구가 목록에도 있는지]");
  L.push(buy ? "  ★ 발견: " + [...new Set(buy)].slice(0, 3).join(" / ") : "  없음 (상세 페이지에만 있음)");
  L.push("");
  L.push("[샘플 5개]");
  ok.slice(0, 5).forEach((r, i) => {
    L.push(`  ${i + 1}. ${(r.name || "").slice(0, 34)}`);
    L.push(`     id=${r.id} 가격=${r.price} 리뷰=${r.review} 평점=${r.rating} 배송=${r.deliv}`);
  });
  if (!ok.length && cards.length) L.push("  ⚠ 카드는 찾았지만 필수값(id/상품명/링크)을 못 읽었습니다.");
  if (!cards.length) L.push("  ⚠ 상품 카드를 못 찾았습니다. 상품이 화면에 보이는 상태인지 확인하세요.");

  const report = L.join("\n");
  console.log(report);
  document.getElementById("__cp_check__")?.remove();
  const box = document.createElement("div");
  box.id = "__cp_check__";
  box.style.cssText = "position:fixed;inset:4%;z-index:2147483647;background:#14161c;color:#e8eaf0;" +
    "border:2px solid #38d8c8;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px;box-shadow:0 8px 40px #000a";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:8px;align-items:center;font-family:sans-serif;font-size:13px";
  bar.innerHTML = "<b style='flex:1'>검사 결과 — 전체 선택됨. Ctrl+C 로 복사하세요</b>";
  const ta = document.createElement("textarea");
  ta.value = report; ta.readOnly = true;
  ta.style.cssText = "flex:1;width:100%;background:#0f1116;color:#a8e6df;border:1px solid #2b303b;border-radius:6px;" +
    "padding:10px;font-family:monospace;font-size:12px;line-height:1.55;resize:none";
  const mk = (label, bg, fn) => { const b = document.createElement("button");
    b.textContent = label; b.onclick = fn;
    b.style.cssText = `padding:6px 14px;border:0;border-radius:6px;background:${bg};color:#10141a;font-weight:700;cursor:pointer;font-family:sans-serif`;
    return b; };
  bar.appendChild(mk("복사", "#38d8c8", () => { ta.select(); document.execCommand("copy"); bar.firstChild.textContent = "✅ 복사됨! 채팅창에 붙여넣으세요"; }));
  bar.appendChild(mk("닫기", "#7a8394", () => box.remove()));
  box.append(bar, ta); document.body.appendChild(box); ta.focus(); ta.select();
  try { copy(report); } catch {}
})();
