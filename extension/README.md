# 크롬 확장 프로그램: 쿠팡 광고계산기

설치 외에 아무것도 필요 없습니다. 데이터 저장, 장부 계산, 화면이 전부 이 확장 프로그램 안에 있습니다.
사용법은 **`docs/초보자_가이드.md`** 를 보세요.

## 파일 구성
- `manifest.json` — MV3 설정
- `content.js` — 쿠팡 페이지에서 표(table / ag-grid / ARIA grid)를 읽고 날짜를 찾는다
- `popup.html/js` — ① 판매 데이터 저장, ② 광고 데이터 저장, 장부 열기
- `app.html/js/css` — 장부, 일별 광고 입력, 옵션·마진 관리, 백업·설정
- `background.js` — 매일 정해진 시각 자동 수집, (고급) 파이썬 서버 전송
- `lib/parse.js` — 숫자·퍼센트·헤더 정규화 (파이썬 `coupang_calc` 와 같은 규칙)
- `lib/store.js` — `chrome.storage.local` 저장소 (옵션, 마진 이력, 일별 판매·광고)
- `lib/ledger.js` — 장부 계산 (마진 이력 적용, 월 합계)
- `lib/xlsx.js` — 라이브러리 없이 .xlsx/.csv 읽기 (zip + XML, DecompressionStream)
- `lib/importer.js` — 판매 리포트/광고 파일 → 저장
- `lib/legacy.js` — 예전 광고계산기 엑셀(시트 1~3) 가져오기
- `lib/charts.js` — SVG 차트
- `lib/update.js` — 새 버전 확인(GitHub raw manifest), 디스크 파일 변경 감지 → `chrome.runtime.reload()`

## 검사
```bash
node tests/js/test_extension.mjs   # 원본 엑셀 2025-06-08 값과 대조
```

## 표를 못 찾을 때
팝업의 "찾은 표 보기" 에 페이지에서 인식한 표와 헤더가 나옵니다.
- 판매분석 옵션목록은 카드 형태라 표로 읽지 않고, '엑셀 다운로드 → 상품별 판매 리포트' 파일을 읽습니다 (① 버튼이 대신 누르고 `chrome.downloads` 로 감지해 다시 받아 읽음; blob 방식이면 수동 업로드).
- 판매 리포트: 헤더에 `옵션` 과 `매출` 이 있는 행을 헤더로 봅니다.
- 광고 표: 헤더에 `캠페인` 과 `광고비`/`노출`/`예산`/`클릭` 중 하나가 있어야 합니다.
열 이름 별칭은 `lib/parse.js` 의 `SALES_FIELDS`, `ADS_FIELDS` 에 추가합니다.
