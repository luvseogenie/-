"""카테고리 트리. 1차는 고정 목록, 하위는 쿠팡 페이지에서 찾아 DB에 저장한다."""
from . import config, db, log
from .browser import human_delay
from .coupang_list import fetch_children, fetch_home_tree

OLD_IDS = [185569, 178155, 317678, 183960, 317677, 317679, 305698]   # 예전에 잘못 알고 있던 1차 번호


def home_tree_loaded() -> bool:
    return bool(db.get_setting("home_tree_loaded_at"))


def load_home_tree(bt) -> int:
    """홈 화면 메뉴에서 1차→2차→3차 전체를 읽어 DB에 넣는다. 브라우저 스레드에서 호출."""
    c = db.conn()
    for oid in OLD_IDS:
        c.execute("DELETE FROM categories WHERE id=? OR parent_id=?", (oid, oid))
    c.commit()
    data = fetch_home_tree(bt.page())
    n = 0
    for top in data["tops"]:
        db.upsert_category(top["id"], top["name"], None, 1, top["name"], is_leaf=False, children_fetched=True)
        n += 1
        for sub in top["children"]:
            path2 = f"{top['name']} > {sub['name']}"
            has3 = bool(sub["children"])
            db.upsert_category(sub["id"], sub["name"], top["id"], 2, path2, is_leaf=False, children_fetched=has3)
            n += 1
            for third in sub["children"]:
                db.upsert_category(third["id"], third["name"], sub["id"], 3, f"{path2} > {third['name']}", is_leaf=None, children_fetched=False)
                n += 1
    db.set_setting("home_tree_loaded_at", db.now())
    log.info(f"홈 메뉴에서 카테고리 {n}개를 읽었습니다 (1차 {len(data['tops'])}개)")
    return n


def top_categories():
    db.ensure_top_categories()
    rows = db.conn().execute("SELECT id, name FROM categories WHERE depth=1 AND parent_id IS NULL ORDER BY rowid").fetchall()
    known = {cid for cid, _ in config.TOP_CATEGORIES}
    out = [{"id": cid, "name": name} for cid, name in config.TOP_CATEGORIES]
    for r in rows:
        if r["id"] not in known and r["id"] not in OLD_IDS:
            out.append({"id": r["id"], "name": r["name"]})
    return out


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
    if not home_tree_loaded() or force and row is not None and row["depth"] <= 2:
        load_home_tree(bt)
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
    if data.get("is_leaf"):
        db.mark_children_fetched(cid, is_leaf=True)
        log.info(f"[카테고리] {parent_path}: 최하위 (필터에 자기 자신이 있음)")
        human_delay()
        return []
    # 사이드바 전체를 긁은 경우엔 신뢰도가 낮다. 형제와 조상을 뺀 뒤에도 남은 것만 하위로 본다.
    if how == "all-side" and not kids:
        db.mark_children_fetched(cid, is_leaf=True)
        log.info(f"[카테고리] {parent_path}: 최하위")
        return []
    if how == "all-side":
        # 필터 목록을 못 찾은 경우: 광고성 링크가 섞일 수 있으므로 하위로 인정하지 않는다
        log.warn(f"[카테고리] {parent_path}: 하위 목록을 찾지 못해 최하위로 봅니다 ({len(kids)}개 링크 무시)")
        kids = []
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
