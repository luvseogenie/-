from __future__ import annotations

from tests.conftest import SAMPLE_CATEGORIES


def test_import_and_tree(client):
    res = client.post("/api/categories/import", json={"rows": SAMPLE_CATEGORIES})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["received"] == 6
    assert body["created"] == 6
    assert body["errors"] == []

    tree = client.get("/api/categories", params={"tree": "true"}).json()
    assert len(tree) == 2  # 1차 카테고리 2개
    names = sorted(n["category_name"] for n in tree)
    assert names == ["주방용품", "홈인테리어"]

    home = next(n for n in tree if n["category_name"] == "홈인테리어")
    assert home["depth"] == 1
    assert home["is_leaf"] is False
    carpet = home["children"][0]
    assert carpet["category_name"] == "카페트/매트"
    leaf = carpet["children"][0]
    assert leaf["category_name"] == "발매트"
    assert leaf["depth"] == 3
    assert leaf["is_leaf"] is True


def test_children_endpoint(client):
    client.post("/api/categories/import", json={"rows": SAMPLE_CATEGORIES})
    roots = client.get("/api/categories", params={"root_only": "true"}).json()
    kitchen = next(c for c in roots if c["category_name"] == "주방용품")
    children = client.get(f"/api/categories/{kitchen['id']}/children").json()
    assert [c["category_name"] for c in children] == ["조리도구"]

    res = client.get("/api/categories/999999/children")
    assert res.status_code == 404


def test_import_order_independent(client):
    """자식이 부모보다 먼저 나와도 트리가 정상 구성되어야 한다."""
    reversed_rows = list(reversed(SAMPLE_CATEGORIES))
    client.post("/api/categories/import", json={"rows": reversed_rows})
    tree = client.get("/api/categories", params={"tree": "true"}).json()
    assert len(tree) == 2
    home = next(n for n in tree if n["category_name"] == "홈인테리어")
    assert home["children"][0]["children"][0]["category_name"] == "발매트"


def test_import_missing_parent_is_reported(client):
    rows = [{"category_code": "X-1", "category_name": "고아", "parent_category_code": "NOPE", "depth": 2}]
    body = client.post("/api/categories/import", json={"rows": rows}).json()
    assert body["created"] == 1
    assert any("부모 카테고리를 찾을 수 없음" in e for e in body["errors"])


def test_csv_import_file(client):
    csv_text = (
        "category_code,category_name,parent_category_code,depth,category_url\n"
        "K-1,생활용품,,1,https://example.test/c/K1\n"
        "K-2,청소용품,K-1,2,https://example.test/c/K2\n"
    )
    res = client.post(
        "/api/categories/import/file",
        files={"file": ("cats.csv", csv_text.encode("utf-8"), "text/csv")},
    )
    assert res.status_code == 200, res.text
    assert res.json()["created"] == 2

    leaves = client.get("/api/categories", params={"leaf_only": "true"}).json()
    assert [c["category_name"] for c in leaves] == ["청소용품"]


def test_bad_file_reports_reason(client):
    res = client.post(
        "/api/categories/import/file",
        files={"file": ("cats.csv", b"wrong,header\n1,2\n", "text/csv")},
    )
    assert res.status_code == 400
    assert "필수 컬럼" in res.json()["detail"]


def test_reimport_without_parent_keeps_existing_parent(client):
    """부모를 명시하지 않은 재등록은 기존 부모 연결을 지우지 않는다."""
    client.post("/api/categories/import", json={"rows": [
        {"category_code": "R", "category_name": "루트"},
        {"category_code": "C", "category_name": "자식", "parent_category_code": "R"},
    ]})
    res = client.post("/api/categories/import", json={"rows": [{"category_code": "C", "category_name": "자식(이름 갱신)"}]})
    assert res.status_code == 200
    tree = client.get("/api/categories?tree=true").json()
    root = next(n for n in tree if n["category_code"] == "R")
    assert [c["category_name"] for c in root["children"]] == ["자식(이름 갱신)"]
    assert root["children"][0]["depth"] == 2
