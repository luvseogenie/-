"""공통 유틸: 헤더 정규화, 숫자/퍼센트 파싱, 날짜 처리."""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Any, Iterable, Optional

_WS = re.compile(r"[\s_\-()/\[\]:·※*]+")


def norm_header(text: Any) -> str:
    """헤더 비교용 정규화: 공백/특수문자 제거, 소문자화."""
    if text is None:
        return ""
    s = str(text).replace("\n", "")
    s = _WS.sub("", s)
    return s.lower()


def parse_number(value: Any) -> Optional[float]:
    """'1,234', '₩1,234', '12.3%', 1234 등을 float 로. 비어 있으면 None.

    퍼센트 문자열은 분수로 바꾼다 ('7.8%' -> 0.078).
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if s in ("", "-", "—", "–", "N/A", "nan", "None"):
        return None
    is_pct = s.endswith("%")
    s = s.replace("%", "").replace(",", "").replace("₩", "").replace("원", "").strip()
    try:
        num = float(s)
    except ValueError:
        return None
    return num / 100.0 if is_pct else num


def parse_percent(value: Any, percent_units: bool = False) -> Optional[float]:
    """퍼센트 필드 전용. 결과는 분수(0.078).

    - '7.8%' 처럼 % 가 붙으면 항상 /100.
    - percent_units=True 면 숫자도 % 단위로 보고 항상 /100 (웹 화면 입력용: 0.15 → 0.0015).
    - 그 외 숫자는 1 초과일 때만 % 단위로 간주 (7.8 → 0.078, 0.078 → 0.078).
    """
    if isinstance(value, str) and value.strip().endswith("%"):
        return parse_number(value)
    num = parse_number(value)
    if num is None:
        return None
    if percent_units:
        return num / 100.0
    return num / 100.0 if num > 1.0 else num


def parse_ratio(value: Any, percent_units: bool = False) -> Optional[float]:
    """목표효율/광고수익률 처럼 '400%' 또는 4 로 표기되는 값. 배수(4.0)로 통일.

    percent_units=True 면 숫자도 % 단위로 본다 (웹 화면 입력용: 400 → 4.0).
    """
    if isinstance(value, str) and value.strip().endswith("%"):
        return parse_number(value)  # '400%' -> 4.0
    num = parse_number(value)
    if num is not None and percent_units:
        return num / 100.0
    return num


def parse_date(value: Any) -> Optional[dt.date]:
    if value is None or value == "":
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y.%m.%d", "%Y/%m/%d", "%Y%m%d", "%m-%d-%y", "%y-%m-%d"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    m = re.search(r"(20\d{2})[.\-/]?(\d{2})[.\-/]?(\d{2})", s)
    if m:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def date_from_filename(path: Path) -> Optional[dt.date]:
    return parse_date(path.stem)


def yesterday(today: Optional[dt.date] = None) -> dt.date:
    return (today or dt.date.today()) - dt.timedelta(days=1)


def first_match(headers: Iterable[str], aliases: Iterable[str]) -> Optional[int]:
    """정규화된 헤더 목록에서 별칭 중 하나와 같은(또는 포함하는) 첫 인덱스."""
    hs = list(headers)
    al = [norm_header(a) for a in aliases]
    for i, h in enumerate(hs):
        if h in al:
            return i
    for i, h in enumerate(hs):
        if any(a and a in h for a in al):
            return i
    return None
