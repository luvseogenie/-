"""자동 스캔: 카테고리 선택 → 시작 한 번 → 확장이 목록/상세를 순차 처리."""

from __future__ import annotations

import pytest

TREE = [
    {"category_code": "1000", "category_name": "홈인테리어", "parent_category_code": None, "depth": 1},
    {"category_code": "1010", "category_name": "카페트/매트", "parent_category_code": "1000", "depth": 2},
    {"category_code": "1011", "category_name": "발매트", "parent_category_code": "1010", "depth": 3},
    {"category_code": "1012", "category_name": "주방매트", "parent_category_code": "1010", "depth": 3},
    {"category_code": "1020", "category_name": "커튼", "parent_category_code": "1000", "depth": 2},
]


@pytest.fixture()
def tree(client):
    client.post("/api/categories/import", json={"rows": TREE})
    return {c["category_name"]: c for c in client.get("/api/categories").json()}


def product(pid, name, price, reviews, rating=4.5, delivery="rocket"):
    return {
        "product_id": pid, "product_name": name,
        "product_url": f"https://www.coupang.com/vp/products/{pid}",
        "price": price, "review_count": reviews, "rating": rating, "delivery_type": delivery,
    }


def test_start_expands_to_leaf_categories(client, tree):
    """상위 카테고리 하나를 고르면 그 아래 최하위 전부를 훑는다."""
    res = client.post("/api/scan/start", json={
        "category_ids": [tree["홈인테리어"]["id"]], "pages_per_category": 2,
    }).json()
    # 최하위 3개(발매트, 주방매트, 커튼) × 2페이지
    assert res["list_targets"] == 6

    first = client.get("/api/scan/next").json()
    assert first["kind"] == "list"
    assert first["page"] == 1
    assert "listSize=120" in first["url"]
    assert "sorter=saleCountDesc" in first["url"]
    assert "/np/categories/" in first["url"]


def test_next_marks_in_progress_and_done_advances(client, tree):
    client.post("/api/scan/start", json={"category_ids": [tree["발매트"]["id"]], "pages_per_category": 3})
    t1 = client.get("/api/scan/next").json()
    assert t1["status"] == "in_progress"
    assert t1["page"] == 1

    client.post(f"/api/scan/targets/{t1['id']}/done", json={"product_count": 120})
    t2 = client.get("/api/scan/next").json()
    assert t2["page"] == 2

    status = client.get("/api/scan/status").json()
    assert status["list"] == {"total": 3, "done": 1, "failed": 0, "pending": 2}
    assert status["current_label"] == "발매트 2페이지"


def test_list_phase_then_detail_phase(client, tree):
    """1단계가 끝나면 조건 통과 상품의 상세 페이지가 2단계로 이어진다."""
    leaf = tree["발매트"]
    client.post("/api/scan/start", json={
        "category_ids": [leaf["id"]], "pages_per_category": 1,
        "conditions": {"price_min": 9000, "price_max": 100000, "rating_min": 4.0},
        "detail_limit": 10,
    })
    t = client.get("/api/scan/next").json()

    # 목록 수집 (확장이 하는 일)
    client.post("/api/products/collect", json={
        "category_code": "1011", "category_name": "발매트",
        "products": [
            product("A1", "통과 상품 리뷰 많음", 15000, 300),
            product("A2", "통과 상품 리뷰 적음", 12000, 20),
            product("A3", "가격 탈락", 250000, 500),
            product("A4", "평점 탈락", 15000, 100, rating=3.2),
        ],
    })
    client.post(f"/api/scan/targets/{t['id']}/done", json={"product_count": 4})

    # 다음 대상은 2단계(상세)여야 하고, 리뷰 많은 순
    d1 = client.get("/api/scan/next").json()
    assert d1["kind"] == "detail"
    assert d1["url"].endswith("/A1")
    status = client.get("/api/scan/status").json()
    assert status["phase"] == "detail"
    assert status["detail"]["total"] == 2  # A1, A2만

    client.post(f"/api/scan/targets/{d1['id']}/done", json={"product_count": 1})
    d2 = client.get("/api/scan/next").json()
    assert d2["url"].endswith("/A2")
    client.post(f"/api/scan/targets/{d2['id']}/done", json={"product_count": 1})

    assert client.get("/api/scan/next").json() is None
    assert client.get("/api/scan/status").json()["status"] == "completed"


def test_detail_skips_products_already_checked(client, tree):
    """이미 구매 문구를 확보한 상품은 상세를 다시 보지 않는다."""
    leaf = tree["발매트"]
    client.post("/api/scan/start", json={"category_ids": [leaf["id"]], "detail_limit": 10})
    t = client.get("/api/scan/next").json()
    checked = product("B1", "이미 확인", 15000, 100)
    checked.update({"monthly_purchase_count": 3000, "monthly_purchase_is_minimum": True,
                    "monthly_purchase_unit": "명", "monthly_purchase_text": "한 달간 3,000명 이상 구매"})
    client.post("/api/products/collect", json={
        "category_code": "1011", "category_name": "발매트",
        "products": [checked, product("B2", "미확인", 15000, 50)],
    })
    client.post(f"/api/scan/targets/{t['id']}/done", json={"product_count": 2})
    d = client.get("/api/scan/next").json()
    assert d["url"].endswith("/B2")
    assert client.get("/api/scan/status").json()["detail"]["total"] == 1


def test_pause_resume_stop(client, tree):
    client.post("/api/scan/start", json={"category_ids": [tree["발매트"]["id"]], "pages_per_category": 2})
    client.get("/api/scan/next")

    client.post("/api/scan/pause")
    assert client.get("/api/scan/next").json() is None  # 일시정지 중엔 안 내준다
    assert client.get("/api/scan/status").json()["status"] == "paused"

    client.post("/api/scan/resume")
    assert client.get("/api/scan/status").json()["status"] == "running"

    client.post("/api/scan/stop")
    s = client.get("/api/scan/status").json()
    assert s["status"] == "stopped"
    assert s["list"]["pending"] == 0
    assert client.get("/api/scan/next").json() is None


def test_failed_target_is_recorded(client, tree):
    client.post("/api/scan/start", json={"category_ids": [tree["발매트"]["id"]]})
    t = client.get("/api/scan/next").json()
    client.post(f"/api/scan/targets/{t['id']}/done", json={"error": "페이지 로드 실패"})
    s = client.get("/api/scan/status").json()
    assert s["list"]["failed"] == 1


def test_start_requires_category(client):
    assert client.post("/api/scan/start", json={"category_ids": []}).status_code == 400


def test_new_start_stops_previous(client, tree):
    r1 = client.post("/api/scan/start", json={"category_ids": [tree["발매트"]["id"]]}).json()
    r2 = client.post("/api/scan/start", json={"category_ids": [tree["주방매트"]["id"]]}).json()
    assert r2["job_id"] != r1["job_id"]
    assert client.get("/api/scan/status").json()["job_id"] == r2["job_id"]
