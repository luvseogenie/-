/* 쿠팡 목록 페이지 구조 진단 — DevTools 콘솔에 붙여넣고 Enter */
(() => {
  const out = [];
  const L = (s = "") => out.push(s);
  const desc = (el) => {
    const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 4);
    const data = [...el.attributes].filter((a) => a.name.startsWith("data-")).slice(0, 3)
      .map((a) => `[${a.name}=${a.value.slice(0, 20)}]`).join("");
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
      (cls.length ? "." + cls.join(".") : "") + data;
  };
  const txt = (el) => {
    const t = [...el.childNodes].filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
    return t ? `  "${t.slice(0, 40)}"` : "";
  };
  const attrs = (el) => ["alt", "style", "href"].map((a) => {
    const v = el.getAttribute(a);
    if (!v) return "";
    return ` ${a}="${(a === "href" ? v.split("?")[0] : v).slice(0, 45)}"`;
  }).join("");
  const tree = (el, d = 0, acc = []) => {
    if (d > 5 || acc.length > 45) return acc;
    acc.push("  ".repeat(d) + desc(el) + attrs(el) + txt(el));
    [...el.children].forEach((c) => tree(c, d + 1, acc));
    return acc;
  };

  L("=== 쿠팡 목록 페이지 구조 진단 ===");
  L("URL: " + location.href.split("?")[0]);
  L("");

  // 1) 알려진 selector 매칭
  L("[기존 selector 매칭]");
  ["li.search-product", "li.baby-product", "li[class*='ProductUnit_productUnit']",
   "ul#productList > li", "li[data-product-id]"].forEach((sel) => {
    let n = 0; try { n = document.querySelectorAll(sel).length; } catch {}
    L(`  ${sel} → ${n}개`);
  });
  L("");

  // 2) 상품 링크로 카드 역추적 (클래스명이 바뀌어도 동작)
  const links = [...document.querySelectorAll("a[href*='/vp/products/']")];
  const cards = [];
  const seen = new Set();
  links.forEach((a) => {
    const card = a.closest("li, article") || a.parentElement;
    if (card && !seen.has(card)) { seen.add(card); cards.push(card); }
  });
  L(`[상품 링크로 찾은 카드] ${cards.length}개`);
  if (cards.length) L("  카드 요소: " + desc(cards[0]));
  L("");

  // 3) "한 달간 N명 구매" 문구가 목록에도 있는지 확인
  const body = document.body.innerText;
  const buy = body.match(/한\s*달\s*간?[^\n]{0,30}(구매|판매)[^\n]{0,10}/g);
  L("[한 달 구매 문구 존재 여부]");
  L(buy ? "  ★ 발견: " + [...new Set(buy)].slice(0, 3).join(" / ") : "  없음 (상세 페이지에만 있는 것으로 보임)");
  L("");

  // 4) 첫 번째 카드 전체 구조
  L("[상품 카드 구조]");
  L(cards.length ? tree(cards[0]).join("\n") : "  ⚠ 상품 카드를 찾지 못했습니다.");

  const report = out.join("\n");
  console.log(report);
  try {
    copy(report);
    console.log("%c✅ 클립보드에 복사됨 — 채팅창에 붙여넣으세요", "color:#0a0;font-weight:bold");
  } catch {
    console.log("%c위 내용을 드래그해서 복사하세요", "color:#a60");
  }
})();
