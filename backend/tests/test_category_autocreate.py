"""수집할 때 카테고리를 자동으로 만드는 동작.

쿠팡 페이지의 breadcrumb(홈인테리어 > 카페트/매트 > 발매트)을 그대로 저장하므로,
사용자가 카테고리를 따로 import 하지 않아도 수집만으로 트리가 채워진다.
"""

from __future__ import annotations


def product(pid: str, **kwargs):
    base = {
        "product_id": pid,
        "product_name": f"상품 {pid}",
        "product_url": f"https://www.coupang.com/vp/products/{pid}",
        "price": 13900,
        "review_count": 82,
        "rating": 4.7,
        "delivery_type": "rocket_growth",
    }
    base.update(kwargs)
    return base


HOME_PATH = [
    {"code": "1001", "name": "홈인테리어"},
    {"code": "1010", "name": "카페트/매트"},
    {"code": "1011", "name": "발매트"},
]


def collect(client, path, code, name, *pids):
    return client.post(
        "/api/products/collect",
        json={
            "source_url": f"https://www.coupang.com/np/categories/{code}",
            "page_type": "category",
            "category_code": code,
            "category_name": name,
            "category_path": path,
            "products": [product(p) for p in pids],
        },
    ).json()


def test_breadcrumb_becomes_category_tree(client):
    res = collect(client, HOME_PATH, "1011", "발매트", "P1", "P2")
    assert res["categories_created"] == 3

    tree = client.get("/api/categories", params={"tree": "true"}).json()
    assert len(tree) == 1
    root = tree[0]
    assert root["category_name"] == "홈인테리어"
    assert root["depth"] == 1
    assert root["is_leaf"] is False

    mid = root["children"][0]
    assert mid["category_name"] == "카페트/매트"
    assert mid["depth"] == 2

    leaf = mid["children"][0]
    assert leaf["category_name"] == "발매트"
    assert leaf["depth"] == 3
    assert leaf["is_leaf"] is True


def test_products_are_linked_to_leaf_category(client):
    collect(client, HOME_PATH, "1011", "발매트", "P1")
    item = client.get("/api/products").json()["items"][0]
    assert item["category_name"] == "발매트"
    assert item["category_id"] is not None


def test_second_collection_does_not_duplicate(client):
    collect(client, HOME_PATH, "1011", "발매트", "P1")
    res = collect(client, HOME_PATH, "1011", "발매트", "P2")
    assert res["categories_created"] == 0
    assert len(client.get("/api/categories").json()) == 3


def test_sibling_category_extends_tree(client):
    collect(client, HOME_PATH, "1011", "발매트", "P1")
    sibling = [
        {"code": "1001", "name": "홈인테리어"},
        {"code": "1010", "name": "카페트/매트"},
        {"code": "1012", "name": "주방매트"},
    ]
    res = collect(client, sibling, "1012", "주방매트", "P3")
    assert res["categories_created"] == 1

    tree = client.get("/api/categories", params={"tree": "true"}).json()
    mid = tree[0]["children"][0]
    assert sorted(c["category_name"] for c in mid["children"]) == ["발매트", "주방매트"]


def test_without_breadcrumb_creates_single_category(client):
    """breadcrumb을 못 읽어도 현재 카테고리 한 칸은 만든다."""
    res = collect(client, [], "400928", "거실화/슬리퍼", "P9")
    assert res["categories_created"] == 1

    cats = client.get("/api/categories").json()
    assert [c["category_name"] for c in cats] == ["거실화/슬리퍼"]
    assert client.get("/api/products").json()["items"][0]["category_name"] == "거실화/슬리퍼"


def test_imported_category_is_reused_not_duplicated(client):
    """미리 import한 카테고리가 있으면 그대로 쓴다."""
    client.post(
        "/api/categories/import",
        json={"rows": [{"category_code": "1011", "category_name": "발매트", "depth": 1}]},
    )
    res = collect(client, HOME_PATH, "1011", "발매트", "P1")
    # 1011은 이미 있으므로 상위 2개만 새로 만들어진다
    assert res["categories_created"] == 2
    codes = sorted(c["category_code"] for c in client.get("/api/categories").json())
    assert codes == ["1001", "1010", "1011"]


def test_category_filter_works_after_autocreate(client):
    """자동 생성된 카테고리로 상품을 걸러낼 수 있다."""
    collect(client, HOME_PATH, "1011", "발매트", "P1", "P2")
    kitchen = [
        {"code": "2001", "name": "주방용품"},
        {"code": "2011", "name": "채칼/슬라이서"},
    ]
    collect(client, kitchen, "2011", "채칼/슬라이서", "P3")

    cats = {c["category_name"]: c["id"] for c in client.get("/api/categories").json()}
    res = client.get("/api/products", params={"category_ids": cats["발매트"]}).json()
    assert sorted(p["product_id"] for p in res["items"]) == ["P1", "P2"]
