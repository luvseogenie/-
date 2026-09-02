# 쿠팡 상품 소싱 분석 프로그램 (MVP 1단계)

쿠팡 카테고리를 선택하고, **Chrome에 실제로 렌더링된** 쿠팡 페이지의 상품 정보를 수집해서,
**리뷰수 기반 예상 판매량**으로 소싱 후보 상품을 찾는 도구입니다.

> ⚠️ 이 프로그램이 계산하는 값은 **예상 판매량(estimated sales)** 입니다. 실제 판매량이 아닙니다.
> `예상 판매량 = 리뷰수 × review_sales_multiplier (기본 20, 화면에서 변경 가능)`

## 구성

| 모듈 | 스택 | 설명 |
|---|---|---|
| `backend/` | Python 3.11, FastAPI, SQLAlchemy 2.x, SQLite | API + DB + 필터/계산 |
| `frontend/` | Next.js(App Router), TypeScript, Tailwind CSS, shadcn/ui 스타일 | 다크모드 분석 대시보드 |
| `extension/` | Manifest V3, TypeScript | 현재 Chrome 페이지 DOM에서 상품 정보 추출 |

설계 문서: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## 실행 방법

### 1) 백엔드 (터미널 1)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python -m app.cli init-db                                # 테이블 생성 + 기본 설정
python -m app.cli import-categories data/categories_sample.json
python -m app.cli show-tree                              # 카테고리 트리 확인

uvicorn app.main:app --reload --port 8000                # http://localhost:8000/docs
```

### 2) 프론트엔드 (터미널 2)

```bash
cd frontend
npm install
npm run dev                                              # http://localhost:3000
```

백엔드 주소가 다르면 `frontend/.env.local` 에 `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`.

### 3) Chrome 확장 (터미널 3)

```bash
cd extension
npm install
npm run build                                            # → extension/dist
```

1. Chrome에서 `chrome://extensions` 열기
2. 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드** → `extension/dist` 폴더 선택

### 4) 사용 흐름

1. 대시보드 왼쪽에서 카테고리를 펼쳐 최하위 카테고리를 **복수 선택**
2. 상품 조건(가격 / 리뷰수 / 예상 판매량 / 평점 / 배송방식)과 판매량 배수 설정
3. **수집 시작** → 선택한 카테고리 페이지가 새 탭으로 열림 (수집 작업이 생성됨)
4. 각 탭에서 확장 아이콘 클릭 → `쿠팡 상품 N개 감지` 확인 → **현재 페이지 수집**
5. 대시보드로 돌아와 **새로고침** → KPI와 결과 테이블 확인

> 목록이 무한스크롤이라면, 원하는 만큼 스크롤해 상품이 화면에 모두 표시된 뒤 수집하세요.
> 화면에 렌더링되지 않은 상품은 수집되지 않습니다.

---

## 카테고리 데이터 등록

쿠팡 공식 카테고리 데이터를 확보하기 전까지는 JSON/CSV로 import 합니다.
포맷은 `backend/data/categories_sample.json` / `.csv` 를 참고하세요.

```
category_code, category_name, parent_category_code, depth, category_url
```

- CLI: `python -m app.cli import-categories <파일>`
- API: `POST /api/categories/import` (JSON) / `POST /api/categories/import/file` (파일 업로드)

부모가 파일 뒤쪽에 나와도 되며(2-pass), `depth`와 `is_leaf`는 import 후 자동 재계산됩니다.

> `backend/data/*` 의 `category_code` / `category_url` 은 **자리표시자**입니다.
> 실제 쿠팡 카테고리 코드와 URL로 교체해서 사용하세요.

---

## 테스트

```bash
# 백엔드 (pytest 39건)
cd backend && ./.venv/bin/python -m pytest

# 확장 파서 (vitest + jsdom, 26건)
cd extension && npm test

# 타입/린트/빌드
cd extension && npm run typecheck && npm run build
cd frontend  && npx tsc --noEmit && npm run lint && npm run build
```

---

## 쿠팡 화면이 바뀌어 상품이 감지되지 않을 때

DOM selector는 **한 파일에만** 모여 있습니다.

```
extension/src/parsers/selectors.ts
```

1. 쿠팡 페이지에서 개발자도구로 상품 카드의 실제 클래스명을 확인
2. `PRODUCT_CARD_SELECTORS` / `NAME_SELECTORS` / `PRICE_SELECTORS` 등 해당 배열 **맨 앞**에 추가
3. `npm run build` 후 `chrome://extensions` 에서 확장 새로고침

확장 popup은 어떤 selector로 카드를 찾았는지(`selector: li.search-product`) 표시하므로
어디가 실패했는지 바로 알 수 있습니다. content script 콘솔에도 제외 사유가 남습니다.

---

## 원칙

- 현재 Chrome 페이지에 **실제 노출된 데이터만** 수집합니다.
- DOM에 없는 값은 만들어내지 않습니다 (`null` 저장, UI에 `-` 표시).
- 조회수(`view_count`)는 데이터 원천이 없으므로 **항상 `NULL`** 입니다. 컬럼 구조만 준비되어 있습니다.
- 리뷰수 × 배수 값은 어디에서도 "실제 판매량"이라고 표기하지 않습니다.
- CAPTCHA / IP 차단 / 로그인 보호 / anti-bot 우회 기능은 **구현하지 않습니다.**
- 수집 실패 시 원인을 서버 로그와 브라우저 콘솔에 남깁니다.

## MVP 범위 밖 (아직 만들지 않음)

28일 실제 판매량·조회수, 전환율, 매출 추정, Opportunity Score, 중국 1688 연동,
마진 계산, 대규모 자동 크롤링, 자동 CAPTCHA 처리.
