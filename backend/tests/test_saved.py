"""보관함 + 검색 단위 결과 범위."""

from __future__ import annotations


def _collect(client, pid, name, price=10000, reviews=50, code="1011"):
    return client.post("/api/products/collect", json={
        "source_url": f"https://www.coupang.com/np/categories/{code}", "page_type": "category",
        "category_code": code, "category_name": "발매트",
        "products": [{"product_id": pid, "product_name": name, "product_url": f"https://www.coupang.com/vp/products/{pid}",
                      "price": price, "review_count": reviews, "rating": 4.5, "delivery_type": "rocket"}], "skipped": 0})


def _measure(client, pid, n):
    client.post("/api/products/review-dates", json={
        "product_id": pid, "product_url": f"https://www.coupang.com/vp/products/{pid}",
        "reviews_in_window": n, "sample_size": n + 3, "sample_span_days": 40, "covers_window": True,
        "newest_review_date": "2026-09-01", "oldest_review_date": "2026-07-23", "total_review_count": 60,
    })


def test_scan_scope_shows_only_latest_search(client):
    """[소싱 시작]마다 검색 번호가 찍히고, scan=latest 는 마지막 검색 상품만 보여준다."""
    client.post("/api/categories/import", json={"rows": [{"category_code": "1011", "category_name": "발매트"}]})
    cat = client.get("/api/categories").json()[0]
    # 첫 검색
    client.post("/api/scan/start", json={"category_ids": [cat["id"]], "pages_per_category": 1})
    t = client.get("/api/scan/next").json()
    _collect(client, "A", "첫 검색 상품")
    client.post(f"/api/scan/targets/{t['id']}/done", json={"product_count": 1})
    while client.get("/api/scan/next").json():
        pass
    # 두 번째 검색
    client.post("/api/scan/start", json={"category_ids": [cat["id"]], "pages_per_category": 1})
    t2 = client.get("/api/scan/next").json()
    _collect(client, "B", "둘째 검색 상품")
    client.post(f"/api/scan/targets/{t2['id']}/done", json={"product_count": 1})

    assert client.get("/api/products").json()["total"] == 2
    latest = client.get("/api/products?scan=latest").json()
    assert [p["product_name"] for p in latest["items"]] == ["둘째 검색 상품"]
    assert client.get("/api/stats?scan=latest").json()["unique_products"] == 1
    # 수동 수집(스캔 없음)은 번호가 없어 전체에서만 보인다
    assert latest["items"][0]["last_scan_job_id"] is not None


def test_scan_scope_without_any_job_shows_everything(client):
    _collect(client, "A", "수동 수집")
    assert client.get("/api/products?scan=latest").json()["total"] == 1


def test_saved_snapshot_memo_remove_export(client):
    _collect(client, "A", "보관할 상품", price=20000)
    _measure(client, "A", 30)  # 30일 리뷰 30 → 예상판매 600 → 매출 12,000,000
    pid = client.get("/api/products").json()["items"][0]["id"]

    res = client.post("/api/saved", json={"product_ids": [pid, pid, 9999]}).json()
    assert res == {"added": 1, "skipped": 2, "total": 1}
    assert client.get("/api/products").json()["items"][0]["saved"] is True

    rows = client.get("/api/saved").json()
    assert len(rows) == 1
    row = rows[0]
    assert row["monthly_review_count"] == 30 and row["monthly_estimated_sales"] == 600
    assert row["monthly_revenue"] == 12_000_000 and row["price"] == 20000
    assert row["product"]["product_name"] == "보관할 상품" and row["product"]["saved"] is True

    # 이후 값이 바뀌어도 저장 당시 스냅샷은 유지된다
    _measure(client, "A", 5)
    row = client.get("/api/saved").json()[0]
    assert row["monthly_review_count"] == 30
    assert row["product"]["monthly_review_count"] == 5

    memo = client.patch(f"/api/saved/{row['id']}", json={"memo": "  1688 검색해 보기  "}).json()
    assert memo["memo"] == "1688 검색해 보기"

    csv_text = client.get("/api/saved/export").content.decode("utf-8")
    lines = csv_text.strip().split("\n")
    assert lines[0].startswith("\ufeff저장일,메모,상품명")
    assert len(lines) == 2 and "1688 검색해 보기" in lines[1] and "12000000" in lines[1]

    assert client.delete(f"/api/saved/by-product/{pid}").status_code == 200
    assert client.get("/api/saved").json() == []
    assert client.get("/api/products").json()["items"][0]["saved"] is False
    assert client.delete(f"/api/saved/{row['id']}").status_code == 404
