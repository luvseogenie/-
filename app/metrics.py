"""판정과 파생 지표 계산. 화면·엑셀·통계가 모두 이 함수를 쓴다."""
from . import config, db

VERDICT_LABEL = {
    "pass": "조건 통과",
    "below": "판매량 미달",
    "excluded": "가격·리뷰 조건 제외",
    "unmatched": "미매칭",
    "pending": "분석 대기",
}


def _fmt_range(lo, hi):
    def man(n):
        if n is None:
            return None
        if n >= 10000:
            v = n / 10000
            return (f"{v:.0f}만" if v == int(v) else f"{v:.1f}만")
        return f"{n:,}"
    a, b = man(lo), man(hi)
    if a and b:
        return f"{a}~{b}"
    return a or b or None


def _mergeable_label(status, eligibility) -> str | None:
    s = (status or "").upper()
    e = (eligibility or "").upper()
    if s in ("DECLINE", "NOT_MERGEABLE", "REJECT") or "NOT_MERGEABLE" in e or "INVALID" in e:
        return "매칭 불가"
    if s in ("MERGEABLE", "APPROVE", "OK", "AVAILABLE") or e in ("VALID", "MERGEABLE"):
        return "매칭 가능"
    if status or eligibility:
        return "확인 필요"
    return None


def restricted_reason(name: str, category_path: str) -> str | None:
    text = f"{category_path or ''} {name or ''}"
    for label, words in config.RESTRICTED_RULES.items():
        for w in words:
            if w.lower() in text.lower():
                return label
    return None


def enrich(p: dict, cond: dict) -> dict:
    """상품 한 줄에 판정, 전환율, 매출 등을 붙인다."""
    out = dict(p)
    price = p.get("verified_price") or p.get("wing_price") or p.get("price") or 0
    if p.get("verified_price"):
        ps = p.get("price_sale")
        src = ("쿠폰·할인 적용 최종가" if p.get("verified_at") else "쿠폰 적용가") + (f" · 일반 {ps:,}원" if ps and ps != p.get("verified_price") else "")
    elif p.get("wing_price"):
        src = "Wing 수집가"
    else:
        src = "상세 표시가"
    out["effective_price"] = price
    out["price_source"] = src
    views = p.get("views_28")
    reviews = p.get("review_count") or 0
    # 28일 판매 = 최근 28일 리뷰 수 × 배수 (추정). 상세 확인의 '월 N명 이상'은 별도 표시.
    mult = float(cond.get("review_multiplier") or 20)
    r28 = p.get("reviews_28")
    sales = int(round(r28 * mult)) if r28 is not None else None
    out["sales_est"] = sales
    out["reviews_28"] = r28
    out["reviews_28_note"] = p.get("reviews_28_note")
    out["review_multiplier"] = mult
    out["daily_avg"] = round(sales / 28, 1) if sales is not None else None
    out["conversion"] = round(sales / views * 100, 2) if sales is not None and views else None
    out["revenue_28"] = sales * price if sales is not None else None
    out["sales_per_review"] = round(sales / reviews, 1) if sales is not None and reviews else (float(sales) if sales else None)
    out["coupon_flag"] = bool(p.get("coupon_flag")) or (bool(p.get("wing_price")) and not p.get("verified_price"))
    out["views_range"] = (f"{views:,}" if p.get("pv_exact") and views else _fmt_range(p.get("pv_low"), p.get("pv_high")))
    buyers = p.get("buyers_min")
    out["buyers_min"] = buyers
    out["conversion_min"] = round(buyers / views * 100, 2) if buyers and views else None
    out["buyers_daily"] = round(buyers / 30, 1) if buyers else None
    out["revenue_min"] = buyers * price if buyers and price else None
    out["revenue_est"] = sales * price if sales and price else None
    detail = []
    if p.get("buyers_detail"):
        try:
            import json as _json
            detail = _json.loads(p["buyers_detail"]) or []
        except Exception:  # noqa: BLE001
            detail = []
    out["buyers_detail_list"] = detail
    vals = [d.get("buyers_min") or 0 for d in detail]
    out["buyers_best"] = max(vals) if vals else None
    out["buyers_per_review"] = round(buyers / reviews, 1) if buyers and reviews else None
    out["mergeable_label"] = _mergeable_label(p.get("mergeable"), p.get("eligibility"))
    out["mergeable_ok"] = out["mergeable_label"] == "매칭 가능"
    # 조회 대비 리뷰 비율(관심도) - 판매량 대용 지표
    out["review_per_view"] = round(reviews / views * 1000, 2) if views else None

    if not db.price_review_ok(p, cond):
        v = "excluded"
    elif not p.get("analyzed"):
        v = "pending"
    elif not p.get("matched"):
        v = "unmatched"
    else:
        v = "pass"
        if cond.get("views_min") and (views or 0) < cond["views_min"]:
            v = "below"
        if cond.get("views_max") and (views or 0) > cond["views_max"]:
            v = "below"
        # (예전 버전의 '28일 판매량' 조건은 더 이상 쓰지 않는다)
        if cond.get("buyers_min"):
            basis = sales if sales is not None else buyers
            if basis is None or basis < cond["buyers_min"]:
                v = "below"
        if cond.get("sales28_min") and sales is not None and sales < cond["sales28_min"]:
            v = "below"
        if cond.get("conv_min") and (out["conversion"] or out["conversion_min"] or 0) < cond["conv_min"]:
            v = "below"
        if cond.get("only_mergeable") and not out["mergeable_ok"]:
            v = "below"
    out["verdict"] = v
    out["verdict_label"] = VERDICT_LABEL[v]
    # 구매자·전환율 조건은 상세 확인 후에야 알 수 있으므로, 그 전 단계 통과 여부를 따로 둔다
    pre = db.eligible(p, cond) and bool(p.get("analyzed")) and bool(p.get("matched"))
    if pre:
        if cond.get("views_min") and (views or 0) < cond["views_min"]:
            pre = False
        if cond.get("views_max") and (views or 0) > cond["views_max"]:
            pre = False
    out["pre_pass"] = pre
    return out


def summarize(rows: list[dict], run_cats: list, seen_total: int) -> dict:
    passed = [r for r in rows if r["verdict"] == "pass" and not r.get("hidden")]
    return {
        "passed": len(passed),
        "unique": len(rows),
        "analyzed": sum(1 for r in rows if r.get("analyzed")),
        "categories": len(run_cats),
        "seen": seen_total,
        "passed_revenue": sum((r.get("revenue_28") or 0) for r in passed),
        "passed_views": sum((r.get("views_28") or 0) for r in passed),
        "passed_revenue_min": sum(((r.get("revenue_est") or r.get("revenue_min") or 0)) for r in passed),
        "counts": {
            "all": len(rows),
            "pass": len(passed),
            "below": sum(1 for r in rows if r["verdict"] == "below"),
            "excluded": sum(1 for r in rows if r["verdict"] == "excluded"),
            "unmatched": sum(1 for r in rows if r["verdict"] == "unmatched"),
            "pending": sum(1 for r in rows if r["verdict"] == "pending"),
            "coupon": sum(1 for r in rows if r.get("coupon_flag")),
            "restricted": sum(1 for r in rows if r.get("restricted")),
            "hidden": sum(1 for r in rows if r.get("hidden")),
        },
    }
