"""판정과 파생 지표 계산. 화면·엑셀·통계가 모두 이 함수를 쓴다."""
from . import config, db

VERDICT_LABEL = {
    "pass": "조건 통과",
    "below": "판매량 미달",
    "excluded": "가격·리뷰 조건 제외",
    "unmatched": "미매칭",
    "pending": "분석 대기",
}


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
        src = "실제가 확인"
    elif p.get("wing_price"):
        src = "Wing 수집가"
    else:
        src = "상세 표시가"
    out["effective_price"] = price
    out["price_source"] = src
    sales = p.get("sales_28")
    views = p.get("views_28")
    reviews = p.get("review_count") or 0
    out["daily_avg"] = round(sales / 28, 1) if sales is not None else None
    out["conversion"] = round(sales / views * 100, 2) if sales is not None and views else None
    out["revenue_28"] = sales * price if sales is not None else None
    out["sales_per_review"] = round(sales / reviews, 1) if sales is not None and reviews else (float(sales) if sales else None)
    out["coupon_flag"] = bool(p.get("coupon_flag")) or (bool(p.get("wing_price")) and not p.get("verified_price"))

    if not db.price_review_ok(p, cond):
        v = "excluded"
    elif not p.get("analyzed"):
        v = "pending"
    elif not p.get("matched"):
        v = "unmatched"
    else:
        v = "pass"
        if cond.get("sales_min") and (sales or 0) < cond["sales_min"]:
            v = "below"
        if cond.get("sales_max") and (sales or 0) > cond["sales_max"]:
            v = "below"
        if cond.get("conv_min") and (out["conversion"] or 0) < cond["conv_min"]:
            v = "below"
    out["verdict"] = v
    out["verdict_label"] = VERDICT_LABEL[v]
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
