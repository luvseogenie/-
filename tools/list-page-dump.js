/* 쿠팡 목록 페이지 구조 진단 — DevTools 콘솔에 붙여넣고 Enter
   결과를 페이지 위 박스로 띄우므로 콘솔 로그가 지저분해도 상관없습니다. */
(() => {
  const out = [];
  const L = (s = "") => out.push(s);
  const desc = (el) => {
    const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 5);
    const data = [...el.attributes].filter((a) => a.name.startsWith("data-")).slice(0, 3)
      .map((a) => `[${a.name}=${a.value.slice(0, 20)}]`).join("");
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
      (cls.length ? "." + cls.join(".") : "") + data;
  };
  const txt = (el) => {
    const t = [...el.childNodes].filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
    return t ? `  "${t.slice(0, 45)}"` : "";
  };
  const attrs = (el) => ["alt", "style", "href"].map((a) => {
    const v = el.getAttribute(a);
    if (!v) return "";
    return ` ${a}="${(a === "href" ? v.split("?")[0] : v).slice(0, 50)}"`;
  }).join("");
  const tree = (el, d = 0, acc = []) => {
    if (d > 5 || acc.length > 50) return acc;
    acc.push("  ".repeat(d) + desc(el) + attrs(el) + txt(el));
    [...el.children].forEach((c) => tree(c, d + 1, acc));
    return acc;
  };

  L("=== 쿠팡 목록 페이지 구조 진단 ===");
  L("URL: " + location.href.split("?")[0]);
  L("쿼리: " + (location.search.slice(0, 120) || "(없음)"));
  L("");

  L("[기존 selector 매칭]");
  ["li.search-product", "li.baby-product", "li[class*='ProductUnit_productUnit']",
   "ul#productList > li", "ul.browse-product-list > li", "li[data-product-id]"].forEach((sel) => {
    let n = 0; try { n = document.querySelectorAll(sel).length; } catch {}
    L(`  ${sel} → ${n}개`);
  });
  L("");

  const links = [...document.querySelectorAll("a[href*='/vp/products/']")];
  const cards = []; const seen = new Set();
  links.forEach((a) => {
    const card = a.closest("li, article") || a.parentElement;
    if (card && !seen.has(card)) { seen.add(card); cards.push(card); }
  });
  L(`[상품 링크(/vp/products/)로 찾은 카드] ${cards.length}개`);
  if (cards.length) {
    L("  카드 요소: " + desc(cards[0]));
    const parent = cards[0].parentElement;
    if (parent) L("  부모(목록) 요소: " + desc(parent));
  }
  L("");

  const buy = document.body.innerText.match(/한\s*달\s*간?[^\n]{0,30}(구매|판매)[^\n]{0,10}/g);
  L("[한 달 구매 문구가 목록에도 있는지]");
  L(buy ? "  ★ 발견: " + [...new Set(buy)].slice(0, 3).join(" / ")
        : "  없음 (상세 페이지에만 있는 것으로 보임)");
  L("");

  L("[상품 카드 구조]");
  L(cards.length ? tree(cards[0]).join("\n")
    : "  ⚠ 상품 카드를 찾지 못했습니다. 상품이 화면에 보이는 상태인지 확인하세요.");

  const report = out.join("\n");
  console.log(report);

  // 콘솔이 다른 확장 로그로 지저분해도 되도록 페이지 위에 박스로 띄운다.
  document.getElementById("__coupang_dump__")?.remove();
  const box = document.createElement("div");
  box.id = "__coupang_dump__";
  box.style.cssText = "position:fixed;inset:5% 5% 5% 5%;z-index:2147483647;background:#14161c;" +
    "color:#e8eaf0;border:2px solid #38d8c8;border-radius:10px;padding:14px;display:flex;" +
    "flex-direction:column;gap:10px;font-family:monospace;box-shadow:0 8px 40px rgba(0,0,0,.6)";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:8px;align-items:center;font-family:sans-serif;font-size:13px";
  bar.innerHTML = "<b style='flex:1'>진단 결과 — 전체 선택되어 있습니다. Ctrl+C 로 복사하세요</b>";
  const ta = document.createElement("textarea");
  ta.value = report;
  ta.readOnly = true;
  ta.style.cssText = "flex:1;width:100%;background:#0f1116;color:#a8e6df;border:1px solid #2b303b;" +
    "border-radius:6px;padding:10px;font-family:monospace;font-size:12px;line-height:1.5;resize:none";
  const mk = (label, bg, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = `padding:6px 14px;border:0;border-radius:6px;background:${bg};color:#10141a;` +
      "font-weight:700;cursor:pointer;font-family:sans-serif;font-size:13px";
    b.onclick = fn;
    return b;
  };
  bar.appendChild(mk("복사", "#38d8c8", () => {
    ta.select(); document.execCommand("copy");
    bar.firstChild.textContent = "✅ 복사됨! 채팅창에 붙여넣으세요";
  }));
  bar.appendChild(mk("닫기", "#7a8394", () => box.remove()));
  box.appendChild(bar); box.appendChild(ta);
  document.body.appendChild(box);
  ta.focus(); ta.select();
  try { copy(report); } catch {}
})();
