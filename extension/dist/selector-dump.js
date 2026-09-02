"use strict";
(() => {
  // src/parsers/selectors.ts
  var PRODUCT_CARD_SELECTORS = [
    "li.search-product",
    "li.baby-product",
    "li[class*='ProductUnit_productUnit']",
    "ul#productList > li",
    "ul.browse-product-list > li",
    "li[data-product-id]",
    "div[data-product-id]"
  ];
  var NAME_SELECTORS = [
    "div.name",
    ".search-product-wrap-title",
    "[class*='productName']",
    "[class*='ProductName']",
    "[class*='product-name']",
    ".descriptions .name"
  ];
  var PRICE_SELECTORS = [
    "strong.price-value",
    ".price-value",
    "[class*='priceValue']",
    "[class*='PriceValue']",
    "[class*='price-value']",
    ".price .price-value",
    "em.sale strong"
  ];
  var REVIEW_COUNT_SELECTORS = [
    "span.rating-total-count",
    ".rating-total-count",
    "[class*='ratingCount']",
    "[class*='RatingCount']",
    "[class*='rating-count']",
    ".product-rating .rating-total-count"
  ];
  var RATING_SELECTORS = [
    "em.rating",
    "span.star em",
    ".rating",
    "[class*='ratingStar']",
    "[class*='RatingStar']",
    "[class*='_star']",
    "[class*='rating-star']"
  ];
  var DELIVERY_BADGE_SELECTORS = [
    "span.badge.rocket",
    ".badge.rocket",
    "[class*='ImageBadge']",
    "[class*='DeliveryBadge']",
    "[class*='deliveryBadge']",
    "[class*='badge']",
    ".delivery-badge"
  ];
  var CATEGORY_NAME_SELECTORS = [
    "h2.title",
    ".breadcrumb li:last-child",
    "#breadcrumb li:last-child",
    "[class*='breadcrumb'] li:last-child",
    "h1.page-title"
  ];
  var REVIEW_SECTION_SELECTORS = [
    "section#sdpReview",
    "#sdpReview",
    "div.review-list",
    "section[class*='review']",
    "div[class*='reviewList']",
    "div[class*='js_reviewArticleList']",
    "div[class*='js_reviewArticleContainer']",
    "#productReview"
  ];
  var REVIEW_ITEM_SELECTORS = [
    "article.sdp-review__article__list",
    "article[class*='review__article__list']",
    "div.sdp-review__article__list",
    "li[class*='reviewItem']",
    "article[class*='ReviewItem']"
  ];
  var REVIEW_ID_ANCHOR_SELECTORS = [
    "[data-review-id]",
    "[data-reviewid]",
    "[data-review_id]"
  ];
  var REVIEW_CARD_CONTAINERS = "article, li, section";
  var REVIEW_DATE_SELECTORS = [
    "div.sdp-review__article__list__info__product-info__reg-date",
    "[class*='reg-date']",
    "[class*='regDate']",
    "[class*='review-date']",
    "time[datetime]"
  ];
  var REVIEW_SORT_SELECTORS = [
    "div.sdp-review__article__order__sort",
    "[class*='order__sort']",
    "[class*='reviewSort']",
    "[class*='js_reviewArticleOrder']"
  ];
  var REVIEW_TOTAL_COUNT_SELECTORS = [
    "span#prod-review-nav-link-count",
    "[class*='sdp-review__average__total-star__info-count']",
    "[class*='reviewCount']",
    ".count"
  ];
  var REVIEW_DATE_PATTERNS = [
    /(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/,
    // 2026.08.15 / 2026-08-15
    /(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/
    // 2026년 8월 15일
  ];

  // src/parsers/coupang_review_parser.ts
  var DAY_MS = 24 * 60 * 60 * 1e3;
  function queryAll(root, selectors) {
    for (const selector of selectors) {
      try {
        const found = Array.from(root.querySelectorAll(selector));
        if (found.length > 0) return found;
      } catch {
      }
    }
    return [];
  }
  function findReviewId(card) {
    for (const selector of REVIEW_ID_ANCHOR_SELECTORS) {
      try {
        const attr = selector.replace(/[[\]]/g, "");
        const own = card.getAttribute(attr);
        if (own && own.trim() !== "") return own.trim();
        const child = card.querySelector(selector);
        const value = child?.getAttribute(attr);
        if (value && value.trim() !== "") return value.trim();
      } catch {
      }
    }
    return null;
  }
  function findReviewCards(root) {
    const bySelector = queryAll(root, REVIEW_ITEM_SELECTORS);
    if (bySelector.length > 0) return { cards: bySelector, via: "selector" };
    const cards = [];
    const seen = /* @__PURE__ */ new Set();
    for (const selector of REVIEW_ID_ANCHOR_SELECTORS) {
      let anchors = [];
      try {
        anchors = Array.from(root.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const anchor of anchors) {
        const card = anchor.closest(REVIEW_CARD_CONTAINERS) ?? anchor.parentElement;
        if (card && !seen.has(card)) {
          seen.add(card);
          cards.push(card);
        }
      }
      if (cards.length > 0) return { cards, via: "data-review-id" };
    }
    return { cards: [], via: "none" };
  }

  // src/parsers/diagnostics.ts
  var MAX_SAMPLE_NODES = 60;
  var MAX_DATE_SAMPLES = 12;
  function looksLikeDate(text) {
    return REVIEW_DATE_PATTERNS.some((p) => p.test(text));
  }
  function looksLikeMetric(text) {
    return text.length <= 20 && /^[\d,.\s()%원점개별★☆]+$/.test(text);
  }
  var SAFE_LABELS = /* @__PURE__ */ new Set([
    "\uCD5C\uC2E0\uC21C",
    "\uBCA0\uC2A4\uD2B8\uC21C",
    "\uCD5C\uADFC\uC21C",
    "\uD3C9\uC810 \uB192\uC740\uC21C",
    "\uD3C9\uC810 \uB0AE\uC740\uC21C",
    "\uB4F1\uB85D\uC21C",
    "\uB85C\uCF13\uBC30\uC1A1",
    "\uB85C\uCF13\uADF8\uB85C\uC2A4",
    "\uD310\uB9E4\uC790\uBC30\uC1A1",
    "\uBB34\uB8CC\uBC30\uC1A1",
    "\uB0B4\uC77C \uB3C4\uCC29",
    "\uC0C8\uBCBD\uBC30\uC1A1",
    "\uB354\uBCF4\uAE30",
    "\uB2E4\uC74C",
    "\uC774\uC804",
    "\uC0C1\uD488\uD3C9",
    "\uB9AC\uBDF0",
    "\uB9AC\uBDF0 \uC4F0\uAE30",
    "\uC2E0\uACE0\uD558\uAE30",
    "\uB3C4\uC6C0\uC774 \uB410\uC5B4\uC694",
    "\uC635\uC158",
    "\uD310\uB9E4\uC790"
  ]);
  function maskText(raw) {
    const text = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (looksLikeDate(text) || looksLikeMetric(text)) return text;
    if (SAFE_LABELS.has(text)) return text;
    if (text.length <= 30) {
      const numbers = text.match(/[\d,.]+/g);
      if (numbers && numbers.length > 0) {
        return `\u27E8text:${text.length} nums:${numbers.slice(0, 3).join("/")}\u27E9`;
      }
    }
    return `\u27E8text:${text.length}\u27E9`;
  }
  function maskUrl(raw) {
    if (!raw) return "";
    try {
      const url = new URL(raw, "https://www.coupang.com");
      const last = url.pathname.split("/").filter(Boolean).slice(-1)[0] ?? "";
      return `${url.origin}/\u2026/${last}`;
    } catch {
      return raw.slice(0, 40);
    }
  }
  function describeElement(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 6).map((c) => `.${c}`).join("");
    const dataAttrs = Array.from(el.attributes).filter((a) => a.name.startsWith("data-") || a.name === "datetime").slice(0, 4).map((a) => `[${a.name}=${a.value.slice(0, 24)}]`).join("");
    return `${tag}${id}${classes}${dataAttrs}`;
  }
  function selectorReport(root, title, selectors) {
    const lines = [`[${title}]`];
    let matched = false;
    for (const selector of selectors) {
      let count = 0;
      try {
        count = root.querySelectorAll(selector).length;
      } catch {
        lines.push(`  ${selector} \u2192 (\uC798\uBABB\uB41C selector)`);
        continue;
      }
      const mark = count > 0 && !matched ? "  \u2190 \uC0AC\uC6A9\uB428" : "";
      if (count > 0) matched = true;
      lines.push(`  ${selector} \u2192 ${count}\uAC1C${mark}`);
    }
    if (!matched) lines.push("  \u26A0 \uB9E4\uCE6D\uB41C selector\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4 \u2014 \uC774 \uD56D\uBAA9\uC744 \uACE0\uCCD0\uC57C \uD569\uB2C8\uB2E4.");
    return lines;
  }
  function outline(el, depth = 0, maxDepth = 4, acc = []) {
    if (depth > maxDepth || acc.length > MAX_SAMPLE_NODES) return acc;
    const indent = "  ".repeat(depth + 1);
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => maskText(n.textContent)).filter(Boolean).join(" ");
    const extra = [
      el.getAttribute("alt") ? `alt="${maskText(el.getAttribute("alt"))}"` : "",
      el.getAttribute("src") ? `src="${maskUrl(el.getAttribute("src"))}"` : "",
      el.getAttribute("href") ? `href="${maskUrl(el.getAttribute("href"))}"` : "",
      el.getAttribute("style") ? `style="${(el.getAttribute("style") ?? "").slice(0, 40)}"` : ""
    ].filter(Boolean).join(" ");
    acc.push(`${indent}${describeElement(el)}${extra ? " " + extra : ""}${own ? `  "${own}"` : ""}`);
    for (const child of Array.from(el.children)) outline(child, depth + 1, maxDepth, acc);
    return acc;
  }
  function dateCandidates(root) {
    const found = [];
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.children.length > 0) continue;
      const text = (el.textContent ?? "").trim();
      if (!text || !looksLikeDate(text)) continue;
      found.push(`  ${describeElement(el)}  "${text}"`);
      if (found.length >= MAX_DATE_SAMPLES) break;
    }
    return found.length > 0 ? found : ["  \u26A0 \uB0A0\uC9DC\uB85C \uBCF4\uC774\uB294 \uD14D\uC2A4\uD2B8\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."];
  }
  function numberCandidates(root) {
    const found = [];
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.children.length > 0) continue;
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 30 || !/\d/.test(text)) continue;
      if (looksLikeDate(text)) continue;
      found.push(`  ${describeElement(el)}  "${maskText(text)}"`);
      if (found.length >= MAX_DATE_SAMPLES) break;
    }
    return found.length > 0 ? found : ["  (\uC5C6\uC74C)"];
  }
  function buildDiagnosticsReport(root, url) {
    const out = [];
    out.push("=== \uCFE0\uD321 \uC18C\uC2F1 \uC218\uC9D1\uAE30 \xB7 selector \uC9C4\uB2E8 ===");
    out.push(`URL      : ${maskUrl(url)}`);
    out.push(`\uC218\uC9D1 \uC2DC\uAC01: ${(/* @__PURE__ */ new Date()).toISOString()}`);
    out.push("\u203B \uB9AC\uBDF0 \uBCF8\uBB38\xB7\uC791\uC131\uC790\uBA85 \uB4F1 \uD14D\uC2A4\uD2B8\uB294 \u27E8text:\uAE38\uC774\u27E9 \uB85C \uB9C8\uC2A4\uD0B9\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
    out.push("");
    out.push(...selectorReport(root, "\uC0C1\uD488 \uCE74\uB4DC", PRODUCT_CARD_SELECTORS));
    out.push("");
    out.push(...selectorReport(root, "\uC0C1\uD488\uBA85", NAME_SELECTORS));
    out.push("");
    out.push(...selectorReport(root, "\uAC00\uACA9", PRICE_SELECTORS));
    out.push("");
    out.push(...selectorReport(root, "\uB9AC\uBDF0\uC218(\uCE74\uB4DC)", REVIEW_COUNT_SELECTORS));
    out.push("");
    out.push(...selectorReport(root, "\uD3C9\uC810", RATING_SELECTORS));
    out.push("");
    out.push(...selectorReport(root, "\uBC30\uC1A1 \uBC30\uC9C0", DELIVERY_BADGE_SELECTORS));
    out.push("");
    out.push(...selectorReport(root, "\uCE74\uD14C\uACE0\uB9AC\uBA85", CATEGORY_NAME_SELECTORS));
    out.push("");
    out.push(...selectorReport(root, "\uB9AC\uBDF0 \uC601\uC5ED", REVIEW_SECTION_SELECTORS));
    out.push("");
    out.push(...selectorReport(root, "\uB9AC\uBDF0 \uCE74\uB4DC", REVIEW_ITEM_SELECTORS));
    out.push("");
    out.push(...selectorReport(root, "\uB9AC\uBDF0 \uC2DD\uBCC4\uC790 \uC575\uCEE4", REVIEW_ID_ANCHOR_SELECTORS));
    const found = findReviewCards(root);
    out.push(
      `  \u2192 \uCD5C\uC885 \uC778\uC2DD\uB41C \uB9AC\uBDF0 \uCE74\uB4DC: ${found.cards.length}\uAC1C (\uACBD\uB85C: ${found.via === "selector" ? "\uD074\uB798\uC2A4 selector" : found.via === "data-review-id" ? "data-review-id \uC575\uCEE4" : "\uC2E4\uD328"})`
    );
    if (found.cards.length > 0) {
      const ids = found.cards.slice(0, 3).map((c) => findReviewId(c) ?? "(\uC5C6\uC74C)");
      out.push(`  \u2192 \uB9AC\uBDF0 \uC2DD\uBCC4\uC790 \uC608\uC2DC: ${ids.join(", ")}`);
    }
    out.push("");
    out.push(...selectorReport(root, "\uB9AC\uBDF0 \uC791\uC131\uC77C", REVIEW_DATE_SELECTORS));
    out.push("");
    out.push(...selectorReport(root, "\uB9AC\uBDF0 \uC815\uB82C \uCEE8\uD2B8\uB864", REVIEW_SORT_SELECTORS));
    out.push("");
    out.push(...selectorReport(root, "\uB204\uC801 \uB9AC\uBDF0\uC218", REVIEW_TOTAL_COUNT_SELECTORS));
    out.push("");
    out.push("[\uB0A0\uC9DC\uB85C \uBCF4\uC774\uB294 \uD14D\uC2A4\uD2B8]");
    out.push(...dateCandidates(root));
    out.push("");
    out.push("[\uC22B\uC790\uAC00 \uB4E4\uC5B4\uAC04 \uC9E7\uC740 \uD14D\uC2A4\uD2B8 (\uB9AC\uBDF0\uC218\xB7\uAC00\uACA9 \uD6C4\uBCF4)]");
    out.push(...numberCandidates(root));
    out.push("");
    let section = null;
    for (const selector of REVIEW_SECTION_SELECTORS) {
      try {
        section = root.querySelector(selector);
        if (section) break;
      } catch {
      }
    }
    out.push("[\uB9AC\uBDF0 \uCE74\uB4DC \uAD6C\uC870 \uC0D8\uD50C]");
    let sample = found.cards[0] ?? null;
    if (sample && found.via === "data-review-id") {
      out.push("  (\uD074\uB798\uC2A4 selector \uC2E4\uD328 \u2192 data-review-id \uC575\uCEE4\uB85C \uCC3E\uC740 \uCE74\uB4DC)");
    }
    if (!sample) {
      for (const el of Array.from((section ?? root).querySelectorAll("*"))) {
        if (el.children.length === 0 && looksLikeDate((el.textContent ?? "").trim())) {
          sample = el.closest("article, li, div[class]") ?? el.parentElement;
          break;
        }
      }
      if (sample) out.push("  (\uBAA8\uB4E0 \uBC29\uBC95 \uC2E4\uD328 \u2192 \uB0A0\uC9DC \uC694\uC18C\uC758 \uC870\uC0C1\uC73C\uB85C \uCD94\uC815)");
    }
    out.push(sample ? outline(sample, 0, 5).join("\n") : "  \u26A0 \uB9AC\uBDF0 \uCE74\uB4DC\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
    out.push("");
    out.push("[\uB9AC\uBDF0 \uC815\uB82C \uCEE8\uD2B8\uB864 \uAD6C\uC870 \uC0D8\uD50C]");
    let sortSample = null;
    for (const selector of REVIEW_SORT_SELECTORS) {
      try {
        sortSample = root.querySelector(selector);
        if (sortSample) break;
      } catch {
      }
    }
    if (!sortSample) {
      for (const el of Array.from(root.querySelectorAll("*"))) {
        if (el.children.length > 0) continue;
        const text = (el.textContent ?? "").trim();
        if (text === "\uCD5C\uC2E0\uC21C" || text === "\uBCA0\uC2A4\uD2B8\uC21C" || text === "\uCD5C\uADFC\uC21C") {
          sortSample = el.parentElement ?? el;
          break;
        }
      }
      if (sortSample) out.push("  (\uC815\uB82C selector\uAC00 \uC2E4\uD328\uD574 '\uCD5C\uC2E0\uC21C' \uD14D\uC2A4\uD2B8\uC758 \uBD80\uBAA8\uB85C \uCD94\uC815)");
    }
    out.push(
      sortSample ? outline(sortSample, 0, 2).join("\n") : "  (\uC815\uB82C \uCEE8\uD2B8\uB864\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4)"
    );
    out.push("");
    out.push("[\uC0C1\uD488 \uCE74\uB4DC \uAD6C\uC870 \uC0D8\uD50C]");
    let card = null;
    for (const selector of PRODUCT_CARD_SELECTORS) {
      try {
        card = root.querySelector(selector);
        if (card) break;
      } catch {
      }
    }
    out.push(card ? outline(card).join("\n") : "  (\uC0C1\uD488 \uBAA9\uB85D \uD398\uC774\uC9C0\uAC00 \uC544\uB2C8\uAC70\uB098 \uCE74\uB4DC\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4)");
    return out.join("\n");
  }

  // src/console/selector_dump.ts
  var report = buildDiagnosticsReport(document, location.href);
  console.log(report);
  try {
    if (typeof copy === "function") {
      copy(report);
      console.log(
        "%c\u2705 \uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uBCF5\uC0AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uCC44\uD305\uCC3D\uC5D0 \uBD99\uC5EC\uB123\uC73C\uC138\uC694.",
        "color:#38d8c8;font-weight:bold"
      );
    } else {
      console.log("%c\uC704 \uB0B4\uC6A9\uC744 \uC804\uCCB4 \uC120\uD0DD\uD574 \uBCF5\uC0AC\uD558\uC138\uC694.", "color:#fbbf24");
    }
  } catch {
    console.log("\uD074\uB9BD\uBCF4\uB4DC \uBCF5\uC0AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uC704 \uB0B4\uC6A9\uC744 \uC9C1\uC811 \uBCF5\uC0AC\uD558\uC138\uC694.");
  }
})();
