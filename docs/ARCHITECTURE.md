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
  parsers/coupang_next_data.ts      ★ Next.js 페이지 데이터 파서 (상품 추출 1순위)
  parsers/coupang_product_parser.ts ★ 상품 카드 DOM 파서 (2순위 fallback)
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

### saved_products — 보관함
| 컬럼 | 설명 |
|---|---|
| product_id FK(UNIQUE) / saved_at / memo / scan_job_id / category_name | 무엇을 언제 어느 검색에서 골랐는지 |
| price / review_count / monthly_review_count / monthly_estimated_sales / monthly_revenue / monthly_purchase_count / monthly_purchase_text | **저장 시점 스냅샷** — 이후 재측정돼도 유지 |

`products.last_scan_job_id` — 마지막으로 이 상품을 훑은 자동 스캔 번호. `?scan=latest` 가 "이번 검색만" 범위다.
기존 DB 에는 `init_db._add_missing_columns()` 가 컬럼을 추가한다.

### scan_jobs — 자동 스캔 작업
| 컬럼 | 설명 |
|---|---|
| status | running / paused / completed / stopped |
| phase | list(1단계 목록) / detail(2단계 상세) |
| category_ids (JSON) / pages_per_category / sorter=`saleCountDesc` / list_size=120 | 목록 대상 생성 조건 |
| conditions (JSON) / detail_limit / detail_prepared | 상세 대상 선정 조건 (1차 조건 통과 & 구매 문구 없음 & 리뷰 많은 순) |

### scan_targets — 방문할 페이지 큐
| 컬럼 | 설명 |
|---|---|
| job_id FK / kind(list·detail) / url / label / category_id / page / position | 방문 순서 |
| status | pending / in_progress / done / failed |
| product_count / error / attempts / duration_seconds | 결과·실패 사유 기록 |

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
| POST | `/api/scan/start` | 「소싱 시작」— 선택 카테고리 + 하위 전부(중간 포함) × 페이지 → 목록 대상 큐 생성 |
| GET | `/api/scan/next` | 확장이 다음 대상 하나를 받아감 (목록 소진 시 상세 대상 자동 준비, 없으면 completed) |
| POST | `/api/scan/targets/{id}/done` | 대상 결과 보고 (성공 상품수 / 실패 사유) |
| GET | `/api/scan/status` | 진행률 (단계·done/total·실패·현재 대상) |
| POST | `/api/scan/pause` `/resume` `/stop` | 제어 |
| GET | `/api/products/export` | 조건 통과 상품 CSV (UTF-8 BOM, 엑셀 호환) |
| GET/POST | `/api/saved` | 보관함 목록 / 상품 id 목록을 스냅샷과 함께 저장 |
| PATCH/DELETE | `/api/saved/{id}`, DELETE `/api/saved/by-product/{product_id}` | 메모 / 삭제 |
| GET | `/api/saved/export` | 보관함 CSV (저장 당시 + 현재 값) |
| GET | `/api/health` | `version` (루트 VERSION 파일) 포함 |

`/api/products`, `/api/stats`, `/api/products/export` 는 `?scan=latest|<번호>` 로 검색 범위를 제한한다.

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

## 5-0. 핵심 지표와 우선순위

```
30일 리뷰수 (상세 리뷰 최신순 페이지 넘김으로 직접 셈)
  → 30일 예상 판매량 = 30일 리뷰수 × 배수(기본 20)      ← 소싱 기준 버튼(월 500/1,000/3,000)의 기준
  → 30일 예상매출   = 30일 예상 판매량 × 가격            ← 기본 정렬, KPI "통과 상품 30일 매출"
쿠팡 "한 달간 N명 구매" 문구 = 같은 상세 방문에서 함께 저장, 2차 확인용
누적 리뷰수 × 배수 = 참고용 (표에서 숨김, 엑셀에만)
2단계 대상 = 1차 조건(가격·리뷰·평점·배송) 통과 & monthly_review_count IS NULL, 누적 리뷰 많은 순
결과 탭 = 조건 통과(기본) / 전체 / 미달 / 30일 미측정(measured=false)
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

## 5-3. 자동 스캔 흐름 (사용자 클릭 없이 목록 → 상세)

```
대시보드 [소싱 시작]  ─▶ POST /api/scan/start  ─▶ scan_targets(list) 큐
확장 popup [자동 수집 시작]
  └▶ service worker scan_runner (탭 1개 재사용, 대상 사이 2.5초)
       loop:
         GET /api/scan/next ─▶ 대상 없음 → completed, 탭 닫고 종료
         tabs.update(url) → 로드 대기(status·URL 확인) → content SCAN
           (content script가 없으면 chrome.scripting 으로 1회 주입)
         목록: ENSURE_LIST_SORT(화면 정렬이 판매량순이 아니면 "판매량순" 클릭) → 끝까지 스크롤
               → parseProductList → POST /api/products/collect (저장 0건이면 실패로 기록)
         상세: + 리뷰 최신순 정렬 → ANALYZE_REVIEWS → 30일을 못 덮으면 NEXT_REVIEW_PAGE([다음] 클릭) 반복
               (상품당 최대 20페이지) → POST /api/products/review-dates
         목록: 좌측 메뉴 SCAN_CATEGORIES → 트리 등록 + 직계 하위를 done 에 실어 보냄
         POST /api/scan/targets/{id}/done {product_count | error, discovered_children[]}
           └ 백엔드: 발견한 하위를 현재 카테고리 아래 등록하고, 아직 대상이 아니면 목록 대상 추가
             (1단계 동안만, 작업당 최대 300페이지)
         5회 연속 실패 → 스스로 정지 (차단·CAPTCHA 를 우회하지 않는다)
대시보드는 2초마다 GET /api/scan/status 로 진행률을 그린다.
```

## 5-4. 카테고리 트리 가져오기

```
popup [쿠팡 카테고리 전체 가져오기]
  └▶ service worker category_importer
       ├▶ 현재 탭이 쿠팡 첫 화면이 아니면 백그라운드 탭으로 www.coupang.com 열기
       ├▶ content SCAN_CATEGORIES → parseCategoryTree(document)
       │    · 카테고리 링크(/np/categories/{code})를 가장 많이 가진 메뉴 컨테이너 선택
       │    · 부모 = 링크를 감싸는 조상 항목의 대표 링크 (DOM 중첩 기반, 클래스명 무관)
       │    · breadcrumb·"전체보기"·긴 문구 제외, 코드 중복 합침, 지어내지 않음
       │    · 링크가 적으면 "카테고리" 버튼에 hover 이벤트를 보내 메뉴를 펼쳐 본 뒤 재시도
       ├▶ POST /api/categories/import (rows)  — 2-pass upsert, 부모 미지정 행은 기존 부모 유지
       └▶ 열었던 탭 닫기
자동 스캔의 목록 대상 처리 후에도 같은 파서로 좌측 메뉴의 하위 카테고리를 등록한다 (부모가 확인된 행만).
```

## 5-5. 대시보드 → 확장 다리 (popup 없이 한 번 클릭)

```
대시보드 페이지(localhost:3000)
  window.postMessage({source:"coupang-sourcing-dashboard", requestId, type})
    └▶ 확장 content script bridge.js (manifest: localhost:3000 에 주입)
         · 페이지에 <html data-coupang-sourcing-extension="확장ID"> 를 심어 "연결됨"을 알린다
         · 허용된 type(SCAN_START/PAUSE/RESUME/STOP/STATE, IMPORT_CATEGORIES)만
           chrome.runtime.sendMessage 로 service worker 에 전달하고 답을 postMessage 로 돌려준다
[소싱 시작] = POST /api/scan/start → SCAN_START,  [쿠팡 카테고리 가져오기] = IMPORT_CATEGORIES
GET /api/scan/status 는 recent_errors(최근 실패 3건)·last_done_label·last_product_count 를 포함해
2단계가 왜 안 되는지 대시보드에서 바로 보이게 한다.
```

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
