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
      estimation.py         예상 판매량 계산
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
  parsers/coupang_product_parser.ts ★ fallback 파서 (순수 함수)
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
| POST | `/api/products/collect` | 확장 프로그램 → 상품 수집 |
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

## 6. 파서 설계 원칙

1. selector는 `selectors.ts` 한 파일에만 존재한다. 다른 파일에 CSS selector 문자열을 쓰지 않는다.
2. 모든 필드는 **fallback selector 배열**을 갖는다. 순차로 시도해 첫 성공값을 쓴다.
3. 필수값(`product_id`, `product_name`, `product_url`)이 없으면 그 카드는 `skipped`로 처리하고 사유를 로그에 남긴다.
4. 선택값이 없으면 `null`. **임의 생성 금지.**
5. `review_count`만 예외적으로 없으면 `0`.
6. 파서는 DOM element를 받아 객체를 돌려주는 **순수 함수** → jsdom으로 단위 테스트한다.

## 7. 하지 않는 것 (MVP 범위 밖)

28일 실제 판매량/조회수, 전환율, 매출 추정, Opportunity Score, 1688 연동, 마진 계산,
대규모 자동 크롤링, CAPTCHA/anti-bot 우회.
