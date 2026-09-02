# 아키텍처 설계서 — 쿠팡 상품 소싱 분석 (MVP 1단계)

## 1. 전체 구조

```
┌──────────────────┐        ┌───────────────────────┐        ┌──────────────┐
│  Chrome Extension │        │      FastAPI          │        │   Next.js     │
│  (Manifest V3)    │        │      Backend          │        │   Dashboard   │
│                   │        │                       │        │               │
│ content script    │ POST   │ /api/products/collect │  GET   │ 카테고리 트리 │
│  └ DOM 파싱       │───────▶│ /api/categories       │◀───────│ 상품 조건     │
│ background(SW)    │        │ /api/products         │        │ KPI / 테이블  │
│  └ fetch          │        │ /api/settings         │        │               │
│ popup             │        │ /api/stats            │        │               │
└──────────────────┘        └──────────┬────────────┘        └──────────────┘
                                        │ SQLAlchemy 2.x
                                   ┌────▼────┐
                                   │ SQLite  │  (→ PostgreSQL 이관 가능)
                                   └─────────┘
```

## 2. 폴더 구조

```
backend/
  app/
    main.py                 FastAPI 앱, CORS, 라우터 등록
    config.py               설정(DATABASE_URL, CORS origin 등)
    cli.py                  init-db / import-categories 커맨드
    core/logging.py         공통 로거 (수집 실패 원인 로깅)
    db/session.py           engine, SessionLocal, get_db
    db/init_db.py           create_all + settings 시드
    models/                 SQLAlchemy 모델
      base.py               DeclarativeBase + TimestampMixin
      category.py product.py setting.py collection_job.py
    schemas/                Pydantic v2 스키마
    api/routes/             categories/products/settings/stats/jobs
    api/deps.py             DB 세션 의존성, 필터 파라미터 의존성
    services/
      category_service.py   ★ 카테고리 import/tree (수집과 분리)
      product_collector.py  ★ 상품 수집/중복제거 (카테고리와 분리)
      estimation.py         예상 판매량 계산 (누적)
      monthly_reviews.py    ★ 최근 30일 리뷰수/판매량 산출
      filtering.py          조건 필터 → SQLAlchemy 조건 변환
  data/categories_sample.json
  tests/

frontend/src/
  app/page.tsx              대시보드 (좌 25% / 우 75%)
  components/               CategoryTree, ConditionPanel, KpiCards, ProductTable ...
  components/ui/            shadcn/ui 스타일 프리미티브
  lib/api.ts types.ts       API 클라이언트 / 타입

extension/src/
  parsers/selectors.ts              ★ 모든 DOM selector 집중 관리
  parsers/coupang_product_parser.ts ★ 상품 카드 파서 (순수 함수)
  parsers/coupang_review_parser.ts  ★ 리뷰 작성일 파서 (최근 30일 리뷰수)
  parsers/normalize.ts              리뷰수/가격/평점 정규화
  content/content.ts                DOM 스캔 → 메시지 응답
  background/service_worker.ts      API 통신
  popup/                            감지 결과 + 수집 버튼
  tests/                            vitest + jsdom
```

## 3. DB 스키마

### categories
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK | |
| category_code | VARCHAR UNIQUE | 쿠팡 카테고리 코드 |
| category_name | VARCHAR | |
| parent_id | INTEGER FK→categories.id NULL | 무한 depth 트리 |
| depth | INTEGER | 1차=1 |
| category_url | TEXT NULL | |
| is_leaf | BOOLEAN | import 후 자동 재계산 |

### products
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK | |
| product_id | VARCHAR UNIQUE | **중복 제거 기준** |
| product_name | VARCHAR | |
| product_url | TEXT | |
| price | INTEGER NULL | 원 단위 |
| review_count | INTEGER DEFAULT 0 | |
| estimated_sales | INTEGER | review_count × multiplier (저장값) |
| rating | FLOAT NULL | |
| delivery_type | VARCHAR NULL | rocket / rocket_growth / seller / unknown |
| thumbnail_url | TEXT NULL | |
| view_count | INTEGER NULL | **원천 없음 → 항상 NULL** |
| category_id | INTEGER FK NULL | |
| rank | INTEGER NULL | 마지막 수집 시 노출 순위(부가) |
| first_collected_at / last_collected_at | DATETIME | |
| monthly_purchase_count | INTEGER NULL | **쿠팡이 표시한 한 달 구매자 수** (실제 데이터, 1순위) |
| monthly_purchase_is_minimum | BOOLEAN NULL | "이상" 구간값인지 |
| monthly_purchase_unit | VARCHAR NULL | 명 / 개 |
| monthly_purchase_text | VARCHAR NULL | 원문 문구 |
| monthly_purchase_collected_at | DATETIME NULL | |
| monthly_review_count | INTEGER NULL | **최근 30일 리뷰수** — 유도값, 못 구하면 NULL |
| monthly_estimated_sales | INTEGER NULL | 최근 30일 리뷰수 × 배수 |
| monthly_review_method | VARCHAR NULL | `review_dates` / `snapshot_delta` |
| monthly_review_window_days | FLOAT NULL | 실제 관측 구간(일) |
| monthly_review_is_extrapolated | BOOLEAN | 30일을 못 덮어 환산했는지 |
| monthly_review_measured_at | DATETIME NULL | |

### review_snapshots
수집할 때마다 (상품, 누적 리뷰수, 시각)을 한 줄 남긴다.
두 시점의 차이가 그 구간에 실제로 늘어난 리뷰수다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK | |
| product_id | INTEGER FK→products.id | |
| review_count | INTEGER | 그 시점의 **누적** 리뷰수 |
| captured_at | DATETIME | |
| source | VARCHAR NULL | list / search / detail |

### settings (싱글턴 id=1)
| 컬럼 | 타입 |
|---|---|
| id | INTEGER PK (=1) |
| review_sales_multiplier | INTEGER DEFAULT 20 |

### collection_jobs
| 컬럼 | 타입 |
|---|---|
| id / status / started_at / finished_at / total_products / collected_products |

`condition_passed`는 **컬럼이 아니다.** 조건이 바뀌면 결과도 바뀌어야 하므로 조회 시점에 계산한다.

### PostgreSQL 이관 대비
- SQLite 전용 타입 미사용, `DateTime(timezone=True)`, `server_default=func.now()`
- 모든 FK/UNIQUE를 모델에 명시 → `DATABASE_URL` 교체 + Alembic 도입만으로 이관

## 4. API

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/categories` | `?tree=true` 전체 트리 / `?parent_id=` / `?leaf_only=` |
| GET | `/api/categories/{id}/children` | 지연 로딩용 |
| POST | `/api/categories/import` | JSON/CSV import |
| POST | `/api/products/collect` | 확장 프로그램 → 상품 수집 (리뷰수 스냅샷 자동 기록) |
| POST | `/api/products/review-dates` | 확장 → 리뷰 작성일 분석 결과 (최근 30일 리뷰수 산출) |
| GET | `/api/products` | 필터 + 정렬 + 페이징, `?condition_passed=true` |
| GET | `/api/settings` / PUT | review_sales_multiplier |
| GET | `/api/stats` | KPI 4종 |
| POST | `/api/collection-jobs` | 「수집 시작」 job 생성 |
| GET | `/api/collection-jobs/active` | 확장이 현재 job에 자동 연결 |
| POST | `/api/collection-jobs/{id}/finish` | job 종료 |

## 5. Chrome → FastAPI 통신 흐름

```
popup [현재 페이지 수집]
  └▶ background(service worker)
       ├▶ chrome.tabs.sendMessage(tabId, {type:'SCAN'})
       │    └▶ content script: parseProductList(document) → products[]
       ├▶ GET  /api/collection-jobs/active      (job_id 자동 연결)
       └▶ POST /api/products/collect
            └◀ {received, inserted, updated, duplicates, skipped, errors}
                 → popup "36개 중 35개 저장 / 중복 1개"
```

## 5-1. 판매량 지표 — 2단 구조

```
1순위  monthly_purchase_count   쿠팡이 표시한 "한 달간 3,000명 이상 구매했어요"
       └ 실제 판매 데이터. 소싱 조건의 기본 근거.
       └ ★ 상품 상세 페이지에만 있다. 목록/검색 페이지에는 없다.
         → 2단계 워크플로 필요:
           1단계 카테고리 수집 + 1차 필터(가격/리뷰/평점/배송)로 후보 축소
           2단계 후보 상세 페이지 방문 → 문구 확인
           지원 장치: 확장의 자동 수집 옵션(연 페이지만 읽음),
                     대시보드의 has_purchase=false 목록 + 상위 N개 열기
       └ 주의: "명"=구매자 수(수량은 그 이상), "이상"=구간값 → 둘 다 과소 추정 방향

2순위  monthly_estimated_sales  리뷰 기반 추정 (문구가 없는 상품용)
       └ 최근 30일 리뷰수 × 배수. 아래 두 방법으로 유도.
```

파서: `extension/src/parsers/coupang_purchase_parser.ts`
문구 자체를 앵커로 삼아 클래스명 변경에 영향받지 않는다.

## 5-2. 최근 30일 리뷰수를 구하는 방법

쿠팡은 최근 1달 리뷰수를 표시하지 않는다. 카드/상세의 리뷰수는 모두 **누적값**이다.
따라서 두 가지 방법으로 유도한다.

```
① review_dates  (즉시 / 상품 1건씩)
   상품 상세 페이지 → 리뷰 최신순 정렬 → 렌더된 리뷰의 작성일을 읽음
   ├ 표본에 30일보다 오래된 리뷰가 있다  → 30일 이내 개수 = 실측값
   └ 표본이 전부 30일 안에 있다          → 리뷰 속도(표본÷기간)×30 = 환산값(추정)

   ※ 쿠팡 리뷰 목록은 페이지네이션이라 다음 페이지로 넘기면 이전 리뷰가 DOM에서
     사라진다(페이지당 5건 내외). 한 페이지만으로는 30일을 덮을 수 없으므로,
     content script가 MutationObserver로 리뷰 목록 변화를 감지해
     사용자가 넘겨 본 페이지의 리뷰를 key 기준으로 누적·중복제거한다.
     key = data-review-id 가 있으면 그것, 없으면 (작성일 + 본문 앞 80자).
     자동으로 페이지를 요청하지는 않는다.

② snapshot_delta (누적 / 카테고리 전체)
   수집할 때마다 누적 리뷰수를 review_snapshots 에 기록
   ├ 30일 이전 스냅샷이 있다  → (최신 − 그 시점) 을 30일로 정규화 = 실측값
   └ 구간이 30일 미만          → 30일로 환산 = 추정값 (1일 미만이면 계산 안 함)
```

채택 규칙: `(환산 아님, 관측 구간 길이)` 가 큰 쪽을 남긴다.
어느 쪽도 못 구하면 NULL. **임의 값을 만들지 않는다.**

구현 위치
- 백엔드: `app/services/monthly_reviews.py`
- 확장: `src/parsers/coupang_review_parser.ts` (selector는 `selectors.ts`에)

자동 페이지네이션 크롤링은 하지 않는다. 사용자가 화면에 띄운 리뷰만 읽는다.

## 6. 파서 설계 원칙

1. selector는 `selectors.ts` 한 파일에만 존재한다. 다른 파일에 CSS selector 문자열을 쓰지 않는다.
2. 모든 필드는 **fallback selector 배열**을 갖는다. 순차로 시도해 첫 성공값을 쓴다.
3. 필수값(`product_id`, `product_name`, `product_url`)이 없으면 그 카드는 `skipped`로 처리하고 사유를 로그에 남긴다.
4. 선택값이 없으면 `null`. **임의 생성 금지.**
5. `review_count`만 예외적으로 없으면 `0`.
6. 파서는 DOM element를 받아 객체를 돌려주는 **순수 함수** → jsdom으로 단위 테스트한다.

## 7. 하지 않는 것 (MVP 범위 밖)

실제 판매량/조회수, 전환율, 매출 추정, Opportunity Score, 1688 연동, 마진 계산,
대규모 자동 크롤링, CAPTCHA/anti-bot 우회.
