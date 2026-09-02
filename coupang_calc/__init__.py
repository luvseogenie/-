"""쿠팡 광고계산기 자동화 패키지.

- sales_report: 판매분석 '상품별 판매 리포트' 엑셀 파싱
- ads_report:   광고센터 캠페인 데이터(CSV/XLSX/표 스크랩) 정규화
- store:        SQLite 일별 누적 저장(같은 날짜는 덮어쓰기)
- workbook:     원본 엑셀과 같은 4개 시트 구조의 장부 생성
- collector:    Playwright 로 판매자센터/광고센터 자동 수집
"""

__version__ = "0.1.0"
