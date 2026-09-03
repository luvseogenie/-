"""전역 설정. 경로와 기본값만 모아둔다."""
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("CS_DATA_DIR", BASE_DIR / "data"))
PROFILE_DIR = DATA_DIR / "browser-profile"     # 로그인 상태가 저장되는 크롬 프로필
LOG_DIR = DATA_DIR / "logs"
CAPTURE_DIR = DATA_DIR / "wing-capture"          # 윙 캡처 모드 결과
DEBUG_DIR = DATA_DIR / "debug"                   # 수집 실패 시 화면/HTML 저장
EXPORT_DIR = DATA_DIR / "exports"
DB_PATH = DATA_DIR / "sourcing.db"
WING_CONFIG_PATH = DATA_DIR / "wing_config.json"

for _d in (DATA_DIR, PROFILE_DIR, LOG_DIR, CAPTURE_DIR, DEBUG_DIR, EXPORT_DIR):
    _d.mkdir(parents=True, exist_ok=True)

HOST = os.environ.get("CS_HOST", "127.0.0.1")
PORT = int(os.environ.get("CS_PORT", "8765"))

COUPANG_HOME = "https://www.coupang.com/"
CATEGORY_PAGE = "https://www.coupang.com/np/categories/{cid}"
CATEGORY_URL = "https://www.coupang.com/np/categories/{cid}?listSize={size}&sorter=saleCountDesc&page={page}"
SEARCH_URL = "https://www.coupang.com/np/search?q={q}&listSize=72&sorter=saleCountDesc&page={page}"
PRODUCT_URL = "https://www.coupang.com/vp/products/{pid}"
WING_HOME = "https://wing.coupang.com/"

CATEGORY_LIST_SIZE = 120     # 카테고리 페이지 한 번에 120개
SEARCH_LIST_SIZE = 72        # 검색 페이지는 최대 72개

# 요청 사이 대기 시간(초). 차단을 피하기 위해 무작위로 섞는다.
DELAY_MIN = 1.2
DELAY_MAX = 3.0
BLOCK_COOLDOWN = 90          # 차단 감지 시 쉬는 시간(초)

DEFAULT_CONDITIONS = {
    "price_min": 9000,
    "price_max": 100000,
    "review_min": 0,
    "review_max": 250,
    "views_min": 10000,
    "views_max": 0,
    "conv_min": 0,
    "buyers_min": 0,
    "sales28_min": 0,             # 윙 카탈로그 매칭의 28일 판매 (데이터가 있는 상품에만 적용)
    "only_mergeable": False,
    "fetch_rank": False,          # 판매 순위도 조회 (인기상품검색 화면 이용, 느림)
    "pages": 1,
    "exclude_restricted": True,   # 못 파는 물건(전기용품·화장품·어린이제품) 빼기
    "hide_ads": False,
    "auto_continue": True,        # 손 놓으면 자동
}

# 1차 카테고리 (쿠팡 대분류). 번호는 2026-09 홈 메뉴에서 확인한 값.
TOP_CATEGORIES = [
    (564653, "패션의류/잡화"),
    (176522, "뷰티"),
    (221934, "출산/유아동"),
    (194276, "식품"),
    (185669, "주방용품"),
    (115673, "생활용품"),
    (184555, "홈인테리어"),
    (178255, "가전디지털"),
    (317778, "스포츠/레저"),
    (184060, "자동차용품"),
    (317777, "도서/음반/DVD"),
    (317779, "완구/취미"),
    (177295, "문구/오피스"),
    (115674, "반려동물용품"),
    (305798, "헬스/건강식품"),
]

# 못 파는 물건 판별용 키워드 (카테고리 경로 또는 상품명에 포함되면 표시)
RESTRICTED_RULES = {
    "전기용품": ["전기", "가전", "충전기", "어댑터", "전열", "히터", "온풍기", "전기매트", "전기장판",
                "선풍기", "에어컨", "냉장고", "밥솥", "전자레인지", "드라이기", "고데기", "전동", "배터리",
                "LED", "조명", "스탠드", "블루투스", "이어폰", "스피커", "케이블", "멀티탭"],
    "화장품": ["화장품", "스킨케어", "메이크업", "향수", "크림", "로션", "세럼", "에센스", "토너", "선크림",
              "립스틱", "마스카라", "샴푸", "린스", "바디워시", "클렌징", "팩", "네일"],
    "어린이제품": ["어린이", "유아", "아동", "키즈", "완구", "장난감", "신생아", "베이비", "유모차", "카시트",
                "젖병", "기저귀", "물티슈"],
}
