"""엑셀(CSV) 내보내기."""

from __future__ import annotations

import csv
import io


def product(pid, name, price, reviews, purchase=None):
    base = {
        "product_id": pid, "product_name": name,
        "product_url": f"https://www.coupang.com/vp/products/{pid}",
        "price": price, "review_count": reviews, "rating": 4.5, "delivery_type": "rocket_growth",
    }
    if purchase:
        base.update({"monthly_purchase_count": purchase, "monthly_purchase_is_minimum": True,
                     "monthly_purchase_unit": "명", "monthly_purchase_text": f"한 달간 {purchase:,}명 이상 구매"})
    return base


def test_export_passed_products_as_excel_csv(client):
    client.post("/api/products/collect", json={"products": [
        product("E1", "통과 상품", 13900, 82, purchase=3000),
        product("E2", "미달 상품", 13900, 82, purchase=100),
        product("E3", "미확인 상품", 13900, 82),
    ]})
    res = client.get("/api/products/export", params={"purchase_min": 1000})
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert res.headers["content-disposition"].startswith("attachment")

    raw = res.content
    assert raw.startswith("﻿".encode("utf-8"))  # 엑셀 한글 깨짐 방지 BOM
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    assert rows[0][:3] == ["판정", "상품명", "카테고리"]
    assert len(rows) == 2  # 헤더 + 통과 1건
    assert rows[1][0] == "조건 통과"
    assert rows[1][1] == "통과 상품"
    assert rows[1][6] == "3,000+명"


def test_export_all_when_condition_passed_false(client):
    client.post("/api/products/collect", json={"products": [
        product("F1", "A", 10000, 10, purchase=3000), product("F2", "B", 10000, 10),
    ]})
    res = client.get("/api/products/export", params={"purchase_min": 1000, "condition_passed": "false"})
    rows = list(csv.reader(io.StringIO(res.content.decode("utf-8-sig"))))
    assert len(rows) == 3
    verdicts = {r[1]: r[0] for r in rows[1:]}
    assert verdicts == {"A": "조건 통과", "B": "미달"}


def test_diagnostics_report_has_version_counts_and_logs(client):
    """[문제 보고서 복사]가 가져가는 진단 정보: 버전·건수·최근 스캔·최근 로그."""
    client.post("/api/products/collect", json={"source_url": "https://www.coupang.com/np/categories/1", "page_type": "category", "products": [
        {"product_id": "", "product_name": "id 없음", "product_url": "https://www.coupang.com/vp/products/1", "price": 1000, "review_count": 1}], "skipped": 0})
    d = client.get("/api/diagnostics").json()
    assert d["version"] and "counts" in d
    assert d["counts"]["products"] == 0
    assert any("상품 저장 건너뜀" in line for line in d["log"])
