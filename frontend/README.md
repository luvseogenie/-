# 프론트엔드 — 쿠팡 상품 소싱 분석 대시보드

Next.js(App Router) + TypeScript + Tailwind CSS + shadcn/ui 스타일 컴포넌트로 만든
다크모드 데이터 분석 대시보드입니다.

```bash
npm install
npm run dev      # http://localhost:3000
```

백엔드 주소는 기본값이 `http://localhost:8000` 입니다. 바꾸려면 `.env.local` 에:

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## 구조

```
src/app/page.tsx              대시보드 (좌 25% 조건 패널 / 우 75% 결과)
src/components/dashboard/     CategoryTree, ConditionPanel, MultiplierPanel,
                              KpiCards, ProductTable
src/components/ui/            shadcn/ui 스타일 프리미티브
src/lib/api.ts                백엔드 API 클라이언트
src/lib/types.ts              API 타입 (backend/app/schemas 와 대응)
```

> shadcn/ui 컴포넌트는 CLI(`npx shadcn add`) 대신 같은 구조로 직접 작성해 두었습니다.
> 필요하면 `components.json` 설정 그대로 CLI로 추가 컴포넌트를 받아올 수 있습니다.

전체 프로젝트 사용법은 저장소 루트의 [README](../README.md) 를 보세요.
