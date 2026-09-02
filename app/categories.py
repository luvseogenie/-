"""카테고리 트리. 1차는 고정 목록, 하위는 쿠팡 페이지에서 찾아 DB에 저장한다."""
from . import config, db, log
from .browser import human_delay
from .coupang_list import fetch_children


def top_categories():
    db.ensure_top_categories()
    return [{"id": cid, "name": name} for cid, name in config.TOP_CATEGORIES]


def tree(cid: int, depth_limit: int = 3) -> dict:
    row = db.get_category(cid)
    if row is None:
        return {"id": cid, "name": str(cid), "children": [], "fetched": False, "is_leaf": False}
    node = {"id": row["id"], "name": row["name"], "depth": row["depth"], "path": row["path"],
            "fetched": bool(row["children_fetched"]), "is_leaf": bool(row["is_leaf"]), "children": []}
    if depth_limit > 1:
        for ch in db.get_children(cid):
            node["children"].append(tree(ch["id"], depth_limit - 1))
    return node


def _ancestor_ids(cid) -> list[int]:
    out = []
    row = db.get_category(cid)
    while row is not None and row["parent_id"]:
        out.append(row["parent_id"])
        row = db.get_category(row["parent_id"])
    return out


def discover_children(bt, cid: int, force: bool = False) -> list[dict]:
    """브라우저 스레드 안에서 호출. 하위 카테고리를 찾아 저장하고 돌려준다."""
    row = db.get_category(cid)
    if row is not None and row["children_fetched"] and not force:
        return [dict(r) for r in db.get_children(cid)]
    parent_name = row["name"] if row else str(cid)
    parent_path = row["path"] if row else parent_name
    depth = (row["depth"] if row else 0) + 1
    ancestors = _ancestor_ids(cid)
    siblings = [r["id"] for r in db.get_children(row["parent_id"])] if row and row["parent_id"] else []
    exclude = list({*ancestors, *siblings, cid})
    # 현재 항목의 형제는 제외하되, 자기 자신은 제외 목록에 포함시킨다
    page = bt.page()
    data = fetch_children(page, cid, exclude)
    kids = data["children"]
    how = data.get("how")
    # 사이드바 전체를 긁은 경우엔 신뢰도가 낮다. 형제와 조상을 뺀 뒤에도 남은 것만 하위로 본다.
    if how == "all-side" and not kids:
        db.mark_children_fetched(cid, is_leaf=True)
        log.info(f"[카테고리] {parent_path}: 최하위")
        return []
    for k in kids:
        db.upsert_category(k["id"], k["name"], cid, depth, f"{parent_path} > {k['name']}")
    db.mark_children_fetched(cid, is_leaf=(len(kids) == 0))
    log.info(f"[카테고리] {parent_path}: 하위 {len(kids)}개 ({how})")
    human_delay()
    return [dict(r) for r in db.get_children(cid)]


def expand_to_leaves(bt, cid: int, should_stop, max_depth: int = 6, _depth: int = 0) -> list[dict]:
    """선택한 카테고리를 최하위 카테고리 목록으로 펼친다."""
    if should_stop():
        return []
    row = db.get_category(cid)
    if row is not None and row["children_fetched"] and row["is_leaf"]:
        return [dict(row)]
    if _depth >= max_depth:
        return [dict(row)] if row else []
    kids = discover_children(bt, cid)
    if not kids:
        row = db.get_category(cid)
        return [dict(row)] if row else []
    out = []
    for k in kids:
        out.extend(expand_to_leaves(bt, k["id"], should_stop, max_depth, _depth + 1))
    return out
