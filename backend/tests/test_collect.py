from __future__ import annotations

from tests.conftest import SAMPLE_CATEGORIES


def product(pid: str, **kwargs):
    base = {
        "product_id": pid,
        "product_name": f"테스트 상품 {pid}",
        "product_url": f"https://www.coupang.com/vp/products/{pid}",
        "price": 13900,
        "review_count": 82,
        "rating": 4.7,
        "delivery_type": "rocket_growth",
        "thumbnail_url": "https://img.test/thumb.jpg",
        "rank": 1,
    }
    base.update(kwargs)
    return base


def test_collect_inserts_and_calculates_estimated_sales(client):
    client.post("/api/categories/import", json={"rows": SAMPLE_CATEGORIES})
    res = client.post(
        "/api/products/collect",
        json={
            "source_url": "https://www.coupang.com/np/categories/C-211",
            "page_type": "category",
            "category_code": "C-211",
            "category_name": "채칼/슬라이서",
            "products": [product("1001"), product("1002", review_count=50)],
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["received"] == 2
    assert body["inserted"] == 2
    assert body["updated"] == 0
    assert body["duplicates"] == 0
    assert body["saved"] == 2

    items = client.get("/api/products").json()["items"]
    by_id = {p["product_id"]: p for p in items}
    # 리뷰 82 × 배수 20 = 1640
    assert by_id["1001"]["estimated_sales"] == 1640
    # 리뷰 50 × 20 = 1000
    assert by_id["1002"]["estimated_sales"] == 1000
    assert by_id["1001"]["category_name"] == "채칼/슬라이서"
    # 조회수 원천이 없으므로 항상 null
    assert by_id["1001"]["view_count"] is None


def test_duplicate_within_payload_counted(client):
    res = client.post(
        "/api/products/collect",
        json={"products": [product("2001"), product("2001"), product("2002")]},
    ).json()
    assert res["received"] == 3
    assert res["inserted"] == 2
    assert res["duplicates"] == 1
    assert res["saved"] == 2


def test_recollect_updates_instead_of_duplicating(client):
    client.post("/api/products/collect", json={"products": [product("3001", review_count=10)]})
    first = client.get("/api/products").json()["items"][0]

    second_res = client.post(
        "/api/products/collect",
        json={"products": [product("3001", review_count=25, price=15000)]},
    ).json()
    assert second_res["inserted"] == 0
    assert second_res["updated"] == 1

    items = client.get("/api/products").json()
    assert items["total"] == 1  # product_id 기준 1건만 유지
    updated = items["items"][0]
    assert updated["review_count"] == 25
    assert updated["estimated_sales"] == 500
    assert updated["price"] == 15000
    assert updated["first_collected_at"] == first["first_collected_at"]
    assert updated["last_collected_at"] >= first["last_collected_at"]


def test_missing_required_fields_are_skipped_not_invented(client):
    res = client.post(
        "/api/products/collect",
        json={
            "products": [
                {"product_id": "", "product_name": "이름만 있음", "product_url": "https://x"},
                {"product_id": "4001", "product_name": "  ", "product_url": "https://x"},
                product("4002"),
            ]
        },
    ).json()
    assert res["inserted"] == 1
    assert res["skipped"] == 2
    assert len(res["errors"]) == 2


def test_null_fields_stay_null(client):
    """DOM에 없던 값은 null로 저장되어야 한다."""
    client.post(
        "/api/products/collect",
        json={
            "products": [
                {
                    "product_id": "5001",
                    "product_name": "가격 없는 상품",
                    "product_url": "https://www.coupang.com/vp/products/5001",
                    "price": None,
                    "review_count": 0,
                    "rating": None,
                    "delivery_type": None,
                    "thumbnail_url": None,
                }
            ]
        },
    )
    item = client.get("/api/products").json()["items"][0]
    assert item["price"] is None
    assert item["rating"] is None
    assert item["delivery_type"] is None
    assert item["review_count"] == 0
    assert item["estimated_sales"] == 0  # 리뷰 없으면 0


def test_unknown_category_code_does_not_create_category(client):
    client.post(
        "/api/products/collect",
        json={"category_code": "NOT-IMPORTED", "products": [product("6001")]},
    )
    cats = client.get("/api/categories").json()
    assert all(c["category_code"] != "NOT-IMPORTED" for c in cats)
    assert client.get("/api/products").json()["items"][0]["category_id"] is None


def test_job_attaches_and_counts(client):
    job = client.post("/api/collection-jobs", json={"category_ids": []}).json()["job"]
    assert job["status"] == "running"

    active = client.get("/api/collection-jobs/active").json()
    assert active["id"] == job["id"]

    client.post("/api/products/collect", json={"products": [product("7001"), product("7001")]})
    jobs = client.get("/api/collection-jobs").json()
    assert jobs[0]["total_products"] == 2
    assert jobs[0]["collected_products"] == 1

    finished = client.post(f"/api/collection-jobs/{job['id']}/finish").json()
    assert finished["status"] == "completed"
    assert client.get("/api/collection-jobs/active").json() is None


def test_job_target_urls_expand_to_leaves(client):
    client.post("/api/categories/import", json={"rows": SAMPLE_CATEGORIES})
    roots = client.get("/api/categories", params={"root_only": "true"}).json()
    home = next(c for c in roots if c["category_name"] == "홈인테리어")
    res = client.post("/api/collection-jobs", json={"category_ids": [home["id"]]}).json()
    # 홈인테리어 하위의 최하위 카테고리(발매트) URL만 나와야 한다.
    assert res["target_urls"] == ["https://example.test/c/111"]


def test_collect_without_job_creates_one(client):
    """확장에서 바로 수집해도 이력이 남아야 KPI '수집 상품 수'가 맞는다."""
    assert client.get("/api/collection-jobs").json() == []
    res = client.post("/api/products/collect", json={"products": [product("8001")]}).json()
    assert res["job_id"] is not None

    jobs = client.get("/api/collection-jobs").json()
    assert len(jobs) == 1
    assert jobs[0]["total_products"] == 1

    # 두 번째 수집은 같은 job에 누적된다.
    client.post("/api/products/collect", json={"products": [product("8002")]})
    jobs = client.get("/api/collection-jobs").json()
    assert len(jobs) == 1
    assert jobs[0]["total_products"] == 2

    stats = client.get("/api/stats").json()
    assert stats["collected_products"] == 2
    assert stats["unique_products"] == 2


def test_new_job_closes_previous_running_job(client):
    first = client.post("/api/collection-jobs", json={"category_ids": []}).json()["job"]
    second = client.post("/api/collection-jobs", json={"category_ids": []}).json()["job"]

    jobs = {j["id"]: j for j in client.get("/api/collection-jobs").json()}
    assert jobs[first["id"]]["status"] == "completed"
    assert jobs[second["id"]]["status"] == "running"
    assert client.get("/api/collection-jobs/active").json()["id"] == second["id"]
