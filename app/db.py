"""SQLite 저장소. 실행(run) 단위로 상품과 분석 결과를 보관한다."""
import json
import sqlite3
import threading
from datetime import datetime

from . import log, config

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT,
  parent_id INTEGER,
  depth INTEGER DEFAULT 1,
  path TEXT,
  children_fetched INTEGER DEFAULT 0,
  is_leaf INTEGER DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT,
  status TEXT,
  scope TEXT,
  conditions TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS run_categories (
  run_id INTEGER,
  category_id INTEGER,
  name TEXT,
  path TEXT,
  status TEXT DEFAULT 'pending',
  pages_done INTEGER DEFAULT 0,
  products_seen INTEGER DEFAULT 0,
  PRIMARY KEY (run_id, category_id)
);
CREATE TABLE IF NOT EXISTS products (
  run_id INTEGER,
  product_id INTEGER,
  item_id INTEGER,
  vendor_item_id INTEGER,
  name TEXT,
  url TEXT,
  image TEXT,
  price INTEGER,
  base_price INTEGER,
  review_count INTEGER,
  rating REAL,
  delivery TEXT,
  is_ad INTEGER DEFAULT 0,
  sold_out INTEGER DEFAULT 0,
  category_id INTEGER,
  category_path TEXT,
  rank INTEGER,
  page INTEGER,
  option_count INTEGER DEFAULT 1,
  seen_count INTEGER DEFAULT 1,
  restricted TEXT,
  first_seen TEXT,
  analyzed INTEGER DEFAULT 0,
  matched INTEGER DEFAULT 0,
  sales_28 INTEGER,
  views_28 INTEGER,
  wing_price INTEGER,
  wing_name TEXT,
  seller_count INTEGER,
  analysis_error TEXT,
  analyzed_at TEXT,
  verified_price INTEGER,
  verified_at TEXT,
  coupon_flag INTEGER DEFAULT 0,
  hidden INTEGER DEFAULT 0,
  PRIMARY KEY (run_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_products_run ON products(run_id, analyzed);
CREATE TABLE IF NOT EXISTS archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  saved_at TEXT,
  run_id INTEGER,
  product_id INTEGER,
  data TEXT
);
"""


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = sqlite3.connect(str(config.DB_PATH), timeout=30, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        _local.conn = c
    return c


def init_db():
    c = conn()
    c.executescript(SCHEMA)
    # 윙 인기상품검색에서 얻는 값들 (예전 DB에도 컬럼을 더한다)
    extra = [("pv_low", "INTEGER"), ("pv_high", "INTEGER"), ("pv_rank", "INTEGER"),
             ("mergeable", "TEXT"), ("eligibility", "TEXT"), ("wing_category", "TEXT"),
             ("wing_rating", "REAL"), ("wing_review", "INTEGER"), ("pv_exact", "INTEGER"),
             ("option_total", "INTEGER"), ("buyers_min", "INTEGER"), ("badge_key", "TEXT"),
             ("delivery_sure", "INTEGER"), ("price_sale", "INTEGER"), ("price_origin", "INTEGER"),
             ("buyers_options", "INTEGER"), ("buyers_detail", "TEXT"),
             ("reviews_28", "INTEGER"), ("reviews_28_days", "REAL"), ("reviews_28_at", "TEXT"), ("reviews_28_note", "TEXT")]
    have = {r[1] for r in c.execute("PRAGMA table_info(products)").fetchall()}
    for col, typ in extra:
        if col not in have:
            c.execute(f"ALTER TABLE products ADD COLUMN {col} {typ}")
    c.commit()
    _fix_global_badges()


def _fix_global_badges():
    """예전 규칙(해외 판매자 = 로켓직구)으로 잘못 학습된 뱃지→로켓직구 대응을 지우고,
    그 학습으로 '로켓직구 확정'이 된 상품(상세 확인은 안 한 것)을 '로켓 추정'으로 되돌린다. 한 번만 실행."""
    if get_setting("fix_global_badges_v1"):
        return
    bm = get_setting("badge_map", {}) or {}
    bad = [k for k, v in bm.items() if v == "ROCKET_GLOBAL"]
    for k in bad:
        bm.pop(k, None)
    set_setting("badge_map", bm)
    c = conn()
    cur = c.execute("UPDATE products SET delivery='ROCKET', delivery_sure=0 "
                    "WHERE delivery='ROCKET_GLOBAL' AND (verified_at IS NULL OR verified_at='') AND COALESCE(delivery_sure,0)=1")
    c.commit()
    set_setting("fix_global_badges_v1", True)
    if bad or cur.rowcount:
        log.info(f"로켓직구 오판 정리: 뱃지 학습 {len(bad)}개 삭제, 상품 {cur.rowcount}개를 '로켓(추정)'으로 되돌림")


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------- settings ----------
def get_setting(key, default=None):
    row = conn().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["value"])
    except Exception:
        return default


def set_setting(key, value):
    c = conn()
    c.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (key, json.dumps(value, ensure_ascii=False)))
    c.commit()


def get_conditions() -> dict:
    cond = dict(config.DEFAULT_CONDITIONS)
    saved = get_setting("conditions", {}) or {}
    for k in ("sales_min", "sales_max", "only_mergeable", "fetch_rank", "views_max"):   # 더 이상 쓰지 않는 옛 조건 (조회수는 최소만)
        saved.pop(k, None)
    cond.update(saved)
    return cond


# ---------- categories ----------
def upsert_category(cid, name, parent_id, depth, path, is_leaf=None, children_fetched=None):
    c = conn()
    row = c.execute("SELECT * FROM categories WHERE id=?", (cid,)).fetchone()
    if row is None:
        c.execute(
            "INSERT INTO categories(id, name, parent_id, depth, path, children_fetched, is_leaf, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (cid, name, parent_id, depth, path, int(bool(children_fetched)), int(bool(is_leaf)), now()),
        )
    else:
        c.execute(
            "UPDATE categories SET name=?, parent_id=?, depth=?, path=?, updated_at=?, "
            "is_leaf=COALESCE(?, is_leaf), children_fetched=COALESCE(?, children_fetched) WHERE id=?",
            (name, parent_id, depth, path, now(),
             None if is_leaf is None else int(bool(is_leaf)),
             None if children_fetched is None else int(bool(children_fetched)), cid),
        )
    c.commit()


def get_category(cid):
    return conn().execute("SELECT * FROM categories WHERE id=?", (cid,)).fetchone()


def get_children(cid):
    return conn().execute("SELECT * FROM categories WHERE parent_id=? ORDER BY rowid", (cid,)).fetchall()


def mark_children_fetched(cid, is_leaf):
    c = conn()
    c.execute("UPDATE categories SET children_fetched=1, is_leaf=?, updated_at=? WHERE id=?", (int(is_leaf), now(), cid))
    c.commit()


def ensure_top_categories():
    c = conn()
    for oid in (185569, 178155, 317678, 183960, 317677, 317679, 305698):
        c.execute("DELETE FROM categories WHERE id=? OR parent_id=?", (oid, oid))
    c.commit()
    for cid, name in config.TOP_CATEGORIES:
        if get_category(cid) is None:
            upsert_category(cid, name, None, 1, name)


# ---------- runs ----------
def create_run(scope, conditions) -> int:
    c = conn()
    cur = c.execute(
        "INSERT INTO runs(created_at, status, scope, conditions) VALUES (?,?,?,?)",
        (now(), "created", json.dumps(scope, ensure_ascii=False), json.dumps(conditions, ensure_ascii=False)),
    )
    c.commit()
    return cur.lastrowid


def latest_run():
    return conn().execute("SELECT * FROM runs ORDER BY id DESC LIMIT 1").fetchone()


def get_run(run_id):
    return conn().execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()


def set_run_status(run_id, status, note=None):
    c = conn()
    if note is None:
        c.execute("UPDATE runs SET status=? WHERE id=?", (status, run_id))
    else:
        c.execute("UPDATE runs SET status=?, note=? WHERE id=?", (status, note, run_id))
    c.commit()


def add_run_category(run_id, cid, name, path):
    c = conn()
    c.execute(
        "INSERT OR IGNORE INTO run_categories(run_id, category_id, name, path) VALUES (?,?,?,?)",
        (run_id, cid, name, path),
    )
    c.commit()


def update_run_category(run_id, cid, **fields):
    c = conn()
    sets = ", ".join(f"{k}=?" for k in fields)
    c.execute(f"UPDATE run_categories SET {sets} WHERE run_id=? AND category_id=?", (*fields.values(), run_id, cid))
    c.commit()


def run_categories(run_id):
    return conn().execute("SELECT * FROM run_categories WHERE run_id=? ORDER BY rowid", (run_id,)).fetchall()


# ---------- products ----------
def upsert_product(run_id, p: dict, restricted: str | None):
    """목록에서 본 상품을 저장. 같은 상품(productId)은 한 줄로 묶는다."""
    c = conn()
    row = c.execute("SELECT item_id, option_count, seen_count FROM products WHERE run_id=? AND product_id=?",
                    (run_id, p["product_id"])).fetchone()
    if row is None:
        c.execute(
            """INSERT INTO products(run_id, product_id, item_id, vendor_item_id, name, url, image, price, base_price,
               review_count, rating, delivery, is_ad, sold_out, category_id, category_path, rank, page, restricted, first_seen,
               badge_key, delivery_sure)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (run_id, p["product_id"], p.get("item_id"), p.get("vendor_item_id"), p.get("name"), p.get("url"),
             p.get("image"), p.get("price"), p.get("base_price"), p.get("review_count"), p.get("rating"),
             p.get("delivery"), int(bool(p.get("is_ad"))), int(bool(p.get("sold_out"))), p.get("category_id"),
             p.get("category_path"), p.get("rank"), p.get("page"), restricted, now(),
             p.get("badge_key"), int(bool(p.get("delivery_sure")))),
        )
        c.commit()
        return True
    option_count = row["option_count"] + (1 if p.get("item_id") and p.get("item_id") != row["item_id"] else 0)
    c.execute(
        "UPDATE products SET seen_count=seen_count+1, option_count=? WHERE run_id=? AND product_id=?",
        (option_count, run_id, p["product_id"]),
    )
    c.commit()
    return False


def products(run_id):
    return [dict(r) for r in conn().execute("SELECT * FROM products WHERE run_id=?", (run_id,)).fetchall()]


def eligible(p: dict, cond: dict) -> bool:
    """가격·리뷰 조건에 맞고, 못 파는 물건/광고 제외 설정에 걸리지 않는 상품만 True."""
    if not price_review_ok(p, cond):
        return False
    if cond.get("exclude_restricted") and p.get("restricted"):
        return False
    if cond.get("hide_ads") and p.get("is_ad"):
        return False
    if p.get("hidden"):
        return False
    return True


def pending_products(run_id, include_excluded: bool, cond: dict):
    rows = products(run_id)
    out = []
    for p in rows:
        if p["analyzed"]:
            continue
        if not include_excluded and not eligible(p, cond):
            continue
        out.append(p)
    return out


def price_review_ok(p: dict, cond: dict) -> bool:
    # 쿠폰·할인 적용 최종가를 알면 그걸로, 모르면 목록 가격으로 판정
    price = p.get("verified_price") or p.get("price") or 0
    reviews = p.get("review_count") or 0
    if cond.get("price_min") and price < cond["price_min"]:
        return False
    if cond.get("price_max") and price > cond["price_max"]:
        return False
    if cond.get("review_min") and reviews < cond["review_min"]:
        return False
    if cond.get("review_max") and reviews > cond["review_max"]:
        return False
    return True


def save_analysis(run_id, product_id, result: dict | None, error: str | None):
    c = conn()
    if result:
        c.execute(
            """UPDATE products SET analyzed=1, matched=1, sales_28=?, views_28=?, pv_low=?, pv_high=?, pv_rank=?,
               wing_price=?, wing_name=?, wing_rating=?, wing_review=?, wing_category=?, mergeable=?, eligibility=?,
               seller_count=COALESCE(?, seller_count), coupon_flag=?, pv_exact=?, option_total=?,
               analysis_error=NULL, analyzed_at=? WHERE run_id=? AND product_id=?""",
            (result.get("sales_28"), result.get("views_28"), result.get("pv_low"), result.get("pv_high"),
             result.get("pv_rank"), result.get("wing_price"), result.get("wing_name"), result.get("wing_rating"),
             result.get("wing_review"), result.get("wing_category"), result.get("mergeable"), result.get("eligibility"),
             result.get("seller_count"), int(bool(result.get("coupon_flag"))), int(bool(result.get("pv_exact"))),
             result.get("option_total"), now(), run_id, product_id),
        )
    else:
        c.execute(
            "UPDATE products SET analyzed=1, matched=0, analysis_error=?, analyzed_at=? WHERE run_id=? AND product_id=?",
            (error, now(), run_id, product_id),
        )
    c.commit()


def reset_unmatched(run_id) -> int:
    c = conn()
    cur = c.execute("UPDATE products SET analyzed=0 WHERE run_id=? AND analyzed=1 AND matched=0", (run_id,))
    c.commit()
    return cur.rowcount


def save_verified_price(run_id, product_id, price: int | None, buyers_min: int | None = None, sellers: int | None = None,
                        price_sale: int | None = None, price_origin: int | None = None):
    c = conn()
    c.execute("""UPDATE products SET verified_price=COALESCE(?, verified_price), verified_at=?,
                 buyers_min=COALESCE(?, buyers_min), seller_count=COALESCE(?, seller_count),
                 price_sale=COALESCE(?, price_sale), price_origin=COALESCE(?, price_origin),
                 coupon_flag=CASE WHEN ? IS NOT NULL THEN 0 ELSE coupon_flag END
                 WHERE run_id=? AND product_id=?""",
              (price, now(), buyers_min, sellers, price_sale, price_origin, price, run_id, product_id))
    c.commit()


def save_quick_price(run_id, product_id, price: int | None, price_sale: int | None = None, price_origin: int | None = None):
    """가격 API 로 얻은 쿠폰 적용가. 상세 확인(구매자·배송)은 아직이므로 verified_at 은 건드리지 않는다."""
    if not price:
        return
    c = conn()
    c.execute("""UPDATE products SET verified_price=?, price_sale=COALESCE(?, price_sale), price_origin=COALESCE(?, price_origin),
                 coupon_flag=0 WHERE run_id=? AND product_id=?""", (price, price_sale, price_origin, run_id, product_id))
    c.commit()


def save_review_velocity(run_id, product_id, count: int | None, days: float | None, note: str | None):
    c = conn()
    c.execute("UPDATE products SET reviews_28=?, reviews_28_days=?, reviews_28_at=?, reviews_28_note=? WHERE run_id=? AND product_id=?",
              (count, days, now(), note, run_id, product_id))
    c.commit()


def save_buyers_sum(run_id, product_id, total: int | None, n_options: int, detail: list):
    c = conn()
    c.execute("UPDATE products SET buyers_min=?, buyers_options=?, buyers_detail=? WHERE run_id=? AND product_id=?",
              (total, n_options, json.dumps(detail, ensure_ascii=False), run_id, product_id))
    c.commit()


def set_delivery(run_id, product_id, delivery: str, sure: bool = True):
    c = conn()
    c.execute("UPDATE products SET delivery=?, delivery_sure=? WHERE run_id=? AND product_id=?", (delivery, int(sure), run_id, product_id))
    c.commit()


def apply_badge_map(run_id, badge_key: str, delivery: str) -> int:
    """같은 뱃지 그림을 쓰는 상품들의 배송 형태를 한 번에 맞춘다 (확정된 것은 건드리지 않음)."""
    c = conn()
    cur = c.execute("UPDATE products SET delivery=? WHERE run_id=? AND badge_key=? AND COALESCE(delivery_sure,0)=0",
                    (delivery, run_id, badge_key))
    c.commit()
    return cur.rowcount


def set_hidden(run_id, product_ids, hidden: bool):
    c = conn()
    c.executemany("UPDATE products SET hidden=? WHERE run_id=? AND product_id=?",
                  [(int(hidden), run_id, pid) for pid in product_ids])
    c.commit()


# ---------- archive ----------
def archive_add(run_id, items: list[dict]) -> int:
    c = conn()
    n = 0
    for p in items:
        exists = c.execute("SELECT 1 FROM archive WHERE product_id=?", (p["product_id"],)).fetchone()
        if exists:
            continue
        c.execute("INSERT INTO archive(saved_at, run_id, product_id, data) VALUES (?,?,?,?)",
                  (now(), run_id, p["product_id"], json.dumps(p, ensure_ascii=False)))
        n += 1
    c.commit()
    return n


def archive_list():
    rows = conn().execute("SELECT * FROM archive ORDER BY id DESC").fetchall()
    out = []
    for r in rows:
        d = json.loads(r["data"])
        d["archive_id"] = r["id"]
        d["saved_at"] = r["saved_at"]
        out.append(d)
    return out


def archive_delete(ids):
    c = conn()
    c.executemany("DELETE FROM archive WHERE id=?", [(i,) for i in ids])
    c.commit()


def clear_run_products(run_id):
    c = conn()
    c.execute("DELETE FROM products WHERE run_id=?", (run_id,))
    c.execute("DELETE FROM run_categories WHERE run_id=?", (run_id,))
    c.commit()
