# 쿠팡 상품 소싱 분석 프로그램 (MVP 1단계)

쿠팡 카테고리를 선택하고, Chrome에 실제로 렌더링된 쿠팡 페이지의 상품 정보를 수집해서,
**리뷰수 기반 예상 판매량**으로 소싱 후보 상품을 찾는 도구입니다.

> ⚠️ 이 프로그램이 계산하는 값은 **예상 판매량(estimated sales)** 입니다. 실제 판매량이 아닙니다.
> 계산식: `예상 판매량 = 리뷰수 × review_sales_multiplier (기본 20)`

## 구성

| 모듈 | 스택 | 설명 |
|---|---|---|
| `backend/` | Python 3.11, FastAPI, SQLAlchemy 2.x, SQLite | API + DB + 필터/계산 |
| `frontend/` | Next.js(App Router), TypeScript, Tailwind CSS, shadcn/ui 스타일 | 다크모드 분석 대시보드 |
| `extension/` | Manifest V3, TypeScript | 현재 Chrome 페이지 DOM에서 상품 정보 추출 |

설계 문서: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## 빠른 시작

```bash
# 1) 백엔드
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.cli init-db                       # 테이블 생성
python -m app.cli import-categories data/categories_sample.json
uvicorn app.main:app --reload --port 8000       # http://localhost:8000/docs

# 2) 프론트엔드
cd frontend
npm install
npm run dev                                     # http://localhost:3000

# 3) 크롬 확장
cd extension
npm install && npm run build
# chrome://extensions → 개발자 모드 → "압축해제된 확장 프로그램을 로드" → extension/dist 선택
```

## 원칙

- 현재 Chrome 페이지에 **실제 노출된 데이터만** 수집합니다.
- DOM에 없는 값은 만들어내지 않습니다 (`null` 저장, UI에 `-` 표시).
- 조회수(`view_count`)는 데이터 원천이 없으므로 항상 `NULL` 입니다.
- CAPTCHA / IP 차단 / 로그인 보호 / anti-bot 우회 기능은 **구현하지 않습니다.**
