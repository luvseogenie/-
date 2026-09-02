"""config/mapping.csv (원본 시트1) 를 DB 의 options / margin_history 로 가져온다.

CSV 열: 상품명, 옵션ID, 광고캠페인, 옵션마진, (선택) 적용시작일
- 적용시작일이 비어 있으면 '처음부터' 적용되는 초기 마진이다.
- 같은 옵션ID 를 여러 줄 적고 적용시작일을 다르게 하면 마진 이력이 된다.
"""
from __future__ import annotations

import csv
from pathlib import Path
from typing import Optional

from .common import norm_header, parse_date, parse_number
from .store import Store

DEFAULT_MAPPING = Path("config/mapping.csv")


def import_mapping_csv(store: Store, path: Path = DEFAULT_MAPPING) -> int:
    if not path.exists():
        raise FileNotFoundError(f"매핑 파일이 없습니다: {path}")
    n = 0
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [norm_header(h) for h in next(reader)]
        i_name = _col(header, ["상품명", "상품", "옵션명"])
        i_opt = _col(header, ["옵션id", "옵션아이디", "vendoritemid"])
        i_camp = _col(header, ["광고캠페인", "캠페인", "캠페인명", "캠페인이름"])
        i_margin = _col(header, ["옵션마진", "마진"])
        i_eff = _col(header, ["적용시작일", "적용일", "시작일", "effectivefrom"], required=False)
        existing = {o.option_id for o in store.options()}
        for raw in reader:
            if not raw or not any(c.strip() for c in raw):
                continue
            option_id = raw[i_opt].strip()
            if not option_id:
                continue
            eff = parse_date(raw[i_eff]) if i_eff is not None and i_eff < len(raw) else None
            if option_id not in existing or eff is None:
                store.upsert_option(option_id, raw[i_name], raw[i_camp])
                existing.add(option_id)
            margin = parse_number(raw[i_margin])
            if margin is not None:
                store.set_margin(option_id, margin, eff)
            n += 1
    return n


def export_mapping_csv(store: Store, path: Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    hist = {}
    for e in store.margin_history():
        hist.setdefault(e.option_id, []).append(e)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["상품명", "옵션ID", "광고캠페인", "옵션마진", "적용시작일"])
        for o in store.options():
            entries = hist.get(o.option_id) or [None]
            for e in entries:
                eff = "" if e is None or e.effective_from.year == 1 else e.effective_from.isoformat()
                w.writerow([o.product_name, o.option_id, o.campaign, "" if e is None else e.margin, eff])
    return path


def _col(header, aliases, required=True) -> Optional[int]:
    al = [norm_header(a) for a in aliases]
    for i, h in enumerate(header):
        if h in al:
            return i
    if required:
        raise ValueError(f"mapping.csv 에 필요한 열이 없습니다: {aliases[0]} (헤더: {header})")
    return None
